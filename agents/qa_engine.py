"""
QA Engine for GOVINDA V2.

Top-level orchestrator: query -> retrieve -> reflect -> synthesize -> verify -> answer.

This is the single entry point for asking questions about a document.
All other components (router, reflector, synthesizer, verifier, planner)
are internal details coordinated here.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from config.settings import get_settings
from models.document import DocumentTree
from models.query import Answer, Query, QueryType, RetrievalResult, RoutingLog
from retrieval.router import StructuralRouter
from retrieval.retrieval_reflector import RetrievalReflector
from agents.synthesizer import Synthesizer
from agents.verifier import Verifier
from agents.planner import Planner
from tree.tree_store import TreeStore
from utils.llm_client import LLMClient
from utils.benchmark import BenchmarkTracker

logger = logging.getLogger(__name__)


class QAEngine:
    """
    End-to-end question answering over a document tree.

    Pipeline:
    1. Load document tree
    2. Classify query type
    3. Route retrieval (single-pass or multi-hop planner)
    4. Synthesize answer with citations
    5. Verify answer against sources
    6. Return complete Answer with metadata
    """

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()
        self._router = StructuralRouter(self._llm)
        self._reflector = RetrievalReflector(self._llm)
        self._synthesizer = Synthesizer(self._llm)
        self._verifier = Verifier(self._llm)
        self._planner = Planner(self._llm, self._router, self._synthesizer)
        self._tree_store = TreeStore()

        # Cached trees (avoid reloading for repeated queries)
        self._trees: dict[str, DocumentTree] = {}

        # Current benchmark tracker (set per-query)
        self._tracker: Optional[BenchmarkTracker] = None

        # Phase 2: Semantic query cache (lazy-init on first optimized query)
        self._query_cache = None
        self._embedding_client_for_cache = None

    def _get_retrieval_mode(self) -> str:
        """Get the current retrieval mode from runtime config."""
        try:
            from app_backend.main import get_retrieval_mode
            return get_retrieval_mode()
        except Exception:
            return self._settings.optimization.retrieval_mode

    def _is_feature_enabled(self, feature: str) -> bool:
        """Check if a specific optimization feature is enabled."""
        if self._get_retrieval_mode() != "optimized":
            return False
        try:
            from app_backend.main import _runtime_config
            if feature in _runtime_config:
                return bool(_runtime_config[feature])
        except Exception:
            pass
        return getattr(self._settings.optimization, feature, False)

    def load_document(self, doc_id: str) -> DocumentTree:
        """
        Load a document tree by ID.

        Args:
            doc_id: Document ID (e.g., "doc_edb26d069d9d").

        Returns:
            The loaded DocumentTree.

        Raises:
            FileNotFoundError: If no tree exists for this doc_id.
        """
        if doc_id in self._trees:
            return self._trees[doc_id]

        tree = self._tree_store.load(doc_id)
        if tree is None:
            raise FileNotFoundError(
                f"No document tree found for '{doc_id}'. Run ingestion first."
            )
        self._trees[doc_id] = tree
        return tree

    # ------------------------------------------------------------------
    # Phase 1 — Retrieval (fast, ~16s)
    # ------------------------------------------------------------------

    def retrieve(
        self,
        query_text: str,
        doc_id: str,
        reflect: bool = False,
    ) -> RetrievalResult:
        """
        Phase 1: Load tree, classify, retrieve, optionally reflect.

        Dispatches to legacy or optimized path based on the retrieval_mode toggle.
        Returns a RetrievalResult that can be displayed immediately
        while Phase 2 (synthesis + verification) runs.
        """
        mode = self._get_retrieval_mode()
        self._tracker = BenchmarkTracker(
            query_text=query_text, doc_id=doc_id,
            retrieval_mode=mode, llm_client=self._llm,
        )
        logger.info("[QA] Retrieval mode: %s", mode)

        if mode == "optimized":
            return self._retrieve_optimized(query_text, doc_id, reflect)
        else:
            return self._retrieve_legacy(query_text, doc_id, reflect)

    def _retrieve_legacy(
        self,
        query_text: str,
        doc_id: str,
        reflect: bool = False,
    ) -> RetrievalResult:
        """Legacy retrieval path — exact original pipeline, untouched."""
        start = time.time()
        self._llm.reset_usage()
        self._router.reset_memory_state()
        timings: dict[str, float] = {}

        # Step 1: Load tree
        logger.info("[QA 1/6] Loading document tree...")
        t0 = time.time()
        tree = self.load_document(doc_id)
        timings["1_load_tree"] = time.time() - t0
        logger.info("  -> %d nodes, %d pages (%.1fs)", tree.node_count, tree.total_pages, timings["1_load_tree"])

        # Step 2: Classify + Retrieve
        logger.info("[QA 2/6] Classifying query and retrieving sections...")
        t0 = time.time()
        query, sections, routing_log = self._router.retrieve(query_text, tree)
        timings["2_retrieval"] = time.time() - t0
        logger.info(
            "  -> Type: %s, %d sections, %d tokens (%.1fs)",
            query.query_type.value,
            len(sections),
            sum(s.token_count for s in sections),
            timings["2_retrieval"],
        )

        # Step 3: Reflect on evidence sufficiency and fill gaps (opt-in)
        t0 = time.time()
        if reflect:
            logger.info("[QA 3/6] Reflecting on evidence sufficiency...")
            sections = self._reflector.reflect_and_fill(query, sections, tree, self._router)
            timings["3_reflection"] = time.time() - t0
            logger.info(
                "  -> After reflection: %d sections, %d tokens (%.1fs)",
                len(sections),
                sum(s.token_count for s in sections),
                timings["3_reflection"],
            )
        else:
            timings["3_reflection"] = 0.0
            logger.info("[QA 3/6] Reflection skipped (opt-in)")

        return RetrievalResult(
            query=query,
            sections=sections,
            routing_log=routing_log,
            tree=tree,
            timings=timings,
            llm_usage_snapshot=self._llm.get_usage_summary(),
            start_time=start,
        )

    def _retrieve_optimized(
        self,
        query_text: str,
        doc_id: str,
        reflect: bool = False,
    ) -> RetrievalResult:
        """Optimized retrieval path — with benchmarking, caching, pre-filter, and memory."""
        start = time.time()
        self._llm.reset_usage()
        self._router.reset_memory_state()
        timings: dict[str, float] = {}
        tracker = self._tracker

        # Phase 0: Memory pre-query — gather context from all learning loops
        memory_context: dict = {}
        _memory_contribution = None  # MemoryContribution for diagnostics
        t_mem = time.time()
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if mm._initialized:
                memory_context, _memory_contribution = mm.pre_query(
                    query_text=query_text,
                    doc_id=doc_id,
                    user_id=getattr(self, "_current_user_id", "default"),
                )
        except Exception as e:
            logger.warning("[QA] Memory pre-query failed (non-fatal): %s", e)
        timings["0_memory_prequery"] = time.time() - t_mem
        if memory_context:
            logger.info(
                "[QA 0/6] Memory context: raptor=%d user_ctx=%s hints=%d r2r=%d (%.2fs)",
                len(memory_context.get("raptor_candidates", [])),
                bool(memory_context.get("user_context")),
                memory_context.get("retrieval_hints", {}).get("similar_facts_found", 0),
                len(memory_context.get("r2r_results", [])),
                timings["0_memory_prequery"],
            )

        # Step 1: Load tree + embedding index
        with tracker.stage("load_tree") as s:
            tree = self.load_document(doc_id)
            s.set_metadata("node_count", tree.node_count)
            s.set_metadata("total_pages", tree.total_pages)

            # Load embedding index and set on router if prefilter is enabled
            _emb_index = None
            _emb_client = None
            if self._is_feature_enabled("enable_embedding_prefilter"):
                _emb_index = self._tree_store.load_embedding_index(doc_id)
                if _emb_index:
                    from utils.embedding_client import EmbeddingClient
                    _emb_client = EmbeddingClient()
                    self._router.set_embedding_context(_emb_index, _emb_client)
                    s.set_metadata("embedding_index_entries", len(_emb_index.entries))
                else:
                    s.set_metadata("embedding_index_entries", 0)
                    logger.info("[QA] No embedding index found for %s — using full tree index", doc_id)

            # Inject RAPTOR candidates as additional pre-filter candidates
            raptor_candidates = memory_context.get("raptor_candidates", [])

            # Merge Query Intelligence suggested_nodes into candidates
            qi_hints = memory_context.get("retrieval_hints", {})
            qi_suggested = qi_hints.get("suggested_nodes", [])
            qi_avoid = qi_hints.get("avoid_nodes", [])

            all_memory_candidates = list(raptor_candidates)
            if qi_suggested:
                # Add QI-suggested nodes (deduplicate)
                existing = set(all_memory_candidates)
                for nid in qi_suggested:
                    if nid not in existing:
                        all_memory_candidates.append(nid)
                s.set_metadata("qi_suggested_nodes", len(qi_suggested))

            if all_memory_candidates:
                self._router.set_memory_candidates(all_memory_candidates)
                s.set_metadata("raptor_candidates", len(raptor_candidates))
                s.set_metadata("total_memory_candidates", len(all_memory_candidates))

            # Pass avoid_nodes so router can filter them out
            if qi_avoid:
                self._router.set_avoid_nodes(qi_avoid)
                s.set_metadata("qi_avoid_nodes", len(qi_avoid))

            # Inject reliability scores for node weighting
            reliability_scores = memory_context.get("reliability_scores", {})
            if reliability_scores:
                self._router.set_reliability_scores(reliability_scores)
                s.set_metadata("reliability_scored_nodes", len(reliability_scores))

        timings["1_load_tree"] = tracker._stages[-1].duration_seconds
        logger.info("  -> %d nodes, %d pages (%.1fs)", tree.node_count, tree.total_pages, timings["1_load_tree"])

        # Step 2: Classify + Retrieve (with benchmark wrapping)
        with tracker.stage("retrieval") as s:
            # Inject user context into query text supplement if available.
            # Cap user context to prevent retrieval input token explosion:
            # uncapped context grew to 180K+ tokens by Q11 in testing,
            # causing 190K retrieval input tokens per query (15-20x normal).
            _USER_CONTEXT_MAX_CHARS = 1500
            user_context = memory_context.get("user_context", "")
            if user_context and len(user_context) > _USER_CONTEXT_MAX_CHARS:
                user_context = user_context[:_USER_CONTEXT_MAX_CHARS] + "\n[…truncated]"
                logger.info(
                    "[QA] User context capped at %d chars (was %d)",
                    _USER_CONTEXT_MAX_CHARS,
                    len(memory_context.get("user_context", "")),
                )
            effective_query = query_text
            if user_context and self._is_feature_enabled("enable_user_memory"):
                effective_query = f"{query_text}\n\n[User Context]: {user_context}"
                s.set_metadata("user_context_injected", True)
                s.set_metadata("user_context_chars", len(user_context))

            query, sections, routing_log = self._router.retrieve(effective_query, tree)

            # Restore original query text on the Query object
            query.text = query_text

            s.set_metadata("query_type", query.query_type.value)
            s.set_metadata("sections_count", len(sections))
            s.set_metadata("tokens_retrieved", sum(sec.token_count for sec in sections))

            # R2R fallback merge: add high-confidence fallback nodes
            r2r_results = memory_context.get("r2r_results", [])
            if r2r_results and self._is_feature_enabled("enable_r2r_fallback"):
                try:
                    from memory.r2r_fallback import R2RFallback, SearchResult
                    from memory.memory_manager import get_memory_manager
                    mm = get_memory_manager()
                    r2r = mm._get_r2r(doc_id)
                    if r2r:
                        locator_node_ids = [sec.node_id for sec in sections]
                        fallback_objs = [
                            SearchResult(
                                node_id=r["node_id"],
                                score=r["score"],
                                source=r["source"],
                            )
                            for r in r2r_results
                        ]
                        merge_result = r2r.merge_with_locator(
                            locator_node_ids, fallback_objs,
                            max_fallback_additions=3,
                        )
                        # Read fallback-only nodes and add them as sections
                        fallback_additions = merge_result.get("fallback_additions", [])
                        if fallback_additions and tree:
                            for nid in fallback_additions:
                                node = tree.get_node(nid)
                                if node and node.text:
                                    from models.query import RetrievedSection
                                    fb_section = RetrievedSection(
                                        node_id=nid,
                                        title=node.title,
                                        text=node.text,
                                        page_range=node.page_range_str,
                                        token_count=node.token_count,
                                        source="r2r_fallback",
                                    )
                                    sections.append(fb_section)
                            s.set_metadata("r2r_fallback_added", len(fallback_additions))
                            logger.info(
                                "[QA] R2R fallback added %d sections", len(fallback_additions)
                            )
                except Exception as e:
                    logger.warning("[QA] R2R fallback merge failed: %s", e)

        timings["2_retrieval"] = tracker._stages[-1].duration_seconds
        logger.info(
            "  -> Type: %s, %d sections, %d tokens (%.1fs)",
            query.query_type.value,
            len(sections),
            sum(sec.token_count for sec in sections),
            timings["2_retrieval"],
        )

        # Step 3: Reflect (with optimized thresholds if tuning enabled)
        if reflect:
            with tracker.stage("reflection") as s:
                sections = self._reflector.reflect_and_fill(query, sections, tree, self._router)
                s.set_metadata("sections_after", len(sections))
                s.set_metadata("tokens_after", sum(sec.token_count for sec in sections))
            timings["3_reflection"] = tracker._stages[-1].duration_seconds
        else:
            tracker.record_skip("reflection", reason="opt-in disabled")
            timings["3_reflection"] = 0.0

        rr = RetrievalResult(
            query=query,
            sections=sections,
            routing_log=routing_log,
            tree=tree,
            timings=timings,
            llm_usage_snapshot=self._llm.get_usage_summary(),
            start_time=start,
        )
        # Attach memory contribution for diagnostics (not part of dataclass)
        rr._memory_contribution = _memory_contribution  # type: ignore[attr-defined]
        # Attach memory context for use in synthesis phase
        rr._memory_context = memory_context  # type: ignore[attr-defined]
        return rr

    # ------------------------------------------------------------------
    # Phase 2 — Synthesis + Verification (slow, ~100-180s)
    # ------------------------------------------------------------------

    def synthesize_and_verify(
        self,
        rr: RetrievalResult,
        query_text: str,
        verify: bool = True,
        reflect: bool = False,
    ) -> Answer:
        """
        Phase 2: Synthesize and verify from previously retrieved sections.

        Picks up timing counters from Phase 1 via the RetrievalResult.
        """
        timings = dict(rr.timings)  # copy
        query = rr.query
        sections = rr.sections
        tree = rr.tree

        # Apply Query Intelligence hints for skip_reflection / skip_verification
        _mem_ctx = getattr(rr, "_memory_context", {})
        _qi_hints = _mem_ctx.get("retrieval_hints", {}) if _mem_ctx else {}
        if _qi_hints.get("skip_reflection") and reflect:
            logger.info("[QA] QI hint: skipping reflection (help rate < 15%% for this query type)")
            reflect = False
        if _qi_hints.get("skip_verification") and verify:
            logger.info("[QA] QI hint: skipping verification (clean rate > 90%% for this query type)")
            verify = False

        # Inject user memory context into query for synthesis (capped)
        _user_ctx = _mem_ctx.get("user_context", "") if _mem_ctx else ""
        if _user_ctx and len(_user_ctx) > 1500:
            _user_ctx = _user_ctx[:1500] + "\n[…truncated]"
        _original_query_text = query.text
        if _user_ctx and self._get_retrieval_mode() == "optimized":
            query.text = f"{query.text}\n\n[User Context]: {_user_ctx}"
            logger.info("[QA] Injecting user memory context into synthesis prompt")

        # Step 4: Synthesis (or planner for multi-hop)
        t0 = time.time()
        if (
            query.query_type in (QueryType.MULTI_HOP, QueryType.GLOBAL)
            and len(query.sub_queries) > 1
        ):
            reflection_extras = [
                s for s in sections
                if getattr(s, "source", "") == "reflection_gap_fill"
            ] if reflect else []
            logger.info(
                "[QA 4/6] Multi-hop query — using planner...%s",
                f" (passing {len(reflection_extras)} reflection sections as extras)"
                if reflection_extras else "",
            )
            answer = self._planner.plan_and_answer(
                query, tree, extra_sections=reflection_extras or None
            )
        else:
            logger.info("[QA 4/6] Synthesizing answer...")
            # Request synthesis and optional verification in a single LLM call
            answer = self._synthesizer.synthesize(query, sections, verify=verify)

        # Restore original query text after synthesis
        query.text = _original_query_text
        timings["4_synthesis"] = time.time() - t0
        logger.info("  -> Synthesis complete (%.1fs)", timings["4_synthesis"])

        # Attach retrieval metadata
        answer.located_nodes = []
        answer.retrieved_sections = sections
        answer.routing_log = rr.routing_log

        # Step 5: Verification
        # If verification wasn't included in synthesis, fall back to explicit verifier
        t0 = time.time()
        if verify and not answer.verification_status:
            logger.info("[QA 5/6] Verification not present in synthesis — running verifier...")
            answer = self._verifier.verify(answer, query_text=query_text)
        elif verify and answer.verification_status:
            logger.info("[QA 5/6] Verification provided inline by synthesizer")
        else:
            logger.info("[QA 5/6] Skipping verification")
            answer.verification_status = "skipped"
        timings["5_verification"] = time.time() - t0
        logger.info("  -> Verification complete (%.1fs)", timings["5_verification"])

        # Step 6: Finalize metrics
        elapsed = time.time() - rr.start_time
        usage = self._llm.get_usage_summary()

        answer.total_time_seconds = elapsed
        answer.total_tokens = usage["total_tokens"]
        answer.llm_calls = usage["total_calls"]
        answer.stage_timings = timings

        logger.info(
            "[QA 6/6] Complete: %s, %d citations, %.1fs, %d LLM calls, %d tokens",
            answer.verification_status,
            len(answer.citations),
            elapsed,
            answer.llm_calls,
            answer.total_tokens,
        )
        logger.info(
            "  -> Timing breakdown: %s",
            " | ".join(f"{k}: {v:.1f}s" for k, v in timings.items()),
        )

        self._log_contribution_analysis(answer, sections, timings, elapsed)

        # Finalize and save benchmark (if tracker exists)
        if self._tracker:
            benchmark = self._tracker.finalize()
            try:
                from tree.benchmark_store import BenchmarkStore
                from app_backend.main import get_benchmark_store
                bstore = get_benchmark_store()
                if bstore:
                    benchmark_id = bstore.save(benchmark)
                    answer.stage_timings["_benchmark_id"] = benchmark_id
                    answer.stage_timings["_benchmark"] = benchmark.to_dict()
            except Exception as e:
                logger.warning("Failed to save benchmark: %s", e)
            self._tracker = None

        # Phase 3: Memory post-query learning (optimized mode only)
        if self._get_retrieval_mode() == "optimized":
            self._learn_from_answer(answer, query_text, rr)

        return answer

    # ------------------------------------------------------------------
    # Phase 3 — Memory Learning (non-blocking, after answer)
    # ------------------------------------------------------------------

    def _learn_from_answer(
        self,
        answer: Answer,
        query_text: str,
        rr: RetrievalResult,
    ) -> None:
        """
        Feed the completed query back into all memory subsystems.

        This is called in optimized mode after the answer is finalized.
        It constructs a lightweight QueryRecord-like object for the
        memory manager, so learning happens without depending on the
        full persistence layer.

        Also enriches and persists the MemoryContribution snapshot
        for diagnostics / trend analysis.
        """
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not mm._initialized:
                return

            # Retrieve the MemoryContribution created during pre_query
            mc = getattr(rr, "_memory_contribution", None)

            # Build a lightweight record-like object for the learning hooks
            _Record = type("_Record", (), {})
            record = _Record()
            record.query_text = query_text
            record.answer_text = answer.text
            record.citations = answer.citations
            record.routing_log = rr.routing_log
            record.query_type = rr.query.query_type
            record.key_terms = rr.query.key_terms
            record.verification_status = answer.verification_status
            record.total_time_seconds = answer.total_time_seconds
            record.feedback = None  # No feedback yet at this point

            doc_id = getattr(rr.query, "doc_id", "") or ""
            if not doc_id and rr.tree:
                doc_id = rr.tree.doc_id

            mc = mm.post_query(
                record=record,
                doc_id=doc_id,
                user_id=getattr(self, "_current_user_id", "default"),
                contribution=mc,
            )

            logger.info("[QA] Memory learning completed for doc=%s", doc_id)

            # Persist all learned data to MongoDB so it survives restarts
            try:
                mm.save_all(doc_id=doc_id)
            except Exception as save_err:
                logger.warning("[QA] Memory save_all failed (non-fatal): %s", save_err)

            # ── Enrich contribution with answer-level metrics ──
            if mc:
                self._enrich_memory_contribution(mc, answer, rr)

                # Persist to MongoDB
                try:
                    from memory.memory_diagnostics import save_contribution
                    save_contribution(mm._db, mc)
                    logger.info(
                        "[QA] Memory contribution saved: contributed=%s precision=%.2f",
                        mc.memory_contributed, mc.retrieval_precision,
                    )
                except Exception as save_err:
                    logger.warning("[QA] Failed to save memory contribution: %s", save_err)

        except Exception as e:
            logger.warning("[QA] Memory learning failed (non-fatal): %s", e)

    @staticmethod
    def _enrich_memory_contribution(mc: Any, answer: Answer, rr: Any) -> None:
        """
        Fill in answer-level fields on a MemoryContribution after synthesis.

        Computes:
        - retrieval_precision (citations / sections)
        - memory_assisted_citations (cited nodes that came from RAPTOR or R2R)
        - r2r fallback usage
        - user context injection
        - overall verdict
        """
        sections = rr.sections
        cited_node_ids = {c.node_id for c in answer.citations}
        mc.total_sections_retrieved = len(sections)
        mc.total_citations = len(answer.citations)
        mc.retrieval_precision = round(
            len(cited_node_ids) / max(len(sections), 1), 3
        )
        mc.query_type = (
            rr.query.query_type.value
            if hasattr(rr.query.query_type, "value")
            else str(rr.query.query_type)
        )

        # Track RAPTOR-assisted citations: nodes that were in RAPTOR candidate list AND cited
        memory_context = getattr(rr, "_memory_context", {}) or {}
        raptor_candidate_ids = set(memory_context.get("raptor_candidates", []))
        if mc.raptor.fired and raptor_candidate_ids:
            mc.raptor.items_used = len(raptor_candidate_ids & cited_node_ids)

        # Track QI-suggested nodes that ended up cited
        qi_hints = memory_context.get("retrieval_hints", {}) or {}
        qi_suggested_ids = set(qi_hints.get("suggested_nodes", []))
        if mc.query_intel.fired and qi_suggested_ids:
            mc.query_intel.items_used = len(qi_suggested_ids & cited_node_ids)

        # Track R2R fallback-assisted citations
        r2r_sections = [s for s in sections if getattr(s, "source", "") == "r2r_fallback"]
        mc.r2r_fallback_sections_added = len(r2r_sections)
        mc.r2r_fallback_sections_cited = sum(
            1 for s in r2r_sections if s.node_id in cited_node_ids
        )
        if mc.r2r_fallback.fired:
            mc.r2r_fallback.items_used = mc.r2r_fallback_sections_cited

        # Track user context injection
        mc.user_context_injected = mc.user_memory.fired and mc.user_memory.items_returned > 0

        # Track reliability scores applied
        if mc.retrieval_fb.fired:
            mc.reliability_scores_applied = mc.retrieval_fb.items_returned

        # Count memory-assisted citations (from any memory source)
        mc.memory_assisted_citations = (
            mc.raptor.items_used
            + mc.query_intel.items_used
            + mc.r2r_fallback_sections_cited
        )

        # Overall verdict: did memory measurably help?
        mc.memory_contributed = (
            mc.memory_assisted_citations > 0
            or mc.user_context_injected
            or (mc.query_intel.fired and mc.query_intel.items_returned > 0)
            or mc.reliability_scores_applied > 0
        )

        # Human-readable summary
        parts = []
        if mc.raptor.items_used > 0:
            parts.append(f"RAPTOR: {mc.raptor.items_used} cited")
        if mc.r2r_fallback_sections_cited > 0:
            parts.append(f"R2R: {mc.r2r_fallback_sections_cited} cited")
        if mc.user_context_injected:
            parts.append("user context injected")
        if mc.query_intel.items_returned > 0:
            parts.append(f"QI: {mc.query_intel.items_returned} hints")
        if mc.reliability_scores_applied > 0:
            parts.append(f"FB: {mc.reliability_scores_applied} scored nodes")
        mc.contribution_summary = " | ".join(parts) if parts else "no measurable contribution"

    # ------------------------------------------------------------------
    # Convenience wrapper (backward-compatible)
    # ------------------------------------------------------------------

    def _get_query_cache(self):
        """Lazy-init and return the query cache."""
        if self._query_cache is None:
            from retrieval.query_cache import QueryCache
            self._query_cache = QueryCache()
        return self._query_cache

    def _get_cache_embedding_client(self):
        """Lazy-init and return the embedding client for cache lookups."""
        if self._embedding_client_for_cache is None:
            from utils.embedding_client import EmbeddingClient
            self._embedding_client_for_cache = EmbeddingClient()
        return self._embedding_client_for_cache

    def ask(
        self,
        query_text: str,
        doc_id: str,
        verify: bool = True,
        reflect: bool = False,
    ) -> Answer:
        """
        Ask a question about a document (runs retrieve + synthesize in one call).

        In optimized mode with query cache enabled, checks the cache first
        and returns cached answer on semantic hit.
        """
        # Phase 2: Query cache check (optimized mode only)
        if self._is_feature_enabled("enable_query_cache"):
            try:
                cache = self._get_query_cache()
                emb_client = self._get_cache_embedding_client()
                query_embedding = emb_client.embed(query_text)
                cached = cache.lookup(query_text, query_embedding, doc_id)
                if cached:
                    from models.query import Answer as AnswerModel
                    answer = AnswerModel.from_dict(cached)
                    answer.stage_timings = answer.stage_timings or {}
                    answer.stage_timings["_cache_hit"] = True
                    return answer
            except Exception as e:
                logger.warning("[query_cache] Cache lookup failed: %s", e)

        # Run full pipeline
        rr = self.retrieve(query_text, doc_id, reflect=reflect)
        answer = self.synthesize_and_verify(rr, query_text, verify=verify, reflect=reflect)

        # Phase 2: Store result in cache (optimized mode only)
        if self._is_feature_enabled("enable_query_cache"):
            try:
                cache = self._get_query_cache()
                emb_client = self._get_cache_embedding_client()
                if not hasattr(self, '_last_query_embedding'):
                    query_embedding = emb_client.embed(query_text)
                else:
                    query_embedding = self._last_query_embedding
                cache.store(
                    query_text=query_text,
                    query_embedding=query_embedding,
                    answer_dict=answer.to_dict(),
                    doc_id=doc_id,
                    retrieval_mode="optimized",
                )
            except Exception as e:
                logger.warning("[query_cache] Cache store failed: %s", e)

        return answer

    # ------------------------------------------------------------------
    # Contribution analysis logging
    # ------------------------------------------------------------------

    @staticmethod
    def _log_contribution_analysis(
        answer: Answer,
        sections: list,
        timings: dict[str, float],
        elapsed: float,
    ) -> None:
        """Log end-to-end contribution analysis."""
        logger.info("=" * 70)
        logger.info("[End-to-End Contribution Analysis]")

        reflection_sections = [
            s for s in sections
            if getattr(s, "source", "") == "reflection_gap_fill"
        ]
        direct_sections = [
            s for s in sections
            if getattr(s, "source", "") != "reflection_gap_fill"
        ]
        cited_node_ids = {c.node_id for c in answer.citations}

        direct_cited = sum(1 for s in direct_sections if s.node_id in cited_node_ids)
        reflection_cited = sum(1 for s in reflection_sections if s.node_id in cited_node_ids)

        logger.info(
            "  Sections: %d direct + %d from reflection = %d total",
            len(direct_sections),
            len(reflection_sections),
            len(sections),
        )
        logger.info(
            "  Citations: %d total | %d from direct retrieval, %d from reflection",
            len(answer.citations),
            direct_cited,
            reflection_cited,
        )

        if reflection_sections:
            reflection_time = timings.get("3_reflection", 0)
            if reflection_cited > 0:
                logger.info(
                    "  ** Reflection: CONTRIBUTED — %d/%d reflection sections were cited. "
                    "Cost: %.1fs (%.0f%% of total). **",
                    reflection_cited,
                    len(reflection_sections),
                    reflection_time,
                    (reflection_time / elapsed * 100) if elapsed > 0 else 0,
                )
            else:
                logger.info(
                    "  ** Reflection: NO CONTRIBUTION — 0/%d reflection sections were cited. "
                    "Cost: %.1fs (%.0f%% of total) WASTED. **",
                    len(reflection_sections),
                    reflection_time,
                    (reflection_time / elapsed * 100) if elapsed > 0 else 0,
                )
        else:
            reflection_time = timings.get("3_reflection", 0)
            if reflection_time > 1.0:
                logger.info(
                    "  ** Reflection: NO NEW SECTIONS added — "
                    "%.1fs (%.0f%% of total) spent on assessment LLM calls only. **",
                    reflection_time,
                    (reflection_time / elapsed * 100) if elapsed > 0 else 0,
                )

        verification_time = timings.get("5_verification", 0)
        logger.info(
            "  Verification: status=%s | %d issues found | Cost: %.1fs (%.0f%% of total)",
            answer.verification_status,
            len(answer.verification_notes.split("\n")) - 2
            if answer.verification_notes
            else 0,
            verification_time,
            (verification_time / elapsed * 100) if elapsed > 0 else 0,
        )

        productive_time = timings.get("2_retrieval", 0) + timings.get("4_synthesis", 0)
        overhead_time = timings.get("3_reflection", 0) + timings.get("5_verification", 0)
        logger.info(
            "  PRODUCTIVE time (retrieval + synthesis): %.1fs (%.0f%%)",
            productive_time,
            (productive_time / elapsed * 100) if elapsed > 0 else 0,
        )
        logger.info(
            "  OVERHEAD time (reflection + verification): %.1fs (%.0f%%)",
            overhead_time,
            (overhead_time / elapsed * 100) if elapsed > 0 else 0,
        )
        logger.info("=" * 70)

    def list_documents(self) -> list[str]:
        """List all available document IDs."""
        return self._tree_store.list_trees()

    @staticmethod
    def format_answer(answer: Answer) -> str:
        """
        Format an Answer into a human-readable string.

        Args:
            answer: The answer to format.

        Returns:
            Formatted answer text with citations and metadata.
        """
        parts = []

        # Main answer text
        parts.append(answer.text)

        # Citations
        if answer.citations:
            parts.append("\n--- Citations ---")
            for c in answer.citations:
                page_info = f" ({c.page_range})" if c.page_range else ""
                parts.append(f"  {c.citation_id} {c.title}{page_info}")
                if c.excerpt:
                    parts.append(f'    "{c.excerpt[:120]}"')

        # Inferred points
        if answer.inferred_points:
            parts.append("\n--- Inferred Points ---")
            for ip in answer.inferred_points:
                parts.append(f"  [{ip.confidence}] {ip.point}")
                parts.append(f"    Reasoning: {ip.reasoning[:120]}")
                parts.append(f"    Based on: {', '.join(ip.supporting_sections)}")

        # Verification
        parts.append(f"\n--- Verification: {answer.verification_status} ---")
        if answer.verification_notes:
            for line in answer.verification_notes.split("\n"):
                parts.append(f"  {line}")

        # Metrics
        parts.append(
            f"\n[{answer.total_time_seconds:.1f}s | "
            f"{answer.llm_calls} LLM calls | "
            f"{answer.total_tokens:,} tokens]"
        )

        return "\n".join(parts)
