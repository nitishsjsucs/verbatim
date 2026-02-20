"""
Verifier for GOVINDA V2.

Fact-checks a generated answer against the source sections.
Ensures every claim is grounded, citations are accurate, and
important information isn't missed.

Uses GPT-5.2-pro with reasoning for thorough verification.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.query import Answer, InferredPoint, RetrievedSection
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class Verifier:
    """
    Verify answer faithfulness against source sections.

    Checks factual accuracy, citation correctness, and completeness.
    Returns a verification status and detailed issues if any.
    """

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()

    def verify(self, answer: Answer, query_text: str = "") -> Answer:
        """
        Verify a synthesized answer against its source sections.

        Mutates the answer in place, updating verification fields.

        Args:
            answer: The answer to verify (must have retrieved_sections).
            query_text: The original query text (for responsiveness check).

        Returns:
            The same Answer object with verification fields filled.
        """
        if not answer.retrieved_sections:
            answer.verified = False
            answer.verification_status = "unverified"
            answer.verification_notes = "No source sections available for verification."
            return answer

        prompt_data = load_prompt("answering", "verification")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        # Build source text block
        source_text = self._format_sections(answer.retrieved_sections)

        # Build inferred points text block for verification
        inferred_text = self._format_inferred_points(answer.inferred_points)

        user_msg = format_prompt(
            user_template,
            query_text=query_text,
            answer_text=answer.text,
            inferred_text=inferred_text,
            source_text=source_text,
        )

        start = time.time()

        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model_pro,
                max_tokens=self._settings.llm.max_tokens_default,
                reasoning_effort="medium",
            )

            elapsed = time.time() - start

            # Parse verification result
            status = result.get("verification_status", "unverified")
            accuracy_score = float(result.get("factual_accuracy_score", 0.0))
            completeness_score = float(result.get("completeness_score", 0.0))
            inference_score = float(result.get("inference_quality_score", 0.0))
            issues = result.get("issues", [])
            notes = result.get("notes", "")

            # Determine verified status
            # "verified" if accuracy >= 0.8 and no critical issues
            critical_issues = [
                i
                for i in issues
                if i.get("type")
                in ("unsupported_claim", "fabricated_claim", "invalid_inference")
            ]

            if status == "verified" or (accuracy_score >= 0.8 and not critical_issues):
                answer.verified = True
                answer.verification_status = "verified"
            elif accuracy_score >= 0.6:
                answer.verified = False
                answer.verification_status = "partially_verified"
            else:
                answer.verified = False
                answer.verification_status = "unverified"

            # Build notes
            notes_parts = []
            if notes:
                notes_parts.append(notes)
            notes_parts.append(
                f"Accuracy: {accuracy_score:.0%}, Completeness: {completeness_score:.0%}, Inference: {inference_score:.0%}"
            )
            if issues:
                notes_parts.append(f"Issues found: {len(issues)}")
                for i, issue in enumerate(issues, 1):
                    issue_type = issue.get("type", "unknown")
                    claim = issue.get("claim", "")[:80]
                    explanation = issue.get("explanation", "")[:100]
                    notes_parts.append(f"  {i}. [{issue_type}] {claim}: {explanation}")

            answer.verification_notes = "\n".join(notes_parts)

            logger.info(
                "Verification: %s (accuracy=%.0f%%, completeness=%.0f%%, inference=%.0f%%, issues=%d, %.1fs)",
                answer.verification_status,
                accuracy_score * 100,
                completeness_score * 100,
                inference_score * 100,
                len(issues),
                elapsed,
            )

            # ── Contribution Analysis ──
            logger.info("=" * 70)
            logger.info("[Verification Contribution Summary]")
            logger.info("  Time spent: %.1fs", elapsed)
            logger.info(
                "  Scores: accuracy=%.0f%%, completeness=%.0f%%, inference=%.0f%%",
                accuracy_score * 100,
                completeness_score * 100,
                inference_score * 100,
            )
            logger.info("  Final status: %s", answer.verification_status)
            logger.info("  Issues found: %d total", len(issues))

            # Categorize issues by type and severity
            issue_types: dict[str, int] = {}
            actionable_issues: list[str] = []
            for issue in issues:
                itype = issue.get("type", "unknown")
                issue_types[itype] = issue_types.get(itype, 0) + 1
                claim = issue.get("claim", "")[:60]
                explanation = issue.get("explanation", "")[:80]
                actionable_issues.append(f"    [{itype}] {claim}: {explanation}")

            if issue_types:
                logger.info("  Issue breakdown: %s", dict(issue_types))
                for ai in actionable_issues:
                    logger.info(ai)

            # Assess whether verification actually changed the outcome
            if answer.verification_status == "verified" and not critical_issues:
                logger.info(
                    "  ** VERDICT: Answer was already good — verification CONFIRMED "
                    "quality but did not change the answer. %.1fs spent for confidence. **",
                    elapsed,
                )
            elif answer.verification_status == "partially_verified":
                logger.info(
                    "  ** VERDICT: Verification found %d issues (%d critical). "
                    "Answer downgraded to partially_verified. "
                    "%.1fs spent — issues provide actionable feedback. **",
                    len(issues),
                    len(critical_issues),
                    elapsed,
                )
            else:
                logger.info(
                    "  ** VERDICT: Verification flagged significant problems — "
                    "%d critical issues. Status: %s. %.1fs spent — this was valuable. **",
                    len(critical_issues),
                    answer.verification_status,
                    elapsed,
                )

            # Check if any reflection-added sections were actually cited
            reflection_sections = [
                s for s in answer.retrieved_sections
                if getattr(s, "source", "") == "reflection_gap_fill"
            ]
            if reflection_sections:
                cited_node_ids = {c.node_id for c in answer.citations}
                reflection_node_ids = {s.node_id for s in reflection_sections}
                cited_reflection = reflection_node_ids & cited_node_ids
                uncited_reflection = reflection_node_ids - cited_node_ids
                logger.info(
                    "  [Reflection->Citation Analysis] "
                    "Reflection added %d sections: %d cited in answer, %d uncited",
                    len(reflection_sections),
                    len(cited_reflection),
                    len(uncited_reflection),
                )
                if cited_reflection:
                    logger.info("    Cited reflection sections: %s", sorted(cited_reflection))
                if uncited_reflection:
                    logger.info(
                        "    Uncited reflection sections (wasted retrieval): %s",
                        sorted(uncited_reflection),
                    )

            logger.info("=" * 70)

            return answer

        except Exception as e:
            logger.error("Verification failed: %s", str(e))
            answer.verified = False
            answer.verification_status = "unverified"
            answer.verification_notes = f"Verification error: {str(e)}"
            return answer

    def _format_sections(self, sections: list[RetrievedSection]) -> str:
        """Format source sections for verification prompt."""
        parts = []
        for s in sections:
            header = f"=== [{s.node_id}] {s.title} ({s.page_range}) ==="
            parts.append(f"{header}\n{s.text}")
        return "\n\n".join(parts)

    def _format_inferred_points(self, inferred_points: list[InferredPoint]) -> str:
        """Format inferred points for the verification prompt.

        Each point is clearly labeled [INFERRED] with its full reasoning chain
        so the verifier can independently evaluate validity.
        """
        if not inferred_points:
            return "(No inferred points in this answer)"

        lines = []
        for i, ip in enumerate(inferred_points, 1):
            lines.append(f"{i}. [INFERRED, confidence={ip.confidence}] {ip.point}")
            if ip.reasoning:
                lines.append(f"   Reasoning: {ip.reasoning}")
            if ip.supporting_definitions:
                defs_text = "; ".join(ip.supporting_definitions)
                lines.append(f"   Supporting definitions: {defs_text}")
            if ip.supporting_sections:
                lines.append(f"   Source sections: {', '.join(ip.supporting_sections)}")
            lines.append("")  # blank line between points

        return "\n".join(lines)
