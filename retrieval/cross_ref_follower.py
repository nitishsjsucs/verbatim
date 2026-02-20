"""
Cross-Reference Follower for GOVINDA V2.

When the Locator selects nodes that have cross-references to other
sections, the follower retrieves those referenced sections too.

This ensures the answer includes all relevant linked content.
"""

from __future__ import annotations

import logging
from typing import Optional

from config.settings import get_settings
from models.document import DocumentTree, TreeNode
from models.query import LocatedNode, RetrievedSection
from utils.text_utils import estimate_tokens

logger = logging.getLogger(__name__)


class CrossRefFollower:
    """Follow cross-references from located nodes."""

    def __init__(self) -> None:
        self._settings = get_settings()

    def follow(
        self,
        located_nodes: list[LocatedNode],
        tree: DocumentTree,
        already_read: set[str],
    ) -> list[RetrievedSection]:
        """
        Follow cross-references from located nodes.

        Args:
            located_nodes: The nodes found during location.
            tree: The document tree.
            already_read: Set of node_ids already read.

        Returns:
            Additional RetrievedSection objects from cross-referenced nodes.
        """
        max_depth = self._settings.retrieval.max_cross_ref_depth
        sections: list[RetrievedSection] = []
        visited = set(already_read)

        for located in located_nodes:
            node = tree.get_node(located.node_id)
            if not node:
                continue

            self._follow_refs(
                node, tree, visited, sections, depth=0, max_depth=max_depth
            )

        if sections:
            logger.info(
                "Followed cross-references: %d additional sections",
                len(sections),
            )

        return sections

    def _follow_refs(
        self,
        node: TreeNode,
        tree: DocumentTree,
        visited: set[str],
        sections: list[RetrievedSection],
        depth: int,
        max_depth: int,
    ) -> None:
        """Recursively follow cross-references up to max_depth."""
        if depth >= max_depth:
            return

        for ref in node.cross_references:
            if not ref.resolved or not ref.target_node_id:
                continue
            if ref.target_node_id in visited:
                continue

            target = tree.get_node(ref.target_node_id)
            if not target:
                continue

            visited.add(ref.target_node_id)

            # Read the referenced node
            text = target.text if target.is_leaf else target.get_full_text()
            if target.tables:
                table_text = "\n\n".join(t.to_markdown() for t in target.tables)
                text = text + "\n\n[TABLES]\n" + table_text

            section = RetrievedSection(
                node_id=target.node_id,
                title=target.title,
                text=text,
                page_range=target.page_range_str,
                source="cross_ref",
                token_count=estimate_tokens(text),
            )
            sections.append(section)

            # Recurse into this node's cross-references
            self._follow_refs(
                target,
                tree,
                visited,
                sections,
                depth=depth + 1,
                max_depth=max_depth,
            )
