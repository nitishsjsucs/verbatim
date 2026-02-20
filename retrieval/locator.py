"""
Locator for GOVINDA V2 — DeepRead Phase 1.

The LLM reasons over the document tree index (titles + summaries)
to identify which sections are relevant to the query.

This is the core vectorless retrieval mechanism: no embeddings,
no similarity search — pure LLM reasoning over structure.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.document import DocumentTree
from models.query import LocatedNode, Query
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class Locator:
    """
    Locate relevant document sections using LLM tree reasoning.

    Presents the tree index (titles + summaries + page ranges) to
    the LLM and asks it to select relevant node_ids.
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._settings = get_settings()

    def locate(self, query: Query, tree: DocumentTree) -> list[LocatedNode]:
        """
        Locate relevant nodes in the document tree.

        Args:
            query: The classified query.
            tree: The document tree to search.

        Returns:
            List of LocatedNode objects with relevance reasoning.
        """
        prompt_data = load_prompt("retrieval", "node_location")
        system_prompt = format_prompt(
            prompt_data["system"],
            max_nodes=self._settings.retrieval.max_located_nodes,
        )
        user_template = prompt_data["user_template"]

        # Build the tree index JSON for the LLM
        tree_index = json.dumps(tree.to_index(), indent=2)

        user_msg = format_prompt(
            user_template,
            query_text=query.text,
            query_type=query.query_type.value,
            key_terms=", ".join(query.key_terms) if query.key_terms else "none",
            tree_index=tree_index,
        )

        try:
            # Adaptive reasoning effort based on query complexity
            _effort_map = {
                "definitional": "low",
                "single_hop": "medium",
                "multi_hop": "medium",
                "global": "high",
            }
            effort = _effort_map.get(query.query_type.value, "medium")

            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=4096,
                reasoning_effort=effort,
            )

            located = []
            for item in result.get("located_nodes", []):
                node_id = item.get("node_id", "")
                # Verify the node actually exists in the tree
                tree_node = tree.get_node(node_id)
                if not tree_node:
                    logger.warning("Locator returned invalid node_id: %s", node_id)
                    continue

                located.append(
                    LocatedNode(
                        node_id=node_id,
                        title=tree_node.title,
                        relevance_reason=item.get("relevance_reason", ""),
                        confidence=float(item.get("confidence", 0.8)),
                        page_range=tree_node.page_range_str,
                    )
                )

            # Sort by confidence (highest first)
            located.sort(key=lambda n: n.confidence, reverse=True)

            # Limit to max
            located = located[: self._settings.retrieval.max_located_nodes]

            reasoning = result.get("reasoning_summary", "")
            logger.info(
                "Located %d nodes (strategy: %s)",
                len(located),
                reasoning[:100],
            )

            return located

        except Exception as e:
            logger.error("Location failed: %s", str(e))
            return []
