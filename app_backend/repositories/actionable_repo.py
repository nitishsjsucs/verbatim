"""
Flat Actionable Repository — one MongoDB document per actionable item.

Replaces the embedded model (all items nested inside a parent document) with
a flat collection where each actionable is its own document, enabling:
  - Per-item indexes and queries
  - Server-side pagination, filtering, sorting
  - Atomic per-item updates (no document-level race conditions)
  - No 16MB document size limit concern

Collection: actionables_flat
Primary key: _id = "{doc_id}__{item_id}" (compound string)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from utils.mongo import get_db
from app_backend.constants import Collection

logger = logging.getLogger(__name__)

COLLECTION_NAME = Collection.ACTIONABLES_FLAT


class ActionableFlatRepo:
    """MongoDB CRUD for flat (one-doc-per-item) actionable storage."""

    def __init__(self, db=None):
        self._db = db or get_db()
        self._col = self._db[COLLECTION_NAME]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def make_id(doc_id: str, item_id: str) -> str:
        """Build the compound _id from doc_id + item_id."""
        return f"{doc_id}__{item_id}"

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Single-item operations
    # ------------------------------------------------------------------

    def find_one(self, doc_id: str, item_id: str) -> Optional[dict]:
        """Fetch a single actionable by doc_id + item_id."""
        doc = self._col.find_one({"_id": self.make_id(doc_id, item_id)})
        if doc:
            doc["_flat_id"] = doc.pop("_id")
        return doc

    def upsert_one(self, doc_id: str, item_id: str, data: dict) -> None:
        """Insert or fully replace a single actionable document."""
        flat_id = self.make_id(doc_id, item_id)
        data_copy = {**data}
        data_copy["_id"] = flat_id
        data_copy["doc_id"] = doc_id
        data_copy["item_id"] = item_id
        data_copy.setdefault("updated_at", self._now_iso())
        self._col.replace_one({"_id": flat_id}, data_copy, upsert=True)

    def update_fields(self, doc_id: str, item_id: str, updates: dict) -> Optional[dict]:
        """Atomically update specific fields on a single actionable.

        Returns the updated document, or None if not found.
        """
        updates["updated_at"] = self._now_iso()
        result = self._col.find_one_and_update(
            {"_id": self.make_id(doc_id, item_id)},
            {"$set": updates},
            return_document=True,  # pymongo.ReturnDocument.AFTER
        )
        if result:
            result["_flat_id"] = result.pop("_id")
        return result

    def delete_one(self, doc_id: str, item_id: str) -> bool:
        """Delete a single actionable. Returns True if deleted."""
        result = self._col.delete_one({"_id": self.make_id(doc_id, item_id)})
        return result.deleted_count > 0

    # ------------------------------------------------------------------
    # Document-level operations (all items for a source doc)
    # ------------------------------------------------------------------

    def find_by_doc(self, doc_id: str) -> list[dict]:
        """Return all actionable items belonging to a source document."""
        docs = list(self._col.find({"doc_id": doc_id}))
        for d in docs:
            d["_flat_id"] = d.pop("_id")
        return docs

    def count_by_doc(self, doc_id: str) -> int:
        return self._col.count_documents({"doc_id": doc_id})

    def delete_by_doc(self, doc_id: str) -> int:
        """Delete all actionables for a document. Returns count deleted."""
        result = self._col.delete_many({"doc_id": doc_id})
        return result.deleted_count

    # ------------------------------------------------------------------
    # Bulk / paginated queries
    # ------------------------------------------------------------------

    def find_all(
        self,
        filters: Optional[dict] = None,
        skip: int = 0,
        limit: int = 0,
        sort: Optional[list[tuple[str, int]]] = None,
    ) -> tuple[list[dict], int]:
        """Paginated query with optional filters and sorting.

        Returns (items, total_count).
        """
        query = filters or {}
        total = self._col.count_documents(query)
        cursor = self._col.find(query)
        if sort:
            cursor = cursor.sort(sort)
        if skip:
            cursor = cursor.skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        items = list(cursor)
        for d in items:
            d["_flat_id"] = d.pop("_id")
        return items, total

    def find_paginated(
        self,
        page: int = 1,
        page_size: int = 50,
        status: Optional[str] = None,
        approval: Optional[str] = None,
        team: Optional[str] = None,
        delayed: Optional[bool] = None,
        search: Optional[str] = None,
        sort_field: str = "created_at",
        sort_order: int = -1,
    ) -> dict:
        """High-level paginated query builder for the API layer.

        Returns: { items, total, page, page_size, pages }
        """
        query: dict[str, Any] = {}

        if status:
            query["task_status"] = status
        if approval:
            query["approval_status"] = approval
        if team:
            query["$or"] = [
                {"workstream": team},
                {"assigned_teams": team},
            ]
        if delayed is not None:
            query["is_delayed"] = delayed
        if search:
            query["$text"] = {"$search": search}

        total = self._col.count_documents(query)
        pages = max(1, (total + page_size - 1) // page_size)
        skip = (max(1, page) - 1) * page_size

        cursor = self._col.find(query)
        cursor = cursor.sort(sort_field, sort_order)
        cursor = cursor.skip(skip).limit(page_size)

        items = list(cursor)
        for d in items:
            d["_flat_id"] = d.pop("_id")

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": pages,
        }

    # ------------------------------------------------------------------
    # Aggregation helpers
    # ------------------------------------------------------------------

    def count_by_status(self) -> dict[str, int]:
        """Return counts grouped by task_status."""
        pipeline = [
            {"$group": {"_id": "$task_status", "count": {"$sum": 1}}},
        ]
        return {doc["_id"]: doc["count"] for doc in self._col.aggregate(pipeline)}

    def count_by_team(self) -> dict[str, int]:
        """Return counts grouped by workstream."""
        pipeline = [
            {"$group": {"_id": "$workstream", "count": {"$sum": 1}}},
        ]
        return {doc["_id"]: doc["count"] for doc in self._col.aggregate(pipeline)}

    # ------------------------------------------------------------------
    # Bulk write (for migration / sync)
    # ------------------------------------------------------------------

    def bulk_upsert(self, items: list[dict]) -> int:
        """Bulk upsert a list of flat actionable documents.

        Each item must have 'doc_id' and 'item_id' keys.
        Returns the number of upserted/modified documents.
        """
        if not items:
            return 0

        from pymongo import UpdateOne

        ops = []
        now = self._now_iso()
        for item in items:
            flat_id = self.make_id(item["doc_id"], item["item_id"])
            item_copy = {**item, "_id": flat_id, "updated_at": now}
            ops.append(
                UpdateOne(
                    {"_id": flat_id},
                    {"$set": item_copy},
                    upsert=True,
                )
            )

        result = self._col.bulk_write(ops, ordered=False)
        return result.upserted_count + result.modified_count

    # ------------------------------------------------------------------
    # Index management
    # ------------------------------------------------------------------

    def ensure_indexes(self) -> None:
        """Create all required indexes for the flat collection."""
        # Primary lookup patterns
        self._col.create_index("doc_id")
        self._col.create_index("item_id")

        # Filtering patterns
        self._col.create_index("task_status")
        self._col.create_index("approval_status")
        self._col.create_index("workstream")
        self._col.create_index("is_delayed")
        self._col.create_index("deadline")
        self._col.create_index("assigned_teams")

        # Compound indexes for common query patterns
        self._col.create_index([("approval_status", 1), ("workstream", 1)])
        self._col.create_index([("task_status", 1), ("is_delayed", 1)])
        self._col.create_index([("task_status", 1), ("deadline", 1)])
        self._col.create_index([("doc_id", 1), ("item_id", 1)], unique=True)

        # Text search index
        try:
            self._col.create_index(
                [
                    ("actor", "text"),
                    ("action", "text"),
                    ("object", "text"),
                    ("actionable_id", "text"),
                    ("implementation_notes", "text"),
                ],
                name="actionable_text_search",
            )
        except Exception:
            # Text index may already exist with different definition — skip
            logger.warning("Text index creation skipped (may already exist)")

        logger.info("Flat actionable indexes ensured on %s", COLLECTION_NAME)
