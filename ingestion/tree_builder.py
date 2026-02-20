"""
Tree Builder for GOVINDA V2.

Converts flat TOC entries + parsed pages into a hierarchical DocumentTree
with proper nesting, text assignment, and node IDs.

This is the core tree construction pipeline:
1. Convert flat TOC entries → nested tree structure
2. Assign text content from pages to each node
3. Split oversized nodes into sub-nodes
4. Attach tables to their parent nodes
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from config.settings import get_settings
from ingestion.structure_detector import TOCEntry, StructureResult
from models.document import (
    DocumentTree,
    TreeNode,
    NodeType,
    PageContent,
    TableBlock,
    generate_doc_id,
)
from utils.text_utils import estimate_tokens

logger = logging.getLogger(__name__)


# Map entry_type strings to NodeType enum
_TYPE_MAP = {
    "chapter": NodeType.CHAPTER,
    "section": NodeType.SECTION,
    "subsection": NodeType.SUBSECTION,
    "clause": NodeType.CLAUSE,
    "subclause": NodeType.SUBCLAUSE,
    "paragraph": NodeType.PARAGRAPH,
    "table": NodeType.TABLE,
    "annexure": NodeType.ANNEXURE,
    "appendix": NodeType.APPENDIX,
    "schedule": NodeType.SCHEDULE,
    "definition": NodeType.DEFINITION,
    "proviso": NodeType.PROVISO,
}


class TreeBuilder:
    """
    Build a DocumentTree from structure detection results and parsed pages.
    """

    def __init__(self) -> None:
        self._settings = get_settings()
        self._node_counter = 0

    def build(
        self,
        structure: StructureResult,
        pages: list[PageContent],
        doc_name: str,
        doc_description: str = "",
    ) -> DocumentTree:
        """
        Build a complete DocumentTree.

        Args:
            structure: Result from StructureDetector
            pages: Parsed pages from PDFParser
            doc_name: Document filename
            doc_description: LLM-generated description

        Returns:
            A fully constructed DocumentTree with text assigned to nodes.
        """
        self._node_counter = 0
        logger.info(
            "Building tree from %d entries, %d pages",
            len(structure.entries),
            len(pages),
        )

        # Step 1: Convert flat entries to nested tree
        root_nodes = self._entries_to_tree(structure.entries)

        # Step 2: Compute end pages for each node
        self._compute_end_pages(root_nodes, len(pages))

        # Step 3: Assign text content from pages
        self._assign_text(root_nodes, pages)

        # Step 4: Attach tables from pages to their containing nodes
        self._attach_tables(root_nodes, pages)

        # Step 5: Split oversized nodes
        root_nodes = self._split_oversized_nodes(root_nodes, pages)

        # Step 6: Compute token counts
        self._compute_token_counts(root_nodes)

        # Build the DocumentTree
        tree = DocumentTree(
            doc_id=generate_doc_id(doc_name),
            doc_name=doc_name,
            doc_description=doc_description,
            total_pages=len(pages),
            structure=root_nodes,
        )
        tree.build_indexes()

        logger.info(
            "Tree built: %d total nodes, %d top-level",
            tree.node_count,
            len(root_nodes),
        )
        return tree

    # ------------------------------------------------------------------
    # Step 1: Convert flat entries to nested tree
    # ------------------------------------------------------------------

    def _entries_to_tree(self, entries: list[TOCEntry]) -> list[TreeNode]:
        """
        Convert flat TOC entries into a nested tree based on levels.

        Uses a stack-based approach: maintain a stack of parent nodes,
        and push/pop based on the current entry's level.
        """
        if not entries:
            return []

        root_nodes: list[TreeNode] = []
        # Stack: list of (level, TreeNode) — the current nesting path
        stack: list[tuple[int, TreeNode]] = []

        for entry in entries:
            node = TreeNode(
                node_id=self._next_node_id(),
                title=entry.title,
                node_type=_TYPE_MAP.get(entry.entry_type, NodeType.SECTION),
                level=entry.level,
                start_page=entry.physical_page or entry.page_number,
            )

            # Pop stack until we find the correct parent
            while stack and stack[-1][0] >= entry.level:
                stack.pop()

            if stack:
                parent = stack[-1][1]
                node.parent_id = parent.node_id
                parent.children.append(node)
            else:
                root_nodes.append(node)

            stack.append((entry.level, node))

        return root_nodes

    # ------------------------------------------------------------------
    # Step 2: Compute end pages
    # ------------------------------------------------------------------

    def _compute_end_pages(self, nodes: list[TreeNode], total_pages: int) -> None:
        """
        Compute end_page for each node based on the start_page of the
        next sibling or parent's end.
        """
        all_nodes = self._flatten_with_context(nodes, total_pages)

        for i, (node, siblings, parent_end) in enumerate(all_nodes):
            # Find the next sibling at the same or higher level
            next_start = parent_end
            for j in range(i + 1, len(all_nodes)):
                next_node = all_nodes[j][0]
                if next_node.level <= node.level:
                    next_start = next_node.start_page - 1
                    break

            node.end_page = max(node.start_page, min(next_start, total_pages))

        # Ensure parent pages span their children
        self._propagate_page_ranges(nodes, total_pages)

    def _flatten_with_context(
        self, nodes: list[TreeNode], total_pages: int
    ) -> list[tuple[TreeNode, list[TreeNode], int]]:
        """Flatten tree with sibling context for end page computation."""
        result = []

        def _recurse(node_list: list[TreeNode], parent_end: int):
            for node in node_list:
                result.append((node, node_list, parent_end))
                if node.children:
                    _recurse(node.children, parent_end)

        _recurse(nodes, total_pages)
        return result

    def _propagate_page_ranges(self, nodes: list[TreeNode], total_pages: int) -> None:
        """Ensure parent node page ranges span all their children."""
        for node in nodes:
            if node.children:
                self._propagate_page_ranges(node.children, total_pages)
                child_max = max(c.end_page for c in node.children)
                node.end_page = max(node.end_page, child_max)

    # ------------------------------------------------------------------
    # Step 3: Assign text content from pages
    # ------------------------------------------------------------------

    def _assign_text(self, nodes: list[TreeNode], pages: list[PageContent]) -> None:
        """
        Assign text content to each node based on its page range.

        For leaf nodes: assign the text between this node's start
        and the next node's start (within the node's page range).

        For parent nodes: assign only the text that precedes the
        first child (the "preamble" text).
        """
        # Build page lookup
        page_map = {p.page_number: p for p in pages}

        # Get all leaf nodes in order
        self._assign_text_recursive(nodes, page_map, pages)

    def _assign_text_recursive(
        self,
        nodes: list[TreeNode],
        page_map: dict[int, PageContent],
        pages: list[PageContent],
    ) -> None:
        """Recursively assign text to nodes."""
        for i, node in enumerate(nodes):
            if node.children:
                # Parent node: assign preamble text (before first child starts)
                first_child_page = node.children[0].start_page
                preamble_pages = range(
                    node.start_page,
                    min(first_child_page, node.end_page + 1),
                )
                preamble_parts = []
                for pg in preamble_pages:
                    if pg in page_map:
                        preamble_parts.append(page_map[pg].text)

                # For the first child's page, only take text before the
                # child's title (approximate)
                node.text = "\n\n".join(preamble_parts).strip()

                # Recurse into children
                self._assign_text_recursive(node.children, page_map, pages)
            else:
                # Leaf node: assign text from start_page to end_page
                text_parts = []
                for pg in range(node.start_page, node.end_page + 1):
                    if pg in page_map:
                        text_parts.append(page_map[pg].text)
                node.text = "\n\n".join(text_parts).strip()

    # ------------------------------------------------------------------
    # Step 4: Attach tables
    # ------------------------------------------------------------------

    def _attach_tables(self, nodes: list[TreeNode], pages: list[PageContent]) -> None:
        """Attach tables from parsed pages to their containing tree nodes."""
        # Collect all tables with their page numbers
        all_tables: list[TableBlock] = []
        for page in pages:
            all_tables.extend(page.tables)

        if not all_tables:
            return

        # For each table, find the node that contains its page
        for table in all_tables:
            owner = self._find_containing_node(nodes, table.page_number)
            if owner:
                owner.tables.append(table)
                logger.debug(
                    "Attached table %s (page %d) to node %s",
                    table.table_id,
                    table.page_number,
                    owner.node_id,
                )

    def _find_containing_node(
        self, nodes: list[TreeNode], page: int
    ) -> Optional[TreeNode]:
        """Find the deepest node containing a given page number."""
        best: Optional[TreeNode] = None

        for node in nodes:
            if node.start_page <= page <= node.end_page:
                best = node
                # Check children for a more specific match
                if node.children:
                    child_match = self._find_containing_node(node.children, page)
                    if child_match:
                        best = child_match
        return best

    # ------------------------------------------------------------------
    # Step 5: Split oversized nodes
    # ------------------------------------------------------------------

    def _split_oversized_nodes(
        self, nodes: list[TreeNode], pages: list[PageContent]
    ) -> list[TreeNode]:
        """
        Split nodes that exceed max_node_tokens into sub-nodes.

        Uses page boundaries as natural split points.
        """
        max_tokens = self._settings.tree.max_node_tokens
        result = []

        for node in nodes:
            # First recurse into children
            if node.children:
                node.children = self._split_oversized_nodes(node.children, pages)

            # Check if this leaf node needs splitting
            if node.is_leaf and estimate_tokens(node.text) > max_tokens:
                sub_nodes = self._split_node_by_pages(node, pages)
                if sub_nodes:
                    node.children = sub_nodes
                    # Clear parent's full text (children have it now)
                    node.text = ""
                    logger.debug(
                        "Split node %s into %d sub-nodes",
                        node.node_id,
                        len(sub_nodes),
                    )

            result.append(node)

        return result

    def _split_node_by_pages(
        self, node: TreeNode, pages: list[PageContent]
    ) -> list[TreeNode]:
        """Split a single oversized node using page boundaries."""
        if node.start_page == node.end_page:
            # Can't split a single-page node further
            return []

        page_map = {p.page_number: p for p in pages}
        sub_nodes = []

        for pg in range(node.start_page, node.end_page + 1):
            if pg in page_map and page_map[pg].text.strip():
                sub_node = TreeNode(
                    node_id=self._next_node_id(),
                    title=f"{node.title} (p.{pg})",
                    node_type=NodeType.PARAGRAPH,
                    level=node.level + 1,
                    start_page=pg,
                    end_page=pg,
                    text=page_map[pg].text,
                    parent_id=node.node_id,
                )
                sub_nodes.append(sub_node)

        return sub_nodes

    # ------------------------------------------------------------------
    # Step 6: Token counts
    # ------------------------------------------------------------------

    def _compute_token_counts(self, nodes: list[TreeNode]) -> None:
        """Compute token counts for all nodes."""
        for node in nodes:
            node.token_count = estimate_tokens(node.text)
            if node.children:
                self._compute_token_counts(node.children)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _next_node_id(self) -> str:
        """Generate the next sequential node ID."""
        nid = f"{self._node_counter:04d}"
        self._node_counter += 1
        return nid
