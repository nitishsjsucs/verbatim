"""
Embedding helper for qwerty_mode.

Thin wrapper over govinda's EmbeddingClient pinned to the qwerty config.
Kept separate so legacy/optimized usage is unaffected.
"""

from __future__ import annotations

from utils.embedding_client import EmbeddingClient

from qwerty_mode.config import get_qwerty_config


def get_embedder() -> EmbeddingClient:
    cfg = get_qwerty_config()
    return EmbeddingClient(model=cfg.embedding_model)


def embed_query(text: str) -> list[float]:
    return get_embedder().embed(text)


def embed_chunks(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    return get_embedder().embed_batch(texts)
