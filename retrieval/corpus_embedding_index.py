"""
Corpus-level embedding index for GOVINDA V2.

For corpus queries spanning 500+ documents, this pre-filters which
documents are relevant BEFORE running per-document retrieval.

Each document gets a single embedding derived from its description + top topics.
Query embedding is compared against all document embeddings to select top-N candidates.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class CorpusDocEmbedding:
    """Embedding entry for a single document in the corpus."""

    doc_id: str
    doc_name: str
    doc_description: str
    top_topics: list[str]
    total_pages: int
    node_count: int
    embedding: list[float]


@dataclass
class CorpusEmbeddingIndex:
    """Corpus-level document embedding index for pre-filtering."""

    entries: list[CorpusDocEmbedding] = field(default_factory=list)
    _matrix: Optional[np.ndarray] = field(default=None, repr=False)

    def _build_matrix(self) -> None:
        """Build numpy matrix from entries for fast search."""
        if self.entries:
            self._matrix = np.array([e.embedding for e in self.entries], dtype=np.float32)
            norms = np.linalg.norm(self._matrix, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            self._matrix = self._matrix / norms
        else:
            self._matrix = np.empty((0, 0), dtype=np.float32)

    def search(self, query_embedding: list[float], top_k: int = 10) -> list[tuple[str, float]]:
        """
        Return top-k (doc_id, score) pairs by cosine similarity.

        Args:
            query_embedding: The query's embedding vector.
            top_k: Number of top documents to return.

        Returns:
            List of (doc_id, similarity_score) tuples sorted by descending score.
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
            results.append((self.entries[i].doc_id, float(scores[i])))

        logger.info(
            "[BENCHMARK][corpus_prefilter] selected=%d/%d top_score=%.4f",
            len(results), len(self.entries),
            results[0][1] if results else 0.0,
        )

        return results

    def add_or_update(self, entry: CorpusDocEmbedding) -> None:
        """Add or update a document's embedding entry."""
        # Remove existing entry for this doc_id
        self.entries = [e for e in self.entries if e.doc_id != entry.doc_id]
        self.entries.append(entry)
        self._matrix = None  # Invalidate cached matrix

    def remove(self, doc_id: str) -> None:
        """Remove a document from the index."""
        self.entries = [e for e in self.entries if e.doc_id != doc_id]
        self._matrix = None

    def to_dict(self) -> dict:
        """Serialize to a JSON-compatible dict."""
        return {
            "entries": [
                {
                    "doc_id": e.doc_id,
                    "doc_name": e.doc_name,
                    "doc_description": e.doc_description,
                    "top_topics": e.top_topics,
                    "total_pages": e.total_pages,
                    "node_count": e.node_count,
                    "embedding": e.embedding,
                }
                for e in self.entries
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> CorpusEmbeddingIndex:
        """Deserialize from a dict."""
        idx = cls()
        for e in data.get("entries", []):
            idx.entries.append(
                CorpusDocEmbedding(
                    doc_id=e["doc_id"],
                    doc_name=e.get("doc_name", ""),
                    doc_description=e.get("doc_description", ""),
                    top_topics=e.get("top_topics", []),
                    total_pages=e.get("total_pages", 0),
                    node_count=e.get("node_count", 0),
                    embedding=e["embedding"],
                )
            )
        return idx
