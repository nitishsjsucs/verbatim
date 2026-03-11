"""Dynamic Teams Management API router.

Extracted from main.py as part of Phase 4 — Backend Layered Architecture.
"""
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

from app_backend.constants import (
    Collection, SYSTEM_TEAM_NAME, DEFAULT_TEAM_NAME,
)
from app_backend.deps import get_actionable_store
from app_backend.models.schemas import CreateTeamRequest, UpdateTeamRequest

logger = logging.getLogger("backend")

router = APIRouter(tags=["teams"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SYSTEM_TEAM = SYSTEM_TEAM_NAME

# Color palette for auto-assigning to new teams
_TEAM_COLOR_PALETTE = [
    {"bg": "bg-cyan-500/10",    "text": "text-cyan-400",    "header": "bg-cyan-500"},
    {"bg": "bg-rose-500/10",    "text": "text-rose-400",    "header": "bg-rose-500"},
    {"bg": "bg-emerald-500/10", "text": "text-emerald-400", "header": "bg-emerald-500"},
    {"bg": "bg-amber-500/10",   "text": "text-amber-400",   "header": "bg-amber-500"},
    {"bg": "bg-blue-500/10",    "text": "text-blue-400",    "header": "bg-blue-500"},
    {"bg": "bg-pink-500/10",    "text": "text-pink-400",    "header": "bg-pink-500"},
    {"bg": "bg-lime-500/10",    "text": "text-lime-400",    "header": "bg-lime-500"},
    {"bg": "bg-indigo-500/10",  "text": "text-indigo-400",  "header": "bg-indigo-500"},
    {"bg": "bg-orange-500/10",  "text": "text-orange-400",  "header": "bg-orange-500"},
    {"bg": "bg-teal-500/10",    "text": "text-teal-400",    "header": "bg-teal-500"},
    {"bg": "bg-fuchsia-500/10", "text": "text-fuchsia-400", "header": "bg-fuchsia-500"},
    {"bg": "bg-sky-500/10",     "text": "text-sky-400",     "header": "bg-sky-500"},
    {"bg": "bg-red-500/10",     "text": "text-red-400",     "header": "bg-red-500"},
    {"bg": "bg-violet-500/10",  "text": "text-violet-400",  "header": "bg-violet-500"},
    {"bg": "bg-yellow-500/10",  "text": "text-yellow-400",  "header": "bg-yellow-500"},
]

MIXED_TEAM_COLORS = {"bg": "bg-purple-500/10", "text": "text-purple-400", "header": "bg-purple-500"}
OTHER_TEAM_COLORS = {"bg": "bg-zinc-500/10", "text": "text-zinc-400", "header": "bg-zinc-500"}


# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def _color_key_to_classes(color_key: str) -> dict:
    """Convert a Tailwind color key (e.g. 'cyan', 'blue') to full class dict."""
    key = color_key.strip().lower()
    return {
        "bg": f"bg-{key}-500/10",
        "text": f"text-{key}-400",
        "header": f"bg-{key}-500",
    }


def _ensure_system_team():
    """Ensure the Mixed Team system team always exists with correct purple color."""
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]
    # Rename legacy "Mixed Team Projects" → "Mixed Team" if it still exists
    old = col.find_one({"name": "Mixed Team Projects"})
    if old:
        col.update_one({"name": "Mixed Team Projects"}, {"$set": {"name": SYSTEM_TEAM}})
        logger.info("Renamed system team: Mixed Team Projects → %s", SYSTEM_TEAM)
    existing = col.find_one({"name": SYSTEM_TEAM})
    hierarchy_fields = {"parent_name": None, "depth": 0, "path": []}
    if not existing:
        col.insert_one({
            "name": SYSTEM_TEAM,
            "is_system": True,
            "colors": MIXED_TEAM_COLORS,
            "summary": "System-generated classification for actionables assigned to multiple teams.",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "order": -1,  # Always first
            **hierarchy_fields,
        })
        logger.info("Seeded system team: %s", SYSTEM_TEAM)
    else:
        # Force purple color, ensure summary and hierarchy fields exist
        patch = {
            "colors": MIXED_TEAM_COLORS,
            "summary": existing.get("summary") or "System-generated classification for actionables assigned to multiple teams.",
        }
        for hk, hv in hierarchy_fields.items():
            if hk not in existing:
                patch[hk] = hv
        col.update_one({"name": SYSTEM_TEAM}, {"$set": patch})

    # ── Migrate legacy teams: add hierarchy fields if missing ──
    for team in col.find({"parent_name": {"$exists": False}}):
        col.update_one({"_id": team["_id"]}, {"$set": {"parent_name": None, "depth": 0, "path": []}})


def _get_descendants(col, team_name: str) -> list:
    """Return list of all descendant team names (recursive children)."""
    descendants = []
    children = list(col.find({"parent_name": team_name}, {"name": 1}))
    for child in children:
        descendants.append(child["name"])
        descendants.extend(_get_descendants(col, child["name"]))
    return descendants


def _get_ancestors(col, team_name: str) -> list:
    """Return list of ancestor team names from immediate parent up to root."""
    ancestors = []
    current = col.find_one({"name": team_name})
    while current and current.get("parent_name"):
        ancestors.append(current["parent_name"])
        current = col.find_one({"name": current["parent_name"]})
    return ancestors


def _is_leaf_team(col, team_name: str) -> bool:
    """Return True if team has no children."""
    return col.count_documents({"parent_name": team_name}) == 0


def _build_team_tree(teams_list: list) -> list:
    """Build nested tree from flat team list. Returns root-level nodes with children."""
    by_name = {t["name"]: {**t, "children": []} for t in teams_list}
    roots = []
    for t in teams_list:
        node = by_name[t["name"]]
        parent = t.get("parent_name")
        if parent and parent in by_name:
            by_name[parent]["children"].append(node)
        else:
            roots.append(node)
    return roots


def _recompute_descendant_paths(col, parent_name: str):
    """After re-parenting, recompute depth and path for all descendants."""
    parent = col.find_one({"name": parent_name})
    if not parent:
        return
    parent_depth = parent.get("depth", 0)
    parent_path = parent.get("path", [])
    children = list(col.find({"parent_name": parent_name}))
    for child in children:
        new_depth = parent_depth + 1
        new_path = parent_path + [parent_name]
        col.update_one({"name": child["name"]}, {"$set": {"depth": new_depth, "path": new_path}})
        _recompute_descendant_paths(col, child["name"])


def _cascade_team_rename(db, old_name: str, new_name: str):
    """Propagate a team rename across actionables, users, and chat collections."""
    store = get_actionable_store()
    act_col = store._collection

    for raw in act_col.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        result = store.load(doc_id)
        if not result:
            continue
        changed = False
        for a in result.actionables:
            # Rename workstream
            ws = a.workstream.value if hasattr(a.workstream, "value") else str(a.workstream)
            if ws == old_name:
                a.workstream = new_name
                changed = True
            # Rename in assigned_teams
            if old_name in (a.assigned_teams or []):
                a.assigned_teams = [new_name if t == old_name else t for t in a.assigned_teams]
                changed = True
            # Rename team_workflows key
            if isinstance(a.team_workflows, dict) and old_name in a.team_workflows:
                a.team_workflows[new_name] = a.team_workflows.pop(old_name)
                changed = True
        if changed:
            store.save(result)

    # Rename in user records
    auth_db_name = "govinda_auth"
    try:
        auth_db = db.client[auth_db_name]
        auth_db["user"].update_many({"team": old_name}, {"$set": {"team": new_name}})
    except Exception:
        pass

    # Rename chat collections
    for chat_col_name in ["team_chats", "global_chats"]:
        try:
            db[chat_col_name].update_many({"team": old_name}, {"$set": {"team": new_name}})
        except Exception:
            pass


def _cascade_team_delete(db, team_name: str) -> int:
    """Remove a deleted team from actionables. Returns count of affected items."""
    store = get_actionable_store()
    act_col = store._collection
    reassigned = 0

    for raw in act_col.find():
        doc_id = raw.get("doc_id", raw.get("_id", ""))
        result = store.load(doc_id)
        if not result:
            continue
        changed = False
        for a in result.actionables:
            ws = a.workstream.value if hasattr(a.workstream, "value") else str(a.workstream)

            # Single-team item with this workstream → reassign to default team
            if ws == team_name and not a.is_multi_team:
                a.workstream = DEFAULT_TEAM_NAME
                changed = True
                reassigned += 1

            # Remove from assigned_teams
            if team_name in (a.assigned_teams or []):
                a.assigned_teams = [t for t in a.assigned_teams if t != team_name]
                changed = True
                reassigned += 1

                # If only one team left, collapse to single-team
                if len(a.assigned_teams) == 1:
                    surviving = a.assigned_teams[0]
                    a.workstream = surviving
                    # Merge surviving team workflow back to top-level
                    tw = a.team_workflows.get(surviving, {})
                    for k, v in tw.items():
                        if hasattr(a, k) and v:
                            setattr(a, k, v)
                    a.team_workflows = {}
                    a.assigned_teams = []
                elif len(a.assigned_teams) == 0:
                    a.workstream = DEFAULT_TEAM_NAME
                    a.team_workflows = {}
                    a.assigned_teams = []

            # Remove team_workflows entry
            if isinstance(a.team_workflows, dict) and team_name in a.team_workflows:
                del a.team_workflows[team_name]
                changed = True

            # Recompute aggregate status if still multi-team
            if a.is_multi_team:
                a.compute_aggregate_status()

        if changed:
            store.save(result)

    return reassigned


# ---------------------------------------------------------------------------
# Route Handlers
# ---------------------------------------------------------------------------

@router.get("/teams")
def list_teams():
    """Return all teams ordered by 'order' field. System teams first.
    Each team includes: parent_name, depth, path, is_leaf."""
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]
    teams = list(col.find({}, {"_id": 0}).sort("order", 1))
    # Annotate each team with is_leaf
    child_parents = set(t.get("parent_name") for t in teams if t.get("parent_name"))
    for t in teams:
        t["is_leaf"] = t["name"] not in child_parents
    return {"teams": teams}


@router.get("/teams/tree")
def list_teams_tree():
    """Return teams as a nested tree structure."""
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]
    teams = list(col.find({}, {"_id": 0}).sort("order", 1))
    child_parents = set(t.get("parent_name") for t in teams if t.get("parent_name"))
    for t in teams:
        t["is_leaf"] = t["name"] not in child_parents
    tree = _build_team_tree(teams)
    return {"tree": tree}


@router.get("/teams/{team_name}/descendants")
def get_team_descendants(team_name: str):
    """Return all descendant team names for a given team."""
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]
    existing = col.find_one({"name": team_name})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Team '{team_name}' not found")
    descendants = _get_descendants(col, team_name)
    return {"team": team_name, "descendants": descendants}


@router.post("/teams")
def create_team(body: CreateTeamRequest):
    """Admin creates a new team. Cannot create system teams or duplicates.
    Supports hierarchy via parent_name."""
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name cannot be empty")
    if name == SYSTEM_TEAM:
        raise HTTPException(status_code=400, detail="Cannot create system team")

    existing = col.find_one({"name": name})
    if existing:
        raise HTTPException(status_code=409, detail=f"Team '{name}' already exists")

    # Resolve parent hierarchy
    parent_name = body.parent_name.strip() if body.parent_name else None
    depth = 0
    path = []
    if parent_name:
        parent_doc = col.find_one({"name": parent_name})
        if not parent_doc:
            raise HTTPException(status_code=400, detail=f"Parent team '{parent_name}' not found")
        depth = (parent_doc.get("depth") or 0) + 1
        path = (parent_doc.get("path") or []) + [parent_name]

    # Use user-selected color or inherit from parent or auto-assign from palette
    if body.color:
        colors = _color_key_to_classes(body.color)
    elif parent_name:
        parent_doc = col.find_one({"name": parent_name})
        colors = parent_doc.get("colors") if parent_doc else None
        if not colors:
            count = col.count_documents({"is_system": {"$ne": True}})
            colors = _TEAM_COLOR_PALETTE[count % len(_TEAM_COLOR_PALETTE)]
    else:
        count = col.count_documents({"is_system": {"$ne": True}})
        color_index = count % len(_TEAM_COLOR_PALETTE)
        colors = _TEAM_COLOR_PALETTE[color_index]

    count = col.count_documents({"is_system": {"$ne": True}})
    team_doc = {
        "name": name,
        "is_system": False,
        "colors": colors,
        "summary": body.summary.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "order": count + 1,
        "parent_name": parent_name,
        "depth": depth,
        "path": path,
    }
    col.insert_one(team_doc)
    team_doc.pop("_id", None)
    # Annotate is_leaf
    team_doc["is_leaf"] = True  # Newly created team has no children
    return team_doc


@router.delete("/teams/{team_name}")
def delete_team(team_name: str):
    """Admin deletes a team and all its descendants. Cannot delete system teams."""
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]

    existing = col.find_one({"name": team_name})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Team '{team_name}' not found")
    if existing.get("is_system"):
        raise HTTPException(status_code=403, detail="Cannot delete system team")

    # Collect all teams to delete (this team + all descendants)
    teams_to_delete = [team_name] + _get_descendants(col, team_name)

    reassigned_count = 0
    for tname in teams_to_delete:
        # ── Cascade: clean up actionables referencing this team ──
        reassigned_count += _cascade_team_delete(db, tname)

        col.delete_one({"name": tname})

        # Clean up user records — reassign users on this team to empty string
        auth_db_name = "govinda_auth"
        try:
            auth_db = db.client[auth_db_name]
            auth_db["user"].update_many({"team": tname}, {"$set": {"team": ""}})
        except Exception:
            pass

        # Clean up chat collections
        for chat_col_name in ["team_chats", "global_chats"]:
            try:
                db[chat_col_name].delete_many({"team": tname})
            except Exception:
                pass

    return {"deleted": teams_to_delete, "actionables_reassigned": reassigned_count}


@router.put("/teams/{team_name}")
def update_team(team_name: str, body: UpdateTeamRequest):
    """Admin updates a team. Cannot modify system teams. Supports re-parenting."""
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]

    existing = col.find_one({"name": team_name})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Team '{team_name}' not found")
    if existing.get("is_system"):
        raise HTTPException(status_code=403, detail="Cannot modify system team")

    updates = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.color is not None:
        updates["colors"] = _color_key_to_classes(body.color)
    elif body.colors is not None:
        updates["colors"] = body.colors
    if body.order is not None:
        updates["order"] = body.order
    if body.summary is not None:
        updates["summary"] = body.summary.strip()

    # Handle re-parenting
    if body.parent_name != "__UNSET__":
        new_parent = body.parent_name.strip() if body.parent_name else None
        if new_parent:
            if new_parent == team_name:
                raise HTTPException(status_code=400, detail="Team cannot be its own parent")
            descendants = _get_descendants(col, team_name)
            if new_parent in descendants:
                raise HTTPException(status_code=400, detail="Cannot set a descendant as parent (circular)")
            parent_doc = col.find_one({"name": new_parent})
            if not parent_doc:
                raise HTTPException(status_code=400, detail=f"Parent team '{new_parent}' not found")
            updates["parent_name"] = new_parent
            updates["depth"] = (parent_doc.get("depth") or 0) + 1
            updates["path"] = (parent_doc.get("path") or []) + [new_parent]
        else:
            updates["parent_name"] = None
            updates["depth"] = 0
            updates["path"] = []

    if updates:
        col.update_one({"name": team_name}, {"$set": updates})

    # If depth/path changed, update all descendants recursively
    if "depth" in updates or "path" in updates:
        final_name = updates.get("name", team_name)
        _recompute_descendant_paths(col, final_name)

    # ── Cascade name change to actionables, users, and chats ──
    new_name = updates.get("name")
    if new_name and new_name != team_name:
        _cascade_team_rename(db, team_name, new_name)
        # Also update parent_name references in children
        col.update_many({"parent_name": team_name}, {"$set": {"parent_name": new_name}})
        # Update path arrays in descendants
        col.update_many(
            {"path": team_name},
            [{"$set": {"path": {"$map": {"input": "$path", "as": "p", "in": {"$cond": [{"$eq": ["$$p", team_name]}, new_name, "$$p"]}}}}}]
        )

    final_name = updates.get("name", team_name)
    updated = col.find_one({"name": final_name}, {"_id": 0})
    if updated:
        updated["is_leaf"] = _is_leaf_team(col, final_name)
    return updated


@router.post("/teams/seed-defaults")
def seed_default_teams():
    """Seed hierarchical default teams. Idempotent — skips existing teams.
    Creates parent departments with sub-teams for a realistic hierarchy."""
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]

    # (name, colors, summary, parent_name)
    # Parent teams (depth 0)
    hierarchy = [
        # ── Root departments ──
        ("Policy", {"bg": "bg-purple-500/10", "text": "text-purple-400", "header": "bg-purple-500"}, "Policy and regulatory framework", None),
        ("Technology", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Technology and systems compliance", None),
        ("Operations", {"bg": "bg-blue-500/10", "text": "text-blue-400", "header": "bg-blue-500"}, "Operational process compliance", None),
        ("Training", {"bg": "bg-pink-500/10", "text": "text-pink-400", "header": "bg-pink-500"}, "Training and awareness programs", None),
        ("Reporting", {"bg": "bg-indigo-500/10", "text": "text-indigo-400", "header": "bg-indigo-500"}, "Regulatory reporting and disclosures", None),
        ("Customer Communication", {"bg": "bg-sky-500/10", "text": "text-sky-400", "header": "bg-sky-500"}, "Customer-facing compliance", None),
        ("Governance", {"bg": "bg-violet-500/10", "text": "text-violet-400", "header": "bg-violet-500"}, "Corporate governance and oversight", None),
        ("Legal", {"bg": "bg-fuchsia-500/10", "text": "text-fuchsia-400", "header": "bg-fuchsia-500"}, "Legal review and advisory", None),
        # ── Sub-teams (depth 1) ──
        ("Policy Drafting", {"bg": "bg-purple-500/10", "text": "text-purple-400", "header": "bg-purple-500"}, "Drafting and reviewing policy documents", "Policy"),
        ("Policy Review", {"bg": "bg-purple-500/10", "text": "text-purple-400", "header": "bg-purple-500"}, "Policy review and approval workflows", "Policy"),
        ("Infrastructure", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "IT infrastructure and security", "Technology"),
        ("App Development", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Application development compliance", "Technology"),
        ("Data & Analytics", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Data governance and analytics", "Technology"),
        ("Process Compliance", {"bg": "bg-blue-500/10", "text": "text-blue-400", "header": "bg-blue-500"}, "Operational process audits", "Operations"),
        ("Risk Management", {"bg": "bg-blue-500/10", "text": "text-blue-400", "header": "bg-blue-500"}, "Operational risk assessment", "Operations"),
        ("Internal Training", {"bg": "bg-pink-500/10", "text": "text-pink-400", "header": "bg-pink-500"}, "Internal staff training programs", "Training"),
        ("External Training", {"bg": "bg-pink-500/10", "text": "text-pink-400", "header": "bg-pink-500"}, "External partner training", "Training"),
        ("Regulatory Reporting", {"bg": "bg-indigo-500/10", "text": "text-indigo-400", "header": "bg-indigo-500"}, "Statutory and regulatory reports", "Reporting"),
        ("Internal Reporting", {"bg": "bg-indigo-500/10", "text": "text-indigo-400", "header": "bg-indigo-500"}, "Internal compliance reports", "Reporting"),
        # ── Sub-sub-teams (depth 2) ──
        ("Frontend Team", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Frontend application compliance", "App Development"),
        ("Backend Team", {"bg": "bg-cyan-500/10", "text": "text-cyan-400", "header": "bg-cyan-500"}, "Backend systems compliance", "App Development"),
    ]

    _ensure_system_team()

    seeded = []
    order_counter = 1
    for name, colors, summary, parent_name in hierarchy:
        if not col.find_one({"name": name}):
            # Compute hierarchy fields
            depth = 0
            path = []
            if parent_name:
                parent_doc = col.find_one({"name": parent_name})
                if parent_doc:
                    depth = (parent_doc.get("depth") or 0) + 1
                    path = (parent_doc.get("path") or []) + [parent_name]
            col.insert_one({
                "name": name,
                "is_system": False,
                "colors": colors,
                "summary": summary,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "order": order_counter,
                "parent_name": parent_name,
                "depth": depth,
                "path": path,
            })
            seeded.append(name)
        else:
            # Patch older teams: add hierarchy fields if missing
            patch = {}
            existing = col.find_one({"name": name})
            if "summary" not in existing:
                patch["summary"] = summary
            if "parent_name" not in existing:
                patch["parent_name"] = parent_name
                if parent_name:
                    parent_doc = col.find_one({"name": parent_name})
                    if parent_doc:
                        patch["depth"] = (parent_doc.get("depth") or 0) + 1
                        patch["path"] = (parent_doc.get("path") or []) + [parent_name]
                    else:
                        patch["depth"] = 0
                        patch["path"] = []
                else:
                    patch["depth"] = 0
                    patch["path"] = []
            if patch:
                col.update_one({"name": name}, {"$set": patch})
        order_counter += 1

    return {"seeded": seeded, "total_teams": col.count_documents({})}
