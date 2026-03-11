print("LOADING BACKEND MAIN --------------------------------------------------")
import sys
import os
import shutil
import logging
import uuid
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Body
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

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
from app_backend.constants import Collection

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
        db[Collection.RUNTIME_CONFIG].update_one(
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
        doc = db[Collection.RUNTIME_CONFIG].find_one({"_id": "global"})
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
        result = db[Collection.COUNTERS].find_one_and_update(
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
    
    # Sync singletons to deps module so routers can import them
    from app_backend import deps as _deps
    _deps._tree_store = _tree_store
    _deps._qa_engine = _qa_engine
    _deps._ingestion_pipeline = _ingestion_pipeline
    _deps._query_store = _query_store
    _deps._corpus_store = _corpus_store
    _deps._corpus_qa_engine = _corpus_qa_engine
    _deps._actionable_store = _actionable_store
    _deps._actionable_extractor = _actionable_extractor
    _deps._conversation_store = _conversation_store
    _deps._benchmark_store = _benchmark_store

    logger.info("All singletons initialized successfully")


@app.on_event("startup")
async def startup_event():
    """Initialize all singletons on app startup."""
    global _runtime_config, _benchmark_store
    _init_singletons()
    _runtime_config = _load_persisted_runtime_config()
    logger.info("Runtime config loaded: %s", _runtime_config)

    # Ensure database indexes (idempotent)
    try:
        from utils.mongo import get_db
        from app_backend.db_indexes import ensure_indexes
        ensure_indexes(get_db())
    except Exception as e:
        logger.warning("Index creation skipped: %s", e)


# ---------------------------------------------------------------------------
# Models (extracted to app_backend/models/schemas.py)
# ---------------------------------------------------------------------------
from app_backend.models.schemas import CorpusQueryRequest, CorpusQueryResponse


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


# ---------------------------------------------------------------------------
# Documents (extracted to routers/documents.py)
# ---------------------------------------------------------------------------
from app_backend.routers.documents import router as documents_router
app.include_router(documents_router)

# ---------------------------------------------------------------------------
# Query / RAG (extracted to routers/query.py)
# ---------------------------------------------------------------------------
from app_backend.routers.query import router as query_router
app.include_router(query_router)


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
# Actionables (extracted to routers/actionables.py)
# ---------------------------------------------------------------------------
from app_backend.routers.actionables import router as actionables_router
app.include_router(actionables_router)


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
        retrieval_result = engine.retrieve(request.query)
        answer = engine.synthesize_and_verify(retrieval_result, verify=request.verify)
        
        record = QueryRecord(
            record_id=str(uuid.uuid4()),
            query_text=request.query,
            doc_id="corpus",
            timestamp=datetime.now(timezone.utc).isoformat(),
            query_type=answer.query_type,
            sub_queries=retrieval_result.sub_queries,
            key_terms=retrieval_result.key_terms,
            routing_log=None,
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

        citations_serialized = [
            {"citation_id": c.citation_id, "node_id": c.node_id, "title": c.title,
             "page_range": c.page_range, "excerpt": c.excerpt, "doc_id": c.doc_id}
            for c in answer.citations
        ]
        
        inferred_points_serialized = [
            {"point": ip.point, "supporting_definitions": ip.supporting_definitions,
             "supporting_sections": ip.supporting_sections, "reasoning": ip.reasoning,
             "confidence": ip.confidence}
            for ip in answer.inferred_points
        ]
        
        retrieved_sections_serialized = [
            {"node_id": s.node_id, "title": s.title, "text": s.text,
             "page_range": s.page_range, "source": s.source, "token_count": s.token_count,
             "doc_id": s.doc_id}
            for s in answer.retrieved_sections
        ]

        return {
            "answer": answer.text,
            "record_id": record.record_id,
            "citations": citations_serialized,
            "verification_status": answer.verification_status,
            "verification_notes": answer.verification_notes,
            "inferred_points": inferred_points_serialized,
            "query_type": answer.query_type.value if hasattr(answer.query_type, "value") else str(answer.query_type),
            "sub_queries": retrieval_result.sub_queries,
            "key_terms": retrieval_result.key_terms,
            "retrieved_sections": retrieved_sections_serialized,
            "stage_timings": answer.stage_timings,
            "total_time_seconds": answer.total_time_seconds,
            "total_tokens": answer.total_tokens,
            "llm_calls": answer.llm_calls,
        }
    except Exception as e:
        logger.error("Corpus query failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Conversation Endpoints
# ---------------------------------------------------------------------------


@app.get("/conversations")
def list_conversations(doc_id: str = Query("")):
    """List all conversations, optionally filtered by doc_id."""
    store = get_conversation_store()
    if doc_id:
        convs = store.list_by_doc(doc_id)
    else:
        convs = store.list_all()
    return [c.to_dict() for c in convs]


@app.get("/conversations/{conv_id}")
def get_conversation(conv_id: str):
    """Get a single conversation with all messages."""
    store = get_conversation_store()
    conv = store.load(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv.to_dict()


@app.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: str):
    """Delete a conversation."""
    store = get_conversation_store()
    success = store.delete(conv_id)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted", "conv_id": conv_id}


# ---------------------------------------------------------------------------
# Storage & Export Endpoints
# ---------------------------------------------------------------------------


@app.get("/storage/stats")
def get_storage_stats():
    """Get MongoDB storage statistics."""
    from utils.mongo import get_db
    db = get_db()
    
    collections = ["trees", "queries", "conversations", "actionables", "corpus", "fs.files", "fs.chunks"]
    stats = {}
    total_size = 0
    
    for coll_name in collections:
        try:
            cs = db.command("collStats", coll_name)
            size = cs.get("storageSize", 0)
            stats[coll_name] = {
                "docs": cs.get("count", 0),
                "size_bytes": size,
                "size_mb": round(size / 1024 / 1024, 2),
            }
            total_size += size
        except Exception:
            stats[coll_name] = {"docs": 0, "size_bytes": 0, "size_mb": 0}
    
    return {
        "collections": stats,
        "total_bytes": total_size,
        "total_mb": round(total_size / 1024 / 1024, 2),
        "limit_mb": 512,
        "usage_percent": round((total_size / (512 * 1024 * 1024)) * 100, 1),
    }


@app.get("/export/training-data")
def export_training_data():
    """Export all query records as training data for fine-tuning."""
    from utils.mongo import get_db
    from fastapi.responses import JSONResponse
    
    db = get_db()
    export = []
    
    for raw in db[Collection.QUERIES].find():
        raw.pop("_id", None)
        export.append({
            "query": raw.get("query_text", ""),
            "answer": raw.get("answer_text", ""),
            "doc_id": raw.get("doc_id", ""),
            "timestamp": raw.get("timestamp", ""),
            "query_type": raw.get("query_type", ""),
            "verification_status": raw.get("verification_status", ""),
        })
    
    headers = {
        "Content-Disposition": (
            f'attachment; filename="govinda_training_data_'
            f'{datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")}.json"'
        )
    }
    return JSONResponse(content=export, headers=headers)


# ---------------------------------------------------------------------------
# Chat Endpoints (extracted to routers/chat.py)
# ---------------------------------------------------------------------------
from app_backend.routers.chat import router as chat_router
app.include_router(chat_router)


# ---------------------------------------------------------------------------
# Dynamic Teams Management API (extracted to routers/teams.py)
# ---------------------------------------------------------------------------
from app_backend.routers.teams import router as teams_router
app.include_router(teams_router)


# ---------------------------------------------------------------------------
# LLM Benchmarking (extracted to routers/benchmarks.py)
# ---------------------------------------------------------------------------
from app_backend.routers.benchmarks import router as benchmarks_router
app.include_router(benchmarks_router)




if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

