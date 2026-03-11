"""
Query / RAG endpoints — single-doc query, record lookup, feedback.

Extracted from main.py as part of the backend modularization.
"""
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app_backend.models.schemas import QueryRequest, QueryResponse, FeedbackRequest
from models.query import QueryRecord
from models.conversation import ConversationMessage

logger = logging.getLogger("backend")

router = APIRouter(tags=["query"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/query", response_model=QueryResponse)
def run_query(request: QueryRequest):
    """Run a Q&A query."""
    from app_backend.routers.deps import (
        get_qa_engine, get_query_store, get_retrieval_mode,
        get_conversation_store, get_tree_store,
    )

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


@router.get("/query/{record_id}")
def get_query_record(record_id: str):
    """Get a past query record."""
    from app_backend.routers.deps import get_query_store

    store = get_query_store()
    record = store.load(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Query record not found")
    return record.to_dict()


@router.post("/query/{record_id}/feedback")
def submit_feedback(record_id: str, feedback: FeedbackRequest):
    """Submit feedback for a query answer."""
    from app_backend.routers.deps import get_query_store

    store = get_query_store()
    success = store.update_feedback(
        record_id,
        feedback_text=feedback.text,
        rating=feedback.rating,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Query record not found")
    return {"status": "ok", "record_id": record_id}
