# DB Insight AI

DB Insight turns natural-language questions into SQLite queries using Gemini, while keeping the uploaded database in the browser. The browser sends only the question and inspected schema metadata to the API. It never sends database files or row contents. Generated SQL is checked by the API against the supplied schema, checked again by SQLite in query-only mode, and then run locally in `sql.js`.

The project keeps the React/Vite app in `frontend/` and adds a FastAPI service in `backend/`. The existing `backend/llm_engine.py`, `backend/database_inspector.py`, and `backend/venv/` are preserved experimental work; the new API does not depend on the Ollama experiment.

## Repository structure

```text
DB-Insight-AI/
├── backend/
│   ├── main.py                  # FastAPI, Gemini generation, schema/SQL validation
│   ├── requirements.txt
│   ├── tests/                   # Validator, API, and optional Gemini tests
│   └── llm_engine.py            # Preserved experiment
├── frontend/
│   ├── src/                     # React app, sql.js, and query presentation
│   ├── package.json
│   └── vite.config.ts            # Local /api proxy
├── .env.example
├── vercel.json                  # One-project Vercel Services routing
└── README.md
```

## Local development (PowerShell)

Create a root `.env` by copying `.env.example` and set `GEMINI_API_KEY` to a key from Google AI Studio. `GEMINI_MODEL` is optional and defaults to `gemini-3.5-flash-lite`.

In one terminal:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
uvicorn backend.main:app --reload --port 8000
```

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` to FastAPI on `127.0.0.1:8000`. For a health check, open `http://127.0.0.1:8000/api/health`.

## Vercel deployment

This repository uses Vercel Services to build the frontend and Python API in one Vercel project with same-origin routing. Services are currently a Vercel beta feature; select **Services** as the project's Framework Preset.

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (`.`) |
| Framework Preset | Services |
| Frontend service | `frontend/`, Vite; `npm run build`, output `dist` |
| Backend service | `backend/`, FastAPI; entrypoint `main:app` |
| Install Command | Automatic per service (`npm ci` for frontend and `pip` from `backend/requirements.txt` for Python) |
| Environment variables | `GEMINI_API_KEY` (required), `GEMINI_MODEL` (optional; defaults to `gemini-3.5-flash-lite`) |

The root `vercel.json` sends `/api/*` to FastAPI and all other paths to Vite. Do not set a single top-level build command or output directory: each service owns its build. The selected model is a stable Gemini API model listed with a free tier; quotas and availability depend on Google's account and project limits.

## SQL and data boundaries

The browser sends schema names, types, primary-key/nullability metadata, and discovered foreign keys with the user's question. Large schemas are rejected with an explicit size message instead of silently truncating tables. The API uses structured Gemini output, accepts only one SQLite `SELECT` or `WITH ... SELECT`, checks table and column references, rejects mutating and file/extension operations, and adds a 200-row cap. In the browser, SQLite compiles the query against the uploaded database, `PRAGMA query_only` is enabled, and a second outer limit caps results. Unsupported or ambiguous requests return a clarification instead of SQL.

The model may infer relationships from key names when no foreign key is declared, but it cannot confirm business meaning. The app does not send sample or uploaded rows for AI reasoning, so row-value-dependent interpretation (such as inferring undocumented codes) is intentionally limited. Gemini API keys belong only in the backend environment; never place them in frontend variables.

## Checks

Run Python validator/API tests with `python -m unittest discover -s backend/tests`. The Gemini integration test runs only when `GEMINI_API_KEY` is present; otherwise it is reported as skipped. Frontend checks: `cd frontend; npm ci; npm run build`.
