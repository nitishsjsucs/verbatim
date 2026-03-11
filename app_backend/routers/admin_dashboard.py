"""
Admin dashboard endpoints — login, overview, queries, benchmarks, memory, logs.

Extracted from main.py as part of the backend modularization.
"""
import os
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app_backend.constants import Collection
from app_backend.models.schemas import AdminLoginRequest
from config.settings import get_settings

logger = logging.getLogger("backend")

router = APIRouter(tags=["admin"])

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin@govinda.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Govinda@2026")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/admin/login")
def admin_login(req: AdminLoginRequest):
    """Validate admin credentials. Returns a simple token."""
    if req.username == ADMIN_USERNAME and req.password == ADMIN_PASSWORD:
        import hashlib, time
        token = hashlib.sha256(f"{ADMIN_USERNAME}:{time.time()}".encode()).hexdigest()
        return {"authenticated": True, "token": token, "username": ADMIN_USERNAME}
    raise HTTPException(status_code=401, detail="Invalid admin credentials")


@router.get("/admin/overview")
def admin_overview():
    """Comprehensive system overview for the admin dashboard."""
    from utils.mongo import get_db
    from app_backend.routers.deps import (
        get_tree_store, get_benchmark_store, get_retrieval_mode, get_qa_engine,
    )

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
    total_queries = db[Collection.QUERIES].count_documents({})
    recent_queries = []
    for raw in db[Collection.QUERIES].find().sort("timestamp", -1).limit(50):
        raw.pop("_id", None)
        raw.pop("retrieved_sections", None)
        raw.pop("routing_log", None)
        recent_queries.append(raw)

    query_timings = []
    for raw in db[Collection.QUERIES].find({}, {"total_time_seconds": 1, "timestamp": 1, "query_type": 1, "doc_id": 1}).sort("timestamp", -1).limit(100):
        query_timings.append({
            "time": raw.get("total_time_seconds", 0),
            "timestamp": raw.get("timestamp", ""),
            "query_type": raw.get("query_type", ""),
            "doc_id": raw.get("doc_id", ""),
        })

    feedback_count = db[Collection.QUERIES].count_documents({"feedback": {"$exists": True}})
    ratings = list(db[Collection.QUERIES].aggregate([
        {"$match": {"feedback.rating": {"$exists": True}}},
        {"$group": {"_id": None, "avg": {"$avg": "$feedback.rating"}, "count": {"$sum": 1}}},
    ]))
    avg_rating = ratings[0]["avg"] if ratings else None
    rating_count = ratings[0]["count"] if ratings else 0

    # 3. Conversation stats
    total_conversations = db[Collection.CONVERSATIONS].count_documents({})
    total_messages = 0
    for conv in db[Collection.CONVERSATIONS].find({}, {"messages": 1}):
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
    total_actionable_docs = db[Collection.ACTIONABLES].count_documents({})
    total_actionable_items = 0
    actionable_by_status = {"pending": 0, "approved": 0, "rejected": 0}
    for raw in db[Collection.ACTIONABLES].find({}, {"actionables": 1}):
        items = raw.get("actionables", [])
        total_actionable_items += len(items)
        for item in items:
            status = item.get("approval_status", "pending")
            actionable_by_status[status] = actionable_by_status.get(status, 0) + 1

    # 9. Cache stats
    cache_stats = {}
    try:
        qa_engine = get_qa_engine()
        if qa_engine and hasattr(qa_engine, '_query_cache') and qa_engine._query_cache:
            cache_stats = qa_engine._query_cache.get_stats()
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


@router.get("/admin/queries")
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

    total = db[Collection.QUERIES].count_documents(query_filter)
    cursor = db[Collection.QUERIES].find(query_filter).sort(sort_by, sort_order).skip(skip).limit(limit)
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


@router.get("/admin/query/{record_id}/full")
def admin_query_full(record_id: str):
    """Get complete query record with all routing details for admin."""
    from app_backend.routers.deps import get_query_store

    store = get_query_store()
    record = store.load(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Query record not found")
    return record.to_dict()


@router.get("/admin/benchmarks")
def admin_benchmarks(last_n: int = Query(100, ge=1, le=1000)):
    """Detailed benchmark comparison data."""
    from utils.mongo import get_db
    from app_backend.routers.deps import get_benchmark_store, get_retrieval_mode

    store = get_benchmark_store()
    if not store:
        return {"error": "BenchmarkStore not initialized"}

    db = get_db()

    raw_records = []
    for raw in db[Collection.BENCHMARKS].find().sort("timestamp", -1).limit(last_n):
        raw.pop("_id", None)
        raw_records.append(raw)

    return {
        "legacy": store.aggregate_stats("legacy", last_n=last_n),
        "optimized": store.aggregate_stats("optimized", last_n=last_n),
        "records": raw_records,
        "retrieval_mode": get_retrieval_mode(),
    }


@router.get("/admin/memory/detailed")
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


@router.get("/admin/system/logs")
def admin_system_logs(lines: int = Query(200, ge=1, le=2000)):
    """Return recent application log entries (from memory buffer if available)."""
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

    if not log_entries:
        log_entries = ["Logs are printed to stdout. Check process output for full logs."]

    return {
        "total_lines": len(log_entries),
        "entries": log_entries,
    }


@router.get("/admin/runtime-config")
def admin_runtime_config():
    """Return all runtime config keys (persisted toggles, mode, etc.)."""
    from app_backend.routers.deps import get_runtime_config, get_load_persisted_runtime_config

    return {
        "config": get_runtime_config(),
        "persisted": get_load_persisted_runtime_config(),
    }
