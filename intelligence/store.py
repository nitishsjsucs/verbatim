"""MongoDB persistence for the Actionable Intelligence System."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from utils.mongo import get_db
from intelligence.models import IntelCategory, IntelRun, IntelTeam

logger = logging.getLogger(__name__)

TEAMS_COLLECTION = "intel_teams"
RUNS_COLLECTION = "intel_runs"
CATEGORIES_COLLECTION = "intel_categories"


class IntelTeamStore:
    """CRUD for AIS teams, stored in a dedicated collection to avoid collisions
    with any existing `teams` collection the app may use."""

    def __init__(self) -> None:
        self._col = get_db()[TEAMS_COLLECTION]
        try:
            self._col.create_index("team_id", unique=True)
            self._col.create_index("name")
        except Exception as e:  # non-fatal
            logger.warning("intel_teams index init failed: %s", e)

    def list(self) -> list[IntelTeam]:
        cursor = self._col.find({}).sort("name", 1)
        return [IntelTeam.from_dict(d) for d in cursor]

    def get(self, team_id: str) -> Optional[IntelTeam]:
        d = self._col.find_one({"team_id": team_id})
        return IntelTeam.from_dict(d) if d else None

    def create(self, team: IntelTeam) -> IntelTeam:
        doc = team.to_dict()
        doc["_id"] = team.team_id
        self._col.insert_one(doc)
        return team

    def update(self, team_id: str, patch: dict) -> Optional[IntelTeam]:
        patch = {k: v for k, v in patch.items() if k in {"name", "function", "department"}}
        if not patch:
            return self.get(team_id)
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._col.update_one({"team_id": team_id}, {"$set": patch})
        return self.get(team_id)

    def delete(self, team_id: str) -> bool:
        res = self._col.delete_one({"team_id": team_id})
        return res.deleted_count > 0


class IntelCategoryStore:
    """CRUD for AIS categories (Section 4 of the spec).

    Categories are user-defined classifications used by the enricher to
    classify each actionable. Stored separately from `intel_teams`.
    """

    def __init__(self) -> None:
        self._col = get_db()[CATEGORIES_COLLECTION]
        try:
            self._col.create_index("category_id", unique=True)
            self._col.create_index("name")
        except Exception as e:  # non-fatal
            logger.warning("intel_categories index init failed: %s", e)

    def list(self) -> list[IntelCategory]:
        cursor = self._col.find({}).sort("name", 1)
        return [IntelCategory.from_dict(d) for d in cursor]

    def get(self, category_id: str) -> Optional[IntelCategory]:
        d = self._col.find_one({"category_id": category_id})
        return IntelCategory.from_dict(d) if d else None

    def create(self, category: IntelCategory) -> IntelCategory:
        doc = category.to_dict()
        doc["_id"] = category.category_id
        self._col.insert_one(doc)
        return category

    def update(self, category_id: str, patch: dict) -> Optional[IntelCategory]:
        patch = {k: v for k, v in patch.items() if k in {"name", "description"}}
        if not patch:
            return self.get(category_id)
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._col.update_one({"category_id": category_id}, {"$set": patch})
        return self.get(category_id)

    def delete(self, category_id: str) -> bool:
        res = self._col.delete_one({"category_id": category_id})
        return res.deleted_count > 0


class IntelRunStore:
    """Stores one enrichment run per doc_id (upsert semantics)."""

    def __init__(self) -> None:
        self._col = get_db()[RUNS_COLLECTION]
        try:
            self._col.create_index("doc_id", unique=True)
        except Exception as e:
            logger.warning("intel_runs index init failed: %s", e)

    def save(self, run: IntelRun) -> IntelRun:
        now = datetime.now(timezone.utc).isoformat()
        if not run.created_at:
            run.created_at = now
        run.updated_at = now
        doc = run.to_dict()
        doc["_id"] = run.doc_id
        self._col.replace_one({"_id": run.doc_id}, doc, upsert=True)
        return run

    def get(self, doc_id: str) -> Optional[IntelRun]:
        d = self._col.find_one({"_id": doc_id})
        return IntelRun.from_dict(d) if d else None

    def delete(self, doc_id: str) -> bool:
        res = self._col.delete_one({"_id": doc_id})
        return res.deleted_count > 0

    def list_summaries(self) -> list[dict]:
        """Compact per-doc summaries for cross-document dashboards."""
        out: list[dict] = []
        for d in self._col.find({}, {
            "doc_id": 1,
            "doc_name": 1,
            "stats": 1,
            "updated_at": 1,
            "actionables": 1,
            "notice_board": 1,
        }):
            out.append({
                "doc_id": d.get("doc_id") or d.get("_id"),
                "doc_name": d.get("doc_name", ""),
                "updated_at": d.get("updated_at", ""),
                "stats": d.get("stats", {}),
                "actionable_count": len(d.get("actionables", []) or []),
                "notice_count": len(d.get("notice_board", []) or []),
            })
        return out

    def update_actionable(self, doc_id: str, item_id: str, patch: dict) -> Optional[dict]:
        """Patch a single enriched actionable by id. Returns the updated item or None."""
        allowed = {
            "assigned_teams",
            "assigned_team_names",
            "priority",
            "deadline",
            "deadline_reasoning",
            "risk_score",
            "category",
            "notes",
            "description",
        }
        set_patch = {
            f"actionables.$[a].{k}": v for k, v in patch.items() if k in allowed
        }
        if not set_patch:
            return None
        set_patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        res = self._col.update_one(
            {"_id": doc_id},
            {"$set": set_patch},
            array_filters=[{"a.id": item_id}],
        )
        if res.matched_count == 0:
            return None
        run = self.get(doc_id)
        if not run:
            return None
        for a in run.actionables:
            if a.id == item_id:
                return a.to_dict()
        return None
