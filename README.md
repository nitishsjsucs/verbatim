# GOVINDA V2
### File name Govinda coz only god can help this code 😭😭😭 -Nitish, 2026

A **vectorless**, **structure-first** RAG system for analyzing complex regulatory and financial PDF documents using a hierarchical tree structure, multi-hop reasoning, and LLM-powered retrieval.

## Philosophy

GOVINDA V2 is built on the principle that **document structure is more valuable than semantic embeddings** for regulatory documents. Instead of vector similarity, it uses:

- **Hierarchical tree representation** (Chapters → Sections → Clauses → Sub-clauses)
- **LLM-guided tree reasoning** (Locate → Read → Reflect → Synthesize)
- **Cross-reference following** to trace linked provisions
- **Multi-hop planning** for complex questions requiring multiple documents or sections

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js 16)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Document     │  │ Chat         │  │ History      │  │ Research     │ │
│  │ Library      │  │ Interface    │  │ Management   │  │ Chat         │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTP / REST API
                                │ with ngrok-skip-browser-warning header
┌───────────────────────────────┴───────────────────────────────────────────┐
│                         BACKEND (FastAPI + Uvicorn)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Document     │  │ Query        │  │ Conversation │  │ Actionable   │   │
│  │ Management   │  │ Processing   │  │ Store        │  │ Extraction   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
┌───────────────────────────────┴───────────────────────────────────────────┐
│                         RAG PIPELINE (Multi-Agent System)                 │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        QA Engine (Orchestrator)                     │  │
│  │    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │  │
│  │    │  Phase 1    │    │  Phase 2    │    │  Phase 3    │            │  │
│  │    │  Retrieval  │───▶  Synthesis  ───▶   Verification             │  │
│  │    │  (~16s)     │    │  (~100-180s)│    │             │            │  │
│  │    └─────────────┘    └─────────────┘    └─────────────┘            │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Router       │  │ Reflector    │  │ Synthesizer  │  │ Verifier     │   │
│  │ (Locate/Read)│  │ (Gap Fill)   │  │ (Generate)   │  │ (Validate)   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                     │
│  │ Planner      │  │ Cross-Ref    │  │ Definition   │                     │
│  │ (Multi-Hop)  │  │ Follower     │  │ Injector     │                     │
│  └──────────────┘  └──────────────┘  └──────────────┘                     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────┴───────────────────────────────────────────┐
│                         DATA LAYER (MongoDB Atlas)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Document     │  │ Query        │  │ Conversation │  │ Actionable   │   │
│  │ Trees        │  │ Records      │  │ History      │  │ Items        │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ GridFS (PDF binary storage)                                          │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
govinda_v2/
├── app_backend/           # FastAPI backend entry point
│   └── main.py           # Main FastAPI app with all endpoints
├── agents/               # LLM agent implementations
│   ├── qa_engine.py     # Main QA orchestrator (6-phase pipeline)
│   ├── corpus_qa_engine.py  # Cross-document QA engine
│   ├── synthesizer.py    # Answer synthesis with citations
│   ├── verifier.py       # Answer verification and validation
│   ├── planner.py        # Multi-hop query planning
│   ├── actionable_extractor.py  # Compliance actionable extraction
│   └── qa_engine.py     # Document-specific QA engine
├── retrieval/            # RAG retrieval components
│   ├── router.py        # StructuralRouter (Locate + Read phases)
│   ├── corpus_router.py  # Cross-document routing
│   ├── retrieval_reflector.py  # Evidence gap detection and fill
│   ├── query_classifier.py     # Query type classification
│   ├── query_expander.py       # Query decomposition
│   ├── locator.py       # Tree-based node location
│   ├── reader.py        # Content reading and expansion
│   ├── cross_ref_follower.py   # Cross-reference resolution
│   └── definition_injector.py  # Definition term injection
├── ingestion/            # PDF processing pipeline
│   ├── pipeline.py      # Main ingestion orchestrator
│   ├── parser.py        # PDF text and table extraction (PyMuPDF)
│   ├── tree_builder.py  # Document tree construction
│   └── chunker.py       # Node token management and splitting
├── models/               # Pydantic/dataclass data models
│   ├── document.py      # TreeNode, DocumentTree, TableBlock
│   ├── query.py         # Query, Answer, QueryRecord, Citation
│   ├── conversation.py  # Conversation, ConversationMessage
│   ├── corpus.py        # CorpusDocument, DocumentRelationship
│   └── actionable.py    # Actionable, ActionablesResult
├── tree/                 # Tree storage and management
│   ├── tree_store.py    # MongoDB tree persistence
│   ├── corpus_store.py  # Cross-document corpus graph
│   ├── query_store.py   # Query history storage
│   ├── conversation_store.py   # Chat conversation storage
│   └── actionable_store.py     # Actionable items storage
├── utils/                # Utilities
│   ├── llm_client.py    # OpenAI API client wrapper
│   ├── mongo.py         # MongoDB connection manager
│   └── prompts.py       # Prompt template management
├── config/               # Configuration
│   ├── settings.py      # Pydantic settings (LLM, Tree, Retrieval)
│   └── prompts/         # LLM prompt templates
├── web/                  # Next.js 16 frontend
│   ├── src/
│   │   ├── app/         # Next.js app router
│   │   │   ├── history/ # Conversation history pages
│   │   │   ├── page.tsx # Main document library
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── views/   # PDF viewer, Chat interface, Document library
│   │   │   └── ui/      # Shadcn UI components
│   │   └── lib/         # API client, types, utilities
│   ├── package.json     # Frontend dependencies
│   └── next.config.ts   # Next.js configuration
├── data/                 # Local data storage (dev only)
│   ├── trees/           # JSON tree files
│   └── pdfs/            # PDF uploads (dev fallback)
├── start_backend.ps1    # PowerShell startup script
├── DEPLOY.md           # Deployment guide
├── requirements.txt     # Python dependencies
└── README.md           # This file
```

## Models Used

### LLM Models

| Purpose | Model | Environment Variable | Fallback |
|---------|-------|---------------------|----------|
| Primary reasoning | GPT-5.2 | `LLM_MODEL=gpt-5.2` | gpt-4o |
| Deep synthesis/verification | GPT-5.2-pro | `LLM_MODEL_PRO=gpt-5.2-pro` | gpt-4o |
| Tree building | GPT-5.2 | Same as primary | gpt-4o |
| Fast classification | GPT-5.2 | Same as primary | gpt-4o |

All models are accessed via OpenAI API. Configure via `.env`:
```bash
OPENAI_API_KEY=sk-your-key-here
LLM_MODEL=gpt-5.2
LLM_MODEL_PRO=gpt-5.2-pro
```

### Document Tree Model

The core data structure replaces vector databases:

```python
@dataclass
class DocumentTree:
    doc_id: str                    # Unique identifier (sha256 hash)
    doc_name: str                  # Original filename
    doc_description: str           # LLM-generated description
    total_pages: int               # PDF page count
    structure: list[TreeNode]      # Hierarchical tree

@dataclass
class TreeNode:
    node_id: str                   # "0000", "0001", etc.
    title: str                     # Section/clause title
    node_type: NodeType          # ROOT, CHAPTER, SECTION, CLAUSE, etc.
    level: int                    # Depth in tree (0 = root)
    start_page: int               # 1-indexed page range
    end_page: int
    text: str                     # Full content
    summary: str                  # LLM-generated summary
    description: str              # LLM-generated description
    topics: list[str]             # Keyword tags for matching
    token_count: int              # Approximate token count
    children: list[TreeNode]     # Child nodes
    parent_id: str               # Parent node reference
    cross_references: list[CrossReference]
    tables: list[TableBlock]      # Embedded tables
```

### Query Types

The system classifies queries into 6 types with different retrieval strategies:

| Type | Description | Retrieval Strategy |
|------|-------------|-------------------|
| `SINGLE_HOP` | Direct lookup in one section | Locate → Read |
| `MULTI_HOP` | Multiple related sections needed | Planner → Multi-pass retrieve |
| `GLOBAL` | Document-wide aggregation | Read all high-level nodes |
| `DEFINITION` | Term/definition lookup | Definition injection → Read |
| `CALCULATION` | Computation from values | Read tables → Calculate |
| `CROSS_REF` | Following section references | Locate → Follow refs → Read |

## RAG Pipeline (6 Phases)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         QA ENGINE PIPELINE                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Phase 1: Load Tree (~0.5s)
    └─▶ Load DocumentTree from MongoDB
        └─▶ Build node indexes (O(1) lookup by node_id)

Phase 2: Classify + Retrieve (~16s)
    ├─▶ Query Classification (LLM call)
    │   └─▶ Detect query type: SINGLE_HOP, MULTI_HOP, GLOBAL, etc.
    │
    ├─▶ Locate (if SINGLE_HOP)
    │   ├─▶ Send tree index (structure + summaries) to LLM
    │   └─▶ LLM returns relevant node_ids (max 15 nodes)
    │
    ├─▶ Read
    │   ├─▶ Fetch full text of located nodes
    │   ├─▶ Context expansion (parent + sibling nodes)
    │   └─▶ Follow cross-references (max depth: 2)
    │
    └─▶ Return: Query + Retrieved Sections + Routing Log

Phase 3: Reflect (optional, ~10-30s)
    ├─▶ Assess evidence sufficiency (LLM call)
    ├─▶ Detect gaps in coverage
    └─▶ Fill gaps via additional retrieval

Phase 4: Synthesize (~60-120s)
    ├─▶ If MULTI_HOP: Use Planner agent
    │   ├─▶ Decompose into sub-queries
    │   ├─▶ Execute each sub-query
    │   └─▶ Synthesize combined answer
    │
    └─▶ Standard Synthesizer
        ├─▶ Generate answer with citations
        ├─▶ Extract inferred points with confidence
        └─▶ Link citations to source nodes

Phase 5: Verify (~20-40s)
    ├─▶ Check answer against source text (LLM call)
    ├─▶ Detect unsupported claims
    ├─▶ Flag confidence issues
    └─▶ Return: verified / needs_review / failed

Phase 6: Finalize
    ├─▶ Attach metadata (timing, tokens, citations)
    ├─▶ Persist QueryRecord to MongoDB
    └─▶ Return Answer
```

## API Endpoints

### Document Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/documents` | List all documents |
| `POST` | `/ingest` | Upload and process PDF |
| `GET` | `/documents/{doc_id}` | Get document tree |
| `GET` | `/documents/{doc_id}/raw` | Download raw PDF (GridFS) |
| `DELETE` | `/documents/{doc_id}` | Delete document |

### Querying

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/query` | Query a single document |
| `POST` | `/corpus/query` | Cross-document research query |
| `GET` | `/query/{record_id}` | Get past query record |
| `POST` | `/query/{record_id}/feedback` | Submit feedback |

### Actionable Extraction

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/documents/{doc_id}/actionables` | Get extracted actionables |
| `POST` | `/documents/{doc_id}/extract-actionables` | Stream extraction (SSE) |

### Conversation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/conversations` | List conversations |
| `POST` | `/conversations` | Create conversation |
| `GET` | `/conversations/{conv_id}` | Get conversation |
| `DELETE` | `/conversations/{conv_id}` | Delete conversation |
| `GET` | `/conversations/{conv_id}/messages` | Get messages |
| `POST` | `/conversations/{conv_id}/messages` | Add messages |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/config` | System configuration |
| `GET` | `/corpus` | Get corpus graph |

## Frontend Architecture

### Tech Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Next.js | 16.1.6 |
| UI | React | 19.2.3 |
| Styling | Tailwind CSS | 4.x |
| Components | Shadcn UI + Radix | Latest |
| PDF Viewer | react-pdf-viewer | 3.12.0 |
| Icons | Lucide React | 0.564.0 |
| Markdown | react-markdown | 10.1.0 |

### Key Frontend Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `PdfViewer` | `web/src/components/views/pdf-viewer.tsx` | PDF rendering with citation jump |
| `ChatInterface` | `web/src/components/views/chat-interface.tsx` | Main Q&A chat with streaming |
| `DocumentLibrary` | `web/src/app/page.tsx` | Document grid and upload |
| `HistoryPage` | `web/src/app/history/page.tsx` | Conversation list |
| `ConversationDetail` | `web/src/app/history/[conv_id]/page.tsx` | Chat + PDF split view |
| `ResearchChat` | `web/src/components/views/research-chat.tsx` | Cross-document chat |

### Frontend State Management

- **No global state library** — uses React hooks and URL params
- **Conversation persistence** — all messages saved to backend
- **Streaming responses** — Server-Sent Events for real-time updates
- **PDF coordination** — Citation clicks jump to page via imperative handle

## Configuration

### Backend Settings (config/settings.py)

| Category | Setting | Default | Description |
|----------|---------|---------|-------------|
| **LLM** | `model` | `gpt-5.2` | Primary LLM |
| **LLM** | `model_pro` | `gpt-5.2-pro` | High-reasoning LLM |
| **LLM** | `temperature` | `0.1` | Creativity (0 = deterministic) |
| **LLM** | `max_tokens_default` | `8192` | Default response limit |
| **Tree** | `max_node_tokens` | `3000` | Split nodes larger than this |
| **Tree** | `toc_accuracy_threshold` | `0.6` | TOC detection confidence |
| **Retrieval** | `max_located_nodes` | `15` | Max nodes in Locate phase |
| **Retrieval** | `retrieval_token_budget` | `100000` | Token limit for context |
| **Retrieval** | `max_cross_ref_depth` | `2` | Max cross-reference hops |

### Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-your-openai-key

# MongoDB Atlas (required for production)
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/?appName=govinda
MONGO_DB_NAME=govinda_v2

# Backend CORS (required for Vercel deployment)
ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:3000

# Frontend (set in Vercel dashboard)
NEXT_PUBLIC_API_URL=https://your-ngrok-domain.ngrok-free.dev
```

## Setup Instructions

### Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB Atlas account (free tier works)
- OpenAI API key
- ngrok account (free static domain)

### 1. Backend Setup

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cat > .env << EOF
OPENAI_API_KEY=sk-your-key-here
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/?appName=govinda
MONGO_DB_NAME=govinda_v2
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
EOF

# Start backend
uvicorn app_backend.main:app --host 0.0.0.0 --port 8001
```

### 2. Frontend Setup

```bash
cd web

# Install dependencies
npm install

# Run locally (for development)
npm run dev

# Build for production
npm run build
```

### 3. ngrok Tunnel (for local backend access)

```bash
# Install ngrok
winget install ngrok  # Windows
# or
brew install ngrok    # macOS

# Authenticate (one-time)
ngrok config add-authtoken YOUR_TOKEN

# Start tunnel with static domain
ngrok http --domain=prouniformity-luther-glowingly.ngrok-free.app 8001
```

## Deployment

### Architecture

| Component | Platform | URL |
|-----------|----------|-----|
| Frontend | Vercel | `https://govinda-is-my-god.vercel.app` |
| Backend | Self-hosted + ngrok | `https://prouniformity-luther-glowingly.ngrok-free.dev` |
| Database | MongoDB Atlas | `mongodb+srv://...` |

### Daily Operation

1. **Start backend**:
   ```powershell
   cd govinda_v2_COPY_COPY
   uvicorn app_backend.main:app --host 0.0.0.0 --port 8001
   ```

2. **Start ngrok**: `ngrok http --domain=prouniformity-luther-glowingly.ngrok-free.dev 8001`

3. **Access frontend**: Vercel deployment is always live at `https://govinda-is-my-god.vercel.app`

### Vercel Environment Variables

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://prouniformity-luther-glowingly.ngrok-free.dev` |

## Key Features

### 1. Tree-Based RAG
- No vector database needed
- Structure-preserving hierarchical representation
- LLM-guided tree navigation (Locate → Read)
- Context expansion (parent/sibling nodes)

### 2. Multi-Hop Reasoning
- Query decomposition into sub-queries
- Sequential retrieval across document sections
- Cross-document research (Corpus QA)

### 3. PDF Integration
- Side-by-side chat and PDF view
- Citation click → jump to page
- Table extraction and markdown conversion
- Cross-reference following

### 4. Actionable Extraction
- Automated compliance requirement detection
- Deadline extraction
- Responsible party identification
- Streaming progress updates (SSE)

### 5. Conversation Persistence
- All queries saved as conversations
- Research chats (cross-document)
- Document-specific chats
- Export training data

## Performance Benchmarks

| Phase | Time | Tokens |
|-------|------|--------|
| Tree loading | ~0.5s | - |
| Retrieval (Phase 1) | ~16s | 5K-15K |
| Reflection (optional) | ~10-30s | 2K-5K |
| Synthesis (Phase 2) | ~60-120s | 20K-50K |
| Verification | ~20-40s | 5K-10K |
| **Total** | **~100-180s** | **30K-80K** |

## Troubleshooting

### PDF Not Loading ("Invalid PDF Structure")
- Backend fetches PDF via blob with `ngrok-skip-browser-warning` header
- Check backend is running and ngrok tunnel is active
- Verify `NEXT_PUBLIC_API_URL` has no trailing slash

### CORS Errors
- Backend must include `https://*.vercel.app` in allowed origins
- Check `ALLOWED_ORIGINS` environment variable
- Backend already configured with regex: `r"https://.*\.vercel\.app"`

### MongoDB Connection Issues
- Verify `MONGO_URI` includes proper credentials
- Check IP whitelist in Atlas (allow access from anywhere for ngrok)
- TLS is enabled automatically for Atlas connections

## License

MIT License — See LICENSE file for details.

## Credits

- **PDF Processing**: PyMuPDF (fitz)
- **PDF Viewer**: react-pdf-viewer by Phuoc Nguyen
- **UI Components**: Shadcn UI + Radix Primitives
- **LLM Provider**: OpenAI
- **Database**: MongoDB Atlas
