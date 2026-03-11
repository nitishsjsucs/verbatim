"""
Actionable endpoints — CRUD, extraction, bypass flow, delays, justification, audit.

Extracted from main.py as part of the backend modularization.
"""
import asyncio
import json as _json
import uuid
import shutil
import logging
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, File, UploadFile, HTTPException, Query, Body
from fastapi.responses import FileResponse, StreamingResponse

from app_backend.constants import (
    UserRole, TaskStatus, JustificationStatus,
    RISK_MEMBER_ONLY_FIELDS, RISK_TRIGGER_FIELDS,
    EDITABLE_FIELDS, DELAY_EXEMPT_STATUSES,
    DEFAULT_TEAM_NAME, AuditEvent,
)
from app_backend.models.schemas import JustificationRequest
from app_backend.services.risk_service import recompute_risk_scores as _recompute_risk_scores

logger = logging.getLogger("backend")

router = APIRouter(tags=["actionables"])

# ---------------------------------------------------------------------------
# Project root for evidence directory
# ---------------------------------------------------------------------------
_CURRENT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _CURRENT_DIR.parent.parent
EVIDENCE_DIR = _PROJECT_ROOT / "data" / "evidence"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Tagged Incorrectly — Bypass Flow
# ---------------------------------------------------------------------------

@router.post("/documents/{doc_id}/actionables/{item_id}/bypass-tag")
def tag_incorrectly(doc_id: str, item_id: str, body: dict = Body(...)):
    """Team member tags an actionable as incorrectly assigned."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    target.bypass_tag = True
    target.bypass_tagged_at = datetime.now(timezone.utc).isoformat()
    target.bypass_tagged_by = body.get("tagged_by", "")
    target.task_status = TaskStatus.TAGGED_INCORRECTLY

    trail_entry = {
        "event": AuditEvent.TAGGED_INCORRECTLY,
        "actor": body.get("tagged_by", ""),
        "role": UserRole.TEAM_MEMBER,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "details": "Team member tagged this actionable as incorrectly assigned",
    }
    if not isinstance(target.audit_trail, list):
        target.audit_trail = []
    target.audit_trail.append(trail_entry)

    store.save(result)
    return target.to_dict()


@router.post("/documents/{doc_id}/actionables/{item_id}/bypass-approve")
def approve_bypass(doc_id: str, item_id: str, body: dict = Body(...)):
    """Checker approves the bypass tag, sending the actionable back to CO for reassignment."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    if not target.bypass_tag:
        raise HTTPException(status_code=400, detail="Item was not tagged as incorrectly assigned")

    target.bypass_approved_by = body.get("approved_by", "")
    target.bypass_approved_at = datetime.now(timezone.utc).isoformat()
    target.task_status = TaskStatus.BYPASS_APPROVED

    trail_entry = {
        "event": AuditEvent.BYPASS_APPROVED,
        "actor": body.get("approved_by", ""),
        "role": UserRole.TEAM_REVIEWER,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "details": "Checker approved the bypass tag — sent back to Compliance Officer for reassignment",
    }
    if not isinstance(target.audit_trail, list):
        target.audit_trail = []
    target.audit_trail.append(trail_entry)

    store.save(result)
    return target.to_dict()


@router.post("/documents/{doc_id}/actionables/{item_id}/reset-team")
def reset_team(doc_id: str, item_id: str, body: dict = Body(...)):
    """Compliance Officer resets the team assignment for a bypassed actionable."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    # Reset bypass fields
    target.bypass_tag = False
    target.bypass_tagged_at = ""
    target.bypass_tagged_by = ""
    target.bypass_approved_by = ""
    target.bypass_approved_at = ""
    # Reset task status back to assigned
    target.task_status = TaskStatus.ASSIGNED
    # Update workstream if new_team provided
    new_team = body.get("new_team", "")
    if new_team:
        target.workstream = new_team
        if not target.is_multi_team:
            target.assigned_teams = [new_team]

    trail_entry = {
        "event": AuditEvent.TEAM_RESET,
        "actor": body.get("reset_by", ""),
        "role": UserRole.COMPLIANCE_OFFICER,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "details": f"Team reassigned to '{new_team}'" if new_team else "Team assignment reset",
    }
    if not isinstance(target.audit_trail, list):
        target.audit_trail = []
    target.audit_trail.append(trail_entry)

    store.save(result)
    return target.to_dict()


# ---------------------------------------------------------------------------
# Actionable Extraction Endpoints
# ---------------------------------------------------------------------------

@router.get("/documents/{doc_id}/actionables")
def get_actionables(doc_id: str):
    """Get extracted actionables for a document (if available)."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        return {"status": "not_extracted", "doc_id": doc_id, "actionables": []}
    return result.to_dict()


@router.post("/documents/{doc_id}/extract-actionables")
async def extract_actionables(doc_id: str, force: bool = Query(False)):
    """
    Extract compliance actionables from a document via Server-Sent Events.

    Streams progress events so the frontend can show a real-time progress bar.
    """
    from app_backend.routers.deps import (
        get_actionable_store, get_tree_store, get_actionable_extractor,
        generate_actionable_id,
    )

    # Check if already extracted (skip if not forced)
    act_store = get_actionable_store()
    if not force and act_store.exists(doc_id):
        existing = act_store.load(doc_id)
        if existing:

            async def _cached():
                payload = _json.dumps(
                    {"event": "complete", "result": existing.to_dict()}
                )
                yield f"data: {payload}\n\n"

            return StreamingResponse(
                _cached(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )

    # Load document tree
    tree_store = get_tree_store()
    tree = tree_store.load(doc_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Document not found")

    # Use an asyncio.Queue to bridge the blocking generator thread
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def _put_event(event):
        """Thread-safe put onto the asyncio queue."""
        loop.call_soon_threadsafe(queue.put_nowait, event)

    def _run_extraction():
        """Runs in a thread pool. Puts events onto the queue."""
        try:
            extractor = get_actionable_extractor()
            final_result = None

            for event in extractor.extract_streaming(tree):
                if event.get("event") == "complete":
                    final_result = event.get("result")
                _put_event(event)

            # Save to MongoDB after extraction is done
            if final_result:
                from models.actionable import ActionablesResult as AR

                result_obj = AR.from_dict(final_result)
                _now = datetime.now(timezone.utc).isoformat()
                for _a in result_obj.actionables:
                    if not _a.created_at:
                        _a.created_at = _now
                    if not _a.actionable_id:
                        _a.actionable_id = generate_actionable_id()
                act_store.save(result_obj)

        except Exception as e:
            logger.error("Actionable extraction failed: %s", e)
            _put_event({"event": "error", "message": str(e)})
        finally:
            _put_event(None)  # Sentinel to signal end of stream

    async def _sse_stream():
        """Async generator that reads from the queue and yields SSE lines."""
        asyncio.get_event_loop().run_in_executor(None, _run_extraction)

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=300)
            except asyncio.TimeoutError:
                yield f"data: {_json.dumps({'event': 'keepalive'})}\n\n"
                continue

            if event is None:
                break

            payload = _json.dumps(event)
            yield f"data: {payload}\n\n"

    return StreamingResponse(
        _sse_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Actionable CRUD Endpoints
# ---------------------------------------------------------------------------

@router.get("/actionables")
def list_all_actionables():
    """List actionables across ALL documents."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    db = store._collection
    results = []
    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        raw.pop("_id", None)
        raw["doc_id"] = doc_id
        results.append(raw)
    return results


@router.put("/documents/{doc_id}/actionables/{item_id}")
def update_actionable(doc_id: str, item_id: str, body: dict = Body(...), for_team: str = Query(""), caller_role: str = Query("")):
    """Update a single actionable item's fields (edit, approve, reject).

    If for_team is supplied and the item is multi-team, team-specific workflow
    fields are written into team_workflows[for_team].
    """
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Actionables not found for this document")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    from models.actionable import ActionableItem as _AI
    team_workflow_fields = set(_AI.TEAM_WORKFLOW_FIELDS)

    is_team_update = for_team and target.is_multi_team and for_team in target.assigned_teams

    # Strip risk fields if caller is compliance_officer (read-only for CO)
    if caller_role == UserRole.COMPLIANCE_OFFICER:
        for blocked in RISK_MEMBER_ONLY_FIELDS:
            body.pop(blocked, None)

    editable_fields = EDITABLE_FIELDS
    for field_name in editable_fields:
        if field_name in body:
            val = body[field_name]
            if field_name == "modality":
                from models.actionable import Modality
                try:
                    val = Modality(val)
                except ValueError:
                    continue
            elif field_name == "workstream":
                val = str(val) if val else DEFAULT_TEAM_NAME

            if is_team_update and field_name in team_workflow_fields:
                if for_team not in target.team_workflows:
                    target.team_workflows[for_team] = {}
                target.team_workflows[for_team][field_name] = val
            else:
                setattr(target, field_name, val)

    if "assigned_teams" in body:
        target.init_team_workflows()

    # Recompute risk scores only when risk-relevant fields changed
    if body.keys() & RISK_TRIGGER_FIELDS:
        _recompute_risk_scores(target)

    if target.is_multi_team:
        target.compute_aggregate_status()

    result.compute_stats()
    store.save(result)
    return target.to_dict()


@router.post("/documents/{doc_id}/actionables")
def create_manual_actionable(doc_id: str, body: dict = Body(...)):
    """Create a manually-added actionable for a document."""
    from app_backend.routers.deps import get_actionable_store, get_tree_store, generate_actionable_id

    store = get_actionable_store()
    result = store.load(doc_id)

    if not result:
        tree_store = get_tree_store()
        tree = tree_store.load(doc_id)
        doc_name = tree.doc_name if tree else doc_id
        from models.actionable import ActionablesResult as AR
        result = AR(doc_id=doc_id, doc_name=doc_name)

    # Generate next ID
    existing_ids = [a.id for a in result.actionables]
    max_num = 0
    for aid in existing_ids:
        try:
            num = int(aid.replace("ACT-", "").replace("MAN-", ""))
            max_num = max(max_num, num)
        except ValueError:
            pass
    new_id = f"MAN-{max_num + 1:03d}"

    from models.actionable import ActionableItem as AI, Modality

    modality_str = body.get("modality", "Mandatory")
    try:
        modality = Modality(modality_str)
    except ValueError:
        modality = Modality.MANDATORY

    workstream_str = str(body.get("workstream", DEFAULT_TEAM_NAME))

    item = AI(
        id=new_id,
        modality=modality,
        actor=body.get("actor", ""),
        action=body.get("action", ""),
        object=body.get("object", ""),
        trigger_or_condition=body.get("trigger_or_condition", ""),
        thresholds=body.get("thresholds", ""),
        deadline_or_frequency=body.get("deadline_or_frequency", ""),
        effective_date=body.get("effective_date", ""),
        reporting_or_notification_to=body.get("reporting_or_notification_to", ""),
        evidence_quote=body.get("evidence_quote", ""),
        source_location=body.get("source_location", ""),
        source_node_id=body.get("source_node_id", ""),
        implementation_notes=body.get("implementation_notes", ""),
        workstream=workstream_str,
        needs_legal_review=body.get("needs_legal_review", False),
        validation_status="manual",
        approval_status="pending",
        is_manual=True,
        created_at=datetime.now(timezone.utc).isoformat(),
        actionable_id=generate_actionable_id(),
    )

    result.actionables.append(item)
    result.compute_stats()
    store.save(result)
    return item.to_dict()


@router.get("/actionables/approved-by-team")
def get_approved_by_team():
    """Get all approved actionables grouped by workstream (team)."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    db = store._collection
    teams: dict[str, list] = {}
    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        doc_name = raw.get("doc_name", doc_id)
        for a in raw.get("actionables", []):
            if a.get("approval_status") == "approved":
                a["doc_id"] = doc_id
                a["doc_name"] = doc_name
                assigned = a.get("assigned_teams", [])
                target_teams = assigned if len(assigned) > 0 else [a.get("workstream", DEFAULT_TEAM_NAME)]
                for ws in target_teams:
                    if ws not in teams:
                        teams[ws] = []
                    teams[ws].append(a)
    return teams


@router.delete("/documents/{doc_id}/actionables/{item_id}")
def delete_actionable(doc_id: str, item_id: str):
    """Delete a single actionable item."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Actionables not found")
    original_len = len(result.actionables)
    result.actionables = [a for a in result.actionables if a.id != item_id]
    if len(result.actionables) == original_len:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")
    result.compute_stats()
    store.save(result)
    return {"deleted": item_id}


# ---------------------------------------------------------------------------
# Evidence file upload & serving
# ---------------------------------------------------------------------------

@router.post("/evidence/upload")
async def upload_evidence(file: UploadFile = File(...)):
    """Upload an evidence file and return a persistent URL."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest = EVIDENCE_DIR / unique_name

    try:
        with dest.open("wb") as buf:
            shutil.copyfileobj(file.file, buf)
    finally:
        file.file.close()

    return {
        "filename": unique_name,
        "original_name": file.filename,
        "url": f"/evidence/files/{unique_name}",
    }


@router.get("/evidence/files/{filename}")
def serve_evidence_file(filename: str):
    """Serve an uploaded evidence file."""
    file_path = EVIDENCE_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path), filename=filename)


@router.delete("/evidence/files/{filename}")
def delete_evidence_file(filename: str):
    """Delete an uploaded evidence file from disk."""
    sanitized = Path(filename).name
    file_path = EVIDENCE_DIR / sanitized
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    file_path.unlink()
    return {"detail": "deleted"}


# ---------------------------------------------------------------------------
# Flat Actionable Endpoints (Phase 2 — one doc per actionable)
# ---------------------------------------------------------------------------

def _get_flat_repo():
    """Lazy singleton for the flat actionable repository."""
    from app_backend.repositories.actionable_repo import ActionableFlatRepo
    return ActionableFlatRepo()


@router.get("/actionables/flat")
def list_flat_actionables(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status: str = Query(""),
    approval: str = Query(""),
    team: str = Query(""),
    delayed: str = Query(""),
    search: str = Query(""),
    sort_field: str = Query("created_at"),
    sort_order: int = Query(-1),
):
    """Paginated listing of actionables from the flat collection."""
    repo = _get_flat_repo()
    delayed_bool = None
    if delayed == "true":
        delayed_bool = True
    elif delayed == "false":
        delayed_bool = False

    return repo.find_paginated(
        page=page,
        page_size=page_size,
        status=status or None,
        approval=approval or None,
        team=team or None,
        delayed=delayed_bool,
        search=search or None,
        sort_field=sort_field,
        sort_order=sort_order,
    )


@router.get("/actionables/flat/{doc_id}/{item_id}")
def get_flat_actionable(doc_id: str, item_id: str):
    """Fetch a single actionable from the flat collection."""
    repo = _get_flat_repo()
    doc = repo.find_one(doc_id, item_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found in doc {doc_id}")
    return doc


@router.get("/actionables/flat/by-doc/{doc_id}")
def list_flat_by_doc(doc_id: str):
    """Return all flat actionables belonging to a source document."""
    repo = _get_flat_repo()
    items = repo.find_by_doc(doc_id)
    return {"items": items, "total": len(items)}


@router.get("/actionables/flat/stats")
def flat_actionable_stats():
    """Aggregated counts by status and team from the flat collection."""
    repo = _get_flat_repo()
    return {
        "by_status": repo.count_by_status(),
        "by_team": repo.count_by_team(),
    }


@router.post("/actionables/flat/ensure-indexes")
def ensure_flat_indexes():
    """Admin: create/ensure all indexes on the flat actionables collection."""
    repo = _get_flat_repo()
    repo.ensure_indexes()
    return {"ok": True}


@router.post("/actionables/flat/migrate")
def trigger_flat_migration():
    """Admin: trigger a one-time migration from embedded to flat collection."""
    from scripts.migrate_flat_actionables import migrate, create_indexes
    stats = migrate(dry_run=False)
    create_indexes()
    return {"ok": True, "stats": stats}


# ---------------------------------------------------------------------------
# Delay Monitoring Endpoints
# ---------------------------------------------------------------------------

@router.post("/actionables/check-delays")
def check_delays():
    """Scan all actionables and mark those past deadline as delayed."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    db = store._collection
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    updated_count = 0

    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        result = store.load(doc_id)
        if not result:
            continue
        changed = False
        for a in result.actionables:
            # Check top-level deadline
            if a.deadline and a.task_status not in DELAY_EXEMPT_STATUSES and not a.is_delayed:
                try:
                    dl = datetime.fromisoformat(a.deadline.replace("Z", "+00:00"))
                    if now > dl:
                        a.is_delayed = True
                        a.delay_detected_at = now_iso
                        a.audit_trail.append({
                            "event": AuditEvent.DELAY_DETECTED,
                            "actor": "system",
                            "role": "system",
                            "timestamp": now_iso,
                            "details": f"Task missed deadline {a.deadline}",
                        })
                        if a.is_multi_team:
                            for t_name, tw in a.team_workflows.items():
                                if tw.get("task_status", "") not in DELAY_EXEMPT_STATUSES and not tw.get("is_delayed"):
                                    tw["is_delayed"] = True
                                    tw["delay_detected_at"] = now_iso
                        changed = True
                        updated_count += 1
                except (ValueError, TypeError):
                    pass
            # Check per-team deadlines for multi-team items
            if a.is_multi_team and isinstance(a.team_workflows, dict):
                for t_name, tw in a.team_workflows.items():
                    team_dl = tw.get("deadline", "")
                    if team_dl and tw.get("task_status", "") not in DELAY_EXEMPT_STATUSES and not tw.get("is_delayed"):
                        try:
                            tdl = datetime.fromisoformat(team_dl.replace("Z", "+00:00"))
                            if now > tdl:
                                tw["is_delayed"] = True
                                tw["delay_detected_at"] = now_iso
                                a.audit_trail.append({
                                    "event": AuditEvent.DELAY_DETECTED,
                                    "actor": "system",
                                    "role": "system",
                                    "timestamp": now_iso,
                                    "details": f"Team '{t_name}' missed deadline {team_dl}",
                                })
                                changed = True
                                updated_count += 1
                        except (ValueError, TypeError):
                            pass
        if changed:
            result.compute_stats()
            store.save(result)

    return {"checked_at": now_iso, "newly_delayed": updated_count}


@router.get("/actionables/delayed")
def get_delayed_actionables(team: str = Query("")):
    """Get all delayed actionables, optionally filtered by team."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    db = store._collection
    delayed = []
    for raw in db.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        doc_name = raw.get("doc_name", doc_id)
        for a in raw.get("actionables", []):
            if a.get("is_delayed"):
                assigned = a.get("assigned_teams", [])
                if team:
                    if a.get("workstream", "") != team and team not in assigned:
                        continue
                a["doc_id"] = doc_id
                a["doc_name"] = doc_name
                delayed.append(a)
    return delayed


@router.post("/documents/{doc_id}/actionables/{item_id}/justification")
def submit_justification(doc_id: str, item_id: str, body: JustificationRequest, for_team: str = Query("")):
    """Team Lead submits a justification for a delayed task."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Actionables not found for this document")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    # Consider delayed if: explicit flag set, deadline passed, or gated at awaiting_justification
    deadline_passed = False
    if target.deadline:
        try:
            deadline_passed = datetime.fromisoformat(target.deadline.replace("Z", "+00:00")) < datetime.now(timezone.utc)
        except (ValueError, TypeError):
            pass
    is_effectively_delayed = (
        target.is_delayed
        or deadline_passed
        or target.task_status == "awaiting_justification"
    )
    if not is_effectively_delayed:
        raise HTTPException(status_code=400, detail="Task is not delayed")

    now_iso = datetime.now(timezone.utc).isoformat()

    is_team_justification = for_team and target.is_multi_team and for_team in target.assigned_teams

    if is_team_justification:
        tw = target.team_workflows.get(for_team, {})
        tw["justification"] = body.justification
        tw["justification_by"] = body.justifier_name
        tw["justification_at"] = now_iso
        tw["justification_status"] = JustificationStatus.PENDING_REVIEW
        target.team_workflows[for_team] = tw
        if tw.get("task_status") == TaskStatus.AWAITING_JUSTIFICATION:
            tw["task_status"] = TaskStatus.REVIEW
    else:
        target.justification = body.justification
        target.justification_by = body.justifier_name
        target.justification_at = now_iso
        target.justification_status = JustificationStatus.PENDING_REVIEW

    target.audit_trail.append({
        "event": AuditEvent.JUSTIFICATION_SUBMITTED,
        "actor": body.justifier_name,
        "role": UserRole.TEAM_LEAD,
        "timestamp": now_iso,
        "details": f"Justification pending CO review: {body.justification}" + (f" (team: {for_team})" if is_team_justification else ""),
    })

    if not is_team_justification and target.task_status == TaskStatus.AWAITING_JUSTIFICATION:
        target.task_status = TaskStatus.REVIEW
        target.audit_trail.append({
            "event": AuditEvent.STATUS_CHANGE,
            "actor": body.justifier_name,
            "role": UserRole.TEAM_LEAD,
            "timestamp": now_iso,
            "details": "Delay justified — task released to Compliance review",
        })

    if target.is_multi_team:
        target.compute_aggregate_status()

    result.compute_stats()
    store.save(result)
    return target.to_dict()


@router.get("/documents/{doc_id}/actionables/{item_id}/audit-trail")
def get_audit_trail(doc_id: str, item_id: str):
    """Get full audit trail for a single actionable."""
    from app_backend.routers.deps import get_actionable_store

    store = get_actionable_store()
    result = store.load(doc_id)
    if not result:
        raise HTTPException(status_code=404, detail="Actionables not found for this document")

    target = None
    for a in result.actionables:
        if a.id == item_id:
            target = a
            break
    if not target:
        raise HTTPException(status_code=404, detail=f"Actionable {item_id} not found")

    return {"item_id": item_id, "doc_id": doc_id, "audit_trail": target.audit_trail}
