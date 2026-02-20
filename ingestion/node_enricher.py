"""
Node Enricher for GOVINDA V2.

Enriches tree nodes with LLM-generated summaries and descriptions.
These enrichments are what the LLM sees during the Locate phase
to decide which sections are relevant to a query.
"""

from __future__ import annotations

import logging
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.document import DocumentTree, TreeNode
from utils.llm_client import LLMClient
from utils.text_utils import estimate_tokens, truncate_text

logger = logging.getLogger(__name__)


class NodeEnricher:
    """
    Enrich tree nodes with LLM-generated summaries and descriptions.

    Processes nodes in batches to minimize LLM calls.
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._settings = get_settings()

    def enrich(self, tree: DocumentTree) -> DocumentTree:
        """
        Enrich all nodes in the tree with summaries and descriptions.

        Args:
            tree: The DocumentTree to enrich.

        Returns:
            The same tree with summary/description fields populated.
        """
        all_nodes = self._get_enrichable_nodes(tree)
        logger.info("Enriching %d nodes", len(all_nodes))

        # Process in batches of ~5 nodes (to stay within token limits)
        batch_size = 5
        enriched_count = 0

        for i in range(0, len(all_nodes), batch_size):
            batch = all_nodes[i : i + batch_size]
            self._enrich_batch(batch)
            enriched_count += len(batch)
            logger.info("Enriched %d/%d nodes", enriched_count, len(all_nodes))

        return tree

    def _get_enrichable_nodes(self, tree: DocumentTree) -> list[TreeNode]:
        """Get all nodes that need enrichment (have text content)."""
        nodes = []
        for node in tree.structure:
            self._collect_nodes(node, nodes)
        return nodes

    def _collect_nodes(self, node: TreeNode, result: list[TreeNode]) -> None:
        """Recursively collect nodes that need enrichment."""
        # Include if node has text or children
        text = node.text or node.get_full_text(include_children=False)
        if text.strip() or node.children:
            result.append(node)
        for child in node.children:
            self._collect_nodes(child, result)

    def _enrich_batch(self, nodes: list[TreeNode]) -> None:
        """Enrich a batch of nodes in a single LLM call."""
        prompt_data = load_prompt("tree_building", "node_enrichment")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        # Build sections text for the batch
        sections_parts = []
        for node in nodes:
            text = node.text or ""
            # Include table markdown if present
            table_text = ""
            if node.tables:
                table_parts = [t.to_markdown() for t in node.tables]
                table_text = "\n\n[TABLES]\n" + "\n\n".join(table_parts)

            content = text + table_text
            # Truncate to avoid token blow-up
            content = truncate_text(content, 1500)

            sections_parts.append(
                f"--- NODE {node.node_id}: {node.title} "
                f"({node.page_range_str}) ---\n{content}"
            )

        sections_text = "\n\n".join(sections_parts)

        user_msg = format_prompt(user_template, sections_text=sections_text)

        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=self._settings.llm.max_tokens_tree_building,
            )

            # Apply enrichments
            enrichments = result.get("enrichments", [])
            node_map = {n.node_id: n for n in nodes}

            for enrichment in enrichments:
                nid = enrichment.get("node_id", "")
                if nid in node_map:
                    node_map[nid].summary = enrichment.get("summary", "")
                    node_map[nid].description = enrichment.get("description", "")
                    node_map[nid].topics = enrichment.get("topics", [])

        except Exception as e:
            logger.error("Batch enrichment failed: %s", str(e))
            # Fall back to simple title-based summaries
            for node in nodes:
                if not node.summary:
                    node.summary = f"Section: {node.title}"
                if not node.description:
                    node.description = node.title
