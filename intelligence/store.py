"""MongoDB persistence for the Actionable Intelligence System."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from utils.mongo import get_db
from intelligence.models import IntelRun, IntelTeam

logger = logging.getLogger(__name__)

TEAMS_COLLECTION = "intel_teams"
RUNS_COLLECTION = "intel_runs"
EXTRACT_JOBS_COLLECTION = "intel_extract_jobs"


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

    def delete_all(self) -> int:
        """Wipe ALL intelligence runs (actionables + team mappings + tasks).

        Used by the admin reset endpoint to provide a clean slate without
        touching documents, document metadata, teams, or categories.
        """
        res = self._col.delete_many({})
        return res.deleted_count

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
            "team_specific_tasks",
            "priority",
            "deadline",
            "risk_score",
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


class IntelExtractJobStore:
    """Persistent store for long-running extraction jobs.

    Why this exists: long extractions (hours) must survive backend restarts
    and remain visible to clients. An in-memory dict loses everything on
    restart and offers no introspection from other processes.

    Schema (per doc_id):
        {
            "_id": "<doc_id>",
            "doc_id": "<doc_id>",
            "status": "running" | "done" | "error",
            "stage": "starting" | "extract" | "enrich" | "assign" | "save",
            "stage_progress": {"current": int, "total": int},
            "actionables_so_far": int,
            "started_at": ISO,
            "heartbeat_at": ISO,
            "finished_at": ISO,
            "error": str,
            "trace": str,
            "force": bool,
            "count": int,        # final actionables count when done
        }
    """

    def __init__(self) -> None:
        self._col = get_db()[EXTRACT_JOBS_COLLECTION]
        try:
            self._col.create_index("doc_id", unique=True)
            self._col.create_index("status")
            self._col.create_index("heartbeat_at")
        except Exception as e:
            logger.warning("intel_extract_jobs index init failed: %s", e)

    def get(self, doc_id: str) -> Optional[dict]:
        d = self._col.find_one({"_id": doc_id})
        if d:
            d.pop("_id", None)
        return d

    def upsert(self, doc_id: str, fields: dict) -> dict:
        """Atomically upsert job fields for `doc_id`, stamping heartbeat."""
        fields = dict(fields)
        fields["doc_id"] = doc_id
        fields["heartbeat_at"] = datetime.now(timezone.utc).isoformat()
        self._col.update_one(
            {"_id": doc_id},
            {"$set": fields},
            upsert=True,
        )
        return self.get(doc_id) or {}

    def heartbeat(self, doc_id: str, stage: Optional[str] = None,
                  stage_progress: Optional[dict] = None,
                  actionables_so_far: Optional[int] = None) -> None:
        """Update heartbeat (and optional progress) without overwriting status."""
        fields: dict = {"heartbeat_at": datetime.now(timezone.utc).isoformat()}
        if stage is not None:
            fields["stage"] = stage
        if stage_progress is not None:
            fields["stage_progress"] = stage_progress
        if actionables_so_far is not None:
            fields["actionables_so_far"] = actionables_so_far
        self._col.update_one({"_id": doc_id}, {"$set": fields}, upsert=True)

    def mark_done(self, doc_id: str, count: int) -> None:
        self.upsert(doc_id, {
            "status": "done",
            "count": count,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        })

    def mark_error(self, doc_id: str, error: str, trace: str = "") -> None:
        self.upsert(doc_id, {
            "status": "error",
            "error": error,
            "trace": trace,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        })

    def claim(self, doc_id: str, force: bool) -> tuple[bool, Optional[dict]]:
        """Atomic compare-and-set: only start a new job if no job is running.

        Returns (claimed, current_job_or_None).
        - claimed=True   → caller now owns the job slot; existing entry replaced.
        - claimed=False  → another worker already running; current_job is the live one.
        """
        now = datetime.now(timezone.utc).isoformat()
        running = self._col.find_one({"_id": doc_id, "status": "running"})
        if running:
            running.pop("_id", None)
            return False, running

        self._col.update_one(
            {"_id": doc_id},
            {"$set": {
                "doc_id": doc_id,
                "status": "running",
                "stage": "starting",
                "stage_progress": {"current": 0, "total": 0},
                "actionables_so_far": 0,
                "force": force,
                "started_at": now,
                "heartbeat_at": now,
                "error": "",
                "trace": "",
                "finished_at": "",
                "count": 0,
            }},
            upsert=True,
        )
        return True, None

    def release_stale(self, max_silence_seconds: int = 1800) -> int:
        """Mark jobs as errored if they have not heartbeated in > max_silence_seconds.

        Called on backend startup and periodically to clean up jobs whose
        worker thread died (e.g. backend restart, OOM kill). The job itself
        cannot resume from the in-memory state, but the registry is corrected
        so the user sees an error rather than a permanently "running" badge.
        """
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=max_silence_seconds)).isoformat()
        res = self._col.update_many(
            {"status": "running", "heartbeat_at": {"$lt": cutoff}},
            {"$set": {
                "status": "error",
                "error": (
                    "Worker stopped reporting (likely a backend restart). "
                    "Re-run the extraction to continue."
                ),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return res.modified_count
