"""Directed seed routes and dated evidence, independent of role assignment."""

import hashlib
import json
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

import networkx as nx
import pandas as pd

MAX_HOPS = 4
MAX_GAP_DAYS = 2
TIMING_ORDER = {
    "direct_transfer": 0,
    "date_ordered": 1,
    "same_day_order_unknown": 2,
    "structural_only": 3,
}


def earliest_witness(edge_events, min_gap: int):
    """Earliest complete sequence by (date, transaction ID), with backtracking.

    Events on each edge are already sorted. Memoizing failed suffixes avoids
    enumerating the Cartesian product of transaction records.
    """
    @lru_cache(maxsize=None)
    def visit(index, previous_day):
        if index == len(edge_events):
            return ()
        for day, tx_id in edge_events[index]:
            if previous_day is not None:
                gap = day - previous_day
                if gap < min_gap:
                    continue
                if gap > MAX_GAP_DAYS:
                    break
            suffix = visit(index + 1, day)
            if suffix is not None:
                return (tx_id,) + suffix
        return None

    return visit(0, None)


def build_investigations(graph: nx.DiGraph, nodes: pd.DataFrame, tx: pd.DataFrame) -> dict:
    ordered = tx.assign(date=pd.to_datetime(tx.date).dt.normalize()).sort_values(
        ["date", "src", "dst", "sum_kzt"], kind="stable"
    )
    transactions = {}
    edge_transactions = defaultdict(lambda: defaultdict(list))
    events = defaultdict(list)
    for index, row in enumerate(ordered.itertuples(index=False), 1):
        tx_id = f"tx{index:06d}"
        src, dst = str(int(row.src)), str(int(row.dst))
        amount = row.sum_kzt
        transactions[tx_id] = {
            "src": src, "dst": dst, "date": row.date.date().isoformat(),
            "sum_kzt": int(amount) if float(amount).is_integer() else float(amount),
        }
        edge_transactions[src][dst].append(tx_id)
        events[(int(row.src), int(row.dst))].append((row.date.toordinal(), tx_id))

    routes = defaultdict(list)
    for seed in sorted(int(gid) for gid in nodes.loc[nodes.is_seed, "gid"]):
        stack = [(seed,)]
        while stack:
            path = stack.pop()
            if len(path) > 1:
                edge_events = [events[edge] for edge in zip(path, path[1:])]
                if len(path) == 2:
                    status = "direct_transfer"
                    witness = earliest_witness(edge_events, 0)
                else:
                    witness = earliest_witness(edge_events, 1)
                    status = "date_ordered"
                    if witness is None:
                        witness = earliest_witness(edge_events, 0)
                        status = "same_day_order_unknown" if witness else "structural_only"
                routes[path[-1]].append({
                    "gids": [str(gid) for gid in path],
                    "timing_status": status,
                    "witness_transaction_ids": list(witness or ()),
                })
            if len(path) <= MAX_HOPS and path[-1] in graph:
                for neighbor in sorted(graph.successors(path[-1]), reverse=True):
                    if neighbor not in path:
                        stack.append(path + (int(neighbor),))

    accounts = {}
    for node in nodes.sort_values("gid").itertuples(index=False):
        gid = int(node.gid)
        account_routes = sorted(routes[gid], key=lambda route: (
            TIMING_ORDER[route["timing_status"]], len(route["gids"]),
            tuple(int(value) for value in route["gids"]),
        ))
        requests = []
        if node.depth == 4:
            requests.append({
                "code": "onward_transfers",
                "reason": "Traversal stops at hop 4; onward activity is unobserved.",
                "requested_data": "Outgoing transfers beyond the current traversal boundary for this account.",
            })
        if gid not in graph or graph.degree(gid) == 0:
            requests.append({
                "code": "full_account_transfers",
                "reason": "This account has no observed edge in the export.",
                "requested_data": "Complete incoming and outgoing transfer records for this account over the export period.",
            })
        if node.is_seed:
            requests.append({
                "code": "seed_inbound",
                "reason": "Traversal starts at this seed; incoming transfers from outside the sample are missing.",
                "requested_data": "Incoming transfer records for this seed, including senders outside the sampled network.",
            })
        ambiguous_ids = sorted({
            tx_id for route in account_routes if route["timing_status"] == "same_day_order_unknown"
            for tx_id in route["witness_transaction_ids"]
        })
        if ambiguous_ids:
            requests.append({
                "code": "intraday_timestamps",
                "reason": "At least one candidate route relies on transfers sharing a date; their order is unknown.",
                "requested_data": "Timestamps with timezone for the referenced transfers along candidate routes.",
                "transaction_ids": ambiguous_ids,
            })
        accounts[str(gid)] = {
            "route_count": len(account_routes),
            "source_seed_count": len({route["gids"][0] for route in account_routes}),
            "routes": account_routes,
            "next_data_requests": requests,
        }

    return {
        "meta": {
            "schema_version": 1, "max_hops": MAX_HOPS, "max_gap_days": MAX_GAP_DAYS,
            "period_start": ordered.date.min().date().isoformat() if len(ordered) else None,
            "period_end": ordered.date.max().date().isoformat() if len(ordered) else None,
            "n_accounts": len(accounts), "n_transactions": len(transactions),
            "n_routes": sum(account["route_count"] for account in accounts.values()),
            "timing_order": list(TIMING_ORDER),
            "coverage_limitations": [
                "Only intra-bank transfers of at least 5,000 KZT within the export period are observed.",
                "Traversal follows outgoing transfers from seeds and stops at hop 4; external inflows are incomplete.",
                "Dates have no intraday ordering; compatible dates do not prove that identical funds moved onward.",
                "Routes contain at most four edges and cannot revisit an account; an empty list does not establish absence of a connection or risk.",
                "Routes can share transfers. Do not add amounts across hops or routes to estimate unique funds.",
                "No amount matching, recurring-pattern detection, or inference of guilt is performed.",
            ],
        },
        "transactions": transactions,
        "edge_transactions": dict(edge_transactions),
        "accounts": accounts,
    }


def write_investigations(graph, nodes, tx, out_dir: Path) -> None:
    payload = build_investigations(graph, nodes, tx)
    # Bind the evidence to the exact viewer exports without changing their schema.
    payload["meta"]["output_sha256"] = {
        name: hashlib.sha256((out_dir / name).read_bytes()).hexdigest()
        for name in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv", "graph.json")
    }
    (out_dir / "investigations.json").write_text(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
