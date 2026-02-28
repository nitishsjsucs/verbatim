"""
RAPTOR-inspired Node Heat Map for GOVINDA V2 — Loop 1: "Know What Matters"

Builds a multi-resolution embedding overlay on top of the existing DocumentTree.
Tracks which nodes actually get cited to learn retrieval priorities.

Only active when retrieval_mode='optimized' AND enable_raptor_index=True.
Legacy retrieval path is completely unaffected.
"""

from __future__ import annotations

import json
import logging
import math
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np

from config.settings import get_settings
from utils.text_utils import estimate_tokens

logger = logging.getLogger(__name__)


class NodeHeat:
    """Heat tracking data for a single document node."""

    __slots__ = ("node_id", "citations", "last_cited", "query_types", "decay_rate")

    def __init__(
        self,
        node_id: str,
        citations: int = 0,
        last_cited: Optional[str] = None,
        query_types: Optional[dict] = None,
        decay_rate: float = 30.0,
    ):
        self.node_id = node_id
        self.citations = citations
        self.last_cited = last_cited
        self.query_types = query_types or {}
        self.decay_rate = decay_rate

    @property
    def heat_score(self) -> float:
        """Compute current heat with time-based decay."""
        if self.citations == 0:
            return 0.0
        base = math.log1p(self.citations)
        if self.last_cited:
            try:
                last = datetime.fromisoformat(self.last_cited)
                now = datetime.now(timezone.utc)
                days_ago = max(0.0, (now - last).total_seconds() / 86400.0)
                recency = math.exp(-days_ago / self.decay_rate)
            except Exception:
                recency = 0.5
        else:
            recency = 0.5
        return base * (0.3 + 0.7 * recency)

    def record_citation(self, query_type: str = ""):
        self.citations += 1
        self.last_cited = datetime.now(timezone.utc).isoformat()
        if query_type:
            self.query_types[query_type] = self.query_types.get(query_type, 0) + 1

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "citations": self.citations,
            "last_cited": self.last_cited,
            "query_types": self.query_types,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "NodeHeat":
        return cls(
            node_id=data["node_id"],
            citations=data.get("citations", 0),
            last_cited=data.get("last_cited"),
            query_types=data.get("query_types", {}),
        )


class RaptorIndex:
    """
    Multi-resolution embedding index overlaid on the DocumentTree.

    At ingestion time:
    - Embeds all node summaries + descriptions
    - Clusters nodes into topic groups using simple k-means on embeddings
    - Generates cluster summaries via LLM
    - Stores embeddings at every level

    At query time:
    - Collapsed retrieval: search ALL levels simultaneously
    - Return candidate node_ids at the right abstraction level
    - Boost candidates by heat map scores

    Learning:
    - After each query, record which nodes were actually CITED
    - Build a heat map: node_id -> citation_count
    - Hot nodes get priority in future retrievals
    """

    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self._settings = get_settings()

        # Node embeddings: node_id -> embedding vector
        self._node_embeddings: dict[str, list[float]] = {}

        # Cluster layer: cluster_id -> {summary, embedding, node_ids}
        self._clusters: list[dict] = []

        # Heat map: node_id -> NodeHeat
        self._heat_map: dict[str, NodeHeat] = {}

        # Build metadata
        self._built_at: Optional[str] = None
        self._version: int = 0

    @property
    def is_built(self) -> bool:
        return len(self._node_embeddings) > 0

    def build(self, tree: Any, embedding_client: Any, llm_client: Any = None) -> None:
        """
        Build the multi-resolution index from a DocumentTree.

        Phase 1: Embed all node summaries
        Phase 2: Cluster nodes into topic groups (simple cosine k-means)
        Phase 3: Generate cluster summaries (optional, requires LLM)
        """
        logger.info("[RAPTOR] Building index for doc=%s with %d nodes", self.doc_id, tree.node_count)
        t0 = time.time()

        # Phase 1: Collect all node texts for embedding
        node_texts = {}
        for node_id, node in tree._node_index.items():
            # Combine summary + description + title for rich embedding
            parts = []
            if node.title:
                parts.append(node.title)
            if hasattr(node, "summary") and node.summary:
                parts.append(node.summary)
            if hasattr(node, "description") and node.description:
                parts.append(node.description)
            if hasattr(node, "topics") and node.topics:
                parts.append("Topics: " + ", ".join(node.topics))
            text = " | ".join(parts) if parts else node.title or f"Node {node_id}"
            node_texts[node_id] = text

        if not node_texts:
            logger.warning("[RAPTOR] No nodes to embed for doc=%s", self.doc_id)
            return

        # Embed all nodes in batch
        node_ids = list(node_texts.keys())
        texts = [node_texts[nid] for nid in node_ids]

        try:
            embeddings = embedding_client.embed_batch(texts)
            for nid, emb in zip(node_ids, embeddings):
                self._node_embeddings[nid] = emb
            logger.info("[RAPTOR] Embedded %d nodes", len(node_ids))
        except Exception as e:
            logger.error("[RAPTOR] Embedding failed: %s", e)
            return

        # Phase 2: Simple clustering using cosine similarity
        # Group nodes into clusters of ~10-15 for summary generation
        self._clusters = self._cluster_nodes(node_ids, embeddings, tree)
        logger.info("[RAPTOR] Created %d clusters", len(self._clusters))

        # Phase 3: Generate cluster summaries (if LLM available)
        if llm_client and self._clusters:
            self._generate_cluster_summaries(tree, embedding_client, llm_client)

        self._built_at = datetime.now(timezone.utc).isoformat()
        self._version += 1

        elapsed = time.time() - t0
        logger.info(
            "[RAPTOR] Index built: %d nodes, %d clusters in %.1fs",
            len(self._node_embeddings), len(self._clusters), elapsed,
        )

    def _cluster_nodes(
        self,
        node_ids: list[str],
        embeddings: list[list[float]],
        tree: Any,
        target_cluster_size: int = 12,
    ) -> list[dict]:
        """Simple clustering: group nearby nodes by cosine similarity."""
        if len(node_ids) <= target_cluster_size:
            return [{
                "cluster_id": "c_0",
                "node_ids": list(node_ids),
                "summary": "",
                "embedding": None,
            }]

        emb_matrix = np.array(embeddings, dtype=np.float32)
        # Normalize for cosine similarity
        norms = np.linalg.norm(emb_matrix, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)
        emb_matrix = emb_matrix / norms

        n_clusters = max(2, len(node_ids) // target_cluster_size)
        n_clusters = min(n_clusters, 50)  # cap

        # Simple k-means via iterative assignment
        # Initialize centroids by picking evenly-spaced nodes
        indices = np.linspace(0, len(node_ids) - 1, n_clusters, dtype=int)
        centroids = emb_matrix[indices].copy()

        assignments = np.zeros(len(node_ids), dtype=int)
        for _ in range(15):  # 15 iterations usually converges
            # Assign each node to nearest centroid
            sims = emb_matrix @ centroids.T  # [N, K]
            assignments = np.argmax(sims, axis=1)
            # Update centroids
            for k in range(n_clusters):
                mask = assignments == k
                if mask.any():
                    centroids[k] = emb_matrix[mask].mean(axis=0)
                    norm = np.linalg.norm(centroids[k])
                    if norm > 0:
                        centroids[k] /= norm

        # Build cluster objects
        clusters = []
        for k in range(n_clusters):
            mask = assignments == k
            cluster_node_ids = [node_ids[i] for i in range(len(node_ids)) if mask[i]]
            if cluster_node_ids:
                centroid_emb = centroids[k].tolist()
                clusters.append({
                    "cluster_id": f"c_{k}",
                    "node_ids": cluster_node_ids,
                    "summary": "",
                    "embedding": centroid_emb,
                })

        return clusters

    def _generate_cluster_summaries(
        self, tree: Any, embedding_client: Any, llm_client: Any
    ) -> None:
        """Generate abstractive summaries for each cluster via LLM."""
        for cluster in self._clusters:
            # Collect titles and summaries from cluster nodes
            parts = []
            for nid in cluster["node_ids"][:20]:  # Cap to avoid huge prompts
                node = tree.get_node(nid)
                if node:
                    title = node.title or f"Node {nid}"
                    summary = getattr(node, "summary", "") or ""
                    parts.append(f"- {title}: {summary[:200]}")

            if not parts:
                continue

            content = "\n".join(parts)
            try:
                result = llm_client.chat(
                    messages=[
                        {
                            "role": "system",
                            "content": "Summarize these document sections into a single cohesive topic summary (2-3 sentences). Focus on the overarching theme.",
                        },
                        {"role": "user", "content": content},
                    ],
                    max_tokens=200,
                    reasoning_effort="low",
                )
                cluster["summary"] = result.strip()

                # Embed the cluster summary
                cluster["embedding"] = embedding_client.embed(cluster["summary"])

            except Exception as e:
                logger.warning("[RAPTOR] Cluster summary failed for %s: %s", cluster["cluster_id"], e)

    def query(
        self,
        query_text: str,
        embedding_client: Any,
        top_k: int = 30,
        heat_boost: float = 0.3,
    ) -> list[str]:
        """
        Multi-resolution retrieval: search nodes AND clusters.

        Returns candidate node_ids, boosted by heat map scores.
        """
        if not self._node_embeddings:
            return []

        try:
            query_emb = np.array(embedding_client.embed(query_text), dtype=np.float32)
            query_emb = query_emb / (np.linalg.norm(query_emb) or 1.0)
        except Exception as e:
            logger.warning("[RAPTOR] Query embedding failed: %s", e)
            return []

        scores: dict[str, float] = {}

        # Score all individual nodes
        for nid, emb in self._node_embeddings.items():
            emb_arr = np.array(emb, dtype=np.float32)
            sim = float(np.dot(query_emb, emb_arr))
            scores[nid] = sim

        # Score cluster centroids — boost all member nodes
        for cluster in self._clusters:
            if cluster.get("embedding"):
                c_emb = np.array(cluster["embedding"], dtype=np.float32)
                c_sim = float(np.dot(query_emb, c_emb))
                # Boost member nodes by cluster similarity (weighted)
                for nid in cluster["node_ids"]:
                    if nid in scores:
                        scores[nid] = max(scores[nid], scores[nid] * 0.7 + c_sim * 0.3)
                    else:
                        scores[nid] = c_sim * 0.5

        # Apply heat map boost
        if heat_boost > 0 and self._heat_map:
            max_heat = max(
                (h.heat_score for h in self._heat_map.values()), default=1.0
            ) or 1.0
            for nid in scores:
                if nid in self._heat_map:
                    normalized_heat = self._heat_map[nid].heat_score / max_heat
                    scores[nid] += heat_boost * normalized_heat

        # Sort by score and return top_k
        ranked = sorted(scores.items(), key=lambda x: -x[1])
        return [nid for nid, _ in ranked[:top_k]]

    # ------------------------------------------------------------------
    # Heat Map — Learning from citations
    # ------------------------------------------------------------------

    def record_citation(self, node_id: str, query_type: str = "") -> None:
        """Record that a node was cited in an answer."""
        if node_id not in self._heat_map:
            self._heat_map[node_id] = NodeHeat(node_id=node_id)
        self._heat_map[node_id].record_citation(query_type)

    def record_citations_from_answer(self, answer: Any) -> None:
        """Record all citations from an Answer object."""
        query_type = ""
        if hasattr(answer, "query_type"):
            query_type = answer.query_type.value if hasattr(answer.query_type, "value") else str(answer.query_type)

        for citation in getattr(answer, "citations", []):
            self.record_citation(citation.node_id, query_type)

    def get_hot_nodes(self, top_k: int = 20) -> list[tuple[str, float]]:
        """Return the hottest nodes by heat score."""
        scored = [(nid, h.heat_score) for nid, h in self._heat_map.items()]
        scored.sort(key=lambda x: -x[1])
        return scored[:top_k]

    def get_cold_nodes(self, threshold: float = 0.1) -> list[str]:
        """Return nodes that have never or rarely been cited."""
        # All nodes with embeddings that aren't hot
        cold = []
        for nid in self._node_embeddings:
            if nid not in self._heat_map or self._heat_map[nid].heat_score < threshold:
                cold.append(nid)
        return cold

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        """Serialize for MongoDB storage."""
        return {
            "_id": self.doc_id,
            "doc_id": self.doc_id,
            "built_at": self._built_at,
            "version": self._version,
            "node_count": len(self._node_embeddings),
            "cluster_count": len(self._clusters),
            "heat_map": {
                nid: h.to_dict() for nid, h in self._heat_map.items()
            },
            "clusters": [
                {
                    "cluster_id": c["cluster_id"],
                    "node_ids": c["node_ids"],
                    "summary": c.get("summary", ""),
                    # Embeddings stored separately to keep this document small
                }
                for c in self._clusters
            ],
            # Note: node_embeddings and cluster embeddings stored in a separate collection
            # to avoid hitting MongoDB 16MB document limit
        }

    def heat_map_to_dict(self) -> dict:
        """Serialize just the heat map (for frequent updates)."""
        return {
            nid: h.to_dict() for nid, h in self._heat_map.items()
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RaptorIndex":
        """Deserialize from MongoDB document."""
        idx = cls(doc_id=data.get("doc_id", data.get("_id", "")))
        idx._built_at = data.get("built_at")
        idx._version = data.get("version", 0)

        # Restore heat map
        for nid, hdata in data.get("heat_map", {}).items():
            idx._heat_map[nid] = NodeHeat.from_dict(hdata)

        # Restore clusters (without embeddings — those are loaded separately)
        idx._clusters = data.get("clusters", [])

        return idx

    def save(self, db: Any) -> None:
        """Persist to MongoDB."""
        # Save metadata + heat map
        doc = self.to_dict()
        db["raptor_indexes"].replace_one(
            {"_id": self.doc_id}, doc, upsert=True,
        )

        # Save embeddings in a separate collection (can be large)
        emb_doc = {
            "_id": self.doc_id,
            "node_embeddings": self._node_embeddings,
            "cluster_embeddings": {
                c["cluster_id"]: c.get("embedding", [])
                for c in self._clusters if c.get("embedding")
            },
        }
        db["raptor_embeddings"].replace_one(
            {"_id": self.doc_id}, emb_doc, upsert=True,
        )
        logger.info("[RAPTOR] Saved index for doc=%s (%d nodes, %d clusters)", self.doc_id, len(self._node_embeddings), len(self._clusters))

    def save_heat_map_only(self, db: Any) -> None:
        """Persist only the heat map (fast, after each query)."""
        db["raptor_indexes"].update_one(
            {"_id": self.doc_id},
            {"$set": {"heat_map": {nid: h.to_dict() for nid, h in self._heat_map.items()}}},
            upsert=True,
        )

    @classmethod
    def load(cls, doc_id: str, db: Any) -> Optional["RaptorIndex"]:
        """Load from MongoDB."""
        doc = db["raptor_indexes"].find_one({"_id": doc_id})
        if not doc:
            return None

        idx = cls.from_dict(doc)

        # Load embeddings
        emb_doc = db["raptor_embeddings"].find_one({"_id": doc_id})
        if emb_doc:
            idx._node_embeddings = emb_doc.get("node_embeddings", {})
            # Restore cluster embeddings
            cluster_embs = emb_doc.get("cluster_embeddings", {})
            for cluster in idx._clusters:
                cid = cluster.get("cluster_id", "")
                if cid in cluster_embs:
                    cluster["embedding"] = cluster_embs[cid]

        logger.info(
            "[RAPTOR] Loaded index for doc=%s (%d nodes, %d clusters, %d heat entries)",
            doc_id, len(idx._node_embeddings), len(idx._clusters), len(idx._heat_map),
        )
        return idx

    def get_stats(self) -> dict:
        """Return stats about the RAPTOR index."""
        hot_nodes = self.get_hot_nodes(10)
        return {
            "doc_id": self.doc_id,
            "is_built": self.is_built,
            "node_count": len(self._node_embeddings),
            "cluster_count": len(self._clusters),
            "heat_map_entries": len(self._heat_map),
            "total_citations": sum(h.citations for h in self._heat_map.values()),
            "built_at": self._built_at,
            "version": self._version,
            "top_hot_nodes": [
                {"node_id": nid, "heat": round(score, 3)} for nid, score in hot_nodes
            ],
        }
