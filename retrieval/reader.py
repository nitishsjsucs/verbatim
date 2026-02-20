"""
Reader for GOVINDA V2 — DeepRead Phase 2.

After the Locator identifies relevant node_ids, the Reader
extracts the full text from those nodes plus contextual
expansions (siblings, parent preamble).
"""

from __future__ import annotations

import logging
from typing import Optional

from config.settings import get_settings
from models.document import DocumentTree, TreeNode
from models.query import LocatedNode, RetrievedSection
from utils.text_utils import estimate_tokens

logger = logging.getLogger(__name__)

# Query types where parent nodes should include children text
# (broad queries need more context from parent sections)
_FULL_TEXT_QUERY_TYPES = {"multi_hop", "global"}


class Reader:
    """
    Read full text from located nodes with context expansion.

    Expands to neighboring nodes for context (configurable):
    - Sibling nodes (adjacent sections at same level)
    - Parent node preamble (introductory text)
    """

    def __init__(self) -> None:
        self._settings = get_settings()

    def read(
        self,
        located_nodes: list[LocatedNode],
        tree: DocumentTree,
        query_type: str = "single_hop",
    ) -> list[RetrievedSection]:
        """
        Read text from located nodes with context expansion.

        Args:
            located_nodes: Nodes identified by the Locator.
            tree: The document tree.
            query_type: The classified query type (affects parent-node text inclusion).

        Returns:
            List of RetrievedSection objects with full text.
        """
        sections: list[RetrievedSection] = []
        seen_ids: set[str] = set()
        token_budget = self._settings.retrieval.retrieval_token_budget
        total_tokens = 0
        include_children = query_type in _FULL_TEXT_QUERY_TYPES

        for located in located_nodes:
            if total_tokens >= token_budget:
                logger.info("Token budget reached (%d/%d)", total_tokens, token_budget)
                break

            node = tree.get_node(located.node_id)
            if not node:
                continue

            # Read the primary node
            if node.node_id not in seen_ids:
                section = self._node_to_section(
                    node, source="direct", include_children=include_children
                )
                if section.token_count > 0:
                    sections.append(section)
                    seen_ids.add(node.node_id)
                    total_tokens += section.token_count

            # Context expansion: parent preamble
            if self._settings.retrieval.context_expansion_parent:
                parent = tree.get_parent_node(node.node_id)
                if parent and parent.node_id not in seen_ids:
                    # Only include parent's own text (preamble), not children
                    parent_text = parent.text  # This is already just preamble
                    if parent_text.strip():
                        parent_section = RetrievedSection(
                            node_id=parent.node_id,
                            title=parent.title,
                            text=parent_text,
                            page_range=parent.page_range_str,
                            source="parent",
                            token_count=estimate_tokens(parent_text),
                        )
                        if total_tokens + parent_section.token_count <= token_budget:
                            sections.append(parent_section)
                            seen_ids.add(parent.node_id)
                            total_tokens += parent_section.token_count

            # Context expansion: siblings
            expand_count = self._settings.retrieval.context_expansion_siblings
            if expand_count > 0:
                siblings = tree.get_sibling_nodes(node.node_id)
                # Sort siblings by proximity (closest page numbers)
                siblings.sort(key=lambda s: abs(s.start_page - node.start_page))

                for sib in siblings[:expand_count]:
                    if sib.node_id not in seen_ids:
                        sib_section = self._node_to_section(
                            sib, source="sibling", include_children=include_children
                        )
                        if total_tokens + sib_section.token_count <= token_budget:
                            sections.append(sib_section)
                            seen_ids.add(sib.node_id)
                            total_tokens += sib_section.token_count

        logger.info(
            "Read %d sections (%d tokens from %d located nodes)",
            len(sections),
            total_tokens,
            len(located_nodes),
        )

        return sections

    def _node_to_section(
        self,
        node: TreeNode,
        source: str = "direct",
        include_children: bool = False,
    ) -> RetrievedSection:
        """Convert a TreeNode to a RetrievedSection with full text."""
        if node.is_leaf:
            text = node.text
        elif include_children:
            # For broad queries (multi_hop/global), include full content
            # so the synthesizer has maximum context
            text = node.get_full_text(include_children=True)
        else:
            # For focused queries (definitional/single_hop), only preamble
            # — children should be located explicitly, avoids duplication
            text = node.text

        # Include table markdown
        if node.tables:
            table_parts = [t.to_markdown() for t in node.tables]
            tables_text = "\n\n---\n[TABLES]\n" + "\n\n".join(table_parts)
            text = text + tables_text

        return RetrievedSection(
            node_id=node.node_id,
            title=node.title,
            text=text,
            page_range=node.page_range_str,
            source=source,
            token_count=estimate_tokens(text),
        )
