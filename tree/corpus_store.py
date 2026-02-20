"""
Corpus Store for GOVINDA V2 — MongoDB persistence for the corpus graph.

Stores the single Corpus document (all documents + relationships)
in a 'corpus' MongoDB collection.
"""

from __future__ import annotations

import logging
from typing import Optional

from models.corpus import Corpus, CorpusDocument, DocumentRelationship
from utils.mongo import get_db

logger = logging.getLogger(__name__)

COLLECTION = "corpus"


class CorpusStore:
    """MongoDB CRUD for the corpus graph."""

    def __init__(self) -> None:
        self._collection = get_db()[COLLECTION]

    def save(self, corpus: Corpus) -> None:
        """Save or update the corpus (upsert by corpus_id)."""
        data = corpus.to_dict()
        self._collection.replace_one(
            {"_id": corpus.corpus_id},
            {**data, "_id": corpus.corpus_id},
            upsert=True,
        )
        logger.info(
            "Saved corpus: %d documents, %d relationships",
            len(corpus.documents),
            len(corpus.relationships),
        )

    def load(self, corpus_id: str = "default") -> Optional[Corpus]:
        """Load the corpus from MongoDB."""
        doc = self._collection.find_one({"_id": corpus_id})
        if not doc:
            return None
        # Remove Mongo's _id before deserialization
        doc.pop("_id", None)
        corpus = Corpus.from_dict(doc)
        logger.info(
            "Loaded corpus: %d documents, %d relationships",
            len(corpus.documents),
            len(corpus.relationships),
        )
        return corpus

    def load_or_create(self, corpus_id: str = "default") -> Corpus:
        """Load the corpus, or create a new empty one if it doesn't exist."""
        corpus = self.load(corpus_id)
        if corpus is None:
            corpus = Corpus(corpus_id=corpus_id)
            corpus.build_index()
            logger.info("Created new empty corpus: %s", corpus_id)
        return corpus

    def add_document(self, doc: CorpusDocument, corpus_id: str = "default") -> Corpus:
        """Add a document to the corpus (loads, updates, saves)."""
        corpus = self.load_or_create(corpus_id)
        corpus.add_document(doc)
        self.save(corpus)
        return corpus

    def remove_document(self, doc_id: str, corpus_id: str = "default") -> Corpus:
        """Remove a document and its relationships from the corpus."""
        corpus = self.load_or_create(corpus_id)
        corpus.remove_document(doc_id)
        self.save(corpus)
        logger.info("Removed document %s from corpus", doc_id)
        return corpus

    def add_relationships(
        self, rels: list[DocumentRelationship], corpus_id: str = "default"
    ) -> Corpus:
        """Add relationships to the corpus."""
        corpus = self.load_or_create(corpus_id)
        corpus.add_relationships(rels)
        self.save(corpus)
        return corpus
