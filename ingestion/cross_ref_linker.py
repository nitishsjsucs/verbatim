"""
Cross-Reference Linker for GOVINDA V2.

Detects cross-references between document sections
(e.g., "as per Section 16", "refer Annexure I") and creates
links in the document tree.

This enables the retrieval system to follow cross-references
when locating relevant content.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

from config.settings import get_settings
from models.document import CrossReference, DocumentTree, TreeNode
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class CrossRefLinker:
    """
    Detect and resolve cross-references between document tree nodes.

    Uses a two-pass approach:
    1. Regex + string matching (fast, no LLM cost)
    2. LLM-assisted resolution for unresolved refs (optional, if LLM provided)
    """

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._settings = get_settings()
        self._llm = llm
        # Compile cross-reference patterns from config
        self._patterns = [
            re.compile(p, re.IGNORECASE) for p in self._settings.tree.cross_ref_patterns
        ]

    def link(self, tree: DocumentTree) -> DocumentTree:
        """
        Detect and resolve cross-references in the entire tree.

        Steps:
        1. Scan all node text for cross-reference patterns
        2. Extract referenced identifiers (e.g., "Section 16", "Annexure I")
        3. Resolve identifiers to node_ids using the tree index (regex)
        4. LLM-assisted resolution for any remaining unresolved refs
        """
        all_nodes = list(tree._node_index.values())
        total_refs = 0
        resolved_refs = 0

        for node in all_nodes:
            refs = self._detect_references(node)
            for ref in refs:
                # Try to resolve the reference to a target node
                target_id = self._resolve_reference(ref.target_identifier, tree)
                if target_id:
                    ref.target_node_id = target_id
                    ref.resolved = True
                    resolved_refs += 1

                node.cross_references.append(ref)
                total_refs += 1

        logger.info(
            "Cross-references (regex pass): %d detected, %d resolved (%.0f%%)",
            total_refs,
            resolved_refs,
            (resolved_refs / total_refs * 100) if total_refs > 0 else 0,
        )

        # LLM-assisted resolution for unresolved references
        if self._llm and total_refs > resolved_refs:
            llm_resolved = self._llm_resolve_unresolved(tree)
            resolved_refs += llm_resolved
            logger.info(
                "Cross-references (after LLM pass): %d/%d resolved (%.0f%%)",
                resolved_refs,
                total_refs,
                (resolved_refs / total_refs * 100) if total_refs > 0 else 0,
            )

        return tree

    def _llm_resolve_unresolved(self, tree: DocumentTree) -> int:
        """
        Use LLM to resolve cross-references that regex couldn't match.

        Batches all unresolved references into a single LLM call with
        the tree index, asking the LLM to match each to a node_id.

        Returns:
            Number of newly resolved references.
        """
        # Collect all unresolved references
        unresolved: list[tuple[TreeNode, CrossReference]] = []
        for node in tree._node_index.values():
            for ref in node.cross_references:
                if not ref.resolved:
                    unresolved.append((node, ref))

        if not unresolved:
            return 0

        # Build the tree index (node_id -> title mapping)
        node_list = []
        for nid, node in tree._node_index.items():
            node_list.append(
                {
                    "node_id": nid,
                    "title": node.title,
                    "page_range": node.page_range_str,
                }
            )

        # Build the unresolved references list
        unresolved_list = []
        for node, ref in unresolved:
            unresolved_list.append(
                {
                    "source_node_id": node.node_id,
                    "source_title": node.title,
                    "target_identifier": ref.target_identifier,
                    "context": ref.reference_text[:150] if ref.reference_text else "",
                }
            )

        prompt = (
            "You are resolving cross-references in an RBI regulatory document.\n\n"
            "DOCUMENT NODES:\n"
            f"{json.dumps(node_list, indent=2)}\n\n"
            "UNRESOLVED CROSS-REFERENCES:\n"
            f"{json.dumps(unresolved_list, indent=2)}\n\n"
            "For each unresolved reference, determine which node_id it refers to.\n"
            "If you cannot confidently match a reference, set target_node_id to null.\n\n"
            "Return JSON:\n"
            '{"resolved": [{"target_identifier": "...", "target_node_id": "..." or null}]}'
        )

        try:
            result = self._llm.chat_json(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=4096,
                reasoning_effort="low",
            )

            resolutions = result.get("resolved", [])

            # Build lookup: target_identifier -> target_node_id
            resolution_map: dict[str, str] = {}
            for r in resolutions:
                tid = r.get("target_node_id")
                ident = r.get("target_identifier", "")
                if tid and ident and tree.get_node(tid):
                    resolution_map[ident] = tid

            # Apply resolutions
            newly_resolved = 0
            for node, ref in unresolved:
                if ref.target_identifier in resolution_map:
                    ref.target_node_id = resolution_map[ref.target_identifier]
                    ref.resolved = True
                    newly_resolved += 1

            logger.info(
                "LLM resolved %d/%d unresolved cross-references",
                newly_resolved,
                len(unresolved),
            )
            return newly_resolved

        except Exception as e:
            logger.error("LLM cross-reference resolution failed: %s", str(e))
            return 0

    def _detect_references(self, node: TreeNode) -> list[CrossReference]:
        """Detect cross-reference patterns in a node's text."""
        refs: list[CrossReference] = []
        text = node.text
        if not text:
            return refs

        for pattern in self._patterns:
            for match in pattern.finditer(text):
                ref_text = match.group(0).strip()

                # Extract the specific identifier (e.g., "Section 16")
                identifier = self._extract_identifier(ref_text)
                if not identifier:
                    continue

                # Skip self-references
                if self._is_self_reference(identifier, node.title):
                    continue

                # Get surrounding context
                start = max(0, match.start() - 50)
                end = min(len(text), match.end() + 50)
                context = text[start:end].strip()

                ref = CrossReference(
                    source_node_id=node.node_id,
                    target_identifier=identifier,
                    reference_text=context,
                )
                refs.append(ref)

        # Deduplicate by identifier
        seen = set()
        unique_refs = []
        for ref in refs:
            if ref.target_identifier not in seen:
                seen.add(ref.target_identifier)
                unique_refs.append(ref)

        return unique_refs

    def _extract_identifier(self, ref_text: str) -> str:
        """Extract the specific section/clause identifier from reference text."""
        # Patterns like "Section 16", "Clause 5", "Annexure I", etc.
        match = re.search(
            r"((?:Section|Clause|Para(?:graph)?|Annexure|Appendix|Schedule|Chapter)\s+[\w\.\-]+)",
            ref_text,
            re.IGNORECASE,
        )
        if match:
            return match.group(1).strip()

        # Master Direction / Circular references
        match = re.search(
            r"((?:Master\s+Direction|Master\s+Circular|Notification)\s+(?:No\.?|dated)\s+[\w\.\-/]+)",
            ref_text,
            re.IGNORECASE,
        )
        if match:
            return match.group(1).strip()

        return ""

    def _is_self_reference(self, identifier: str, title: str) -> bool:
        """Check if a reference points to the node's own section."""
        # Normalize both for comparison
        id_lower = identifier.lower().strip()
        title_lower = title.lower().strip()

        # Check if the identifier is part of the title
        id_words = set(id_lower.split())
        title_words = set(title_lower.split())

        # If most identifier words appear in the title, it's likely self-referencing
        if id_words and id_words.issubset(title_words):
            return True

        return False

    def _resolve_reference(self, identifier: str, tree: DocumentTree) -> str:
        """
        Try to resolve a cross-reference identifier to a node_id.

        Resolution strategies (in order):
        1. Exact title match
        2. Title contains the identifier
        3. Identifier number matches section numbering in title
        """
        id_lower = identifier.lower().strip()

        # Strategy 1: Exact title match
        nodes = tree.get_nodes_by_title(identifier)
        if nodes:
            return nodes[0].node_id

        # Strategy 2: Search for nodes whose title contains the identifier
        for nid, node in tree._node_index.items():
            title_lower = node.title.lower().strip()

            # Check if identifier is contained in title
            if id_lower in title_lower:
                return nid

            # Check if key parts match
            # e.g., "Annexure I" matches "Annex – I"
            id_parts = re.findall(r"[a-z]+|\d+|[ivxlcdm]+", id_lower)
            title_parts = re.findall(r"[a-z]+|\d+|[ivxlcdm]+", title_lower)
            if id_parts and all(p in title_parts for p in id_parts):
                return nid

        # Strategy 3: Look for section numbers
        # e.g., "Section 16" → find node starting with clause "16."
        num_match = re.search(r"\d+", identifier)
        if num_match:
            num = num_match.group(0)
            for nid, node in tree._node_index.items():
                if node.title.strip().startswith(
                    f"{num}."
                ) or node.title.strip().startswith(f"{num} "):
                    return nid

        return ""
