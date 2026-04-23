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

import logging
import shutil
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from config.settings import get_settings
from tree.tree_store import TreeStore
from ingestion.pipeline import IngestionPipeline
from agents.actionable_extractor import ActionableExtractor

from intelligence.models import EnrichedActionable, IntelRun, IntelTeam, NoticeItem
from intelligence.store import IntelRunStore, IntelTeamStore
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


class ActionablePatch(BaseModel):
    status: Optional[str] = None
    assigned_teams: Optional[list[str]] = None
    priority: Optional[str] = None
    deadline: Optional[str] = None
    risk_score: Optional[int] = None
    category: Optional[str] = None
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
    """List all documents with an AIS-run indicator."""
    docs = _ts().list_documents_summary()
    run_ids = {s["doc_id"] for s in _runs().list_summaries()}
    for d in docs:
        d["has_intel_run"] = d.get("id") in run_ids
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
# Extract + enrich + assign (the AIS pipeline)
# ---------------------------------------------------------------------------
def _build_run(tree, raw_actionables, teams: list[IntelTeam]) -> IntelRun:
    enricher = _en()
    enriched, notices = enricher.enrich(raw_actionables, tree)
    _asg().assign(enriched, teams)

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


@router.post("/documents/{doc_id}/extract")
def extract_for_document(doc_id: str, force: bool = Query(False)):
    """
    Run the full AIS pipeline for a document:

      raw extraction (existing) → enrich/classify (new) → team assignment (new)
      → groupings + stats (new) → persist IntelRun.

    Existing `/documents/{doc_id}/actionables` endpoint and its data are
    untouched — we store the enriched result in a separate `intel_runs`
    collection keyed by `doc_id`.
    """
    tree = _ts().load(doc_id)
    if tree is None:
        raise HTTPException(404, f"Document {doc_id} not found")

    existing = _runs().get(doc_id)
    if existing and not force:
        return _run_payload(existing)

    try:
        raw_result = _ex().extract(tree)
    except Exception as e:
        logger.exception("Raw extraction failed")
        raise HTTPException(500, f"Raw extraction failed: {e}")

    teams = _teams().list()
    run = _build_run(tree, raw_result.actionables, teams)
    _runs().save(run)

    return _run_payload(run)


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

    # denormalize team names if assigned_teams changed
    if "assigned_teams" in patch:
        team_map = {t.team_id: t.name for t in _teams().list()}
        patch["assigned_team_names"] = [team_map[t] for t in patch["assigned_teams"] if t in team_map]

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
    return {"status": "deleted", "doc_id": doc_id}


# ---------------------------------------------------------------------------
# Cross-document dashboard
# ---------------------------------------------------------------------------
@router.get("/dashboard")
def dashboard():
    summaries = _runs().list_summaries()
    teams = _teams().list()
    team_name_by_id = {t.team_id: t.name for t in teams}

    agg = {
        "total_actionables": 0,
        "total_notices": 0,
        "documents": len(summaries),
        "priority_counts": {"High": 0, "Medium": 0, "Low": 0},
        "category_counts": {},
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
        for k, v in stats.get("category_counts", {}).items():
            agg["category_counts"][k] = agg["category_counts"].get(k, 0) + v
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
    teams = _teams().list()
    groupings = build_groupings(run.actionables, teams)
    # always refresh stats on read to reflect latest patches
    stats = compute_stats(run.actionables, teams)
    run.stats = stats
    return {
        "doc_id": run.doc_id,
        "doc_name": run.doc_name,
        "actionables": [a.to_dict() for a in run.actionables],
        "notice_board": [n.to_dict() for n in run.notice_board],
        "team_snapshot": run.team_snapshot,
        "groupings": groupings,
        "stats": stats,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }
