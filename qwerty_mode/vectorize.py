"""
Cloudflare Vectorize REST client for qwerty_mode.

Implements the minimal surface needed by ingestion + query:
- ensure_index() — create the index if it does not exist
- upsert(vectors) — batch upsert
- query(vector, top_k) — semantic search
- delete(ids) — remove vectors when files are deleted

Uses ndjson endpoints per Cloudflare Vectorize V2 API.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Iterable

import urllib.request
import urllib.error

from qwerty_mode.config import get_qwerty_config

logger = logging.getLogger(__name__)

UPSERT_BATCH_SIZE = 100
QUERY_DEFAULT_TOP_K = 12


@dataclass
class VectorizeMatch:
    id: str
    score: float
    metadata: dict


def _api_base() -> str:
    cfg = get_qwerty_config()
    return (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{cfg.cf_account_id}/vectorize/v2/indexes"
    )


def _headers(content_type: str = "application/json") -> dict:
    cfg = get_qwerty_config()
    return {
        "Authorization": f"Bearer {cfg.cf_api_token}",
        "Content-Type": content_type,
    }


def _request(
    method: str, url: str, body: bytes | None = None, content_type: str = "application/json",
) -> dict:
    req = urllib.request.Request(url, data=body, method=method, headers=_headers(content_type))
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Vectorize API error {e.code}: {body_text}") from e
    return json.loads(payload) if payload else {}


def ensure_index() -> None:
    """Create the qwerty Vectorize index if it does not yet exist."""
    cfg = get_qwerty_config()
    url = f"{_api_base()}/{cfg.vectorize_index}"
    try:
        _request("GET", url)
        logger.info("[QWERTY][vectorize] Index %s exists", cfg.vectorize_index)
        return
    except RuntimeError as e:
        if "404" not in str(e):
            raise

    create_url = _api_base()
    body = json.dumps({
        "name": cfg.vectorize_index,
        "config": {"dimensions": cfg.embedding_dims, "metric": "cosine"},
    }).encode("utf-8")
    _request("POST", create_url, body)
    logger.info("[QWERTY][vectorize] Created index %s", cfg.vectorize_index)

    # Create required metadata indexes for filtering.
    for meta_field in ("file_id",):
        try:
            mi_url = f"{_api_base()}/{cfg.vectorize_index}/metadata_index/create"
            mi_body = json.dumps({"propertyName": meta_field, "indexType": "string"}).encode("utf-8")
            _request("POST", mi_url, mi_body)
        except RuntimeError as e:
            logger.warning("[QWERTY][vectorize] metadata index create skipped: %s", e)


def upsert(vectors: Iterable[dict]) -> None:
    """
    Upsert vectors. Each vector dict must contain:
        {"id": str, "values": list[float], "metadata": {...}}
    """
    cfg = get_qwerty_config()
    url = f"{_api_base()}/{cfg.vectorize_index}/upsert"

    batch: list[dict] = []
    total = 0
    for v in vectors:
        batch.append(v)
        if len(batch) >= UPSERT_BATCH_SIZE:
            _flush_upsert(url, batch)
            total += len(batch)
            batch = []
    if batch:
        _flush_upsert(url, batch)
        total += len(batch)
    logger.info("[QWERTY][vectorize] Upserted %d vectors", total)


def _flush_upsert(url: str, batch: list[dict]) -> None:
    ndjson = "\n".join(json.dumps(v) for v in batch).encode("utf-8")
    _request("POST", url, ndjson, content_type="application/x-ndjson")


def query(
    vector: list[float], top_k: int = QUERY_DEFAULT_TOP_K, file_ids: list[str] | None = None,
) -> list[VectorizeMatch]:
    """Semantic query against the qwerty index."""
    cfg = get_qwerty_config()
    url = f"{_api_base()}/{cfg.vectorize_index}/query"

    body_obj: dict[str, Any] = {
        "vector": vector,
        "topK": top_k,
        "returnMetadata": "all",
    }
    if file_ids:
        body_obj["filter"] = {"file_id": {"$in": file_ids}}
    body = json.dumps(body_obj).encode("utf-8")
    resp = _request("POST", url, body)
    matches_raw = (resp.get("result") or {}).get("matches") or []
    return [
        VectorizeMatch(
            id=m.get("id", ""),
            score=float(m.get("score", 0.0)),
            metadata=m.get("metadata") or {},
        )
        for m in matches_raw
    ]


def delete(ids: list[str]) -> None:
    if not ids:
        return
    cfg = get_qwerty_config()
    url = f"{_api_base()}/{cfg.vectorize_index}/delete_by_ids"
    body = json.dumps({"ids": ids}).encode("utf-8")
    _request("POST", url, body)
    logger.info("[QWERTY][vectorize] Deleted %d vectors", len(ids))
