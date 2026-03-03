# GOVINDA V2.0
### File name Govinda coz only god can help this code 😭😭😭 -Nitish, 2026

A **self-evolving**, **structure-first** Compliance RAG platform for analyzing complex regulatory and financial PDF documents. Combines hierarchical tree retrieval, multi-hop reasoning, five adaptive memory feedback loops, a full compliance task lifecycle, role-based team management, and an LLM tournament benchmarking system — all orchestrated through a dual-mode pipeline (Legacy / Optimized) with a comprehensive admin dashboard.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Architecture Overview](#architecture-overview)
3. [Dual-Mode Retrieval Pipeline](#dual-mode-retrieval-pipeline)
4. [Self-Evolving Memory System](#self-evolving-memory-system)
5. [Compliance Task Lifecycle](#compliance-task-lifecycle)
6. [Team & User Management](#team--user-management)
7. [Chat System](#chat-system)
8. [LLM Tournament & Benchmarking](#llm-tournament--benchmarking)
9. [Admin Dashboard](#admin-dashboard)
10. [API Reference](#api-reference)
11. [Frontend Architecture](#frontend-architecture)
12. [Data Models](#data-models)
13. [Configuration Reference](#configuration-reference)
14. [Setup & Deployment](#setup--deployment)
15. [Performance Benchmarks](#performance-benchmarks)
16. [Troubleshooting](#troubleshooting)

---

## Philosophy

GOVINDA V2 is built on the principle that **document structure is more valuable than semantic embeddings** for regulatory documents. Instead of vector similarity alone, it uses:

- **Hierarchical tree representation** (Chapters → Sections → Clauses → Sub-clauses)
- **LLM-guided tree reasoning** (Locate → Read → Reflect → Synthesize → Verify)
- **Cross-reference following** to trace linked provisions
- **Multi-hop planning** for complex questions requiring multiple documents or sections
- **Self-evolving memory** — the system learns from every query and gets smarter over time
- **Dual-mode pipeline** — Legacy (pure LLM-on-tree) and Optimized (embedding-assisted, memory-augmented, per-stage model optimization)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js 16 + React 19)                         │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐     │
│  │ Document  │ │ Chat      │ │ Research  │ │ Actionable│ │ Admin     │     │
│  │ Library   │ │ Interface │ │ Chat      │ │ Tracker   │ │ Dashboard │     │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘     │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐                   │
│  │ Team Board│ │ Team Lead │ │ Compliance│ │ Global    │                   │
│  │           │ │ Dashboard │ │ Review    │ │ Chat      │                   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘                   │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ REST API (ngrok tunnel)
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                    BACKEND (FastAPI + Uvicorn, ~3700 LOC)                    │
│  Document Mgmt │ Query Processing │ Conversations │ Actionables             │
│  Teams & Users │ Chat System │ LLM Benchmarking │ Memory Diagnostics        │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                    RAG PIPELINE (Multi-Agent, Dual-Mode)                     │
│  QA Engine ─▶ Classify ─▶ Locate ─▶ Read ─▶ Reflect ─▶ Synthesize ─▶ Verify│
│  + Memory pre_query (5 loops) ─────────────── Memory post_query (5 loops)   │
│  Agents: Router, Reflector, Synthesizer, Verifier, Planner, Cross-Ref       │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│               SELF-EVOLVING MEMORY LAYER (5 Feedback Loops)                 │
│  RAPTOR Heat Map │ User Memory │ Query Intel │ Retrieval FB │ R2R Fallback  │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                       DATA LAYER (MongoDB Atlas)                            │
│  Trees │ Queries │ Conversations │ Actionables │ Memory Indexes │ Corpus    │
│  Teams │ Users (Auth) │ Benchmarks │ Chats │ GridFS (PDF storage)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
govinda_v2/
├── app_backend/                   # FastAPI backend entry point
│   └── main.py                   # All endpoints (~3700 LOC)
├── agents/                        # LLM agent implementations
│   ├── qa_engine.py              # QA orchestrator (dual-mode, 6-phase)
│   ├── corpus_qa_engine.py       # Cross-document QA engine
│   ├── synthesizer.py            # Answer synthesis with citations
│   ├── verifier.py               # Answer verification
│   ├── planner.py                # Multi-hop query planning
│   └── actionable_extractor.py   # Compliance actionable extraction (SSE)
├── retrieval/                     # RAG retrieval components
│   ├── router.py                 # StructuralRouter (Locate + Read)
│   ├── corpus_router.py          # Cross-document routing
│   ├── retrieval_reflector.py    # Evidence gap detection and fill
│   ├── query_classifier.py       # Query type classification (6 types)
│   ├── query_expander.py         # Sub-query decomposition
│   ├── locator.py                # Tree-based LLM node location
│   ├── reader.py                 # Content reading + context expansion
│   ├── cross_ref_follower.py     # Cross-reference resolution
│   ├── definition_injector.py    # Definition term injection
│   ├── embedding_index.py        # Per-doc embedding pre-filter
│   ├── corpus_embedding_index.py # Cross-doc embedding index
│   └── query_cache.py            # Semantic query caching
├── memory/                        # Self-evolving memory (Phase 3)
│   ├── memory_manager.py         # Central orchestrator (pre/post query)
│   ├── raptor_index.py           # RAPTOR multi-resolution + heat map
│   ├── user_memory.py            # Per-user memory + profile
│   ├── query_intelligence.py     # Semantic retrieval fact store
│   ├── retrieval_feedback.py     # Node reliability scoring
│   ├── r2r_fallback.py           # BM25 + embedding hybrid fallback
│   └── memory_diagnostics.py     # Health, trends, contribution tracking
├── ingestion/                     # PDF processing pipeline
│   ├── pipeline.py               # Ingestion orchestrator
│   ├── parser.py                 # PDF text + table extraction (PyMuPDF)
│   ├── tree_builder.py           # LLM-assisted tree construction
│   └── chunker.py                # Node token management / splitting
├── models/                        # Pydantic / dataclass models
│   ├── document.py               # TreeNode, DocumentTree, TableBlock
│   ├── query.py                  # QueryRecord, Citation, InferredPoint
│   ├── conversation.py           # Conversation, ConversationMessage
│   ├── corpus.py                 # CorpusDocument, DocumentRelationship
│   └── actionable.py             # ActionableItem, task lifecycle
├── tree/                          # Storage layer
│   ├── tree_store.py             # MongoDB tree persistence
│   ├── corpus_store.py           # Corpus graph storage
│   ├── query_store.py            # Query history storage
│   ├── conversation_store.py     # Conversation storage
│   └── actionable_store.py       # Actionable items storage
├── utils/                         # Utilities
│   ├── llm_client.py             # OpenAI client (reasoning_effort)
│   ├── llm_benchmark.py          # Tournament runner + experiment engine
│   ├── mongo.py                  # MongoDB connection manager
│   └── prompts.py                # Prompt template loader
├── config/                        # Configuration
│   ├── settings.py               # Pydantic settings (6 sections)
│   └── prompts/                  # LLM prompt templates (YAML)
├── web/                           # Next.js 16 frontend
│   ├── src/app/                  # App Router pages (15 routes)
│   ├── src/components/           # Views, admin, dashboard, auth, UI
│   └── src/lib/                  # API client, types, utilities
├── requirements.txt
├── start_backend.ps1
├── DEPLOY.md
└── README.md
```

---

## Dual-Mode Retrieval Pipeline

GOVINDA V2 runs in one of two modes, switchable at runtime via the admin dashboard or API:

### Query Types

The system classifies queries into 6 types, each with tailored retrieval strategies:

| Type | Description | Strategy |
|------|-------------|----------|
| `SINGLE_HOP` | Direct lookup in one section | Locate → Read |
| `MULTI_HOP` | Multiple related sections needed | Planner → Multi-pass retrieve |
| `GLOBAL` | Document-wide aggregation | Read all high-level nodes |
| `DEFINITION` | Term/definition lookup | Definition injection → Read |
| `CALCULATION` | Computation from values | Read tables → Calculate |
| `CROSS_REF` | Following section references | Locate → Follow refs → Read |

### Legacy Mode (Pure LLM-on-Tree)

The original pipeline — sends the full tree structure to the LLM for node selection:

1. **Classify** — LLM determines query type
2. **Locate** — LLM selects relevant nodes from the full tree index (up to 15 nodes)
3. **Read** — Fetch full text + parent/sibling expansion + cross-ref following
4. **Reflect** (optional) — LLM assesses evidence gaps and fills them
5. **Synthesize** — LLM generates cited answer with inferred points
6. **Verify** — LLM validates answer against source text

### Optimized Mode (Embedding-Assisted, Memory-Augmented)

Adds performance optimizations and the self-evolving memory layer:

| Feature | Description |
|---------|-------------|
| **Embedding Pre-filter** | Cosine similarity narrows candidates to top-30 before LLM Locate |
| **Query Cache** | Semantic cache (0.95 threshold) returns instant answers for near-duplicate queries |
| **Locator Cache** | Caches LLM Locate calls per `(doc_id, query_hash)` |
| **Reflection Tuning** | Tighter thresholds — skip reflection when evidence is abundant |
| **Verification Skip** | Skip verification when citations >= 2 |
| **Fast Synthesis** | Token budget cap (25K) + reduced reasoning effort |
| **Per-Stage Model Assignment** | Each pipeline stage uses a tournament-verified optimal model |
| **Memory Pre-Query** | 5 feedback loops inject learned context before retrieval |
| **Memory Post-Query** | 5 feedback loops learn from completed queries |

#### Per-Stage Model Assignments (Tournament-Verified)

| Stage | Model | Reasoning Effort | Rationale |
|-------|-------|-----------------|-----------|
| Classify | `gpt-5-mini` | low | Lightweight classification |
| Expand | `gpt-5-mini` | low | Creative query expansion |
| Locate | `gpt-5-nano` | low | Node selection from tree index |
| Reflect | `gpt-5.2` | low | Retrieval quality assessment |
| Synthesize | `gpt-5.2` | medium | Full answer generation with citations |
| Verify | `gpt-5-nano` | low | Factual verification pass |

#### Auto-Build Memory Indexes

When in optimized mode, the ingestion endpoint (`POST /ingest`) automatically builds RAPTOR and R2R indexes for newly uploaded documents. This ensures the memory system is immediately active for the first query. Legacy mode ingestion is unaffected.

---

## Self-Evolving Memory System

The memory system is the core differentiator of GOVINDA V2. It creates a **feedback loop** where every query makes the system smarter. Five independent subsystems each learn from different signals and contribute different improvements.

### How It Works

```
  QUERY IN ──▶ pre_query (5 loops read context)
                    │
              RETRIEVAL PIPELINE RUNS
              (uses memory-boosted candidates,
               reliability scores, user context)
                    │
              post_query (5 loops learn)
                    │
              save_all ──▶ Persist to MongoDB
```

### Loop 1: RAPTOR Heat Map (`raptor_index.py`)

| Aspect | Detail |
|--------|--------|
| **Trains on** | Which document nodes get cited in final answers |
| **Signal** | Citation count per node + recency (30-day exponential decay) |
| **Applies** | Hot nodes get a confidence boost during retrieval |
| **Score** | `log1p(citations) * (0.3 + 0.7 * exp(-days_ago / 30))` |
| **MongoDB** | `raptor_indexes` (metadata + heat), `raptor_embeddings` (vectors) |

Also builds a **multi-resolution embedding index** at ingestion: embeds node summaries, clusters into topic groups, and searches all levels at query time.

### Loop 2: User Memory (`user_memory.py`)

| Aspect | Detail |
|--------|--------|
| **Trains on** | Full Q&A interactions — query, answer, key terms, query type, feedback |
| **Signal** | Frequent topics, query type distribution, avg satisfaction |
| **Applies** | User context string injected into retrieval + synthesis prompts |
| **Layers** | Short-term (deque), mid-term (sessions), long-term (profile) |
| **MongoDB** | `user_memory` |

### Loop 3: Query Intelligence (`query_intelligence.py`)

| Aspect | Detail |
|--------|--------|
| **Trains on** | Full retrieval outcome — cited/wasted nodes, precision, reflection help, timing |
| **Signal** | `RetrievalFact` with semantic embedding + per-type aggregated stats |
| **Applies** | Semantic search returns `suggested_nodes`, `avoid_nodes`, `skip_reflection`, `skip_verification` |
| **Penalty** | Wasted nodes get confidence * 0.3 |
| **MongoDB** | `query_intelligence`, `query_intelligence_embeddings` |

### Loop 4: Retrieval Feedback (`retrieval_feedback.py`)

| Aspect | Detail |
|--------|--------|
| **Trains on** | Cited vs wasted nodes (located but not cited) |
| **Signal** | Per-node reliability score (0.0 to 1.0, starting at 0.5) |
| **Reinforce** | Cited node: score += 0.05 (capped at 1.0) |
| **Penalize** | Wasted node: score -= 0.03 (floored at 0.0) |
| **Applies** | Reliability scores injected into `locate()` — reliable nodes boosted, unreliable suppressed |
| **MongoDB** | `retrieval_feedback` |

### Loop 5: R2R Fallback (`r2r_fallback.py`)

| Aspect | Detail |
|--------|--------|
| **Built from** | Document content at ingestion time |
| **Signal** | BM25 term frequencies + semantic embeddings |
| **Applies** | When primary locator finds insufficient results, R2R provides fallback candidates via hybrid search |
| **MongoDB** | `r2r_index`, `r2r_term_freq`, `r2r_embeddings` |

### Memory Diagnostics (`memory_diagnostics.py`)

The system tracks per-query `MemoryContribution` snapshots showing:
- Which loops fired, learned, errored, and their latency
- Retrieval precision and memory-assisted citation count
- Improvement trends over time (composite 0–100 score with A–F grade)
- Per-loop fire rate, error rate, and utilization metrics

---

## Compliance Task Lifecycle

GOVINDA V2 includes a full compliance workflow for regulatory actionable items.

### Extraction

The `ActionableExtractor` agent scans documents via LLM and extracts compliance requirements as structured `ActionableItem` objects via Server-Sent Events (streaming). Each item includes:
- **Text** — The actionable requirement
- **Risk level** — High Risk / Medium Risk / Low Risk
- **Implementation notes** — Detailed implementation guidance
- **Evidence** — Supporting quotes from the document
- **Workstream / Team** — Assigned team(s)
- **Deadline** — Date + time with calendar picker
- **Source section** — Original document node reference

### Task States

```
Assigned ──▶ In Progress ──▶ Review ──┬──▶ Completed
                                      └──▶ Reworking ──▶ Review (loop)
```

1. **Assigned** — Admin assigns task to a team after approval + publishing
2. **In Progress** — Team member starts working
3. **Review** — Team uploads evidence, marks completed
4. **Compliance Review** — CO inspects evidence and deliverables
5. **Completed** — Approved by CO
6. **Reworking** — Rejected by CO → team fixes → Review again

### Multi-Team Actionables

Items can be assigned to multiple teams. Each team has independent task status, deadline, evidence, and justification workflows tracked in `team_workflows`. An aggregate status is computed from all team statuses.

### Delay Monitoring

- `POST /actionables/check-delays` scans all tasks and flags overdue items
- Team leads submit delay justifications via `POST .../justification`
- Compliance officers review justifications
- Full audit trail tracks every status change, approval, rejection, and delay

---

## Team & User Management

### Hierarchical Teams

Teams are organized in a tree with unlimited nesting:

```
Policy (root)
├── Policy Drafting
└── Policy Review
Technology (root)
├── Infrastructure
├── App Development
│   ├── Frontend Team
│   └── Backend Team
└── Data & Analytics
```

Each team has: name, summary, color palette (Tailwind), hierarchy fields (`parent_name`, `depth`, `path[]`), and an ordering index. "Mixed Team" is a system-generated team for multi-team actionables.

### Roles

| Role | Capabilities |
|------|-------------|
| `compliance_officer` | Review all teams, approve/reject, access all compliance channels |
| `admin` | Full system access, team + user management |
| `team_lead` | Manage team tasks, submit delay justifications, rename channels |
| `team_reviewer` | Review team deliverables |
| `team_member` | Work on tasks, upload evidence, update status |

### Operations

- Create / delete / rename / re-parent teams (with circular dependency detection)
- Cascading deletes (actionables, users, chats cleaned up)
- Cascading renames (actionables, users, chats updated)
- Seed default hierarchical team structure (8 root + 13 sub-teams)
- Auto-assign colors from a 15-color palette

---

## Chat System

### Document Chat & Research Chat

- **Document Chat** — Q&A against a single PDF, auto-persisted with linked `QueryRecord`
- **Research Chat** — Cross-document queries across the corpus
- Hydrated messages include citations, routing logs, timing stats, inferred points

### Global Chat System

Role-based team communication channels:

| Channel Type | Access |
|-------------|--------|
| `compliance_internal` | Compliance officers + admins only |
| `team_compliance:{team}` | Team members + compliance officers |
| `team_internal:{team}` | Team members only |

Features: unread tracking with per-user cursors, hierarchy-aware channel visibility, channel renaming (team leads), strict role-based permissions.

---

## LLM Tournament & Benchmarking

### Benchmark Runner

Tests models across all 6 pipeline stages (classify, expand, locate, reflect, synthesize, verify) with configurable test questions.

### Tournament Mode

Head-to-head battles: all models compete on one stage x one question. GPT-5.2-pro (high reasoning) judges outputs. Results include per-model scores, latencies, token costs, and winner declarations.

### Model Experiment

Full optimization experiment: N models x 6 stages x M questions. Computes weighted score (`quality * w1 + (1-cost) * w2 + (1-latency) * w3`) and outputs the **optimal model assignment per stage**.

### Available Models

| Model | Use Case | Cost Tier |
|-------|----------|-----------|
| `gpt-5.2` | Primary reasoning | Standard |
| `gpt-5.2-pro` | Deep synthesis, tournament judge | Premium |
| `gpt-5-mini` | Fast classification, expansion | Budget |
| `gpt-5-nano` | Node selection, verification | Micro |

---

## Admin Dashboard

A comprehensive system admin interface at `/admin` (login-gated).

| Tab | Contents |
|-----|----------|
| **Overview** | Document count, query stats, timing histograms, feedback ratings, conversation stats, actionable stats, cache stats |
| **Query Log** | Paginated query history with full routing details |
| **Benchmarks** | Legacy vs Optimized aggregate comparison |
| **LLM Benchmark** | Tournament runner, experiment UI, per-stage leaderboards |
| **Memory System** | Per-subsystem status, per-doc stats, collection sizes, feature toggles |
| **Health** | Infrastructure health checks (MongoDB, feature flags, loop status, freshness) |
| **Diagnostics** | Improvement score (0–100 / A–F), fire/error/learn rates, precision trends, recent contributions |
| **Storage** | Per-collection counts and sizes vs 512MB Atlas limit |

### Runtime Controls

- Toggle retrieval mode (Legacy / Optimized) — persisted to MongoDB
- Toggle individual optimization features
- Toggle individual memory loops
- Manual cache invalidation with reason logging

---

## API Reference

### Document Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/documents` | List all documents |
| `POST` | `/ingest` | Upload PDF, build tree, auto-build memory indexes (optimized) |
| `GET` | `/documents/{doc_id}` | Get full document tree |
| `GET` | `/documents/{doc_id}/raw` | Download raw PDF from GridFS |
| `DELETE` | `/documents/{doc_id}` | Delete document + PDF + related data |
| `PATCH` | `/documents/{doc_id}/rename` | Rename (cascades to GridFS, actionables, corpus) |

### Querying

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/query` | Query a single document (auto-persists conversation) |
| `POST` | `/corpus/query` | Cross-document research query |
| `GET` | `/query/{record_id}` | Get past query record |
| `POST` | `/query/{record_id}/feedback` | Submit user feedback |

### Actionables

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/documents/{doc_id}/actionables` | Get actionables for a document |
| `POST` | `/documents/{doc_id}/extract-actionables` | Stream extraction (SSE) |
| `GET` | `/actionables` | List all actionables across documents |
| `PUT` | `/documents/{doc_id}/actionables/{item_id}` | Update actionable fields |
| `POST` | `/documents/{doc_id}/actionables` | Create manual actionable |
| `DELETE` | `/documents/{doc_id}/actionables/{item_id}` | Delete actionable |
| `GET` | `/actionables/approved-by-team` | Approved items grouped by team |
| `POST` | `/actionables/check-delays` | Scan and flag overdue tasks |
| `GET` | `/actionables/delayed` | Get delayed actionables |
| `POST` | `.../actionables/{item_id}/justification` | Submit delay justification |
| `GET` | `.../actionables/{item_id}/audit-trail` | Get audit trail |

### Evidence

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/evidence/upload` | Upload evidence file |
| `GET` | `/evidence/files/{filename}` | Serve evidence file |
| `DELETE` | `/evidence/files/{filename}` | Delete evidence file |

### Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/conversations` | List all conversations |
| `GET` | `/conversations/by-doc/{doc_id}` | List for a document |
| `POST` | `/conversations` | Create conversation |
| `GET` | `/conversations/{conv_id}` | Get (hydrated with query metadata) |
| `DELETE` | `/conversations/{conv_id}` | Delete conversation |
| `DELETE` | `/conversations` | Delete all conversations |

### Corpus

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/corpus` | Get corpus graph |
| `GET` | `/corpus/relationships` | Get document relationships |

### Memory

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/memory/stats` | Memory subsystem stats |
| `POST` | `/memory/raptor/build/{doc_id}` | Build RAPTOR index |
| `POST` | `/memory/r2r/build/{doc_id}` | Build R2R index |
| `POST` | `/memory/build-all/{doc_id}` | Build both indexes |
| `POST` | `/memory/save` | Force-save memory to MongoDB |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/chat/channels` | List visible channels (with unread) |
| `GET` | `/chat/messages/{channel}` | Get messages |
| `POST` | `/chat/messages/{channel}` | Post message |
| `POST` | `/chat/mark-read/{channel}` | Mark as read |
| `GET` | `/chat/unread-total` | Total unread count |
| `POST` | `/chat/rename/{channel}` | Rename channel |

### Teams

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/teams` | List all teams |
| `GET` | `/teams/tree` | Nested tree structure |
| `GET` | `/teams/{name}/descendants` | Descendant names |
| `POST` | `/teams` | Create team |
| `PUT` | `/teams/{name}` | Update team |
| `DELETE` | `/teams/{name}` | Delete team + descendants |
| `POST` | `/teams/seed-defaults` | Seed default teams |

### Config & Optimization

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/config` | System configuration |
| `PATCH` | `/config/retrieval-mode` | Toggle Legacy / Optimized |
| `PATCH` | `/config/optimization-features` | Toggle individual features |
| `GET` | `/optimization/stats` | Benchmark stats |
| `POST` | `/optimization/cache/invalidate` | Clear cache |
| `GET` | `/storage/stats` | Storage per collection |
| `GET` | `/export/training-data` | Export all data as JSON |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/admin/login` | Authentication |
| `GET` | `/admin/overview` | Full system overview |
| `GET` | `/admin/queries` | Paginated query log |
| `GET` | `/admin/query/{id}/full` | Full query record |
| `GET` | `/admin/benchmarks` | Benchmark comparison |
| `GET` | `/admin/memory/detailed` | Detailed memory data |
| `GET` | `/admin/memory/health` | Memory health checks |
| `GET` | `/admin/memory/diagnostics` | Full diagnostics |
| `GET` | `/admin/memory/diagnostics/trends` | Improvement trends |
| `GET` | `/admin/memory/diagnostics/recent` | Recent contributions |
| `GET` | `/admin/system/logs` | Application logs |
| `GET` | `/admin/runtime-config` | Runtime config state |

### LLM Benchmark

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/llm-benchmark/models` | Available models + stages |
| `POST` | `/admin/llm-benchmark/run` | Run benchmark batch |
| `POST` | `/admin/llm-benchmark/tournament-battle` | Run tournament battle |
| `POST` | `/admin/llm-benchmark/experiment` | Run model experiment |
| `GET` | `/admin/llm-benchmark/results` | List recent runs |
| `GET` | `/admin/llm-benchmark/results/{id}` | Get specific run |
| `GET` | `/admin/llm-benchmark/latest` | Most recent results |

---

## Frontend Architecture

### Tech Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Next.js (App Router) | 16.x |
| UI Library | React | 19.x |
| Styling | Tailwind CSS | 4.x |
| Components | Shadcn UI + Radix Primitives | Latest |
| PDF Viewer | react-pdf-viewer | 3.12.0 |
| Icons | Lucide React | 0.564.0 |
| Markdown | react-markdown | 10.1.0 |

### Pages (15 Routes)

| Route | Purpose |
|-------|---------|
| `/` | Document library — upload PDFs, browse documents |
| `/documents/[doc_id]` | Document view — side-by-side PDF + chat |
| `/history` | Conversation history browser |
| `/history/[conv_id]` | Conversation detail with linked PDF |
| `/research` | Cross-document research chat |
| `/actionables` | Compliance actionables management |
| `/dashboard` | Team-specific task overview |
| `/team-board` | Kanban-style task board |
| `/team-lead` | Team lead management view |
| `/team-review` | Compliance officer review queue |
| `/reports` | Compliance reports |
| `/risk` | Risk analysis overview |
| `/chat` | Global role-based team chat |
| `/admin` | Admin dashboard (10+ tabs) |
| `/sign-in` | Authentication |

### Key View Components

| Component | Purpose |
|-----------|---------|
| `PdfViewer` | PDF rendering with citation-click → page jump |
| `ChatInterface` | Main Q&A chat with streaming, citations, routing details |
| `ResearchChat` | Cross-document research with multi-doc citations |
| `ActionablesPanel` | Extraction, approval, publishing workflow |
| `CorpusPanel` | Corpus graph visualization |
| `TreeExplorer` | Document tree hierarchy browser |
| `NodeDetailPanel` | Node content viewer |
| `FeedbackPanel` | User feedback submission |

### State Management

- **No global state library** — React hooks + URL params
- **Auth context** — Role-based access with team awareness
- **Streaming** — Server-Sent Events for real-time extraction updates
- **PDF coordination** — Citation clicks jump to source page via imperative handle
- **Auto-persistence** — All conversations saved to backend automatically

---

## Data Models

### DocumentTree

The core data structure that replaces vector databases:

```python
DocumentTree:
    doc_id: str           # SHA256 hash
    doc_name: str         # Original filename
    doc_description: str  # LLM-generated description
    total_pages: int
    structure: list[TreeNode]

TreeNode:
    node_id: str          # "0000", "0001", etc.
    title: str
    node_type: NodeType   # ROOT, CHAPTER, SECTION, CLAUSE, SUB_CLAUSE
    level: int            # Depth (0 = root)
    start_page / end_page: int
    text: str             # Full content
    summary: str          # LLM-generated
    description: str      # LLM-generated
    topics: list[str]     # Keyword tags
    token_count: int
    children: list[TreeNode]
    parent_id: str
    cross_references: list[CrossReference]
    tables: list[TableBlock]
```

### QueryRecord

Every query produces a full record with:
- Query text, type, sub-queries, key terms
- Routing log (which nodes located, read, expanded)
- Retrieved sections with full text
- Answer text with citations and inferred points
- Verification status and notes
- Stage timings, total time, token count, LLM calls
- Feedback (user rating + comment)

### ActionableItem

Compliance task with full lifecycle:
- Text, risk level (high/medium/low), implementation notes, evidence
- Workstream, assigned teams, multi-team workflows
- Task status, deadline, published date, completion date
- Approval status, justification fields
- Full audit trail (array of timestamped events)

---

## Configuration Reference

### Settings Classes (`config/settings.py`)

| Class | Purpose |
|-------|---------|
| `LLMConfig` | Model selection, API keys, temperature, token limits |
| `TreeConfig` | TOC threshold, node size limits, cross-ref patterns |
| `RetrievalConfig` | Max nodes, context expansion, token budget, reflection thresholds |
| `StorageConfig` | File paths for trees, prompts, logs |
| `OptimizationConfig` | Dual-mode toggles, per-stage models, memory toggles, cache settings |
| `AppConfig` | Log level |

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `LLM_MODEL` | `gpt-5.2` | Primary LLM |
| `LLM_MODEL_PRO` | `gpt-5.2-pro` | Deep reasoning LLM |
| `RETRIEVAL_MODE` | `legacy` | `legacy` or `optimized` |
| `MAX_LOCATED_NODES` | `15` | Max nodes per Locate call |
| `RETRIEVAL_TOKEN_BUDGET` | `100000` | Token budget for context |
| `MAX_CROSS_REF_DEPTH` | `2` | Max cross-reference hops |
| `MAX_NODE_TOKENS` | `3000` | Split nodes larger than this |
| `OPT_EMBEDDING_PREFILTER` | `true` | Enable embedding pre-filter |
| `OPT_QUERY_CACHE` | `true` | Enable semantic query cache |
| `OPT_RAPTOR_INDEX` | `true` | Enable RAPTOR memory loop |
| `OPT_USER_MEMORY` | `true` | Enable user memory loop |
| `OPT_QUERY_INTELLIGENCE` | `true` | Enable query intelligence loop |
| `OPT_RETRIEVAL_FEEDBACK` | `true` | Enable retrieval feedback loop |
| `OPT_R2R_FALLBACK` | `true` | Enable R2R fallback loop |

### Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-your-openai-key

# MongoDB Atlas
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/?appName=govinda
MONGO_DB_NAME=govinda_v2

# Backend CORS
ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:3000

# Frontend (Vercel dashboard)
NEXT_PUBLIC_API_URL=https://your-ngrok-domain.ngrok-free.dev

# Retrieval mode (can also be toggled at runtime)
RETRIEVAL_MODE=optimized
```

---

## Setup & Deployment

### Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB Atlas account (free tier works)
- OpenAI API key
- ngrok account (free static domain recommended)

### Backend Setup

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Create .env (see Environment Variables above)
uvicorn app_backend.main:app --host 0.0.0.0 --port 8001
```

### Frontend Setup

```bash
cd web
npm install
npm run dev          # Development
npm run build        # Production
```

### ngrok Tunnel

```bash
ngrok http --domain=your-domain.ngrok-free.dev 8001
```

**Note**: Free ngrok plan drops long-running HTTP connections (~5 min). Frontend uses `ngrok-skip-browser-warning: 1` header on all API requests.

### Deployment Architecture

| Component | Platform |
|-----------|----------|
| Frontend | Vercel (auto-deploy from git) |
| Backend | Self-hosted laptop + ngrok tunnel |
| Database | MongoDB Atlas (512MB free tier) |

### MongoDB Collections (17+)

| Collection | Purpose |
|------------|---------|
| `trees` | Document tree structures |
| `queries` | All query records with full routing |
| `conversations` | Chat conversations |
| `actionables` | Compliance tasks per document |
| `corpus` | Cross-document relationship graph |
| `fs.files` / `fs.chunks` | GridFS PDF storage |
| `benchmarks` | Performance benchmarks |
| `raptor_indexes` / `raptor_embeddings` | RAPTOR memory |
| `user_memory` | User profiles and interactions |
| `query_intelligence` / `query_intelligence_embeddings` | QI facts |
| `retrieval_feedback` | Node reliability scores |
| `r2r_index` / `r2r_term_freq` / `r2r_embeddings` | R2R fallback |
| `runtime_config` | Persisted runtime toggles |
| `teams` | Team hierarchy |
| `global_chats` / `team_chats` | Chat messages |
| `chat_read_cursors` | Unread tracking |

---

## Performance Benchmarks

### Legacy Mode

| Phase | Time | Tokens |
|-------|------|--------|
| Tree loading | ~0.5s | — |
| Classify + Retrieve | ~16s | 5K–15K |
| Reflect (optional) | ~10–30s | 2K–5K |
| Synthesize | ~60–120s | 20K–50K |
| Verify | ~20–40s | 5K–10K |
| **Total** | **~100–180s** | **30K–80K** |

### Optimized Mode Improvements

- **Query cache hits**: instant (~0s)
- **Embedding pre-filter**: reduces Locate input by 50–70%
- **Per-stage model routing**: gpt-5-nano for classify/verify → 3–5x cheaper
- **Reflection skip**: saves 10–30s when evidence is sufficient
- **Verification skip**: saves 20–40s on high-confidence answers
- **Memory-boosted retrieval**: higher precision from learned node scores

---

## Troubleshooting

### PDF Not Loading
- Verify backend is running and ngrok tunnel is active
- Check `NEXT_PUBLIC_API_URL` has no trailing slash
- Frontend adds `ngrok-skip-browser-warning: 1` header automatically

### CORS Errors
- Backend uses regex `r"https://.*\.vercel\.app"` for Vercel origins
- Check `ALLOWED_ORIGINS` env var for additional domains

### MongoDB Issues
- Verify `MONGO_URI` credentials and IP whitelist in Atlas
- Check storage usage — 512MB limit on free tier
- Use admin dashboard Storage tab to monitor collection sizes

### Memory System Not Learning
- Ensure `RETRIEVAL_MODE=optimized` (memory only active in optimized mode)
- Check that RAPTOR/R2R indexes are built (`is_built: true` in diagnostics)
- Indexes auto-build on ingestion in optimized mode; for existing docs use `POST /memory/build-all/{doc_id}`

---

## Credits

- **PDF Processing**: PyMuPDF (fitz)
- **PDF Viewer**: react-pdf-viewer by Phuoc Nguyen
- **UI Components**: Shadcn UI + Radix Primitives
- **LLM Provider**: OpenAI (GPT-5.2 / GPT-5-mini / GPT-5-nano)
- **Database**: MongoDB Atlas
- **Embeddings**: OpenAI text-embedding-3-small (1536-dim)
- **Frontend**: Next.js 16, React 19, Tailwind CSS 4
