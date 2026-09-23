# Money Graph — HackAlem AI

AML tool: reconstruct roles in a transaction network from an anonymized
transfer graph. 5-hour hackathon; judged on a fixed rubric.

## Layout
- `data/` — edges/nodes/transactions parquet (read-only, given)
- `starter/starter.py` — given; loads data, builds DiGraph, computes base
  metrics, writes 3 CSVs with EMPTY roles. Read `starter/README.md`.
- `pipeline/` — our code
- `web/` — Next.js viewer
- `out/` — generated CSVs (gitignored)

## Hard rules
- gid is int64 > 2^53. NEVER send it to JS as a number. String at every
  API/JSON boundary.
- Roles are assigned by deterministic rules with documented thresholds.
  An LLM must never decide a role — the jury demands a formal rule.
- Deterministic output: same input, same rows, same order. Tie-break on gid.
- Graph is DIRECTED and WEIGHTED. Undirected methods only for clustering,
  and say so.
- Findings are hypotheses ("signs of consolidation"), never accusations.

## Known data traps
- 444 nodes have out_deg==0 only because traversal stopped at hop 4.
  `out_deg==0 => terminal` is wrong 444 times.
- Seeds' in_kzt is understated by construction; pass_through can exceed 20.
  Don't build seed roles on inbound.
- 19 seeds appear in no edge at all. They must still be in nodes_roles.csv.
- Transfers under 5,000 KZT excluded. Sub-threshold structuring is invisible.
- 16 weakly connected components; the graph is not one network.

## Commands
- `pip install -r starter/requirements.txt`
- `python pipeline/run.py --data data --out out`   (must finish < 5 min)

## Required outputs
- nodes_roles.csv — exactly 2248 rows: gid, role, role_score, cluster_id,
  priority_score, evidence. Evidence contains NUMBERS, not adjectives.
- clusters.csv — cluster_id, n_nodes, n_seed, sum_kzt_internal, top_gids,
  hypothesis
- top_nodes.csv — >= 20 rows: rank, gid, role, priority_score, why
Extra columns allowed; required ones must not be dropped.