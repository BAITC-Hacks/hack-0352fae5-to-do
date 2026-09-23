import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

export type MoneyNode = {
  gid: string;
  role: string;
  role_score: number;
  cluster_id: number;
  priority_score: number;
  evidence: string;
  peripheral_reason: string;
  in_deg: number;
  out_deg: number;
  in_kzt: number;
  out_kzt: number;
  in_tx: number;
  out_tx: number;
  pagerank: number;
  betweenness: number;
  pass_through: number | null;
  depth: number;
  is_seed: boolean;
  truncated_by_depth: boolean;
  matched_out_2d_share: number | null;
  priority_why: string | null;
  top_rank: number | null;
};

export type MoneyInvestigation = {
  route_count: number;
  source_seed_count: number;
  routes: {
    gids: string[];
    timing_status: string;
    witness_transaction_ids: string[];
  }[];
  next_data_requests: {
    code: string;
    reason: string;
    requested_data: string;
    transaction_ids?: string[];
  }[];
};

export type MoneyInvestigations = {
  meta?: { coverage_limitations?: string[] };
  accounts: Record<string, MoneyInvestigation>;
};

export type MoneyCluster = {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: number;
  top_gids: string[];
  hypothesis: string;
};

export type MoneyGraph = {
  meta: {
    n_nodes: number;
    n_edges: number;
    n_seed: number;
    n_tx: number;
    total_kzt: number;
    period_start: string;
    period_end: string;
    min_transfer_kzt: number;
  };
  nodes: {
    gid: string;
    role: string;
    cluster_id: number;
    priority_score: number;
    is_seed: boolean;
    x: number;
    y: number;
  }[];
  edges: {
    src: string;
    dst: string;
    sum_kzt: number;
    n_tx: number;
  }[];
};

function parseCsv(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows.filter((cells) => cells.length === headers.length).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]])),
  );
}

function number(value: string): number {
  return Number(value || 0);
}

function optionalNumber(value: string): number | null {
  return value === "" ? null : Number(value);
}

function bool(value: string): boolean {
  return value === "True" || value === "true" || value === "1";
}

export async function loadMoneyData(): Promise<{
  nodes: MoneyNode[];
  clusters: MoneyCluster[];
  graph: MoneyGraph;
  investigations: MoneyInvestigations | null;
} | null> {
  let nodeCsv: string;
  let clusterCsv: string;
  let graphJson: string;
  let dataDirectory = "";
  let found = false;
  nodeCsv = "";
  clusterCsv = "";
  graphJson = "";
  for (const directory of [path.resolve(process.cwd(), "../out"), path.resolve(process.cwd(), "data")]) {
    try {
      [nodeCsv, clusterCsv, graphJson] = await Promise.all([
        readFile(path.join(directory, "nodes_roles.csv"), "utf8"),
        readFile(path.join(directory, "clusters.csv"), "utf8"),
        readFile(path.join(directory, "graph.json"), "utf8"),
      ]);
      found = true;
      dataDirectory = directory;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!found) return null;

  let topRows: Record<string, string>[] = [];
  let investigations: MoneyInvestigations | null = null;
  try {
    topRows = parseCsv(await readFile(path.join(dataDirectory, "top_nodes.csv"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    investigations = JSON.parse(
      await readFile(path.join(dataDirectory, "investigations.json"), "utf8"),
    ) as MoneyInvestigations;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const topByGid = new Map(topRows.map((row) => [row.gid, row]));

  const nodes = parseCsv(nodeCsv).map((row): MoneyNode => {
    const top = topByGid.get(row.gid);
    return ({
    gid: row.gid, // Always a string: gids exceed JavaScript's safe integer range.
    role: row.role,
    role_score: number(row.role_score),
    cluster_id: number(row.cluster_id),
    priority_score: number(row.priority_score),
    evidence: row.evidence,
    peripheral_reason: row.peripheral_reason,
    in_deg: number(row.in_deg),
    out_deg: number(row.out_deg),
    in_kzt: number(row.in_kzt),
    out_kzt: number(row.out_kzt),
    in_tx: number(row.in_tx),
    out_tx: number(row.out_tx),
    pagerank: number(row.pagerank),
    betweenness: number(row.betweenness),
    pass_through: optionalNumber(row.pass_through),
    depth: number(row.depth),
    is_seed: bool(row.is_seed),
    truncated_by_depth: bool(row.truncated_by_depth),
    matched_out_2d_share: optionalNumber(row.matched_out_2d_share),
    priority_why: top?.why || null,
    top_rank: top ? number(top.rank) : null,
  });
  });
  const clusters = parseCsv(clusterCsv).map((row): MoneyCluster => ({
    cluster_id: number(row.cluster_id),
    n_nodes: number(row.n_nodes),
    n_seed: number(row.n_seed),
    sum_kzt_internal: number(row.sum_kzt_internal),
    top_gids: JSON.parse(row.top_gids) as string[],
    hypothesis: row.hypothesis,
  }));
  const graph = JSON.parse(graphJson) as MoneyGraph;
  if (!graph.nodes.every((node) => typeof node.gid === "string") ||
      !graph.edges.every((edge) => typeof edge.src === "string" && typeof edge.dst === "string")) {
    throw new Error("graph.json account IDs must be strings");
  }
  return { nodes, clusters, graph, investigations };
}
