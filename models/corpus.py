"""
Corpus data models for GOVINDA V2 — Cross-Document QA.

Represents the corpus graph: a collection of documents with
inter-document relationships (references, supersedes, amends, etc.)
used for cross-document retrieval and reasoning.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class RelationType(str, Enum):
    """Type of relationship between two documents."""

    REFERENCES = "references"  # Doc A cites/references Doc B
    SUPERSEDES = "supersedes"  # Doc A replaces Doc B
    AMENDS = "amends"  # Doc A modifies parts of Doc B
    SUPPLEMENTS = "supplements"  # Doc A adds to Doc B
    IMPLEMENTS = "implements"  # Doc A implements rules from Doc B
    RELATED_TO = "related_to"  # General topical overlap


@dataclass
class DocumentRelationship:
    """A directed relationship between two documents in the corpus."""

    source_doc_id: str  # Document that holds the reference
    target_doc_id: str  # Document being referenced
    relation_type: RelationType
    description: str = ""  # LLM-generated explanation of the relationship
    evidence: str = ""  # Text excerpt that established the relationship
    confidence: float = 0.8  # 0.0 - 1.0

    def to_dict(self) -> dict:
        return {
            "source_doc_id": self.source_doc_id,
            "target_doc_id": self.target_doc_id,
            "relation_type": self.relation_type.value,
            "description": self.description,
            "evidence": self.evidence,
            "confidence": self.confidence,
        }

    @classmethod
    def from_dict(cls, data: dict) -> DocumentRelationship:
        return cls(
            source_doc_id=data["source_doc_id"],
            target_doc_id=data["target_doc_id"],
            relation_type=RelationType(data["relation_type"]),
            description=data.get("description", ""),
            evidence=data.get("evidence", ""),
            confidence=data.get("confidence", 0.8),
        )


@dataclass
class CorpusDocument:
    """
    Lightweight summary of a single document for corpus-level reasoning.

    This is what the document-selection LLM sees — no full text,
    just metadata, description, aggregated topics, and key entities.
    """

    doc_id: str
    doc_name: str
    doc_description: str = ""
    total_pages: int = 0
    node_count: int = 0
    top_topics: list[str] = field(default_factory=list)
    key_entities: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "doc_description": self.doc_description,
            "total_pages": self.total_pages,
            "node_count": self.node_count,
            "top_topics": self.top_topics,
            "key_entities": self.key_entities,
        }

    @classmethod
    def from_dict(cls, data: dict) -> CorpusDocument:
        return cls(
            doc_id=data["doc_id"],
            doc_name=data["doc_name"],
            doc_description=data.get("doc_description", ""),
            total_pages=data.get("total_pages", 0),
            node_count=data.get("node_count", 0),
            top_topics=data.get("top_topics", []),
            key_entities=data.get("key_entities", []),
        )

    def to_index_entry(self) -> dict:
        """Lightweight entry for the document-selection LLM prompt."""
        entry = {
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "description": self.doc_description,
            "total_pages": self.total_pages,
            "node_count": self.node_count,
        }
        if self.top_topics:
            entry["top_topics"] = self.top_topics
        if self.key_entities:
            entry["key_entities"] = self.key_entities
        return entry


@dataclass
class Corpus:
    """
    The corpus graph — all documents and their inter-document relationships.

    Stored as a single document in MongoDB (upserted by corpus_id).
    """

    corpus_id: str = "default"
    documents: list[CorpusDocument] = field(default_factory=list)
    relationships: list[DocumentRelationship] = field(default_factory=list)
    last_updated: str = ""  # ISO timestamp

    # Flat lookup indexes (populated during load)
    _doc_index: dict[str, CorpusDocument] = field(default_factory=dict, repr=False)

    def build_index(self) -> None:
        """Build flat lookup by doc_id."""
        self._doc_index = {d.doc_id: d for d in self.documents}

    def get_document(self, doc_id: str) -> Optional[CorpusDocument]:
        """Look up a document by ID."""
        return self._doc_index.get(doc_id)

    def add_document(self, doc: CorpusDocument) -> None:
        """Add or update a document in the corpus."""
        existing = self._doc_index.get(doc.doc_id)
        if existing:
            # Update in-place
            idx = self.documents.index(existing)
            self.documents[idx] = doc
        else:
            self.documents.append(doc)
        self._doc_index[doc.doc_id] = doc

    def remove_document(self, doc_id: str) -> None:
        """Remove a document and all its relationships from the corpus."""
        self.documents = [d for d in self.documents if d.doc_id != doc_id]
        self.relationships = [
            r
            for r in self.relationships
            if r.source_doc_id != doc_id and r.target_doc_id != doc_id
        ]
        self._doc_index.pop(doc_id, None)

    def add_relationships(self, rels: list[DocumentRelationship]) -> None:
        """Add relationships, deduplicating by (source, target, type)."""
        existing_keys = {
            (r.source_doc_id, r.target_doc_id, r.relation_type)
            for r in self.relationships
        }
        for rel in rels:
            key = (rel.source_doc_id, rel.target_doc_id, rel.relation_type)
            if key not in existing_keys:
                self.relationships.append(rel)
                existing_keys.add(key)

    def get_relationships_for_doc(self, doc_id: str) -> list[DocumentRelationship]:
        """Get all relationships involving a document (as source or target)."""
        return [
            r
            for r in self.relationships
            if r.source_doc_id == doc_id or r.target_doc_id == doc_id
        ]

    def to_index(self) -> dict:
        """
        Export as a lightweight index for the document-selection LLM.
        This is what the LLM sees when deciding which documents to query.
        """
        return {
            "corpus_id": self.corpus_id,
            "document_count": len(self.documents),
            "documents": [d.to_index_entry() for d in self.documents],
            "relationships": [
                {
                    "source": r.source_doc_id,
                    "target": r.target_doc_id,
                    "type": r.relation_type.value,
                    "description": r.description,
                }
                for r in self.relationships
            ],
        }

    def to_dict(self) -> dict:
        """Full serialization for MongoDB persistence."""
        return {
            "corpus_id": self.corpus_id,
            "documents": [d.to_dict() for d in self.documents],
            "relationships": [r.to_dict() for r in self.relationships],
            "last_updated": self.last_updated,
        }

    @classmethod
    def from_dict(cls, data: dict) -> Corpus:
        corpus = cls(
            corpus_id=data.get("corpus_id", "default"),
            documents=[CorpusDocument.from_dict(d) for d in data.get("documents", [])],
            relationships=[
                DocumentRelationship.from_dict(r) for r in data.get("relationships", [])
            ],
            last_updated=data.get("last_updated", ""),
        )
        corpus.build_index()
        return corpus


# ---------------------------------------------------------------------------
# Extended query models for cross-document QA
# ---------------------------------------------------------------------------


@dataclass
class CorpusRetrievalResult:
    """
    Retrieval result spanning multiple documents.

    Groups retrieved sections by their source document so the
    synthesis prompt can attribute evidence correctly.
    """

    query_text: str
    query_type: str = "single_hop"
    sub_queries: list[str] = field(default_factory=list)
    key_terms: list[str] = field(default_factory=list)

    # Which documents were selected (with reasoning)
    selected_documents: list[dict] = field(default_factory=list)

    # Sections grouped by doc_id: { doc_id: [RetrievedSection, ...] }
    sections_by_doc: dict[str, list] = field(default_factory=dict)

    # Flat list of all sections (for synthesis)
    all_sections: list = field(default_factory=list)

    # Routing logs per document
    per_doc_routing_logs: dict[str, Any] = field(default_factory=dict)

    # Timing
    timings: dict[str, float] = field(default_factory=dict)
    start_time: float = 0.0
    llm_usage_snapshot: dict = field(default_factory=dict)
