"""
Relationship Detector for GOVINDA V2 — Cross-Document Link Discovery.

After a new document is ingested, compares it against all existing
documents in the corpus to discover inter-document relationships
(references, supersedes, amends, supplements, implements, related).
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.corpus import (
    Corpus,
    CorpusDocument,
    DocumentRelationship,
    RelationType,
)
from models.document import DocumentTree
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class RelationshipDetector:
    """Discover relationships between a newly ingested document and the corpus."""

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()

    def detect_relationships(
        self,
        new_tree: DocumentTree,
        corpus: Corpus,
    ) -> list[DocumentRelationship]:
        """
        Detect relationships between a new document and all existing documents.

        Args:
            new_tree: The newly ingested document tree.
            corpus: The current corpus (containing existing documents).

        Returns:
            List of discovered DocumentRelationship objects.
        """
        existing_docs = [d for d in corpus.documents if d.doc_id != new_tree.doc_id]

        if not existing_docs:
            logger.info(
                "No existing documents in corpus — skipping relationship detection"
            )
            return []

        logger.info(
            "Detecting relationships between '%s' and %d existing documents...",
            new_tree.doc_name,
            len(existing_docs),
        )

        # Build the new document's corpus entry for the prompt
        new_entry = new_tree.to_corpus_entry()

        # Format existing docs for the prompt
        existing_docs_data = []
        for doc in existing_docs:
            existing_docs_data.append(
                {
                    "doc_id": doc.doc_id,
                    "doc_name": doc.doc_name,
                    "description": doc.doc_description,
                    "total_pages": doc.total_pages,
                    "top_topics": doc.top_topics[:15],
                    "key_entities": doc.key_entities[:10],
                }
            )

        existing_docs_json = json.dumps(existing_docs_data, indent=2)

        # Load and format the prompt
        prompt_data = load_prompt("corpus", "relationship_detection")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        user_msg = format_prompt(
            user_template,
            new_doc_id=new_entry.doc_id,
            new_doc_name=new_entry.doc_name,
            new_doc_description=new_entry.doc_description or "No description available",
            new_doc_pages=new_entry.total_pages,
            new_doc_topics=", ".join(new_entry.top_topics[:20]) or "None",
            existing_docs_json=existing_docs_json,
        )

        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model,
                max_tokens=self._settings.llm.max_tokens_default,
                reasoning_effort="medium",
            )

            relationships = self._parse_relationships(
                result, new_tree.doc_id, existing_docs
            )

            logger.info(
                "Detected %d relationships for '%s'",
                len(relationships),
                new_tree.doc_name,
            )
            for rel in relationships:
                logger.info(
                    "  -> %s -[%s]-> %s (%.2f): %s",
                    rel.source_doc_id,
                    rel.relation_type.value,
                    rel.target_doc_id,
                    rel.confidence,
                    rel.description[:80],
                )

            return relationships

        except Exception as e:
            logger.error("Relationship detection failed: %s", str(e))
            return []

    def _parse_relationships(
        self,
        result: dict,
        new_doc_id: str,
        existing_docs: list[CorpusDocument],
    ) -> list[DocumentRelationship]:
        """Parse LLM result into DocumentRelationship objects."""
        relationships = []
        valid_doc_ids = {d.doc_id for d in existing_docs}
        valid_types = {rt.value for rt in RelationType}

        for r in result.get("relationships", []):
            target_doc_id = r.get("target_doc_id", "")
            relation_type_str = r.get("relation_type", "")

            # Validate target doc exists
            if target_doc_id not in valid_doc_ids:
                logger.warning(
                    "Skipping relationship to unknown doc: %s", target_doc_id
                )
                continue

            # Validate relation type
            if relation_type_str not in valid_types:
                logger.warning("Skipping unknown relation type: %s", relation_type_str)
                continue

            confidence = r.get("confidence", 0.8)
            if isinstance(confidence, str):
                try:
                    confidence = float(confidence)
                except ValueError:
                    confidence = 0.8

            relationships.append(
                DocumentRelationship(
                    source_doc_id=new_doc_id,
                    target_doc_id=target_doc_id,
                    relation_type=RelationType(relation_type_str),
                    description=r.get("description", ""),
                    evidence=r.get("evidence", ""),
                    confidence=min(max(confidence, 0.0), 1.0),
                )
            )

        return relationships
