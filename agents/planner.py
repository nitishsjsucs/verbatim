"""
Planner for GOVINDA V2.

Handles multi-hop query decomposition: breaks a complex query into
sub-queries that can each be answered by a single retrieval pass,
then merges the sub-answers into a coherent final answer.

Only activated for multi_hop and global query types.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from config.prompt_loader import format_prompt
from config.settings import get_settings
from models.document import DocumentTree
from models.query import (
    Answer,
    Citation,
    InferredPoint,
    Query,
    QueryType,
    RetrievedSection,
)
from retrieval.router import StructuralRouter
from agents.synthesizer import Synthesizer
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class Planner:
    """
    Multi-hop query planner.

    For complex queries that span multiple sections, the planner:
    1. Uses the sub-queries from the classifier (or decomposes manually)
    2. Runs retrieval for each sub-query
    3. Merges all retrieved sections
    4. Synthesizes a unified answer from the combined context
    """

    def __init__(
        self,
        llm: Optional[LLMClient] = None,
        router: Optional[StructuralRouter] = None,
        synthesizer: Optional[Synthesizer] = None,
    ) -> None:
        self._llm = llm or LLMClient()
        self._router = router or StructuralRouter(self._llm)
        self._synthesizer = synthesizer or Synthesizer(self._llm)
        self._settings = get_settings()

    def plan_and_answer(
        self,
        query: Query,
        tree: DocumentTree,
        extra_sections: list[RetrievedSection] | None = None,
    ) -> Answer:
        """
        Decompose, retrieve for each sub-query, merge, and synthesize.

        Args:
            query: The classified query (should be multi_hop or global).
            tree: The document tree.
            extra_sections: Optional extra sections (e.g. from reflection)
                to merge into the planner's collected sections.

        Returns:
            A unified Answer combining all sub-query results.
        """
        start = time.time()

        # Get sub-queries from the classifier (already populated)
        sub_queries = query.sub_queries if query.sub_queries else [query.text]

        if len(sub_queries) <= 1:
            # Not truly multi-hop — fall through to normal retrieval
            logger.info("Planner: single sub-query, using direct retrieval")
            _, sections, _ = self._router.retrieve(query.text, tree)
            if extra_sections:
                seen = {s.node_id for s in sections}
                for es in extra_sections:
                    if es.node_id not in seen:
                        sections.append(es)
                        seen.add(es.node_id)
            answer = self._synthesizer.synthesize(query, sections)
            answer.total_time_seconds = time.time() - start
            return answer

        logger.info("Planner: decomposed into %d sub-queries", len(sub_queries))

        # Retrieve for each sub-query IN PARALLEL and collect all sections
        all_sections: list[RetrievedSection] = []
        seen_ids: set[str] = set()

        def _retrieve_sub_query(
            index: int, sq_text: str
        ) -> tuple[int, list[RetrievedSection]]:
            """Run retrieval for a single sub-query (thread target)."""
            logger.info(
                "  Sub-query %d/%d: %s",
                index + 1,
                len(sub_queries),
                sq_text[:80],
            )
            _, sections, _ = self._router.retrieve_for_subquery(sq_text, tree)
            return index, sections

        # Run all sub-queries in parallel
        with ThreadPoolExecutor(max_workers=len(sub_queries)) as executor:
            futures = {
                executor.submit(_retrieve_sub_query, i, sq): i
                for i, sq in enumerate(sub_queries)
            }

            # Collect results, ordered by original index for determinism
            results_by_index: dict[int, list[RetrievedSection]] = {}
            for future in as_completed(futures):
                idx, sections = future.result()
                results_by_index[idx] = sections

        # Merge in original order, dedup by node_id (keep first occurrence)
        for i in range(len(sub_queries)):
            for s in results_by_index.get(i, []):
                if s.node_id not in seen_ids:
                    all_sections.append(s)
                    seen_ids.add(s.node_id)

        # Merge extra sections (e.g. from reflection) — append after
        # sub-query sections so they supplement but don't replace
        if extra_sections:
            extra_added = 0
            for es in extra_sections:
                if es.node_id not in seen_ids:
                    all_sections.append(es)
                    seen_ids.add(es.node_id)
                    extra_added += 1
            if extra_added:
                logger.info(
                    "Planner: merged %d extra sections (from reflection)",
                    extra_added,
                )

        logger.info(
            "Planner: collected %d unique sections from %d sub-queries",
            len(all_sections),
            len(sub_queries),
        )

        # Trim to token budget
        budget = self._settings.retrieval.retrieval_token_budget
        trimmed: list[RetrievedSection] = []
        total_tokens = 0
        for s in all_sections:
            if total_tokens + s.token_count > budget:
                break
            trimmed.append(s)
            total_tokens += s.token_count

        if len(trimmed) < len(all_sections):
            logger.info(
                "Planner: trimmed %d -> %d sections to fit budget (%d tokens)",
                len(all_sections),
                len(trimmed),
                budget,
            )

        # Synthesize a unified answer from all collected sections
        answer = self._synthesizer.synthesize(query, trimmed)
        answer.total_time_seconds = time.time() - start

        return answer
