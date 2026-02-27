"""
Semantic Query Cache for GOVINDA V2.

Caches query answers keyed by semantic similarity (not exact match).
If a new query is sufficiently similar to a cached query, returns
the cached answer immediately — zero LLM tokens.

Uses OpenAI text-embedding-3-small for query embedding + cosine similarity.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from config.settings import get_settings

logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    """A cached query-answer pair with its embedding."""

    query_text: str
    query_embedding: list[float]
    answer_dict: dict  # serialized Answer
    doc_id: str
    retrieval_mode: str
    timestamp: float
    hit_count: int = 0


class QueryCache:
    """
    In-memory semantic query cache with similarity-based lookup.

    Thread-safe. Entries are evicted LRU when max_entries is reached.
    """

    def __init__(
        self,
        similarity_threshold: Optional[float] = None,
        max_entries: Optional[int] = None,
    ) -> None:
        settings = get_settings()
        self._threshold = similarity_threshold or settings.optimization.cache_similarity_threshold
        self._max_entries = max_entries or settings.optimization.cache_max_entries
        self._entries: list[CacheEntry] = []
        self._lock = threading.Lock()

        # Stats
        self._hits = 0
        self._misses = 0

    def lookup(self, query_text: str, query_embedding: list[float], doc_id: str) -> Optional[dict]:
        """
        Look up a semantically similar cached answer.

        Args:
            query_text: The query text (for logging).
            query_embedding: The query's embedding vector.
            doc_id: The document ID to scope the cache.

        Returns:
            Cached answer dict if a similar query is found, else None.
        """
        with self._lock:
            if not self._entries:
                self._misses += 1
                return None

            # Filter entries by doc_id
            candidates = [e for e in self._entries if e.doc_id == doc_id]
            if not candidates:
                self._misses += 1
                return None

            # Build matrix of candidate embeddings
            matrix = np.array([e.query_embedding for e in candidates], dtype=np.float32)
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            matrix = matrix / norms

            q = np.array(query_embedding, dtype=np.float32)
            q_norm = np.linalg.norm(q)
            if q_norm > 0:
                q = q / q_norm

            scores = matrix @ q
            best_idx = int(np.argmax(scores))
            best_score = float(scores[best_idx])

            if best_score >= self._threshold:
                entry = candidates[best_idx]
                entry.hit_count += 1
                self._hits += 1
                logger.info(
                    "[BENCHMARK][query_cache] HIT sim=%.4f query='%s' cached_query='%s'",
                    best_score, query_text[:40], entry.query_text[:40],
                )
                return entry.answer_dict
            else:
                self._misses += 1
                logger.info(
                    "[BENCHMARK][query_cache] MISS best_sim=%.4f (threshold=%.2f) query='%s'",
                    best_score, self._threshold, query_text[:40],
                )
                return None

    def store(
        self,
        query_text: str,
        query_embedding: list[float],
        answer_dict: dict,
        doc_id: str,
        retrieval_mode: str = "optimized",
    ) -> None:
        """Store a query-answer pair in the cache."""
        with self._lock:
            # Evict oldest if at capacity
            if len(self._entries) >= self._max_entries:
                # Remove least recently used (lowest hit_count, oldest timestamp)
                self._entries.sort(key=lambda e: (e.hit_count, e.timestamp))
                removed = self._entries.pop(0)
                logger.debug("[query_cache] Evicted: '%s'", removed.query_text[:40])

            self._entries.append(CacheEntry(
                query_text=query_text,
                query_embedding=query_embedding,
                answer_dict=answer_dict,
                doc_id=doc_id,
                retrieval_mode=retrieval_mode,
                timestamp=time.time(),
            ))
            logger.info(
                "[BENCHMARK][query_cache] STORED query='%s' doc=%s entries=%d",
                query_text[:40], doc_id, len(self._entries),
            )

    def invalidate_doc(self, doc_id: str) -> int:
        """Remove all cache entries for a document. Returns count removed."""
        with self._lock:
            before = len(self._entries)
            self._entries = [e for e in self._entries if e.doc_id != doc_id]
            removed = before - len(self._entries)
            if removed:
                logger.info(
                    "[BENCHMARK][cache_invalidate] reason=reingestion doc=%s entries_removed=%d",
                    doc_id, removed,
                )
            return removed

    def invalidate_all(self, reason: str = "settings_change") -> int:
        """Clear the entire cache. Returns count removed."""
        with self._lock:
            count = len(self._entries)
            self._entries.clear()
            logger.info(
                "[BENCHMARK][cache_invalidate] reason=%s entries_removed=%d",
                reason, count,
            )
            return count

    def get_stats(self) -> dict:
        """Return cache statistics."""
        with self._lock:
            total = self._hits + self._misses
            return {
                "entries": len(self._entries),
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(self._hits / max(total, 1), 3),
                "max_entries": self._max_entries,
                "threshold": self._threshold,
            }
