"""
FastAPI router for the Actionable Intelligence System.

Mounted under the prefix `/intelligence/*` in `app_backend.main`. All endpoints
here are additive — they do not modify or replace any existing endpoint.

Reuses (does not duplicate):
  * `ingestion.pipeline.IngestionPipeline` for PDF ingestion
  * `tree.tree_store.TreeStore` for document listing / tree loading
  * `agents.actionable_extractor.ActionableExtractor` for raw extraction
"""

from __future__ import annotations

import csv
import io
import logging
import shutil
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from config.settings import get_settings
from tree.tree_store import TreeStore
from ingestion.pipeline import IngestionPipeline
from agents.actionable_extractor import ActionableExtractor

from intelligence.models import (
    IntelRun,
    IntelTeam,
    NoticeItem,
)
from intelligence.store import IntelExtractJobStore, IntelRunStore, IntelTeamStore
from intelligence.enrichment_service import IntelligenceEnricher
from intelligence.assignment_service import IntelligenceAssigner
from intelligence.grouping_service import build_groupings, compute_stats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/intelligence", tags=["intelligence"])


# ---------------------------------------------------------------------------
# Lazy singletons — created on first use so import of this module is side-
# effect-free (safe to import from main.py at module load time).
# ---------------------------------------------------------------------------
_tree_store: Optional[TreeStore] = None
_ingest: Optional[IngestionPipeline] = None
_extractor: Optional[ActionableExtractor] = None
_enricher: Optional[IntelligenceEnricher] = None
_assigner: Optional[IntelligenceAssigner] = None
_run_store: Optional[IntelRunStore] = None
_team_store: Optional[IntelTeamStore] = None
_jobs_store: Optional[IntelExtractJobStore] = None


def _ts() -> TreeStore:
    global _tree_store
    if _tree_store is None:
        _tree_store = TreeStore()
    return _tree_store


def _ip() -> IngestionPipeline:
    global _ingest
    if _ingest is None:
        _ingest = IngestionPipeline()
    return _ingest


def _ex() -> ActionableExtractor:
    global _extractor
    if _extractor is None:
        _extractor = ActionableExtractor()
    return _extractor


def _en() -> IntelligenceEnricher:
    global _enricher
    if _enricher is None:
        _enricher = IntelligenceEnricher()
    return _enricher


def _asg() -> IntelligenceAssigner:
    global _assigner
    if _assigner is None:
        _assigner = IntelligenceAssigner()
    return _assigner


def _runs() -> IntelRunStore:
    global _run_store
    if _run_store is None:
        _run_store = IntelRunStore()
    return _run_store


def _teams() -> IntelTeamStore:
    global _team_store
    if _team_store is None:
        _team_store = IntelTeamStore()
    return _team_store


def _jobs() -> IntelExtractJobStore:
    """Persistent extraction-job registry (MongoDB-backed).

    Survives backend restarts and lets multiple workers/processes coordinate
    on whether a doc is already being extracted.
    """
    global _jobs_store
    if _jobs_store is None:
        _jobs_store = IntelExtractJobStore()
        # Best-effort: clean up any "running" jobs whose worker died.
        # Threshold = 30 min of silence → mark as errored.
        try:
            stale = _jobs_store.release_stale(max_silence_seconds=1800)
            if stale:
                logger.warning(
                    "[intelligence] released %d stale extraction job(s) on init",
                    stale,
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("Stale-job sweep failed (non-fatal): %s", e)
    return _jobs_store



# ---------------------------------------------------------------------------
# Pydantic request bodies
# ---------------------------------------------------------------------------
class TeamIn(BaseModel):
    name: str = Field(..., min_length=1)
    function: str = Field(..., min_length=1)
    department: Optional[str] = None


class TeamPatch(BaseModel):
    name: Optional[str] = None
    function: Optional[str] = None
    department: Optional[str] = None


class TeamTaskAssignmentIn(BaseModel):
    team_id: str
    team_name: str
    team_specific_task: str = ""


class ActionablePatch(BaseModel):
    assigned_teams: Optional[list[str]] = None
    team_specific_tasks: Optional[list[TeamTaskAssignmentIn]] = None
    priority: Optional[str] = None
    deadline: Optional[str] = None
    risk_score: Optional[int] = None
    notes: Optional[str] = None
    description: Optional[str] = None


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@router.get("/health")
def health():
    return {"status": "ok", "module": "intelligence"}


# ---------------------------------------------------------------------------
# Documents (thin proxy over existing TreeStore — no duplication)
# ---------------------------------------------------------------------------
@router.get("/documents")
def list_documents():
    """List all documents with an AIS-run indicator + document metadata."""
    from tree.actionable_store import ActionableStore  # local import to avoid cycles

    docs = _ts().list_documents_summary()
    summaries = _runs().list_summaries()
    run_ids = {s["doc_id"] for s in summaries}
    actionable_counts = {s["doc_id"]: s.get("actionable_count", 0) for s in summaries}

    # Batch-load document-level metadata from the actionables collection
    astore = ActionableStore()
    for d in docs:
        doc_id = d.get("id")
        d["has_intel_run"] = doc_id in run_ids
        d["has_actionables"] = actionable_counts.get(doc_id, 0) > 0
        # Attach document metadata (effective date, issue date, regulator, etc.)
        try:
            ar = astore.load(doc_id)
            if ar is not None:
                d["circular_effective_date"] = getattr(ar, "circular_effective_date", "") or ""
                d["regulation_issue_date"] = getattr(ar, "regulation_issue_date", "") or ""
                d["regulator"] = getattr(ar, "regulator", "") or ""
                d["circular_id"] = getattr(ar, "circular_id", "") or ""
                d["circular_title"] = getattr(ar, "circular_title", "") or ""
                d["created_at"] = getattr(ar, "created_at", "") or ""
            else:
                # Fallback: check tree store for dates (for documents without actionable roots)
                tree_doc = _ts()._collection.find_one({"_id": doc_id})
                d["circular_effective_date"] = tree_doc.get("circular_effective_date", "") if tree_doc else ""
                d["regulation_issue_date"] = tree_doc.get("regulation_issue_date", "") if tree_doc else ""
                d["regulator"] = tree_doc.get("regulator", "") if tree_doc else ""
                d["circular_id"] = tree_doc.get("circular_id", "") if tree_doc else ""
                d["circular_title"] = tree_doc.get("circular_title", "") if tree_doc else ""
                d["created_at"] = tree_doc.get("created_at", "") if tree_doc else ""
        except Exception:
            d["circular_effective_date"] = ""
            d["regulation_issue_date"] = ""
            d["regulator"] = ""
            d["circular_id"] = ""
            d["circular_title"] = ""
            d["created_at"] = ""
    return docs


@router.post("/ingest")
async def ingest_document(file: UploadFile = File(...), force: bool = Query(False)):
    """Upload and ingest a PDF via the existing pipeline (no duplication)."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    settings = get_settings()
    pdfs_dir = settings.storage.trees_dir.parent / "pdfs"
    pdfs_dir.mkdir(parents=True, exist_ok=True)
    dest = pdfs_dir / file.filename
    try:
        with dest.open("wb") as buf:
            shutil.copyfileobj(file.file, buf)
    finally:
        file.file.close()

    try:
        start = time.time()
        tree = _ip().ingest(str(dest), force=force)
        return {
            "doc_id": tree.doc_id,
            "doc_name": tree.doc_name,
            "node_count": tree.node_count,
            "total_pages": tree.total_pages,
            "time_seconds": time.time() - start,
        }
    except Exception as e:
        logger.exception("AIS ingest failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Teams CRUD
# ---------------------------------------------------------------------------
@router.get("/teams")
def list_teams():
    return [t.to_dict() for t in _teams().list()]


@router.post("/teams", status_code=201)
def create_team(body: TeamIn):
    team = IntelTeam.new(body.name, body.function, body.department)
    _teams().create(team)
    return team.to_dict()


@router.patch("/teams/{team_id}")
def update_team(team_id: str, body: TeamPatch):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    team = _teams().update(team_id, patch)
    if not team:
        raise HTTPException(404, "Team not found")
    return team.to_dict()


@router.delete("/teams/{team_id}")
def delete_team(team_id: str):
    ok = _teams().delete(team_id)
    if not ok:
        raise HTTPException(404, "Team not found")
    return {"status": "deleted", "team_id": team_id}


# ---------------------------------------------------------------------------
# Bulk import endpoints (CSV → structured data)
# All imports are atomic: the file is fully validated before any write.
# ---------------------------------------------------------------------------

_TEAMS_IMPORT_COLUMNS = {"name", "function", "department"}
_TEAMS_IMPORT_REQUIRED = {"name", "function"}

_ACTIONABLES_IMPORT_REQUIRED = {"id", "description", "priority", "deadline",
                                 "risk_score"}


def _parse_csv_upload(file: UploadFile, required_cols: set[str], all_cols: set[str]) -> list[dict]:
    """Read an uploaded CSV, validate columns, return list of row dicts.

    Raises HTTP 422 with a descriptive message if:
      * file is empty
      * required columns are missing
      * any row has an unexpected column structure
    All rows are parsed before any data is written (atomic validation).
    """
    raw = file.file.read()
    if not raw:
        raise HTTPException(422, "Uploaded file is empty")
    try:
        text = raw.decode("utf-8-sig")  # strip BOM if present
    except UnicodeDecodeError:
        raise HTTPException(422, "File must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(422, "CSV has no header row")

    actual_cols = {c.strip().lower() for c in reader.fieldnames}
    missing = required_cols - actual_cols
    if missing:
        raise HTTPException(
            422,
            f"CSV is missing required column(s): {', '.join(sorted(missing))}. "
            f"Required: {', '.join(sorted(required_cols))}.",
        )

    rows = []
    for i, row in enumerate(reader, start=2):
        normalised = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
        for col in required_cols:
            if not normalised.get(col):
                raise HTTPException(
                    422,
                    f"Row {i}: required column '{col}' is empty.",
                )
        rows.append(normalised)

    if not rows:
        raise HTTPException(422, "CSV contains no data rows (only a header).")

    return rows


def _import_result(added=0, updated=0, skipped=0, failed=0,
                   skip_reasons=None, fail_reasons=None, unmatched_ids=None) -> dict:
    return {
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
        "skip_reasons": skip_reasons or [],
        "fail_reasons": fail_reasons or [],
        "unmatched_ids": unmatched_ids or [],
    }


@router.post("/teams/import", status_code=200)
async def import_teams(
    file: UploadFile = File(...),
    mode: str = Query("upsert", regex="^(add|upsert|replace)$"),
):
    """Bulk-import teams from a CSV file.

    mode=add    — add new teams only; skip rows whose name already exists.
    mode=upsert — update existing (matched by name) + create new (default).
    mode=replace — delete all existing teams then import CSV rows as new.

    Required columns: name, function. Optional: department.
    Full validation before any write (atomic).
    """
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(422, "Only .csv files are accepted")
    rows = _parse_csv_upload(file, _TEAMS_IMPORT_REQUIRED, _TEAMS_IMPORT_COLUMNS)

    store = _teams()
    added = updated = skipped = failed = 0
    skip_reasons: list[str] = []
    fail_reasons: list[str] = []

    if mode == "replace":
        existing = store.list()
        for t in existing:
            store.delete(t.team_id)

    existing_by_name = {t.name.strip().lower(): t for t in store.list()}

    for i, row in enumerate(rows, start=2):
        name_key = row["name"].strip().lower()
        try:
            if name_key in existing_by_name:
                if mode == "add":
                    skipped += 1
                    skip_reasons.append(f"Row {i}: '{row['name']}' already exists (skipped in Add Only mode)")
                    continue
                # upsert or replace (post-delete, nothing will match in replace)
                existing_team = existing_by_name[name_key]
                store.update(existing_team.team_id, {
                    "function": row["function"],
                    "department": row.get("department") or None,
                })
                updated += 1
            else:
                team = IntelTeam.new(row["name"], row["function"], row.get("department") or None)
                store.create(team)
                added += 1
        except Exception as exc:
            failed += 1
            fail_reasons.append(f"Row {i}: '{row['name']}' — {exc}")

    return _import_result(added, updated, skipped, failed, skip_reasons, fail_reasons)


@router.post("/documents/{doc_id}/actionables/import", status_code=200)
async def import_actionables(
    doc_id: str,
    file: UploadFile = File(...),
    mode: str = Query("upsert", regex="^(upsert|replace)$"),
):
    """Bulk-import / update actionables for a document from a CSV file.

    mode=upsert  — update existing actionables (matched by id); report unmatched IDs (default).
    mode=replace — same as upsert but first clears all existing actionable fields to defaults.

    Add-Only mode is not supported for actionables (IDs are system-generated; use extract).

    Required columns: id, description, priority, deadline, risk_score.
    Optional: team_specific_tasks, notes.
    Full validation before any write.
    """
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(422, "Only .csv files are accepted")

    run = _runs().get(doc_id)
    if not run:
        raise HTTPException(404, "No intelligence run for this document. Extract first.")

    rows = _parse_csv_upload(file, _ACTIONABLES_IMPORT_REQUIRED, set())

    # Full pre-validation pass — no writes until all rows pass
    valid_priorities = {"High", "Medium", "Low"}
    fail_reasons: list[str] = []
    for i, row in enumerate(rows, start=2):
        if row.get("priority") not in valid_priorities:
            fail_reasons.append(
                f"Row {i} (id={row.get('id', '?')}): invalid priority '{row.get('priority')}'. Must be High, Medium, or Low."
            )
        try:
            rs = int(row.get("risk_score", "0"))
            if not 1 <= rs <= 5:
                raise ValueError
        except ValueError:
            fail_reasons.append(f"Row {i} (id={row.get('id', '?')}): risk_score must be an integer 1–5.")

    if fail_reasons:
        raise HTTPException(
            422,
            f"Validation failed on {len(fail_reasons)} row(s). Fix these errors and re-upload: "
            + " | ".join(fail_reasons),
        )

    existing_ids = {a.id for a in run.actionables}
    updated = skipped = 0
    unmatched_ids: list[str] = []
    skip_reasons: list[str] = []

    for row in rows:
        aid = row.get("id", "").strip()
        if aid not in existing_ids:
            unmatched_ids.append(f"ID '{aid}' — not found in this document's actionables")
            skipped += 1
            continue

        patch: dict = {}
        for fld in ("description", "priority", "deadline", "notes"):
            if row.get(fld):
                patch[fld] = row[fld]
        if row.get("risk_score"):
            patch["risk_score"] = int(row["risk_score"])
        # Parse team_specific_tasks from CSV if present (format: "team_name:task; team_name:task")
        if row.get("team_specific_tasks"):
            try:
                import json as _json
                parsed = _json.loads(row["team_specific_tasks"])
                if isinstance(parsed, list):
                    patch["team_specific_tasks"] = parsed
            except (ValueError, TypeError):
                # Fallback: parse "TeamName: Task; TeamName: Task" format
                tasks_raw = row["team_specific_tasks"]
                task_list = []
                for pair in tasks_raw.split(";"):
                    pair = pair.strip()
                    if ":" in pair:
                        tname, ttask = pair.split(":", 1)
                        task_list.append({"team_id": "", "team_name": tname.strip(), "team_specific_task": ttask.strip()})
                if task_list:
                    patch["team_specific_tasks"] = task_list
        if not patch:
            skipped += 1
            skip_reasons.append(f"ID '{aid}' — no updatable fields in row")
            continue

        _runs().update_actionable(doc_id, aid, patch)
        updated += 1

    # Refresh stats
    refreshed = _runs().get(doc_id)
    if refreshed:
        refreshed.stats = compute_stats(refreshed.actionables, _teams().list())
        _runs().save(refreshed)

    return _import_result(
        added=0,
        updated=updated,
        skipped=skipped,
        failed=0,
        skip_reasons=skip_reasons,
        unmatched_ids=unmatched_ids,
    )


# ---------------------------------------------------------------------------
# Extract + enrich + assign (the AIS pipeline)
# ---------------------------------------------------------------------------
def _load_doc_effective_date(doc_id: str) -> str:
    """Best-effort fetch of the document-level execution / implementation date
    captured by the main ingestion metadata flow (Section 7 fallback)."""
    try:
        from tree.actionable_store import ActionableStore  # local import to avoid cycles

        result = ActionableStore().load(doc_id)
        if result is None:
            return ""
        # Prefer effective date; fall back to issue date if unset.
        return (
            getattr(result, "circular_effective_date", "")
            or getattr(result, "regulation_issue_date", "")
            or ""
        )
    except Exception as e:  # pragma: no cover - non-fatal
        logger.debug("Could not load doc effective date for %s: %s", doc_id, e)
        return ""


_EXCLUDED_VALIDATION_STATUSES = {"duplicate", "trivial"}


def _excluded_to_notices(excluded: list) -> list[NoticeItem]:
    """Convert duplicate/trivial actionables into notice board entries."""
    notices: list[NoticeItem] = []
    for a in excluded:
        status = a.validation_status
        if status == "duplicate":
            tag = "Informational"
            prefix = "[Duplicate] "
        else:  # trivial
            tag = "Contextual"
            prefix = "[Trivial] "
        text = prefix + (
            (getattr(a, "action", "") and f"{a.actor or 'Entity'} — {a.action} {getattr(a, 'object', '') or ''}".strip())
            or (a.evidence_quote or "")[:200]
        )
        notices.append(NoticeItem(
            id=f"N-{uuid.uuid4().hex[:8].upper()}",
            text=text.strip()[:500],
            source=a.source_location or "",
            source_node_id=a.source_node_id or "",
            tag=tag,
        ))
    return notices


def _build_run(
    tree,
    raw_actionables,
    teams: list[IntelTeam],
    doc_effective_date: str,
    progress_callback=None,
) -> IntelRun:
    """Run enrichment + assignment + grouping. Optionally reports per-batch
    progress via `progress_callback(stage, current, total, items_so_far)`
    for heartbeat updates on long jobs.
    """
    filtered = [
        a for a in raw_actionables
        if a.validation_status not in _EXCLUDED_VALIDATION_STATUSES
    ]
    excluded = [
        a for a in raw_actionables
        if a.validation_status in _EXCLUDED_VALIDATION_STATUSES
    ]
    if excluded:
        logger.info(
            "[intelligence] Excluded %d duplicate/trivial actionable(s) before enrichment",
            len(excluded),
        )
    enricher = _en()
    enriched, notices = enricher.enrich(
        filtered,
        tree,
        doc_effective_date=doc_effective_date,
        progress_callback=progress_callback,
    )
    _asg().assign(enriched, teams, progress_callback=progress_callback)

    notices.extend(_excluded_to_notices(excluded))

    run = IntelRun(
        doc_id=tree.doc_id,
        doc_name=tree.doc_name,
        actionables=enriched,
        notice_board=notices,
        team_snapshot=[t.to_dict() for t in teams],
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    run.stats = compute_stats(enriched, teams)
    return run


# ---------------------------------------------------------------------------
# Background extraction jobs
#
# The full AIS pipeline (raw extract -> enrich -> assign -> group) can run
# for hours on very large documents with massive batch counts. To survive
# proxy idle timeouts AND backend restarts we:
#   1. Persist job state in MongoDB (IntelExtractJobStore).
#   2. Heartbeat from each pipeline stage so dead workers can be detected.
#   3. Use a streaming extractor variant so per-stage progress is visible.
#   4. Catch and persist exceptions so partial work isn't silently lost.
# The initial POST always returns within milliseconds; clients poll the
# status endpoint indefinitely (no client-side timeout).
# ---------------------------------------------------------------------------
# Heartbeat thread tracking — keeps job alive in DB during long LLM calls
_extract_threads: Dict[str, threading.Thread] = {}
_extract_threads_lock = threading.Lock()


def _spawn_heartbeat(doc_id: str, stop_event: threading.Event,
                     interval_seconds: int = 30) -> threading.Thread:
    """Background thread that pings the job's heartbeat every `interval_seconds`.

    This guarantees that even during a multi-minute LLM call the persistent
    job is still considered alive, so the stale-job sweeper doesn't mark it
    as failed prematurely.
    """
    def _loop():
        while not stop_event.wait(interval_seconds):
            try:
                _jobs().heartbeat(doc_id)
            except Exception as e:  # noqa: BLE001 — heartbeat is best-effort
                logger.debug("Heartbeat write failed for %s: %s", doc_id, e)

    t = threading.Thread(
        target=_loop,
        daemon=True,
        name=f"intel-heartbeat-{doc_id}",
    )
    t.start()
    return t


def _run_extract_pipeline(doc_id: str) -> None:
    """Worker that runs the full AIS pipeline and persists progress.

    Resilience:
      * Heartbeat thread keeps the job marked "alive" during long LLM calls.
      * Each stage transition is committed to MongoDB before the next stage starts.
      * Exceptions inside any stage propagate up and are persisted with a
        traceback so the user can see exactly where extraction stopped.
      * The IntelRunStore.save() at the end is the atomic "commit point"
        for the document. Anything before that point is recoverable by
        re-running extraction; anything after is durable.
    """
    pipeline_start = time.time()
    stop_heartbeat = threading.Event()
    heartbeat_thread = _spawn_heartbeat(doc_id, stop_heartbeat, interval_seconds=30)

    try:
        tree = _ts().load(doc_id)
        if tree is None:
            _jobs().mark_error(doc_id, f"Document {doc_id} not found")
            return

        # ── Stage 1: Raw actionable extraction (LLM-heavy, batched) ────────
        _jobs().heartbeat(doc_id, stage="extract", stage_progress={"current": 0, "total": 0})
        logger.info("[intelligence] %s | stage=extract begin", doc_id)
        stage_start = time.time()

        raw_result = _ex().extract(tree)
        raw_count = len(raw_result.actionables) if raw_result and raw_result.actionables else 0
        logger.info(
            "[intelligence] %s | stage=extract done | %d raw actionables in %.1fs",
            doc_id, raw_count, time.time() - stage_start,
        )
        _jobs().heartbeat(doc_id, actionables_so_far=raw_count)

        # ── Stage 2: Enrich + assign (LLM-heavy, batched) ──────────────────
        _jobs().heartbeat(doc_id, stage="enrich+assign")
        logger.info("[intelligence] %s | stage=enrich+assign begin", doc_id)
        stage_start = time.time()

        teams = _teams().list()
        doc_effective_date = _load_doc_effective_date(doc_id)

        def _stage_progress(stage: str, current: int, total: int, items_so_far: int) -> None:
            """Per-batch heartbeat reporter for enrich/assign stages."""
            try:
                _jobs().heartbeat(
                    doc_id,
                    stage=stage,
                    stage_progress={"current": current, "total": total},
                    actionables_so_far=items_so_far,
                )
                logger.info(
                    "[intelligence] %s | %s batch %d/%d | items=%d",
                    doc_id, stage, current, total, items_so_far,
                )
            except Exception as cb_err:  # noqa: BLE001
                logger.debug("Stage progress heartbeat failed: %s", cb_err)

        run = _build_run(
            tree,
            raw_result.actionables,
            teams,
            doc_effective_date,
            progress_callback=_stage_progress,
        )
        logger.info(
            "[intelligence] %s | stage=enrich+assign done | %d enriched in %.1fs",
            doc_id, len(run.actionables), time.time() - stage_start,
        )

        # ── Stage 3: Persist (atomic commit point) ─────────────────────────
        _jobs().heartbeat(doc_id, stage="save")
        _runs().save(run)

        elapsed = time.time() - pipeline_start
        logger.info(
            "[intelligence] %s | extraction COMPLETE | %d actionables | total %.1fs",
            doc_id, len(run.actionables), elapsed,
        )
        _jobs().mark_done(doc_id, count=len(run.actionables))

    except Exception as e:  # noqa: BLE001 — surface failure to the poller
        elapsed = time.time() - pipeline_start
        logger.exception(
            "[intelligence] %s | extraction FAILED after %.1fs",
            doc_id, elapsed,
        )
        _jobs().mark_error(
            doc_id,
            error=f"{type(e).__name__}: {e}",
            trace=traceback.format_exc(limit=5),
        )
    finally:
        stop_heartbeat.set()
        # Best-effort: nudge the heartbeat thread to exit promptly
        try:
            heartbeat_thread.join(timeout=1.0)
        except Exception:  # noqa: BLE001
            pass
        with _extract_threads_lock:
            _extract_threads.pop(doc_id, None)


@router.post("/documents/{doc_id}/extract")
def extract_for_document(doc_id: str, force: bool = Query(False)):
    """Kick off the full AIS pipeline (extract -> enrich -> assign -> group).

    Returns immediately with a 202-style payload. Poll
    GET /intelligence/documents/{doc_id}/extract/status until status=="done",
    then fetch the run with GET /intelligence/documents/{doc_id}.

    If `force=false` and a run already exists, the existing run is returned
    synchronously (fast path).

    Concurrency: jobs are claimed atomically in MongoDB. If another worker
    (same or different process) already owns this doc_id, the call returns
    the live job state rather than spawning a duplicate worker.
    """
    tree = _ts().load(doc_id)
    if tree is None:
        raise HTTPException(404, f"Document {doc_id} not found")

    existing = _runs().get(doc_id)
    if existing and not force:
        return {"status": "done", "run": _run_payload(existing)}

    # Atomic claim: only one worker may own a doc at a time.
    claimed, current = _jobs().claim(doc_id, force=force)
    if not claimed:
        return {
            "status": "running",
            "stage": (current or {}).get("stage", "starting"),
            "started_at": (current or {}).get("started_at", ""),
            "actionables_so_far": (current or {}).get("actionables_so_far", 0),
        }

    thread = threading.Thread(
        target=_run_extract_pipeline,
        args=(doc_id,),
        daemon=True,
        name=f"intel-extract-{doc_id}",
    )
    with _extract_threads_lock:
        _extract_threads[doc_id] = thread
    thread.start()

    return {"status": "running", "stage": "starting"}


@router.get("/documents/{doc_id}/extract/status")
def extract_status(doc_id: str):
    """Cheap poll endpoint for the background extraction job.

    Returns one of:
      {status: "idle"}                      — no job has ever run
      {status: "running", stage, ...}       — background worker in progress
      {status: "done",    run: {...}}       — worker finished; run payload included
      {status: "error",   error: "..."}     — worker failed; see `error`

    The "running" payload also includes:
      stage_progress, actionables_so_far, started_at, heartbeat_at
    so the UI can render progress and detect stalls.
    """
    job = _jobs().get(doc_id)

    if not job:
        existing = _runs().get(doc_id)
        if existing:
            return {"status": "done", "run": _run_payload(existing)}
        return {"status": "idle"}

    status = job.get("status")
    if status == "running":
        return {
            "status": "running",
            "stage": job.get("stage", "starting"),
            "stage_progress": job.get("stage_progress") or {"current": 0, "total": 0},
            "actionables_so_far": job.get("actionables_so_far", 0),
            "started_at": job.get("started_at", ""),
            "heartbeat_at": job.get("heartbeat_at", ""),
        }
    if status == "error":
        return {
            "status": "error",
            "error": job.get("error", "unknown error"),
            "trace": job.get("trace"),
            "started_at": job.get("started_at", ""),
            "finished_at": job.get("finished_at", ""),
        }
    # status == "done" — attach persisted run so the client can skip a hop.
    existing = _runs().get(doc_id)
    return {
        "status": "done",
        "run": _run_payload(existing) if existing else None,
        "count": job.get("count"),
        "started_at": job.get("started_at", ""),
        "finished_at": job.get("finished_at", ""),
    }


@router.get("/documents/{doc_id}")
def get_run(doc_id: str):
    run = _runs().get(doc_id)
    if not run:
        raise HTTPException(404, "No intelligence run for this document. POST /intelligence/documents/{doc_id}/extract first.")
    return _run_payload(run)


@router.post("/documents/{doc_id}/reassign")
def reassign_teams(doc_id: str):
    """Re-run team assignment only (e.g. after editing the team roster)."""
    run = _runs().get(doc_id)
    if not run:
        raise HTTPException(404, "No intelligence run for this document")
    teams = _teams().list()
    _asg().assign(run.actionables, teams)
    run.team_snapshot = [t.to_dict() for t in teams]
    run.stats = compute_stats(run.actionables, teams)
    _runs().save(run)
    return _run_payload(run)


@router.patch("/documents/{doc_id}/actionables/{item_id}")
def patch_actionable(doc_id: str, item_id: str, body: ActionablePatch):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    run = _runs().get(doc_id)
    if not run:
        raise HTTPException(404, "No intelligence run for this document")

    # denormalize team names and sync team_specific_tasks if assigned_teams changed
    if "assigned_teams" in patch:
        team_map = {t.team_id: t.name for t in _teams().list()}
        patch["assigned_team_names"] = [team_map[t] for t in patch["assigned_teams"] if t in team_map]
        # If team_specific_tasks not explicitly provided, build from assigned_teams
        if "team_specific_tasks" not in patch:
            # Preserve existing tasks if available, add empty for new teams
            existing_tasks_by_id = {}
            existing_run = _runs().get(doc_id)
            if existing_run:
                for ea in existing_run.actionables:
                    if ea.id == item_id:
                        for tsa in (ea.team_specific_tasks or []):
                            tid = tsa.team_id if hasattr(tsa, 'team_id') else tsa.get('team_id', '')
                            task = tsa.team_specific_task if hasattr(tsa, 'team_specific_task') else tsa.get('team_specific_task', '')
                            existing_tasks_by_id[tid] = task
                        break
            patch["team_specific_tasks"] = [
                {"team_id": tid, "team_name": team_map.get(tid, ""), "team_specific_task": existing_tasks_by_id.get(tid, "")}
                for tid in patch["assigned_teams"] if tid in team_map
            ]
    # Serialize team_specific_tasks if provided as Pydantic models
    if "team_specific_tasks" in patch and patch["team_specific_tasks"] is not None:
        patch["team_specific_tasks"] = [
            t.model_dump() if hasattr(t, 'model_dump') else (t.dict() if hasattr(t, 'dict') else t)
            for t in patch["team_specific_tasks"]
        ]

    updated = _runs().update_actionable(doc_id, item_id, patch)
    if not updated:
        raise HTTPException(404, "Actionable not found")

    # refresh stats on the stored run
    run = _runs().get(doc_id)
    if run:
        run.stats = compute_stats(run.actionables, _teams().list())
        _runs().save(run)
    return updated


@router.delete("/documents/{doc_id}")
def delete_run(doc_id: str):
    ok = _runs().delete(doc_id)
    if not ok:
        raise HTTPException(404, "No intelligence run for this document")
    return {"ok": True}


@router.post("/admin/reset-actionables")
def reset_all_actionables():
    """Wipe ALL extracted actionables across every document.

    Removes the entire `intel_runs` collection content (actionables, team
    assignments, team-specific tasks, deadlines, priorities,
    risks, notes). Documents, document metadata, and teams are
    NOT touched. Use after a system schema update to provide a clean slate
    before re-running extraction.
    """
    deleted = _runs().delete_all()
    logger.warning("[intelligence] admin reset wiped %d intelligence runs", deleted)
    return {"ok": True, "deleted_runs": deleted}


# ---------------------------------------------------------------------------
# Cross-document dashboard
# ---------------------------------------------------------------------------
@router.get("/dashboard")
def dashboard():
    summaries = _runs().list_summaries()
    teams = _teams().list()

    agg = {
        "total_actionables": 0,
        "total_notices": 0,
        "documents": len(summaries),
        "priority_counts": {"High": 0, "Medium": 0, "Low": 0},
        "risk_counts": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0},
        "team_workload": {},
        "unassigned": 0,
    }
    per_doc = []

    # load full runs for team workload accuracy
    for s in summaries:
        doc_id = s["doc_id"]
        run = _runs().get(doc_id)
        if not run:
            continue
        stats = run.stats or compute_stats(run.actionables, teams)
        agg["total_actionables"] += stats.get("total", 0)
        agg["total_notices"] += s.get("notice_count", 0)
        agg["unassigned"] += stats.get("unassigned", 0)
        for k, v in stats.get("priority_counts", {}).items():
            agg["priority_counts"][k] = agg["priority_counts"].get(k, 0) + v
        for k, v in stats.get("risk_counts", {}).items():
            agg["risk_counts"][k] = agg["risk_counts"].get(k, 0) + v
        for k, v in stats.get("team_workload", {}).items():
            agg["team_workload"][k] = agg["team_workload"].get(k, 0) + v

        per_doc.append({
            "doc_id": doc_id,
            "doc_name": run.doc_name,
            "updated_at": run.updated_at,
            "stats": stats,
        })

    return {
        "summary": agg,
        "per_document": per_doc,
        "team_roster_size": len(teams),
    }


# ---------------------------------------------------------------------------
# Serialization helper
# ---------------------------------------------------------------------------
def _run_payload(run: IntelRun) -> dict:
    from tree.actionable_store import ActionableStore  # local import to avoid cycles

    teams = _teams().list()
    groupings = build_groupings(run.actionables, teams)
    # always refresh stats on read to reflect latest patches
    stats = compute_stats(run.actionables, teams)
    run.stats = stats

    # Attach parent document metadata so the frontend can display/export it
    doc_meta: dict = {}
    try:
        ar = ActionableStore().load(run.doc_id)
        if ar is not None:
            doc_meta = {
                "circular_effective_date": getattr(ar, "circular_effective_date", "") or "",
                "regulation_issue_date": getattr(ar, "regulation_issue_date", "") or "",
                "regulator": getattr(ar, "regulator", "") or "",
                "circular_id": getattr(ar, "circular_id", "") or "",
                "circular_title": getattr(ar, "circular_title", "") or "",
            }
    except Exception:
        pass

    return {
        "doc_id": run.doc_id,
        "doc_name": run.doc_name,
        "actionables": [a.to_dict() for a in run.actionables],
        "notice_board": [n.to_dict() for n in run.notice_board],
        "team_snapshot": run.team_snapshot,
        "categories": [],
        "groupings": groupings,
        "stats": stats,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "doc_meta": doc_meta,
    }
