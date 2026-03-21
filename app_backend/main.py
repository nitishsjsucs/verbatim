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


def _generate_actionable_id() -> str:
    """Return a globally unique human-readable actionable ID, e.g. ACT-20260304-0001.

    Uses a MongoDB atomic counter (find_one_and_update + $inc) so the sequence
    is correct even under concurrent requests or across multiple doc extractions.
    Falls back to a UUID-based ID if the DB is unavailable.
    """
    try:
        from utils.mongo import get_db
        db = get_db()
        result = db["counters"].find_one_and_update(
            {"_id": "actionable_id"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True,  # pymongo.ReturnDocument.AFTER equivalent
        )
        seq = result.get("seq", 1)
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"ACT-{date_str}-{seq:04d}"
    except Exception as e:
        logger.warning("actionable_id counter failed, using UUID fallback: %s", e)
        import uuid as _uuid
        return f"ACT-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{str(_uuid.uuid4())[:8].upper()}"


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
    memory_indexes: dict = {}


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

        # Auto-build RAPTOR + R2R memory indexes in optimized mode
        memory_build = {}
        if get_retrieval_mode() == "optimized":
            try:
                from memory.memory_manager import get_memory_manager
                mm = get_memory_manager()
                if mm._initialized:
                    raptor_ok = mm.build_raptor_index(tree, tree.doc_id)
                    r2r_ok = mm.build_r2r_index(tree, tree.doc_id)
                    memory_build = {"raptor_built": raptor_ok, "r2r_built": r2r_ok}
                    logger.info(
                        "Auto-built memory indexes for %s: raptor=%s r2r=%s",
                        tree.doc_id, raptor_ok, r2r_ok,
                    )
            except Exception as mem_err:
                logger.warning("Memory index auto-build failed (non-fatal): %s", mem_err)
                memory_build = {"error": str(mem_err)}

        return {
            "doc_id": tree.doc_id,
            "doc_name": tree.doc_name,
            "doc_description": tree.doc_description
            if hasattr(tree, "doc_description")
            else "",
            "node_count": tree.node_count,
            "total_pages": tree.total_pages,
            "time_seconds": elapsed,
            "memory_indexes": memory_build,
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
# Regulator List
# ---------------------------------------------------------------------------

REGULATORS = [
    "Reserve Bank of India (RBI)",
    "Securities and Exchange Board of India (SEBI)",
    "Insurance Regulatory and Development Authority of India (IRDAI)",
    "Pension Fund Regulatory and Development Authority (PFRDA)",
    "Competition Commission of India (CCI)",
    "Insolvency and Bankruptcy Board of India (IBBI)",
    "National Financial Reporting Authority (NFRA)",
    "National Bank for Agriculture and Rural Development (NABARD)",
    "Small Industries Development Bank of India (SIDBI)",
    "Export-Import Bank of India (EXIM Bank)",
    "International Financial Services Centres Authority (IFSCA)",
    "Forward Markets Commission (FMC – merged with SEBI)",
]


@app.get("/regulators")
def list_regulators():
    """Return the list of available regulators."""
    return {"regulators": REGULATORS}


# ---------------------------------------------------------------------------
# Document Metadata (regulation dates + regulator)
# ---------------------------------------------------------------------------


@app.put("/documents/{doc_id}/metadata")
def update_document_metadata(doc_id: str, body: dict = Body(...)):
    """Update document-level metadata: regulation_issue_date, circular_effective_date, regulator.
    Also propagates these fields to all actionables in the document."""
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    allowed = ["regulation_issue_date", "circular_effective_date", "regulator"]
    for field_name in allowed:
        if field_name in body:
            setattr(result, field_name, body[field_name])
            # Propagate to all actionables in this document
            for a in result.actionables:
                setattr(a, field_name, body[field_name])

    # Global theme (document-level, not propagated to actionables — inheritance is frontend)
    if "global_theme" in body:
        result.global_theme = body["global_theme"]

    store.save(result)
    return {
        "doc_id": result.doc_id,
        "regulation_issue_date": result.regulation_issue_date,
        "circular_effective_date": result.circular_effective_date,
        "regulator": result.regulator,
        "global_theme": result.global_theme,
    }


# ---------------------------------------------------------------------------
# Tagged Incorrectly — Bypass Flow
# ---------------------------------------------------------------------------


@app.post("/documents/{doc_id}/actionables/{item_id}/bypass-tag")
def tag_incorrectly(doc_id: str, item_id: str, body: dict = Body(...)):
    """Team member tags an actionable as incorrectly assigned.
    Sets bypass_tag=True, changes task_status to 'tagged_incorrectly',
    and routes to Checker (team_review)."""
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    target.bypass_tag = True
    target.bypass_tagged_at = datetime.now(timezone.utc).isoformat()
    target.bypass_tagged_by = body.get("tagged_by", "")
    target.task_status = "tagged_incorrectly"

    # Add audit trail entry
    trail_entry = {
        "event": "tagged_incorrectly",
        "actor": body.get("tagged_by", ""),
        "role": "team_member",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "details": "Team member tagged this actionable as incorrectly assigned",
    }
    if not isinstance(target.audit_trail, list):
        target.audit_trail = []
    target.audit_trail.append(trail_entry)

    store.save(result)
    return target.to_dict()


@app.post("/documents/{doc_id}/actionables/{item_id}/bypass-approve")
def approve_bypass(doc_id: str, item_id: str, body: dict = Body(...)):
    """Checker approves the bypass tag, sending the actionable back to CO for reassignment."""
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    if not target.bypass_tag:
        raise HTTPException(status_code=400, detail="Item was not tagged as incorrectly assigned")

    target.bypass_approved_by = body.get("approved_by", "")
    target.bypass_approved_at = datetime.now(timezone.utc).isoformat()
    target.task_status = "bypass_approved"

    trail_entry = {
        "event": "bypass_approved",
        "actor": body.get("approved_by", ""),
        "role": "team_reviewer",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "details": "Checker approved the bypass tag — sent back to Compliance Officer for reassignment",
    }
    if not isinstance(target.audit_trail, list):
        target.audit_trail = []
    target.audit_trail.append(trail_entry)

    store.save(result)
    return target.to_dict()


@app.post("/documents/{doc_id}/actionables/{item_id}/reset-team")
def reset_team(doc_id: str, item_id: str, body: dict = Body(...)):
    """Compliance Officer resets the team assignment for a bypassed actionable.
    Clears bypass fields and allows reassignment."""
    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    # Reset bypass fields
    target.bypass_tag = False
    target.bypass_tagged_at = ""
    target.bypass_tagged_by = ""
    target.bypass_approved_by = ""
    target.bypass_approved_at = ""
    # Reset task status back to assigned
    target.task_status = "assigned"
    # Update workstream if new_team provided
    new_team = body.get("new_team", "")
    if new_team:
        target.workstream = new_team
        # Reset assigned_teams if it was single-team
        if not target.is_multi_team:
            target.assigned_teams = [new_team]

    trail_entry = {
        "event": "team_reset",
        "actor": body.get("reset_by", ""),
        "role": "compliance_officer",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "details": f"Team reassigned to '{new_team}'" if new_team else "Team assignment reset",
    }
    if not isinstance(target.audit_trail, list):
        target.audit_trail = []
    target.audit_trail.append(trail_entry)

    store.save(result)
    return target.to_dict()


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
                from utils.cache import get_cache_manager

                result_obj = AR.from_dict(final_result)
                # Stamp created_at and actionable_id on any actionable that doesn't have one
                _now = datetime.now(timezone.utc).isoformat()
                for _a in result_obj.actionables:
                    if not _a.created_at:
                        _a.created_at = _now
                    if not _a.actionable_id:
                        _a.actionable_id = _generate_actionable_id()
                act_store.save(result_obj)
                
                # Invalidate cache after extraction
                cache_mgr = get_cache_manager()
                cache_mgr.delete_pattern("actionables:list:*")
                cache_mgr.delete_pattern("actionables:approved*")
                logger.debug(f"Invalidated actionables cache after extraction of {doc_id}")

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
def list_all_actionables(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    team: str = Query(""),
    status: str = Query(""),
    doc_id: str = Query(""),
):
    """
    List actionables across ALL documents with pagination and filtering.
    
    Query Parameters:
      - page: Page number (1-indexed, default 1)
      - limit: Items per page (1-500, default 50)
      - team: Filter by assigned team (optional)
      - status: Filter by task_status (optional, e.g. 'pending', 'completed')
      - doc_id: Filter by document ID (optional)
    
    Returns paginated results with total count and page info.
    """
    from utils.cache import get_cache_manager
    
    cache_mgr = get_cache_manager()
    cache_key = f"actionables:list:{page}:{limit}:{team}:{status}:{doc_id}"
    
    # Try to get from cache
    cached = cache_mgr.get(cache_key)
    if cached is not None:
        logger.debug(f"Returning cached actionables list: {cache_key}")
        return cached
    
    store = get_actionable_store()
    db = store._collection
    
    # Build MongoDB query filter
    query_filter = {}
    if doc_id:
        query_filter["_id"] = doc_id
    
    # Get all docs matching the doc_id filter (if any)
    all_docs = list(db.find(query_filter))
    
    # Flatten actionables from all docs and apply team/status filters
    all_actionables = []
    for raw in all_docs:
        doc_id_from_raw = raw.get("doc_id", raw.get("_id", ""))
        doc_name_from_raw = raw.get("doc_name", doc_id_from_raw)
        actionables = raw.get("actionables", [])
        
        for item_data in actionables:
            try:
                from models.actionable import ActionableItem
                item = ActionableItem.from_dict(item_data)
                item_dict = item.to_dict()
                item_dict["doc_id"] = doc_id_from_raw
                item_dict["doc_name"] = doc_name_from_raw
                
                # Apply team filter
                if team:
                    assigned_teams = item.assigned_teams or []
                    if team not in assigned_teams:
                        continue
                
                # Apply status filter
                if status and item.task_status != status:
                    continue
                
                all_actionables.append(item_dict)
            except Exception as e:
                logger.warning(f"Failed to serialize actionable {item_data.get('id', 'unknown')}: {e}")
                all_actionables.append(item_data)
    
    # Pagination
    total = len(all_actionables)
    offset = (page - 1) * limit
    paginated = all_actionables[offset : offset + limit]
    
    result = {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
        "actionables": paginated,
    }
    
    # Cache results for 5 minutes
    cache_mgr.set(cache_key, result, ttl_seconds=300)
    
    return result


# Risk fields that only team_member / team_reviewer / team_lead / admin can write.
# compliance_officer is READ-ONLY for these (per spec §11A).
# NOTE: impact_dropdown is NOT in this set — compliance CAN set/confirm impact.
RISK_MEMBER_ONLY_FIELDS = {
    "likelihood_business_volume", "likelihood_products_processes", "likelihood_compliance_violations",
    "control_monitoring", "control_effectiveness",
}


@app.put("/documents/{doc_id}/actionables/{item_id}")
def update_actionable(doc_id: str, item_id: str, body: dict = Body(...), for_team: str = Query(""), caller_role: str = Query("")):
    """Update a single actionable item's fields (edit, approve, reject).

    If for_team is supplied and the item is multi-team (assigned_teams > 1),
    team-specific workflow fields are written into team_workflows[for_team]
    instead of the top-level fields, and the aggregate status is recomputed.

    caller_role: role of the user making the request. compliance_officer is
    blocked from writing risk assessment fields (Likelihood / Impact / Control).
    """
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

    # Fields that belong to per-team workflow (routed to team_workflows when multi-team)
    from models.actionable import ActionableItem as _AI
    team_workflow_fields = set(_AI.TEAM_WORKFLOW_FIELDS)

    # Check if this is a team-specific update on a multi-team item
    is_team_update = for_team and target.is_multi_team and for_team in target.assigned_teams

    # Strip risk fields if caller is compliance_officer (read-only for CO)
    if caller_role == "compliance_officer":
        for blocked in RISK_MEMBER_ONLY_FIELDS:
            body.pop(blocked, None)

    # Validate CO comment before approval
    if caller_role == "compliance_officer":
        new_status = body.get("task_status")
        # Check if CO is trying to approve (change to completed or move to next status)
        if new_status == "completed" or (is_team_update and new_status == "completed"):
            co_comment = body.get("co_comment", "").strip() if isinstance(body.get("co_comment"), str) else ""
            if not co_comment:
                raise HTTPException(status_code=400, detail="CO Comment is required before approval. Please fill the CO Comment field.")

    # Publish validation: Theme, Tranche 3, Impact must be present before approval/publish
    publish_intent = body.get("approval_status") == "approved" or body.get("published_at")
    if publish_intent:
        next_theme = body.get("theme", target.theme or "")
        next_tranche3 = body.get("tranche3", target.tranche3 or "")
        next_impact = body.get("impact_dropdown") or target.impact_dropdown
        impact_label = ""
        if isinstance(next_impact, dict):
            impact_label = (next_impact.get("label") or "").strip()
        elif isinstance(next_impact, str):
            impact_label = next_impact.strip()
        if not next_theme or not next_tranche3 or not impact_label:
            raise HTTPException(status_code=400, detail="Cannot publish without Theme, Tranche 3, and Impact Assessment.")

    # Update allowed fields
    editable_fields = [
        "actor", "action", "object", "trigger_or_condition",
        "thresholds", "deadline_or_frequency", "effective_date",
        "reporting_or_notification_to", "evidence_quote", "source_location",
        "implementation_notes", "workstream", "needs_legal_review",
        "approval_status", "validation_notes",
        "published_at", "deadline", "task_status", "completion_date",
        "reviewer_comments", "rejection_reason", "evidence_files", "comments",
        "submitted_at", "team_reviewer_name",
        "team_reviewer_approved_at", "team_reviewer_rejected_at",
        "is_delayed", "delay_detected_at",
        "justification", "justification_by", "justification_at",
        "justification_status",
        # 4-stage delay justification approval chain
        "justification_member_text", "justification_member_at", "justification_member_by",
        "justification_reviewer_approved", "justification_reviewer_comment",
        "justification_reviewer_by", "justification_reviewer_at",
        "justification_lead_approved", "justification_lead_comment",
        "justification_lead_by", "justification_lead_at",
        "justification_co_approved", "justification_co_comment",
        "justification_co_by", "justification_co_at",
        # Legacy justification fields (backward compat)
        "justification_reviewer_text", "justification_lead_approved_at",
        "justification_compliance_comment", "justification_compliance_approved_at",
        # Role-specific mandatory comment fields
        "member_comment", "member_comment_history", "reviewer_comment", "lead_comment", "co_comment",
        # Shared delay justification workflow
        "delay_justification", "delay_justification_member_submitted",
        "delay_justification_reviewer_approved", "delay_justification_lead_approved",
        "delay_justification_updated_by", "delay_justification_updated_at",
        "audit_trail",
        "assigned_teams", "team_workflows",
        # Document metadata (inherited from parent doc)
        "regulation_issue_date", "circular_effective_date", "regulator",
        # Unique actionable display ID
        "actionable_id",
        # Risk assessment dropdowns (legacy flat fields kept for compat)
        "impact", "tranche3", "control", "likelihood", "residual_risk", "inherent_risk",
        # Structured risk scoring
        "likelihood_business_volume", "likelihood_products_processes", "likelihood_compliance_violations",
        "likelihood_score",
        "impact_dropdown",
        "impact_score",
        "control_monitoring", "control_effectiveness",
        "control_score",
        "inherent_risk_score", "inherent_risk_label",
        "residual_risk_score", "residual_risk_label",
        "residual_risk_interpretation",
        # Spec-compliant overall score aliases
        "overall_likelihood_score", "overall_impact_score", "overall_control_score",
        # Legacy impact sub-fields (backward compat)
        "impact_sub1", "impact_sub2", "impact_sub3",
        # Theme dropdown
        "theme",
        # Tagged Incorrectly bypass flow
        "bypass_tag", "bypass_tagged_at", "bypass_tagged_by",
        "bypass_approved_by", "bypass_approved_at",
        "bypass_disapproved_by", "bypass_disapproved_at", "bypass_disapproval_reason",
        "bypass_reviewer_rejected_by", "bypass_reviewer_rejected_at", "bypass_reviewer_rejection_reason",
        # Tracker isolation & delegation (Feature 2 & 3)
        "published_by_account_id", "delegated_from_account_id", "delegation_request_id",
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
                # Accept any string — teams are now dynamic (database-driven)
                val = str(val) if val else "Technology"

            # Route team-specific fields to team_workflows when multi-team
            if is_team_update and field_name in team_workflow_fields:
                if for_team not in target.team_workflows:
                    target.team_workflows[for_team] = {}
                target.team_workflows[for_team][field_name] = val
            else:
                setattr(target, field_name, val)

    # If assigned_teams was just set, initialize team_workflows for new teams
    if "assigned_teams" in body:
        target.init_team_workflows()

    # ── Recompute risk scores whenever sub-dropdowns change ──
    _recompute_risk_scores(target)

    # Recompute aggregate status for multi-team items
    if target.is_multi_team:
        target.compute_aggregate_status()

    result.compute_stats()
    store.save(result)
    
    # Invalidate actionables cache on update
    from utils.cache import get_cache_manager
    cache_mgr = get_cache_manager()
    cache_mgr.delete_pattern("actionables:list:*")
    cache_mgr.delete_pattern("actionables:approved*")
    logger.debug(f"Invalidated actionables cache after update to {item_id}")
    
    return target.to_dict()


def _safe_score(d: dict | None) -> float:
    """Extract numeric score from a sub-dropdown dict, defaulting to 0."""
    if not d or not isinstance(d, dict):
        return 0
    v = d.get("score", 0)
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


def _recompute_risk_scores(target) -> None:
    """Recompute all derived risk scores from sub-dropdown selections.

    OVERALL LIKELIHOOD SCORE = MAX(businessVolume, productProcess, complianceViolation)
    OVERALL IMPACT SCORE     = (selectedImpactScore)²
    INHERENT RISK SCORE      = overallLikelihoodScore × overallImpactScore
    OVERALL CONTROL SCORE    = (monitoringMechanism + controlEffectiveness) / 2
    OVERALL RESIDUAL SCORE   = inherentRiskScore × overallControlScore

    The residual_risk_label is resolved via the admin-configurable
    residual_risk_matrix collection. If no matrix match, falls back to
    a simple threshold classification.
    """
    # Likelihood = MAX of 3 independent sub-dropdown scores
    bv = _safe_score(target.likelihood_business_volume)
    pp = _safe_score(target.likelihood_products_processes)
    cv = _safe_score(target.likelihood_compliance_violations)
    ls = max(bv, pp, cv)
    target.likelihood_score = ls
    target.overall_likelihood_score = int(ls)

    # Impact = (single dropdown score)²
    raw_impact = _safe_score(target.impact_dropdown)
    ims = raw_impact ** 2
    target.impact_score = ims
    target.overall_impact_score = int(ims)

    # Inherent risk = likelihood × impact
    ir = ls * ims
    target.inherent_risk_score = ir
    target.inherent_risk_label = _classify_inherent_risk(ir)

    # Control = average of 2 sub-dropdown scores
    mon = _safe_score(target.control_monitoring)
    eff = _safe_score(target.control_effectiveness)
    cs = (mon + eff) / 2 if (mon or eff) else 0
    target.control_score = cs
    target.overall_control_score = cs

    # Residual risk = inherent × control
    rr = ir * cs
    target.residual_risk_score = rr
    target.residual_risk_label = _resolve_residual_risk_label(rr)
    target.residual_risk_interpretation = _interpret_residual_risk(rr)


def _classify_inherent_risk(score: int) -> str:
    """Simple threshold-based inherent risk label."""
    if score <= 0:
        return ""
    if score <= 3:
        return "Low"
    if score <= 6:
        return "Medium"
    return "High"


def _resolve_residual_risk_label(residual_score: float) -> str:
    """Look up residual risk label from the admin-configurable interpretation matrix.
    Falls back to simple threshold if no matrix entry matches."""
    try:
        from utils.mongo import get_db
        db = get_db()
        matrix = db["residual_risk_matrix"]
        # Find the range entry that contains this score
        entry = matrix.find_one({
            "min_score": {"$lte": residual_score},
            "max_score": {"$gte": residual_score},
        })
        if entry and entry.get("label"):
            return entry["label"]
    except Exception:
        pass
    # Fallback: simple threshold
    if residual_score <= 0:
        return ""
    if residual_score <= 3:
        return "Low"
    if residual_score <= 9:
        return "Medium"
    return "High"


def _interpret_residual_risk(residual_score: float) -> str:
    """Map residual risk score to a human-readable interpretation per spec §10.

    1 ≤ score < 13  → "Satisfactory (Low)"
    13 ≤ score < 28 → "Improvement Needed (Medium)"
    28 ≤ score < 81 → "Weak (High)"
    """
    if residual_score < 1:
        return ""
    if residual_score < 13:
        return "Satisfactory (Low)"
    if residual_score < 28:
        return "Improvement Needed (Medium)"
    return "Weak (High)"


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


@app.delete("/evidence/files/{filename}")
def delete_evidence_file(filename: str):
    """Delete an uploaded evidence file from disk."""
    sanitized = Path(filename).name
    file_path = EVIDENCE_DIR / sanitized
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    file_path.unlink()
    return {"detail": "deleted"}


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

    from models.actionable import ActionableItem as AI, Modality

    modality_str = body.get("modality", "Mandatory")
    try:
        modality = Modality(modality_str)
    except ValueError:
        modality = Modality.MANDATORY

    # Accept any workstream string — teams are now dynamic (database-driven)
    workstream_str = str(body.get("workstream", "Technology"))

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
        workstream=workstream_str,
        needs_legal_review=body.get("needs_legal_review", False),
        validation_status="manual",
        approval_status="pending",
        is_manual=True,
        created_at=datetime.now(timezone.utc).isoformat(),
        actionable_id=_generate_actionable_id(),
        # Risk assessment fields
        theme=body.get("theme", ""),
        tranche3=body.get("tranche3", ""),
        impact_dropdown=body.get("impact_dropdown"),
        overall_impact_score=body.get("overall_impact_score"),
        # Circular metadata
        regulation_issue_date=body.get("regulation_issue_date", ""),
        circular_effective_date=body.get("circular_effective_date", ""),
        regulator=body.get("regulator", ""),
        # Multi-team support
        assigned_teams=body.get("assigned_teams", []),
        team_workflows=body.get("team_workflows", {}),
    )

    # If assigned_teams was provided, initialize team_workflows for any missing teams
    if item.assigned_teams:
        item.init_team_workflows()
        # Merge in any provided team_workflows data
        if body.get("team_workflows"):
            for team, workflow_data in body.get("team_workflows", {}).items():
                if team in item.team_workflows:
                    item.team_workflows[team].update(workflow_data)

    result.actionables.append(item)
    result.compute_stats()
    store.save(result)
    
    # Invalidate actionables cache on create
    from utils.cache import get_cache_manager
    cache_mgr = get_cache_manager()
    cache_mgr.delete_pattern("actionables:list:*")
    cache_mgr.delete_pattern("actionables:approved*")
    logger.debug(f"Invalidated actionables cache after creating {new_id}")
    
    return item.to_dict()


@app.get("/documents/{doc_id}/actionables/csv-template")
def get_csv_template(doc_id: str):
    """Return a CSV template for bulk-uploading actionables to a document."""
    import csv
    import io

    headers = [
        "action", "actor", "object", "trigger_or_condition", "thresholds",
        "deadline_or_frequency", "effective_date", "reporting_or_notification_to",
        "evidence_quote", "source_location", "implementation_notes",
        "workstream", "theme",
    ]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    # Write one example row
    writer.writerow([
        "Example: Submit quarterly report",
        "Compliance Team",
        "Quarterly compliance report",
        "At end of each quarter",
        "",
        "Within 15 days of quarter end",
        "",
        "Board of Directors",
        "As per Section 4.2 of the circular",
        "p. 3, Section 4",
        "Generate report from system and submit via portal",
        "Technology",
        "",
    ])

    content = buf.getvalue()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="actionables_template_{doc_id}.csv"'},
    )


@app.post("/documents/{doc_id}/actionables/bulk")
def bulk_create_actionables(doc_id: str, items: list = Body(...)):
    """Bulk-create actionables for a document from a list of dicts (parsed CSV rows)."""
    store = get_actionable_store()
    result = store.load(doc_id)

    if not result:
        tree_store = get_tree_store()
        tree = tree_store.load(doc_id)
        doc_name = tree.doc_name if tree else doc_id
        from models.actionable import ActionablesResult as AR
        result = AR(doc_id=doc_id, doc_name=doc_name)

    from models.actionable import ActionableItem as AI, Modality

    created = []
    existing_ids = [a.id for a in result.actionables]
    max_num = 0
    for aid in existing_ids:
        try:
            num = int(aid.replace("ACT-", "").replace("MAN-", ""))
            max_num = max(max_num, num)
        except ValueError:
            pass

    for row in items:
        if not row.get("action"):
            continue  # skip rows without action text
        max_num += 1
        new_id = f"MAN-{max_num:03d}"

        modality_str = row.get("modality", "Mandatory")
        try:
            modality = Modality(modality_str)
        except ValueError:
            modality = Modality.MANDATORY

        workstream_str = str(row.get("workstream", "Other"))

        item = AI(
            id=new_id,
            modality=modality,
            actor=row.get("actor", ""),
            action=row.get("action", ""),
            object=row.get("object", ""),
            trigger_or_condition=row.get("trigger_or_condition", ""),
            thresholds=row.get("thresholds", ""),
            deadline_or_frequency=row.get("deadline_or_frequency", ""),
            effective_date=row.get("effective_date", ""),
            reporting_or_notification_to=row.get("reporting_or_notification_to", ""),
            evidence_quote=row.get("evidence_quote", ""),
            source_location=row.get("source_location", ""),
            implementation_notes=row.get("implementation_notes", ""),
            workstream=workstream_str,
            theme=row.get("theme", ""),
            validation_status="manual",
            approval_status="pending",
            is_manual=True,
            created_at=datetime.now(timezone.utc).isoformat(),
            actionable_id=_generate_actionable_id(),
        )
        result.actionables.append(item)
        created.append(item.to_dict())

    result.compute_stats()
    store.save(result)
    
    # Invalidate actionables cache on bulk create
    from utils.cache import get_cache_manager
    cache_mgr = get_cache_manager()
    cache_mgr.delete_pattern("actionables:list:*")
    cache_mgr.delete_pattern("actionables:approved*")
    logger.debug(f"Invalidated actionables cache after bulk create ({len(created)} items)")
    
    return {"created": len(created), "items": created}


@app.get("/actionables/approved-by-team")
def get_approved_by_team():
    """Get all approved actionables grouped by workstream (team).
    Multi-team actionables appear in each assigned team's list."""
    from models.actionable import ActionableItem
    store = get_actionable_store()
    db = store._collection
    teams: dict[str, list] = {}
    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        doc_name = raw.get("doc_name", doc_id)
        for a in raw.get("actionables", []):
            if a.get("approval_status") == "approved":
                # Serialize through from_dict/to_dict for consistent field structure
                try:
                    serialized = ActionableItem.from_dict(a).to_dict()
                except Exception:
                    serialized = a
                serialized["doc_id"] = doc_id
                serialized["doc_name"] = doc_name
                assigned = serialized.get("assigned_teams", [])
                target_teams = assigned if len(assigned) > 0 else [serialized.get("workstream", "Technology")]
                for ws in target_teams:
                    if ws not in teams:
                        teams[ws] = []
                    teams[ws].append(serialized)
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
    
    # Invalidate actionables cache on delete
    from utils.cache import get_cache_manager
    cache_mgr = get_cache_manager()
    cache_mgr.delete_pattern("actionables:list:*")
    cache_mgr.delete_pattern("actionables:approved*")
    logger.debug(f"Invalidated actionables cache after delete of {item_id}")
    
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
            # Check top-level deadline
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
                        # Also mark delay in per-team workflows
                        if a.is_multi_team:
                            for t_name, tw in a.team_workflows.items():
                                if tw.get("task_status", "") not in ("completed", "review", "") and not tw.get("is_delayed"):
                                    tw["is_delayed"] = True
                                    tw["delay_detected_at"] = now_iso
                        changed = True
                        updated_count += 1
                except (ValueError, TypeError):
                    pass
            # Check per-team deadlines for multi-team items
            if a.is_multi_team and isinstance(a.team_workflows, dict):
                for t_name, tw in a.team_workflows.items():
                    team_dl = tw.get("deadline", "")
                    if team_dl and tw.get("task_status", "") not in ("completed", "review", "") and not tw.get("is_delayed"):
                        try:
                            tdl = datetime.fromisoformat(team_dl.replace("Z", "+00:00"))
                            if now > tdl:
                                tw["is_delayed"] = True
                                tw["delay_detected_at"] = now_iso
                                a.audit_trail.append({
                                    "event": "delay_detected",
                                    "actor": "system",
                                    "role": "system",
                                    "timestamp": now_iso,
                                    "details": f"Team '{t_name}' missed deadline {team_dl}",
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
    """Get all delayed actionables, optionally filtered by team.
    Multi-team items match if team is in assigned_teams."""
    store = get_actionable_store()
    db = store._collection
    delayed = []
    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        doc_name = raw.get("doc_name", doc_id)
        for a in raw.get("actionables", []):
            if a.get("is_delayed"):
                assigned = a.get("assigned_teams", [])
                if team:
                    # Match if workstream matches OR team is in assigned_teams
                    if a.get("workstream", "") != team and team not in assigned:
                        continue
                a["doc_id"] = doc_id
                a["doc_name"] = doc_name
                delayed.append(a)
    return delayed


class JustificationRequest(BaseModel):
    justification: str
    justifier_name: str


@app.post("/documents/{doc_id}/actionables/{item_id}/justification")
def submit_justification(doc_id: str, item_id: str, body: JustificationRequest, for_team: str = Query("")):
    """
    Team Lead submits a justification for a delayed task.
    If for_team is provided on a multi-team item, the justification is
    stored in team_workflows[for_team].
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

    # Consider delayed if: explicit flag set, deadline passed, or gated at awaiting_justification
    deadline_passed = False
    if target.deadline:
        try:
            deadline_passed = datetime.fromisoformat(target.deadline.replace("Z", "+00:00")) < datetime.now(timezone.utc)
        except (ValueError, TypeError):
            pass
    is_effectively_delayed = (
        target.is_delayed
        or deadline_passed
        or target.task_status == "awaiting_justification"
    )
    if not is_effectively_delayed:
        raise HTTPException(status_code=400, detail="Task is not delayed")

    now_iso = datetime.now(timezone.utc).isoformat()

    # Determine where to write the justification (top-level vs team_workflows)
    is_team_justification = for_team and target.is_multi_team and for_team in target.assigned_teams

    if is_team_justification:
        tw = target.team_workflows.get(for_team, {})
        tw["justification"] = body.justification
        tw["justification_by"] = body.justifier_name
        tw["justification_at"] = now_iso
        tw["justification_status"] = "pending_review"
        target.team_workflows[for_team] = tw
        # If the per-team status was awaiting_justification, move to review
        if tw.get("task_status") == "awaiting_justification":
            tw["task_status"] = "review"
    else:
        target.justification = body.justification
        target.justification_by = body.justifier_name
        target.justification_at = now_iso
        target.justification_status = "pending_review"

    target.audit_trail.append({
        "event": "justification_submitted",
        "actor": body.justifier_name,
        "role": "team_lead",
        "timestamp": now_iso,
        "details": f"Justification pending CO review: {body.justification}" + (f" (team: {for_team})" if is_team_justification else ""),
    })

    # If the task was gated at awaiting_justification (single-team), move it to review
    if not is_team_justification and target.task_status == "awaiting_justification":
        target.task_status = "review"
        target.audit_trail.append({
            "event": "status_change",
            "actor": body.justifier_name,
            "role": "team_lead",
            "timestamp": now_iso,
            "details": "Delay justified — task released to Compliance review",
        })

    # Recompute aggregate status for multi-team items
    if target.is_multi_team:
        target.compute_aggregate_status()

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


# ---------------------------------------------------------------------------
# Standalone Global Chat System (independent from team-chat / actionable comments)
# ---------------------------------------------------------------------------

CHAT_COLLECTION = "global_chats"

# Channel naming convention:
#   "team_internal:{team}"        — team internal (exec/reviewer/lead only)
#   "team_compliance:{team}"      — team ↔ compliance
#   "compliance_internal"         — compliance officers only


class GlobalChatPostRequest(BaseModel):
    author: str
    role: str
    team: str = ""
    text: str


def _chat_channel_allowed(channel: str, role: str, team: str) -> bool:
    """Strict role-based permission check for a chat channel (hierarchy-aware)."""
    if channel == "compliance_internal":
        return role in ("compliance_officer", "admin")

    # Get the team referenced in the channel
    ch_team = ""
    if channel.startswith("team_internal:"):
        ch_team = channel.split(":", 1)[1]
    elif channel.startswith("team_compliance:"):
        ch_team = channel.split(":", 1)[1]
    else:
        return False

    if role in ("compliance_officer", "admin"):
        return channel.startswith("team_compliance:")

    if role not in ("team_member", "team_reviewer", "team_lead"):
        return False

    # Allow access if ch_team is the user's team or a descendant of it
    if ch_team == team:
        return True
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]
    descendants = [d["name"] for d in col.find({"path": team}, {"name": 1})]
    return ch_team in descendants


@app.get("/chat/channels")
def list_chat_channels(role: str = Query(...), team: str = Query("")):
    """
    Return the list of channels visible to this role+team, along with
    per-channel unread counts (messages after a stored read cursor).
    """
    from utils.mongo import get_db
    db = get_db()

    channels: list[dict] = []

    if role in ("compliance_officer", "admin"):
        # 1. Compliance internal
        channels.append({
            "channel": "compliance_internal",
            "label": "Internal Compliance Chat",
            "type": "compliance_internal",
        })
        # 2. One entry per team for team↔compliance (dynamic from DB)
        all_teams = [t["name"] for t in db["teams"].find({"is_system": {"$ne": True}}, {"name": 1})]
        for t in all_teams:
            channels.append({
                "channel": f"team_compliance:{t}",
                "label": f"{t}",
                "type": "team_compliance",
            })
    else:
        # Team roles see their own channels + descendant team channels
        if team:
            # Own team channels
            channels.append({
                "channel": f"team_internal:{team}",
                "label": f"{team} Internal",
                "type": "team_internal",
            })
            channels.append({
                "channel": f"team_compliance:{team}",
                "label": f"{team} ↔ Compliance",
                "type": "team_compliance",
            })
            # Descendant team channels (hierarchy-aware)
            col = db["teams"]
            desc_names = [d["name"] for d in col.find({"path": team}, {"name": 1})]
            for dt in desc_names:
                channels.append({
                    "channel": f"team_internal:{dt}",
                    "label": f"{dt} Internal",
                    "type": "team_internal",
                })
                channels.append({
                    "channel": f"team_compliance:{dt}",
                    "label": f"{dt} ↔ Compliance",
                    "type": "team_compliance",
                })

    # Compute unread counts
    read_cursors = db["chat_read_cursors"].find_one(
        {"role": role, "team": team}
    ) or {}
    cursors = read_cursors.get("cursors", {})

    # Fetch custom channel names
    custom_names = {}
    name_docs = db["chat_channel_names"].find()
    for doc in name_docs:
        custom_names[doc["channel"]] = doc["custom_name"]

    for ch in channels:
        cid = ch["channel"]
        # Use custom name if available
        if cid in custom_names:
            ch["label"] = custom_names[cid]
            ch["has_custom_name"] = True
        else:
            ch["has_custom_name"] = False
        
        last_read = cursors.get(cid, "")
        doc = db[CHAT_COLLECTION].find_one({"channel": cid})
        msgs = doc.get("messages", []) if doc else []
        if last_read:
            unread = sum(1 for m in msgs if m.get("timestamp", "") > last_read)
        else:
            unread = len(msgs)
        ch["unread"] = unread

    return {"channels": channels}


@app.get("/chat/messages/{channel:path}")
def get_chat_messages(channel: str, role: str = Query(...), team: str = Query("")):
    """Return all messages for a given channel (with role check)."""
    if not _chat_channel_allowed(channel, role, team):
        raise HTTPException(status_code=403, detail="Access denied to this channel")

    from utils.mongo import get_db
    db = get_db()
    doc = db[CHAT_COLLECTION].find_one({"channel": channel})
    messages = doc.get("messages", []) if doc else []
    return {"channel": channel, "messages": messages}


@app.post("/chat/messages/{channel:path}")
def post_chat_message(channel: str, body: GlobalChatPostRequest):
    """Post a message to a chat channel (with role check)."""
    if not _chat_channel_allowed(channel, body.role, body.team):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{body.role}' (team '{body.team}') cannot post to '{channel}'"
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": str(uuid.uuid4()),
        "author": body.author,
        "role": body.role,
        "team": body.team,
        "text": body.text,
        "timestamp": now_iso,
    }

    from utils.mongo import get_db
    db = get_db()
    db[CHAT_COLLECTION].update_one(
        {"channel": channel},
        {"$push": {"messages": msg}, "$setOnInsert": {"channel": channel}},
        upsert=True,
    )
    return msg


@app.post("/chat/mark-read/{channel:path}")
def mark_chat_read(channel: str, role: str = Query(...), team: str = Query("")):
    """Mark a channel as fully read for this user context."""
    if not _chat_channel_allowed(channel, role, team):
        raise HTTPException(status_code=403, detail="Access denied")

    now_iso = datetime.now(timezone.utc).isoformat()
    from utils.mongo import get_db
    db = get_db()
    db["chat_read_cursors"].update_one(
        {"role": role, "team": team},
        {"$set": {f"cursors.{channel.replace('.', '_')}": now_iso}},
        upsert=True,
    )
    return {"ok": True}


@app.get("/chat/unread-total")
def get_chat_unread_total(role: str = Query(...), team: str = Query("")):
    """Return total unread count across all visible channels for badge display."""
    from utils.mongo import get_db
    db = get_db()

    visible_channels: list[str] = []
    if role in ("compliance_officer", "admin"):
        visible_channels.append("compliance_internal")
        for t in [t["name"] for t in db["teams"].find({"is_system": {"$ne": True}}, {"name": 1})]:
            visible_channels.append(f"team_compliance:{t}")
    else:
        if team:
            visible_channels.append(f"team_internal:{team}")
            visible_channels.append(f"team_compliance:{team}")
            # Include descendant team channels (hierarchy-aware)
            col = db["teams"]
            desc_names = [d["name"] for d in col.find({"path": team}, {"name": 1})]
            for dt in desc_names:
                visible_channels.append(f"team_internal:{dt}")
                visible_channels.append(f"team_compliance:{dt}")

    read_cursors = db["chat_read_cursors"].find_one({"role": role, "team": team}) or {}
    cursors = read_cursors.get("cursors", {})

    total = 0
    for cid in visible_channels:
        last_read = cursors.get(cid, "")
        doc = db[CHAT_COLLECTION].find_one({"channel": cid})
        msgs = doc.get("messages", []) if doc else []
        if last_read:
            total += sum(1 for m in msgs if m.get("timestamp", "") > last_read)
        else:
            total += len(msgs)

    return {"unread": total}


class RenameChatChannelRequest(BaseModel):
    custom_name: str


@app.post("/chat/rename/{channel:path}")
def rename_chat_channel(channel: str, body: RenameChatChannelRequest, role: str = Query(...), team: str = Query("")):
    """Allow team_lead to rename their team's chat channels."""
    # Only team_lead can rename channels
    if role != "team_lead":
        raise HTTPException(status_code=403, detail="Only Team Leads can rename channels")
    
    # Verify permission to rename this channel
    if not _chat_channel_allowed(channel, role, team):
        raise HTTPException(status_code=403, detail="Access denied to this channel")
    
    # Only allow renaming team_internal and team_compliance channels
    if not (channel.startswith("team_internal:") or channel.startswith("team_compliance:")):
        raise HTTPException(status_code=400, detail="Cannot rename this channel type")
    
    from utils.mongo import get_db
    db = get_db()
    
    # Store custom name in chat_channel_names collection
    db["chat_channel_names"].update_one(
        {"channel": channel},
        {"$set": {"custom_name": body.custom_name, "renamed_by": role, "team": team}},
        upsert=True,
    )
    
    return {"ok": True, "channel": channel, "custom_name": body.custom_name}


# ---------------------------------------------------------------------------
# Dynamic Teams Management API
# ---------------------------------------------------------------------------

SYSTEM_TEAM = "Mixed Team"

# Color palette for auto-assigning to new teams
_TEAM_COLOR_PALETTE = [
    {"bg": "bg-cyan-500/10",    "text": "text-cyan-400",    "header": "bg-cyan-500"},
    {"bg": "bg-rose-500/10",    "text": "text-rose-400",    "header": "bg-rose-500"},
    {"bg": "bg-emerald-500/10", "text": "text-emerald-400", "header": "bg-emerald-500"},
    {"bg": "bg-amber-500/10",   "text": "text-amber-400",   "header": "bg-amber-500"},
    {"bg": "bg-blue-500/10",    "text": "text-blue-400",    "header": "bg-blue-500"},
    {"bg": "bg-pink-500/10",    "text": "text-pink-400",    "header": "bg-pink-500"},
    {"bg": "bg-lime-500/10",    "text": "text-lime-400",    "header": "bg-lime-500"},
    {"bg": "bg-indigo-500/10",  "text": "text-indigo-400",  "header": "bg-indigo-500"},
    {"bg": "bg-orange-500/10",  "text": "text-orange-400",  "header": "bg-orange-500"},
    {"bg": "bg-teal-500/10",    "text": "text-teal-400",    "header": "bg-teal-500"},
    {"bg": "bg-fuchsia-500/10", "text": "text-fuchsia-400", "header": "bg-fuchsia-500"},
    {"bg": "bg-sky-500/10",     "text": "text-sky-400",     "header": "bg-sky-500"},
    {"bg": "bg-red-500/10",     "text": "text-red-400",     "header": "bg-red-500"},
    {"bg": "bg-violet-500/10",  "text": "text-violet-400",  "header": "bg-violet-500"},
    {"bg": "bg-yellow-500/10",  "text": "text-yellow-400",  "header": "bg-yellow-500"},
]

MIXED_TEAM_COLORS = {"bg": "bg-purple-500/10", "text": "text-purple-400", "header": "bg-purple-500"}
OTHER_TEAM_COLORS = {"bg": "bg-zinc-500/10", "text": "text-zinc-400", "header": "bg-zinc-500"}


def _color_key_to_classes(color_key: str) -> dict:
    """Convert a Tailwind color key (e.g. 'cyan', 'blue') to full class dict."""
    key = color_key.strip().lower()
    return {
        "bg": f"bg-{key}-500/10",
        "text": f"text-{key}-400",
        "header": f"bg-{key}-500",
    }


def _ensure_system_team():
    """Ensure the Mixed Team system team always exists with correct purple color."""
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]
    # Rename legacy "Mixed Team Projects" → "Mixed Team" if it still exists
    old = col.find_one({"name": "Mixed Team Projects"})
    if old:
        col.update_one({"name": "Mixed Team Projects"}, {"$set": {"name": SYSTEM_TEAM}})
        logger.info("Renamed system team: Mixed Team Projects → %s", SYSTEM_TEAM)
    existing = col.find_one({"name": SYSTEM_TEAM})
    hierarchy_fields = {"parent_name": None, "depth": 0, "path": []}
    if not existing:
        col.insert_one({
            "name": SYSTEM_TEAM,
            "is_system": True,
            "colors": MIXED_TEAM_COLORS,
            "summary": "System-generated classification for actionables assigned to multiple teams.",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "order": -1,  # Always first
            **hierarchy_fields,
        })
        logger.info("Seeded system team: %s", SYSTEM_TEAM)
    else:
        # Force purple color, ensure summary and hierarchy fields exist
        patch = {
            "colors": MIXED_TEAM_COLORS,
            "summary": existing.get("summary") or "System-generated classification for actionables assigned to multiple teams.",
        }
        for hk, hv in hierarchy_fields.items():
            if hk not in existing:
                patch[hk] = hv
        col.update_one({"name": SYSTEM_TEAM}, {"$set": patch})

    # ── Migrate legacy teams: add hierarchy fields if missing ──
    for team in col.find({"parent_name": {"$exists": False}}):
        col.update_one({"_id": team["_id"]}, {"$set": {"parent_name": None, "depth": 0, "path": []}})


def _get_descendants(col, team_name: str) -> list:
    """Return list of all descendant team names (recursive children)."""
    descendants = []
    children = list(col.find({"parent_name": team_name}, {"name": 1}))
    for child in children:
        descendants.append(child["name"])
        descendants.extend(_get_descendants(col, child["name"]))
    return descendants


def _get_ancestors(col, team_name: str) -> list:
    """Return list of ancestor team names from immediate parent up to root."""
    ancestors = []
    current = col.find_one({"name": team_name})
    while current and current.get("parent_name"):
        ancestors.append(current["parent_name"])
        current = col.find_one({"name": current["parent_name"]})
    return ancestors


def _is_leaf_team(col, team_name: str) -> bool:
    """Return True if team has no children."""
    return col.count_documents({"parent_name": team_name}) == 0


def _build_team_tree(teams_list: list) -> list:
    """Build nested tree from flat team list. Returns root-level nodes with children."""
    by_name = {t["name"]: {**t, "children": []} for t in teams_list}
    roots = []
    for t in teams_list:
        node = by_name[t["name"]]
        parent = t.get("parent_name")
        if parent and parent in by_name:
            by_name[parent]["children"].append(node)
        else:
            roots.append(node)
    return roots


# Ensure system team on startup
@app.on_event("startup")
async def ensure_teams():
    _ensure_system_team()


@app.get("/teams")
def list_teams():
    """Return all teams ordered by 'order' field. System teams first.
    Each team includes: parent_name, depth, path, is_leaf."""
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]
    teams = list(col.find({}, {"_id": 0}).sort("order", 1))
    # Annotate each team with is_leaf
    child_parents = set(t.get("parent_name") for t in teams if t.get("parent_name"))
    for t in teams:
        t["is_leaf"] = t["name"] not in child_parents
    return {"teams": teams}


@app.get("/teams/tree")
def list_teams_tree():
    """Return teams as a nested tree structure."""
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]
    teams = list(col.find({}, {"_id": 0}).sort("order", 1))
    child_parents = set(t.get("parent_name") for t in teams if t.get("parent_name"))
    for t in teams:
        t["is_leaf"] = t["name"] not in child_parents
    tree = _build_team_tree(teams)
    return {"tree": tree}


@app.get("/teams/{team_name}/descendants")
def get_team_descendants(team_name: str):
    """Return all descendant team names for a given team."""
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]
    existing = col.find_one({"name": team_name})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Team '{team_name}' not found")
    descendants = _get_descendants(col, team_name)
    return {"team": team_name, "descendants": descendants}


class CreateTeamRequest(BaseModel):
    name: str
    color: Optional[str] = None  # Tailwind color key e.g. "cyan", "blue", "pink"
    summary: str = ""
    parent_name: Optional[str] = None  # None = root-level team


@app.post("/teams")
def create_team(body: CreateTeamRequest):
    """Admin creates a new team. Cannot create system teams or duplicates.
    Supports hierarchy via parent_name."""
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name cannot be empty")
    if name == SYSTEM_TEAM:
        raise HTTPException(status_code=400, detail="Cannot create system team")

    existing = col.find_one({"name": name})
    if existing:
        raise HTTPException(status_code=409, detail=f"Team '{name}' already exists")

    # Resolve parent hierarchy
    parent_name = body.parent_name.strip() if body.parent_name else None
    depth = 0
    path = []
    if parent_name:
        parent_doc = col.find_one({"name": parent_name})
        if not parent_doc:
            raise HTTPException(status_code=400, detail=f"Parent team '{parent_name}' not found")
        depth = (parent_doc.get("depth") or 0) + 1
        path = (parent_doc.get("path") or []) + [parent_name]

    # Use user-selected color or inherit from parent or auto-assign from palette
    if body.color:
        colors = _color_key_to_classes(body.color)
    elif parent_name:
        parent_doc = col.find_one({"name": parent_name})
        colors = parent_doc.get("colors") if parent_doc else None
        if not colors:
            count = col.count_documents({"is_system": {"$ne": True}})
            colors = _TEAM_COLOR_PALETTE[count % len(_TEAM_COLOR_PALETTE)]
    else:
        count = col.count_documents({"is_system": {"$ne": True}})
        color_index = count % len(_TEAM_COLOR_PALETTE)
        colors = _TEAM_COLOR_PALETTE[color_index]

    count = col.count_documents({"is_system": {"$ne": True}})
    team_doc = {
        "name": name,
        "is_system": False,
        "colors": colors,
        "summary": body.summary.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "order": count + 1,
        "parent_name": parent_name,
        "depth": depth,
        "path": path,
    }
    col.insert_one(team_doc)
    team_doc.pop("_id", None)
    # Annotate is_leaf
    team_doc["is_leaf"] = True  # Newly created team has no children
    return team_doc


@app.delete("/teams/{team_name}")
def delete_team(team_name: str):
    """Admin deletes a team and all its descendants. Cannot delete system teams."""
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]

    existing = col.find_one({"name": team_name})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Team '{team_name}' not found")
    if existing.get("is_system"):
        raise HTTPException(status_code=403, detail="Cannot delete system team")

    # Collect all teams to delete (this team + all descendants)
    teams_to_delete = [team_name] + _get_descendants(col, team_name)

    reassigned_count = 0
    for tname in teams_to_delete:
        # ── Cascade: clean up actionables referencing this team ──
        reassigned_count += _cascade_team_delete(db, tname)

        col.delete_one({"name": tname})

        # Clean up user records — reassign users on this team to empty string
        auth_db_name = "govinda_auth"
        try:
            auth_db = db.client[auth_db_name]
            auth_db["user"].update_many({"team": tname}, {"$set": {"team": ""}})
        except Exception:
            pass

        # Clean up chat collections
        for chat_col_name in ["team_chats", "global_chats"]:
            try:
                db[chat_col_name].delete_many({"team": tname})
            except Exception:
                pass

    return {"deleted": teams_to_delete, "actionables_reassigned": reassigned_count}


def _cascade_team_delete(db, team_name: str) -> int:
    """Remove a deleted team from actionables. Returns count of affected items."""
    store = get_actionable_store()
    act_col = store._collection
    reassigned = 0

    for raw in act_col.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        result = store.load(doc_id)
        if not result:
            continue
        changed = False
        for a in result.actionables:
            ws = a.workstream.value if hasattr(a.workstream, "value") else str(a.workstream)

            # Single-team item with this workstream → reassign to "Technology"
            if ws == team_name and not a.is_multi_team:
                a.workstream = "Technology"
                changed = True
                reassigned += 1

            # Remove from assigned_teams
            if team_name in (a.assigned_teams or []):
                a.assigned_teams = [t for t in a.assigned_teams if t != team_name]
                changed = True
                reassigned += 1

                # If only one team left, collapse to single-team
                if len(a.assigned_teams) == 1:
                    surviving = a.assigned_teams[0]
                    a.workstream = surviving
                    # Merge surviving team workflow back to top-level
                    tw = a.team_workflows.get(surviving, {})
                    for k, v in tw.items():
                        if hasattr(a, k) and v:
                            setattr(a, k, v)
                    a.team_workflows = {}
                    a.assigned_teams = []
                elif len(a.assigned_teams) == 0:
                    a.workstream = "Technology"
                    a.team_workflows = {}
                    a.assigned_teams = []

            # Remove team_workflows entry
            if isinstance(a.team_workflows, dict) and team_name in a.team_workflows:
                del a.team_workflows[team_name]
                changed = True

            # Recompute aggregate status if still multi-team
            if a.is_multi_team:
                a.compute_aggregate_status()

        if changed:
            store.save(result)

    return reassigned


class UpdateTeamRequest(BaseModel):
    name: Optional[str] = None
    colors: Optional[dict] = None
    color: Optional[str] = None  # Tailwind color key shorthand
    order: Optional[int] = None
    summary: Optional[str] = None
    parent_name: Optional[str] = "__UNSET__"  # Sentinel: distinguish "not provided" from "set to null (root)"


@app.put("/teams/{team_name}")
def update_team(team_name: str, body: UpdateTeamRequest):
    """Admin updates a team. Cannot modify system teams. Supports re-parenting."""
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]

    existing = col.find_one({"name": team_name})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Team '{team_name}' not found")
    if existing.get("is_system"):
        raise HTTPException(status_code=403, detail="Cannot modify system team")

    updates = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.color is not None:
        updates["colors"] = _color_key_to_classes(body.color)
    elif body.colors is not None:
        updates["colors"] = body.colors
    if body.order is not None:
        updates["order"] = body.order
    if body.summary is not None:
        updates["summary"] = body.summary.strip()

    # Handle re-parenting
    if body.parent_name != "__UNSET__":
        new_parent = body.parent_name.strip() if body.parent_name else None
        if new_parent:
            if new_parent == team_name:
                raise HTTPException(status_code=400, detail="Team cannot be its own parent")
            descendants = _get_descendants(col, team_name)
            if new_parent in descendants:
                raise HTTPException(status_code=400, detail="Cannot set a descendant as parent (circular)")
            parent_doc = col.find_one({"name": new_parent})
            if not parent_doc:
                raise HTTPException(status_code=400, detail=f"Parent team '{new_parent}' not found")
            updates["parent_name"] = new_parent
            updates["depth"] = (parent_doc.get("depth") or 0) + 1
            updates["path"] = (parent_doc.get("path") or []) + [new_parent]
        else:
            updates["parent_name"] = None
            updates["depth"] = 0
            updates["path"] = []

    if updates:
        col.update_one({"name": team_name}, {"$set": updates})

    # If depth/path changed, update all descendants recursively
    if "depth" in updates or "path" in updates:
        final_name = updates.get("name", team_name)
        _recompute_descendant_paths(col, final_name)

    # ── Cascade name change to actionables, users, and chats ──
    new_name = updates.get("name")
    if new_name and new_name != team_name:
        _cascade_team_rename(db, team_name, new_name)
        # Also update parent_name references in children
        col.update_many({"parent_name": team_name}, {"$set": {"parent_name": new_name}})
        # Update path arrays in descendants
        col.update_many(
            {"path": team_name},
            [{"$set": {"path": {"$map": {"input": "$path", "as": "p", "in": {"$cond": [{"$eq": ["$$p", team_name]}, new_name, "$$p"]}}}}}]
        )

    final_name = updates.get("name", team_name)
    updated = col.find_one({"name": final_name}, {"_id": 0})
    if updated:
        updated["is_leaf"] = _is_leaf_team(col, final_name)
    return updated


def _recompute_descendant_paths(col, parent_name: str):
    """After re-parenting, recompute depth and path for all descendants."""
    parent = col.find_one({"name": parent_name})
    if not parent:
        return
    parent_depth = parent.get("depth", 0)
    parent_path = parent.get("path", [])
    children = list(col.find({"parent_name": parent_name}))
    for child in children:
        new_depth = parent_depth + 1
        new_path = parent_path + [parent_name]
        col.update_one({"name": child["name"]}, {"$set": {"depth": new_depth, "path": new_path}})
        _recompute_descendant_paths(col, child["name"])


def _cascade_team_rename(db, old_name: str, new_name: str):
    """Propagate a team rename across actionables, users, and chat collections."""
    store = get_actionable_store()
    act_col = store._collection

    for raw in act_col.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        result = store.load(doc_id)
        if not result:
            continue
        changed = False
        for a in result.actionables:
            # Rename workstream
            ws = a.workstream.value if hasattr(a.workstream, "value") else str(a.workstream)
            if ws == old_name:
                a.workstream = new_name
                changed = True
            # Rename in assigned_teams
            if old_name in (a.assigned_teams or []):
                a.assigned_teams = [new_name if t == old_name else t for t in a.assigned_teams]
                changed = True
            # Rename team_workflows key
            if isinstance(a.team_workflows, dict) and old_name in a.team_workflows:
                a.team_workflows[new_name] = a.team_workflows.pop(old_name)
                changed = True
        if changed:
            store.save(result)

    # Rename in user records
    auth_db_name = "govinda_auth"
    try:
        auth_db = db.client[auth_db_name]
        auth_db["user"].update_many({"team": old_name}, {"$set": {"team": new_name}})
    except Exception:
        pass

    # Rename chat collections
    for chat_col_name in ["team_chats", "global_chats"]:
        try:
            db[chat_col_name].update_many({"team": old_name}, {"$set": {"team": new_name}})
        except Exception:
            pass


@app.post("/teams/seed-defaults")
def seed_default_teams():
    """Seed hierarchical default teams. Idempotent — skips existing teams.
    Creates parent departments with sub-teams for a realistic hierarchy."""
    from utils.mongo import get_db
    db = get_db()
    col = db["teams"]

    # (name, colors, summary, parent_name)
    # Parent teams (depth 0)
    hierarchy = [
        # ── Root departments ──
        ("Policy", {"bg": "bg-purple-500/10", "text": "text-purple-400", "header": "bg-purple-500"}, "Policy and regulatory framework", None),
        ("Technology", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Technology and systems compliance", None),
        ("Operations", {"bg": "bg-blue-500/10", "text": "text-blue-400", "header": "bg-blue-500"}, "Operational process compliance", None),
        ("Training", {"bg": "bg-pink-500/10", "text": "text-pink-400", "header": "bg-pink-500"}, "Training and awareness programs", None),
        ("Reporting", {"bg": "bg-indigo-500/10", "text": "text-indigo-400", "header": "bg-indigo-500"}, "Regulatory reporting and disclosures", None),
        ("Customer Communication", {"bg": "bg-sky-500/10", "text": "text-sky-400", "header": "bg-sky-500"}, "Customer-facing compliance", None),
        ("Governance", {"bg": "bg-violet-500/10", "text": "text-violet-400", "header": "bg-violet-500"}, "Corporate governance and oversight", None),
        ("Legal", {"bg": "bg-fuchsia-500/10", "text": "text-fuchsia-400", "header": "bg-fuchsia-500"}, "Legal review and advisory", None),
        # ── Sub-teams (depth 1) ──
        ("Policy Drafting", {"bg": "bg-purple-500/10", "text": "text-purple-400", "header": "bg-purple-500"}, "Drafting and reviewing policy documents", "Policy"),
        ("Policy Review", {"bg": "bg-purple-500/10", "text": "text-purple-400", "header": "bg-purple-500"}, "Policy review and approval workflows", "Policy"),
        ("Infrastructure", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "IT infrastructure and security", "Technology"),
        ("App Development", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Application development compliance", "Technology"),
        ("Data & Analytics", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Data governance and analytics", "Technology"),
        ("Process Compliance", {"bg": "bg-blue-500/10", "text": "text-blue-400", "header": "bg-blue-500"}, "Operational process audits", "Operations"),
        ("Risk Management", {"bg": "bg-blue-500/10", "text": "text-blue-400", "header": "bg-blue-500"}, "Operational risk assessment", "Operations"),
        ("Internal Training", {"bg": "bg-pink-500/10", "text": "text-pink-400", "header": "bg-pink-500"}, "Internal staff training programs", "Training"),
        ("External Training", {"bg": "bg-pink-500/10", "text": "text-pink-400", "header": "bg-pink-500"}, "External partner training", "Training"),
        ("Regulatory Reporting", {"bg": "bg-indigo-500/10", "text": "text-indigo-400", "header": "bg-indigo-500"}, "Statutory and regulatory reports", "Reporting"),
        ("Internal Reporting", {"bg": "bg-indigo-500/10", "text": "text-indigo-400", "header": "bg-indigo-500"}, "Internal compliance reports", "Reporting"),
        # ── Sub-sub-teams (depth 2) ──
        ("Frontend Team", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Frontend application compliance", "App Development"),
        ("Backend Team", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Backend systems compliance", "App Development"),
    ]

    _ensure_system_team()

    seeded = []
    order_counter = 1
    for name, colors, summary, parent_name in hierarchy:
        if not col.find_one({"name": name}):
            # Compute hierarchy fields
            depth = 0
            path = []
            if parent_name:
                parent_doc = col.find_one({"name": parent_name})
                if parent_doc:
                    depth = (parent_doc.get("depth") or 0) + 1
                    path = (parent_doc.get("path") or []) + [parent_name]
            col.insert_one({
                "name": name,
                "is_system": False,
                "colors": colors,
                "summary": summary,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "order": order_counter,
                "parent_name": parent_name,
                "depth": depth,
                "path": path,
            })
            seeded.append(name)
        else:
            # Patch older teams: add hierarchy fields if missing
            patch = {}
            existing = col.find_one({"name": name})
            if "summary" not in existing:
                patch["summary"] = summary
            if "parent_name" not in existing:
                patch["parent_name"] = parent_name
                if parent_name:
                    parent_doc = col.find_one({"name": parent_name})
                    if parent_doc:
                        patch["depth"] = (parent_doc.get("depth") or 0) + 1
                        patch["path"] = (parent_doc.get("path") or []) + [parent_name]
                    else:
                        patch["depth"] = 0
                        patch["path"] = []
                else:
                    patch["depth"] = 0
                    patch["path"] = []
            if patch:
                col.update_one({"name": name}, {"$set": patch})
        order_counter += 1

    return {"seeded": seeded, "total_teams": col.count_documents({})}
# LLM Benchmark Endpoints
# ---------------------------------------------------------------------------

class LLMBenchmarkRunRequest(BaseModel):
    stages: list[str] = []  # Empty = all stages
    models: list[str] = []  # Empty = default models
    question_ids: list[str] = []  # Empty = all questions


@app.get("/admin/llm-benchmark/models")
def llm_benchmark_models():
    """List all available models for benchmarking."""
    from utils.llm_benchmark import (
        AVAILABLE_MODELS, BENCHMARK_MODELS, MODEL_PRICING,
        STAGE_META, TEST_QUESTIONS, PipelineStage, CURRENT_BASELINE,
    )
    return {
        "models": AVAILABLE_MODELS,
        "benchmark_models": BENCHMARK_MODELS,
        "pricing": MODEL_PRICING,
        "stages": [
            {"id": s.value, "label": STAGE_META[s]["label"], "default_model": STAGE_META[s]["default_model"]}
            for s in PipelineStage
        ],
        "test_questions": TEST_QUESTIONS,
        "current_baseline": {s.value: m for s, m in CURRENT_BASELINE.items()},
    }


@app.post("/admin/llm-benchmark/run")
def llm_benchmark_run(req: LLMBenchmarkRunRequest):
    """
    Run an LLM benchmark batch.  This is synchronous and may take several minutes.
    
    Returns all individual results + aggregated per-stage per-model comparisons.
    """
    from utils.llm_benchmark import (
        BenchmarkRunner,
        BenchmarkResultStore,
        PipelineStage,
        TEST_QUESTIONS,
    )

    runner = BenchmarkRunner()

    # Resolve stages
    if req.stages:
        try:
            stages = [PipelineStage(s) for s in req.stages]
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid stage: {e}")
    else:
        stages = list(PipelineStage)

    # Resolve models
    models = req.models if req.models else ["gpt-5.2", "gpt-5-mini", "gpt-5-nano"]

    # Resolve questions
    if req.question_ids:
        questions = [q for q in TEST_QUESTIONS if q["id"] in req.question_ids]
        if not questions:
            raise HTTPException(status_code=400, detail="No matching question IDs")
    else:
        questions = TEST_QUESTIONS

    # Run the benchmark
    summary = runner.run_batch(stages, models, questions)

    # Store in MongoDB
    try:
        store = BenchmarkResultStore()
        run_id = store.save_run(summary)
        summary["run_id"] = str(run_id)
    except Exception as e:
        summary["run_id"] = None
        summary["storage_error"] = str(e)

    # MongoDB insert_one mutates dict in-place adding _id as ObjectId
    summary.pop("_id", None)

    return summary


class TournamentBattleRequest(BaseModel):
    stage: str
    question_id: str
    models: list[str] = []  # Empty = all benchmark models


@app.post("/admin/llm-benchmark/tournament-battle")
def llm_benchmark_tournament_battle(req: TournamentBattleRequest):
    """
    Run a tournament battle: all models compete on one stage × one question.
    GPT-5.2-pro (high reasoning) judges the outputs.
    
    Designed for incremental calls from the UI — one battle per HTTP request.
    """
    from utils.llm_benchmark import (
        BenchmarkRunner, PipelineStage, TEST_QUESTIONS, BENCHMARK_MODELS,
    )

    try:
        stage = PipelineStage(req.stage)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {req.stage}")

    question = next((q for q in TEST_QUESTIONS if q["id"] == req.question_id), None)
    if not question:
        raise HTTPException(status_code=400, detail=f"Unknown question_id: {req.question_id}")

    models = req.models if req.models else [m["id"] for m in BENCHMARK_MODELS]

    runner = BenchmarkRunner()
    battle = runner.tournament_battle(stage, models, question)

    # Clean any ObjectId that might have snuck in
    import json
    cleaned = json.loads(json.dumps(battle, default=str))

    return cleaned


@app.get("/admin/llm-benchmark/results")
def llm_benchmark_results(limit: int = Query(20, ge=1, le=100)):
    """List recent LLM benchmark runs (metadata only)."""
    from utils.llm_benchmark import BenchmarkResultStore
    store = BenchmarkResultStore()
    return {"runs": store.list_runs(limit)}


@app.get("/admin/llm-benchmark/results/{run_id}")
def llm_benchmark_result_detail(run_id: str):
    """Get full results for a specific benchmark run."""
    from utils.llm_benchmark import BenchmarkResultStore
    store = BenchmarkResultStore()
    result = store.get_run(run_id)
    if not result:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
    return result


@app.get("/admin/llm-benchmark/latest")
def llm_benchmark_latest():
    """Get the most recent benchmark run results."""
    from utils.llm_benchmark import BenchmarkResultStore
    store = BenchmarkResultStore()
    result = store.get_latest()
    if not result:
        return {"message": "No benchmark runs yet"}
    return result


class ModelExperimentRequest(BaseModel):
    models: list[str] = []  # Empty = BENCHMARK_MODELS (gpt-5.2, gpt-5-mini, gpt-5-nano)
    question_ids: list[str] = []  # Empty = all TEST_QUESTIONS
    questions: list[dict] = []  # Custom questions [{id, query, expected_type, complexity}]
    quality_weight: float = 0.5
    cost_weight: float = 0.3
    latency_weight: float = 0.2


@app.post("/admin/llm-benchmark/experiment")
def llm_benchmark_experiment(req: ModelExperimentRequest):
    """
    Run a full model optimization experiment.

    Tests gpt-5.2 vs gpt-5-mini vs gpt-5-nano across all 6 QA pipeline stages,
    then computes the optimal model assignment per stage to minimize cost and
    latency while maintaining quality.

    WARNING: This is synchronous and runs 3 models × 6 stages × N questions
    = 18×N LLM calls.  With 5 default questions that's 90 calls (~5-15 min).
    """
    from utils.llm_benchmark import (
        ModelExperiment, BenchmarkResultStore,
        BENCHMARK_MODELS, TEST_QUESTIONS,
    )

    experiment = ModelExperiment()

    # Resolve models
    models = req.models if req.models else [m["id"] for m in BENCHMARK_MODELS]

    # Resolve questions
    if req.questions:
        questions = req.questions
    elif req.question_ids:
        questions = [q for q in TEST_QUESTIONS if q["id"] in req.question_ids]
        if not questions:
            raise HTTPException(status_code=400, detail="No matching question IDs")
    else:
        questions = TEST_QUESTIONS

    # Run
    result = experiment.run_experiment(
        questions=questions,
        models=models,
        quality_weight=req.quality_weight,
        cost_weight=req.cost_weight,
        latency_weight=req.latency_weight,
    )

    # Store in MongoDB
    try:
        store = BenchmarkResultStore()
        run_id = store.save_run(result)
        result["run_id"] = str(run_id)
    except Exception as e:
        result["run_id"] = None
        result["storage_error"] = str(e)

    # MongoDB insert_one mutates dict in-place adding _id as ObjectId
    result.pop("_id", None)

    return result


# ---------------------------------------------------------------------------
# Memory Health & Diagnostics Endpoints
# ---------------------------------------------------------------------------

@app.get("/admin/memory/health")
def admin_memory_health(doc_id: str = ""):
    """
    Run health checks on all memory subsystems and infrastructure.
    Tests MongoDB, feature flags, each loop's status, data freshness,
    and contribution tracking.
    """
    from memory.memory_diagnostics import MemoryHealthChecker
    checker = MemoryHealthChecker()
    return checker.check_all(doc_id=doc_id or None)


@app.get("/admin/memory/diagnostics/trends")
def admin_memory_trends(doc_id: str = "", last_n: int = 50):
    """
    Compute improvement trends from stored per-query contribution snapshots.

    Returns:
    - overall: aggregate precision, contribution rate, memory-assisted citations
    - per_loop: fire rate, error rate, utilization for each of the 5 loops
    - precision_series: list for charting precision over time
    - improvement_score: composite 0-100 score with A-F grade
    """
    from memory.memory_diagnostics import MemoryTrendAnalyzer
    from utils.mongo import get_db
    try:
        db = get_db()
        analyzer = MemoryTrendAnalyzer(db)
        return analyzer.get_trends(
            doc_id=doc_id or None,
            last_n=min(last_n, 200),
        )
    except Exception as e:
        return {"error": str(e)}


@app.get("/admin/memory/diagnostics/recent")
def admin_memory_recent(doc_id: str = "", limit: int = 20):
    """
    Return the most recent per-query memory contribution snapshots.

    Each snapshot shows what each loop contributed and whether memory
    measurably helped that particular query.
    """
    from memory.memory_diagnostics import load_recent_contributions
    from utils.mongo import get_db
    try:
        db = get_db()
        contributions = load_recent_contributions(
            db, doc_id=doc_id or None, limit=min(limit, 50),
        )
        return {
            "count": len(contributions),
            "contributions": [c.to_dict() for c in contributions],
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/admin/memory/diagnostics")
def admin_memory_diagnostics(doc_id: str = ""):
    """
    Full memory diagnostics dashboard — combines health, trends, and recent data.

    Single endpoint that returns everything needed to assess whether the
    5 feedback loops are working and how much they contribute.
    """
    from memory.memory_diagnostics import (
        MemoryHealthChecker,
        MemoryTrendAnalyzer,
        load_recent_contributions,
    )
    from utils.mongo import get_db
    try:
        db = get_db()
        _doc_id = doc_id or None

        checker = MemoryHealthChecker()
        health = checker.check_all(doc_id=_doc_id)

        analyzer = MemoryTrendAnalyzer(db)
        trends = analyzer.get_trends(doc_id=_doc_id, last_n=50)

        recent = load_recent_contributions(db, doc_id=_doc_id, limit=10)

        return {
            "health": health,
            "trends": trends,
            "recent_contributions": [c.to_dict() for c in recent],
        }
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Dropdown Config — admin-managed option lists for actionable dropdowns
# Collection: dropdown_configs
# Schema: { _id: category_key, label: str, options: [{label: str, value: int}] }
# ─────────────────────────────────────────────────────────────────────────────

DROPDOWN_COLLECTION = "dropdown_configs"

# Default seed data — provides sensible defaults on first boot (idempotent)
DEFAULT_DROPDOWN_CONFIGS = [
    # ── Theme (categorical only — no numeric score) ──
    {
        "_id": "theme",
        "label": "Theme",
        "options": [
            {"label": "Audit", "value": 0},
            {"label": "Branch Banking", "value": 0},
            {"label": "Business Continuity", "value": 0},
            {"label": "CMS", "value": 0},
            {"label": "Compliance", "value": 0},
            {"label": "Corporate Governance", "value": 0},
            {"label": "Credit Card", "value": 0},
            {"label": "Credit Risk", "value": 0},
            {"label": "Customer Service", "value": 0},
            {"label": "Cyber & Information Security", "value": 0},
            {"label": "Debit Card", "value": 0},
            {"label": "Deposit", "value": 0},
            {"label": "Digital Banking", "value": 0},
            {"label": "Employer Communications", "value": 0},
            {"label": "Financial Accounting & Records", "value": 0},
            {"label": "Information Technology Governance / Data Governance", "value": 0},
            {"label": "KYC / AML", "value": 0},
            {"label": "Loans & Advances", "value": 0},
            {"label": "Market Risk", "value": 0},
            {"label": "NPA & Restructuring", "value": 0},
            {"label": "Other Operating Regulations", "value": 0},
            {"label": "Outsourcing", "value": 0},
            {"label": "Priority Sector Lending (PSL)", "value": 0},
            {"label": "Third Party Products", "value": 0},
            {"label": "Trade & FEMA", "value": 0},
            {"label": "Treasury", "value": 0},
            {"label": "FCRM (Earlier part of the Vigilance theme)", "value": 0},
        ],
    },
    # ── Tranche 3 ──
    {
        "_id": "tranche3",
        "label": "Tranche 3",
        "options": [
            {"label": "No",  "value": 0},
            {"label": "Yes", "value": 1},
        ],
    },
    # ── Likelihood sub-dropdowns (3) — Member Role input ──
    {
        "_id": "likelihood_business_volume",
        "label": "Increase in Business Volumes",
        "options": [
            {"label": "Moderate Increase \u2014 Up to 15%", "value": 1},
            {"label": "Substantial Increase \u2014 Between 15% and 30%", "value": 2},
            {"label": "Very High Increase \u2014 More than 30%", "value": 3},
        ],
    },
    {
        "_id": "likelihood_products_processes",
        "label": "Changes in Products & Processes",
        "options": [
            {"label": "Products/processes rolled out during the year \u2014 Less than 4", "value": 1},
            {"label": "Products/processes rolled out during the year \u2014 Between 4 and 7", "value": 2},
            {"label": "Many products rolled out during the year \u2014 More than 7", "value": 3},
        ],
    },
    {
        "_id": "likelihood_compliance_violations",
        "label": "Compliance Violations in Previous 12 Months",
        "options": [
            {"label": "No violation", "value": 1},
            {"label": "1 violation", "value": 2},
            {"label": "Greater than 1", "value": 3},
        ],
    },
    # ── Impact (single dropdown — score is squared for overall impact) ──
    {
        "_id": "impact_dropdown",
        "label": "Impact Assessment",
        "options": [
            {"label": "No Significant Impact on occurrence of regulatory breach", "value": 1},
            {"label": "Material Impact", "value": 2},
            {"label": "Very High Regulatory or Reputational Impact", "value": 3},
        ],
    },
    # ── Control sub-dropdowns (2) — Member Role input ──
    # Scores are reversed: stronger control = lower score = lower risk
    {
        "_id": "control_monitoring",
        "label": "Monitoring Mechanism",
        "options": [
            {"label": "Automated", "value": 1},
            {"label": "Maker-Checker", "value": 2},
            {"label": "No Checker / No Control", "value": 3},
        ],
    },
    {
        "_id": "control_effectiveness",
        "label": "Control Effectiveness",
        "options": [
            {"label": "Well Controlled / Meets Requirements", "value": 1},
            {"label": "Improvement Needed", "value": 2},
            {"label": "Significant Improvement Needed", "value": 3},
        ],
    },
    # ── Inherent Risk (informational — label derived from score, not user-selectable) ──
    {
        "_id": "inherent_risk",
        "label": "Inherent Risk",
        "options": [
            {"label": "Low",    "value": 1},
            {"label": "Medium", "value": 2},
            {"label": "High",   "value": 3},
        ],
    },
    # ── Residual Risk (informational — label derived from matrix/score, not user-selectable) ──
    {
        "_id": "residual_risk",
        "label": "Residual Risk",
        "options": [
            {"label": "Satisfactory (Low)",          "value": 1},
            {"label": "Improvement Needed (Medium)",  "value": 2},
            {"label": "Weak (High)",                  "value": 3},
        ],
    },
    # ── Legacy flat keys (kept so old dropdown-configs API calls still work) ──
    {
        "_id": "impact",
        "label": "Impact (Legacy)",
        "options": [
            {"label": "Low",    "value": 1},
            {"label": "Medium", "value": 2},
            {"label": "High",   "value": 3},
        ],
    },
    {
        "_id": "likelihood",
        "label": "Likelihood (Legacy)",
        "options": [
            {"label": "Low",    "value": 1},
            {"label": "Medium", "value": 2},
            {"label": "High",   "value": 3},
        ],
    },
    {
        "_id": "control",
        "label": "Control (Legacy)",
        "options": [
            {"label": "Weak",     "value": 1},
            {"label": "Moderate", "value": 2},
            {"label": "Strong",   "value": 3},
        ],
    },
]


def _seed_dropdown_configs():
    """Seed default dropdown categories — updates options to latest spec if they changed."""
    from utils.mongo import get_db
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    for cfg in DEFAULT_DROPDOWN_CONFIGS:
        col.update_one(
            {"_id": cfg["_id"]},
            {"$set": {"label": cfg["label"], "options": cfg["options"]}},
            upsert=True,
        )


# Seed on startup
try:
    _seed_dropdown_configs()
except Exception:
    pass


@app.get("/dropdown-configs")
def list_dropdown_configs():
    """Return all dropdown categories and their options."""
    from utils.mongo import get_db
    db = get_db()
    docs = list(db[DROPDOWN_COLLECTION].find({}, {"_id": 1, "label": 1, "options": 1}))
    for d in docs:
        d["key"] = d.pop("_id")
    return {"configs": docs}


@app.get("/dropdown-configs/{category_key}")
def get_dropdown_config(category_key: str):
    """Return a single dropdown category by key."""
    from utils.mongo import get_db
    db = get_db()
    doc = db[DROPDOWN_COLLECTION].find_one({"_id": category_key})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Dropdown category '{category_key}' not found")
    doc["key"] = doc.pop("_id")
    return doc


@app.post("/dropdown-configs")
def create_dropdown_config(body: dict = Body(...)):
    """Admin: create a new dropdown category.
    Body: { key: str, label: str, options: [{label: str, value: int}] }"""
    from utils.mongo import get_db
    key = body.get("key", "").strip()
    label = body.get("label", "").strip()
    options = body.get("options", [])
    if not key:
        raise HTTPException(status_code=400, detail="'key' is required")
    if not label:
        raise HTTPException(status_code=400, detail="'label' is required")
    for opt in options:
        if "label" not in opt or "value" not in opt:
            raise HTTPException(status_code=400, detail="Each option must have 'label' and 'value'")
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    if col.find_one({"_id": key}):
        raise HTTPException(status_code=409, detail=f"Category '{key}' already exists")
    col.insert_one({"_id": key, "label": label, "options": options})
    return {"key": key, "label": label, "options": options}


@app.put("/dropdown-configs/{category_key}")
def update_dropdown_config(category_key: str, body: dict = Body(...)):
    """Admin: update a dropdown category's label and/or options.
    Body: { label?: str, options?: [{label: str, value: int}] }"""
    from utils.mongo import get_db
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    existing = col.find_one({"_id": category_key})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    updates: dict = {}
    if "label" in body:
        updates["label"] = body["label"]
    if "options" in body:
        for opt in body["options"]:
            if "label" not in opt or "value" not in opt:
                raise HTTPException(status_code=400, detail="Each option must have 'label' and 'value'")
        updates["options"] = body["options"]
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    col.update_one({"_id": category_key}, {"$set": updates})
    doc = col.find_one({"_id": category_key})
    doc["key"] = doc.pop("_id")
    return doc


@app.delete("/dropdown-configs/{category_key}")
def delete_dropdown_config(category_key: str):
    """Admin: delete a dropdown category. Protected keys cannot be deleted."""
    PROTECTED = {
        "impact", "likelihood", "control", "inherent_risk", "residual_risk", "tranche3", "theme",
        "likelihood_business_volume", "likelihood_products_processes", "likelihood_compliance_violations",
        "impact_dropdown",
        "control_monitoring", "control_effectiveness",
    }
    if category_key in PROTECTED:
        raise HTTPException(status_code=403, detail=f"Category '{category_key}' is protected and cannot be deleted")
    from utils.mongo import get_db
    db = get_db()
    result = db[DROPDOWN_COLLECTION].delete_one({"_id": category_key})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    return {"deleted": category_key}


@app.post("/dropdown-configs/{category_key}/options")
def add_dropdown_option(category_key: str, body: dict = Body(...)):
    """Admin: append a new option to an existing category.
    Body: { label: str, value: int }"""
    from utils.mongo import get_db
    label = body.get("label", "").strip()
    value = body.get("value")
    if not label:
        raise HTTPException(status_code=400, detail="'label' is required")
    if value is None:
        raise HTTPException(status_code=400, detail="'value' is required")
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    existing = col.find_one({"_id": category_key})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    col.update_one({"_id": category_key}, {"$push": {"options": {"label": label, "value": value}}})
    doc = col.find_one({"_id": category_key})
    doc["key"] = doc.pop("_id")
    return doc


@app.put("/dropdown-configs/{category_key}/options/{option_index}")
def update_dropdown_option(category_key: str, option_index: int, body: dict = Body(...)):
    """Admin: update a specific option by index.
    Body: { label?: str, value?: int }"""
    from utils.mongo import get_db
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    existing = col.find_one({"_id": category_key})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    options = existing.get("options", [])
    if option_index < 0 or option_index >= len(options):
        raise HTTPException(status_code=404, detail=f"Option index {option_index} out of range")
    if "label" in body:
        options[option_index]["label"] = body["label"]
    if "value" in body:
        options[option_index]["value"] = body["value"]
    col.update_one({"_id": category_key}, {"$set": {"options": options}})
    doc = col.find_one({"_id": category_key})
    doc["key"] = doc.pop("_id")
    return doc


@app.delete("/dropdown-configs/{category_key}/options/{option_index}")
def delete_dropdown_option(category_key: str, option_index: int):
    """Admin: remove a specific option by index."""
    from utils.mongo import get_db
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    existing = col.find_one({"_id": category_key})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    options = existing.get("options", [])
    if option_index < 0 or option_index >= len(options):
        raise HTTPException(status_code=404, detail=f"Option index {option_index} out of range")
    options.pop(option_index)
    col.update_one({"_id": category_key}, {"$set": {"options": options}})
    doc = col.find_one({"_id": category_key})
    doc["key"] = doc.pop("_id")
    return doc


# ─────────────────────────────────────────────────────────────────────────────
# Residual Risk Interpretation Matrix — admin-configurable mapping
# Collection: residual_risk_matrix
# Two entry types supported:
#   Range-based: { label, min_score, max_score }
#   Exact-match: { label, likelihood_score, impact_score, control_score }
# ─────────────────────────────────────────────────────────────────────────────

RISK_MATRIX_COLLECTION = "residual_risk_matrix"

DEFAULT_RISK_MATRIX = [
    {"label": "Low",    "min_score": 0,  "max_score": 9},
    {"label": "Medium", "min_score": 10, "max_score": 27},
    {"label": "High",   "min_score": 28, "max_score": 999},
]


def _seed_risk_matrix():
    """Idempotently seed default residual risk matrix entries."""
    from utils.mongo import get_db
    db = get_db()
    col = db[RISK_MATRIX_COLLECTION]
    if col.count_documents({}) == 0:
        col.insert_many(DEFAULT_RISK_MATRIX)


try:
    _seed_risk_matrix()
except Exception:
    pass


@app.get("/risk-matrix")
def list_risk_matrix():
    """Return all residual risk interpretation matrix entries."""
    from utils.mongo import get_db
    db = get_db()
    docs = list(db[RISK_MATRIX_COLLECTION].find({}))
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return {"entries": docs}


@app.post("/risk-matrix")
def create_risk_matrix_entry(body: dict = Body(...)):
    """Admin: add a new matrix entry.
    Body: { label: str, min_score?: int, max_score?: int,
            likelihood_score?: int, impact_score?: int, control_score?: int }"""
    from utils.mongo import get_db
    label = body.get("label", "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="'label' is required")
    entry = {"label": label}
    for k in ("min_score", "max_score", "likelihood_score", "impact_score", "control_score"):
        if k in body:
            entry[k] = int(body[k])
    db = get_db()
    result = db[RISK_MATRIX_COLLECTION].insert_one(entry)
    entry["id"] = str(result.inserted_id)
    entry.pop("_id", None)
    return entry


@app.put("/risk-matrix/{entry_id}")
def update_risk_matrix_entry(entry_id: str, body: dict = Body(...)):
    """Admin: update a matrix entry by ID."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    col = db[RISK_MATRIX_COLLECTION]
    try:
        oid = ObjectId(entry_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid entry ID")
    existing = col.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Matrix entry not found")
    updates = {}
    if "label" in body:
        updates["label"] = body["label"]
    for k in ("min_score", "max_score", "likelihood_score", "impact_score", "control_score"):
        if k in body:
            updates[k] = int(body[k])
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    col.update_one({"_id": oid}, {"$set": updates})
    doc = col.find_one({"_id": oid})
    doc["id"] = str(doc.pop("_id"))
    return doc


@app.delete("/risk-matrix/{entry_id}")
def delete_risk_matrix_entry(entry_id: str):
    """Admin: remove a matrix entry by ID."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    try:
        oid = ObjectId(entry_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid entry ID")
    result = db[RISK_MATRIX_COLLECTION].delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Matrix entry not found")
    return {"deleted": entry_id}


# ─────────────────────────────────────────────────────────────────────────────
# Risk Engine Config — admin-configurable thresholds, weights, parameter options
# Collection: risk_engine_config  (singleton document, key="default")
# ─────────────────────────────────────────────────────────────────────────────

RISK_ENGINE_CONFIG_COLLECTION = "risk_engine_config"


@app.get("/risk-engine-config")
def get_risk_engine_config():
    """Return the current risk engine configuration (thresholds, weights, options)."""
    from utils.mongo import get_db
    db = get_db()
    doc = db[RISK_ENGINE_CONFIG_COLLECTION].find_one({"key": "default"})
    if doc:
        doc.pop("_id", None)
        doc.pop("key", None)
        return doc
    return {}


@app.put("/risk-engine-config")
def update_risk_engine_config(body: dict = Body(...)):
    """Admin: upsert the risk engine configuration."""
    from utils.mongo import get_db
    db = get_db()
    col = db[RISK_ENGINE_CONFIG_COLLECTION]
    # Remove _id if present in body
    body.pop("_id", None)
    body.pop("key", None)
    col.update_one(
        {"key": "default"},
        {"$set": {**body, "key": "default"}},
        upsert=True,
    )
    doc = col.find_one({"key": "default"})
    if doc:
        doc.pop("_id", None)
        doc.pop("key", None)
    return doc or {}


# ─────────────────────────────────────────────────────────────────────────────
# Risk Parameter Selections — CO-saved manual dropdown picks
# Collection: risk_parameter_selections  (singleton, key="current")
# ─────────────────────────────────────────────────────────────────────────────

RISK_PARAM_SELECTIONS_COLLECTION = "risk_parameter_selections"


@app.get("/risk-parameter-selections")
def get_risk_parameter_selections():
    """Return the current saved parameter selections."""
    from utils.mongo import get_db
    db = get_db()
    doc = db[RISK_PARAM_SELECTIONS_COLLECTION].find_one({"key": "current"})
    if doc:
        doc["_id"] = str(doc["_id"])
        doc.pop("key", None)
        return doc
    return {}


@app.put("/risk-parameter-selections")
def update_risk_parameter_selections(body: dict = Body(...)):
    """Save/update risk parameter selections."""
    from utils.mongo import get_db
    from datetime import datetime, timezone
    db = get_db()
    col = db[RISK_PARAM_SELECTIONS_COLLECTION]
    body.pop("_id", None)
    body.pop("key", None)
    body["updated_at"] = datetime.now(timezone.utc).isoformat()
    col.update_one(
        {"key": "current"},
        {"$set": {**body, "key": "current"}},
        upsert=True,
    )
    doc = col.find_one({"key": "current"})
    if doc:
        doc["_id"] = str(doc["_id"])
        doc.pop("key", None)
    return doc or {}


# ─────────────────────────────────────────────────────────────────────────────
# Migration: populate new risk fields for legacy actionables
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/admin/migrate-risk-fields")
def migrate_risk_fields():
    """Admin: backfill new structured risk fields for all existing actionables.

    For each actionable that lacks `impact_dropdown`, assigns safe defaults:
    - All sub-dropdowns get {"label": "Low", "score": 1}
    - Computed fields are recalculated using new formulas
    - Legacy flat fields are left untouched
    Only augments system-generated / computed fields — never touches
    fields fetched from original documents.
    """
    store = get_actionable_store()
    from utils.mongo import get_db
    db = get_db()
    col = db["actionables_store"]
    migrated = 0
    total = 0

    for doc in col.find({}):
        doc_id = doc.get("doc_id", "")
        result = store.load(doc_id)
        if not result:
            continue
        changed = False
        for a in result.actionables:
            total += 1
            # Only migrate items that don't yet have impact_dropdown populated
            needs_migration = (
                not a.impact_dropdown
                or not isinstance(a.impact_dropdown, dict)
                or not a.impact_dropdown.get("label")
            )
            if not needs_migration:
                # Still recompute scores to ensure consistency
                _recompute_risk_scores(a)
                changed = True
                continue

            # Assign safe defaults for sub-dropdowns if empty
            default_low = {"label": "Low", "score": 1}
            default_weak = {"label": "Weak", "score": 1}

            if not a.likelihood_business_volume or not isinstance(a.likelihood_business_volume, dict) or not a.likelihood_business_volume.get("label"):
                a.likelihood_business_volume = dict(default_low)
            if not a.likelihood_products_processes or not isinstance(a.likelihood_products_processes, dict) or not a.likelihood_products_processes.get("label"):
                a.likelihood_products_processes = dict(default_low)
            if not a.likelihood_compliance_violations or not isinstance(a.likelihood_compliance_violations, dict) or not a.likelihood_compliance_violations.get("label"):
                a.likelihood_compliance_violations = dict(default_low)

            # Migrate impact: use impact_sub1 if available, else default
            if a.impact_sub1 and isinstance(a.impact_sub1, dict) and a.impact_sub1.get("label"):
                a.impact_dropdown = dict(a.impact_sub1)
            else:
                a.impact_dropdown = dict(default_low)

            if not a.control_monitoring or not isinstance(a.control_monitoring, dict) or not a.control_monitoring.get("label"):
                a.control_monitoring = dict(default_weak)
            if not a.control_effectiveness or not isinstance(a.control_effectiveness, dict) or not a.control_effectiveness.get("label"):
                a.control_effectiveness = dict(default_weak)

            # Recompute all derived scores
            _recompute_risk_scores(a)
            changed = True
            migrated += 1

        if changed:
            result.compute_stats()
            store.save(result)

    return {
        "status": "ok",
        "total_actionables": total,
        "migrated": migrated,
        "message": f"Migrated {migrated} actionables with safe defaults. {total - migrated} already had impact_dropdown populated.",
    }


# ---------------------------------------------------------------------------
# Feature 4: Notifications API
# ---------------------------------------------------------------------------

@app.get("/notifications")
def get_notifications(user_id: str = Query(...), limit: int = Query(50)):
    """Fetch notifications for a user, newest first."""
    from utils.mongo import get_db
    db = get_db()
    coll = db["notifications"]
    docs = list(coll.find({"user_id": user_id}).sort("created_at", -1).limit(limit))
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return {"notifications": docs}


@app.post("/notifications")
def create_notification(body: dict = Body(...)):
    """Create a notification. Body: {user_id, actionable_id?, type, message}"""
    from utils.mongo import get_db
    db = get_db()
    coll = db["notifications"]
    doc = {
        "user_id": body.get("user_id", ""),
        "actionable_id": body.get("actionable_id", ""),
        "doc_id": body.get("doc_id", ""),
        "type": body.get("type", "info"),
        "message": body.get("message", ""),
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = coll.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return doc


@app.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str):
    """Mark a single notification as read."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    db["notifications"].update_one({"_id": ObjectId(notification_id)}, {"$set": {"is_read": True}})
    return {"ok": True}


@app.post("/notifications/read-all")
def mark_all_notifications_read(body: dict = Body(...)):
    """Mark all notifications for a user as read."""
    from utils.mongo import get_db
    db = get_db()
    user_id = body.get("user_id", "")
    if user_id:
        db["notifications"].update_many({"user_id": user_id, "is_read": False}, {"$set": {"is_read": True}})
    return {"ok": True}


@app.get("/notifications/unread-count")
def get_unread_count(user_id: str = Query(...)):
    """Get unread notification count for a user."""
    from utils.mongo import get_db
    db = get_db()
    count = db["notifications"].count_documents({"user_id": user_id, "is_read": False})
    return {"unread": count}


@app.delete("/notifications/clear")
def clear_user_notifications(user_id: str = Query(...)):
    """Delete all notifications for the given user, then regenerate any for still-pending delegation requests."""
    from utils.mongo import get_db
    db = get_db()
    result = db["notifications"].delete_many({"user_id": user_id})
    deleted = result.deleted_count

    # Regenerate notifications for any still-pending delegation requests
    pending_requests = list(db["delegation_requests"].find({
        "to_account_id": user_id,
        "status": "pending"
    }))
    regenerated = 0
    for req in pending_requests:
        request_id = str(req["_id"])
        actionable_title = req.get("actionable_title", "")
        actionable_id = req.get("actionable_id", "")
        title_display = f"{actionable_title} (ID: {actionable_id})" if actionable_title else f"Actionable {actionable_id}"
        notif = {
            "user_id": user_id,
            "actionable_id": actionable_id,
            "doc_id": req.get("doc_id", ""),
            "delegation_request_id": request_id,
            "type": "delegation_request",
            "message": f"Delegation request from {req.get('from_name', 'a colleague')} for {title_display}",
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        db["notifications"].insert_one(notif)
        regenerated += 1

    return {"ok": True, "deleted": deleted, "regenerated": regenerated}


# ---------------------------------------------------------------------------
# Feature 5: Delegation Stats API
# ---------------------------------------------------------------------------

@app.get("/delegation-stats")
def get_delegation_stats(account_id: str = Query(...)):
    """Return delegation metrics for a given account (as sender and receiver)."""
    from utils.mongo import get_db
    db = get_db()
    coll = db["delegation_requests"]

    sent_total = coll.count_documents({"from_account_id": account_id})
    sent_accepted = coll.count_documents({"from_account_id": account_id, "status": "accepted"})
    sent_rejected = coll.count_documents({"from_account_id": account_id, "status": "rejected"})
    sent_pending = coll.count_documents({"from_account_id": account_id, "status": "pending"})

    received_total = coll.count_documents({"to_account_id": account_id})
    received_accepted = coll.count_documents({"to_account_id": account_id, "status": "accepted"})
    received_rejected = coll.count_documents({"to_account_id": account_id, "status": "rejected"})
    received_pending = coll.count_documents({"to_account_id": account_id, "status": "pending"})

    return {
        "sent": {"total": sent_total, "accepted": sent_accepted, "rejected": sent_rejected, "pending": sent_pending},
        "received": {"total": received_total, "accepted": received_accepted, "rejected": received_rejected, "pending": received_pending},
    }


# ---------------------------------------------------------------------------
# Feature 3: Delegation API
# ---------------------------------------------------------------------------

@app.get("/delegation-requests")
def get_delegation_requests(account_id: str = Query(...), direction: str = Query("incoming")):
    """Fetch delegation requests. direction=incoming|outgoing|all"""
    from utils.mongo import get_db
    db = get_db()
    coll = db["delegation_requests"]
    query: dict = {}
    if direction == "incoming":
        query["to_account_id"] = account_id
    elif direction == "outgoing":
        query["from_account_id"] = account_id
    else:
        query["$or"] = [{"from_account_id": account_id}, {"to_account_id": account_id}]
    docs = list(coll.find(query).sort("created_at", -1))
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return {"requests": docs}


@app.post("/delegation-requests/regenerate-notifications")
def regenerate_delegation_notifications(account_id: str = Query(...)):
    """Regenerate notifications for pending delegation requests if they were cleared prematurely."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    
    # Find all pending delegation requests where this user is the recipient
    pending_requests = list(db["delegation_requests"].find({
        "to_account_id": account_id,
        "status": "pending"
    }))
    
    regenerated_count = 0
    for req in pending_requests:
        request_id = str(req["_id"])
        
        # Check if notification already exists for this request
        existing_notif = db["notifications"].find_one({
            "delegation_request_id": request_id,
            "user_id": account_id
        })
        
        if not existing_notif:
            # Regenerate notification
            actionable_title = req.get("actionable_title", "")
            actionable_id = req.get("actionable_id", "")
            title_display = f"{actionable_title} (ID: {actionable_id})" if actionable_title else f"Actionable {actionable_id}"
            
            notif = {
                "user_id": account_id,
                "actionable_id": actionable_id,
                "doc_id": req.get("doc_id", ""),
                "delegation_request_id": request_id,
                "type": "delegation_request",
                "message": f"Delegation request from {req.get('from_name', 'a colleague')} for {title_display}",
                "is_read": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            db["notifications"].insert_one(notif)
            regenerated_count += 1
    
    return {"ok": True, "regenerated": regenerated_count}


@app.post("/delegation-requests")
def create_delegation_request(body: dict = Body(...)):
    """Create a delegation request. Body: {actionable_id, doc_id, from_account_id, to_account_id, from_name, to_name}"""
    from utils.mongo import get_db
    db = get_db()
    coll = db["delegation_requests"]

    # Guard: prevent multiple pending delegations for the same actionable
    actionable_id = body.get("actionable_id", "")
    doc_id = body.get("doc_id", "")
    existing_pending = coll.find_one({
        "actionable_id": actionable_id,
        "doc_id": doc_id,
        "status": "pending",
    })
    if existing_pending:
        raise HTTPException(status_code=409, detail="A pending delegation request already exists for this actionable")

    doc = {
        "actionable_id": actionable_id,
        "actionable_title": body.get("actionable_title", ""),
        "doc_id": doc_id,
        "from_account_id": body.get("from_account_id", ""),
        "to_account_id": body.get("to_account_id", ""),
        "from_name": body.get("from_name", ""),
        "to_name": body.get("to_name", ""),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "resolved_at": "",
    }
    result = coll.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)

    # Store delegation_request_id on the actionable
    doc_id = body.get("doc_id", "")
    actionable_id = body.get("actionable_id", "")
    if doc_id and actionable_id:
        store = get_actionable_store()
        result_doc = store.load(doc_id)
        if result_doc:
            for a in result_doc.actionables:
                if a.id == actionable_id or a.actionable_id == actionable_id:
                    a.delegation_request_id = doc["id"]
                    break
            store.save(result_doc)

    # Create notification for delegatee
    actionable_title = body.get("actionable_title", "")
    actionable_id = body.get("actionable_id", "")
    title_display = f"{actionable_title} (ID: {actionable_id})" if actionable_title else f"Actionable {actionable_id}"
    notif = {
        "user_id": body.get("to_account_id", ""),
        "actionable_id": actionable_id,
        "doc_id": body.get("doc_id", ""),
        "delegation_request_id": doc["id"],
        "type": "delegation_request",
        "message": f"Delegation request from {body.get('from_name', 'a colleague')} for {title_display}",
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db["notifications"].insert_one(notif)

    return doc


@app.post("/delegation-requests/{request_id}/accept")
def accept_delegation(request_id: str):
    """Accept a delegation request — transfers actionable ownership."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    coll = db["delegation_requests"]
    req = coll.find_one({"_id": ObjectId(request_id)})
    if not req:
        raise HTTPException(status_code=404, detail="Delegation request not found")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Request already resolved")

    coll.update_one({"_id": ObjectId(request_id)}, {"$set": {
        "status": "accepted",
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }})

    # Update actionable ownership
    doc_id = req.get("doc_id", "")
    actionable_id = req.get("actionable_id", "")
    if doc_id and actionable_id:
        store = get_actionable_store()
        result = store.load(doc_id)
        if result:
            for a in result.actionables:
                if a.id == actionable_id or a.actionable_id == actionable_id:
                    a.delegated_from_account_id = req.get("from_account_id", "")
                    a.published_by_account_id = req.get("to_account_id", "")
                    a.delegation_request_id = ""  # Clear pending delegation
                    break
            store.save(result)

    # Delete the original delegation notification from receiver's list
    db["notifications"].delete_many({"delegation_request_id": request_id})

    # Notify delegator
    notif = {
        "user_id": req.get("from_account_id", ""),
        "actionable_id": actionable_id,
        "doc_id": doc_id,
        "type": "delegation_accepted",
        "message": f"Your delegation request for {actionable_id} was accepted by {req.get('to_name', 'colleague')}",
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db["notifications"].insert_one(notif)

    return {"ok": True, "status": "accepted"}


@app.post("/delegation-requests/{request_id}/reject")
def reject_delegation(request_id: str):
    """Reject a delegation request — no changes to actionable."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    coll = db["delegation_requests"]
    req = coll.find_one({"_id": ObjectId(request_id)})
    if not req:
        raise HTTPException(status_code=404, detail="Delegation request not found")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Request already resolved")

    coll.update_one({"_id": ObjectId(request_id)}, {"$set": {
        "status": "rejected",
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }})

    # Clear delegation_request_id from actionable
    doc_id = req.get("doc_id", "")
    actionable_id = req.get("actionable_id", "")
    if doc_id and actionable_id:
        store = get_actionable_store()
        result = store.load(doc_id)
        if result:
            for a in result.actionables:
                if a.id == actionable_id or a.actionable_id == actionable_id:
                    a.delegation_request_id = ""  # Clear pending delegation
                    break
            store.save(result)

    # Delete the original delegation notification from receiver's list
    db["notifications"].delete_many({"delegation_request_id": request_id})

    # Notify delegator
    notif = {
        "user_id": req.get("from_account_id", ""),
        "actionable_id": req.get("actionable_id", ""),
        "doc_id": req.get("doc_id", ""),
        "type": "delegation_rejected",
        "message": f"Your delegation request for {req.get('actionable_id', '')} was rejected by {req.get('to_name', 'colleague')}",
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db["notifications"].insert_one(notif)

    return {"ok": True, "status": "rejected"}


@app.post("/delegation-requests/{request_id}/revert")
def revert_delegation(request_id: str):
    """Revert (cancel) a pending delegation request — sender takes back the actionable."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    coll = db["delegation_requests"]
    req = coll.find_one({"_id": ObjectId(request_id)})
    if not req:
        raise HTTPException(status_code=404, detail="Delegation request not found")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Only pending requests can be reverted")

    # Mark delegation request as reverted
    coll.update_one({"_id": ObjectId(request_id)}, {"$set": {
        "status": "reverted",
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }})

    # Clear delegation_request_id from actionable
    doc_id = req.get("doc_id", "")
    actionable_id = req.get("actionable_id", "")
    if doc_id and actionable_id:
        store = get_actionable_store()
        result = store.load(doc_id)
        if result:
            for a in result.actionables:
                if a.id == actionable_id or a.actionable_id == actionable_id:
                    a.delegation_request_id = ""
                    break
            store.save(result)

    # Delete the delegation notification from receiver's list
    db["notifications"].delete_many({"delegation_request_id": request_id})

    return {"ok": True, "status": "reverted"}


@app.post("/actionables/{doc_id}/{actionable_id}/cleanup-state")
def cleanup_actionable_state(doc_id: str, actionable_id: str):
    """Clean up all delegation and notification state for an actionable (used during unpublish/reset)."""
    from utils.mongo import get_db
    db = get_db()
    
    # Delete all delegation requests for this actionable
    delegation_result = db["delegation_requests"].delete_many({
        "doc_id": doc_id,
        "actionable_id": actionable_id
    })
    
    # Delete all notifications for this actionable
    notification_result = db["notifications"].delete_many({
        "doc_id": doc_id,
        "actionable_id": actionable_id
    })
    
    return {
        "ok": True,
        "delegation_requests_deleted": delegation_result.deleted_count,
        "notifications_deleted": notification_result.deleted_count
    }


# ---------------------------------------------------------------------------
# Feature 2: Fetch compliance officers list (for delegation dropdown)
# ---------------------------------------------------------------------------

@app.get("/compliance-officers")
def get_compliance_officers():
    """Return list of compliance officer accounts for delegation dropdown."""
    from utils.mongo import get_db
    import os
    auth_db_name = os.getenv("AUTH_DB_NAME", "govinda_auth")
    from pymongo import MongoClient
    mongo_uri = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI", "mongodb://localhost:27017")
    client = MongoClient(mongo_uri)
    auth_db = client[auth_db_name]
    users = list(auth_db["user"].find({"role": "compliance_officer"}, {"_id": 1, "name": 1, "email": 1}))
    result = []
    for u in users:
        result.append({
            "id": str(u["_id"]),
            "name": u.get("name", u.get("email", "")),
            "email": u.get("email", ""),
        })
    return {"officers": result}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
