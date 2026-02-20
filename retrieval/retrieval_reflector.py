"""
Retrieval Reflector for GOVINDA V2.

After initial retrieval, checks whether the evidence is sufficient
to answer the query. If gaps are identified, generates targeted
sub-queries and runs additional retrieval rounds.

Inspired by SimpleMem's retrieval reflection loop and DeepRead's
multi-turn iterative retrieval.

Max 2 reflection rounds to cap token usage.
"""

from __future__ import annotations

import logging
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from models.document import DocumentTree
from models.query import Query, QueryType, RetrievedSection
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)

# Max reflection rounds (each round = 1 LLM reflection + 1-2 retrieval calls)
_MAX_REFLECTION_ROUNDS = 2

# Max gap-filling queries per round
_MAX_GAP_QUERIES = 2


class RetrievalReflector:
    """
    Reflect on retrieval sufficiency and fill gaps.

    After the initial retrieval pass, this component:
    1. Presents section summaries to the LLM
    2. LLM assesses whether evidence is sufficient
    3. If gaps found, generates targeted sub-queries
    4. Runs sub-query retrieval and merges results
    5. Repeats for up to _MAX_REFLECTION_ROUNDS
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    def reflect_and_fill(
        self,
        query: Query,
        sections: list[RetrievedSection],
        tree: DocumentTree,
        router: object,  # StructuralRouter — avoided circular import via duck typing
    ) -> list[RetrievedSection]:
        """
        Check evidence sufficiency and fill gaps if needed.

        Skips reflection for definitional queries (they're precise enough).

        Args:
            query: The classified user query.
            sections: Already-retrieved sections.
            tree: The document tree.
            router: The StructuralRouter (for gap-filling retrieval).
                    Must have a `retrieve_for_subquery(text, tree)` method.

        Returns:
            Augmented sections list (original + gap-filled).
        """
        import time

        # Track contribution metrics
        initial_section_count = len(sections)
        initial_node_ids = {s.node_id for s in sections}
        initial_token_count = sum(s.token_count for s in sections)
        round_details: list[dict] = []

        # Skip reflection for definitional queries — they're focused enough
        if query.query_type == QueryType.DEFINITIONAL:
            logger.info("Skipping reflection for definitional query")
            logger.info(
                "[Reflection Contribution] SKIPPED — definitional query. "
                "Sections: %d, Tokens: %d",
                initial_section_count,
                initial_token_count,
            )
            return sections

        # Skip if we have very few sections (nothing to reflect on)
        if len(sections) < 2:
            logger.info("Skipping reflection — too few sections (%d)", len(sections))
            logger.info(
                "[Reflection Contribution] SKIPPED — too few sections (%d). "
                "Tokens: %d",
                len(sections),
                initial_token_count,
            )
            return sections

        for round_num in range(1, _MAX_REFLECTION_ROUNDS + 1):
            round_start = time.time()
            logger.info(
                "[Reflection %d/%d] Assessing evidence sufficiency...",
                round_num,
                _MAX_REFLECTION_ROUNDS,
            )

            # Build section summaries for the LLM (titles + page ranges only — cheap)
            section_summaries = self._build_summaries(sections)
            total_tokens = sum(s.token_count for s in sections)

            # Ask LLM to assess sufficiency
            assess_start = time.time()
            assessment = self._assess(
                query, section_summaries, len(sections), total_tokens
            )
            assess_time = time.time() - assess_start

            if assessment is None:
                logger.warning("Reflection assessment failed — stopping (%.1fs wasted on LLM call)", assess_time)
                round_details.append({
                    "round": round_num,
                    "assess_time": assess_time,
                    "fill_time": 0.0,
                    "outcome": "assessment_failed",
                    "new_sections": 0,
                    "new_node_ids": [],
                })
                break

            is_sufficient = assessment.get("sufficient", True)
            confidence = assessment.get("confidence", 1.0)
            gap_queries = assessment.get("gap_queries", [])
            missing = assessment.get("missing_aspects", [])

            logger.info(
                "  -> Sufficient: %s (confidence: %.2f), %d gaps, missing: %s (assess: %.1fs)",
                is_sufficient,
                confidence,
                len(gap_queries),
                missing[:3],
                assess_time,
            )

            # If sufficient or no gap queries, we're done
            # Also stop if confidence is high enough (>= 0.80) — the reflector
            # tends to be conservative since it only sees summaries, not full text
            if is_sufficient or not gap_queries or confidence >= 0.80:
                logger.info("  -> Evidence sufficient — no further retrieval needed")
                round_details.append({
                    "round": round_num,
                    "assess_time": assess_time,
                    "fill_time": 0.0,
                    "outcome": f"sufficient (confidence={confidence:.2f})",
                    "new_sections": 0,
                    "new_node_ids": [],
                })
                break

            # Fill gaps with targeted sub-queries
            fill_start = time.time()
            gap_queries = gap_queries[:_MAX_GAP_QUERIES]
            already_read = {s.node_id for s in sections}
            new_sections_added = 0
            new_node_ids_this_round: list[str] = []

            for gq in gap_queries:
                if not isinstance(gq, str) or not gq.strip():
                    continue

                logger.info("  -> Gap query: '%s'", gq[:80])

                try:
                    gq_start = time.time()
                    _, gap_sections, _ = router.retrieve_for_subquery(gq.strip(), tree)
                    gq_time = time.time() - gq_start

                    gq_new = 0
                    for gs in gap_sections:
                        if gs.node_id not in already_read:
                            sections.append(gs)
                            already_read.add(gs.node_id)
                            new_sections_added += 1
                            new_node_ids_this_round.append(gs.node_id)
                            gq_new += 1

                    logger.info(
                        "    -> Gap query returned %d sections, %d new (%.1fs)",
                        len(gap_sections),
                        gq_new,
                        gq_time,
                    )
                except Exception as e:
                    logger.warning("Gap retrieval failed for '%s': %s", gq[:40], str(e))

            fill_time = time.time() - fill_start
            round_time = time.time() - round_start

            round_details.append({
                "round": round_num,
                "assess_time": assess_time,
                "fill_time": fill_time,
                "total_time": round_time,
                "outcome": f"gap_filled ({len(gap_queries)} queries)",
                "new_sections": new_sections_added,
                "new_node_ids": new_node_ids_this_round,
                "missing_aspects": missing,
                "gap_queries_used": gap_queries,
            })

            logger.info(
                "  -> Round %d: added %d new sections (total: %d) — assess: %.1fs, fill: %.1fs, round: %.1fs",
                round_num,
                new_sections_added,
                len(sections),
                assess_time,
                fill_time,
                round_time,
            )

            # If no new sections were added, further rounds won't help
            if new_sections_added == 0:
                logger.info("  -> No new sections found — stopping reflection")
                break

        # ── Contribution Summary ──
        final_section_count = len(sections)
        final_token_count = sum(s.token_count for s in sections)
        added_node_ids = {s.node_id for s in sections} - initial_node_ids
        added_sections = [s for s in sections if s.node_id in added_node_ids]
        added_tokens = sum(s.token_count for s in added_sections)

        total_assess_time = sum(r["assess_time"] for r in round_details)
        total_fill_time = sum(r.get("fill_time", 0) for r in round_details)
        total_rounds = len(round_details)

        logger.info("=" * 70)
        logger.info("[Reflection Contribution Summary]")
        logger.info(
            "  Rounds: %d | Assess LLM time: %.1fs | Gap-fill time: %.1fs",
            total_rounds,
            total_assess_time,
            total_fill_time,
        )
        logger.info(
            "  Sections: %d -> %d (+%d new)",
            initial_section_count,
            final_section_count,
            len(added_node_ids),
        )
        logger.info(
            "  Tokens: %d -> %d (+%d new, %.1f%% increase)",
            initial_token_count,
            final_token_count,
            added_tokens,
            (added_tokens / initial_token_count * 100) if initial_token_count > 0 else 0,
        )
        if added_node_ids:
            logger.info("  New node IDs from reflection: %s", sorted(added_node_ids))
            for s in added_sections:
                logger.info("    -> %s: %s (%s, %d tokens)", s.node_id, s.title, s.page_range, s.token_count)
        else:
            logger.info("  ** Reflection added ZERO new sections — all time was overhead **")

        for rd in round_details:
            logger.info(
                "  Round %d: %s | assess=%.1fs, fill=%.1fs | +%d sections %s",
                rd["round"],
                rd["outcome"],
                rd["assess_time"],
                rd.get("fill_time", 0),
                rd["new_sections"],
                rd.get("new_node_ids", []),
            )
        logger.info("=" * 70)

        # Store contribution metadata on the sections for later analysis
        # Tag each reflection-added section so we can check if it was cited
        for s in sections:
            if s.node_id in added_node_ids:
                s.source = f"reflection_gap_fill"

        return sections

    def _assess(
        self,
        query: Query,
        section_summaries: str,
        section_count: int,
        total_tokens: int,
    ) -> dict | None:
        """
        Ask the LLM to assess whether evidence is sufficient.

        Returns parsed JSON assessment or None on failure.
        """
        prompt_data = load_prompt("retrieval", "retrieval_reflection")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        user_msg = format_prompt(
            user_template,
            query_text=query.text,
            query_type=query.query_type.value,
            key_terms=", ".join(query.key_terms) if query.key_terms else "none",
            section_count=str(section_count),
            total_tokens=str(total_tokens),
            section_summaries=section_summaries,
        )

        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=1024,
                reasoning_effort="low",
            )
            return result if isinstance(result, dict) else None
        except Exception as e:
            logger.warning("Reflection assessment failed: %s", str(e))
            return None

    @staticmethod
    def _build_summaries(sections: list[RetrievedSection]) -> str:
        """
        Build concise section summaries for the reflection LLM.

        Includes titles, page ranges, and a brief text snippet so the
        reflector can assess whether specific information is present.
        """
        lines = []
        for i, s in enumerate(sections, 1):
            source_tag = f" [{s.source}]" if s.source != "direct" else ""
            # Include first 150 chars of text for context
            snippet = s.text[:150].replace("\n", " ").strip()
            if len(s.text) > 150:
                snippet += "..."
            lines.append(
                f"{i}. {s.title} ({s.page_range}, ~{s.token_count} tokens){source_tag}"
                f"\n   Preview: {snippet}"
            )
        return "\n".join(lines)
