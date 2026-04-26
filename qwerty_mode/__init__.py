"""
qwerty_mode — parallel RAG pipeline modeled on the qwerty (Lunar) project.

This module is fully isolated from govinda's legacy and optimized retrieval
modes. It uses Cloudflare R2 for file storage, Cloudflare Vectorize for
semantic retrieval, and Convex for live data.

Documents ingested through qwerty mode do NOT appear in legacy/optimized
flows, and vice versa. All env vars are prefixed `QWERTY_` to avoid any
collision with the actual qwerty repo's env vars.
"""

from __future__ import annotations

__all__ = ["config", "chunker", "embeddings", "vectorize", "r2", "convex_client", "ingestion", "qa", "api"]
