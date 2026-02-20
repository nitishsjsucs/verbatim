"""
Document data models for GOVINDA V2.

Represents parsed PDF documents, their hierarchical tree structure,
tables, cross-references, and navigation coordinates.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class NodeType(str, Enum):
    """Type of node in the document tree."""

    ROOT = "root"  # Document root
    CHAPTER = "chapter"
    SECTION = "section"
    SUBSECTION = "subsection"
    CLAUSE = "clause"
    SUBCLAUSE = "subclause"
    PARAGRAPH = "paragraph"
    TABLE = "table"
    ANNEXURE = "annexure"
    APPENDIX = "appendix"
    SCHEDULE = "schedule"
    DEFINITION = "definition"
    PROVISO = "proviso"


@dataclass
class PageContent:
    """Raw content extracted from a single PDF page."""

    page_number: int  # 1-indexed physical page number
    text: str  # Full text content of the page
    tables: list[TableBlock]  # Tables detected on this page
    char_count: int = 0
    word_count: int = 0

    def __post_init__(self):
        self.char_count = len(self.text)
        self.word_count = len(self.text.split())


@dataclass
class TableCell:
    """A single cell in a table."""

    row: int
    col: int
    text: str
    is_header: bool = False
    row_span: int = 1
    col_span: int = 1


@dataclass
class TableBlock:
    """A table extracted from the document — first-class node."""

    table_id: str
    page_number: int
    cells: list[TableCell]
    num_rows: int = 0
    num_cols: int = 0
    caption: str = ""  # Table caption/title if detected
    raw_text: str = ""  # Flattened text representation
    preceding_context: str = ""  # Text immediately before the table
    following_context: str = ""  # Text immediately after the table

    def to_markdown(self) -> str:
        """Convert table to markdown format for LLM consumption."""
        if not self.cells:
            return self.raw_text

        # Build grid
        grid: dict[tuple[int, int], str] = {}
        max_row = max_col = 0
        for cell in self.cells:
            grid[(cell.row, cell.col)] = cell.text
            max_row = max(max_row, cell.row)
            max_col = max(max_col, cell.col)

        lines = []
        for r in range(max_row + 1):
            row_cells = [grid.get((r, c), "") for c in range(max_col + 1)]
            lines.append("| " + " | ".join(row_cells) + " |")
            if r == 0:
                lines.append("| " + " | ".join(["---"] * (max_col + 1)) + " |")

        if self.caption:
            return f"**{self.caption}**\n\n" + "\n".join(lines)
        return "\n".join(lines)


@dataclass
class CrossReference:
    """A cross-reference link between document sections."""

    source_node_id: str  # Node containing the reference
    target_identifier: str  # Raw reference text (e.g., "Section 16")
    target_node_id: str = ""  # Resolved node_id (filled during linking)
    reference_text: str = ""  # Surrounding context of the reference
    resolved: bool = False


@dataclass
class TreeNode:
    """
    A node in the document tree.

    Uses coordinate-based navigation (DeepRead pattern):
    doc_id → node_id → (start_page, end_page)
    """

    node_id: str  # Unique ID like "0000", "0001", etc.
    title: str  # Section/clause title
    node_type: NodeType = NodeType.SECTION
    level: int = 0  # Depth in tree (0 = root)
    start_page: int = 0  # First page (1-indexed)
    end_page: int = 0  # Last page (1-indexed, inclusive)
    text: str = ""  # Full text content of this node
    summary: str = ""  # LLM-generated summary
    description: str = ""  # LLM-generated description
    topics: list[str] = field(default_factory=list)  # Keyword tags for LLM matching
    token_count: int = 0  # Approximate token count of text

    # Children and relationships
    children: list[TreeNode] = field(default_factory=list)
    parent_id: str = ""  # Parent node's node_id
    cross_references: list[CrossReference] = field(default_factory=list)

    # Table content (if this node contains or is a table)
    tables: list[TableBlock] = field(default_factory=list)

    @property
    def is_leaf(self) -> bool:
        return len(self.children) == 0

    @property
    def page_range_str(self) -> str:
        if self.start_page == self.end_page:
            return f"p.{self.start_page}"
        return f"pp.{self.start_page}-{self.end_page}"

    def get_all_descendants(self) -> list[TreeNode]:
        """Get all descendant nodes (depth-first)."""
        descendants = []
        for child in self.children:
            descendants.append(child)
            descendants.extend(child.get_all_descendants())
        return descendants

    def get_full_text(self, include_children: bool = True) -> str:
        """Get text content, optionally including children."""
        parts = [self.text] if self.text else []
        if include_children:
            for child in self.children:
                child_text = child.get_full_text(include_children=True)
                if child_text:
                    parts.append(child_text)
        return "\n\n".join(parts)

    def to_index_entry(self) -> dict:
        """
        Convert to a lightweight index entry for LLM tree reasoning.
        This is what the LLM sees during the Locate phase — no full text,
        just structure + summaries.
        """
        entry = {
            "node_id": self.node_id,
            "title": self.title,
            "type": self.node_type.value,
            "pages": self.page_range_str,
            "summary": self.summary,
        }
        if self.topics:
            entry["topics"] = self.topics
        if self.tables:
            entry["has_tables"] = True
            entry["table_count"] = len(self.tables)
        if self.cross_references:
            refs = [cr.target_identifier for cr in self.cross_references if cr.resolved]
            if refs:
                entry["references"] = refs
        if self.children:
            entry["children"] = [c.to_index_entry() for c in self.children]
        return entry


@dataclass
class DocumentTree:
    """
    Complete document tree — the core data structure of GOVINDA V2.

    This replaces the vector database. The entire retrieval system
    operates on this tree structure.
    """

    doc_id: str  # Unique document identifier
    doc_name: str  # Filename
    doc_description: str = ""  # LLM-generated document description
    total_pages: int = 0
    structure: list[TreeNode] = field(default_factory=list)  # Top-level nodes

    # Flat lookup indexes (populated during build)
    _node_index: dict[str, TreeNode] = field(default_factory=dict, repr=False)
    _title_index: dict[str, list[str]] = field(default_factory=dict, repr=False)

    def build_indexes(self) -> None:
        """Build flat lookup indexes from the tree structure."""
        self._node_index.clear()
        self._title_index.clear()
        for node in self._all_nodes():
            self._node_index[node.node_id] = node
            # Index by normalized title for cross-reference resolution
            key = node.title.lower().strip()
            if key not in self._title_index:
                self._title_index[key] = []
            self._title_index[key].append(node.node_id)

    def _all_nodes(self) -> list[TreeNode]:
        """Get all nodes in the tree (depth-first)."""
        all_nodes = []
        for node in self.structure:
            all_nodes.append(node)
            all_nodes.extend(node.get_all_descendants())
        return all_nodes

    def get_node(self, node_id: str) -> Optional[TreeNode]:
        """Look up a node by its ID."""
        return self._node_index.get(node_id)

    def get_nodes_by_title(self, title: str) -> list[TreeNode]:
        """Look up nodes by title (case-insensitive)."""
        node_ids = self._title_index.get(title.lower().strip(), [])
        return [self._node_index[nid] for nid in node_ids if nid in self._node_index]

    def get_sibling_nodes(self, node_id: str) -> list[TreeNode]:
        """Get sibling nodes (nodes sharing the same parent)."""
        node = self.get_node(node_id)
        if not node:
            return []
        if not node.parent_id:
            # Top-level node — siblings are other top-level nodes
            return [n for n in self.structure if n.node_id != node_id]
        parent = self.get_node(node.parent_id)
        if not parent:
            return []
        return [c for c in parent.children if c.node_id != node_id]

    def get_parent_node(self, node_id: str) -> Optional[TreeNode]:
        """Get parent of a node."""
        node = self.get_node(node_id)
        if not node or not node.parent_id:
            return None
        return self.get_node(node.parent_id)

    @property
    def node_count(self) -> int:
        return len(self._node_index)

    def to_corpus_entry(self) -> "CorpusDocument":
        """
        Generate a lightweight CorpusDocument summary for corpus-level reasoning.

        Aggregates topics from all nodes (top 30 most frequent) and extracts
        key entity names (regulatory bodies, acts, etc.) from the description.
        """
        from collections import Counter
        from models.corpus import CorpusDocument

        # Aggregate topics across all nodes, take top 30
        topic_counter: Counter[str] = Counter()
        for node in self._all_nodes():
            for topic in node.topics:
                topic_counter[topic.lower().strip()] += 1
        top_topics = [t for t, _ in topic_counter.most_common(30)]

        # Extract key entities from the description via simple heuristics
        key_entities: list[str] = []
        desc = self.doc_description or ""
        # Look for common regulatory entity patterns
        import re

        entity_patterns = [
            r"RBI|Reserve Bank of India",
            r"SEBI|Securities and Exchange Board",
            r"PMLA|Prevention of Money Laundering Act",
            r"FEMA|Foreign Exchange Management Act",
            r"Banking Regulation Act",
            r"Companies Act",
            r"Income Tax Act",
            r"Master Direction[s]?",
            r"Master Circular[s]?",
            r"(?:RBI|SEBI|IRDA|NHB|NABARD|PFRDA)",
        ]
        for pattern in entity_patterns:
            matches = re.findall(pattern, desc, re.IGNORECASE)
            key_entities.extend(matches)
        # Deduplicate preserving order
        seen: set[str] = set()
        deduped: list[str] = []
        for e in key_entities:
            e_lower = e.lower()
            if e_lower not in seen:
                seen.add(e_lower)
                deduped.append(e)
        key_entities = deduped[:15]

        return CorpusDocument(
            doc_id=self.doc_id,
            doc_name=self.doc_name,
            doc_description=self.doc_description,
            total_pages=self.total_pages,
            node_count=self.node_count,
            top_topics=top_topics,
            key_entities=key_entities,
        )

    def to_index(self) -> dict:
        """
        Export the tree as a lightweight index structure for LLM reasoning.
        This is the structure the LLM sees during the Locate phase.
        """
        return {
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "doc_description": self.doc_description,
            "total_pages": self.total_pages,
            "structure": [node.to_index_entry() for node in self.structure],
        }

    def to_dict(self) -> dict:
        """Export full tree as a serializable dict (for persistence)."""
        return {
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "doc_description": self.doc_description,
            "total_pages": self.total_pages,
            "structure": [self._node_to_dict(n) for n in self.structure],
        }

    def _node_to_dict(self, node: TreeNode) -> dict:
        """Recursively serialize a TreeNode."""
        d = {
            "node_id": node.node_id,
            "title": node.title,
            "node_type": node.node_type.value,
            "level": node.level,
            "start_page": node.start_page,
            "end_page": node.end_page,
            "text": node.text,
            "summary": node.summary,
            "description": node.description,
            "topics": node.topics,
            "token_count": node.token_count,
            "parent_id": node.parent_id,
        }
        if node.tables:
            d["tables"] = [
                {
                    "table_id": t.table_id,
                    "page_number": t.page_number,
                    "caption": t.caption,
                    "raw_text": t.raw_text,
                    "markdown": t.to_markdown(),
                    "num_rows": t.num_rows,
                    "num_cols": t.num_cols,
                }
                for t in node.tables
            ]
        if node.cross_references:
            d["cross_references"] = [
                {
                    "source_node_id": cr.source_node_id,
                    "target_identifier": cr.target_identifier,
                    "target_node_id": cr.target_node_id,
                    "resolved": cr.resolved,
                }
                for cr in node.cross_references
            ]
        if node.children:
            d["children"] = [self._node_to_dict(c) for c in node.children]
        return d

    @classmethod
    def from_dict(cls, data: dict) -> DocumentTree:
        """Reconstruct a DocumentTree from a serialized dict."""
        tree = cls(
            doc_id=data["doc_id"],
            doc_name=data["doc_name"],
            doc_description=data.get("doc_description", ""),
            total_pages=data.get("total_pages", 0),
        )
        tree.structure = [cls._node_from_dict(n) for n in data.get("structure", [])]
        tree.build_indexes()
        return tree

    @classmethod
    def _node_from_dict(cls, data: dict, parent_id: str = "") -> TreeNode:
        """Recursively deserialize a TreeNode."""
        node = TreeNode(
            node_id=data["node_id"],
            title=data["title"],
            node_type=NodeType(data.get("node_type", "section")),
            level=data.get("level", 0),
            start_page=data.get("start_page", 0),
            end_page=data.get("end_page", 0),
            text=data.get("text", ""),
            summary=data.get("summary", ""),
            description=data.get("description", ""),
            topics=data.get("topics", []),
            token_count=data.get("token_count", 0),
            parent_id=parent_id,
        )

        # Deserialize tables
        for t_data in data.get("tables", []):
            table = TableBlock(
                table_id=t_data["table_id"],
                page_number=t_data.get("page_number", 0),
                cells=[],  # Cells not persisted in full — use raw_text/markdown
                caption=t_data.get("caption", ""),
                raw_text=t_data.get("raw_text", ""),
                num_rows=t_data.get("num_rows", 0),
                num_cols=t_data.get("num_cols", 0),
            )
            node.tables.append(table)

        # Deserialize cross-references
        for cr_data in data.get("cross_references", []):
            cr = CrossReference(
                source_node_id=cr_data["source_node_id"],
                target_identifier=cr_data["target_identifier"],
                target_node_id=cr_data.get("target_node_id", ""),
                resolved=cr_data.get("resolved", False),
            )
            node.cross_references.append(cr)

        # Recursively deserialize children
        for child_data in data.get("children", []):
            child = cls._node_from_dict(child_data, parent_id=node.node_id)
            node.children.append(child)

        return node


def generate_doc_id(filename: str) -> str:
    """Generate a stable document ID from the filename."""
    h = hashlib.sha256(filename.encode()).hexdigest()[:12]
    return f"doc_{h}"
