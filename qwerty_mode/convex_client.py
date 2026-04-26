"""
Convex HTTP client for qwerty_mode.

The Python backend pushes ingestion results to Convex via the HTTP actions
defined in convex_qwerty/http.ts. The frontend (web/src/app/qwerty) reads
that data live via Convex react hooks — same pattern qwerty uses.

We use HTTP actions (not the convex Python SDK) because:
- Avoids the convex Python SDK dependency.
- Mirrors qwerty's pattern of server-side workers writing via HTTP.
- Lets us authenticate with a single deploy key.
"""

from __future__ import annotations

import json
import logging
import urllib.request
import urllib.error
from typing import Any

from qwerty_mode.config import get_qwerty_config

logger = logging.getLogger(__name__)


def _post(path: str, payload: dict) -> dict:
    cfg = get_qwerty_config()
    base = cfg.convex_http_url or cfg.convex_url
    if not base:
        raise RuntimeError("QWERTY_CONVEX_URL not set")
    url = f"{base.rstrip('/')}{cfg.convex_http_path}{path}"
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if cfg.convex_deploy_key:
        headers["Authorization"] = f"Bearer {cfg.convex_deploy_key}"
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Convex HTTP {e.code}: {detail}") from e
    return json.loads(text) if text else {}


# ── File records ───────────────────────────────────────────────────

def insert_file(
    file_id: str,
    filename: str,
    r2_key: str,
    page_count: int,
    chunk_count: int,
    size_bytes: int,
) -> dict:
    return _post(
        "/files/insert",
        {
            "fileId": file_id,
            "filename": filename,
            "r2Key": r2_key,
            "pageCount": page_count,
            "chunkCount": chunk_count,
            "sizeBytes": size_bytes,
            "status": "ready",
        },
    )


def update_file_status(file_id: str, status: str, error: str | None = None) -> dict:
    return _post(
        "/files/status",
        {"fileId": file_id, "status": status, "error": error or ""},
    )


# ── Chunks ─────────────────────────────────────────────────────────

def insert_chunks(file_id: str, chunks: list[dict]) -> dict:
    """Bulk insert chunks. Each chunk: {chunkId, seq, text, pageStart, pageEnd, tokenCount}."""
    return _post("/chunks/bulkInsert", {"fileId": file_id, "chunks": chunks})


def get_chunks_by_ids(chunk_ids: list[str]) -> list[dict]:
    res = _post("/chunks/getByIds", {"chunkIds": chunk_ids})
    return res.get("chunks", []) if isinstance(res, dict) else []


# ── Conversations / messages ──────────────────────────────────────

def append_message(conversation_id: str, role: str, text: str, citations: list[dict] | None = None) -> dict:
    return _post(
        "/messages/append",
        {
            "conversationId": conversation_id,
            "role": role,
            "text": text,
            "citations": citations or [],
        },
    )
