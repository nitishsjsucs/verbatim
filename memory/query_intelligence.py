"""
Query Intelligence for GOVINDA V2 — Loop 3: "Remember What Worked"

SimpleMem-inspired persistent query learning system.
Learns retrieval patterns from completed queries:
- Which nodes were cited vs. just located (precision)
- Whether reflection/verification added value
- What query types map to what retrieval strategies

Only active when retrieval_mode='optimized' AND enable_query_intelligence=True.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np

from config.settings import get_settings

logger = logging.getLogger(__name__)


@dataclass
class RetrievalFact:
    """A learned fact about retrieval performance for a specific pattern."""
    fact_id: str
    query_type: str
    query_text_summary: str  # First 150 chars of query
    doc_id: str
    timestamp: str

    # Retrieval quality signals
    cited_nodes: list[str]
    located_nodes: list[str]
    wasted_nodes: list[str]  # located but not cited
    precision: float  # cited / located

    # Pipeline performance signals
    reflect_helped: bool
    verification_status: str
    user_rating: Optional[int]
    total_time_s: float

    # Key terms that led to good retrieval
    key_terms: list[str]

    # Embedding for semantic search
    embedding: Optional[list[float]] = None


class QueryIntelligence:
    """
    Persistent query intelligence store.

    After each query:
    - Extract retrieval quality facts
    - Build retrieval pattern database
    - Track node citation frequency per query type

    Before each query:
    - Search for similar past queries
    - Provide hints: boost nodes, skip reflection, skip verification
    - Predict likely query type
    """

    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self._settings = get_settings()

        # Core storage
        self._facts: list[RetrievalFact] = []
        self._max_facts = 500  # Per document

        # Aggregated intelligence
        self._node_citation_freq: dict[str, int] = defaultdict(int)  # node_id -> citation count
        self._node_waste_freq: dict[str, int] = defaultdict(int)  # node_id -> wasted count
        self._type_reflect_stats: dict[str, dict] = defaultdict(
            lambda: {"helped": 0, "total": 0}
        )
        self._type_verify_stats: dict[str, dict] = defaultdict(
            lambda: {"clean": 0, "total": 0}
        )
        self._avg_precision_by_type: dict[str, list[float]] = defaultdict(list)

        # Embedding index for semantic fact search
        self._fact_embeddings: Optional[np.ndarray] = None
        self._lock = threading.Lock()

    def learn_from_query(
        self,
        record: Any,  # QueryRecord
        embedding_client: Any = None,
    ) -> None:
        """Extract and store retrieval intelligence from a completed query."""
        try:
            # Extract signals from the QueryRecord
            cited_nodes = list({c.node_id for c in getattr(record, "citations", [])})
            located_nodes = []
            if record.routing_log:
                located_nodes = [
                    r.get("node_id", "") for r in record.routing_log.locate_results
                ]
            wasted = list(set(located_nodes) - set(cited_nodes))
            precision = len(cited_nodes) / max(len(located_nodes), 1)

            # Determine if reflection helped
            reflect_helped = False
            if record.routing_log:
                reflect_sections = [
                    r for r in record.routing_log.read_results
                    if r.get("source", "") == "reflection_gap_fill"
                ]
                reflection_cited = sum(
                    1 for r in reflect_sections if r.get("node_id") in cited_nodes
                )
                reflect_helped = reflection_cited > 0

            query_type = record.query_type.value if hasattr(record.query_type, "value") else str(record.query_type)

            fact = RetrievalFact(
                fact_id=f"fact_{int(time.time() * 1000)}",
                query_type=query_type,
                query_text_summary=record.query_text[:150],
                doc_id=self.doc_id,
                timestamp=datetime.now(timezone.utc).isoformat(),
                cited_nodes=cited_nodes,
                located_nodes=located_nodes,
                wasted_nodes=wasted,
                precision=round(precision, 3),
                reflect_helped=reflect_helped,
                verification_status=record.verification_status or "",
                user_rating=record.feedback.rating if record.feedback else None,
                total_time_s=record.total_time_seconds,
                key_terms=record.key_terms,
            )

            # Embed the fact for future semantic search
            if embedding_client:
                try:
                    fact_text = (
                        f"{query_type}: {record.query_text[:100]}. "
                        f"Key terms: {', '.join(record.key_terms[:5])}. "
                        f"Cited: {', '.join(cited_nodes[:5])}."
                    )
                    fact.embedding = embedding_client.embed(fact_text)
                except Exception as e:
                    logger.warning("[QueryIntel] Embedding failed: %s", e)

            with self._lock:
                self._facts.append(fact)

                # Update aggregated stats
                for nid in cited_nodes:
                    self._node_citation_freq[nid] += 1
                for nid in wasted:
                    self._node_waste_freq[nid] += 1

                self._type_reflect_stats[query_type]["total"] += 1
                if reflect_helped:
                    self._type_reflect_stats[query_type]["helped"] += 1

                self._type_verify_stats[query_type]["total"] += 1
                if record.verification_status in ("verified", "confidence_skip"):
                    self._type_verify_stats[query_type]["clean"] += 1

                self._avg_precision_by_type[query_type].append(precision)

                # Cap facts
                if len(self._facts) > self._max_facts:
                    self._facts = self._facts[-self._max_facts:]

                # Rebuild embedding index
                self._rebuild_embedding_index()

            logger.info(
                "[QueryIntel] Learned from query: type=%s precision=%.2f cited=%d wasted=%d reflect_helped=%s",
                query_type, precision, len(cited_nodes), len(wasted), reflect_helped,
            )

        except Exception as e:
            logger.error("[QueryIntel] Failed to learn from query: %s", e)

    def _rebuild_embedding_index(self) -> None:
        """Rebuild the numpy embedding matrix for fast search."""
        embeddings = [f.embedding for f in self._facts if f.embedding]
        if embeddings:
            self._fact_embeddings = np.array(embeddings, dtype=np.float32)
            # Normalize
            norms = np.linalg.norm(self._fact_embeddings, axis=1, keepdims=True)
            norms = np.where(norms == 0, 1, norms)
            self._fact_embeddings = self._fact_embeddings / norms
        else:
            self._fact_embeddings = None

    def get_retrieval_hints(
        self,
        query_text: str,
        query_type: str = "",
        embedding_client: Any = None,
        top_k: int = 5,
    ) -> dict:
        """
        Search past query intelligence for retrieval guidance.

        Returns hints that the QA engine can use to optimize the pipeline:
        - suggested_nodes: nodes that historically worked for similar queries
        - avoid_nodes: nodes frequently located but never cited
        - skip_reflection: if reflection rarely helps for this type
        - skip_verification: if verification always passes for this type
        - avg_precision: historical precision for this query type
        """
        hints = {
            "suggested_nodes": [],
            "avoid_nodes": [],
            "skip_reflection": False,
            "skip_verification": False,
            "avg_precision": None,
            "similar_facts_found": 0,
        }

        with self._lock:
            if not self._facts:
                return hints

            # 1. Semantic search for similar past queries
            similar_facts = []
            if embedding_client and self._fact_embeddings is not None:
                try:
                    q_emb = np.array(embedding_client.embed(query_text), dtype=np.float32)
                    q_emb = q_emb / (np.linalg.norm(q_emb) or 1.0)
                    sims = self._fact_embeddings @ q_emb
                    # Get top-k similar facts
                    top_indices = np.argsort(sims)[-top_k:][::-1]
                    facts_with_emb = [f for f in self._facts if f.embedding]
                    for idx in top_indices:
                        if idx < len(facts_with_emb) and sims[idx] > 0.7:
                            similar_facts.append(facts_with_emb[idx])
                except Exception as e:
                    logger.warning("[QueryIntel] Semantic search failed: %s", e)

            hints["similar_facts_found"] = len(similar_facts)

            # 2. Extract suggested nodes from similar successful queries
            if similar_facts:
                node_scores: dict[str, float] = defaultdict(float)
                for fact in similar_facts:
                    for nid in fact.cited_nodes:
                        node_scores[nid] += 1.0
                    for nid in fact.wasted_nodes:
                        node_scores[nid] -= 0.3  # Penalize wasted nodes

                ranked = sorted(node_scores.items(), key=lambda x: -x[1])
                hints["suggested_nodes"] = [
                    nid for nid, score in ranked[:10] if score > 0
                ]

            # 3. Identify consistently wasted nodes
            if self._node_waste_freq:
                total_facts = len(self._facts)
                avoid = [
                    nid for nid, count in self._node_waste_freq.items()
                    if count > 3  # Wasted more than 3 times
                    and self._node_citation_freq.get(nid, 0) == 0  # Never cited
                ]
                hints["avoid_nodes"] = avoid[:10]

            # 4. Query-type-specific intelligence
            qt = query_type or (similar_facts[0].query_type if similar_facts else "")
            if qt:
                # Reflection stats
                reflect_stats = self._type_reflect_stats.get(qt, {})
                if reflect_stats.get("total", 0) >= 5:
                    help_rate = reflect_stats.get("helped", 0) / reflect_stats["total"]
                    hints["skip_reflection"] = help_rate < 0.15  # Less than 15% help rate

                # Verification stats
                verify_stats = self._type_verify_stats.get(qt, {})
                if verify_stats.get("total", 0) >= 5:
                    clean_rate = verify_stats.get("clean", 0) / verify_stats["total"]
                    hints["skip_verification"] = clean_rate > 0.9  # 90%+ clean rate

                # Average precision
                precision_history = self._avg_precision_by_type.get(qt, [])
                if precision_history:
                    hints["avg_precision"] = round(
                        sum(precision_history[-20:]) / len(precision_history[-20:]), 3
                    )

        return hints

    def get_node_intelligence(self, node_id: str) -> dict:
        """Get intelligence about a specific node."""
        return {
            "node_id": node_id,
            "citation_count": self._node_citation_freq.get(node_id, 0),
            "waste_count": self._node_waste_freq.get(node_id, 0),
            "efficiency": (
                self._node_citation_freq.get(node_id, 0) /
                max(self._node_citation_freq.get(node_id, 0) + self._node_waste_freq.get(node_id, 0), 1)
            ),
        }

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        """Serialize for MongoDB."""
        return {
            "_id": self.doc_id,
            "doc_id": self.doc_id,
            "fact_count": len(self._facts),
            "facts": [
                {
                    "fact_id": f.fact_id,
                    "query_type": f.query_type,
                    "query_text_summary": f.query_text_summary,
                    "doc_id": f.doc_id,
                    "timestamp": f.timestamp,
                    "cited_nodes": f.cited_nodes,
                    "located_nodes": f.located_nodes,
                    "wasted_nodes": f.wasted_nodes,
                    "precision": f.precision,
                    "reflect_helped": f.reflect_helped,
                    "verification_status": f.verification_status,
                    "user_rating": f.user_rating,
                    "total_time_s": f.total_time_s,
                    "key_terms": f.key_terms,
                    # Embeddings stored separately
                }
                for f in self._facts
            ],
            "node_citation_freq": dict(self._node_citation_freq),
            "node_waste_freq": dict(self._node_waste_freq),
            "type_reflect_stats": {
                k: dict(v) for k, v in self._type_reflect_stats.items()
            },
            "type_verify_stats": {
                k: dict(v) for k, v in self._type_verify_stats.items()
            },
            "avg_precision_by_type": {
                k: v[-50:] for k, v in self._avg_precision_by_type.items()  # Keep last 50
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "QueryIntelligence":
        """Deserialize from MongoDB."""
        qi = cls(doc_id=data.get("doc_id", data.get("_id", "")))

        # Restore facts
        for f_data in data.get("facts", []):
            fact = RetrievalFact(
                fact_id=f_data.get("fact_id", ""),
                query_type=f_data.get("query_type", ""),
                query_text_summary=f_data.get("query_text_summary", ""),
                doc_id=f_data.get("doc_id", ""),
                timestamp=f_data.get("timestamp", ""),
                cited_nodes=f_data.get("cited_nodes", []),
                located_nodes=f_data.get("located_nodes", []),
                wasted_nodes=f_data.get("wasted_nodes", []),
                precision=f_data.get("precision", 0.0),
                reflect_helped=f_data.get("reflect_helped", False),
                verification_status=f_data.get("verification_status", ""),
                user_rating=f_data.get("user_rating"),
                total_time_s=f_data.get("total_time_s", 0.0),
                key_terms=f_data.get("key_terms", []),
            )
            qi._facts.append(fact)

        # Restore aggregated stats
        qi._node_citation_freq = defaultdict(int, data.get("node_citation_freq", {}))
        qi._node_waste_freq = defaultdict(int, data.get("node_waste_freq", {}))
        for k, v in data.get("type_reflect_stats", {}).items():
            qi._type_reflect_stats[k] = dict(v)
        for k, v in data.get("type_verify_stats", {}).items():
            qi._type_verify_stats[k] = dict(v)
        for k, v in data.get("avg_precision_by_type", {}).items():
            qi._avg_precision_by_type[k] = list(v)

        return qi

    def save(self, db: Any) -> None:
        """Persist to MongoDB."""
        doc = self.to_dict()
        db["query_intelligence"].replace_one(
            {"_id": self.doc_id}, doc, upsert=True,
        )

        # Save fact embeddings separately
        fact_embs = {}
        for f in self._facts:
            if f.embedding:
                fact_embs[f.fact_id] = f.embedding

        if fact_embs:
            db["query_intelligence_embeddings"].replace_one(
                {"_id": self.doc_id},
                {"_id": self.doc_id, "embeddings": fact_embs},
                upsert=True,
            )

        logger.info("[QueryIntel] Saved %d facts for doc=%s", len(self._facts), self.doc_id)

    @classmethod
    def load(cls, doc_id: str, db: Any) -> Optional["QueryIntelligence"]:
        """Load from MongoDB."""
        doc = db["query_intelligence"].find_one({"_id": doc_id})
        if not doc:
            return None

        qi = cls.from_dict(doc)

        # Load embeddings
        emb_doc = db["query_intelligence_embeddings"].find_one({"_id": doc_id})
        if emb_doc:
            embeddings = emb_doc.get("embeddings", {})
            for fact in qi._facts:
                if fact.fact_id in embeddings:
                    fact.embedding = embeddings[fact.fact_id]
            qi._rebuild_embedding_index()

        logger.info("[QueryIntel] Loaded %d facts for doc=%s", len(qi._facts), doc_id)
        return qi

    def get_stats(self) -> dict:
        """Return query intelligence stats."""
        return {
            "doc_id": self.doc_id,
            "total_facts": len(self._facts),
            "unique_cited_nodes": len(self._node_citation_freq),
            "unique_wasted_nodes": len([
                nid for nid, c in self._node_waste_freq.items()
                if self._node_citation_freq.get(nid, 0) == 0
            ]),
            "type_stats": {
                qt: {
                    "avg_precision": round(
                        sum(self._avg_precision_by_type[qt][-20:]) /
                        len(self._avg_precision_by_type[qt][-20:]), 3
                    ) if self._avg_precision_by_type.get(qt) else 0,
                    "reflect_help_rate": round(
                        self._type_reflect_stats[qt].get("helped", 0) /
                        max(self._type_reflect_stats[qt].get("total", 1), 1), 3
                    ),
                    "verify_clean_rate": round(
                        self._type_verify_stats[qt].get("clean", 0) /
                        max(self._type_verify_stats[qt].get("total", 1), 1), 3
                    ),
                    "fact_count": len([f for f in self._facts if f.query_type == qt]),
                }
                for qt in set(f.query_type for f in self._facts)
            },
        }
