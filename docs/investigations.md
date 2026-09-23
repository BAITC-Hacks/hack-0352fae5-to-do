# Selected-account investigation: schema and viewer guide

Run `python pipeline/run.py --data data --out out` from the repository root.
The additive `out/investigations.json` export supports selecting an account,
inspecting its seed routes, opening dated evidence, and reviewing next-data
requests. The viewer integrates these in the selected account's inspector,
with a directed route view on the map. Roles, priority scores, and the
existing four export formats are unchanged.

## Load and associate the evidence

Load this file from the same directory and pipeline run as the viewer exports.
`meta.schema_version` is `1`. `meta.output_sha256` contains SHA-256 hashes of
the exact bytes of `nodes_roles.csv`, `clusters.csv`, `top_nodes.csv`, and
`graph.json`. Validate these on the server before combining the evidence with
viewer data. If the evidence file is absent, has an unsupported version, or
does not match, show that investigation evidence is unavailable; keep the
ordinary account view usable. Do not mix local evidence with a bundled graph.
When publishing a snapshot, copy all five exports together.

Gids are strings everywhere, including object keys and path arrays. Never
pass a gid through `Number`, `parseInt`, or a numeric CSV parser. Transaction
IDs are strings too. Amounts and counts are numbers.

## Version 1 shape

| Field | Meaning |
| --- | --- |
| `meta` | Schema version, period bounds, account/transaction/route counts, `max_hops=4`, `max_gap_days=2`, timing-category display order, companion file hashes, and coverage limitations. |
| `transactions[transactionId]` | `{src, dst, date, sum_kzt}`; ISO calendar date, observed transfer amount in KZT. |
| `edge_transactions[src][dst]` | All transaction IDs on that directed edge, ordered by date then ID. Missing edges have no entry. |
| `accounts[gid]` | `{route_count, source_seed_count, routes, next_data_requests}`; every input account is present. |
| `routes[]` | `{gids, timing_status, witness_transaction_ids}`; first gid is the source seed, last gid is the selected account. Hop count is `gids.length - 1`. |
| `next_data_requests[]` | `{code, reason, requested_data}`; intraday requests additionally include `transaction_ids` referencing ambiguous witnesses. |

Counts cover all returned structural routes, including those without timing
support. `source_seed_count` counts distinct starting seeds, not independent
sources of money. Routes can overlap and reuse transactions. Do not interpret
route count as a risk score or sum amounts across hops or routes.

Transaction IDs (`tx000001`, etc.) follow sorting by date, numeric source gid,
numeric destination gid, and amount. Identical input rows remain separate
records with separate IDs; they are not deduplicated. IDs are stable for the
same records, including shuffled input, but are local to an export and may
shift when records are added. They are not bank transaction identifiers.

## Route and timing rules

Enumerate every simple directed seed-to-account path with 1–4 edges. Paths
cannot revisit an account, so cycles and zero-length seed paths are excluded.
Other seeds may appear inside a route. A selected seed may have incoming
routes from other seeds. Shared downstream paths are retained per source seed.

| Status | Display label | Rule |
| --- | --- | --- |
| `direct_transfer` | Direct transfer | One edge; witness is its earliest transaction. No multi-hop timing claim. |
| `date_ordered` | Date-ordered | A complete sequence exists with each following transfer 1–2 calendar days later. |
| `same_day_order_unknown` | Same-day order unknown | No strictly dated sequence exists, but one exists allowing 0–2 day gaps. At least one step shares a date. |
| `structural_only` | Structural connection only | No complete sequence satisfies the 0–2 day gap rule; witness list is empty. |

Always prefer `date_ordered`, even if an ambiguous sequence starts earlier.
Within the selected category choose the earliest complete sequence
lexicographically by each transfer's `(date, transaction ID)` in route order.
A first transfer that cannot complete the route is skipped. The gap limit
applies to each pair of successive transfers, not the entire route.

Witness IDs are in edge order, one transaction per edge. They establish
date compatibility only: amounts need not match and the witness does not
prove that identical funds moved onward. Calendar dates cannot establish
intraday order. For structural-only routes, show each edge's transaction
records separately without presenting a chronological flow as established.

Routes are ordered by the categories in the table, then fewest edges, then
numeric gid sequence. Category order is a browsing convention, not a
confidence ranking. The file contains all routes; the UI can paginate them.
An empty list should say “No seed route found within four edges,” not “safe”
or “unconnected.” All 19 isolated seeds remain selectable with empty routes.

## Viewer interaction

1. Use `accounts[selectedGid]` alongside the existing node detail. Show route
   and source-seed counts, followed by timing-labeled route cards.
2. Selecting a route highlights only its consecutive directed edges and
   accounts. Keep the selected account as the investigation endpoint.
3. Open each witness transfer with its source, destination, date, and amount.
   Provide “All transfers on this link” using `edge_transactions[src][dst]`.
4. Show the account's next-data requests and the relevant coverage limitations.
   Requests are suggestions for analyst review; nothing is sent automatically.

The inspector supports RU/EN labels, timing-category filters, and progressive
route display (five at a time). Closing the inspector preserves the selected
account and route; **Show details** restores it. Selecting a different account
clears the route. **Clear route** returns to the account's direct links.
The server checks schema/version, account coverage, string gids, transaction
references, and the four companion hashes before passing evidence to the UI.

Request codes are emitted in this fixed order when applicable:

- `onward_transfers`: depth 4; request outgoing activity beyond the cutoff.
- `full_account_transfers`: no observed incident edge; request complete
  incoming and outgoing records over the export period.
- `seed_inbound`: seed account; request inbound records including outside senders.
- `intraday_timestamps`: at least one ambiguous route; request timestamps
  with timezone for its witness transactions, including intermediate accounts.

An account can receive several requests, or none. An empty request list does
not mean its data is complete; the export-wide limitations still apply.

## Examples from the supplied dataset

For account `100000000343175100`, one `date_ordered` route is:

```json
{
  "gids": ["100000003016635100", "100000005339662100", "100000000343175100"],
  "timing_status": "date_ordered",
  "witness_transaction_ids": ["tx002358", "tx002575"]
}
```

`tx002358` records 26,925 KZT from the first account to the second on
2026-07-16. `tx002575` records 28,100 KZT from the second to the third on
2026-07-17. This supports timing compatibility; it is not an amount match.

Other reproducible examples:

| Selected account | Route/evidence to inspect |
| --- | --- |
| `100000000011452100` | Direct route from `100000006866783100`, witness `tx000378`: 20,000 KZT on July 3. Also has structural-only routes. |
| `100000000041368100` | Route `100000004358004100 → 100000003684369100 → 100000000041368100`; witnesses `tx003440`, `tx003414` both dated July 22. Intraday order is unknown. |
| `100000000018102100` | Depth-4 account; inspect its `onward_transfers` request. |

The supplied export has 2,248 accounts, 4,840 transaction records, and 11,353
routes: 520 direct, 219 date-ordered, 240 same-day ambiguous, and 10,374
structural-only. These are overlapping routes, not counts of laundering
incidents. The export is about 2.9 MB uncompressed. The bundled snapshot now
includes this file. To refresh it, run
`python pipeline/run.py --data data --out frontend/data` from the root and
publish the resulting viewer build; local changes do not update production.
