"""
Document management endpoints.

Handles document CRUD operations, PDF serving, metadata updates, and ingestion.
"""
import shutil
import logging
from urllib.parse import quote as url_quote

from fastapi import APIRouter, File, UploadFile, HTTPException, Query, Body
from fastapi.responses import FileResponse, StreamingResponse

from app_backend.models.schemas import IngestResponse

logger = logging.getLogger("backend")

router = APIRouter(tags=["documents"])


# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def _serialize_node(node):
    """Serialize a TreeNode to dict for JSON response."""
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

@router.get("/documents")
def list_documents():
    """List all indexed documents (batch loaded for efficiency)."""
    from app_backend.routers.deps import get_tree_store, get_actionable_store

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


@router.get("/documents/{doc_id}")
def get_document(doc_id: str):
    """Get full tree structure for a document."""
    from app_backend.routers.deps import get_tree_store

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


@router.get("/documents/{doc_id}/raw")
def get_document_raw(doc_id: str):
    """Serve the raw PDF file from GridFS."""
    from app_backend.routers.deps import get_tree_store
    from config.settings import get_settings
    from utils.mongo import get_fs

    store = get_tree_store()
    tree = store.load(doc_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Document not found")

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


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    """Delete a document and its PDF from GridFS."""
    from app_backend.routers.deps import get_tree_store, get_corpus_store
    from utils.mongo import get_fs

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


@router.patch("/documents/{doc_id}/rename")
def rename_document(doc_id: str, body: dict):
    """Rename a document (updates doc_name in tree store, GridFS, actionables, and corpus)."""
    from app_backend.routers.deps import get_tree_store, get_actionable_store, get_corpus_store
    from utils.mongo import get_fs, get_db

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
        fs = get_fs()
        grid_file = fs.find_one({"filename": old_name})
        if grid_file:
            db = get_db()
            db_name = db.name if hasattr(db, 'name') else None
            # Access the underlying files collection to rename
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


@router.put("/documents/{doc_id}/metadata")
def update_document_metadata(doc_id: str, body: dict = Body(...)):
    """Update document-level metadata: regulation_issue_date, circular_effective_date, regulator.
    Also propagates these fields to all actionables in the document."""
    from app_backend.routers.deps import get_actionable_store

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

    store.save(result)
    return {
        "doc_id": result.doc_id,
        "regulation_issue_date": result.regulation_issue_date,
        "circular_effective_date": result.circular_effective_date,
        "regulator": result.regulator,
    }


@router.post("/ingest", response_model=IngestResponse)
async def ingest_document(
    file: UploadFile = File(...),
    force: bool = Query(False),
):
    """Upload and ingest a PDF."""
    from app_backend.routers.deps import get_ingestion_pipeline, get_retrieval_mode
    from config.settings import get_settings

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
