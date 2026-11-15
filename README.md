# DB Insight AI

A local-first SQLite explorer for people who want to ask practical questions of a database without writing SQL. The React + Vite frontend loads and queries `.db`, `.sqlite`, and `.sqlite3` files inside the browser with `sql.js` (SQLite compiled to WebAssembly). Uploaded files are never sent to an application server. The Python files under `backend/` are preserved experiments and are not part of this app's runtime.

## Repository structure

```text
DB-Insight-AI/
├── backend/                 # Preserved Python experiments and virtual environment
├── frontend/                # Standalone Vite application and deployment config
│   ├── src/                 # React UI, local SQLite engine, and query logic
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vercel.json
│   └── vite.config.ts
├── .gitignore
└── README.md
```

## Run locally

From `frontend/`, install dependencies with `npm install`, then use `npm run dev`. `npm run build` creates the static site in `frontend/dist/`. The Vercel configuration is scoped to the frontend; the app does not need the Python backend or environment variables.

## Vercel settings

Set **Root Directory** to `frontend` and use the Vite framework preset. Set **Build Command** to `npm run build` and **Output Directory** to `dist`. No install command override, environment variables, or backend service are required.

## Query behavior

The clearly labeled local demo query engine uses database table and column metadata to build a limited set of read-only `SELECT` queries. It supports table record counts, total sales/revenue, top customers, product sales, monthly sales trends, category comparisons, and NULL checks where the schema provides the needed fields and relationships. Every generated query is shown beside the result. The engine is deterministic rule-based logic, not an LLM. For unsupported or ambiguous requests it explains what it could not identify rather than sending a guessed query.

The demo database is built in memory at startup and includes customers, products, orders, and order items. Uploaded databases are held in browser memory and are limited to 50 MB. Query results are capped at 200 rows; the results view displays at most 50 rows at once. Schema inference uses declared foreign keys first and conventional key names as a fallback. Complex schemas, unusual naming, date formats other than SQLite-recognized values, and nuanced business definitions may need manual SQL or a future query-engine extension. Numeric field profiles currently cover the selected table.
