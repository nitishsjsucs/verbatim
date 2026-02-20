print("LOADING BACKEND MAIN --------------------------------------------------")
import sys
import os
import shutil
import logging
import uuid
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
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
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
def get_tree_store():
    return TreeStore()


def get_qa_engine():
    return QAEngine()


def get_ingestion_pipeline():
    return IngestionPipeline()


def get_query_store():
    return QueryStore()


def get_corpus_store():
    return CorpusStore()


def get_corpus_qa_engine():
    return CorpusQAEngine()


def get_actionable_store():
    return ActionableStore()


def get_actionable_extractor():
    return ActionableExtractor()


def get_conversation_store():
    return ConversationStore()


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
    """List all indexed documents."""
    store = get_tree_store()
    doc_ids = store.list_trees()
    docs = []
    for doc_id in doc_ids:
        tree = store.load(doc_id)
        if tree:
            docs.append(
                {
                    "id": tree.doc_id,
                    "name": tree.doc_name,
                    "pages": tree.total_pages,
                    "nodes": tree.node_count,
                    "description": tree.doc_description,
                }
            )
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

    grid_out = fs.find_one({"filename": tree.doc_name})

    if not grid_out:
        # Fallback: try serving from local disk
        settings = get_settings()
        local_path = settings.storage.trees_dir.parent / "pdfs" / tree.doc_name
        if local_path.exists():
            return FileResponse(
                str(local_path),
                media_type="application/pdf",
                headers={"Content-Disposition": f"inline; filename={tree.doc_name}"},
            )
        raise HTTPException(
            status_code=404, detail=f"PDF file not found: {tree.doc_name}"
        )

    return StreamingResponse(
        grid_out,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={tree.doc_name}"},
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
    return {
        "model": settings.llm.model,
        "model_pro": settings.llm.model_pro,
        "max_located_nodes": settings.retrieval.max_located_nodes,
        "retrieval_token_budget": settings.retrieval.retrieval_token_budget,
        "max_cross_ref_depth": settings.retrieval.max_cross_ref_depth,
        "context_expansion_siblings": settings.retrieval.context_expansion_siblings,
    }


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
                "doc_id": getattr(c, "_doc_id", ""),
                "doc_name": getattr(c, "_doc_name", ""),
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
                "doc_id": getattr(s, "_doc_id", ""),
                "doc_name": getattr(s, "_doc_name", ""),
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
