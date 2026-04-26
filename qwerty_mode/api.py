"""
FastAPI router for qwerty_mode.

Mounted at /qwerty/* by app_backend/main.py. Fully isolated from
legacy/optimized routes — does not import from agents/, retrieval/,
or memory/.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from qwerty_mode import ingestion, qa, r2 as r2_client
from qwerty_mode.config import assert_qwerty_ready

logger = logging.getLogger("qwerty_mode.api")

router = APIRouter(prefix="/qwerty", tags=["qwerty_mode"])


class QueryRequest(BaseModel):
    question: str
    file_ids: Optional[list[str]] = None


@router.get("/health")
def health() -> dict:
    try:
        assert_qwerty_ready()
        return {"status": "ok", "configured": True}
    except RuntimeError as e:
        return {"status": "not_configured", "configured": False, "detail": str(e)}


@router.post("/ingest")
async def ingest_endpoint(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename required")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty file")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only PDF supported in qwerty mode MVP")

    try:
        result = ingestion.ingest_pdf(file.filename, content)
    except Exception as e:
        logger.exception("[QWERTY] ingest failed")
        raise HTTPException(status_code=500, detail=str(e)) from e

    return {
        "file_id": result.file_id,
        "filename": result.filename,
        "r2_key": result.r2_key,
        "page_count": result.page_count,
        "chunk_count": result.chunk_count,
        "size_bytes": result.size_bytes,
    }


@router.post("/query")
def query_endpoint(req: QueryRequest) -> dict:
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question is empty")
    try:
        ans = qa.answer_question(req.question, file_ids=req.file_ids)
    except Exception as e:
        logger.exception("[QWERTY] query failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return qa.answer_to_dict(ans)


@router.get("/files/{file_id}/url")
def file_url(file_id: str, filename: str) -> dict:
    """Return a presigned R2 GET URL for the original PDF."""
    key = f"qwerty/{file_id}/{filename}"
    try:
        url = r2_client.presigned_get_url(key)
    except Exception as e:
        logger.exception("[QWERTY] presign failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"url": url, "key": key, "expires_in": 3600}
