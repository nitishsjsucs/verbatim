"""
Memory Diagnostics for GOVINDA V2 — Contribution Tracking & Health Checks

Three pillars:
1. Per-query MemoryContribution snapshot — what each loop contributed to a single query
2. Trend analysis — how memory improves retrieval precision / citation rate over time
3. Health checks — is each subsystem alive and functioning

All per-query snapshots are persisted to MongoDB (collection: memory_contributions)
so trends can be computed across any time window.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

COLLECTION = "memory_contributions"


# ──────────────────────────────────────────────────────────────────────
# 1. Per-query contribution snapshot
# ──────────────────────────────────────────────────────────────────────

@dataclass
class LoopContribution:
    """Contribution metrics for a single memory loop within one query."""
    name: str
    enabled: bool = False
    fired: bool = False           # did the loop actually run?
    error: str = ""               # empty if ok
    latency_ms: float = 0.0

    # Pre-query contribution
    items_returned: int = 0       # candidates / hints / scores returned
    items_used: int = 0           # how many actually influenced the final answer

    # Post-query learning
    learned: bool = False         # did post-query learning succeed?
    learn_detail: str = ""        # e.g. "precision=0.18 cited=3 wasted=14"


@dataclass
class MemoryContribution:
    """
    Full contribution snapshot for a single query.

    Created by MemoryManager, enriched by QAEngine after the answer,
    then persisted to MongoDB.
    """
    query_id: str = ""
    doc_id: str = ""
    user_id: str = "default"
    timestamp: str = ""
    query_type: str = ""
    query_text_preview: str = ""  # first 120 chars

    # Overall memory timing
    pre_query_ms: float = 0.0
    post_query_ms: float = 0.0

    # Per-loop contributions
    raptor: LoopContribution = field(
        default_factory=lambda: LoopContribution(name="raptor")
    )
    user_memory: LoopContribution = field(
        default_factory=lambda: LoopContribution(name="user_memory")
    )
    query_intel: LoopContribution = field(
        default_factory=lambda: LoopContribution(name="query_intel")
    )
    retrieval_fb: LoopContribution = field(
        default_factory=lambda: LoopContribution(name="retrieval_fb")
    )
    r2r_fallback: LoopContribution = field(
        default_factory=lambda: LoopContribution(name="r2r_fallback")
    )

    # Post-answer enrichment (filled by QAEngine after synthesis)
    total_sections_retrieved: int = 0
    total_citations: int = 0
    retrieval_precision: float = 0.0  # citations / sections
    memory_assisted_citations: int = 0  # citations from memory-boosted nodes
    r2r_fallback_sections_added: int = 0
    r2r_fallback_sections_cited: int = 0
    user_context_injected: bool = False
    reliability_scores_applied: int = 0

    # Overall verdict
    memory_contributed: bool = False  # did memory measurably help this query?
    contribution_summary: str = ""    # human-readable one-liner

    def to_dict(self) -> dict:
        """Serialize for MongoDB storage."""
        d = asdict(self)
        d["_id"] = self.query_id or f"mc_{int(time.time() * 1000)}"
        return d

    @classmethod
    def from_dict(cls, data: dict) -> "MemoryContribution":
        """Deserialize from MongoDB document."""
        mc = cls()
        for k, v in data.items():
            if k == "_id":
                mc.query_id = v
                continue
            if k in ("raptor", "user_memory", "query_intel", "retrieval_fb", "r2r_fallback"):
                if isinstance(v, dict):
                    setattr(mc, k, LoopContribution(**v))
                continue
            if hasattr(mc, k):
                setattr(mc, k, v)
        return mc


# ──────────────────────────────────────────────────────────────────────
# 2. Trend analysis
# ──────────────────────────────────────────────────────────────────────

class MemoryTrendAnalyzer:
    """
    Computes improvement trends from stored MemoryContribution records.

    Key metrics tracked over time:
    - Retrieval precision (citations / sections) — is memory reducing wasted retrievals?
    - Memory-assisted citation rate — are memory-boosted nodes being cited more?
    - Loop reliability — which loops fire vs error out?
    - Learning success rate — are post-query loops storing data?
    """

    def __init__(self, db: Any) -> None:
        self._collection = db[COLLECTION]

    def get_trends(
        self,
        doc_id: Optional[str] = None,
        last_n: int = 50,
    ) -> dict:
        """
        Compute trend metrics from the last N queries.

        Returns a dict with:
        - overall: aggregate stats
        - per_loop: per-loop health and contribution stats
        - precision_trend: list of (query_index, precision) for charting
        - improvement_score: 0-100 composite score
        """
        query_filter: dict = {}
        if doc_id:
            query_filter["doc_id"] = doc_id

        cursor = (
            self._collection.find(query_filter)
            .sort("timestamp", -1)
            .limit(last_n)
        )
        records = [MemoryContribution.from_dict(r) for r in cursor]

        if not records:
            return {
                "total_queries": 0,
                "message": "No memory contribution data yet. Run queries in optimized mode.",
            }

        # Reverse to chronological order for trend analysis
        records.reverse()
        total = len(records)

        # ── Overall stats ──
        precisions = [r.retrieval_precision for r in records]
        citation_counts = [r.total_citations for r in records]
        mem_assisted = [r.memory_assisted_citations for r in records]
        contributed = [r for r in records if r.memory_contributed]

        # Split into halves for improvement detection
        half = max(1, total // 2)
        first_half = records[:half]
        second_half = records[half:]

        avg_precision_first = (
            sum(r.retrieval_precision for r in first_half) / len(first_half)
            if first_half else 0
        )
        avg_precision_second = (
            sum(r.retrieval_precision for r in second_half) / len(second_half)
            if second_half else 0
        )
        precision_improvement = avg_precision_second - avg_precision_first

        overall = {
            "total_queries_analyzed": total,
            "avg_retrieval_precision": round(
                sum(precisions) / total, 3
            ) if total else 0,
            "avg_citations_per_query": round(
                sum(citation_counts) / total, 1
            ) if total else 0,
            "memory_contribution_rate": round(
                len(contributed) / total, 3
            ) if total else 0,
            "avg_memory_assisted_citations": round(
                sum(mem_assisted) / total, 2
            ) if total else 0,
            "precision_trend": {
                "first_half_avg": round(avg_precision_first, 3),
                "second_half_avg": round(avg_precision_second, 3),
                "improvement": round(precision_improvement, 3),
                "improving": precision_improvement > 0.01,
            },
        }

        # ── Per-loop stats ──
        loop_names = ["raptor", "user_memory", "query_intel", "retrieval_fb", "r2r_fallback"]
        per_loop = {}
        for loop_name in loop_names:
            loop_records = [getattr(r, loop_name) for r in records]
            enabled_count = sum(1 for lr in loop_records if lr.enabled)
            fired_count = sum(1 for lr in loop_records if lr.fired)
            error_count = sum(1 for lr in loop_records if lr.error)
            learned_count = sum(1 for lr in loop_records if lr.learned)
            items_returned = [lr.items_returned for lr in loop_records if lr.fired]
            items_used = [lr.items_used for lr in loop_records if lr.fired]
            latencies = [lr.latency_ms for lr in loop_records if lr.fired]

            per_loop[loop_name] = {
                "enabled_rate": round(enabled_count / total, 2) if total else 0,
                "fire_rate": round(fired_count / total, 2) if total else 0,
                "error_rate": round(error_count / max(fired_count, 1), 2),
                "learn_rate": round(learned_count / max(fired_count, 1), 2),
                "avg_items_returned": round(
                    sum(items_returned) / len(items_returned), 1
                ) if items_returned else 0,
                "avg_items_used": round(
                    sum(items_used) / len(items_used), 1
                ) if items_used else 0,
                "utilization_rate": round(
                    sum(items_used) / max(sum(items_returned), 1), 2
                ),
                "avg_latency_ms": round(
                    sum(latencies) / len(latencies), 1
                ) if latencies else 0,
                "total_fires": fired_count,
                "total_errors": error_count,
            }

        # ── Precision trend (for charting) ──
        precision_series = [
            {
                "query_index": i,
                "precision": round(r.retrieval_precision, 3),
                "citations": r.total_citations,
                "memory_contributed": r.memory_contributed,
                "timestamp": r.timestamp,
            }
            for i, r in enumerate(records)
        ]

        # ── Composite improvement score (0-100) ──
        score = self._compute_improvement_score(overall, per_loop, records)

        return {
            "overall": overall,
            "per_loop": per_loop,
            "precision_series": precision_series,
            "improvement_score": score,
            "doc_id": doc_id or "all",
        }

    @staticmethod
    def _compute_improvement_score(
        overall: dict, per_loop: dict, records: list
    ) -> dict:
        """
        Compute a composite 0-100 improvement score.

        Components:
        - Precision score (40%): avg retrieval precision × 100
        - Contribution rate (20%): % of queries where memory helped
        - Loop reliability (20%): avg fire rate across loops
        - Improvement trend (20%): precision improving over time?
        """
        precision_score = min(100, overall.get("avg_retrieval_precision", 0) * 200)
        contribution_score = overall.get("memory_contribution_rate", 0) * 100
        loop_fire_rates = [v.get("fire_rate", 0) for v in per_loop.values()]
        reliability_score = (
            sum(loop_fire_rates) / len(loop_fire_rates) * 100
            if loop_fire_rates else 0
        )
        trend = overall.get("precision_trend", {})
        improvement = trend.get("improvement", 0)
        trend_score = min(100, max(0, 50 + improvement * 500))

        composite = (
            precision_score * 0.40
            + contribution_score * 0.20
            + reliability_score * 0.20
            + trend_score * 0.20
        )

        return {
            "composite": round(composite, 1),
            "components": {
                "precision": round(precision_score, 1),
                "contribution_rate": round(contribution_score, 1),
                "loop_reliability": round(reliability_score, 1),
                "improvement_trend": round(trend_score, 1),
            },
            "grade": (
                "A" if composite >= 80 else
                "B" if composite >= 60 else
                "C" if composite >= 40 else
                "D" if composite >= 20 else "F"
            ),
        }


# ──────────────────────────────────────────────────────────────────────
# 3. Health checks
# ──────────────────────────────────────────────────────────────────────

class MemoryHealthChecker:
    """
    End-to-end health checks for all memory subsystems.

    Tests:
    - Infrastructure: MongoDB connectivity, collections exist
    - Per-loop: can load, has data, can query
    - Feature flags: which loops are enabled
    - Data freshness: when was each loop last updated
    """

    def check_all(self, doc_id: Optional[str] = None) -> dict:
        """Run all health checks and return a structured report."""
        t0 = time.time()
        results = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "infrastructure": self._check_infrastructure(),
            "loops": {},
            "feature_flags": self._check_feature_flags(),
            "overall_status": "unknown",
        }

        from memory.memory_manager import get_memory_manager
        mm = get_memory_manager()

        if not mm._initialized:
            results["overall_status"] = "not_initialized"
            results["check_duration_ms"] = round((time.time() - t0) * 1000, 1)
            return results

        # Check each loop
        results["loops"]["raptor"] = self._check_raptor(mm, doc_id)
        results["loops"]["user_memory"] = self._check_user_memory(mm)
        results["loops"]["query_intel"] = self._check_query_intel(mm, doc_id)
        results["loops"]["retrieval_fb"] = self._check_retrieval_fb(mm, doc_id)
        results["loops"]["r2r_fallback"] = self._check_r2r(mm, doc_id)

        # Data freshness from MongoDB
        results["data_freshness"] = self._check_data_freshness()

        # Contribution stats
        results["contribution_stats"] = self._check_contribution_stats()

        # Overall status
        loop_statuses = [v.get("status", "error") for v in results["loops"].values()]
        if all(s == "healthy" for s in loop_statuses):
            results["overall_status"] = "all_healthy"
        elif any(s == "healthy" for s in loop_statuses):
            results["overall_status"] = "partial"
        elif all(s == "disabled" for s in loop_statuses):
            results["overall_status"] = "all_disabled"
        else:
            results["overall_status"] = "unhealthy"

        results["check_duration_ms"] = round((time.time() - t0) * 1000, 1)
        return results

    @staticmethod
    def _check_infrastructure() -> dict:
        """Check MongoDB and core dependencies."""
        checks = {}

        # MongoDB
        try:
            from utils.mongo import get_db
            db = get_db()
            db.command("ping")
            checks["mongodb"] = {"status": "ok", "database": db.name}
        except Exception as e:
            checks["mongodb"] = {"status": "error", "error": str(e)}

        # Embedding client
        try:
            from utils.embedding_client import EmbeddingClient
            ec = EmbeddingClient()
            checks["embedding_client"] = {
                "status": "ok",
                "model": getattr(ec, "_model", "unknown"),
            }
        except Exception as e:
            checks["embedding_client"] = {"status": "error", "error": str(e)}

        # Memory manager singleton
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            checks["memory_manager"] = {
                "status": "ok" if mm._initialized else "not_initialized",
                "initialized": mm._initialized,
                "cached_raptor": len(mm._raptor_indexes),
                "cached_user_mem": len(mm._user_memories),
                "cached_query_intel": len(mm._query_intel),
                "cached_retrieval_fb": len(mm._retrieval_fb),
                "cached_r2r": len(mm._r2r_fallbacks),
            }
        except Exception as e:
            checks["memory_manager"] = {"status": "error", "error": str(e)}

        return checks

    @staticmethod
    def _check_feature_flags() -> dict:
        """Check which memory features are enabled."""
        try:
            from config.settings import get_settings, get_active_retrieval_mode
            settings = get_settings()
            opt = settings.optimization
            mode = get_active_retrieval_mode()
            return {
                "retrieval_mode": mode,
                "is_optimized": mode == "optimized",
                "raptor_index": getattr(opt, "enable_raptor_index", False),
                "user_memory": getattr(opt, "enable_user_memory", False),
                "query_intelligence": getattr(opt, "enable_query_intelligence", False),
                "retrieval_feedback": getattr(opt, "enable_retrieval_feedback", False),
                "r2r_fallback": getattr(opt, "enable_r2r_fallback", False),
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def _check_raptor(mm: Any, doc_id: Optional[str]) -> dict:
        """Check RAPTOR loop health."""
        from config.settings import get_active_retrieval_mode
        if get_active_retrieval_mode() != "optimized":
            return {"status": "disabled", "reason": "not in optimized mode"}
        try:
            from config.settings import get_settings
            if not getattr(get_settings().optimization, "enable_raptor_index", False):
                return {"status": "disabled", "reason": "feature flag off"}

            loaded = len(mm._raptor_indexes)
            has_data = False
            stats = {}
            if doc_id and doc_id in mm._raptor_indexes:
                raptor = mm._raptor_indexes[doc_id]
                has_data = raptor.is_built
                stats = raptor.get_stats()
            return {
                "status": "healthy" if loaded > 0 else "empty",
                "loaded_docs": loaded,
                "has_data": has_data,
                "stats": stats,
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}

    @staticmethod
    def _check_user_memory(mm: Any) -> dict:
        """Check user memory loop health."""
        from config.settings import get_active_retrieval_mode
        if get_active_retrieval_mode() != "optimized":
            return {"status": "disabled", "reason": "not in optimized mode"}
        try:
            from config.settings import get_settings
            if not getattr(get_settings().optimization, "enable_user_memory", False):
                return {"status": "disabled", "reason": "feature flag off"}

            loaded = len(mm._user_memories)
            return {
                "status": "healthy" if loaded > 0 else "empty",
                "loaded_users": loaded,
                "user_ids": list(mm._user_memories.keys())[:10],
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}

    @staticmethod
    def _check_query_intel(mm: Any, doc_id: Optional[str]) -> dict:
        """Check query intelligence loop health."""
        from config.settings import get_active_retrieval_mode
        if get_active_retrieval_mode() != "optimized":
            return {"status": "disabled", "reason": "not in optimized mode"}
        try:
            from config.settings import get_settings
            if not getattr(get_settings().optimization, "enable_query_intelligence", False):
                return {"status": "disabled", "reason": "feature flag off"}

            loaded = len(mm._query_intel)
            stats = {}
            if doc_id and doc_id in mm._query_intel:
                stats = mm._query_intel[doc_id].get_stats()
            return {
                "status": "healthy" if loaded > 0 else "empty",
                "loaded_docs": loaded,
                "stats": stats,
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}

    @staticmethod
    def _check_retrieval_fb(mm: Any, doc_id: Optional[str]) -> dict:
        """Check retrieval feedback loop health."""
        from config.settings import get_active_retrieval_mode
        if get_active_retrieval_mode() != "optimized":
            return {"status": "disabled", "reason": "not in optimized mode"}
        try:
            from config.settings import get_settings
            if not getattr(get_settings().optimization, "enable_retrieval_feedback", False):
                return {"status": "disabled", "reason": "feature flag off"}

            loaded = len(mm._retrieval_fb)
            stats = {}
            if doc_id and doc_id in mm._retrieval_fb:
                stats = mm._retrieval_fb[doc_id].get_stats()
            return {
                "status": "healthy" if loaded > 0 else "empty",
                "loaded_docs": loaded,
                "stats": stats,
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}

    @staticmethod
    def _check_r2r(mm: Any, doc_id: Optional[str]) -> dict:
        """Check R2R fallback loop health."""
        from config.settings import get_active_retrieval_mode
        if get_active_retrieval_mode() != "optimized":
            return {"status": "disabled", "reason": "not in optimized mode"}
        try:
            from config.settings import get_settings
            if not getattr(get_settings().optimization, "enable_r2r_fallback", False):
                return {"status": "disabled", "reason": "feature flag off"}

            loaded = len(mm._r2r_fallbacks)
            stats = {}
            if doc_id and doc_id in mm._r2r_fallbacks:
                r2r = mm._r2r_fallbacks[doc_id]
                stats = r2r.get_stats()
            return {
                "status": "healthy" if loaded > 0 else "empty",
                "loaded_docs": loaded,
                "stats": stats,
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}

    @staticmethod
    def _check_data_freshness() -> dict:
        """Check when each subsystem was last updated in MongoDB."""
        freshness = {}
        try:
            from utils.mongo import get_db
            db = get_db()

            collections_to_check = {
                "raptor": "raptor_indexes",
                "user_memory": "user_memory",
                "query_intel": "query_intelligence",
                "retrieval_fb": "retrieval_feedback",
                "r2r": "r2r_index",
                "contributions": COLLECTION,
            }

            for label, coll_name in collections_to_check.items():
                try:
                    count = db[coll_name].count_documents({})
                    # Try to get latest update timestamp
                    latest = db[coll_name].find_one(
                        {}, sort=[("updated_at", -1)]
                    )
                    last_updated = None
                    if latest:
                        last_updated = (
                            latest.get("updated_at")
                            or latest.get("timestamp")
                            or latest.get("built_at")
                            or "unknown"
                        )
                    freshness[label] = {
                        "documents": count,
                        "last_updated": str(last_updated) if last_updated else "never",
                    }
                except Exception:
                    freshness[label] = {"documents": 0, "last_updated": "error"}
        except Exception as e:
            freshness["error"] = str(e)

        return freshness

    @staticmethod
    def _check_contribution_stats() -> dict:
        """Summarize contribution tracking data from MongoDB."""
        try:
            from utils.mongo import get_db
            db = get_db()
            coll = db[COLLECTION]
            total = coll.count_documents({})
            if total == 0:
                return {
                    "total_tracked": 0,
                    "message": "No contributions tracked yet",
                }

            contributed = coll.count_documents({"memory_contributed": True})
            recent = list(
                coll.find({}, {"retrieval_precision": 1, "total_citations": 1})
                .sort("timestamp", -1)
                .limit(20)
            )
            avg_precision = (
                sum(r.get("retrieval_precision", 0) for r in recent) / len(recent)
                if recent else 0
            )

            return {
                "total_tracked": total,
                "contributed_count": contributed,
                "contribution_rate": round(contributed / max(total, 1), 3),
                "recent_avg_precision": round(avg_precision, 3),
            }
        except Exception as e:
            return {"error": str(e)}


# ──────────────────────────────────────────────────────────────────────
# Persistence helper
# ──────────────────────────────────────────────────────────────────────

def save_contribution(db: Any, contribution: MemoryContribution) -> None:
    """Persist a MemoryContribution to MongoDB."""
    try:
        doc = contribution.to_dict()
        db[COLLECTION].replace_one(
            {"_id": doc["_id"]}, doc, upsert=True,
        )
        logger.debug("[MemoryDiag] Saved contribution %s", doc["_id"])
    except Exception as e:
        logger.warning("[MemoryDiag] Failed to save contribution: %s", e)


def load_recent_contributions(
    db: Any, doc_id: Optional[str] = None, limit: int = 20
) -> list[MemoryContribution]:
    """Load recent contributions from MongoDB."""
    query_filter: dict = {}
    if doc_id:
        query_filter["doc_id"] = doc_id
    cursor = db[COLLECTION].find(query_filter).sort("timestamp", -1).limit(limit)
    return [MemoryContribution.from_dict(r) for r in cursor]
