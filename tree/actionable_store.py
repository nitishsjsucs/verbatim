"""
Actionable Store for GOVINDA V2 — MongoDB persistence for extracted actionables.

Stores one ActionablesResult document per doc_id in the 'actionables' collection.
"""

from __future__ import annotations

import logging
from typing import Optional

from models.actionable import ActionablesResult
from utils.mongo import get_db

logger = logging.getLogger(__name__)

COLLECTION = "actionables"


class ActionableStore:
    """MongoDB CRUD for actionable extraction results."""

    def __init__(self) -> None:
        self._collection = get_db()[COLLECTION]

    def save(self, result: ActionablesResult) -> None:
        """Save or update actionables for a document (upsert by doc_id)."""
        data = result.to_dict()
        self._collection.replace_one(
            {"_id": result.doc_id},
            {**data, "_id": result.doc_id},
            upsert=True,
        )
        logger.info(
            "Saved actionables for %s: %d items",
            result.doc_id,
            result.total_extracted,
        )

    def load(self, doc_id: str) -> Optional[ActionablesResult]:
        """Load actionables for a document."""
        doc = self._collection.find_one({"_id": doc_id})
        if not doc:
            return None
        doc.pop("_id", None)
        return ActionablesResult.from_dict(doc)

    def exists(self, doc_id: str) -> bool:
        """Check if actionables have been extracted for a document."""
        return self._collection.count_documents({"_id": doc_id}) > 0

    def delete(self, doc_id: str) -> None:
        """Delete actionables for a document."""
        self._collection.delete_one({"_id": doc_id})
        logger.info("Deleted actionables for %s", doc_id)
