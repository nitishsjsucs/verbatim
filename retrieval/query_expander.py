"""
Query Expander for GOVINDA V2.

Generates alternative query formulations to improve retrieval recall.
Regulatory documents use specific legal jargon — users often phrase
questions differently. Multiple query formulations increase the chance
of locating all relevant nodes.

Inspired by R2R RAG Fusion (multi-query generation).
"""

from __future__ import annotations

import logging
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from models.query import Query
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class QueryExpander:
    """Generate alternative query formulations for broader retrieval."""

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    def expand(self, query: Query) -> list[str]:
        """
        Generate alternative query formulations.

        Only expands multi_hop and global queries — single_hop and
        definitional queries are precise enough on their own.

        Args:
            query: The classified user query.

        Returns:
            List of alternative query strings (does NOT include the original).
            Returns empty list if expansion is skipped or fails.
        """
        # Only expand for broad queries that benefit from multiple angles
        if query.query_type.value in ("single_hop", "definitional"):
            logger.info("Skipping query expansion for %s query", query.query_type.value)
            return []

        prompt_data = load_prompt("retrieval", "query_expansion")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        user_msg = format_prompt(
            user_template,
            query_text=query.text,
            query_type=query.query_type.value,
            key_terms=", ".join(query.key_terms) if query.key_terms else "none",
        )

        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=1024,
                reasoning_effort="none",
                temperature=0.3,  # Slight creativity for diverse formulations
            )

            expanded = result.get("expanded_queries", [])
            if not isinstance(expanded, list):
                expanded = []

            # Cap at 3 and filter empty strings
            expanded = [
                q.strip() for q in expanded[:3] if isinstance(q, str) and q.strip()
            ]

            logger.info(
                "Query expanded: %d alternatives generated for '%s'",
                len(expanded),
                query.text[:60],
            )
            for i, eq in enumerate(expanded, 1):
                logger.debug("  Expansion %d: %s", i, eq[:80])

            return expanded

        except Exception as e:
            logger.warning("Query expansion failed (non-fatal): %s", str(e))
            return []
