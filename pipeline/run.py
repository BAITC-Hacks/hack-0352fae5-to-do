#!/usr/bin/env python3
"""Deterministic, rule-based Money Graph analysis.

The transfer graph stays directed and weighted. Only Louvain clustering uses
an undirected projection. All role thresholds below are fixed, not fitted.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from starter.starter import basic_features, build_graph, load, sanity_check  # noqa: E402


ROLE_FACTOR = {
    "coordinator": 1.0,
    "consolidator": 1.0,
    "distributor": 0.95,
    "terminal": 0.85,
    "transit": 0.75,
    "peripheral": 0.10,
}


def temporal_shares(tx: pd.DataFrame) -> dict[int, float]:
    """Greedily match each eligible inbound KZT to outbound KZT within 0–2 days.

    Same-day dates have no intra-day order, so this is timing support, not
    proof that the identical funds moved onward. Exclude inbound on the last
    two observed days because its full matching window is unavailable.
    """
    if tx.empty:
        return {}
    dates = pd.to_datetime(tx["date"])
    cutoff = dates.max().normalize() - pd.Timedelta(days=2)
    incoming = defaultdict(lambda: defaultdict(float))
    outgoing = defaultdict(lambda: defaultdict(float))
    for src, dst, date, amount in zip(tx.src, tx.dst, dates.dt.normalize(), tx.sum_kzt):
        incoming[int(dst)][date] += float(amount)
        outgoing[int(src)][date] += float(amount)
    shares = {}
    for gid, ins in incoming.items():
        outs = outgoing.get(gid, {})
        available = dict(outs)
        eligible = sum(amount for day, amount in ins.items() if day <= cutoff)
        if eligible <= 0:
            continue
        matched = 0.0
        for day in sorted(ins):
            if day > cutoff:
                continue
            remaining = ins[day]
            for delay in range(3):
                out_day = day + pd.Timedelta(days=delay)
                used = min(remaining, available.get(out_day, 0.0))
                available[out_day] = available.get(out_day, 0.0) - used
                matched += used
                remaining -= used
                if remaining <= 0:
                    break
        shares[gid] = min(1.0, matched / eligible)
    return shares


def features(graph: nx.DiGraph, nodes: pd.DataFrame, tx: pd.DataFrame) -> pd.DataFrame:
    df = basic_features(graph, nodes).sort_values("gid", kind="stable").reset_index(drop=True)
    # Directed, unweighted shortest paths measure brokerage across topology.
    betweenness = nx.betweenness_centrality(graph, normalized=True, weight=None)
    df["betweenness"] = df.gid.map(betweenness).fillna(0.0)
    df["hub_targets"] = df.gid.map({
        gid: sum(graph.out_degree(target) >= 10 for target in graph.successors(gid))
        for gid in graph
    }).fillna(0).astype(int)
    df["matched_out_2d_share"] = df.gid.map(temporal_shares(tx))
    df["distinct_counterparties"] = [
        graph.out_degree(gid) if seed and gid in graph else
        len(set(graph.predecessors(gid)) | set(graph.successors(gid))) if gid in graph else 0
        for gid, seed in zip(df.gid, df.is_seed)
    ]
    return df


def assign_roles(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["role"] = "peripheral"
    remaining = pd.Series(True, index=df.index)
    rules = [
        ("coordinator", df.betweenness >= 0.002),
        ("consolidator", ~df.is_seed & ~df.truncated_by_depth
         & (df.in_deg >= 3) & (df.in_deg >= 2 * df.out_deg)
         & (df.in_kzt >= 100_000)),
        ("terminal", ~df.is_seed & (df.depth < 4) & (df.out_deg == 0)
         & (df.in_kzt >= 500_000)),
        ("distributor", (df.out_deg >= 10) & (df.out_kzt >= 500_000)),
        ("transit", ~df.is_seed & (df.in_deg > 0) & (df.out_deg > 0)
         & df.pass_through.between(0.8, 1.2)),
    ]
    for role, qualifies in rules:
        selected = remaining & qualifies
        df.loc[selected, "role"] = role
        remaining &= ~qualifies

    df["peripheral_reason"] = ""
    peripheral = df.role == "peripheral"
    df.loc[peripheral & df.truncated_by_depth, "peripheral_reason"] = "censored_depth4"
    df.loc[peripheral & (df.in_deg == 0) & (df.out_deg == 0), "peripheral_reason"] = "isolate"
    df.loc[peripheral & (df.in_deg == 1) & (df.out_deg == 0)
           & (df.depth < 4), "peripheral_reason"] = "single_edge_leaf"
    df.loc[peripheral & (df.peripheral_reason == ""), "peripheral_reason"] = "below_thresholds"

    score = np.zeros(len(df), dtype=float)
    masks = {role: (df.role == role).to_numpy() for role in ROLE_FACTOR}
    score[masks["coordinator"]] = np.minimum(1.0, df.loc[masks["coordinator"], "betweenness"] / 0.004)
    c = df.loc[masks["consolidator"]]
    if not c.empty:
        narrowing = np.where(c.out_deg == 0, 2.0, c.in_deg / (4.0 * c.out_deg.replace(0, 1)))
        score[masks["consolidator"]] = np.minimum(1.0, np.minimum.reduce([
            (c.in_deg / 6.0).to_numpy(), (c.in_kzt / 200_000.0).to_numpy(), narrowing
        ])).clip(0, 1)
    score[masks["terminal"]] = np.minimum(1.0, df.loc[masks["terminal"], "in_kzt"] / 1_000_000)
    d = df.loc[masks["distributor"]]
    score[masks["distributor"]] = np.minimum(1.0, np.minimum(d.out_deg / 20, d.out_kzt / 1_000_000))
    score[masks["transit"]] = (1 - (df.loc[masks["transit"], "pass_through"] - 1).abs() / 0.4).clip(0, 1)
    df["role_score"] = score
    return df


def assign_priority(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    amount = np.where(df.is_seed, df.out_kzt, np.maximum(df.in_kzt, df.out_kzt))

    def cap_log(values):
        p99 = np.quantile(values, 0.99)
        return np.minimum(1.0, np.log1p(values) / np.log1p(p99)) if p99 > 0 else np.zeros(len(values))

    def cap_linear(values):
        p99 = np.quantile(values, 0.99)
        return np.minimum(1.0, values / p99) if p99 > 0 else np.zeros(len(values))

    a = cap_log(amount)
    d = cap_log(df.distinct_counterparties.to_numpy())
    s = 1 / (1 + df.depth.to_numpy())
    p = cap_linear(df.pagerank.to_numpy())  # Amount-weighted PageRank only.
    r = df.role.map(ROLE_FACTOR).to_numpy()
    df["priority_score"] = (r * (0.20 + 0.30 * a + 0.20 * d + 0.10 * s + 0.20 * p)).clip(0, 1)
    return df


def clusters(graph: nx.DiGraph, df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    # Louvain alone uses an undirected projection. Reciprocal edge weights sum.
    undirected = nx.Graph()
    undirected.add_nodes_from(int(gid) for gid in df.gid)
    for src, dst, attr in sorted(graph.edges(data=True), key=lambda item: (item[0], item[1])):
        amount = float(attr["sum_kzt"])
        if undirected.has_edge(src, dst):
            undirected[src][dst]["sum_kzt"] += amount
        else:
            undirected.add_edge(src, dst, sum_kzt=amount)
    communities = nx.community.louvain_communities(undirected, weight="sum_kzt", seed=0)
    ordered = sorted((sorted(map(int, community)) for community in communities), key=lambda group: group[0])
    cluster_by_gid = {gid: cluster_id for cluster_id, group in enumerate(ordered) for gid in group}
    df = df.copy()
    df["cluster_id"] = df.gid.map(cluster_by_gid).astype(int)
    internal = defaultdict(float)
    for src, dst, attr in graph.edges(data=True):
        cluster_id = cluster_by_gid[int(src)]
        if cluster_id == cluster_by_gid[int(dst)]:
            internal[cluster_id] += float(attr["sum_kzt"])
    rows = []
    for cluster_id, group in enumerate(ordered):
        subset = df[df.cluster_id == cluster_id]
        top = subset.sort_values(["priority_score", "gid"], ascending=[False, True]).head(5)
        counts = subset.role.value_counts()
        n_collect = int(counts.get("consolidator", 0))
        n_distribute = int(counts.get("distributor", 0))
        n_coordinate = int(counts.get("coordinator", 0))
        pattern = ("Signs of consolidation" if n_collect else
                   "Signs of distribution" if n_distribute else
                   "No role-specific pattern under current thresholds")
        hypothesis = (f"{pattern}: {n_collect} collectors; "
                      f"{n_distribute} distributors; {n_coordinate} coordinators; "
                      f"internal KZT {internal[cluster_id]:.0f}. "
                      "Louvain on undirected weighted projection.")
        rows.append({
            "cluster_id": cluster_id,
            "n_nodes": len(group),
            "n_seed": int(subset.is_seed.sum()),
            "sum_kzt_internal": internal[cluster_id],
            "top_gids": json.dumps([str(int(gid)) for gid in top.gid]),
            "hypothesis": hypothesis,
        })
    return df, pd.DataFrame(rows)


def fmt(value: float) -> str:
    return f"{value:.0f}"


def evidence(row) -> str:
    role = row.role
    if role == "coordinator":
        return (f"directed betweenness={row.betweenness:.6f}>=0.002; "
                f"in_deg={row.in_deg}, out_deg={row.out_deg}, hub_targets={row.hub_targets}")
    if role == "consolidator":
        if row.out_deg == 0:
            return (f"in_deg={row.in_deg}>=3, in_kzt={fmt(row.in_kzt)}>=100000; "
                    f"out_deg=0, out_kzt=0, depth={row.depth}<4; no observed onward transfers")
        return (f"in_deg={row.in_deg}>=2*out_deg({row.out_deg}); "
                f"in_kzt={fmt(row.in_kzt)}>=100000, out_kzt={fmt(row.out_kzt)}, "
                f"out/in={row.pass_through:.2f}")
    if role == "terminal":
        return (f"in_kzt={fmt(row.in_kzt)}>=500000; in_deg={row.in_deg}, "
                f"out_deg=0, depth={row.depth}<4; observed endpoint")
    if role == "distributor":
        return (f"out_deg={row.out_deg}>=10, out_kzt={fmt(row.out_kzt)}>=500000; "
                f"out_tx={row.out_tx}, seed={int(row.is_seed)}")
    if role == "transit":
        timing = (f", matched_2d={row.matched_out_2d_share:.2f}"
                  if pd.notna(row.matched_out_2d_share) else "")
        return (f"out/in={row.pass_through:.2f} in [0.8,1.2]; "
                f"in_kzt={fmt(row.in_kzt)}, out_kzt={fmt(row.out_kzt)}{timing}")
    if row.peripheral_reason == "censored_depth4":
        return (f"depth=4 cutoff; in_deg={row.in_deg}, in_kzt={fmt(row.in_kzt)}, "
                f"out_deg=0; onward transfers unobserved")
    if row.peripheral_reason == "isolate":
        return "in_deg=0, out_deg=0, in_kzt=0, out_kzt=0; seed=1; no observed edge"
    if row.peripheral_reason == "single_edge_leaf":
        return (f"in_deg=1, out_deg=0, in_kzt={fmt(row.in_kzt)}<500000, "
                f"in_tx={row.in_tx}, depth={row.depth}<4")
    ratio = "NA" if pd.isna(row.pass_through) else f"{row.pass_through:.2f}"
    return (f"no rule: b={row.betweenness:.6f}<0.002, in_deg={row.in_deg}, out_deg={row.out_deg}, "
            f"in_kzt={fmt(row.in_kzt)}, out_kzt={fmt(row.out_kzt)}, "
            f"out/in={ratio}, depth={row.depth}, seed={int(row.is_seed)}")


def write_outputs(df: pd.DataFrame, cluster_df: pd.DataFrame, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    df = df.copy()
    df["evidence"] = [evidence(row) for row in df.itertuples(index=False)]
    required = ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"]
    extras = ["peripheral_reason", "in_deg", "out_deg", "in_kzt", "out_kzt", "in_tx", "out_tx",
              "pagerank", "betweenness", "pass_through", "depth", "is_seed",
              "truncated_by_depth", "hub_targets", "matched_out_2d_share", "distinct_counterparties"]
    df.sort_values("gid")[required + extras].to_csv(out_dir / "nodes_roles.csv", index=False)
    cluster_df.to_csv(out_dir / "clusters.csv", index=False)
    top = df.sort_values(["priority_score", "gid"], ascending=[False, True]).head(20).copy()
    top.insert(0, "rank", range(1, len(top) + 1))
    top["why"] = top.evidence
    top[["rank", "gid", "role", "priority_score", "why"]].to_csv(out_dir / "top_nodes.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, default=Path("out"))
    args = parser.parse_args()
    edges, nodes, tx = load(args.data)
    sanity_check(edges, nodes, tx)
    graph = build_graph(edges.sort_values(["src", "dst"], kind="stable"))
    df = assign_priority(assign_roles(features(graph, nodes, tx)))
    df, cluster_df = clusters(graph, df)
    write_outputs(df, cluster_df, args.out)
    print("Roles:", df.role.value_counts().to_dict())
    print(f"Clusters: {len(cluster_df)}; outputs: {args.out}")


if __name__ == "__main__":
    main()
