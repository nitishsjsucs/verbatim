"""
Synthesizer for GOVINDA V2.

Generates comprehensive answers from retrieved sections using GPT-5.2-pro.
Produces citations linking every claim to source sections, and identifies
inferred points with reasoning chains.

Uses the Responses API with deeper reasoning for synthesis quality.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.query import (
    Answer,
    Citation,
    InferredPoint,
    Query,
    RetrievedSection,
)
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class Synthesizer:
    """
    Generate cited answers from retrieved document sections.

    Uses GPT-5.2-pro for deeper reasoning during synthesis.
    Every factual claim must be grounded in a source section.
    """

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()

    def synthesize(
        self,
        query: Query,
        sections: list[RetrievedSection],
    ) -> Answer:
        """
        Synthesize an answer from retrieved sections.

        Args:
            query: The classified query.
            sections: Retrieved document sections with text.

        Returns:
            An Answer object with text, citations, and inferred points.
        """
        if not sections:
            return Answer(
                text="No relevant sections were found to answer this query.",
                query_type=query.query_type,
            )

        prompt_data = load_prompt("answering", "synthesis")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        # Build the retrieved text block for the prompt
        retrieved_text = self._format_sections(sections)

        user_msg = format_prompt(
            user_template,
            query_text=query.text,
            query_type=query.query_type.value,
            retrieved_text=retrieved_text,
        )

        start = time.time()

        try:
            # Adaptive reasoning effort based on query complexity
            _effort_map = {
                "definitional": "medium",
                "single_hop": "medium",
                "multi_hop": "high",
                "global": "high",
            }
            effort = _effort_map.get(query.query_type.value, "medium")

            # Use chat_json_with_status to detect API-level truncation
            result, was_truncated = self._llm.chat_json_with_status(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model_pro,
                max_tokens=self._settings.llm.max_tokens_long,
                reasoning_effort=effort,
            )

            elapsed = time.time() - start

            # Parse the answer
            answer_text = result.get("answer_text", "")
            if not answer_text:
                # Fallback: maybe the LLM returned text under a different key
                answer_text = result.get("answer", result.get("text", str(result)))

            # --- Truncation handling (improved: API-level + heuristic + iterative) ---
            # Determine if we need continuation
            needs_continuation = was_truncated or self._is_truncated(answer_text)

            if needs_continuation:
                answer_text, continuation_results = self._handle_truncation_iterative(
                    answer_text, system_prompt, user_msg, max_rounds=3
                )
                # Merge citations/inferred_points from all continuation rounds
                for cont_result in continuation_results:
                    for key in ("citations", "inferred_points"):
                        extras = cont_result.get(key, [])
                        if extras:
                            existing = result.get(key, [])
                            existing.extend(extras)
                            result[key] = existing

            # Parse citations
            citations = []
            for c in result.get("citations", []):
                # Look up page_range from the sections we passed
                node_id = c.get("node_id", "")
                page_range = ""
                for s in sections:
                    if s.node_id == node_id:
                        page_range = s.page_range
                        break

                citations.append(
                    Citation(
                        citation_id=c.get("citation_id", f"[{node_id}]"),
                        node_id=node_id,
                        title=c.get("title", ""),
                        page_range=page_range,
                        excerpt=c.get("excerpt", ""),
                    )
                )

            # Parse inferred points
            inferred_points = []
            for ip in result.get("inferred_points", []):
                if not ip.get("point"):
                    continue
                confidence = str(ip.get("confidence", "medium"))
                if confidence not in ("high", "medium", "low"):
                    confidence = "medium"
                # supporting_definitions: verbatim text from sources
                raw_defs = ip.get("supporting_definitions", [])
                if isinstance(raw_defs, str):
                    raw_defs = [raw_defs]
                supporting_defs = [str(d) for d in raw_defs if d]
                # supporting_sections: node_ids
                raw_secs = ip.get("supporting_sections", [])
                if isinstance(raw_secs, str):
                    raw_secs = [raw_secs]
                supporting_secs = [str(s) for s in raw_secs if s]
                inferred_points.append(
                    InferredPoint(
                        point=str(ip["point"]),
                        supporting_definitions=supporting_defs,
                        supporting_sections=supporting_secs,
                        reasoning=str(ip.get("reasoning", "")),
                        confidence=confidence,
                    )
                )

            answer = Answer(
                text=answer_text,
                citations=citations,
                inferred_points=inferred_points,
                query_type=query.query_type,
                retrieved_sections=sections,
            )

            logger.info(
                "Synthesis complete: %d citations, %d inferred points, %.1fs",
                len(citations),
                len(inferred_points),
                elapsed,
            )

            return answer

        except Exception as e:
            logger.error("Synthesis failed: %s", str(e))
            return Answer(
                text=f"Error generating answer: {str(e)}",
                query_type=query.query_type,
                retrieved_sections=sections,
            )

    def _format_sections(self, sections: list[RetrievedSection]) -> str:
        """Format retrieved sections into a text block for the LLM prompt."""
        parts = []
        for s in sections:
            header = f"=== {s.title} ({s.page_range}) [id:{s.node_id}] ==="
            parts.append(f"{header}\n{s.text}")
        return "\n\n".join(parts)

    def _is_truncated(self, text: str) -> bool:
        """Check if text appears to end mid-sentence (truncated)."""
        stripped = text.rstrip()
        if not stripped:
            return False
        # Valid ending characters for a complete answer
        valid_endings = {".", ")", ":", '"', "]", "!", "?", "*", "-"}
        return stripped[-1] not in valid_endings

    def _handle_truncation_iterative(
        self,
        answer_text: str,
        system_prompt: str,
        user_msg: str,
        max_rounds: int = 3,
    ) -> tuple[str, list[dict]]:
        """
        Iteratively continue a truncated answer (up to max_rounds).

        Uses API-level truncation detection on each continuation call.

        Returns:
            Tuple of (extended answer_text, list of continuation result dicts).
        """
        continuation_results = []

        for round_num in range(1, max_rounds + 1):
            logger.warning(
                "Answer truncated, continuation round %d/%d...",
                round_num,
                max_rounds,
            )

            # Take last ~500 chars as context for the continuation
            tail_context = answer_text[-500:]

            continuation_prompt = (
                "The previous answer was cut off. Here is the tail end:\n\n"
                f"...{tail_context}\n\n"
                "Continue the answer from EXACTLY where it was cut off. "
                "Do NOT repeat any content already written. "
                "Maintain the same citation format [Section Title, p.XX]. "
                "Return JSON with keys: answer_continuation (string), "
                "citations (list, same format), inferred_points (list, same format)."
            )

            try:
                cont_result, cont_truncated = self._llm.chat_json_with_status(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg},
                        {"role": "assistant", "content": answer_text},
                        {"role": "user", "content": continuation_prompt},
                    ],
                    model=self._settings.llm.model_pro,
                    max_tokens=self._settings.llm.max_tokens_long,
                    reasoning_effort="medium",
                )

                continuation_text = cont_result.get(
                    "answer_continuation",
                    cont_result.get("answer_text", ""),
                )

                if continuation_text:
                    answer_text = (
                        answer_text.rstrip() + " " + continuation_text.lstrip()
                    )
                    logger.info(
                        "Continuation round %d added %d chars",
                        round_num,
                        len(continuation_text),
                    )

                continuation_results.append(cont_result)

                # If this round wasn't truncated and text looks complete, stop
                if not cont_truncated and not self._is_truncated(answer_text):
                    logger.info("Continuation complete after %d rounds", round_num)
                    break

            except Exception as e:
                logger.error("Continuation round %d failed: %s", round_num, str(e))
                break

        return answer_text, continuation_results
