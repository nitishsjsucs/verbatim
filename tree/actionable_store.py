"""
Actionable Store for GOVINDA V2 — MongoDB persistence for extracted actionables.

Stores one ActionablesResult document per doc_id in the 'actionables' collection.
Dual-writes to the flat 'actionables_flat' collection for Phase 2 migration.
"""

from __future__ import annotations

import logging
from typing import Optional

from models.actionable import ActionablesResult
from utils.mongo import get_db

logger = logging.getLogger(__name__)

COLLECTION = "actionables"

# Feature flag — set to False to disable flat dual-write if issues arise
_DUAL_WRITE_ENABLED = True


class ActionableStore:
    """MongoDB CRUD for actionable extraction results."""

    def __init__(self) -> None:
        self._collection = get_db()[COLLECTION]

    def save(self, result: ActionablesResult) -> None:
        """Save or update actionables for a document (upsert by doc_id).

        Also dual-writes each actionable item to the flat collection.
        """
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
        # Dual-write to flat collection
        if _DUAL_WRITE_ENABLED:
            self._sync_flat(result)

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
        """Delete actionables for a document (both embedded and flat)."""
        self._collection.delete_one({"_id": doc_id})
        if _DUAL_WRITE_ENABLED:
            try:
                from app_backend.repositories.actionable_repo import ActionableFlatRepo
                flat = ActionableFlatRepo(db=get_db())
                deleted = flat.delete_by_doc(doc_id)
                logger.info("Deleted %d flat actionables for %s", deleted, doc_id)
            except Exception as e:
                logger.warning("Flat delete failed for %s: %s", doc_id, e)
        logger.info("Deleted actionables for %s", doc_id)

    # ------------------------------------------------------------------
    # Flat collection sync
    # ------------------------------------------------------------------

    def _sync_flat(self, result: ActionablesResult) -> None:
        """Sync all actionable items from an ActionablesResult to the flat collection."""
        try:
            from app_backend.repositories.actionable_repo import ActionableFlatRepo
            flat = ActionableFlatRepo(db=get_db())

            parent_meta = {
                "doc_name": result.doc_name,
                "regulation_issue_date": result.regulation_issue_date,
                "circular_effective_date": result.circular_effective_date,
                "regulator": result.regulator,
            }

            items_to_upsert = []
            for a in result.actionables:
                item_dict = a.to_dict()
                item_dict["doc_id"] = result.doc_id
                item_dict["item_id"] = a.id
                # Merge parent metadata
                for k, v in parent_meta.items():
                    item_dict.setdefault(k, v)
                items_to_upsert.append(item_dict)

            if items_to_upsert:
                count = flat.bulk_upsert(items_to_upsert)
                logger.debug("Flat sync for %s: %d items synced", result.doc_id, count)

            # Remove flat items that no longer exist in embedded doc
            embedded_ids = {a.id for a in result.actionables}
            existing_flat = flat.find_by_doc(result.doc_id)
            for fd in existing_flat:
                if fd.get("item_id") not in embedded_ids:
                    flat.delete_one(result.doc_id, fd["item_id"])
                    logger.debug("Removed orphan flat item %s__%s", result.doc_id, fd["item_id"])

        except Exception as e:
            logger.warning("Flat sync failed for %s: %s", result.doc_id, e)
