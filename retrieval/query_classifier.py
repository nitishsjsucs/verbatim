"""
Query Classifier for GOVINDA V2.

Classifies queries into types (BookRAG pattern) to determine
the optimal retrieval strategy:
- single_hop: answer in one section
- multi_hop: answer spans multiple sections
- global: requires document-wide aggregation
- definitional: asks about a specific term/definition
"""

from __future__ import annotations

import logging
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_active_retrieval_mode, get_settings
from models.query import Query, QueryType
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class QueryClassifier:
    """Classify queries to determine retrieval strategy."""

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    def classify(self, query_text: str) -> Query:
        """
        Classify a query and extract key terms.

        Args:
            query_text: The user's query string.

        Returns:
            A Query object with type, key terms, and sub-queries.
        """
        prompt_data = load_prompt("retrieval", "query_classification")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        user_msg = format_prompt(user_template, query_text=query_text)

        try:
            # Optimized mode: use tournament-verified model for this stage
            settings = get_settings()
            opt = settings.optimization
            if get_active_retrieval_mode() == "optimized":
                _model = opt.stage_model_classify
                _effort = opt.stage_effort_classify
            else:
                _model = None  # default (gpt-5.2)
                _effort = "low"

            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=_model,
                max_tokens=1024,
                reasoning_effort=_effort,
            )

            query_type_str = result.get("query_type", "single_hop")
            try:
                query_type = QueryType(query_type_str)
            except ValueError:
                query_type = QueryType.SINGLE_HOP

            query = Query(
                text=query_text,
                query_type=query_type,
                key_terms=result.get("key_terms", []),
                sub_queries=result.get("sub_queries", []),
            )

            logger.info(
                "Query classified: type=%s, terms=%s",
                query_type.value,
                query.key_terms,
            )
            return query

        except Exception as e:
            logger.error("Query classification failed: %s", str(e))
            return Query(text=query_text, query_type=QueryType.SINGLE_HOP)
