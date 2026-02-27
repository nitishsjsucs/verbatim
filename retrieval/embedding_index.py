"""
Embedding-based pre-filter for GOVINDA V2.

Replaces sending the full tree index to the LLM. Instead:
1. At ingestion: embed each node's summary + title
2. At query time: embed query, find top-N candidates by cosine similarity
3. Only send those candidates to the LLM Locator

Uses OpenAI text-embedding-3-small (1536-dim, $0.02/1M tokens).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class NodeEmbedding:
    """Embedding entry for a single document tree node."""

    node_id: str
    doc_id: str
    title: str
    summary: str
    level: int
    page_range: str
    token_count: int
    embedding: list[float]


@dataclass
class EmbeddingIndex:
    """Per-document embedding index for node pre-filtering."""

    doc_id: str
    entries: list[NodeEmbedding] = field(default_factory=list)
    _matrix: Optional[np.ndarray] = field(default=None, repr=False)

    def _build_matrix(self) -> None:
        """Build numpy matrix from entries for fast search."""
        if self.entries:
            self._matrix = np.array([e.embedding for e in self.entries], dtype=np.float32)
            # Normalize rows for cosine similarity via dot product
            norms = np.linalg.norm(self._matrix, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            self._matrix = self._matrix / norms
        else:
            self._matrix = np.empty((0, 0), dtype=np.float32)

    def search(self, query_embedding: list[float], top_k: int = 30) -> list[str]:
        """
        Return top-k node_ids by cosine similarity to the query embedding.

        Args:
            query_embedding: The query's embedding vector.
            top_k: Number of top candidates to return.

        Returns:
            List of node_ids sorted by descending similarity.
        """
        if not self.entries:
            return []

        if self._matrix is None:
            self._build_matrix()

        q = np.array(query_embedding, dtype=np.float32)
        q_norm = np.linalg.norm(q)
        if q_norm > 0:
            q = q / q_norm

        scores = self._matrix @ q
        top_indices = np.argsort(scores)[::-1][:top_k]

        results = []
        for i in top_indices:
            results.append(self.entries[i].node_id)
            logger.debug(
                "  Pre-filter candidate: %s (score=%.4f) %s",
                self.entries[i].node_id, scores[i], self.entries[i].title[:60],
            )

        logger.info(
            "[BENCHMARK][prefilter] candidates=%d/%d top_score=%.4f",
            len(results), len(self.entries),
            float(scores[top_indices[0]]) if len(top_indices) > 0 else 0.0,
        )

        return results

    def add_entry(self, entry: NodeEmbedding) -> None:
        """Add a node embedding entry and invalidate cached matrix."""
        self.entries.append(entry)
        self._matrix = None  # Force rebuild on next search

    def to_dict(self) -> dict:
        """Serialize to a JSON-compatible dict."""
        return {
            "doc_id": self.doc_id,
            "entries": [
                {
                    "node_id": e.node_id,
                    "title": e.title,
                    "summary": e.summary,
                    "level": e.level,
                    "page_range": e.page_range,
                    "token_count": e.token_count,
                    "embedding": e.embedding,
                }
                for e in self.entries
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> EmbeddingIndex:
        """Deserialize from a dict."""
        idx = cls(doc_id=data["doc_id"])
        for e in data.get("entries", []):
            idx.entries.append(
                NodeEmbedding(
                    node_id=e["node_id"],
                    doc_id=data["doc_id"],
                    title=e["title"],
                    summary=e.get("summary", ""),
                    level=e.get("level", 0),
                    page_range=e.get("page_range", ""),
                    token_count=e.get("token_count", 0),
                    embedding=e["embedding"],
                )
            )
        return idx

    def save(self, path: Path) -> None:
        """Persist to a JSON file."""
        path.write_text(json.dumps(self.to_dict()))
        logger.info("Embedding index saved: %s (%d entries)", path, len(self.entries))

    @classmethod
    def load(cls, path: Path) -> EmbeddingIndex:
        """Load from a JSON file."""
        data = json.loads(path.read_text())
        idx = cls.from_dict(data)
        logger.info("Embedding index loaded: %s (%d entries)", path, len(idx.entries))
        return idx
