"""
R2R Hybrid Fallback for GOVINDA V2 — Loop 5: "Safety Net Search"

R2R-inspired hybrid search fallback that runs parallel to the LLM Locator.
Provides a secondary retrieval path using vector similarity + keyword matching
to catch nodes the LLM Locator might miss.

The fallback NEVER replaces the Locator — it supplements it:
- Results found by both Locator and R2R get highest priority
- R2R-only results are added as "fallback candidates" 
- Locator-only results remain unchanged

Only active when retrieval_mode='optimized' AND enable_r2r_fallback=True.
"""

from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from config.settings import get_settings

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """A single search result from the fallback engine."""
    node_id: str
    score: float  # 0.0 – 1.0
    source: str  # "vector", "keyword", or "hybrid"
    matched_terms: list[str] = field(default_factory=list)


class R2RFallback:
    """
    R2R-inspired hybrid search engine for GOVINDA V2.

    Provides two complementary search modes:
    1. Vector search — cosine similarity over node embeddings
    2. Keyword search — BM25-style term matching over node text

    Results are fused using Reciprocal Rank Fusion (RRF) and mapped back
    to the tree's node_ids for integration with the main pipeline.

    Usage:
        r2r = R2RFallback("doc_123")
        r2r.build_index(tree, embedding_client)
        results = r2r.search(query_text, embedding_client, top_k=10)
    """

    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self._settings = get_settings()

        # Vector index
        self._node_ids: list[str] = []
        self._embeddings: Optional[np.ndarray] = None  # (N, dim)

        # Keyword index (BM25-style)
        self._node_texts: dict[str, str] = {}  # node_id -> concatenated searchable text
        self._term_freq: dict[str, dict[str, int]] = {}  # node_id -> {term: count}
        self._doc_freq: dict[str, int] = defaultdict(int)  # term -> num nodes containing it
        self._avg_doc_len: float = 0.0
        self._doc_lengths: dict[str, int] = {}  # node_id -> total terms

        self._built = False
        self._lock = threading.Lock()

    def build_index(
        self,
        tree: Any,  # DocumentTree
        embedding_client: Any,
        force: bool = False,
    ) -> None:
        """
        Build both vector and keyword indexes from the document tree.

        Only embeds leaf and low-level nodes to save API cost.
        """
        if self._built and not force:
            logger.info("[R2R] Index already built for %s", self.doc_id)
            return

        with self._lock:
            all_nodes = tree._all_nodes() if hasattr(tree, "_all_nodes") else []
            if not all_nodes:
                logger.warning("[R2R] No nodes in tree %s", self.doc_id)
                return

            # Filter to indexable nodes (leaf/low-level with text)
            indexable = [
                n for n in all_nodes
                if n.text and len(n.text.strip()) > 20
            ]

            if not indexable:
                logger.warning("[R2R] No indexable nodes in tree %s", self.doc_id)
                return

            logger.info("[R2R] Building index: %d nodes for doc %s", len(indexable), self.doc_id)

            # 1. Build vector index
            self._node_ids = [n.node_id for n in indexable]
            texts_for_embedding = []
            for n in indexable:
                # Combine title + summary + first ~500 chars of text for embedding
                embed_text = f"{n.title}. {n.summary or ''}. {n.text[:500]}"
                texts_for_embedding.append(embed_text)

            try:
                embeddings = embedding_client.embed_batch(texts_for_embedding)
                self._embeddings = np.array(embeddings, dtype=np.float32)
                # Normalize
                norms = np.linalg.norm(self._embeddings, axis=1, keepdims=True)
                norms = np.where(norms == 0, 1, norms)
                self._embeddings = self._embeddings / norms
            except Exception as e:
                logger.error("[R2R] Vector index build failed: %s", e)
                self._embeddings = None

            # 2. Build keyword index (BM25-style)
            self._term_freq.clear()
            self._doc_freq.clear()
            self._doc_lengths.clear()

            total_len = 0
            for n in indexable:
                # Searchable text: title + topics + summary + text
                search_text = " ".join([
                    n.title or "",
                    " ".join(n.topics) if n.topics else "",
                    n.summary or "",
                    n.text or "",
                ]).lower()
                self._node_texts[n.node_id] = search_text

                terms = self._tokenize(search_text)
                self._doc_lengths[n.node_id] = len(terms)
                total_len += len(terms)

                tf: dict[str, int] = defaultdict(int)
                seen_terms: set[str] = set()
                for term in terms:
                    tf[term] += 1
                    if term not in seen_terms:
                        self._doc_freq[term] += 1
                        seen_terms.add(term)

                self._term_freq[n.node_id] = dict(tf)

            self._avg_doc_len = total_len / max(len(indexable), 1)
            self._built = True

            logger.info(
                "[R2R] Index built: %d nodes, %d unique terms, embeddings=%s",
                len(indexable), len(self._doc_freq),
                self._embeddings.shape if self._embeddings is not None else "None",
            )

    def _tokenize(self, text: str) -> list[str]:
        """Simple tokenizer — lowercase, split on non-alphanumeric, filter short."""
        tokens = re.findall(r'[a-z0-9]+', text.lower())
        return [t for t in tokens if len(t) > 2]  # Skip very short tokens

    def search(
        self,
        query_text: str,
        embedding_client: Any = None,
        top_k: int = 10,
        vector_weight: float = 0.6,
        keyword_weight: float = 0.4,
    ) -> list[SearchResult]:
        """
        Hybrid search combining vector similarity and BM25 keyword matching.

        Uses Reciprocal Rank Fusion (RRF) to merge results from both modes.

        Args:
            query_text: The user query
            embedding_client: For generating query embedding
            top_k: Number of results to return
            vector_weight: Weight for vector search results (0-1)
            keyword_weight: Weight for keyword search results (0-1)

        Returns:
            List of SearchResult sorted by fused score
        """
        if not self._built:
            logger.warning("[R2R] Index not built for %s", self.doc_id)
            return []

        with self._lock:
            vector_results = []
            keyword_results = []

            # 1. Vector search
            if self._embeddings is not None and embedding_client:
                try:
                    q_emb = np.array(
                        embedding_client.embed(query_text), dtype=np.float32
                    )
                    q_emb = q_emb / (np.linalg.norm(q_emb) or 1.0)
                    sims = self._embeddings @ q_emb

                    # Get top candidates
                    k = min(top_k * 2, len(self._node_ids))
                    top_indices = np.argsort(sims)[-k:][::-1]

                    for rank, idx in enumerate(top_indices):
                        if sims[idx] > 0.3:  # Minimum similarity threshold
                            vector_results.append(SearchResult(
                                node_id=self._node_ids[idx],
                                score=float(sims[idx]),
                                source="vector",
                            ))
                except Exception as e:
                    logger.warning("[R2R] Vector search failed: %s", e)

            # 2. Keyword search (BM25)
            keyword_results = self._bm25_search(query_text, top_k * 2)

            # 3. Reciprocal Rank Fusion
            fused = self._rrf_merge(vector_results, keyword_results, vector_weight, keyword_weight)

            return fused[:top_k]

    def _bm25_search(self, query_text: str, top_k: int) -> list[SearchResult]:
        """BM25 keyword search over indexed node texts."""
        query_terms = self._tokenize(query_text)
        if not query_terms:
            return []

        k1 = 1.5  # Term frequency saturation parameter
        b = 0.75  # Length normalization parameter
        n_docs = len(self._node_ids)

        scores: dict[str, float] = defaultdict(float)
        matched_terms_map: dict[str, list[str]] = defaultdict(list)

        for term in query_terms:
            df = self._doc_freq.get(term, 0)
            if df == 0:
                continue

            # IDF component
            idf = max(0, (n_docs - df + 0.5) / (df + 0.5))
            idf = max(idf, 0.01)  # Floor to avoid log(0)
            import math
            idf = math.log(1 + idf)

            for nid in self._node_ids:
                tf = self._term_freq.get(nid, {}).get(term, 0)
                if tf == 0:
                    continue

                doc_len = self._doc_lengths.get(nid, 1)
                # BM25 score component
                numerator = tf * (k1 + 1)
                denominator = tf + k1 * (1 - b + b * doc_len / max(self._avg_doc_len, 1))
                scores[nid] += idf * numerator / denominator
                if term not in matched_terms_map[nid]:
                    matched_terms_map[nid].append(term)

        if not scores:
            return []

        # Normalize scores to 0-1 range
        max_score = max(scores.values()) or 1.0
        results = []
        for nid, score in sorted(scores.items(), key=lambda x: -x[1])[:top_k]:
            results.append(SearchResult(
                node_id=nid,
                score=round(score / max_score, 4),
                source="keyword",
                matched_terms=matched_terms_map[nid],
            ))

        return results

    def _rrf_merge(
        self,
        vector_results: list[SearchResult],
        keyword_results: list[SearchResult],
        vector_weight: float,
        keyword_weight: float,
        k: int = 60,  # RRF constant
    ) -> list[SearchResult]:
        """
        Reciprocal Rank Fusion — merge two ranked lists.

        RRF_score(d) = w_v / (k + rank_v(d)) + w_k / (k + rank_k(d))
        """
        rrf_scores: dict[str, float] = defaultdict(float)
        best_source: dict[str, str] = {}
        all_terms: dict[str, list[str]] = defaultdict(list)

        # Vector rankings
        for rank, r in enumerate(vector_results):
            rrf_scores[r.node_id] += vector_weight / (k + rank + 1)
            if r.node_id not in best_source:
                best_source[r.node_id] = "vector"

        # Keyword rankings
        for rank, r in enumerate(keyword_results):
            rrf_scores[r.node_id] += keyword_weight / (k + rank + 1)
            all_terms[r.node_id] = r.matched_terms
            if r.node_id in best_source:
                best_source[r.node_id] = "hybrid"  # Found in both!
            else:
                best_source[r.node_id] = "keyword"

        if not rrf_scores:
            return []

        # Normalize and create results
        max_rrf = max(rrf_scores.values()) or 1.0
        fused = []
        for nid, score in sorted(rrf_scores.items(), key=lambda x: -x[1]):
            fused.append(SearchResult(
                node_id=nid,
                score=round(score / max_rrf, 4),
                source=best_source.get(nid, "hybrid"),
                matched_terms=all_terms.get(nid, []),
            ))

        return fused

    def merge_with_locator(
        self,
        locator_node_ids: list[str],
        fallback_results: list[SearchResult],
        max_fallback_additions: int = 3,
    ) -> dict:
        """
        Merge R2R fallback results with the Locator's results.

        Returns:
            {
                "merged_node_ids": [...],  # Final ordered list
                "confirmed": [...],  # In both Locator and R2R (highest priority)
                "locator_only": [...],  # Locator found, R2R didn't
                "fallback_additions": [...],  # R2R found, Locator missed
            }
        """
        locator_set = set(locator_node_ids)
        fallback_map = {r.node_id: r for r in fallback_results}

        confirmed = []
        locator_only = []
        fallback_additions = []

        # Classify locator results
        for nid in locator_node_ids:
            if nid in fallback_map:
                confirmed.append(nid)
            else:
                locator_only.append(nid)

        # Find R2R-only nodes (not in Locator results) with high enough score
        for r in fallback_results:
            if r.node_id not in locator_set and r.score > 0.5:
                fallback_additions.append(r.node_id)

        # Cap fallback additions to avoid noise
        fallback_additions = fallback_additions[:max_fallback_additions]

        # Merged order: confirmed first, then locator-only, then fallback
        merged = confirmed + locator_only + fallback_additions

        logger.info(
            "[R2R] Merge: confirmed=%d locator_only=%d fallback_added=%d total=%d",
            len(confirmed), len(locator_only), len(fallback_additions), len(merged),
        )

        return {
            "merged_node_ids": merged,
            "confirmed": confirmed,
            "locator_only": locator_only,
            "fallback_additions": fallback_additions,
        }

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, db: Any) -> None:
        """Persist keyword index and metadata to MongoDB. Embeddings saved separately."""
        meta = {
            "_id": self.doc_id,
            "doc_id": self.doc_id,
            "node_ids": self._node_ids,
            "avg_doc_len": self._avg_doc_len,
            "doc_lengths": self._doc_lengths,
            "doc_freq": dict(self._doc_freq),
            "built": self._built,
        }
        db["r2r_index"].replace_one({"_id": self.doc_id}, meta, upsert=True)

        # Save term frequencies (can be large, so separate collection)
        tf_doc = {
            "_id": self.doc_id,
            "term_freq": self._term_freq,
        }
        db["r2r_term_freq"].replace_one({"_id": self.doc_id}, tf_doc, upsert=True)

        # Save embeddings as binary (numpy)
        if self._embeddings is not None:
            emb_bytes = self._embeddings.tobytes()
            shape = list(self._embeddings.shape)
            db["r2r_embeddings"].replace_one(
                {"_id": self.doc_id},
                {
                    "_id": self.doc_id,
                    "shape": shape,
                    "dtype": str(self._embeddings.dtype),
                    "data": emb_bytes,
                },
                upsert=True,
            )

        logger.info(
            "[R2R] Saved index for doc=%s: %d nodes", self.doc_id, len(self._node_ids)
        )

    @classmethod
    def load(cls, doc_id: str, db: Any) -> Optional["R2RFallback"]:
        """Load from MongoDB."""
        meta = db["r2r_index"].find_one({"_id": doc_id})
        if not meta:
            return None

        r2r = cls(doc_id=doc_id)
        r2r._node_ids = meta.get("node_ids", [])
        r2r._avg_doc_len = meta.get("avg_doc_len", 0.0)
        r2r._doc_lengths = meta.get("doc_lengths", {})
        r2r._doc_freq = defaultdict(int, meta.get("doc_freq", {}))
        r2r._built = meta.get("built", False)

        # Load term frequencies
        tf_doc = db["r2r_term_freq"].find_one({"_id": doc_id})
        if tf_doc:
            r2r._term_freq = tf_doc.get("term_freq", {})

        # Load embeddings
        emb_doc = db["r2r_embeddings"].find_one({"_id": doc_id})
        if emb_doc and "data" in emb_doc:
            shape = tuple(emb_doc["shape"])
            dtype = emb_doc.get("dtype", "float32")
            r2r._embeddings = np.frombuffer(emb_doc["data"], dtype=dtype).reshape(shape)

        logger.info(
            "[R2R] Loaded index for doc=%s: %d nodes, embeddings=%s",
            doc_id, len(r2r._node_ids),
            r2r._embeddings.shape if r2r._embeddings is not None else "None",
        )
        return r2r

    def get_stats(self) -> dict:
        """Return index statistics."""
        return {
            "doc_id": self.doc_id,
            "built": self._built,
            "total_nodes": len(self._node_ids),
            "unique_terms": len(self._doc_freq),
            "avg_doc_len": round(self._avg_doc_len, 1),
            "has_embeddings": self._embeddings is not None,
            "embedding_shape": (
                list(self._embeddings.shape) if self._embeddings is not None else None
            ),
        }
