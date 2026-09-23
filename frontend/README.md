# Money Graph viewer

Use Node.js 22.13 or newer and pnpm 11.7.0 to run the viewer (`npm install --global pnpm@11.7.0` installs pnpm if needed). The Next.js dashboard reads the complete analysis output set (`nodes_roles.csv`, `clusters.csv`, `top_nodes.csv`, and `graph.json`) from `../out/` during local development. If any file is absent, it uses the committed snapshot in `data/`, which is included in the production server bundle. The page labels the active source and warns when local output is incomplete.

It loads `investigations.json` from the same chosen directory. Schema, string gids, transaction references, and SHA-256 hashes of all four companion files must validate. Missing or incompatible evidence produces an availability message without disabling ordinary account analysis.

From the repository root, regenerate the analysis when the parquet inputs or role rules change:

```bash
python pipeline/run.py --data data --out out
```

Then run the viewer:

```bash
cd frontend
pnpm install
pnpm dev
```

Run `pnpm lint && pnpm build` for the production check; the build uses webpack. The RU/EN dashboard supports gid search, role and cluster filters, priority ordering, exported top-list explanations, and numeric evidence for each node. The investigation panel filters seed routes by timing status, highlights consecutive directed route edges, opens dated transfers, and lists next-data requests. Hiding the inspector preserves the selected account and route. All gids are parsed and passed to the browser as strings because they exceed JavaScript's safe integer range.

The five files in `frontend/data/` are a snapshot for deployed environments. Refresh them together from the repository root with `python pipeline/run.py --data data --out frontend/data`, then build and deploy. Roles and cluster descriptions are hypotheses based on the observed July 2026 graph; depth 4 onward transfers and transfers below 5,000 KZT are outside the export. Routes can overlap and do not trace identical funds; amounts must not be added across hops.
