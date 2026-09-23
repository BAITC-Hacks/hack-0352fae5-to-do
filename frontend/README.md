# Money Graph viewer

The Next.js dashboard reads the analysis CSVs from `../out/` during local development. If those files are absent, it uses the committed snapshot in `data/`, which is included in the production server bundle.

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

`pnpm build` uses webpack and is the production check. The dashboard supports gid search, role and cluster filters, priority ordering, and numeric evidence for each node. All gids are parsed and passed to the browser as strings because they exceed JavaScript's safe integer range.

The `frontend/data/` CSVs are a snapshot for deployed environments. Refresh them from `out/` after a pipeline change. Roles and cluster descriptions are hypotheses based on the observed July 2026 graph; depth 4 onward transfers and transfers below 5,000 KZT are outside the export.
