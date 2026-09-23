# Review brief — Money Graph (HackAlem AI, 5h hackathon)

## Task
AML tool. Input: anonymized transfer graph (3 parquet files in `data/`).
Output: 3 CSVs + a viewer screen. Answers "which of these 2,248 customers
should the analyst open first, and why".

Deliverable = `pipeline/run.py` (CLI) + `web/` viewer reading `out/graph.json`.

## Rubric (identical for all cases, /100)
- 25 compliance with must-haves
- 25 technical implementation (incl. consistency between claimed and actual logic)
- 25 README + reproducibility
- 15 value/applicability
- 10 development potential + originality

## Must-haves and how the jury verifies each
1. **Reproducible pipeline.** One command, raw parquet → 3 CSVs, no manual
   steps. Jury runs README command on a CLEAN machine; must finish <5 min.
   *If it fails to launch, the project is eliminated — no corrections allowed.*
2. **Role + score for every node.** `nodes_roles.csv` = exactly 2,248 rows,
   all columns filled, `evidence` non-empty and containing NUMBERS not adjectives.
3. **Documented, explainable criteria.** Jury names 3 arbitrary gids; team has
   60 seconds each to justify the role from its metrics.
4. **Clustering.** `clusters.csv` with size, seed count, turnover, hypothesis;
   every node has a cluster_id.
5. **Priority top list + visualization.** `top_nodes.csv` ≥20 rows; jury names
   a gid during the demo — team must find it on the map and show its links.

## Required schemas (extra columns OK, required ones must not be dropped)
- `nodes_roles.csv`: gid, role, role_score, cluster_id, priority_score, evidence
- `clusters.csv`: cluster_id, n_nodes, n_seed, sum_kzt_internal, top_gids, hypothesis
- `top_nodes.csv`: rank, gid, role, priority_score, why
Roles: consolidator | transit | distributor | terminal | coordinator | peripheral

## Data facts (verified against the parquet files)
- 2,248 nodes / 3,119 edges / 4,840 transactions; July 2026; 365,890,012 KZT
- 81 seeds; 19 of them appear in NO edge (isolates) but must still be in output
- **All 2,248 gids are int64 > 2^53.** Must be strings at every JSON/JS
  boundary or search silently breaks.
- 444 nodes have out_deg==0 only because traversal stopped at hop 4 —
  "out_deg==0 ⇒ terminal" is wrong 444 times
- Seeds' inbound is understated by construction (graph built outward FROM them);
  never judge a seed on inbound or pass_through
- Transfers <5,000 KZT excluded → sub-threshold structuring invisible
- 16 weakly connected components; not one network

## Implemented taxonomy (first match wins; counts verified)
| # | Role | Rule | Count |
|---|---|---|---|
| 1 | coordinator | directed unweighted betweenness ≥0.002 (~P99) | 24 |
| 2 | consolidator | non-seed, not truncated, in_deg≥3, in_deg≥2×out_deg, in_kzt≥100k | 75 |
| 3 | terminal | non-seed, depth<4, out_deg==0, in_kzt≥500k | 34 |
| 4 | distributor | out_deg≥10, out_kzt≥500k | 40 |
| 5 | transit | non-seed, in_deg≥1, out_deg≥1, 0.8≤pass_through≤1.2 | 66 |
| 6 | peripheral | residual; `peripheral_reason` = censored_depth4 444 / isolate 19 / single_edge_leaf 921 / below_thresholds 625 | 2,009 |

- Roles are **rule-based and deterministic**. An LLM must never assign a role.
- `role_score` = rule-fit strength, NOT probability or suspicion.
- `priority_score` = separate formula; centrality term is amount-weighted
  PageRank only (betweenness excluded to avoid double-counting coordinators).
  Measured top-20 mix: 9 coordinator / 8 consolidator / 3 distributor.
- Clustering: Louvain on undirected weighted projection (direction dropped —
  must be stated explicitly); role/priority metrics keep direction.
- Findings are hypotheses ("signs of consolidation"), never accusations.
- Last verified run: 1.2s, byte-identical on rerun.

## Review these, in priority order
1. Does `pipeline/run.py` actually run from a clean checkout following ONLY
   the README? Missing deps, hardcoded paths, undeclared Python version.
2. Determinism: any dict/set iteration, unsorted groupby, unseeded randomness,
   or missing gid tie-break that could reorder rows between runs.
3. Schema conformance: exactly 2,248 rows, all required columns, scores in
   0..1, evidence non-empty, ≤200 chars, contains digits.
4. Does the code match the table above? Flag any threshold in code that
   differs from the documented rule — that gap is scored.
5. gid handling: any place gid becomes a JS number, or loses precision in
   JSON/CSV round-trip.
6. Trap handling: are the 444 censored, 19 isolates and seed-inbound caveats
   actually implemented, not just mentioned?
7. README completeness: what it does, what's implemented, tech + architecture,
   install, launch, test example, data/external services, limitations, deploy
   link, role criteria WITH thresholds, and a scaling section (what changes at
   ~1M nodes — text only).
8. Viewer: gid search works on real gids; node detail shows the metrics behind
   the role; flow direction visible; cluster/role highlighting.

## Out of scope — don't suggest
Upload flows (not verified by any must-have), auth, tests beyond a smoke run,
refactors for elegance, renaming, dependency upgrades. Five-hour event.
