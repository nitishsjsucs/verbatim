"""
Additionals System — allows admin to append additional actionables to
existing documents without modifying the original extraction.

Collection: intel_additionals
Each entry is linked to a doc_id and contains independently-dated actionables.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

from utils.mongo import get_db

logger = logging.getLogger(__name__)

COLLECTION = "intel_additionals"


@dataclass
class AdditionalEntry:
    """A single 'additional' appended to a document."""
    entry_id: str = field(default_factory=lambda: f"ADD-{uuid.uuid4().hex[:8].upper()}")
    doc_id: str = ""
    title: str = ""
    date: str = ""  # when this additional was issued/effective
    description: str = ""
    notes: str = ""
    actionables: list[dict] = field(default_factory=list)  # same shape as enriched actionables
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    created_by: str = ""  # admin account_id

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> AdditionalEntry:
        if not d:
            return cls()
        return cls(
            entry_id=d.get("entry_id", ""),
            doc_id=d.get("doc_id", ""),
            title=d.get("title", ""),
            date=d.get("date", ""),
            description=d.get("description", ""),
            notes=d.get("notes", ""),
            actionables=d.get("actionables") or [],
            created_at=d.get("created_at", ""),
            created_by=d.get("created_by", ""),
        )


class AdditionalsStore:
    """CRUD for document additionals."""

    def __init__(self) -> None:
        self._col = get_db()[COLLECTION]
        try:
            self._col.create_index("entry_id", unique=True)
            self._col.create_index("doc_id")
        except Exception as e:
            logger.warning("intel_additionals index init failed: %s", e)

    def list_for_doc(self, doc_id: str) -> list[AdditionalEntry]:
        cursor = self._col.find({"doc_id": doc_id}).sort("created_at", 1)
        return [AdditionalEntry.from_dict(d) for d in cursor]

    def get(self, entry_id: str) -> Optional[AdditionalEntry]:
        d = self._col.find_one({"entry_id": entry_id})
        return AdditionalEntry.from_dict(d) if d else None

    def create(self, entry: AdditionalEntry) -> AdditionalEntry:
        doc = entry.to_dict()
        doc["_id"] = entry.entry_id
        self._col.insert_one(doc)
        return entry

    def update(self, entry_id: str, fields: dict) -> Optional[AdditionalEntry]:
        allowed = {"title", "date", "description", "notes", "actionables"}
        patch = {k: v for k, v in fields.items() if k in allowed}
        if not patch:
            return self.get(entry_id)
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._col.update_one({"entry_id": entry_id}, {"$set": patch})
        return self.get(entry_id)

    def delete(self, entry_id: str) -> bool:
        res = self._col.delete_one({"entry_id": entry_id})
        return res.deleted_count > 0
