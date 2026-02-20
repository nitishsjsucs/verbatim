"""
Structural Router for GOVINDA V2 — RDR2 Pattern.

Orchestrates the full retrieval pipeline:
1. Classify query type
2. Expand query (multi-query generation for broad queries)
3. Locate relevant nodes (LLM tree reasoning)
4. Read text from located nodes
5. Inject missing definition nodes
6. Follow cross-references
7. Log all routing decisions for auditability

This is the single entry point for all retrieval.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from config.settings import get_settings
from models.document import DocumentTree
from models.query import (
    Answer,
    LocatedNode,
    Query,
    RetrievedSection,
    RoutingLog,
)
from retrieval.cross_ref_follower import CrossRefFollower
from retrieval.definition_injector import DefinitionInjector
from retrieval.locator import Locator
from retrieval.query_classifier import QueryClassifier
from retrieval.query_expander import QueryExpander
from retrieval.reader import Reader
from utils.llm_client import LLMClient
from utils.text_utils import estimate_tokens

logger = logging.getLogger(__name__)


class StructuralRouter:
    """
    Orchestrate the Locate → Read → Follow retrieval pipeline.

    All routing decisions are logged for auditability (RDR2 pattern).
    """

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()
        self._classifier = QueryClassifier(self._llm)
        self._expander = QueryExpander(self._llm)
        self._locator = Locator(self._llm)
        self._reader = Reader()
        self._follower = CrossRefFollower()
        self._def_injector = DefinitionInjector()

    def retrieve(
        self, query_text: str, tree: DocumentTree
    ) -> tuple[Query, list[RetrievedSection], RoutingLog]:
        """
        Full retrieval pipeline: classify → expand → locate → read → inject defs → follow.

        Args:
            query_text: The user's query string.
            tree: The document tree to search.

        Returns:
            Tuple of (classified query, retrieved sections, routing log).
        """
        start = time.time()
        routing_log = RoutingLog(query_text=query_text, query_type=None)

        # Step 1: Classify query
        logger.info("[Retrieval 1/6] Classifying query...")
        t0 = time.time()
        query = self._classifier.classify(query_text)
        classify_time = time.time() - t0
        routing_log.query_type = query.query_type
        logger.info(
            "  -> Type: %s, Terms: %s (%.1fs)",
            query.query_type.value,
            query.key_terms,
            classify_time,
        )

        # Step 2: Expand query (multi-query generation for broad queries)
        logger.info("[Retrieval 2/6] Expanding query...")
        t0 = time.time()
        expanded_queries = self._expander.expand(query)
        expand_time = time.time() - t0
        if expanded_queries:
            logger.info("  -> %d expanded queries generated (%.1fs)", len(expanded_queries), expand_time)
        else:
            logger.info("  -> No expansion (query type: %s) (%.1fs)", query.query_type.value, expand_time)

        # Step 3: Locate relevant nodes (original + expanded queries)
        logger.info("[Retrieval 3/6] Locating relevant nodes...")
        t0 = time.time()
        located = self._locator.locate(query, tree)

        # Run locate for each expanded query and merge results
        if expanded_queries:
            for eq_text in expanded_queries:
                eq = Query(
                    text=eq_text,
                    query_type=query.query_type,
                    key_terms=query.key_terms,
                )
                extra_located = self._locator.locate(eq, tree)
                located = self._merge_located_nodes(located, extra_located)
                logger.info(
                    "  -> After expansion '%s': %d total located nodes",
                    eq_text[:50],
                    len(located),
                )
        locate_time = time.time() - t0

        routing_log.locate_results = [
            {
                "node_id": n.node_id,
                "title": n.title,
                "confidence": n.confidence,
                "reason": n.relevance_reason,
            }
            for n in located
        ]
        routing_log.total_nodes_located = len(located)
        logger.info("  -> Located %d nodes (after merge) (%.1fs)", len(located), locate_time)

        # Step 4: Read text from located nodes
        logger.info("[Retrieval 4/6] Reading located sections...")
        t0 = time.time()
        sections = self._reader.read(located, tree, query_type=query.query_type.value)
        read_time = time.time() - t0
        routing_log.read_results = [
            {
                "node_id": s.node_id,
                "title": s.title,
                "source": s.source,
                "tokens": s.token_count,
            }
            for s in sections
        ]
        logger.info(
            "  -> Read %d sections (%d tokens) (%.1fs)",
            len(sections),
            sum(s.token_count for s in sections),
            read_time,
        )

        # Step 5: Inject missing definition nodes
        logger.info("[Retrieval 5/6] Injecting missing definitions...")
        t0 = time.time()
        sections = self._def_injector.inject(query, sections, tree, self._reader)
        inject_time = time.time() - t0
        logger.info(
            "  -> %d sections after definition injection (%.1fs)",
            len(sections),
            inject_time,
        )

        # Step 6: Follow cross-references
        logger.info("[Retrieval 6/6] Following cross-references...")
        t0 = time.time()
        already_read = {s.node_id for s in sections}
        cross_ref_sections = self._follower.follow(located, tree, already_read)

        if cross_ref_sections:
            # Add cross-ref sections within token budget
            total_tokens = sum(s.token_count for s in sections)
            budget = self._settings.retrieval.retrieval_token_budget

            for crs in cross_ref_sections:
                if total_tokens + crs.token_count <= budget:
                    sections.append(crs)
                    total_tokens += crs.token_count

            routing_log.cross_ref_follows = [
                {
                    "node_id": s.node_id,
                    "title": s.title,
                    "tokens": s.token_count,
                }
                for s in cross_ref_sections
            ]
        crossref_time = time.time() - t0

        routing_log.total_sections_read = len(sections)
        routing_log.total_tokens_retrieved = sum(s.token_count for s in sections)

        # Store sub-step timings in routing_log
        routing_log.stage_timings = {
            "classify": classify_time,
            "expand": expand_time,
            "locate": locate_time,
            "read": read_time,
            "inject_definitions": inject_time,
            "cross_references": crossref_time,
        }

        elapsed = time.time() - start
        logger.info(
            "Retrieval complete: %d sections, %d tokens, %.1fs",
            len(sections),
            routing_log.total_tokens_retrieved,
            elapsed,
        )
        logger.info(
            "  -> Retrieval breakdown: %s",
            " | ".join(f"{k}: {v:.1f}s" for k, v in routing_log.stage_timings.items()),
        )

        return query, sections, routing_log

    @staticmethod
    def _merge_located_nodes(
        existing: list[LocatedNode], new: list[LocatedNode]
    ) -> list[LocatedNode]:
        """
        Merge two lists of located nodes, deduplicating by node_id.

        When the same node appears in both lists, keep the one with
        higher confidence. Result is sorted by confidence descending.
        """
        by_id: dict[str, LocatedNode] = {}
        for node in existing:
            by_id[node.node_id] = node
        for node in new:
            if (
                node.node_id not in by_id
                or node.confidence > by_id[node.node_id].confidence
            ):
                by_id[node.node_id] = node
        merged = sorted(by_id.values(), key=lambda n: n.confidence, reverse=True)
        return merged

    def retrieve_for_subquery(
        self, query_text: str, tree: DocumentTree
    ) -> tuple[Query, list[RetrievedSection], RoutingLog]:
        """
        Retrieval pipeline WITHOUT classification (for planner sub-queries).

        Skips the classifier LLM call — treats the sub-query as single_hop.
        Saves 1 LLM call per sub-query.

        Args:
            query_text: The sub-query string.
            tree: The document tree to search.

        Returns:
            Tuple of (query, retrieved sections, routing log).
        """
        from models.query import QueryType

        start = time.time()
        routing_log = RoutingLog(query_text=query_text, query_type=None)

        # Skip classification — use single_hop default
        query = Query(text=query_text, query_type=QueryType.SINGLE_HOP)
        routing_log.query_type = query.query_type
        logger.info(
            "[Sub-Retrieval] Skipping classification, using single_hop for: %s",
            query_text[:80],
        )

        # Step 2: Locate relevant nodes
        located = self._locator.locate(query, tree)
        routing_log.locate_results = [
            {
                "node_id": n.node_id,
                "title": n.title,
                "confidence": n.confidence,
                "reason": n.relevance_reason,
            }
            for n in located
        ]
        routing_log.total_nodes_located = len(located)

        # Step 3: Read text
        sections = self._reader.read(located, tree, query_type=query.query_type.value)
        routing_log.read_results = [
            {
                "node_id": s.node_id,
                "title": s.title,
                "source": s.source,
                "tokens": s.token_count,
            }
            for s in sections
        ]

        # Step 4: Follow cross-references
        already_read = {s.node_id for s in sections}
        cross_ref_sections = self._follower.follow(located, tree, already_read)

        if cross_ref_sections:
            total_tokens = sum(s.token_count for s in sections)
            budget = self._settings.retrieval.retrieval_token_budget

            for crs in cross_ref_sections:
                if total_tokens + crs.token_count <= budget:
                    sections.append(crs)
                    total_tokens += crs.token_count

            routing_log.cross_ref_follows = [
                {
                    "node_id": s.node_id,
                    "title": s.title,
                    "tokens": s.token_count,
                }
                for s in cross_ref_sections
            ]

        routing_log.total_sections_read = len(sections)
        routing_log.total_tokens_retrieved = sum(s.token_count for s in sections)

        elapsed = time.time() - start
        logger.info(
            "Sub-retrieval complete: %d sections, %d tokens, %.1fs",
            len(sections),
            routing_log.total_tokens_retrieved,
            elapsed,
        )

        return query, sections, routing_log
