"""
Retrieval Feedback for GOVINDA V2 — Loop 4: "Grade Every Retrieval"

memU-inspired reinforcement/decay system for retrieval quality tracking.
Grades every retrieval pipeline execution and evolves node reliability scores.

Key concepts:
- Each node accumulates a "reliability score" based on citation history
- Reinforcement: node cited in answer → score increases
- Decay: node located but not cited → score decreases (wasted retrieval)
- Time decay: all scores slowly trend toward neutral
- Scores feed back into Locator as "prior knowledge" for smarter selection

Only active when retrieval_mode='optimized' AND enable_retrieval_feedback=True.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------
REINFORCE_DELTA = 0.10  # Score boost when node is cited
DECAY_DELTA = -0.04  # Score penalty when node is located but not cited
TIME_DECAY_RATE = 0.005  # Per-day passive decay toward neutral (0.5)
NEUTRAL_SCORE = 0.5  # Starting / neutral reliability
MIN_SCORE = 0.05
MAX_SCORE = 0.98
MIN_INTERACTIONS_FOR_SIGNAL = 3  # Need 3+ data points before adjusting pipeline


@dataclass
class NodeReliability:
    """Tracks how reliably a node contributes to answers."""
    node_id: str
    score: float = NEUTRAL_SCORE
    times_cited: int = 0
    times_located: int = 0
    times_wasted: int = 0  # located but not cited
    last_cited_ts: Optional[str] = None
    last_located_ts: Optional[str] = None
    last_update_ts: Optional[str] = None

    @property
    def efficiency(self) -> float:
        """Ratio of times cited to times located."""
        return self.times_cited / max(self.times_located, 1)

    @property
    def total_interactions(self) -> int:
        return self.times_located

    def reinforce(self) -> None:
        """Boost score — node was cited in the answer."""
        now = datetime.now(timezone.utc).isoformat()
        self.times_cited += 1
        self.times_located += 1
        self.last_cited_ts = now
        self.last_located_ts = now
        self.last_update_ts = now
        self.score = min(MAX_SCORE, self.score + REINFORCE_DELTA)

    def penalize(self) -> None:
        """Decay score — node was located but not cited (wasted)."""
        now = datetime.now(timezone.utc).isoformat()
        self.times_wasted += 1
        self.times_located += 1
        self.last_located_ts = now
        self.last_update_ts = now
        self.score = max(MIN_SCORE, self.score + DECAY_DELTA)

    def apply_time_decay(self, days_elapsed: float) -> None:
        """Apply passive time decay toward neutral."""
        if days_elapsed <= 0:
            return
        decay = TIME_DECAY_RATE * days_elapsed
        if self.score > NEUTRAL_SCORE:
            self.score = max(NEUTRAL_SCORE, self.score - decay)
        elif self.score < NEUTRAL_SCORE:
            self.score = min(NEUTRAL_SCORE, self.score + decay)
        self.last_update_ts = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "score": round(self.score, 4),
            "times_cited": self.times_cited,
            "times_located": self.times_located,
            "times_wasted": self.times_wasted,
            "last_cited_ts": self.last_cited_ts,
            "last_located_ts": self.last_located_ts,
            "last_update_ts": self.last_update_ts,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "NodeReliability":
        return cls(
            node_id=data["node_id"],
            score=data.get("score", NEUTRAL_SCORE),
            times_cited=data.get("times_cited", 0),
            times_located=data.get("times_located", 0),
            times_wasted=data.get("times_wasted", 0),
            last_cited_ts=data.get("last_cited_ts"),
            last_located_ts=data.get("last_located_ts"),
            last_update_ts=data.get("last_update_ts"),
        )


@dataclass
class PipelineGrade:
    """Grade for a single pipeline execution."""
    timestamp: str
    query_type: str
    precision: float  # cited / located
    nodes_located: int
    nodes_cited: int
    nodes_wasted: int
    reflect_added_value: bool
    verification_passed: bool
    total_time_s: float
    user_rating: Optional[int] = None


class RetrievalFeedback:
    """
    memU-inspired retrieval quality tracker.

    Maintains per-node reliability scores that evolve with every query.
    Provides retrieval boosting/penalizing hints to the Locator.

    Usage:
        feedback = RetrievalFeedback("doc_123")
        # After each query:
        feedback.grade_retrieval(query_record)
        # Before next query:
        boosted_nodes = feedback.get_boosted_nodes(top_k=5)
        penalized_nodes = feedback.get_penalized_nodes(threshold=0.2)
    """

    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self._settings = get_settings()

        # Per-node reliability scores
        self._nodes: dict[str, NodeReliability] = {}

        # Pipeline execution grades
        self._grades: list[PipelineGrade] = []
        self._max_grades = 200  # Keep last 200 grades

        # Query-type-level performance stats
        self._type_stats: dict[str, dict] = defaultdict(
            lambda: {
                "total_queries": 0,
                "avg_precision": 0.0,
                "avg_time_s": 0.0,
                "reflect_value_rate": 0.0,
                "verify_pass_rate": 0.0,
            }
        )

        self._lock = threading.Lock()

    def _get_or_create_node(self, node_id: str) -> NodeReliability:
        """Get or initialize reliability tracker for a node."""
        if node_id not in self._nodes:
            self._nodes[node_id] = NodeReliability(node_id=node_id)
        return self._nodes[node_id]

    def grade_retrieval(self, record: Any) -> PipelineGrade:
        """
        Grade a completed retrieval pipeline execution.

        Extracts signals from QueryRecord and updates node reliability scores.
        Returns the computed grade.
        """
        with self._lock:
            try:
                # Extract cited vs located nodes
                cited_nodes = set()
                for c in getattr(record, "citations", []):
                    if c.node_id:
                        cited_nodes.add(c.node_id)

                located_nodes = set()
                if record.routing_log:
                    for r in record.routing_log.locate_results:
                        nid = r.get("node_id", "")
                        if nid:
                            located_nodes.add(nid)

                wasted_nodes = located_nodes - cited_nodes
                precision = len(cited_nodes) / max(len(located_nodes), 1)

                # Determine if reflection helped
                reflect_helped = False
                if record.routing_log:
                    for r in record.routing_log.read_results:
                        if (r.get("source", "") == "reflection_gap_fill"
                                and r.get("node_id") in cited_nodes):
                            reflect_helped = True
                            break

                # Verification status
                verify_passed = record.verification_status in (
                    "verified", "confidence_skip", None
                )

                query_type = (
                    record.query_type.value
                    if hasattr(record.query_type, "value")
                    else str(record.query_type)
                )

                # Create the grade
                grade = PipelineGrade(
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    query_type=query_type,
                    precision=round(precision, 3),
                    nodes_located=len(located_nodes),
                    nodes_cited=len(cited_nodes),
                    nodes_wasted=len(wasted_nodes),
                    reflect_added_value=reflect_helped,
                    verification_passed=verify_passed,
                    total_time_s=record.total_time_seconds,
                    user_rating=(
                        record.feedback.rating if record.feedback else None
                    ),
                )
                self._grades.append(grade)
                if len(self._grades) > self._max_grades:
                    self._grades = self._grades[-self._max_grades:]

                # Update node reliability scores
                for nid in cited_nodes:
                    self._get_or_create_node(nid).reinforce()

                for nid in wasted_nodes:
                    self._get_or_create_node(nid).penalize()

                # Update type-level stats
                stats = self._type_stats[query_type]
                n = stats["total_queries"]
                stats["total_queries"] = n + 1
                stats["avg_precision"] = (stats["avg_precision"] * n + precision) / (n + 1)
                stats["avg_time_s"] = (
                    (stats["avg_time_s"] * n + record.total_time_seconds) / (n + 1)
                )
                stats["reflect_value_rate"] = (
                    (stats["reflect_value_rate"] * n + (1 if reflect_helped else 0)) / (n + 1)
                )
                stats["verify_pass_rate"] = (
                    (stats["verify_pass_rate"] * n + (1 if verify_passed else 0)) / (n + 1)
                )

                logger.info(
                    "[RetrievalFeedback] Graded: type=%s precision=%.2f "
                    "cited=%d wasted=%d reflect=%s verify=%s",
                    query_type, precision, len(cited_nodes),
                    len(wasted_nodes), reflect_helped, verify_passed,
                )

                return grade

            except Exception as e:
                logger.error("[RetrievalFeedback] Grade failed: %s", e)
                return PipelineGrade(
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    query_type="unknown",
                    precision=0.0,
                    nodes_located=0,
                    nodes_cited=0,
                    nodes_wasted=0,
                    reflect_added_value=False,
                    verification_passed=True,
                    total_time_s=0.0,
                )

    def get_boosted_nodes(self, top_k: int = 10) -> list[dict]:
        """
        Get top-k nodes that have proven reliable.

        Returns list of {node_id, score, times_cited, efficiency} sorted by score.
        Only returns nodes with enough interaction history.
        """
        with self._lock:
            reliable = [
                n for n in self._nodes.values()
                if n.total_interactions >= MIN_INTERACTIONS_FOR_SIGNAL
                and n.score > NEUTRAL_SCORE + 0.05
            ]
            reliable.sort(key=lambda n: n.score, reverse=True)
            return [
                {
                    "node_id": n.node_id,
                    "score": round(n.score, 3),
                    "times_cited": n.times_cited,
                    "efficiency": round(n.efficiency, 3),
                }
                for n in reliable[:top_k]
            ]

    def get_penalized_nodes(self, threshold: float = 0.3) -> list[str]:
        """
        Get nodes below the reliability threshold.

        These nodes are frequently located but rarely cited — they waste
        retrieval budget. The Locator can deprioritize these.
        """
        with self._lock:
            return [
                n.node_id for n in self._nodes.values()
                if n.total_interactions >= MIN_INTERACTIONS_FOR_SIGNAL
                and n.score < threshold
            ]

    def get_node_reliability(self, node_id: str) -> Optional[dict]:
        """Get reliability data for a specific node."""
        node = self._nodes.get(node_id)
        if not node:
            return None
        return node.to_dict()

    def get_node_score_map(self) -> dict[str, float]:
        """
        Get full score map for all tracked nodes.

        Can be injected into the Locator's index compression to weight nodes.
        Nodes not in the map are treated as neutral (0.5).
        """
        with self._lock:
            return {
                nid: round(n.score, 4)
                for nid, n in self._nodes.items()
                if n.total_interactions >= 2  # Need at least 2 interactions
            }

    def apply_user_feedback(
        self,
        cited_node_ids: list[str],
        rating: int,  # 1-5
    ) -> None:
        """
        Apply explicit user feedback to cited nodes.

        Positive feedback (4-5) reinforces cited nodes.
        Negative feedback (1-2) penalizes them.
        """
        with self._lock:
            for nid in cited_node_ids:
                node = self._get_or_create_node(nid)
                if rating >= 4:
                    node.score = min(MAX_SCORE, node.score + REINFORCE_DELTA * 0.5)
                elif rating <= 2:
                    node.score = max(MIN_SCORE, node.score + DECAY_DELTA * 0.5)

            logger.info(
                "[RetrievalFeedback] Applied user feedback: rating=%d nodes=%d",
                rating, len(cited_node_ids),
            )

    def apply_time_decay_all(self, days: float = 1.0) -> None:
        """Apply time decay to all nodes. Call periodically (e.g., daily)."""
        with self._lock:
            for node in self._nodes.values():
                node.apply_time_decay(days)

    def get_type_performance(self, query_type: str) -> dict:
        """Get performance stats for a specific query type."""
        stats = self._type_stats.get(query_type)
        if not stats:
            return {}
        return {
            "query_type": query_type,
            "total_queries": stats["total_queries"],
            "avg_precision": round(stats["avg_precision"], 3),
            "avg_time_s": round(stats["avg_time_s"], 2),
            "reflect_value_rate": round(stats["reflect_value_rate"], 3),
            "verify_pass_rate": round(stats["verify_pass_rate"], 3),
        }

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "_id": self.doc_id,
            "doc_id": self.doc_id,
            "nodes": {
                nid: n.to_dict() for nid, n in self._nodes.items()
            },
            "grades": [
                {
                    "timestamp": g.timestamp,
                    "query_type": g.query_type,
                    "precision": g.precision,
                    "nodes_located": g.nodes_located,
                    "nodes_cited": g.nodes_cited,
                    "nodes_wasted": g.nodes_wasted,
                    "reflect_added_value": g.reflect_added_value,
                    "verification_passed": g.verification_passed,
                    "total_time_s": g.total_time_s,
                    "user_rating": g.user_rating,
                }
                for g in self._grades[-self._max_grades:]
            ],
            "type_stats": {
                k: {sk: round(sv, 4) if isinstance(sv, float) else sv
                     for sk, sv in v.items()}
                for k, v in self._type_stats.items()
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RetrievalFeedback":
        fb = cls(doc_id=data.get("doc_id", data.get("_id", "")))

        # Restore nodes
        for nid, ndata in data.get("nodes", {}).items():
            fb._nodes[nid] = NodeReliability.from_dict(ndata)

        # Restore grades
        for gdata in data.get("grades", []):
            fb._grades.append(PipelineGrade(
                timestamp=gdata.get("timestamp", ""),
                query_type=gdata.get("query_type", ""),
                precision=gdata.get("precision", 0.0),
                nodes_located=gdata.get("nodes_located", 0),
                nodes_cited=gdata.get("nodes_cited", 0),
                nodes_wasted=gdata.get("nodes_wasted", 0),
                reflect_added_value=gdata.get("reflect_added_value", False),
                verification_passed=gdata.get("verification_passed", True),
                total_time_s=gdata.get("total_time_s", 0.0),
                user_rating=gdata.get("user_rating"),
            ))

        # Restore type stats
        for k, v in data.get("type_stats", {}).items():
            fb._type_stats[k] = dict(v)

        return fb

    def save(self, db: Any) -> None:
        """Persist to MongoDB."""
        doc = self.to_dict()
        db["retrieval_feedback"].replace_one(
            {"_id": self.doc_id}, doc, upsert=True,
        )
        logger.info(
            "[RetrievalFeedback] Saved %d nodes, %d grades for doc=%s",
            len(self._nodes), len(self._grades), self.doc_id,
        )

    @classmethod
    def load(cls, doc_id: str, db: Any) -> Optional["RetrievalFeedback"]:
        """Load from MongoDB."""
        doc = db["retrieval_feedback"].find_one({"_id": doc_id})
        if not doc:
            return None
        fb = cls.from_dict(doc)
        logger.info(
            "[RetrievalFeedback] Loaded %d nodes, %d grades for doc=%s",
            len(fb._nodes), len(fb._grades), doc_id,
        )
        return fb

    def get_stats(self) -> dict:
        """Overview stats for this feedback store."""
        with self._lock:
            boosted = [n for n in self._nodes.values() if n.score > NEUTRAL_SCORE + 0.05]
            penalized = [n for n in self._nodes.values() if n.score < NEUTRAL_SCORE - 0.15]
            recent_grades = self._grades[-20:]
            avg_recent_precision = (
                sum(g.precision for g in recent_grades) / len(recent_grades)
                if recent_grades else 0.0
            )
            return {
                "doc_id": self.doc_id,
                "total_nodes_tracked": len(self._nodes),
                "boosted_nodes": len(boosted),
                "penalized_nodes": len(penalized),
                "total_grades": len(self._grades),
                "avg_recent_precision": round(avg_recent_precision, 3),
                "type_stats": {
                    k: self.get_type_performance(k) for k in self._type_stats
                },
            }
