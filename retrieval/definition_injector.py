"""
Definition Injector for GOVINDA V2.

Post-retrieval step that ensures definition nodes are included
when the query mentions defined terms. Regulatory answers almost
always need to start with the relevant definition.

Inspired by V1's definition prioritization (relevance_score=5 for
text containing "means", "includes", "refers to").

This module uses NO LLM calls — pure tree traversal + string matching.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

from models.document import DocumentTree, NodeType, TreeNode
from models.query import Query, RetrievedSection
from utils.text_utils import estimate_tokens

if TYPE_CHECKING:
    from retrieval.reader import Reader

logger = logging.getLogger(__name__)

# Patterns that indicate a node contains definitions
_DEF_TITLE_PATTERNS = re.compile(
    r"(definition|interpretation|glossary|preliminary|meaning)",
    re.IGNORECASE,
)

# Patterns in node text/summary that indicate a definition
_DEF_TEXT_PATTERNS = re.compile(
    r'"\s*means\b|"\s*includes\b|"\s*refers\s+to\b|"\s*shall\s+mean\b'
    r"|'\s*means\b|'\s*includes\b|'\s*refers\s+to\b|'\s*shall\s+mean\b"
    r"|\bmeans\s+and\s+includes\b",
    re.IGNORECASE,
)

# Max definition nodes to inject (to avoid bloating context)
_MAX_DEF_INJECTIONS = 3


class DefinitionInjector:
    """
    Inject missing definition nodes into retrieved sections.

    After the main retrieval pass, this checks whether the query's
    key terms have corresponding definition nodes in the tree. If
    a definition node exists but wasn't retrieved, it's injected
    at the front of the sections list (definitions first = better
    inference quality).
    """

    def inject(
        self,
        query: Query,
        sections: list[RetrievedSection],
        tree: DocumentTree,
        reader: "Reader",
    ) -> list[RetrievedSection]:
        """
        Inject missing definition nodes for query key terms.

        Args:
            query: The classified query with key_terms.
            sections: Already-retrieved sections.
            tree: The document tree.
            reader: The Reader instance (to convert nodes to sections).

        Returns:
            Updated sections list with definition nodes prepended.
        """
        if not query.key_terms:
            logger.debug("No key terms — skipping definition injection")
            return sections

        already_read = {s.node_id for s in sections}
        def_nodes = self._find_definition_nodes(tree)

        if not def_nodes:
            logger.debug("No definition nodes found in tree")
            return sections

        injected: list[RetrievedSection] = []
        injected_count = 0

        for term in query.key_terms:
            if injected_count >= _MAX_DEF_INJECTIONS:
                break

            term_lower = term.lower().strip()
            if not term_lower:
                continue

            for node in def_nodes:
                if node.node_id in already_read:
                    continue

                # Check if this definition node mentions the term
                if self._node_mentions_term(node, term_lower):
                    section = reader._node_to_section(node, source="definition_inject")
                    if section.token_count > 0:
                        injected.append(section)
                        already_read.add(node.node_id)
                        injected_count += 1
                        logger.info(
                            "Injected definition node '%s' for term '%s'",
                            node.title,
                            term,
                        )
                        break  # One definition per term is sufficient

        if injected:
            # Prepend definitions — they should come first in context
            logger.info(
                "Definition injection: %d nodes injected for terms: %s",
                len(injected),
                [s.title for s in injected],
            )
            return injected + sections

        logger.debug("No missing definitions found for key terms")
        return sections

    def _find_definition_nodes(self, tree: DocumentTree) -> list[TreeNode]:
        """
        Find all nodes in the tree that are likely definition nodes.

        Uses title patterns, node_type, and text/summary content.
        """
        def_nodes: list[TreeNode] = []

        for node in tree._all_nodes():
            # Check 1: Node type is DEFINITION
            if node.node_type == NodeType.DEFINITION:
                def_nodes.append(node)
                continue

            # Check 2: Title matches definition patterns
            if _DEF_TITLE_PATTERNS.search(node.title):
                def_nodes.append(node)
                continue

            # Check 3: Summary contains definition indicators
            if node.summary and _DEF_TEXT_PATTERNS.search(node.summary):
                def_nodes.append(node)
                continue

        return def_nodes

    @staticmethod
    def _node_mentions_term(node: TreeNode, term_lower: str) -> bool:
        """
        Check if a node mentions a specific term in its text or summary.

        Uses case-insensitive substring matching, with word boundary
        awareness for short terms to avoid false positives.
        """
        # Search in text, summary, and title
        searchable = " ".join(
            filter(None, [node.text, node.summary, node.title])
        ).lower()

        if not searchable:
            return False

        # For short terms (<=4 chars), require word boundary to avoid
        # false positives (e.g., "CDD" matching "added")
        if len(term_lower) <= 4:
            pattern = r"\b" + re.escape(term_lower) + r"\b"
            return bool(re.search(pattern, searchable))

        return term_lower in searchable
