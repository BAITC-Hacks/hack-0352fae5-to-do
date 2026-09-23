"use client";

import { useMemo, useState } from "react";
import type { MoneyCluster, MoneyNode } from "@/lib/money-data";

const ROLES = ["consolidator", "coordinator", "distributor", "transit", "terminal", "peripheral"] as const;
const ROLE_LABEL: Record<string, string> = {
  consolidator: "Consolidators",
  coordinator: "Coordinators",
  distributor: "Distributors",
  transit: "Transit",
  terminal: "Terminals",
  peripheral: "Peripheral",
};
const REASON_LABEL: Record<string, string> = {
  censored_depth4: "Depth 4 cutoff",
  isolate: "Isolated seed",
  single_edge_leaf: "Single edge leaf",
  below_thresholds: "Below role thresholds",
};

const count = (value: number) => new Intl.NumberFormat("en-US").format(value);
const money = (value: number) => `${count(Math.round(value))} KZT`;
const pct = (value: number) => `${Math.round(value * 100)}%`;

function RoleTag({ role }: { role: string }) {
  return <span className={`role-tag role-${role}`}>{role}</span>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {note && <span className="metric-note">{note}</span>}
    </div>
  );
}

export function MoneyWorkbench({
  data,
}: {
  data: { nodes: MoneyNode[]; clusters: MoneyCluster[] } | null;
}) {
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [clusterFilter, setClusterFilter] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selectedGid, setSelectedGid] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const [view, setView] = useState<"nodes" | "clusters">("nodes");

  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  const clusters = useMemo(() => data?.clusters ?? [], [data]);
  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => b.priority_score - a.priority_score || a.gid.localeCompare(b.gid)),
    [nodes],
  );
  const roleCounts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const node of nodes) result[node.role] = (result[node.role] ?? 0) + 1;
    return result;
  }, [nodes]);
  const filteredNodes = useMemo(() => sortedNodes.filter((node) =>
    (roleFilter === "all" || node.role === roleFilter) &&
    (clusterFilter === null || node.cluster_id === clusterFilter) &&
    (!search.trim() || node.gid.includes(search.trim()))
  ), [sortedNodes, roleFilter, clusterFilter, search]);
  const selectedNode = nodes.find((node) => node.gid === selectedGid) ?? null;
  const selectedCluster = clusters.find((cluster) => cluster.cluster_id === selectedNode?.cluster_id);
  const rankedClusters = useMemo(() => [...clusters].sort((a, b) =>
    b.sum_kzt_internal - a.sum_kzt_internal || a.cluster_id - b.cluster_id
  ), [clusters]);
  const shownClusters = clusterFilter === null ? rankedClusters : rankedClusters.filter((cluster) => cluster.cluster_id === clusterFilter);
  const flagged = nodes.length - (roleCounts.peripheral ?? 0);

  function chooseRole(role: string) {
    setRoleFilter(role);
    setLimit(30);
    setView("nodes");
  }

  function chooseCluster(clusterId: number | null) {
    setClusterFilter(clusterId);
    setLimit(30);
    setView("nodes");
  }

  return (
    <div className="workbench">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><strong>Money Graph</strong><small>ANALYST WORKBENCH</small></div>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className={`sidebar-link ${view === "nodes" ? "active" : ""}`} onClick={() => setView("nodes")}>
          <span className="nav-icon">▦</span> Node explorer <span className="nav-count">{count(nodes.length)}</span>
        </button>
        <button className={`sidebar-link ${view === "clusters" ? "active" : ""}`} onClick={() => setView("clusters")}>
          <span className="nav-icon">◎</span> Clusters <span className="nav-count">{count(clusters.length)}</span>
        </button>
        <div className="sidebar-section-label role-section-label">ROLE FILTERS</div>
        <button className={`sidebar-link ${roleFilter === "all" ? "active subtle" : ""}`} onClick={() => chooseRole("all")}>
          <span className="role-dot all" /> All roles <span className="nav-count">{count(nodes.length)}</span>
        </button>
        {ROLES.map((role) => (
          <button key={role} className={`sidebar-link ${roleFilter === role ? "active subtle" : ""}`} onClick={() => chooseRole(role)}>
            <span className={`role-dot ${role}`} /> {ROLE_LABEL[role]} <span className="nav-count">{count(roleCounts[role] ?? 0)}</span>
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="status-dot" />
          <div><strong>{data ? "Analysis loaded" : "Awaiting analysis"}</strong><small>{data ? `${count(nodes.length)} accounts · 2026-07` : "Run the pipeline first"}</small></div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="slash">/</span><strong>{view === "nodes" ? "Node explorer" : "Clusters"}</strong></div>
          <div className="topbar-right"><span className="dataset-pill"><span /> JUL 2026 DATASET</span><span className="topbar-divider" /><span className="topbar-caption">Anonymized transfer network</span></div>
        </header>

        {!data ? (
          <main className="empty-state">
            <div className="empty-symbol">◎</div>
            <h1>Analysis output not found</h1>
            <p>Generate the CSVs, then refresh this page to explore the network.</p>
            <code>python pipeline/run.py --data data --out out</code>
          </main>
        ) : (
          <main className="main-content">
            <div className="intro-row">
              <div><div className="eyebrow">MONEY GRAPH / JULY 2026</div><h1>{view === "nodes" ? "Follow the flow." : "Network clusters."}</h1><p>{view === "nodes" ? "Trace roles, review evidence, and decide where to investigate next." : "Explore communities in the undirected weighted projection of the transfer graph."}</p></div>
              <div className="scope-note"><span className="scope-icon">ⓘ</span><div><strong>Interpretation guide</strong><small>Roles and cluster findings are rule-based hypotheses. Depth 4 limits observed onward flow.</small></div></div>
            </div>

            <section className="stats-grid" aria-label="Network summary">
              <Metric label="ACCOUNTS" value={count(nodes.length)} note="81 seed accounts" />
              <Metric label="PRIORITIZED ROLES" value={count(flagged)} note="Beyond peripheral" />
              <Metric label="CONSOLIDATORS" value={count(roleCounts.consolidator ?? 0)} note="Potential collection points" />
              <Metric label="CLUSTERS" value={count(clusters.length)} note="Louvain communities" />
            </section>

            <section className="role-overview" aria-label="Role distribution">
              <div className="panel-head"><div><span className="section-kicker">NETWORK COMPOSITION</span><h2>Roles at a glance</h2></div><span className="panel-head-note">{count(nodes.length)} accounts classified</span></div>
              <div className="role-track" aria-label="Role proportions">
                {ROLES.map((role) => <div key={role} className={`role-segment ${role}`} style={{ width: `${((roleCounts[role] ?? 0) / nodes.length) * 100}%` }} title={`${ROLE_LABEL[role]}: ${count(roleCounts[role] ?? 0)}`} />)}
              </div>
              <div className="role-legend">{ROLES.map((role) => <button key={role} onClick={() => chooseRole(role)}><span className={`role-dot ${role}`} />{ROLE_LABEL[role]} <strong>{count(roleCounts[role] ?? 0)}</strong></button>)}</div>
            </section>

            {view === "nodes" ? (
              <section className="data-panel">
                <div className="panel-head table-heading"><div><span className="section-kicker">ANALYST QUEUE</span><h2>Explore accounts</h2></div><span className="panel-head-note">Sorted by analyst priority</span></div>
                <div className="toolbar">
                  <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search exact account ID" placeholder="Search by account ID" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(30); }} inputMode="numeric" /></label>
                  <select aria-label="Filter by role" value={roleFilter} onChange={(event) => chooseRole(event.target.value)}><option value="all">All roles</option>{ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}</select>
                  <select aria-label="Filter by cluster" value={clusterFilter ?? "all"} onChange={(event) => chooseCluster(event.target.value === "all" ? null : Number(event.target.value))}><option value="all">All clusters</option>{clusters.map((cluster) => <option key={cluster.cluster_id} value={cluster.cluster_id}>Cluster {cluster.cluster_id} · {cluster.n_nodes} nodes</option>)}</select>
                </div>
                <div className="table-meta"><strong>{count(filteredNodes.length)}</strong> accounts match {clusterFilter !== null && <button onClick={() => chooseCluster(null)}>Clear cluster {clusterFilter} ×</button>}</div>
                <div className="table-wrap"><table><thead><tr><th>ACCOUNT ID</th><th>ROLE</th><th>CLUSTER</th><th>INFLOW</th><th>OUTFLOW</th><th>PRIORITY</th><th className="arrow-col" /></tr></thead><tbody>
                  {filteredNodes.slice(0, limit).map((node) => <tr key={node.gid} onClick={() => setSelectedGid(node.gid)}><td className="gid-cell">{node.gid}{node.is_seed && <span className="seed-marker">SEED</span>}</td><td><RoleTag role={node.role} /></td><td className="subtle-cell">#{node.cluster_id}</td><td>{money(node.in_kzt)}</td><td>{money(node.out_kzt)}</td><td><div className="priority-cell"><span className="priority-bar"><span style={{ width: pct(node.priority_score) }} /></span><strong>{node.priority_score.toFixed(3)}</strong></div></td><td className="row-arrow">↗</td></tr>)}
                </tbody></table>{filteredNodes.length === 0 && <div className="no-results">No accounts match these filters.</div>}</div>
                {limit < filteredNodes.length && <button className="load-more" onClick={() => setLimit((current) => current + 30)}>Show 30 more <span>↓</span></button>}
              </section>
            ) : (
              <section className="data-panel">
                <div className="panel-head table-heading"><div><span className="section-kicker">COMMUNITY VIEW</span><h2>Cluster overview</h2></div><span className="panel-head-note">{count(clusters.length)} communities</span></div>
                <div className="cluster-grid">{shownClusters.map((cluster) => <article className="cluster-card" key={cluster.cluster_id}><div className="cluster-card-top"><span className="cluster-icon">◎</span><span className="cluster-id">CLUSTER {String(cluster.cluster_id).padStart(2, "0")}</span></div><h3>{count(cluster.n_nodes)} accounts</h3><p>{cluster.hypothesis}</p><div className="cluster-metrics"><div><small>INTERNAL FLOW</small><strong>{money(cluster.sum_kzt_internal)}</strong></div><div><small>SEEDS</small><strong>{cluster.n_seed}</strong></div></div><button onClick={() => chooseCluster(cluster.cluster_id)}>View accounts <span>↗</span></button></article>)}</div>
              </section>
            )}
            <footer className="footer-note">Transfer values represent the observed graph only. Transfers below 5,000 KZT are outside this dataset.</footer>
          </main>
        )}
      </div>

      {selectedNode && <div className="detail-backdrop" onClick={() => setSelectedGid(null)}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={`Account ${selectedNode.gid}`} onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="section-kicker">ACCOUNT DETAIL</span><h2>Node evidence</h2></div><button aria-label="Close account details" onClick={() => setSelectedGid(null)}>×</button></div><div className="drawer-body"><span className="drawer-gid-label">ANONYMIZED ACCOUNT ID</span><div className="drawer-gid">{selectedNode.gid}</div><div className="drawer-tags"><RoleTag role={selectedNode.role} />{selectedNode.is_seed && <span className="seed-chip">Seed account</span>}{selectedNode.truncated_by_depth && <span className="censor-chip">Depth 4 cutoff</span>}</div><div className="drawer-score"><div><small>ANALYST PRIORITY</small><strong>{selectedNode.priority_score.toFixed(3)}</strong></div><div><small>ROLE FIT</small><strong>{selectedNode.role_score.toFixed(3)}</strong></div></div><div className="drawer-section"><h3>Why this role?</h3><p className="evidence-text">{selectedNode.evidence}</p>{selectedNode.peripheral_reason && <p className="reason-text">Peripheral reason: {REASON_LABEL[selectedNode.peripheral_reason] ?? selectedNode.peripheral_reason}</p>}</div><div className="drawer-section"><h3>Observed activity</h3><div className="detail-stat-grid"><div><small>INCOMING</small><strong>{money(selectedNode.in_kzt)}</strong><span>{selectedNode.in_deg} payers · {selectedNode.in_tx} transfers</span></div><div><small>OUTGOING</small><strong>{money(selectedNode.out_kzt)}</strong><span>{selectedNode.out_deg} recipients · {selectedNode.out_tx} transfers</span></div><div><small>PASS-THROUGH</small><strong>{selectedNode.pass_through === null ? "—" : `${selectedNode.pass_through.toFixed(2)}×`}</strong><span>Outgoing / incoming</span></div><div><small>BETWEENNESS</small><strong>{selectedNode.betweenness.toFixed(6)}</strong><span>Directed shortest paths</span></div></div></div><div className="drawer-section"><h3>Context</h3><div className="context-row"><span>Cluster</span><button onClick={() => { chooseCluster(selectedNode.cluster_id); setSelectedGid(null); }}>#{selectedNode.cluster_id} ↗</button></div><div className="context-row"><span>Depth from seed</span><strong>{selectedNode.depth}</strong></div><div className="context-row"><span>Matched outflow within 2 days</span><strong>{selectedNode.matched_out_2d_share === null ? "—" : pct(selectedNode.matched_out_2d_share)}</strong></div>{selectedCluster && <p className="cluster-hypothesis">{selectedCluster.hypothesis}</p>}</div><p className="drawer-disclaimer">This classification is a hypothesis from observed transfers, not an allegation about the account holder.</p></div></aside></div>}
    </div>
  );
}
