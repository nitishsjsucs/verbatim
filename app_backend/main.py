print("LOADING BACKEND MAIN --------------------------------------------------")
import sys
import os
import shutil
import logging
import uuid
from urllib.parse import quote as url_quote
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Body
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Setup sys.path to allow importing from project root
# ---------------------------------------------------------------------------
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent

# Ensure project root is in sys.path
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.settings import get_settings
from tree.tree_store import TreeStore
from tree.corpus_store import CorpusStore
from tree.actionable_store import ActionableStore
from agents.qa_engine import QAEngine
from agents.corpus_qa_engine import CorpusQAEngine
from agents.actionable_extractor import ActionableExtractor
from ingestion.pipeline import IngestionPipeline
from tree.query_store import QueryStore
from tree.conversation_store import ConversationStore
from models.query import QueryRecord
from models.conversation import ConversationMessage

# ---------------------------------------------------------------------------
# Logging & App Setup
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend")

app = FastAPI(title="Govinda V2 API")

# Configure CORS
# ALLOWED_ORIGINS env var: comma-separated list of allowed origins
# e.g. "https://govinda.vercel.app,http://localhost:3000"
_default_origins = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
_allowed_origins = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"https://(.*\.vercel\.app|.*\.ngrok-free\.app|.*\.ngrok-free\.dev|.*\.ngrok\.io)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Singleton Initialization (FIX #1: Eliminate Dependency Injection)
# ---------------------------------------------------------------------------

_tree_store: Optional[TreeStore] = None
_qa_engine: Optional[QAEngine] = None
_ingestion_pipeline: Optional[IngestionPipeline] = None
_query_store: Optional[QueryStore] = None
_corpus_store: Optional[CorpusStore] = None
_corpus_qa_engine: Optional[CorpusQAEngine] = None
_actionable_store: Optional[ActionableStore] = None
_actionable_extractor: Optional[ActionableExtractor] = None
_conversation_store: Optional[ConversationStore] = None
_benchmark_store = None

# Runtime config — survives hot-reloads, persisted to MongoDB
_runtime_config: dict = {}


def _persist_runtime_config(key: str, value) -> None:
    """Persist a runtime config key to MongoDB."""
    try:
        from utils.mongo import get_db
        db = get_db()
        db["runtime_config"].update_one(
            {"_id": "global"},
            {"$set": {key: value}},
            upsert=True,
        )
    except Exception as e:
        logger.warning("Failed to persist runtime config: %s", e)


def _load_persisted_runtime_config() -> dict:
    """Load persisted runtime config from MongoDB."""
    try:
        from utils.mongo import get_db
        db = get_db()
        doc = db["runtime_config"].find_one({"_id": "global"})
        if doc:
            doc.pop("_id", None)
            return doc
    except Exception as e:
        logger.warning("Failed to load runtime config: %s", e)
    return {}


def get_retrieval_mode() -> str:
    """Get the current retrieval mode (runtime override > env default)."""
    return _runtime_config.get("retrieval_mode", get_settings().optimization.retrieval_mode)


def get_benchmark_store():
    return _benchmark_store


def _init_singletons():
    """Initialize all singletons once at startup."""
    global _tree_store, _qa_engine, _ingestion_pipeline, _query_store
    global _corpus_store, _corpus_qa_engine, _actionable_store
    global _actionable_extractor, _conversation_store, _benchmark_store
    
    logger.info("Initializing backend singletons...")
    
    _tree_store = TreeStore()
    logger.info("  ✓ TreeStore initialized")
    
    _qa_engine = QAEngine()
    logger.info("  ✓ QAEngine initialized")
    
    _ingestion_pipeline = IngestionPipeline()
    logger.info("  ✓ IngestionPipeline initialized")
    
    _query_store = QueryStore()
    logger.info("  ✓ QueryStore initialized")
    
    _corpus_store = CorpusStore()
    logger.info("  ✓ CorpusStore initialized")
    
    _corpus_qa_engine = CorpusQAEngine()
    logger.info("  ✓ CorpusQAEngine initialized")
    
    _actionable_store = ActionableStore()
    logger.info("  ✓ ActionableStore initialized")
    
    _actionable_extractor = ActionableExtractor()
    logger.info("  ✓ ActionableExtractor initialized")
    
    _conversation_store = ConversationStore()
    logger.info("  ✓ ConversationStore initialized")

    from tree.benchmark_store import BenchmarkStore
    _benchmark_store = BenchmarkStore()
    logger.info("  ✓ BenchmarkStore initialized")

    # Phase 3: Initialize Memory Manager (self-evolving system)
    try:
        from memory.memory_manager import get_memory_manager
        from utils.mongo import get_db
        from utils.embedding_client import EmbeddingClient
        mm = get_memory_manager()
        mm.initialize(
            db=get_db(),
            embedding_client=EmbeddingClient(),
            llm_client=_qa_engine._llm if _qa_engine else None,
        )
        logger.info("  ✓ MemoryManager initialized")
    except Exception as e:
        logger.warning("  ⚠ MemoryManager init failed (non-fatal): %s", e)
    
    logger.info("All singletons initialized successfully")


@app.on_event("startup")
async def startup_event():
    """Initialize all singletons on app startup."""
    global _runtime_config, _benchmark_store
    _init_singletons()
    _runtime_config = _load_persisted_runtime_config()
    logger.info("Runtime config loaded: %s", _runtime_config)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class IngestResponse(BaseModel):
    doc_id: str
    doc_name: str
    doc_description: str = ""
    node_count: int
    total_pages: int
    time_seconds: float


class QueryRequest(BaseModel):
    query: str
    doc_id: str
    verify: bool = True
    reflect: bool = False
    conv_id: Optional[str] = None  # If None, backend creates a new conversation


class CitationModel(BaseModel):
    citation_id: str
    node_id: str
    title: str
    page_range: str
    excerpt: str


class InferredPointModel(BaseModel):
    point: str
    supporting_definitions: List[str] = []
    supporting_sections: List[str] = []
    reasoning: str = ""
    confidence: str = "medium"


class RetrievedSectionModel(BaseModel):
    node_id: str
    title: str
    text: str
    page_range: str
    source: str = "direct"
    token_count: int = 0


class RoutingLogModel(BaseModel):
    query_text: str = ""
    query_type: str = ""
    locate_results: List[dict] = []
    read_results: List[dict] = []
    cross_ref_follows: List[dict] = []
    total_nodes_located: int = 0
    total_sections_read: int = 0
    total_tokens_retrieved: int = 0
    stage_timings: dict = {}


class QueryResponse(BaseModel):
    answer: str
    record_id: str
    conv_id: str = ""  # Conversation ID (new or existing)
    citations: List[CitationModel]
    verification_status: str
    verification_notes: str = ""
    inferred_points: List[InferredPointModel] = []
    query_type: str = "single_hop"
    sub_queries: List[str] = []
    key_terms: List[str] = []
    retrieved_sections: List[RetrievedSectionModel] = []
    routing_log: Optional[RoutingLogModel] = None
    stage_timings: dict = {}
    total_time_seconds: float = 0.0
    total_tokens: int = 0
    llm_calls: int = 0


class FeedbackRequest(BaseModel):
    text: str = ""
    rating: Optional[int] = None


# --- Cross-Document (Corpus) Models ---


class CorpusQueryRequest(BaseModel):
    query: str
    verify: bool = True
    conv_id: Optional[str] = None  # If None, backend creates a new conversation


class CorpusCitationModel(BaseModel):
    citation_id: str
    node_id: str
    doc_id: str = ""
    doc_name: str = ""
    title: str
    page_range: str
    excerpt: str


class CorpusQueryResponse(BaseModel):
    answer: str
    record_id: str
    conv_id: str = ""  # Conversation ID (new or existing)
    citations: List[CorpusCitationModel]
    verification_status: str
    verification_notes: str = ""
    inferred_points: List[InferredPointModel] = []
    query_type: str = "global"
    sub_queries: List[str] = []
    key_terms: List[str] = []
    retrieved_sections: List[RetrievedSectionModel] = []
    selected_documents: List[dict] = []
    per_doc_routing_logs: dict = {}
    stage_timings: dict = {}
    total_time_seconds: float = 0.0
    total_tokens: int = 0
    llm_calls: int = 0


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
def get_tree_store() -> TreeStore:
    return _tree_store


def get_qa_engine() -> QAEngine:
    return _qa_engine


def get_ingestion_pipeline() -> IngestionPipeline:
    return _ingestion_pipeline


def get_query_store() -> QueryStore:
    return _query_store


def get_corpus_store() -> CorpusStore:
    return _corpus_store


def get_corpus_qa_engine() -> CorpusQAEngine:
    return _corpus_qa_engine


def get_actionable_store() -> ActionableStore:
    return _actionable_store


def get_actionable_extractor() -> ActionableExtractor:
    return _actionable_extractor


def get_conversation_store() -> ConversationStore:
    return _conversation_store


# ---------------------------------------------------------------------------
# Helper: serialize TreeNode dataclass to dict for JSON response
# ---------------------------------------------------------------------------
# Helper: serialize TreeNode dataclass to dict for JSON response
# ---------------------------------------------------------------------------
def _serialize_node(node) -> dict:
    """Recursively serialize a TreeNode dataclass to a JSON-safe dict."""
    d = {
        "node_id": node.node_id,
        "title": node.title,
        "node_type": node.node_type.value
        if hasattr(node.node_type, "value")
        else str(node.node_type),
        "level": node.level,
        "start_page": node.start_page,
        "end_page": node.end_page,
        "text": node.text,
        "summary": node.summary,
        "description": node.description,
        "topics": node.topics if hasattr(node, "topics") else [],
        "token_count": node.token_count,
        "parent_id": node.parent_id,
        "children": [_serialize_node(c) for c in node.children]
        if node.children
        else [],
        "cross_references": [
            {
                "source_node_id": cr.source_node_id,
                "target_identifier": cr.target_identifier,
                "target_node_id": cr.target_node_id,
                "resolved": cr.resolved,
            }
            for cr in node.cross_references
        ]
        if node.cross_references
        else [],
        "tables": [
            {
                "table_id": t.table_id,
                "page_number": t.page_number,
                "caption": t.caption,
                "raw_text": t.raw_text,
                "markdown": t.to_markdown() if hasattr(t, "to_markdown") else "",
                "num_rows": t.num_rows,
                "num_cols": t.num_cols,
            }
            for t in node.tables
        ]
        if node.tables
        else [],
    }
    return d


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health_check():
    return {"status": "ok", "version": "2.0"}


@app.get("/documents")
def list_documents():
    """List all indexed documents (batch loaded for efficiency - FIX #5)."""
    store = get_tree_store()
    docs = store.list_documents_summary()

    # Batch-check which docs already have actionables extracted
    try:
        act_store = get_actionable_store()
        extracted_ids = set()
        for raw in act_store._collection.find({}, {"doc_id": 1, "actionables": {"$slice": 1}}):
            did = raw.get("doc_id", "")
            if did and raw.get("actionables"):
                extracted_ids.add(did)
        for d in docs:
            d["has_actionables"] = d["id"] in extracted_ids
    except Exception:
        for d in docs:
            d["has_actionables"] = False

    return docs


@app.get("/documents/{doc_id}")
def get_document(doc_id: str):
    """Get full tree structure for a document."""
    store = get_tree_store()
    tree = store.load(doc_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Document not found")

    return {
        "doc_id": tree.doc_id,
        "doc_name": tree.doc_name,
        "doc_description": tree.doc_description,
        "total_pages": tree.total_pages,
        "structure": [_serialize_node(n) for n in tree.structure],
    }


@app.get("/documents/{doc_id}/raw")
def get_document_raw(doc_id: str):
    """Serve the raw PDF file from GridFS."""
    store = get_tree_store()
    tree = store.load(doc_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Document not found")

    from utils.mongo import get_fs

    fs = get_fs()

    cache_headers = {
        "Cache-Control": "public, max-age=3600, immutable",
        "ETag": f'"{doc_id}"',
    }

    grid_out = fs.find_one({"filename": tree.doc_name})

    if not grid_out:
        # Fallback: try serving from local disk
        settings = get_settings()
        local_path = settings.storage.trees_dir.parent / "pdfs" / tree.doc_name
        if local_path.exists():
            safe_name = tree.doc_name.encode("ascii", "replace").decode("ascii")
            return FileResponse(
                str(local_path),
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"inline; filename=\"{safe_name}\"; filename*=UTF-8''{url_quote(tree.doc_name)}",
                    **cache_headers,
                },
            )
        raise HTTPException(
            status_code=404, detail=f"PDF file not found: {tree.doc_name}"
        )

    safe_name = tree.doc_name.encode("ascii", "replace").decode("ascii")
    file_length = grid_out.length if hasattr(grid_out, "length") else None
    resp_headers = {
        "Content-Disposition": f"inline; filename=\"{safe_name}\"; filename*=UTF-8''{url_quote(tree.doc_name)}",
        **cache_headers,
    }
    if file_length:
        resp_headers["Content-Length"] = str(file_length)

    return StreamingResponse(
        grid_out,
        media_type="application/pdf",
        headers=resp_headers,
    )


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    """Delete a document and its PDF from GridFS."""
    store = get_tree_store()

    # Load tree first to get doc_name for GridFS cleanup
    tree = store.load(doc_id)

    try:
        store.delete(doc_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Clean up PDF from GridFS
    if tree:
        try:
            from utils.mongo import get_fs

            fs = get_fs()
            grid_file = fs.find_one({"filename": tree.doc_name})
            if grid_file:
                fs.delete(grid_file._id)
                logger.info("Deleted PDF from GridFS: %s", tree.doc_name)
        except Exception as e:
            logger.warning("Failed to delete PDF from GridFS: %s", e)

    # Remove from corpus graph
    try:
        corpus_store = get_corpus_store()
        corpus_store.remove_document(doc_id)
        logger.info("Removed document from corpus: %s", doc_id)
    except Exception as e:
        logger.warning("Failed to remove from corpus: %s", e)

    return {"status": "deleted", "id": doc_id}


@app.patch("/documents/{doc_id}/rename")
def rename_document(doc_id: str, body: dict):
    """Rename a document (updates doc_name in tree store, GridFS, actionables, and corpus)."""
    new_name = body.get("name", "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name is required")

    store = get_tree_store()
    tree = store.load(doc_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Document not found")

    old_name = tree.doc_name

    # 1. Update tree store (MongoDB trees collection)
    store._collection.update_one({"_id": doc_id}, {"$set": {"doc_name": new_name}})

    # 2. Rename in GridFS if PDF exists
    try:
        from utils.mongo import get_fs
        fs = get_fs()
        grid_file = fs.find_one({"filename": old_name})
        if grid_file:
            from utils.mongo import get_db
            db = get_db()
            db_name = db.name if hasattr(db, 'name') else None
            # Access the underlying files collection to rename
            from pymongo import MongoClient
            client = db.client
            if db_name:
                client[db_name]["fs.files"].update_one(
                    {"_id": grid_file._id},
                    {"$set": {"filename": new_name}}
                )
            logger.info("Renamed PDF in GridFS: %s -> %s", old_name, new_name)
    except Exception as e:
        logger.warning("Failed to rename in GridFS: %s", e)

    # 3. Update actionables store doc_name
    try:
        actionable_store = get_actionable_store()
        actionable_store._collection.update_one(
            {"_id": doc_id},
            {"$set": {"doc_name": new_name}}
        )
    except Exception as e:
        logger.warning("Failed to rename in actionables: %s", e)

    # 4. Update corpus store
    try:
        corpus_store = get_corpus_store()
        corpus_store._collection.update_one(
            {"_id": doc_id},
            {"$set": {"doc_name": new_name}}
        )
    except Exception as e:
        logger.warning("Failed to rename in corpus: %s", e)

    logger.info("Renamed document %s: %s -> %s", doc_id, old_name, new_name)
    return {"status": "renamed", "id": doc_id, "old_name": old_name, "new_name": new_name}


@app.post("/ingest", response_model=IngestResponse)
async def ingest_document(
    file: UploadFile = File(...),
    force: bool = Query(False),
):
    """Upload and ingest a PDF."""
    if not file.filename or not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    settings = get_settings()
    data_dir = settings.storage.trees_dir.parent
    pdfs_dir = data_dir / "pdfs"
    pdfs_dir.mkdir(parents=True, exist_ok=True)

    dest_path = pdfs_dir / file.filename

    try:
        with dest_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        file.file.close()

    pipeline = get_ingestion_pipeline()

    try:
        import time

        start_time = time.time()
        tree = pipeline.ingest(str(dest_path), force=force)
        elapsed = time.time() - start_time

        return {
            "doc_id": tree.doc_id,
            "doc_name": tree.doc_name,
            "doc_description": tree.doc_description
            if hasattr(tree, "doc_description")
            else "",
            "node_count": tree.node_count,
            "total_pages": tree.total_pages,
            "time_seconds": elapsed,
        }
    except Exception as e:
        logger.error("Ingestion failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/query", response_model=QueryResponse)
def run_query(request: QueryRequest):
    """Run a Q&A query."""
    engine = get_qa_engine()
    query_store = get_query_store()

    try:
        # 1. Retrieve
        retrieval_result = engine.retrieve(
            request.query, request.doc_id, reflect=request.reflect
        )

        # 2. Synthesize & Verify
        answer = engine.synthesize_and_verify(
            retrieval_result,
            request.query,
            verify=request.verify,
            reflect=request.reflect,
        )

        # 3. Save Record
        record = QueryRecord(
            record_id=str(uuid.uuid4()),
            query_text=request.query,
            doc_id=request.doc_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            query_type=answer.query_type,
            sub_queries=retrieval_result.query.sub_queries,
            key_terms=retrieval_result.query.key_terms,
            routing_log=answer.routing_log,
            retrieved_sections=answer.retrieved_sections,
            answer_text=answer.text,
            citations=answer.citations,
            inferred_points=answer.inferred_points,
            verification_status=answer.verification_status,
            verification_notes=answer.verification_notes,
            total_time_seconds=answer.total_time_seconds,
            total_tokens=answer.total_tokens,
            llm_calls=answer.llm_calls,
            stage_timings=answer.stage_timings,
            verify_enabled=request.verify,
            reflect_enabled=request.reflect,
        )
        query_store.save(record)

        # Phase 3: Periodic memory persistence (save after each query)
        try:
            if get_retrieval_mode() == "optimized":
                from memory.memory_manager import get_memory_manager
                mm = get_memory_manager()
                if mm._initialized:
                    mm.save_all(doc_id=request.doc_id)
        except Exception as mem_err:
            logger.warning("Memory save failed (non-fatal): %s", mem_err)

        # 4. Auto-persist conversation messages
        active_conv_id = ""
        try:
            conv_store = get_conversation_store()
            tree_store = get_tree_store()
            tree = tree_store.load(request.doc_id)
            doc_name = tree.doc_name if tree else request.doc_id
            now = datetime.now(timezone.utc).isoformat()

            # Create or reuse conversation
            if request.conv_id:
                active_conv_id = request.conv_id
            else:
                # Create a new conversation, titled after the first query
                title = request.query[:80] + ("..." if len(request.query) > 80 else "")
                conv = conv_store.create(
                    doc_id=request.doc_id,
                    doc_name=doc_name,
                    conv_type="document",
                    title=title,
                )
                active_conv_id = conv.conv_id

            user_msg = ConversationMessage(
                id=str(int(datetime.now(timezone.utc).timestamp() * 1000)),
                role="user",
                content=request.query,
                timestamp=now,
            )
            assistant_msg = ConversationMessage(
                id=str(int(datetime.now(timezone.utc).timestamp() * 1000) + 1),
                role="assistant",
                content=answer.text,
                record_id=record.record_id,
                timestamp=now,
            )
            conv_store.append_messages(
                conv_id=active_conv_id,
                messages=[user_msg, assistant_msg],
            )
        except Exception as conv_err:
            logger.warning("Failed to persist conversation: %s", conv_err)

        # Serialize all data from answer for full response
        citations_serialized = [
            {
                "citation_id": c.citation_id,
                "node_id": c.node_id,
                "title": c.title,
                "page_range": c.page_range,
                "excerpt": c.excerpt,
            }
            for c in answer.citations
        ]

        inferred_points_serialized = [
            {
                "point": ip.point,
                "supporting_definitions": ip.supporting_definitions,
                "supporting_sections": ip.supporting_sections,
                "reasoning": ip.reasoning,
                "confidence": ip.confidence,
            }
            for ip in answer.inferred_points
        ]

        retrieved_sections_serialized = [
            {
                "node_id": s.node_id,
                "title": s.title,
                "text": s.text,
                "page_range": s.page_range,
                "source": s.source,
                "token_count": s.token_count,
            }
            for s in answer.retrieved_sections
        ]

        routing_log_serialized = None
        if answer.routing_log:
            rl = answer.routing_log
            routing_log_serialized = {
                "query_text": rl.query_text,
                "query_type": rl.query_type.value
                if hasattr(rl.query_type, "value")
                else str(rl.query_type),
                "locate_results": rl.locate_results,
                "read_results": rl.read_results,
                "cross_ref_follows": rl.cross_ref_follows,
                "total_nodes_located": rl.total_nodes_located,
                "total_sections_read": rl.total_sections_read,
                "total_tokens_retrieved": rl.total_tokens_retrieved,
                "stage_timings": rl.stage_timings,
            }

        return {
            "answer": answer.text,
            "record_id": record.record_id,
            "conv_id": active_conv_id,
            "citations": citations_serialized,
            "verification_status": answer.verification_status,
            "verification_notes": answer.verification_notes,
            "inferred_points": inferred_points_serialized,
            "query_type": answer.query_type.value
            if hasattr(answer.query_type, "value")
            else str(answer.query_type),
            "sub_queries": retrieval_result.query.sub_queries,
            "key_terms": retrieval_result.query.key_terms,
            "retrieved_sections": retrieved_sections_serialized,
            "routing_log": routing_log_serialized,
            "stage_timings": answer.stage_timings,
            "total_time_seconds": answer.total_time_seconds,
            "total_tokens": answer.total_tokens,
            "llm_calls": answer.llm_calls,
        }

    except Exception as e:
        logger.error("Query failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/query/{record_id}")
def get_query_record(record_id: str):
    """Get a past query record."""
    store = get_query_store()
    record = store.load(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Query record not found")
    return record.to_dict()


@app.post("/query/{record_id}/feedback")
def submit_feedback(record_id: str, feedback: FeedbackRequest):
    """Submit feedback for a query answer."""
    store = get_query_store()
    success = store.update_feedback(
        record_id,
        feedback_text=feedback.text,
        rating=feedback.rating,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Query record not found")
    return {"status": "ok", "record_id": record_id}


@app.get("/config")
def get_config():
    """Return current system configuration."""
    settings = get_settings()
    opt = settings.optimization
    return {
        "model": settings.llm.model,
        "model_pro": settings.llm.model_pro,
        "max_located_nodes": settings.retrieval.max_located_nodes,
        "retrieval_token_budget": settings.retrieval.retrieval_token_budget,
        "max_cross_ref_depth": settings.retrieval.max_cross_ref_depth,
        "context_expansion_siblings": settings.retrieval.context_expansion_siblings,
        "retrieval_mode": get_retrieval_mode(),
        "optimization_features": {
            "enable_locator_cache": opt.enable_locator_cache,
            "enable_embedding_prefilter": opt.enable_embedding_prefilter,
            "enable_query_cache": opt.enable_query_cache,
            "enable_verification_skip": opt.enable_verification_skip,
            "enable_synthesis_prealloc": opt.enable_synthesis_prealloc,
            "enable_reflection_tuning": opt.enable_reflection_tuning,
            "enable_fast_synthesis": opt.enable_fast_synthesis,
        },
    }


# ---------------------------------------------------------------------------
# Optimization Toggle Endpoints
# ---------------------------------------------------------------------------


def _invalidate_query_caches(reason: str) -> int:
    """Invalidate query caches in QAEngine and CorpusQAEngine when settings change."""
    count = 0
    try:
        if _qa_engine and hasattr(_qa_engine, '_query_cache') and _qa_engine._query_cache:
            count += _qa_engine._query_cache.invalidate_all(reason=reason)
    except Exception as e:
        logger.warning("Failed to invalidate QAEngine query cache: %s", e)
    return count


@app.patch("/config/retrieval-mode")
def set_retrieval_mode(body: dict = Body(...)):
    """Toggle between 'legacy' and 'optimized' retrieval."""
    mode = body.get("mode", "legacy")
    if mode not in ("legacy", "optimized"):
        raise HTTPException(status_code=400, detail="mode must be 'legacy' or 'optimized'")
    _runtime_config["retrieval_mode"] = mode
    _persist_runtime_config("retrieval_mode", mode)
    # Invalidate query cache — answers generated under different pipeline logic
    invalidated = _invalidate_query_caches(reason="retrieval_mode_change")
    logger.info("Retrieval mode changed to: %s (invalidated %d cache entries)", mode, invalidated)
    return {"retrieval_mode": mode}


@app.patch("/config/optimization-features")
def set_optimization_features(body: dict = Body(...)):
    """Update individual optimization sub-feature toggles."""
    valid_keys = {
        "enable_locator_cache", "enable_embedding_prefilter", "enable_query_cache",
        "enable_verification_skip", "enable_synthesis_prealloc", "enable_reflection_tuning",
        "enable_fast_synthesis",
        # Phase 3: Self-evolving memory toggles
        "enable_raptor_index", "enable_user_memory", "enable_query_intelligence",
        "enable_retrieval_feedback", "enable_r2r_fallback",
    }
    updates = {k: v for k, v in body.items() if k in valid_keys and isinstance(v, bool)}
    for k, v in updates.items():
        _runtime_config[k] = v
        _persist_runtime_config(k, v)
    # Invalidate query cache when features change
    if updates:
        invalidated = _invalidate_query_caches(reason="feature_toggle_change")
        logger.info("Optimization features updated: %s (invalidated %d cache entries)", updates, invalidated)
    else:
        logger.info("Optimization features updated: %s", updates)
    return {"updated": updates, "retrieval_mode": get_retrieval_mode()}


@app.get("/optimization/stats")
def optimization_stats():
    """Return aggregate benchmark stats for legacy vs optimized modes."""
    store = get_benchmark_store()
    if not store:
        return {"error": "BenchmarkStore not initialized"}

    cache_stats = {}
    try:
        if _qa_engine and hasattr(_qa_engine, '_query_cache') and _qa_engine._query_cache:
            cache_stats = _qa_engine._query_cache.get_stats()
    except Exception:
        pass

    return {
        "legacy": store.aggregate_stats("legacy"),
        "optimized": store.aggregate_stats("optimized"),
        "query_cache": cache_stats,
        "retrieval_mode": get_retrieval_mode(),
    }


@app.post("/optimization/cache/invalidate")
def invalidate_cache(body: dict = Body(...)):
    """Manually invalidate query caches."""
    reason = body.get("reason", "manual")
    count = _invalidate_query_caches(reason=reason)
    return {"invalidated": count, "reason": reason}


# ---------------------------------------------------------------------------
# Memory / Self-Evolving Endpoints (Phase 3)
# ---------------------------------------------------------------------------

@app.get("/memory/stats")
def memory_stats(doc_id: str = ""):
    """Get stats from all memory subsystems."""
    try:
        from memory.memory_manager import get_memory_manager
        mm = get_memory_manager()
        if not mm._initialized:
            return {"error": "MemoryManager not initialized", "retrieval_mode": get_retrieval_mode()}
        return mm.get_stats(doc_id=doc_id or None)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/memory/raptor/build/{doc_id}")
def build_raptor_index(doc_id: str):
    """Build RAPTOR multi-resolution index for a document."""
    try:
        from memory.memory_manager import get_memory_manager
        mm = get_memory_manager()
        if not mm._initialized:
            raise HTTPException(status_code=503, detail="MemoryManager not initialized")

        tree_store = get_tree_store()
        tree = tree_store.load(doc_id)
        if not tree:
            raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")

        success = mm.build_raptor_index(tree, doc_id)
        return {"doc_id": doc_id, "success": success}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/memory/r2r/build/{doc_id}")
def build_r2r_index(doc_id: str):
    """Build R2R hybrid search fallback index for a document."""
    try:
        from memory.memory_manager import get_memory_manager
        mm = get_memory_manager()
        if not mm._initialized:
            raise HTTPException(status_code=503, detail="MemoryManager not initialized")

        tree_store = get_tree_store()
        tree = tree_store.load(doc_id)
        if not tree:
            raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")

        success = mm.build_r2r_index(tree, doc_id)
        return {"doc_id": doc_id, "success": success}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/memory/build-all/{doc_id}")
def build_all_indexes(doc_id: str):
    """Build both RAPTOR and R2R indexes for a document."""
    try:
        from memory.memory_manager import get_memory_manager
        mm = get_memory_manager()
        if not mm._initialized:
            raise HTTPException(status_code=503, detail="MemoryManager not initialized")

        tree_store = get_tree_store()
        tree = tree_store.load(doc_id)
        if not tree:
            raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")

        results = {
            "doc_id": doc_id,
            "raptor": mm.build_raptor_index(tree, doc_id),
            "r2r": mm.build_r2r_index(tree, doc_id),
        }
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/memory/save")
def save_memory(doc_id: str = ""):
    """Force-save all memory subsystems to MongoDB."""
    try:
        from memory.memory_manager import get_memory_manager
        mm = get_memory_manager()
        if not mm._initialized:
            raise HTTPException(status_code=503, detail="MemoryManager not initialized")
        mm.save_all(doc_id=doc_id or None)
        return {"saved": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Actionable Extraction Endpoints
# ---------------------------------------------------------------------------


@app.get("/documents/{doc_id}/actionables")
def get_actionables(doc_id: str):
    """Get extracted actionables for a document (if available)."""
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        return {"status": "not_extracted", "doc_id": doc_id, "actionables": []}
    return result.to_dict()


@app.post("/documents/{doc_id}/extract-actionables")
async def extract_actionables(doc_id: str, force: bool = Query(False)):
    """
    Extract compliance actionables from a document via Server-Sent Events.

    Streams progress events so the frontend can show a real-time progress bar.
    Each event is a JSON object prefixed with "data: " and terminated with two
    newlines, following the SSE spec.

    The blocking LLM calls run in a thread pool so that SSE events are flushed
    to the client in real-time rather than being buffered.

    Events:
      start, prefilter_done, batches_planned, batch_start, batch_done,
      validation_start, validation_done, complete, error

    The final "complete" event contains the full ActionablesResult.
    """
    import asyncio
    import json as _json

    # Check if already extracted (skip if not forced)
    act_store = get_actionable_store()
    if not force and act_store.exists(doc_id):
        existing = act_store.load(doc_id)
        if existing:

            async def _cached():
                payload = _json.dumps(
                    {"event": "complete", "result": existing.to_dict()}
                )
                yield f"data: {payload}\n\n"

            return StreamingResponse(
                _cached(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )

    # Load document tree
    tree_store = get_tree_store()
    tree = tree_store.load(doc_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Document not found")

    # Use an asyncio.Queue to bridge the blocking generator thread
    # with the async SSE response.
    queue: asyncio.Queue = asyncio.Queue()

    # Capture the event loop for thread-safe queue access
    loop = asyncio.get_event_loop()

    def _put_event(event):
        """Thread-safe put onto the asyncio queue."""
        loop.call_soon_threadsafe(queue.put_nowait, event)

    def _run_extraction():
        """Runs in a thread pool. Puts events onto the queue."""
        try:
            extractor = get_actionable_extractor()
            final_result = None

            for event in extractor.extract_streaming(tree):
                if event.get("event") == "complete":
                    final_result = event.get("result")
                _put_event(event)

            # Save to MongoDB after extraction is done
            if final_result:
                from models.actionable import ActionablesResult as AR

                result_obj = AR.from_dict(final_result)
                act_store.save(result_obj)

        except Exception as e:
            logger.error("Actionable extraction failed: %s", e)
            _put_event({"event": "error", "message": str(e)})
        finally:
            _put_event(None)  # Sentinel to signal end of stream

    async def _sse_stream():
        """Async generator that reads from the queue and yields SSE lines."""
        # Start the blocking extraction in a background thread
        asyncio.get_event_loop().run_in_executor(None, _run_extraction)

        while True:
            # Wait for next event (with a short timeout so we stay responsive)
            try:
                event = await asyncio.wait_for(queue.get(), timeout=300)
            except asyncio.TimeoutError:
                # Safety: if nothing happens in 5 min, send a keepalive
                yield f"data: {_json.dumps({'event': 'keepalive'})}\n\n"
                continue

            if event is None:
                # End of stream sentinel
                break

            payload = _json.dumps(event)
            yield f"data: {payload}\n\n"

    return StreamingResponse(
        _sse_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Actionable CRUD Endpoints (for the standalone Actionables page)
# ---------------------------------------------------------------------------


@app.get("/actionables")
def list_all_actionables():
    """List actionables across ALL documents."""
    store = get_actionable_store()
    db = store._collection
    results = []
    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        raw.pop("_id", None)
        raw["doc_id"] = doc_id
        results.append(raw)
    return results


@app.put("/documents/{doc_id}/actionables/{item_id}")
def update_actionable(doc_id: str, item_id: str, body: dict = Body(...)):
    """Update a single actionable item's fields (edit, approve, reject)."""
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Actionables not found for this document")

    # Find the item
    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    # Update allowed fields
    editable_fields = [
        "modality", "actor", "action", "object", "trigger_or_condition",
        "thresholds", "deadline_or_frequency", "effective_date",
        "reporting_or_notification_to", "evidence_quote", "source_location",
        "implementation_notes", "workstream", "needs_legal_review",
        "approval_status", "validation_notes",
        "published_at", "deadline", "task_status", "completion_date",
        "reviewer_comments", "evidence_files", "comments",
        "submitted_at", "team_reviewer_name",
        "team_reviewer_approved_at", "team_reviewer_rejected_at",
        "is_delayed", "delay_detected_at",
        "delay_justification", "delay_justification_by", "delay_justification_at",
        "delay_justification_status", "audit_trail",
    ]
    for field_name in editable_fields:
        if field_name in body:
            val = body[field_name]
            if field_name == "modality":
                from models.actionable import Modality
                try:
                    val = Modality(val)
                except ValueError:
                    continue
            elif field_name == "workstream":
                from models.actionable import Workstream
                try:
                    val = Workstream(val)
                except ValueError:
                    continue
            setattr(target, field_name, val)

    result.compute_stats()
    store.save(result)
    return target.to_dict()


# ---------------------------------------------------------------------------
# Evidence file upload & serving
# ---------------------------------------------------------------------------

EVIDENCE_DIR = PROJECT_ROOT / "data" / "evidence"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


@app.post("/evidence/upload")
async def upload_evidence(file: UploadFile = File(...)):
    """Upload an evidence file and return a persistent URL."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Generate unique filename to avoid collisions
    ext = Path(file.filename).suffix
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest = EVIDENCE_DIR / unique_name

    try:
        with dest.open("wb") as buf:
            shutil.copyfileobj(file.file, buf)
    finally:
        file.file.close()

    return {
        "filename": file.filename,
        "stored_name": unique_name,
        "url": f"/evidence/files/{unique_name}",
    }


@app.get("/evidence/files/{filename}")
def serve_evidence_file(filename: str):
    """Serve an uploaded evidence file."""
    file_path = EVIDENCE_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path), filename=filename)


@app.post("/documents/{doc_id}/actionables")
def create_manual_actionable(doc_id: str, body: dict = Body(...)):
    """Create a manually-added actionable for a document."""
    store = get_actionable_store()
    result = store.load(doc_id)

    if not result:
        # Create a new result container if none exists
        tree_store = get_tree_store()
        tree = tree_store.load(doc_id)
        doc_name = tree.doc_name if tree else doc_id
        from models.actionable import ActionablesResult as AR
        result = AR(doc_id=doc_id, doc_name=doc_name)

    # Generate next ID
    existing_ids = [a.id for a in result.actionables]
    max_num = 0
    for aid in existing_ids:
        try:
            num = int(aid.replace("ACT-", "").replace("MAN-", ""))
            max_num = max(max_num, num)
        except ValueError:
            pass
    new_id = f"MAN-{max_num + 1:03d}"

    from models.actionable import ActionableItem as AI, Modality, Workstream

    modality_str = body.get("modality", "Mandatory")
    try:
        modality = Modality(modality_str)
    except ValueError:
        modality = Modality.MANDATORY

    workstream_str = body.get("workstream", "Other")
    try:
        workstream = Workstream(workstream_str)
    except ValueError:
        workstream = Workstream.OTHER

    item = AI(
        id=new_id,
        modality=modality,
        actor=body.get("actor", ""),
        action=body.get("action", ""),
        object=body.get("object", ""),
        trigger_or_condition=body.get("trigger_or_condition", ""),
        thresholds=body.get("thresholds", ""),
        deadline_or_frequency=body.get("deadline_or_frequency", ""),
        effective_date=body.get("effective_date", ""),
        reporting_or_notification_to=body.get("reporting_or_notification_to", ""),
        evidence_quote=body.get("evidence_quote", ""),
        source_location=body.get("source_location", ""),
        source_node_id=body.get("source_node_id", ""),
        implementation_notes=body.get("implementation_notes", ""),
        workstream=workstream,
        needs_legal_review=body.get("needs_legal_review", False),
        validation_status="manual",
        approval_status="pending",
        is_manual=True,
    )

    result.actionables.append(item)
    result.compute_stats()
    store.save(result)
    return item.to_dict()


@app.get("/actionables/approved-by-team")
def get_approved_by_team():
    """Get all approved actionables grouped by workstream (team)."""
    store = get_actionable_store()
    db = store._collection
    teams: dict[str, list] = {}
    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        doc_name = raw.get("doc_name", doc_id)
        for a in raw.get("actionables", []):
            if a.get("approval_status") == "approved":
                a["doc_id"] = doc_id
                a["doc_name"] = doc_name
                ws = a.get("workstream", "Other")
                if ws not in teams:
                    teams[ws] = []
                teams[ws].append(a)
    return teams


@app.delete("/documents/{doc_id}/actionables/{item_id}")
def delete_actionable(doc_id: str, item_id: str):
    """Delete a single actionable item."""
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Actionables not found")
    original_len = len(result.actionables)
    result.actionables = [a for a in result.actionables if a.id != item_id]
    if len(result.actionables) == original_len:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")
    result.compute_stats()
    store.save(result)
    return {"deleted": item_id}


# ---------------------------------------------------------------------------
# Corpus (Cross-Document) Endpoints
# ---------------------------------------------------------------------------


@app.get("/corpus")
def get_corpus():
    """Return the corpus graph (all documents + relationships)."""
    store = get_corpus_store()
    corpus = store.load_or_create()
    return corpus.to_dict()


@app.get("/corpus/relationships")
def get_corpus_relationships():
    """Return all document relationships in the corpus."""
    store = get_corpus_store()
    corpus = store.load_or_create()
    return {
        "relationships": [r.to_dict() for r in corpus.relationships],
        "document_count": len(corpus.documents),
    }


@app.post("/corpus/query", response_model=CorpusQueryResponse)
def run_corpus_query(request: CorpusQueryRequest):
    """Run a cross-document Q&A query across all documents in the corpus."""
    engine = get_corpus_qa_engine()
    query_store = get_query_store()

    try:
        # 1. Retrieve across corpus
        retrieval_result = engine.retrieve(request.query)

        # 2. Synthesize & Verify
        answer = engine.synthesize_and_verify(
            retrieval_result,
            verify=request.verify,
        )

        # 3. Save Record
        record = QueryRecord(
            record_id=str(uuid.uuid4()),
            query_text=request.query,
            doc_id="corpus",  # Special marker for cross-doc queries
            timestamp=datetime.now(timezone.utc).isoformat(),
            query_type=answer.query_type,
            sub_queries=retrieval_result.sub_queries,
            key_terms=retrieval_result.key_terms,
            routing_log=None,  # Corpus uses per-doc logs instead
            retrieved_sections=answer.retrieved_sections,
            answer_text=answer.text,
            citations=answer.citations,
            inferred_points=answer.inferred_points,
            verification_status=answer.verification_status,
            verification_notes=answer.verification_notes,
            total_time_seconds=answer.total_time_seconds,
            total_tokens=answer.total_tokens,
            llm_calls=answer.llm_calls,
            stage_timings=answer.stage_timings,
            verify_enabled=request.verify,
            reflect_enabled=False,
        )
        query_store.save(record)

        # 4. Auto-persist conversation messages (research chat)
        active_conv_id = ""
        try:
            conv_store = get_conversation_store()
            now = datetime.now(timezone.utc).isoformat()

            # Create or reuse conversation
            if request.conv_id:
                active_conv_id = request.conv_id
            else:
                title = request.query[:80] + ("..." if len(request.query) > 80 else "")
                conv = conv_store.create(
                    doc_id="research",
                    doc_name="Cross-Document Research",
                    conv_type="research",
                    title=title,
                )
                active_conv_id = conv.conv_id

            user_msg = ConversationMessage(
                id=str(int(datetime.now(timezone.utc).timestamp() * 1000)),
                role="user",
                content=request.query,
                timestamp=now,
            )
            assistant_msg = ConversationMessage(
                id=str(int(datetime.now(timezone.utc).timestamp() * 1000) + 1),
                role="assistant",
                content=answer.text,
                record_id=record.record_id,
                timestamp=now,
            )
            conv_store.append_messages(
                conv_id=active_conv_id,
                messages=[user_msg, assistant_msg],
            )
        except Exception as conv_err:
            logger.warning("Failed to persist research conversation: %s", conv_err)

        # Serialize citations with doc_id/doc_name
        citations_serialized = [
            {
                "citation_id": c.citation_id,
                "node_id": c.node_id,
                "doc_id": c.doc_id,
                "doc_name": c.doc_name,
                "title": c.title,
                "page_range": c.page_range,
                "excerpt": c.excerpt,
            }
            for c in answer.citations
        ]

        inferred_points_serialized = [
            {
                "point": ip.point,
                "supporting_definitions": ip.supporting_definitions,
                "supporting_sections": ip.supporting_sections,
                "reasoning": ip.reasoning,
                "confidence": ip.confidence,
            }
            for ip in answer.inferred_points
        ]

        retrieved_sections_serialized = [
            {
                "node_id": s.node_id,
                "title": s.title,
                "text": s.text,
                "page_range": s.page_range,
                "source": s.source,
                "token_count": s.token_count,
                "doc_id": s.doc_id,
                "doc_name": s.doc_name,
            }
            for s in answer.retrieved_sections
        ]

        return {
            "answer": answer.text,
            "record_id": record.record_id,
            "conv_id": active_conv_id,
            "citations": citations_serialized,
            "verification_status": answer.verification_status,
            "verification_notes": answer.verification_notes,
            "inferred_points": inferred_points_serialized,
            "query_type": answer.query_type.value
            if hasattr(answer.query_type, "value")
            else str(answer.query_type),
            "sub_queries": retrieval_result.sub_queries,
            "key_terms": retrieval_result.key_terms,
            "retrieved_sections": retrieved_sections_serialized,
            "selected_documents": retrieval_result.selected_documents,
            "per_doc_routing_logs": retrieval_result.per_doc_routing_logs,
            "stage_timings": answer.stage_timings,
            "total_time_seconds": answer.total_time_seconds,
            "total_tokens": answer.total_tokens,
            "llm_calls": answer.llm_calls,
        }

    except Exception as e:
        logger.error("Corpus query failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Conversation Endpoints (multi-conversation model)
# ---------------------------------------------------------------------------


def _hydrate_conversation(conv) -> dict:
    """
    Hydrate a Conversation object: for each assistant message that has a
    record_id, fetch the linked QueryRecord and attach rich metadata
    (citations, inferred_points, routing_log, stats, etc.) to the message.
    """
    query_store = get_query_store()

    # Collect all record_ids we need
    record_ids = [
        m.record_id for m in conv.messages if m.role == "assistant" and m.record_id
    ]

    # Batch-load records (one DB call per record; could optimize later)
    records_map: dict[str, dict] = {}
    for rid in record_ids:
        rec = query_store.load(rid)
        if rec:
            records_map[rid] = rec.to_dict()

    # Hydrate messages
    for m in conv.messages:
        if m.role == "assistant" and m.record_id and m.record_id in records_map:
            rd = records_map[m.record_id]
            m.citations = rd.get("citations", [])
            m.inferred_points = rd.get("inferred_points", [])
            m.verification_status = rd.get("verification_status", "")
            m.verification_notes = rd.get("verification_notes", "")
            m.query_type = rd.get("query_type", "")
            m.sub_queries = rd.get("sub_queries", [])
            m.key_terms = rd.get("key_terms", [])
            m.retrieved_sections = rd.get("retrieved_sections", [])
            m.routing_log = rd.get("routing_log", None)
            m.stage_timings = rd.get("stage_timings", {})
            m.total_time_seconds = rd.get("total_time_seconds", 0.0)
            m.total_tokens = rd.get("total_tokens", 0)
            m.llm_calls = rd.get("llm_calls", 0)

    return conv.to_dict(hydrated=True)


@app.get("/conversations")
def list_conversations():
    """List all conversations (metadata only, no message bodies)."""
    store = get_conversation_store()
    return store.list_all()


@app.get("/conversations/by-doc/{doc_id}")
def list_conversations_for_doc(doc_id: str):
    """List all conversations for a specific document."""
    store = get_conversation_store()
    return store.list_by_doc(doc_id)


@app.post("/conversations")
def create_conversation(
    doc_id: str, doc_name: str = "", conv_type: str = "document", title: str = ""
):
    """Create a new empty conversation for a document."""
    store = get_conversation_store()
    conv = store.create(
        doc_id=doc_id, doc_name=doc_name, conv_type=conv_type, title=title
    )
    return conv.to_dict()


@app.get("/conversations/{conv_id}")
def get_conversation(conv_id: str):
    """Get full conversation with hydrated messages (rich metadata from QueryRecords)."""
    store = get_conversation_store()
    conv = store.load(conv_id)
    if not conv:
        return {"conv_id": conv_id, "messages": [], "message_count": 0}
    return _hydrate_conversation(conv)


@app.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: str):
    """Delete a conversation."""
    store = get_conversation_store()
    deleted = store.delete(conv_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted", "conv_id": conv_id}


@app.delete("/conversations")
def delete_all_conversations():
    """Delete all conversations."""
    store = get_conversation_store()
    count = store.delete_all()
    return {"status": "deleted", "count": count}


# ---------------------------------------------------------------------------
# Storage Stats Endpoint
# ---------------------------------------------------------------------------


@app.get("/storage/stats")
def get_storage_stats():
    """Return storage usage across all collections (for Atlas 512MB budget)."""
    db = get_tree_store()._collection.database

    collections = [
        "trees",
        "queries",
        "conversations",
        "actionables",
        "corpus",
        "fs.files",
        "fs.chunks",
    ]

    stats = {}
    total_bytes = 0
    for name in collections:
        try:
            cs = db.command("collStats", name)
            size = cs.get("storageSize", 0)
            stats[name] = {
                "docs": cs.get("count", 0),
                "size_bytes": size,
                "size_mb": round(size / 1024 / 1024, 2),
            }
            total_bytes += size
        except Exception:
            stats[name] = {"docs": 0, "size_bytes": 0, "size_mb": 0}

    return {
        "collections": stats,
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / 1024 / 1024, 2),
        "limit_mb": 512,
        "usage_percent": round((total_bytes / (512 * 1024 * 1024)) * 100, 1),
    }


# ---------------------------------------------------------------------------
# Training Data Export Endpoint
# ---------------------------------------------------------------------------


@app.get("/export/training-data")
def export_training_data():
    """
    Export all data as a single JSON download for training/evaluation.

    Includes: documents metadata, all query records (full routing + citations +
    pipeline stats + feedback), all conversations, all actionables, corpus graph.
    """
    import json as _json

    db = get_tree_store()._collection.database

    # 1. Documents metadata
    tree_store = get_tree_store()
    doc_ids = tree_store.list_trees()
    documents = []
    for doc_id in doc_ids:
        tree = tree_store.load(doc_id)
        if tree:
            documents.append(
                {
                    "doc_id": tree.doc_id,
                    "doc_name": tree.doc_name,
                    "doc_description": tree.doc_description,
                    "total_pages": tree.total_pages,
                    "node_count": tree.node_count,
                }
            )

    # 2. All query records (the big one — full routing, citations, etc.)
    query_records = []
    for raw in db["queries"].find().sort("timestamp", 1):
        raw.pop("_id", None)
        query_records.append(raw)

    # 3. All conversations
    conversations = []
    for raw in db["conversations"].find().sort("updated_at", -1):
        raw["conv_id"] = raw.pop("_id", "")
        conversations.append(raw)

    # 4. All actionables
    actionables = {}
    for raw in db["actionables"].find():
        doc_id = raw.get("doc_id", "")
        raw.pop("_id", None)
        actionables[doc_id] = raw

    # 5. Corpus
    corpus_raw = db["corpus"].find_one()
    corpus = {}
    if corpus_raw:
        corpus_raw.pop("_id", None)
        corpus = corpus_raw

    # 6. Storage stats
    total_bytes = 0
    for name in [
        "trees",
        "queries",
        "conversations",
        "actionables",
        "corpus",
        "fs.chunks",
    ]:
        try:
            cs = db.command("collStats", name)
            total_bytes += cs.get("storageSize", 0)
        except Exception:
            pass

    export = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": "govinda_v2",
        "metadata": {
            "total_documents": len(documents),
            "total_query_records": len(query_records),
            "total_conversations": len(conversations),
            "total_actionable_docs": len(actionables),
            "db_size_mb": round(total_bytes / 1024 / 1024, 2),
        },
        "documents": documents,
        "query_records": query_records,
        "conversations": conversations,
        "actionables": actionables,
        "corpus": corpus,
    }

    # Return as a downloadable JSON file
    from fastapi.responses import JSONResponse

    headers = {
        "Content-Disposition": (
            f'attachment; filename="govinda_training_data_'
            f'{datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")}.json"'
        )
    }
    return JSONResponse(content=export, headers=headers)


# ---------------------------------------------------------------------------
# Admin Dashboard API Endpoints
# ---------------------------------------------------------------------------

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin@govinda.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Govinda@2026")


class AdminLoginRequest(BaseModel):
    username: str
    password: str


@app.post("/admin/login")
def admin_login(req: AdminLoginRequest):
    """Validate admin credentials. Returns a simple token."""
    if req.username == ADMIN_USERNAME and req.password == ADMIN_PASSWORD:
        import hashlib, time
        token = hashlib.sha256(f"{ADMIN_USERNAME}:{time.time()}".encode()).hexdigest()
        return {"authenticated": True, "token": token, "username": ADMIN_USERNAME}
    raise HTTPException(status_code=401, detail="Invalid admin credentials")


@app.get("/admin/overview")
def admin_overview():
    """
    Comprehensive system overview for the admin dashboard.
    Returns documents, queries, memory, config, storage — everything at a glance.
    """
    from utils.mongo import get_db
    db = get_db()

    # 1. Document stats
    tree_store = get_tree_store()
    doc_ids = tree_store.list_trees()
    documents = []
    for doc_id in doc_ids:
        tree = tree_store.load(doc_id)
        if tree:
            documents.append({
                "doc_id": tree.doc_id,
                "doc_name": tree.doc_name,
                "doc_description": tree.doc_description,
                "total_pages": tree.total_pages,
                "node_count": tree.node_count,
            })

    # 2. Query stats
    total_queries = db["queries"].count_documents({})
    recent_queries = []
    for raw in db["queries"].find().sort("timestamp", -1).limit(50):
        raw.pop("_id", None)
        # Trim large fields for overview
        raw.pop("retrieved_sections", None)
        raw.pop("routing_log", None)
        recent_queries.append(raw)

    # Query timing histogram (last 100)
    query_timings = []
    for raw in db["queries"].find({}, {"total_time_seconds": 1, "timestamp": 1, "query_type": 1, "doc_id": 1}).sort("timestamp", -1).limit(100):
        query_timings.append({
            "time": raw.get("total_time_seconds", 0),
            "timestamp": raw.get("timestamp", ""),
            "query_type": raw.get("query_type", ""),
            "doc_id": raw.get("doc_id", ""),
        })

    # Feedback stats
    feedback_count = db["queries"].count_documents({"feedback": {"$exists": True}})
    ratings = list(db["queries"].aggregate([
        {"$match": {"feedback.rating": {"$exists": True}}},
        {"$group": {"_id": None, "avg": {"$avg": "$feedback.rating"}, "count": {"$sum": 1}}},
    ]))
    avg_rating = ratings[0]["avg"] if ratings else None
    rating_count = ratings[0]["count"] if ratings else 0

    # 3. Conversation stats
    total_conversations = db["conversations"].count_documents({})
    total_messages = 0
    for conv in db["conversations"].find({}, {"messages": 1}):
        total_messages += len(conv.get("messages", []))

    # 4. Benchmark stats
    benchmark_store = get_benchmark_store()
    benchmark_data = {}
    if benchmark_store:
        benchmark_data = {
            "legacy": benchmark_store.aggregate_stats("legacy"),
            "optimized": benchmark_store.aggregate_stats("optimized"),
        }

    # 5. Memory stats
    memory_data = {"initialized": False}
    try:
        from memory.memory_manager import get_memory_manager
        mm = get_memory_manager()
        if mm._initialized:
            memory_data = mm.get_stats()
            # Per-doc memory status
            per_doc_memory = {}
            for doc_id in doc_ids:
                try:
                    per_doc_memory[doc_id] = mm.get_stats(doc_id=doc_id)
                except Exception:
                    per_doc_memory[doc_id] = {"error": "failed"}
            memory_data["per_doc"] = per_doc_memory
    except Exception as e:
        memory_data["error"] = str(e)

    # 6. Config
    settings = get_settings()
    opt = settings.optimization
    config_data = {
        "retrieval_mode": get_retrieval_mode(),
        "model": settings.llm.model,
        "model_pro": settings.llm.model_pro,
        "optimization_features": {
            "enable_locator_cache": opt.enable_locator_cache,
            "enable_embedding_prefilter": opt.enable_embedding_prefilter,
            "enable_query_cache": opt.enable_query_cache,
            "enable_verification_skip": opt.enable_verification_skip,
            "enable_synthesis_prealloc": opt.enable_synthesis_prealloc,
            "enable_reflection_tuning": opt.enable_reflection_tuning,
            "enable_fast_synthesis": opt.enable_fast_synthesis,
            "enable_raptor_index": getattr(opt, "enable_raptor_index", False),
            "enable_user_memory": getattr(opt, "enable_user_memory", False),
            "enable_query_intelligence": getattr(opt, "enable_query_intelligence", False),
            "enable_retrieval_feedback": getattr(opt, "enable_retrieval_feedback", False),
            "enable_r2r_fallback": getattr(opt, "enable_r2r_fallback", False),
        },
    }

    # 7. Storage stats
    storage_collections = [
        "trees", "queries", "conversations", "actionables", "corpus",
        "fs.files", "fs.chunks", "benchmarks",
        "raptor_indexes", "raptor_embeddings",
        "user_memory", "query_intelligence", "query_intelligence_embeddings",
        "retrieval_feedback", "r2r_index", "r2r_term_freq", "r2r_embeddings",
        "runtime_config",
    ]
    storage = {}
    total_bytes = 0
    for name in storage_collections:
        try:
            cs = db.command("collStats", name)
            size = cs.get("storageSize", 0)
            storage[name] = {
                "docs": cs.get("count", 0),
                "size_bytes": size,
                "size_mb": round(size / 1024 / 1024, 2),
            }
            total_bytes += size
        except Exception:
            storage[name] = {"docs": 0, "size_bytes": 0, "size_mb": 0}

    # 8. Actionable stats
    total_actionable_docs = db["actionables"].count_documents({})
    total_actionable_items = 0
    actionable_by_status = {"pending": 0, "approved": 0, "rejected": 0}
    for raw in db["actionables"].find({}, {"actionables": 1}):
        items = raw.get("actionables", [])
        total_actionable_items += len(items)
        for item in items:
            status = item.get("approval_status", "pending")
            actionable_by_status[status] = actionable_by_status.get(status, 0) + 1

    # 9. Cache stats
    cache_stats = {}
    try:
        if _qa_engine and hasattr(_qa_engine, '_query_cache') and _qa_engine._query_cache:
            cache_stats = _qa_engine._query_cache.get_stats()
    except Exception:
        pass

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "documents": {
            "total": len(documents),
            "list": documents,
        },
        "queries": {
            "total": total_queries,
            "recent": recent_queries,
            "timings": query_timings,
            "feedback": {
                "total_with_feedback": feedback_count,
                "avg_rating": avg_rating,
                "rating_count": rating_count,
            },
        },
        "conversations": {
            "total": total_conversations,
            "total_messages": total_messages,
        },
        "benchmarks": benchmark_data,
        "memory": memory_data,
        "config": config_data,
        "storage": {
            "collections": storage,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / 1024 / 1024, 2),
            "limit_mb": 512,
            "usage_percent": round((total_bytes / (512 * 1024 * 1024)) * 100, 1),
        },
        "actionables": {
            "total_docs": total_actionable_docs,
            "total_items": total_actionable_items,
            "by_status": actionable_by_status,
        },
        "cache": cache_stats,
    }


@app.get("/admin/queries")
def admin_queries(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    doc_id: str = Query(""),
    sort_by: str = Query("timestamp"),
    sort_order: int = Query(-1),
):
    """Paginated query log with full details for admin inspection."""
    from utils.mongo import get_db
    db = get_db()

    query_filter = {}
    if doc_id:
        query_filter["doc_id"] = doc_id

    total = db["queries"].count_documents(query_filter)
    cursor = db["queries"].find(query_filter).sort(sort_by, sort_order).skip(skip).limit(limit)
    records = []
    for raw in cursor:
        raw.pop("_id", None)
        records.append(raw)

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "records": records,
    }


@app.get("/admin/query/{record_id}/full")
def admin_query_full(record_id: str):
    """Get complete query record with all routing details for admin."""
    store = get_query_store()
    record = store.load(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Query record not found")
    return record.to_dict()


@app.get("/admin/benchmarks")
def admin_benchmarks(last_n: int = Query(100, ge=1, le=1000)):
    """Detailed benchmark comparison data."""
    store = get_benchmark_store()
    if not store:
        return {"error": "BenchmarkStore not initialized"}

    from utils.mongo import get_db
    db = get_db()

    # Raw benchmark records
    raw_records = []
    for raw in db["benchmarks"].find().sort("timestamp", -1).limit(last_n):
        raw.pop("_id", None)
        raw_records.append(raw)

    return {
        "legacy": store.aggregate_stats("legacy", last_n=last_n),
        "optimized": store.aggregate_stats("optimized", last_n=last_n),
        "records": raw_records,
        "retrieval_mode": get_retrieval_mode(),
    }


@app.get("/admin/memory/detailed")
def admin_memory_detailed():
    """Detailed memory subsystem data for admin dashboard."""
    try:
        from memory.memory_manager import get_memory_manager
        from utils.mongo import get_db
        mm = get_memory_manager()
        if not mm._initialized:
            return {"initialized": False, "error": "MemoryManager not initialized"}

        db = get_db()
        result = mm.get_stats()

        # Collection-level stats for all memory tables
        memory_collections = {
            "raptor_indexes": "RAPTOR Indexes",
            "raptor_embeddings": "RAPTOR Embeddings",
            "user_memory": "User Memory",
            "query_intelligence": "Query Intelligence",
            "query_intelligence_embeddings": "QI Embeddings",
            "retrieval_feedback": "Retrieval Feedback",
            "r2r_index": "R2R Index",
            "r2r_term_freq": "R2R Term Frequencies",
            "r2r_embeddings": "R2R Embeddings",
        }
        collection_stats = {}
        for coll_name, label in memory_collections.items():
            try:
                cs = db.command("collStats", coll_name)
                collection_stats[coll_name] = {
                    "label": label,
                    "docs": cs.get("count", 0),
                    "size_bytes": cs.get("storageSize", 0),
                    "size_mb": round(cs.get("storageSize", 0) / 1024 / 1024, 2),
                }
            except Exception:
                collection_stats[coll_name] = {
                    "label": label,
                    "docs": 0,
                    "size_bytes": 0,
                    "size_mb": 0,
                }

        # Feature toggle status
        settings = get_settings()
        opt = settings.optimization
        toggles = {
            "raptor_index": getattr(opt, "enable_raptor_index", False),
            "user_memory": getattr(opt, "enable_user_memory", False),
            "query_intelligence": getattr(opt, "enable_query_intelligence", False),
            "retrieval_feedback": getattr(opt, "enable_retrieval_feedback", False),
            "r2r_fallback": getattr(opt, "enable_r2r_fallback", False),
        }

        result["collection_stats"] = collection_stats
        result["toggles"] = toggles
        return result
    except Exception as e:
        return {"initialized": False, "error": str(e)}


@app.get("/admin/system/logs")
def admin_system_logs(lines: int = Query(200, ge=1, le=2000)):
    """Return recent application log entries (from memory buffer if available)."""
    # Try reading from log handlers
    log_entries = []
    root = logging.getLogger()
    for handler in root.handlers:
        if hasattr(handler, 'baseFilename'):
            try:
                with open(handler.baseFilename, 'r') as f:
                    all_lines = f.readlines()
                    log_entries = [l.strip() for l in all_lines[-lines:]]
            except Exception:
                pass

    # If no file handler, return a notice
    if not log_entries:
        log_entries = ["Logs are printed to stdout. Check process output for full logs."]

    return {
        "total_lines": len(log_entries),
        "entries": log_entries,
    }


@app.get("/admin/runtime-config")
def admin_runtime_config():
    """Return all runtime config keys (persisted toggles, mode, etc.)."""
    return {
        "config": _runtime_config,
        "persisted": _load_persisted_runtime_config(),
    }


# ---------------------------------------------------------------------------
# Delay Monitoring Endpoints
# ---------------------------------------------------------------------------


@app.post("/actionables/check-delays")
def check_delays():
    """
    Scan all actionables and mark those past deadline as delayed.
    Adds audit trail entries for newly detected delays.
    Called periodically or on-demand.
    """
    store = get_actionable_store()
    db = store._collection
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    updated_count = 0

    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        result = store.load(doc_id)
        if not result:
            continue
        changed = False
        for a in result.actionables:
            if a.deadline and a.task_status not in ("completed", "") and not a.is_delayed:
                try:
                    dl = datetime.fromisoformat(a.deadline.replace("Z", "+00:00"))
                    if now > dl:
                        a.is_delayed = True
                        a.delay_detected_at = now_iso
                        a.audit_trail.append({
                            "event": "delay_detected",
                            "actor": "system",
                            "role": "system",
                            "timestamp": now_iso,
                            "details": f"Task missed deadline {a.deadline}",
                        })
                        changed = True
                        updated_count += 1
                except (ValueError, TypeError):
                    pass
        if changed:
            result.compute_stats()
            store.save(result)

    return {"checked_at": now_iso, "newly_delayed": updated_count}


@app.get("/actionables/delayed")
def get_delayed_actionables(team: str = Query("")):
    """Get all delayed actionables, optionally filtered by team (workstream)."""
    store = get_actionable_store()
    db = store._collection
    delayed = []
    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        doc_name = raw.get("doc_name", doc_id)
        for a in raw.get("actionables", []):
            if a.get("is_delayed"):
                if team and a.get("workstream", "") != team:
                    continue
                a["doc_id"] = doc_id
                a["doc_name"] = doc_name
                delayed.append(a)
    return delayed


class DelayJustificationRequest(BaseModel):
    justification: str
    justifier_name: str


@app.post("/documents/{doc_id}/actionables/{item_id}/delay-justification")
def submit_delay_justification(doc_id: str, item_id: str, body: DelayJustificationRequest):
    """
    Team Lead submits a delay justification for a delayed task.
    Does not change task status — purely governance/accountability.
    """
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Actionables not found for this document")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    if not target.is_delayed:
        raise HTTPException(status_code=400, detail="Task is not delayed")

    now_iso = datetime.now(timezone.utc).isoformat()
    target.delay_justification = body.justification
    target.delay_justification_by = body.justifier_name
    target.delay_justification_at = now_iso
    target.delay_justification_status = "pending_review"
    target.audit_trail.append({
        "event": "delay_justification_submitted",
        "actor": body.justifier_name,
        "role": "team_lead",
        "timestamp": now_iso,
        "details": f"Justification pending CO review: {body.justification}",
    })

    # If the task was gated at awaiting_justification, move it to review
    if target.task_status == "awaiting_justification":
        target.task_status = "review"
        target.audit_trail.append({
            "event": "status_change",
            "actor": body.justifier_name,
            "role": "team_lead",
            "timestamp": now_iso,
            "details": "Delay justified — task released to Compliance review",
        })

    result.compute_stats()
    store.save(result)
    return target.to_dict()


@app.get("/documents/{doc_id}/actionables/{item_id}/audit-trail")
def get_audit_trail(doc_id: str, item_id: str):
    """Get full audit trail for a single actionable."""
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Actionables not found for this document")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    return {"item_id": item_id, "doc_id": doc_id, "audit_trail": target.audit_trail}


# ---------------------------------------------------------------------------
# Team Chat Endpoints
# ---------------------------------------------------------------------------


class TeamChatMessageRequest(BaseModel):
    author: str
    role: str
    text: str


@app.get("/team-chat/{team}/{channel}")
def get_team_chat(team: str, channel: str):
    """
    Get messages for a team chat channel.
    channel: "internal" (team only) or "compliance" (team + CO).
    """
    if channel not in ("internal", "compliance"):
        raise HTTPException(status_code=400, detail="Channel must be 'internal' or 'compliance'")

    from utils.mongo import get_db
    db = get_db()
    doc = db["team_chats"].find_one({"team": team, "channel": channel})
    messages = doc.get("messages", []) if doc else []
    return {"team": team, "channel": channel, "messages": messages}


@app.post("/team-chat/{team}/{channel}")
def post_team_chat_message(team: str, channel: str, body: TeamChatMessageRequest):
    """
    Post a message to a team chat channel.
    internal: team_member, team_reviewer, team_lead can post.
    compliance: team_member, team_reviewer, team_lead, compliance_officer can post.
    """
    if channel not in ("internal", "compliance"):
        raise HTTPException(status_code=400, detail="Channel must be 'internal' or 'compliance'")

    internal_roles = ("team_member", "team_reviewer", "team_lead")
    compliance_roles = ("team_member", "team_reviewer", "team_lead", "compliance_officer")
    allowed = compliance_roles if channel == "compliance" else internal_roles

    if body.role not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{body.role}' cannot post to '{channel}' channel"
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": str(uuid.uuid4()),
        "author": body.author,
        "role": body.role,
        "text": body.text,
        "timestamp": now_iso,
    }

    from utils.mongo import get_db
    db = get_db()
    db["team_chats"].update_one(
        {"team": team, "channel": channel},
        {"$push": {"messages": msg}, "$setOnInsert": {"team": team, "channel": channel}},
        upsert=True,
    )
    return msg


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
