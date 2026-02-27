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
        """Optimized retrieval path — with benchmarking, caching, and pre-filter."""
        start = time.time()
        self._llm.reset_usage()
        timings: dict[str, float] = {}
        tracker = self._tracker

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

        timings["1_load_tree"] = tracker._stages[-1].duration_seconds
        logger.info("  -> %d nodes, %d pages (%.1fs)", tree.node_count, tree.total_pages, timings["1_load_tree"])

        # Step 2: Classify + Retrieve (with benchmark wrapping)
        with tracker.stage("retrieval") as s:
            query, sections, routing_log = self._router.retrieve(query_text, tree)
            s.set_metadata("query_type", query.query_type.value)
            s.set_metadata("sections_count", len(sections))
            s.set_metadata("tokens_retrieved", sum(sec.token_count for sec in sections))
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

        return RetrievalResult(
            query=query,
            sections=sections,
            routing_log=routing_log,
            tree=tree,
            timings=timings,
            llm_usage_snapshot=self._llm.get_usage_summary(),
            start_time=start,
        )

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

        return answer

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
