"""Admin configuration API router — dropdown configs, risk matrix, memory diagnostics, migration.

Extracted from main.py as part of Phase 4 — Backend Layered Architecture.
"""
import logging

from fastapi import APIRouter, HTTPException, Body

from app_backend.constants import Collection, PROTECTED_DROPDOWN_KEYS
from app_backend.deps import get_actionable_store
from app_backend.services.risk_service import recompute_risk_scores

logger = logging.getLogger("backend")

router = APIRouter(tags=["admin-config"])


# ─────────────────────────────────────────────────────────────────────────────
# Memory Health & Diagnostics Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/admin/memory/health")
def admin_memory_health(doc_id: str = ""):
    """
    Run health checks on all memory subsystems and infrastructure.
    Tests MongoDB, feature flags, each loop's status, data freshness,
    and contribution tracking.
    """
    from memory.memory_diagnostics import MemoryHealthChecker
    checker = MemoryHealthChecker()
    return checker.check_all(doc_id=doc_id or None)


@router.get("/admin/memory/diagnostics/trends")
def admin_memory_trends(doc_id: str = "", last_n: int = 50):
    """
    Compute improvement trends from stored per-query contribution snapshots.

    Returns:
    - overall: aggregate precision, contribution rate, memory-assisted citations
    - per_loop: fire rate, error rate, utilization for each of the 5 loops
    - precision_series: list for charting precision over time
    - improvement_score: composite 0-100 score with A-F grade
    """
    from memory.memory_diagnostics import MemoryTrendAnalyzer
    from utils.mongo import get_db
    try:
        db = get_db()
        analyzer = MemoryTrendAnalyzer(db)
        return analyzer.get_trends(
            doc_id=doc_id or None,
            last_n=min(last_n, 200),
        )
    except Exception as e:
        return {"error": str(e)}


@router.get("/admin/memory/diagnostics/recent")
def admin_memory_recent(doc_id: str = "", limit: int = 20):
    """
    Return the most recent per-query memory contribution snapshots.

    Each snapshot shows what each loop contributed and whether memory
    measurably helped that particular query.
    """
    from memory.memory_diagnostics import load_recent_contributions
    from utils.mongo import get_db
    try:
        db = get_db()
        contributions = load_recent_contributions(
            db, doc_id=doc_id or None, limit=min(limit, 50),
        )
        return {
            "count": len(contributions),
            "contributions": [c.to_dict() for c in contributions],
        }
    except Exception as e:
        return {"error": str(e)}


@router.get("/admin/memory/diagnostics")
def admin_memory_diagnostics(doc_id: str = ""):
    """
    Full memory diagnostics dashboard — combines health, trends, and recent data.

    Single endpoint that returns everything needed to assess whether the
    5 feedback loops are working and how much they contribute.
    """
    from memory.memory_diagnostics import (
        MemoryHealthChecker,
        MemoryTrendAnalyzer,
        load_recent_contributions,
    )
    from utils.mongo import get_db
    try:
        db = get_db()
        _doc_id = doc_id or None

        checker = MemoryHealthChecker()
        health = checker.check_all(doc_id=_doc_id)

        analyzer = MemoryTrendAnalyzer(db)
        trends = analyzer.get_trends(doc_id=_doc_id, last_n=50)

        recent = load_recent_contributions(db, doc_id=_doc_id, limit=10)

        return {
            "health": health,
            "trends": trends,
            "recent_contributions": [c.to_dict() for c in recent],
        }
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Dropdown Config — admin-managed option lists for actionable dropdowns
# Collection: dropdown_configs
# Schema: { _id: category_key, label: str, options: [{label: str, value: int}] }
# ─────────────────────────────────────────────────────────────────────────────

DROPDOWN_COLLECTION = Collection.DROPDOWN_CONFIGS

# Default seed data — provides sensible defaults on first boot (idempotent)
DEFAULT_DROPDOWN_CONFIGS = [
    # ── Theme (categorical only — no numeric score) ──
    {
        "_id": "theme",
        "label": "Theme",
        "options": [
            {"label": "Audit", "value": 0},
            {"label": "Branch Banking", "value": 0},
            {"label": "Business Continuity", "value": 0},
            {"label": "CMS", "value": 0},
            {"label": "Compliance", "value": 0},
            {"label": "Corporate Governance", "value": 0},
            {"label": "Credit Card", "value": 0},
            {"label": "Credit Risk", "value": 0},
            {"label": "Customer Service", "value": 0},
            {"label": "Cyber & Information Security", "value": 0},
            {"label": "Debit Card", "value": 0},
            {"label": "Deposit", "value": 0},
            {"label": "Digital Banking", "value": 0},
            {"label": "Employer Communications", "value": 0},
            {"label": "Financial Accounting & Records", "value": 0},
            {"label": "Information Technology Governance / Data Governance", "value": 0},
            {"label": "KYC / AML", "value": 0},
            {"label": "Loans & Advances", "value": 0},
            {"label": "Market Risk", "value": 0},
            {"label": "NPA & Restructuring", "value": 0},
            {"label": "Other Operating Regulations", "value": 0},
            {"label": "Outsourcing", "value": 0},
            {"label": "Priority Sector Lending (PSL)", "value": 0},
            {"label": "Third Party Products", "value": 0},
            {"label": "Trade & FEMA", "value": 0},
            {"label": "Treasury", "value": 0},
            {"label": "FCRM (Earlier part of the Vigilance theme)", "value": 0},
        ],
    },
    # ── Tranche 3 ──
    {
        "_id": "tranche3",
        "label": "Tranche 3",
        "options": [
            {"label": "No",  "value": 0},
            {"label": "Yes", "value": 1},
        ],
    },
    # ── Likelihood sub-dropdowns (3) — Member Role input ──
    {
        "_id": "likelihood_business_volume",
        "label": "Increase in Business Volumes",
        "options": [
            {"label": "Moderate Increase \u2014 Up to 15%", "value": 1},
            {"label": "Substantial Increase \u2014 Between 15% and 30%", "value": 2},
            {"label": "Very High Increase \u2014 More than 30%", "value": 3},
        ],
    },
    {
        "_id": "likelihood_products_processes",
        "label": "Changes in Products & Processes",
        "options": [
            {"label": "Products/processes rolled out during the year \u2014 Less than 4", "value": 1},
            {"label": "Products/processes rolled out during the year \u2014 Between 4 and 7", "value": 2},
            {"label": "Many products rolled out during the year \u2014 More than 7", "value": 3},
        ],
    },
    {
        "_id": "likelihood_compliance_violations",
        "label": "Compliance Violations in Previous 12 Months",
        "options": [
            {"label": "No violation", "value": 1},
            {"label": "1 violation", "value": 2},
            {"label": "Greater than 1", "value": 3},
        ],
    },
    # ── Impact (single dropdown — score is squared for overall impact) ──
    {
        "_id": "impact_dropdown",
        "label": "Impact Assessment",
        "options": [
            {"label": "No Significant Impact on occurrence of regulatory breach", "value": 1},
            {"label": "Material Impact", "value": 2},
            {"label": "Very High Regulatory or Reputational Impact", "value": 3},
        ],
    },
    # ── Control sub-dropdowns (2) — Member Role input ──
    # Scores are reversed: stronger control = lower score = lower risk
    {
        "_id": "control_monitoring",
        "label": "Monitoring Mechanism",
        "options": [
            {"label": "Automated", "value": 1},
            {"label": "Maker-Checker", "value": 2},
            {"label": "No Checker / No Control", "value": 3},
        ],
    },
    {
        "_id": "control_effectiveness",
        "label": "Control Effectiveness",
        "options": [
            {"label": "Well Controlled / Meets Requirements", "value": 1},
            {"label": "Improvement Needed", "value": 2},
            {"label": "Significant Improvement Needed", "value": 3},
        ],
    },
    # ── Inherent Risk (informational — label derived from score, not user-selectable) ──
    {
        "_id": "inherent_risk",
        "label": "Inherent Risk",
        "options": [
            {"label": "Low",    "value": 1},
            {"label": "Medium", "value": 2},
            {"label": "High",   "value": 3},
        ],
    },
    # ── Residual Risk (informational — label derived from matrix/score, not user-selectable) ──
    {
        "_id": "residual_risk",
        "label": "Residual Risk",
        "options": [
            {"label": "Satisfactory (Low)",          "value": 1},
            {"label": "Improvement Needed (Medium)",  "value": 2},
            {"label": "Weak (High)",                  "value": 3},
        ],
    },
    # ── Legacy flat keys (kept so old dropdown-configs API calls still work) ──
    {
        "_id": "impact",
        "label": "Impact (Legacy)",
        "options": [
            {"label": "Low",    "value": 1},
            {"label": "Medium", "value": 2},
            {"label": "High",   "value": 3},
        ],
    },
    {
        "_id": "likelihood",
        "label": "Likelihood (Legacy)",
        "options": [
            {"label": "Low",    "value": 1},
            {"label": "Medium", "value": 2},
            {"label": "High",   "value": 3},
        ],
    },
    {
        "_id": "control",
        "label": "Control (Legacy)",
        "options": [
            {"label": "Weak",     "value": 1},
            {"label": "Moderate", "value": 2},
            {"label": "Strong",   "value": 3},
        ],
    },
]


def seed_dropdown_configs():
    """Seed default dropdown categories — updates options to latest spec if they changed."""
    from utils.mongo import get_db
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    for cfg in DEFAULT_DROPDOWN_CONFIGS:
        col.update_one(
            {"_id": cfg["_id"]},
            {"$set": {"label": cfg["label"], "options": cfg["options"]}},
            upsert=True,
        )


@router.get("/dropdown-configs")
def list_dropdown_configs():
    """Return all dropdown categories and their options."""
    from utils.mongo import get_db
    db = get_db()
    docs = list(db[DROPDOWN_COLLECTION].find({}, {"_id": 1, "label": 1, "options": 1}))
    for d in docs:
        d["key"] = d.pop("_id")
    return {"configs": docs}


@router.get("/dropdown-configs/{category_key}")
def get_dropdown_config(category_key: str):
    """Return a single dropdown category by key."""
    from utils.mongo import get_db
    db = get_db()
    doc = db[DROPDOWN_COLLECTION].find_one({"_id": category_key})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Dropdown category '{category_key}' not found")
    doc["key"] = doc.pop("_id")
    return doc


@router.post("/dropdown-configs")
def create_dropdown_config(body: dict = Body(...)):
    """Admin: create a new dropdown category.
    Body: { key: str, label: str, options: [{label: str, value: int}] }"""
    from utils.mongo import get_db
    key = body.get("key", "").strip()
    label = body.get("label", "").strip()
    options = body.get("options", [])
    if not key:
        raise HTTPException(status_code=400, detail="'key' is required")
    if not label:
        raise HTTPException(status_code=400, detail="'label' is required")
    for opt in options:
        if "label" not in opt or "value" not in opt:
            raise HTTPException(status_code=400, detail="Each option must have 'label' and 'value'")
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    if col.find_one({"_id": key}):
        raise HTTPException(status_code=409, detail=f"Category '{key}' already exists")
    col.insert_one({"_id": key, "label": label, "options": options})
    return {"key": key, "label": label, "options": options}


@router.put("/dropdown-configs/{category_key}")
def update_dropdown_config(category_key: str, body: dict = Body(...)):
    """Admin: update a dropdown category's label and/or options.
    Body: { label?: str, options?: [{label: str, value: int}] }"""
    from utils.mongo import get_db
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    existing = col.find_one({"_id": category_key})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    updates: dict = {}
    if "label" in body:
        updates["label"] = body["label"]
    if "options" in body:
        for opt in body["options"]:
            if "label" not in opt or "value" not in opt:
                raise HTTPException(status_code=400, detail="Each option must have 'label' and 'value'")
        updates["options"] = body["options"]
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    col.update_one({"_id": category_key}, {"$set": updates})
    doc = col.find_one({"_id": category_key})
    doc["key"] = doc.pop("_id")
    return doc


@router.delete("/dropdown-configs/{category_key}")
def delete_dropdown_config(category_key: str):
    """Admin: delete a dropdown category. Protected keys cannot be deleted."""
    if category_key in PROTECTED_DROPDOWN_KEYS:
        raise HTTPException(status_code=403, detail=f"Category '{category_key}' is protected and cannot be deleted")
    from utils.mongo import get_db
    db = get_db()
    result = db[DROPDOWN_COLLECTION].delete_one({"_id": category_key})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    return {"deleted": category_key}


@router.post("/dropdown-configs/{category_key}/options")
def add_dropdown_option(category_key: str, body: dict = Body(...)):
    """Admin: append a new option to an existing category.
    Body: { label: str, value: int }"""
    from utils.mongo import get_db
    label = body.get("label", "").strip()
    value = body.get("value")
    if not label:
        raise HTTPException(status_code=400, detail="'label' is required")
    if value is None:
        raise HTTPException(status_code=400, detail="'value' is required")
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    existing = col.find_one({"_id": category_key})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    col.update_one({"_id": category_key}, {"$push": {"options": {"label": label, "value": value}}})
    doc = col.find_one({"_id": category_key})
    doc["key"] = doc.pop("_id")
    return doc


@router.put("/dropdown-configs/{category_key}/options/{option_index}")
def update_dropdown_option(category_key: str, option_index: int, body: dict = Body(...)):
    """Admin: update a specific option by index.
    Body: { label?: str, value?: int }"""
    from utils.mongo import get_db
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    existing = col.find_one({"_id": category_key})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    options = existing.get("options", [])
    if option_index < 0 or option_index >= len(options):
        raise HTTPException(status_code=404, detail=f"Option index {option_index} out of range")
    if "label" in body:
        options[option_index]["label"] = body["label"]
    if "value" in body:
        options[option_index]["value"] = body["value"]
    col.update_one({"_id": category_key}, {"$set": {"options": options}})
    doc = col.find_one({"_id": category_key})
    doc["key"] = doc.pop("_id")
    return doc


@router.delete("/dropdown-configs/{category_key}/options/{option_index}")
def delete_dropdown_option(category_key: str, option_index: int):
    """Admin: remove a specific option by index."""
    from utils.mongo import get_db
    db = get_db()
    col = db[DROPDOWN_COLLECTION]
    existing = col.find_one({"_id": category_key})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Category '{category_key}' not found")
    options = existing.get("options", [])
    if option_index < 0 or option_index >= len(options):
        raise HTTPException(status_code=404, detail=f"Option index {option_index} out of range")
    options.pop(option_index)
    col.update_one({"_id": category_key}, {"$set": {"options": options}})
    doc = col.find_one({"_id": category_key})
    doc["key"] = doc.pop("_id")
    return doc


# ─────────────────────────────────────────────────────────────────────────────
# Residual Risk Interpretation Matrix — admin-configurable mapping
# Collection: residual_risk_matrix
# Two entry types supported:
#   Range-based: { label, min_score, max_score }
#   Exact-match: { label, likelihood_score, impact_score, control_score }
# ─────────────────────────────────────────────────────────────────────────────

RISK_MATRIX_COLLECTION = Collection.RESIDUAL_RISK_MATRIX

DEFAULT_RISK_MATRIX = [
    {"label": "Low",    "min_score": 0,  "max_score": 9},
    {"label": "Medium", "min_score": 10, "max_score": 27},
    {"label": "High",   "min_score": 28, "max_score": 999},
]


def seed_risk_matrix():
    """Idempotently seed default residual risk matrix entries."""
    from utils.mongo import get_db
    db = get_db()
    col = db[RISK_MATRIX_COLLECTION]
    if col.count_documents({}) == 0:
        col.insert_many(DEFAULT_RISK_MATRIX)


@router.get("/risk-matrix")
def list_risk_matrix():
    """Return all residual risk interpretation matrix entries."""
    from utils.mongo import get_db
    db = get_db()
    docs = list(db[RISK_MATRIX_COLLECTION].find({}))
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return {"entries": docs}


@router.post("/risk-matrix")
def create_risk_matrix_entry(body: dict = Body(...)):
    """Admin: add a new matrix entry.
    Body: { label: str, min_score?: int, max_score?: int,
            likelihood_score?: int, impact_score?: int, control_score?: int }"""
    from utils.mongo import get_db
    label = body.get("label", "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="'label' is required")
    entry = {"label": label}
    for k in ("min_score", "max_score", "likelihood_score", "impact_score", "control_score"):
        if k in body:
            entry[k] = int(body[k])
    db = get_db()
    result = db[RISK_MATRIX_COLLECTION].insert_one(entry)
    entry["id"] = str(result.inserted_id)
    entry.pop("_id", None)
    return entry


@router.put("/risk-matrix/{entry_id}")
def update_risk_matrix_entry(entry_id: str, body: dict = Body(...)):
    """Admin: update a matrix entry by ID."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    col = db[RISK_MATRIX_COLLECTION]
    try:
        oid = ObjectId(entry_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid entry ID")
    existing = col.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Matrix entry not found")
    updates = {}
    if "label" in body:
        updates["label"] = body["label"]
    for k in ("min_score", "max_score", "likelihood_score", "impact_score", "control_score"):
        if k in body:
            updates[k] = int(body[k])
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    col.update_one({"_id": oid}, {"$set": updates})
    doc = col.find_one({"_id": oid})
    doc["id"] = str(doc.pop("_id"))
    return doc


@router.delete("/risk-matrix/{entry_id}")
def delete_risk_matrix_entry(entry_id: str):
    """Admin: remove a matrix entry by ID."""
    from utils.mongo import get_db
    from bson import ObjectId
    db = get_db()
    try:
        oid = ObjectId(entry_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid entry ID")
    result = db[RISK_MATRIX_COLLECTION].delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Matrix entry not found")
    return {"deleted": entry_id}


# ─────────────────────────────────────────────────────────────────────────────
# Migration: populate new risk fields for legacy actionables
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/admin/migrate-risk-fields")
def migrate_risk_fields():
    """Admin: backfill new structured risk fields for all existing actionables.

    For each actionable that lacks `impact_dropdown`, assigns safe defaults:
    - All sub-dropdowns get {"label": "Low", "score": 1}
    - Computed fields are recalculated using new formulas
    - Legacy flat fields are left untouched
    Only augments system-generated / computed fields — never touches
    fields fetched from original documents.
    """
    store = get_actionable_store()
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.ACTIONABLES]
    migrated = 0
    total = 0

    for doc in col.find({}):
        doc_id = doc.get("doc_id", "")
        result = store.load(doc_id)
        if not result:
            continue
        changed = False
        for a in result.actionables:
            total += 1
            # Only migrate items that don't yet have impact_dropdown populated
            needs_migration = (
                not a.impact_dropdown
                or not isinstance(a.impact_dropdown, dict)
                or not a.impact_dropdown.get("label")
            )
            if not needs_migration:
                # Still recompute scores to ensure consistency
                recompute_risk_scores(a)
                changed = True
                continue

            # Assign safe defaults for sub-dropdowns if empty
            default_low = {"label": "Low", "score": 1}
            default_weak = {"label": "Weak", "score": 1}

            if not a.likelihood_business_volume or not isinstance(a.likelihood_business_volume, dict) or not a.likelihood_business_volume.get("label"):
                a.likelihood_business_volume = dict(default_low)
            if not a.likelihood_products_processes or not isinstance(a.likelihood_products_processes, dict) or not a.likelihood_products_processes.get("label"):
                a.likelihood_products_processes = dict(default_low)
            if not a.likelihood_compliance_violations or not isinstance(a.likelihood_compliance_violations, dict) or not a.likelihood_compliance_violations.get("label"):
                a.likelihood_compliance_violations = dict(default_low)

            # Migrate impact: use impact_sub1 if available, else default
            if a.impact_sub1 and isinstance(a.impact_sub1, dict) and a.impact_sub1.get("label"):
                a.impact_dropdown = dict(a.impact_sub1)
            else:
                a.impact_dropdown = dict(default_low)

            if not a.control_monitoring or not isinstance(a.control_monitoring, dict) or not a.control_monitoring.get("label"):
                a.control_monitoring = dict(default_weak)
            if not a.control_effectiveness or not isinstance(a.control_effectiveness, dict) or not a.control_effectiveness.get("label"):
                a.control_effectiveness = dict(default_weak)

            # Recompute all derived scores
            recompute_risk_scores(a)
            changed = True
            migrated += 1

        if changed:
            result.compute_stats()
            store.save(result)

    return {
        "status": "ok",
        "total_actionables": total,
        "migrated": migrated,
        "message": f"Migrated {migrated} actionables with safe defaults. {total - migrated} already had impact_dropdown populated.",
    }
