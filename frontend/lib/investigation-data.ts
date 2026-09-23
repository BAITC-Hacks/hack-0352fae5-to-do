export type TimingStatus = "direct_transfer" | "date_ordered" | "same_day_order_unknown" | "structural_only";
export type InvestigationRoute = {
  gids: string[];
  timing_status: TimingStatus;
  witness_transaction_ids: string[];
};
export type MoneyInvestigation = {
  route_count: number;
  source_seed_count: number;
  routes: InvestigationRoute[];
  next_data_requests: { code: string; reason: string; requested_data: string; transaction_ids?: string[] }[];
};
export type InvestigationTransaction = { src: string; dst: string; date: string; sum_kzt: number };
export type MoneyInvestigations = {
  meta: { schema_version: 1; output_sha256: Record<string, string>; coverage_limitations: string[] };
  accounts: Record<string, MoneyInvestigation>;
  transactions: Record<string, InvestigationTransaction>;
  edge_transactions: Record<string, Record<string, string[]>>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

/** Reject incomplete/stale evidence before exposing it to client components. */
export function validInvestigations(value: unknown, hashes: Record<string, string>, gids: Set<string>): value is MoneyInvestigations {
  if (!record(value) || !record(value.meta) || value.meta.schema_version !== 1 ||
      !record(value.meta.output_sha256) || !strings(value.meta.coverage_limitations) ||
      !record(value.accounts) || !record(value.transactions) || !record(value.edge_transactions)) return false;
  const declaredHashes = value.meta.output_sha256;
  if (!Object.entries(hashes).every(([name, hash]) => declaredHashes[name] === hash) ||
      Object.keys(value.accounts).length !== gids.size) return false;
  const transactions = value.transactions;
  for (const tx of Object.values(transactions)) {
    if (!record(tx) || typeof tx.src !== "string" || typeof tx.dst !== "string" ||
        !gids.has(tx.src) || !gids.has(tx.dst) || typeof tx.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tx.date) || !Number.isFinite(Date.parse(tx.date)) ||
        typeof tx.sum_kzt !== "number" || !Number.isFinite(tx.sum_kzt) || tx.sum_kzt < 0) return false;
  }
  const indexed = new Set<string>();
  for (const [src, targets] of Object.entries(value.edge_transactions)) {
    if (!gids.has(src) || !record(targets)) return false;
    for (const [dst, ids] of Object.entries(targets)) {
      if (!gids.has(dst) || !strings(ids) || !ids.length) return false;
      for (const id of ids) {
        const tx = transactions[id];
        if (indexed.has(id) || !record(tx) || tx.src !== src || tx.dst !== dst) return false;
        indexed.add(id);
      }
    }
  }
  if (indexed.size !== Object.keys(transactions).length) return false;
  for (const [gid, account] of Object.entries(value.accounts)) {
    if (!gids.has(gid) || !record(account) || !Array.isArray(account.routes) ||
        account.route_count !== account.routes.length || !Number.isInteger(account.source_seed_count) ||
        !Array.isArray(account.next_data_requests)) return false;
    for (const route of account.routes) {
      if (!record(route) || !strings(route.gids) || route.gids.length < 2 || route.gids.length > 5 ||
          route.gids.at(-1) !== gid || new Set(route.gids).size !== route.gids.length ||
          !route.gids.every(id => gids.has(id)) || !strings(route.witness_transaction_ids) ||
          !["direct_transfer", "date_ordered", "same_day_order_unknown", "structural_only"].includes(String(route.timing_status))) return false;
      for (let i = 0; i < route.gids.length - 1; i++) {
        const targets = value.edge_transactions[route.gids[i]];
        if (!record(targets) || !strings(targets[route.gids[i + 1]])) return false;
      }
      if (route.timing_status === "structural_only") {
        if (route.witness_transaction_ids.length) return false;
      } else {
        if (route.witness_transaction_ids.length !== route.gids.length - 1) return false;
        for (let i = 0; i < route.witness_transaction_ids.length; i++) {
          const tx = transactions[route.witness_transaction_ids[i]];
          if (!record(tx) || tx.src !== route.gids[i] || tx.dst !== route.gids[i + 1]) return false;
        }
      }
    }
    for (const request of account.next_data_requests) {
      if (!record(request) || typeof request.code !== "string" || typeof request.reason !== "string" ||
          typeof request.requested_data !== "string" || (request.transaction_ids !== undefined &&
          (!strings(request.transaction_ids) || !request.transaction_ids.every(id => indexed.has(id))))) return false;
    }
  }
  return true;
}
