"""
Memory Manager for GOVINDA V2 — Central Facade

Coordinates all 5 learning loops through a single unified interface.
The QAEngine and main.py only interact with this facade.

Learning Loops:
1. RAPTOR Index (raptor_index.py) — Multi-resolution embedding + heat map
2. User Memory (user_memory.py) — Per-user 3-tier memory
3. Query Intelligence (query_intelligence.py) — Pattern learning
4. Retrieval Feedback (retrieval_feedback.py) — Node reliability scoring
5. R2R Fallback (r2r_fallback.py) — Hybrid search safety net

All loops are individually gated by feature flags and only active
when retrieval_mode='optimized'.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional

from config.settings import get_active_retrieval_mode, get_settings

logger = logging.getLogger(__name__)


class MemoryManager:
    """
    Facade coordinating all memory/learning subsystems.

    Lifecycle:
        1. init(doc_id, db, ...) — initialize or load from MongoDB
        2. pre_query(query, user_id, ...) — gather context before retrieval
        3. post_query(record, ...) — learn from completed query
        4. save() — persist all subsystems to MongoDB

    Each subsystem initializes lazily on first use and degrades
    gracefully if it encounters errors (logs warning, returns empty).
    """

    def __init__(self) -> None:
        self._settings = get_settings()
        self._db: Any = None
        self._embedding_client: Any = None
        self._llm_client: Any = None

        # Subsystem instances (lazy-loaded per document)
        self._raptor_indexes: dict[str, Any] = {}  # doc_id -> RaptorIndex
        self._user_memories: dict[str, Any] = {}  # user_id -> UserMemoryManager
        self._query_intel: dict[str, Any] = {}  # doc_id -> QueryIntelligence
        self._retrieval_fb: dict[str, Any] = {}  # doc_id -> RetrievalFeedback
        self._r2r_fallbacks: dict[str, Any] = {}  # doc_id -> R2RFallback

        self._lock = threading.Lock()
        self._initialized = False

    def initialize(
        self,
        db: Any,
        embedding_client: Any = None,
        llm_client: Any = None,
    ) -> None:
        """Initialize the manager with shared resources."""
        self._db = db
        self._embedding_client = embedding_client
        self._llm_client = llm_client
        self._initialized = True
        logger.info("[MemoryManager] Initialized")

    def _is_enabled(self, feature: str) -> bool:
        """Check if a specific memory feature is enabled."""
        if not self._initialized:
            return False
        # Use runtime-aware mode check (respects UI toggle, not just .env)
        if get_active_retrieval_mode() != "optimized":
            return False
        return getattr(get_settings().optimization, feature, False)

    # ------------------------------------------------------------------
    # Lazy loading helpers
    # ------------------------------------------------------------------

    def _get_raptor(self, doc_id: str) -> Any:
        """Get or load RaptorIndex for a document."""
        if doc_id in self._raptor_indexes:
            return self._raptor_indexes[doc_id]
        try:
            from memory.raptor_index import RaptorIndex
            idx = RaptorIndex.load(doc_id, self._db) if self._db is not None else None
            if idx is None:
                idx = RaptorIndex(doc_id=doc_id)
            self._raptor_indexes[doc_id] = idx
            return idx
        except Exception as e:
            logger.warning("[MemoryManager] Failed to load RAPTOR for %s: %s", doc_id, e)
            return None

    def _get_user_memory(self, user_id: str) -> Any:
        """Get or load UserMemoryManager for a user."""
        if user_id in self._user_memories:
            return self._user_memories[user_id]
        try:
            from memory.user_memory import UserMemoryManager
            mem = UserMemoryManager.load(user_id, self._db) if self._db is not None else None
            if mem is None:
                mem = UserMemoryManager(user_id=user_id)
            self._user_memories[user_id] = mem
            return mem
        except Exception as e:
            logger.warning("[MemoryManager] Failed to load user memory for %s: %s", user_id, e)
            return None

    def _get_query_intel(self, doc_id: str) -> Any:
        """Get or load QueryIntelligence for a document."""
        if doc_id in self._query_intel:
            return self._query_intel[doc_id]
        try:
            from memory.query_intelligence import QueryIntelligence
            qi = QueryIntelligence.load(doc_id, self._db) if self._db is not None else None
            if qi is None:
                qi = QueryIntelligence(doc_id=doc_id)
            self._query_intel[doc_id] = qi
            return qi
        except Exception as e:
            logger.warning("[MemoryManager] Failed to load query intel for %s: %s", doc_id, e)
            return None

    def _get_retrieval_fb(self, doc_id: str) -> Any:
        """Get or load RetrievalFeedback for a document."""
        if doc_id in self._retrieval_fb:
            return self._retrieval_fb[doc_id]
        try:
            from memory.retrieval_feedback import RetrievalFeedback
            fb = RetrievalFeedback.load(doc_id, self._db) if self._db is not None else None
            if fb is None:
                fb = RetrievalFeedback(doc_id=doc_id)
            self._retrieval_fb[doc_id] = fb
            return fb
        except Exception as e:
            logger.warning("[MemoryManager] Failed to load retrieval fb for %s: %s", doc_id, e)
            return None

    def _get_r2r(self, doc_id: str) -> Any:
        """Get or load R2RFallback for a document."""
        if doc_id in self._r2r_fallbacks:
            return self._r2r_fallbacks[doc_id]
        try:
            from memory.r2r_fallback import R2RFallback
            r2r = R2RFallback.load(doc_id, self._db) if self._db is not None else None
            if r2r is None:
                r2r = R2RFallback(doc_id=doc_id)
            self._r2r_fallbacks[doc_id] = r2r
            return r2r
        except Exception as e:
            logger.warning("[MemoryManager] Failed to load R2R for %s: %s", doc_id, e)
            return None

    # ------------------------------------------------------------------
    # PRE-QUERY: Gather context before retrieval
    # ------------------------------------------------------------------

    def pre_query(
        self,
        query_text: str,
        doc_id: str,
        user_id: str = "default",
        query_type: str = "",
    ) -> dict:
        """
        Gather all memory context before the retrieval pipeline runs.

        Returns a dict with keys from each active subsystem:
        - raptor_candidates: list[str] — node_ids from RAPTOR pre-filter
        - user_context: str — formatted user memory context for LLM prompt
        - retrieval_hints: dict — from query intelligence
        - reliability_scores: dict[str, float] — node reliability from feedback
        - r2r_results: list[dict] — R2R fallback search results
        """
        context = {
            "raptor_candidates": [],
            "user_context": "",
            "retrieval_hints": {},
            "reliability_scores": {},
            "r2r_results": [],
        }

        t0 = time.time()

        # Loop 1: RAPTOR pre-filter
        if self._is_enabled("enable_raptor_index"):
            try:
                raptor = self._get_raptor(doc_id)
                if raptor and raptor.is_built:
                    results = raptor.query(
                        query_text,
                        self._embedding_client,
                        top_k=15,
                        heat_boost=True,
                    )
                    context["raptor_candidates"] = [r["node_id"] for r in results]
                    logger.debug("[MemoryManager] RAPTOR returned %d candidates", len(results))
            except Exception as e:
                logger.warning("[MemoryManager] RAPTOR pre-query failed: %s", e)

        # Loop 2: User memory context
        if self._is_enabled("enable_user_memory"):
            try:
                user_mem = self._get_user_memory(user_id)
                if user_mem:
                    mem_context = user_mem.get_user_context(query_text, doc_id)
                    context["user_context"] = mem_context.get("formatted_context", "")
            except Exception as e:
                logger.warning("[MemoryManager] User memory pre-query failed: %s", e)

        # Loop 3: Query intelligence hints
        if self._is_enabled("enable_query_intelligence"):
            try:
                qi = self._get_query_intel(doc_id)
                if qi:
                    hints = qi.get_retrieval_hints(
                        query_text,
                        query_type=query_type,
                        embedding_client=self._embedding_client,
                    )
                    context["retrieval_hints"] = hints
                    logger.debug("[MemoryManager] Query intel: %d hints", hints.get("similar_facts_found", 0))
            except Exception as e:
                logger.warning("[MemoryManager] Query intel pre-query failed: %s", e)

        # Loop 4: Retrieval feedback reliability scores
        if self._is_enabled("enable_retrieval_feedback"):
            try:
                fb = self._get_retrieval_fb(doc_id)
                if fb:
                    context["reliability_scores"] = fb.get_node_score_map()
            except Exception as e:
                logger.warning("[MemoryManager] Retrieval feedback pre-query failed: %s", e)

        # Loop 5: R2R fallback search
        if self._is_enabled("enable_r2r_fallback"):
            try:
                r2r = self._get_r2r(doc_id)
                if r2r and r2r._built:
                    results = r2r.search(
                        query_text,
                        embedding_client=self._embedding_client,
                        top_k=10,
                    )
                    context["r2r_results"] = [
                        {"node_id": r.node_id, "score": r.score, "source": r.source}
                        for r in results
                    ]
                    logger.debug("[MemoryManager] R2R returned %d results", len(results))
            except Exception as e:
                logger.warning("[MemoryManager] R2R pre-query failed: %s", e)

        elapsed = time.time() - t0
        logger.info("[MemoryManager] pre_query completed in %.3fs", elapsed)
        return context

    # ------------------------------------------------------------------
    # POST-QUERY: Learn from completed query
    # ------------------------------------------------------------------

    def post_query(
        self,
        record: Any,  # QueryRecord
        doc_id: str,
        user_id: str = "default",
    ) -> None:
        """
        Learn from a completed query across all active subsystems.

        Called after the answer is generated and the QueryRecord is saved.
        """
        t0 = time.time()
        _mode = get_active_retrieval_mode()
        logger.info(
            "[MemoryManager] post_query called: doc=%s user=%s mode=%s initialized=%s",
            doc_id, user_id, _mode, self._initialized,
        )
        _flags = {
            "raptor": self._is_enabled("enable_raptor_index"),
            "user_mem": self._is_enabled("enable_user_memory"),
            "query_intel": self._is_enabled("enable_query_intelligence"),
            "retrieval_fb": self._is_enabled("enable_retrieval_feedback"),
        }
        logger.info("[MemoryManager] Feature flags: %s", _flags)

        # Loop 1: RAPTOR heat map update
        if self._is_enabled("enable_raptor_index"):
            try:
                raptor = self._get_raptor(doc_id)
                if raptor:
                    raptor.record_citations_from_answer(record)
                    logger.info("[MemoryManager] Loop 1 RAPTOR: OK (doc=%s)", doc_id)
            except Exception as e:
                logger.warning("[MemoryManager] RAPTOR post-query failed: %s", e)

        # Loop 2: User memory update
        if self._is_enabled("enable_user_memory"):
            try:
                user_mem = self._get_user_memory(user_id)
                if user_mem:
                    cited_nodes = [
                        c.node_id for c in getattr(record, "citations", [])
                    ]
                    key_terms = getattr(record, "key_terms", [])
                    query_type = (
                        record.query_type.value
                        if hasattr(record.query_type, "value")
                        else str(record.query_type)
                    )
                    user_mem.add_interaction(
                        query_text=record.query_text,
                        answer_text=record.answer_text[:500] if record.answer_text else "",
                        doc_id=doc_id,
                        key_terms=key_terms,
                        query_type=query_type,
                        feedback_rating=(
                            record.feedback.rating if record.feedback else None
                        ),
                    )
                    logger.info("[MemoryManager] Loop 2 UserMemory: OK (user=%s)", user_id)
            except Exception as e:
                logger.warning("[MemoryManager] User memory post-query failed: %s", e)

        # Loop 3: Query intelligence learning
        if self._is_enabled("enable_query_intelligence"):
            try:
                qi = self._get_query_intel(doc_id)
                if qi:
                    qi.learn_from_query(record, self._embedding_client)
                    logger.info("[MemoryManager] Loop 3 QueryIntel: OK (doc=%s)", doc_id)
            except Exception as e:
                logger.warning("[MemoryManager] Query intel post-query failed: %s", e)

        # Loop 4: Retrieval feedback grading
        if self._is_enabled("enable_retrieval_feedback"):
            try:
                fb = self._get_retrieval_fb(doc_id)
                if fb:
                    fb.grade_retrieval(record)
                    logger.info("[MemoryManager] Loop 4 RetrievalFB: OK (doc=%s)", doc_id)
            except Exception as e:
                logger.warning("[MemoryManager] Retrieval feedback post-query failed: %s", e)

        elapsed = time.time() - t0
        logger.info("[MemoryManager] post_query completed in %.3fs", elapsed)

    # ------------------------------------------------------------------
    # Index building
    # ------------------------------------------------------------------

    def build_raptor_index(self, tree: Any, doc_id: str) -> bool:
        """Build RAPTOR index for a document tree."""
        if not self._is_enabled("enable_raptor_index"):
            return False
        try:
            from memory.raptor_index import RaptorIndex
            raptor = RaptorIndex(doc_id=doc_id)
            raptor.build(tree, self._embedding_client, self._llm_client)
            self._raptor_indexes[doc_id] = raptor
            if self._db is not None:
                raptor.save(self._db)
            logger.info("[MemoryManager] Built RAPTOR index for %s", doc_id)
            return True
        except Exception as e:
            logger.error("[MemoryManager] RAPTOR build failed for %s: %s", doc_id, e)
            return False

    def build_r2r_index(self, tree: Any, doc_id: str) -> bool:
        """Build R2R fallback index for a document tree."""
        if not self._is_enabled("enable_r2r_fallback"):
            return False
        try:
            from memory.r2r_fallback import R2RFallback
            r2r = R2RFallback(doc_id=doc_id)
            r2r.build_index(tree, self._embedding_client)
            self._r2r_fallbacks[doc_id] = r2r
            if self._db is not None:
                r2r.save(self._db)
            logger.info("[MemoryManager] Built R2R index for %s", doc_id)
            return True
        except Exception as e:
            logger.error("[MemoryManager] R2R build failed for %s: %s", doc_id, e)
            return False

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save_all(self, doc_id: Optional[str] = None) -> None:
        """Persist all subsystems to MongoDB."""
        if self._db is None:
            logger.warning("[MemoryManager] No DB connection — skipping save")
            return

        saved = 0

        # Save RAPTOR indexes
        targets = (
            {doc_id: self._raptor_indexes[doc_id]}
            if doc_id and doc_id in self._raptor_indexes
            else self._raptor_indexes
        )
        for did, raptor in targets.items():
            try:
                raptor.save(self._db)
                saved += 1
            except Exception as e:
                logger.warning("[MemoryManager] Failed to save RAPTOR %s: %s", did, e)

        # Save user memories
        for uid, mem in self._user_memories.items():
            try:
                mem.save(self._db)
                saved += 1
            except Exception as e:
                logger.warning("[MemoryManager] Failed to save user memory %s: %s", uid, e)

        # Save query intelligence
        targets = (
            {doc_id: self._query_intel[doc_id]}
            if doc_id and doc_id in self._query_intel
            else self._query_intel
        )
        for did, qi in targets.items():
            try:
                qi.save(self._db)
                saved += 1
            except Exception as e:
                logger.warning("[MemoryManager] Failed to save query intel %s: %s", did, e)

        # Save retrieval feedback
        targets = (
            {doc_id: self._retrieval_fb[doc_id]}
            if doc_id and doc_id in self._retrieval_fb
            else self._retrieval_fb
        )
        for did, fb in targets.items():
            try:
                fb.save(self._db)
                saved += 1
            except Exception as e:
                logger.warning("[MemoryManager] Failed to save retrieval fb %s: %s", did, e)

        # Save R2R fallbacks
        targets = (
            {doc_id: self._r2r_fallbacks[doc_id]}
            if doc_id and doc_id in self._r2r_fallbacks
            else self._r2r_fallbacks
        )
        for did, r2r in targets.items():
            try:
                r2r.save(self._db)
                saved += 1
            except Exception as e:
                logger.warning("[MemoryManager] Failed to save R2R %s: %s", did, e)

        logger.info("[MemoryManager] Saved %d subsystem instances", saved)

    # ------------------------------------------------------------------
    # User feedback
    # ------------------------------------------------------------------

    def apply_user_feedback(
        self,
        doc_id: str,
        user_id: str,
        cited_node_ids: list[str],
        rating: int,
    ) -> None:
        """Apply explicit user feedback to relevant subsystems."""
        # Retrieval feedback
        if self._is_enabled("enable_retrieval_feedback"):
            try:
                fb = self._get_retrieval_fb(doc_id)
                if fb:
                    fb.apply_user_feedback(cited_node_ids, rating)
            except Exception as e:
                logger.warning("[MemoryManager] Feedback apply failed: %s", e)

        # User memory
        if self._is_enabled("enable_user_memory"):
            try:
                user_mem = self._get_user_memory(user_id)
                if user_mem and user_mem._profile:
                    # Update satisfaction in profile
                    user_mem._profile.satisfaction_ratings.append(rating)
                    if len(user_mem._profile.satisfaction_ratings) > 50:
                        user_mem._profile.satisfaction_ratings = (
                            user_mem._profile.satisfaction_ratings[-50:]
                        )
            except Exception as e:
                logger.warning("[MemoryManager] User feedback apply failed: %s", e)

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    def get_stats(self, doc_id: Optional[str] = None) -> dict:
        """Get aggregate stats from all memory subsystems."""
        stats = {
            "initialized": self._initialized,
            "subsystems": {},
        }

        # RAPTOR stats
        if doc_id and doc_id in self._raptor_indexes:
            try:
                stats["subsystems"]["raptor"] = self._raptor_indexes[doc_id].get_stats()
            except Exception:
                stats["subsystems"]["raptor"] = {"error": "failed to get stats"}
        else:
            stats["subsystems"]["raptor"] = {"loaded_docs": len(self._raptor_indexes)}

        # User memory stats
        stats["subsystems"]["user_memory"] = {
            "loaded_users": len(self._user_memories),
        }

        # Query intelligence stats
        if doc_id and doc_id in self._query_intel:
            try:
                stats["subsystems"]["query_intelligence"] = self._query_intel[doc_id].get_stats()
            except Exception:
                stats["subsystems"]["query_intelligence"] = {"error": "failed to get stats"}
        else:
            stats["subsystems"]["query_intelligence"] = {"loaded_docs": len(self._query_intel)}

        # Retrieval feedback stats
        if doc_id and doc_id in self._retrieval_fb:
            try:
                stats["subsystems"]["retrieval_feedback"] = self._retrieval_fb[doc_id].get_stats()
            except Exception:
                stats["subsystems"]["retrieval_feedback"] = {"error": "failed to get stats"}
        else:
            stats["subsystems"]["retrieval_feedback"] = {"loaded_docs": len(self._retrieval_fb)}

        # R2R fallback stats
        if doc_id and doc_id in self._r2r_fallbacks:
            try:
                stats["subsystems"]["r2r_fallback"] = self._r2r_fallbacks[doc_id].get_stats()
            except Exception:
                stats["subsystems"]["r2r_fallback"] = {"error": "failed to get stats"}
        else:
            stats["subsystems"]["r2r_fallback"] = {"loaded_docs": len(self._r2r_fallbacks)}

        return stats


# ------------------------------------------------------------------
# Singleton accessor
# ------------------------------------------------------------------

_memory_manager: Optional[MemoryManager] = None
_mm_lock = threading.Lock()


def get_memory_manager() -> MemoryManager:
    """Get or create the singleton MemoryManager."""
    global _memory_manager
    if _memory_manager is None:
        with _mm_lock:
            if _memory_manager is None:
                _memory_manager = MemoryManager()
    return _memory_manager
