# Qwerty Mode

A parallel RAG pipeline inside govinda that mirrors the qwerty (Lunar)
project's architecture: vector retrieval over Cloudflare Vectorize,
file storage on Cloudflare R2, live data on Convex, with a PDF viewer
and clickable chunk-grounded citations.

**Fully isolated from `legacy` and `optimized` modes.** Documents
ingested via qwerty mode do NOT appear in the existing govinda flows
and the existing modes are untouched.

**No Reducto.** Uses govinda's existing PyMuPDF parser (`ingestion/pdf_parser.py`).

## Architecture

```
┌─────────────────────┐      ┌──────────────────────┐
│  govinda web/qwerty │ ───▶ │  Convex (this repo)  │  live queries
│  Next.js + react-pdf│ ◀─── │  convex_qwerty/      │
└──────────┬──────────┘      └─────────▲────────────┘
           │                           │ HTTP actions
           │ /qwerty/*                 │
           ▼                           │
┌──────────────────────┐               │
│ govinda Python API   │ ──────────────┘
│ (FastAPI app_backend)│
│  qwerty_mode/        │
└──┬─────────┬─────────┘
   │         │
   ▼         ▼
┌──────┐ ┌────────────────────┐
│  R2  │ │ Cloudflare Vector- │
│ PDFs │ │ ize (semantic)     │
└──────┘ └────────────────────┘
```

## Setup

### 1. Cloudflare

- Create an R2 bucket (any name → `QWERTY_CF_R2_BUCKET`).
- Create R2 access keys → `QWERTY_CF_R2_ACCESS_KEY_ID`, `QWERTY_CF_R2_SECRET_ACCESS_KEY`.
- Note your account id → `QWERTY_CF_ACCOUNT_ID`. R2 endpoint is `https://<account_id>.r2.cloudflarestorage.com`.
- Create a Cloudflare API token with **Vectorize: Edit** permission → `QWERTY_CF_VECTORIZE_API_TOKEN`.
- The Vectorize index will be auto-created on first ingest.

### 2. Convex

```bash
cd convex_qwerty
npm install
npx convex dev      # creates a new deployment, generates _generated/
```

Note the deployment URL → `QWERTY_CONVEX_URL` and a deploy key from the
Convex dashboard → `QWERTY_CONVEX_DEPLOY_KEY`.

In the Convex dashboard, set environment variable `QWERTY_HTTP_KEY` to the
**same value** as `QWERTY_CONVEX_DEPLOY_KEY`. This authenticates the
Python backend's HTTP action calls.

### 3. Govinda backend env

Copy `qwerty_mode/.env.qwerty.example` contents into govinda's `.env`
and fill in the values from steps 1–2. Install boto3:

```bash
pip install boto3
```

Restart `uvicorn` — you should see `Mounted Qwerty Mode router at /qwerty/*`
in the logs. Sanity check:

```bash
curl http://localhost:8000/qwerty/health
# {"status": "ok", "configured": true}
```

### 4. Govinda web env

In `web/.env.local`:

```
NEXT_PUBLIC_QWERTY_CONVEX_URL=https://<your-deployment>.convex.cloud
```

Install web dependencies (one-time, in `web/`):

```bash
npm install convex react-pdf
npm install --save-dev @types/node
```

Run `npx convex dev` from `convex_qwerty/` once before starting the web
app so `convex_qwerty/_generated/api.ts` exists (the qwerty page imports
it via relative path).

Run the web app and open <http://localhost:3000/qwerty>.

## API surface

All under `/qwerty/*`. Existing govinda routes are untouched.

| Method | Path | Purpose |
|---|---|---|
| GET  | `/qwerty/health` | Configuration sanity check |
| POST | `/qwerty/ingest` | Multipart upload of a single PDF |
| POST | `/qwerty/query`  | `{question, file_ids?}` → answer + citations |
| GET  | `/qwerty/files/{file_id}/url?filename=...` | Presigned R2 GET URL |

## What is shared with govinda

- `OPENAI_API_KEY`
- `ingestion/pdf_parser.py` (PDF parsing, no Reducto)
- `utils/embedding_client.py` (embedding wrapper)
- `utils/llm_client.py` (LLM synthesis)

## What is NOT shared

- No imports from `agents/`, `retrieval/`, `memory/`, or `tree/`.
- No reads/writes to MongoDB collections used by legacy/optimized.
- No mutation of `app_backend/main.py` startup logic — the router is
  mounted via the same defensive pattern used by the intelligence router.
- No env vars from the actual qwerty (Lunar) repo. All vars are
  `QWERTY_` prefixed and live only in govinda's `.env`.

## Files

```
qwerty_mode/                # Python pipeline
  config.py                 # QWERTY_* env loading
  chunker.py                # PDF → ~600-token windows w/ pages
  embeddings.py             # OpenAI embeddings wrapper
  vectorize.py              # Cloudflare Vectorize REST client
  r2.py                     # Cloudflare R2 (boto3) client
  convex_client.py          # Convex HTTP action client
  ingestion.py              # Orchestrates upload→parse→chunk→embed→store
  qa.py                     # Vector search + LLM synth + citations
  api.py                    # FastAPI router mounted at /qwerty/*

convex_qwerty/              # Convex backend
  schema.ts                 # qwertyFiles, qwertyChunks, qwertyConversations, qwertyMessages
  files.ts, chunks.ts, conversations.ts, messages.ts
  http.ts                   # /qwerty/* HTTP actions called by Python

web/src/app/qwerty/         # Frontend page (only this subtree uses Convex)
  layout.tsx                # ConvexProvider scoped to /qwerty
  page.tsx                  # Files sidebar + chat + viewer
  QwertyViewer.tsx          # react-pdf viewer with page-jump

web/src/lib/qwerty/api.ts   # Client helpers for /qwerty/* HTTP routes
```
