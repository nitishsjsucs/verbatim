# GOVINDA Web Application — Architecture Optimization Plan

**Generated**: June 2025
**Scope**: Web application layer only (database, backend, API, React frontend, UI, performance)
**Constraint**: Preserve exact current business logic, workflows, role permissions, and AI/ML components

---

## Table of Contents

1. [Codebase Inventory & Metrics](#1-codebase-inventory--metrics)
2. [Phase 1: Shared Constants & Enums (Zero-Risk)](#phase-1)
3. [Phase 2: Database Schema Flattening](#phase-2)
4. [Phase 3: Database Migration Script](#phase-3)
5. [Phase 4: Backend Layered Architecture](#phase-4)
6. [Phase 5: Security — Session-Based Role Extraction](#phase-5)
7. [Phase 6: Database Indexes & Query Optimization](#phase-6)
8. [Phase 7: API Pagination & Filtering](#phase-7)
9. [Phase 8: Frontend Data Flow (Server-Side Pagination)](#phase-8)
10. [Phase 9: React Component Unification](#phase-9)
11. [Phase 10: UI Consistency](#phase-10)
12. [Phase 11: Performance Optimization](#phase-11)
13. [Phase 12: Validation & System Integrity](#phase-12)
14. [Execution Order & Dependencies](#execution-order)
15. [Risk Assessment](#risk-assessment)

---

## 1. Codebase Inventory & Metrics

### Backend (Python / FastAPI)

| File | Lines | Purpose |
|------|-------|---------|
| `app_backend/main.py` | 4,592 | **Monolithic** — ALL API routes, business logic, seeding, migrations |
| `models/actionable.py` | 587 | ActionableItem dataclass (100+ fields), ActionablesResult container |
| `tree/actionable_store.py` | 56 | MongoDB CRUD for actionables (document-embedded model) |
| `utils/mongo.py` | 70 | MongoDB connection manager, GridFS |

**Total backend**: ~5,300 lines in 4 files

### Frontend (React / Next.js / TypeScript)

| File | Lines | Purpose |
|------|-------|---------|
| `web/src/app/actionables/page.tsx` | 2,099 | CO actionables management |
| `web/src/app/dashboard/page.tsx` | 1,561 | CO compliance tracker |
| `web/src/app/team-review/page.tsx` | 1,304 | Reviewer dashboard |
| `web/src/app/team-board/page.tsx` | 1,238 | Member dashboard |
| `web/src/app/team-lead/page.tsx` | 1,071 | Lead oversight dashboard |
| `web/src/app/chief/page.tsx` | 622 | Chief oversight dashboard |
| `web/src/app/reports/page.tsx` | 790 | Reports page |
| `web/src/app/admin/page.tsx` | 3,163 | Admin dashboard |
| `web/src/lib/types.ts` | 707 | TypeScript interfaces |
| `web/src/lib/api.ts` | 1,080 | API client functions |
| `web/src/lib/status-config.ts` | 251 | Status/risk/role config |
| `web/src/lib/use-actionables.ts` | 134 | Shared data hook |
| `web/src/lib/use-teams.ts` | 166 | Team data hook |
| `web/src/components/dashboard/actionable-expansion.tsx` | 649 | Shared expansion component |
| `web/src/components/shared/status-components.tsx` | 418 | Shared status UI |
| `web/src/components/shared/comment-thread.tsx` | 154 | Shared comment UI |

**Total frontend**: ~15,400+ lines across 16 key files

### Identified Issues (Priority Order)

1. **Monolithic backend**: 4,592 lines in one file mixing routes, business logic, DB access, seeding
2. **Document-embedded actionables**: All actionables stored as arrays inside parent documents — no per-item querying, indexing, or pagination possible
3. **Client-trusted roles**: `caller_role` passed as query parameter from frontend — trivially spoofable
4. **Full dataset fetch**: `fetchAllActionables()` loads every actionable into memory on every page load
5. **Duplicated row components**: TaskRow (1,238L), ReviewRow (1,304L), OversightRow (1,071L), ChiefRow (622L) share ~70% identical logic
6. **Magic strings everywhere**: Roles, statuses, field names are raw strings in both Python and TypeScript
7. **No pagination or filtering**: Backend returns all data; all filtering/sorting done client-side
8. **No database indexes**: No compound or text indexes on actionables collection
9. **Redundant risk recomputation**: Risk scores recomputed on every single field update, not just risk field changes
10. **No input validation**: Backend accepts raw `dict` bodies with no Pydantic model validation

---

## Phase 1: Shared Constants & Enums (Zero-Risk) {#phase-1}

**Risk**: ⬜ None — pure refactor, no behavioral change
**Effort**: ~2 hours
**Dependencies**: None

### Goal
Replace magic strings with shared constants across Python and TypeScript. This is the safest possible change and immediately improves code quality.

### 1.1 Create `app_backend/constants.py`

```python
"""Shared constants for the GOVINDA backend."""
from enum import StrEnum

class UserRole(StrEnum):
    COMPLIANCE_OFFICER = "compliance_officer"
    TEAM_LEAD = "team_lead"
    TEAM_REVIEWER = "team_reviewer"
    TEAM_MEMBER = "team_member"
    CHIEF = "chief"
    ADMIN = "admin"

class TaskStatus(StrEnum):
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    TEAM_REVIEW = "team_review"
    REVIEW = "review"
    COMPLETED = "completed"
    REWORKING = "reworking"
    REVIEWER_REJECTED = "reviewer_rejected"
    AWAITING_JUSTIFICATION = "awaiting_justification"
    PENDING_ALL_TEAMS = "pending_all_teams"
    TAGGED_INCORRECTLY = "tagged_incorrectly"
    BYPASS_APPROVED = "bypass_approved"

class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"

class JustificationStatus(StrEnum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"

class ChatChannel(StrEnum):
    INTERNAL = "internal"
    COMPLIANCE = "compliance"

# Completed/terminal statuses where no further edits are allowed
TERMINAL_STATUSES = frozenset({TaskStatus.COMPLETED})

# Statuses where delay checking is skipped
DELAY_EXEMPT_STATUSES = frozenset({TaskStatus.COMPLETED, ""})

# Risk fields that only team roles can write (CO is read-only)
RISK_MEMBER_ONLY_FIELDS = frozenset({
    "likelihood_business_volume",
    "likelihood_products_processes",
    "likelihood_compliance_violations",
    "control_monitoring",
    "control_effectiveness",
})

# Protected dropdown config keys that cannot be deleted
PROTECTED_DROPDOWN_KEYS = frozenset({
    "impact", "likelihood", "control", "inherent_risk", "residual_risk",
    "tranche3", "theme", "likelihood_business_volume",
    "likelihood_products_processes", "likelihood_compliance_violations",
    "impact_dropdown", "control_monitoring", "control_effectiveness",
})

SYSTEM_TEAM_NAME = "Mixed Team"
```

### 1.2 Create `web/src/lib/constants.ts`

```typescript
/** Shared constants — single source of truth for roles, statuses, field names. */

export const UserRole = {
  COMPLIANCE_OFFICER: "compliance_officer",
  TEAM_LEAD: "team_lead",
  TEAM_REVIEWER: "team_reviewer",
  TEAM_MEMBER: "team_member",
  CHIEF: "chief",
  ADMIN: "admin",
} as const;
export type UserRoleValue = typeof UserRole[keyof typeof UserRole];

export const TaskStatus = {
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  TEAM_REVIEW: "team_review",
  REVIEW: "review",
  COMPLETED: "completed",
  REWORKING: "reworking",
  REVIEWER_REJECTED: "reviewer_rejected",
  AWAITING_JUSTIFICATION: "awaiting_justification",
  PENDING_ALL_TEAMS: "pending_all_teams",
  TAGGED_INCORRECTLY: "tagged_incorrectly",
  BYPASS_APPROVED: "bypass_approved",
} as const;
export type TaskStatusValue = typeof TaskStatus[keyof typeof TaskStatus];

export const ApprovalStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export const SYSTEM_TEAM_NAME = "Mixed Team";
```

### 1.3 Changes in `app_backend/main.py`

Replace all magic strings with enum references:

| Current Code | Replace With |
|---|---|
| `caller_role == "compliance_officer"` | `caller_role == UserRole.COMPLIANCE_OFFICER` |
| `body.role not in ("team_member", ...)` | `body.role not in (UserRole.TEAM_MEMBER, ...)` |
| `a.task_status not in ("completed", "")` | `a.task_status not in DELAY_EXEMPT_STATUSES` |
| `channel not in ("internal", "compliance")` | `channel not in (ChatChannel.INTERNAL, ChatChannel.COMPLIANCE)` |
| `"compliance_officer"` (31 occurrences) | `UserRole.COMPLIANCE_OFFICER` |
| `"completed"` (12 occurrences) | `TaskStatus.COMPLETED` |
| `"Mixed Team"` (5 occurrences) | `SYSTEM_TEAM_NAME` |

### 1.4 Changes in Frontend Pages

Replace string literals with `UserRole.*` and `TaskStatus.*` imports in:
- `team-board/page.tsx` (role checks, status comparisons)
- `team-review/page.tsx`
- `team-lead/page.tsx`
- `chief/page.tsx`
- `dashboard/page.tsx`
- `actionables/page.tsx`
- `status-config.ts` (use `TaskStatus` keys)

### Verification
```bash
# Backend
python -c "from app_backend.constants import UserRole, TaskStatus; print('OK')"

# Frontend
cd web && npx tsc --noEmit
```

---

## Phase 2: Database Schema Flattening {#phase-2}

**Risk**: 🟥 High — changes data model; requires coordinated backend + frontend changes
**Effort**: ~8-12 hours
**Dependencies**: Phase 1 (constants)

### Current Problem

Actionables are stored **embedded inside parent documents**:

```json
// actionables collection — ONE document per regulatory PDF
{
  "_id": "doc_abc123",
  "doc_id": "doc_abc123",
  "doc_name": "RBI Circular 2025",
  "actionables": [
    { "id": "ACT-001", "actor": "...", "task_status": "in_progress", ... },
    { "id": "ACT-002", "actor": "...", "task_status": "completed", ... },
    // ... potentially hundreds of items
  ],
  "stats": { ... }
}
```

This means:
- **Every query loads ALL actionables** for a document into memory
- **No per-item indexes** — can't query by status, team, deadline, etc.
- **No pagination** — backend returns everything, frontend filters
- **Concurrency risk** — two users updating different items in the same doc create a race condition (last-write-wins on the entire document)
- **Document size limit** — MongoDB 16MB document limit could be hit with hundreds of actionables with comments/audit trails

### Target Schema

```json
// actionables_flat collection — ONE document per actionable item
{
  "_id": "doc_abc123__ACT-001",       // compound key: doc_id + item_id
  "doc_id": "doc_abc123",
  "doc_name": "RBI Circular 2025",
  "item_id": "ACT-001",
  "actionable_id": "ACT-20250604-0001",
  "actor": "...",
  "task_status": "in_progress",
  "workstream": "Technology",
  "assigned_teams": ["Technology", "Operations"],
  "team_workflows": { ... },
  "deadline": "2025-07-01T00:00:00Z",
  "is_delayed": false,
  "approval_status": "approved",
  // ... all other fields at top level
  "created_at": "2025-06-01T00:00:00Z",
  "updated_at": "2025-06-04T12:00:00Z"
}
```

### 2.1 New File: `app_backend/repositories/actionable_repository.py`

```python
"""Flat actionable repository — one document per actionable item."""

class ActionableRepository:
    COLLECTION = "actionables_flat"

    def __init__(self, db):
        self._col = db[self.COLLECTION]

    def find_by_id(self, doc_id: str, item_id: str) -> dict | None:
        return self._col.find_one({"doc_id": doc_id, "item_id": item_id})

    def find_by_doc(self, doc_id: str) -> list[dict]:
        return list(self._col.find({"doc_id": doc_id}))

    def find_all(self, filters: dict = None, skip: int = 0, limit: int = 0,
                 sort: list = None) -> tuple[list[dict], int]:
        query = filters or {}
        total = self._col.count_documents(query)
        cursor = self._col.find(query)
        if sort:
            cursor = cursor.sort(sort)
        if skip:
            cursor = cursor.skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        return list(cursor), total

    def update_one(self, doc_id: str, item_id: str, updates: dict) -> dict | None:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        result = self._col.find_one_and_update(
            {"doc_id": doc_id, "item_id": item_id},
            {"$set": updates},
            return_document=True,
        )
        return result

    def upsert(self, doc_id: str, item_id: str, data: dict):
        self._col.replace_one(
            {"doc_id": doc_id, "item_id": item_id},
            {**data, "doc_id": doc_id, "item_id": item_id},
            upsert=True,
        )

    def delete_one(self, doc_id: str, item_id: str) -> bool:
        result = self._col.delete_one({"doc_id": doc_id, "item_id": item_id})
        return result.deleted_count > 0

    def count_by_doc(self, doc_id: str) -> int:
        return self._col.count_documents({"doc_id": doc_id})
```

### 2.2 Backward Compatibility

The **existing `ActionableStore`** (embedded model) must continue working for the AI extraction pipeline which creates actionables in bulk. The migration strategy:

1. **Extraction pipeline** continues writing to the embedded `actionables` collection
2. **A post-extraction hook** flattens new items into `actionables_flat`
3. **All API reads** switch to `actionables_flat`
4. **All API writes** update `actionables_flat` (with write-back to embedded for extraction pipeline compat)

This dual-write approach allows rolling back if issues arise.

### 2.3 Files to Modify

| File | Change |
|------|--------|
| `app_backend/main.py` | Replace `store.load(doc_id)` → `repo.find_by_id(doc_id, item_id)` in update/delete endpoints |
| `app_backend/main.py` | Replace `list_all_actionables()` → paginated `repo.find_all()` |
| `tree/actionable_store.py` | Add `flatten_to_repo()` method called after `save()` |
| `web/src/lib/api.ts` | Update `fetchAllActionables()` to accept pagination params |
| `web/src/lib/types.ts` | No change needed (ActionableItem interface stays the same) |

### Verification
```bash
# Run migration script (Phase 3)
# Verify: count(actionables_flat) == sum of all embedded actionable counts
# Verify: each flat document has all expected fields
# Verify: API returns identical data before and after switch
```

---

## Phase 3: Database Migration Script {#phase-3}

**Risk**: 🟧 Medium — data migration, but non-destructive (creates new collection)
**Effort**: ~2-3 hours
**Dependencies**: Phase 2 (schema design)

### 3.1 New File: `scripts/migrate_to_flat_actionables.py`

```python
"""
Migrate embedded actionables to flat collection.

Non-destructive: creates actionables_flat alongside existing actionables collection.
Idempotent: safe to run multiple times.

Usage:
    python scripts/migrate_to_flat_actionables.py [--dry-run] [--verify]
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.mongo import get_db
from datetime import datetime, timezone

def migrate(dry_run=False, verify=False):
    db = get_db()
    source = db["actionables"]
    target = db["actionables_flat"]

    migrated = 0
    skipped = 0
    errors = []

    for doc in source.find():
        doc_id = doc.get("doc_id", doc.get("_id", ""))
        doc_name = doc.get("doc_name", doc_id)

        for item in doc.get("actionables", []):
            item_id = item.get("id", "")
            if not item_id:
                errors.append(f"doc={doc_id}: item missing 'id' field")
                continue

            flat_key = f"{doc_id}__{item_id}"

            # Check if already migrated
            if target.find_one({"_id": flat_key}):
                skipped += 1
                continue

            flat_doc = {
                "_id": flat_key,
                "doc_id": doc_id,
                "doc_name": doc_name,
                "item_id": item_id,
                **item,
                "migrated_at": datetime.now(timezone.utc).isoformat(),
            }
            # Remove nested 'id' field (now 'item_id')
            flat_doc.pop("id", None)

            if not dry_run:
                target.replace_one({"_id": flat_key}, flat_doc, upsert=True)

            migrated += 1

    print(f"Migrated: {migrated}, Skipped (already exists): {skipped}, Errors: {len(errors)}")
    for e in errors:
        print(f"  ERROR: {e}")

    if verify:
        verify_migration(db)

def verify_migration(db):
    """Verify flat collection matches embedded collection exactly."""
    source = db["actionables"]
    target = db["actionables_flat"]

    embedded_count = 0
    for doc in source.find():
        embedded_count += len(doc.get("actionables", []))

    flat_count = target.count_documents({})
    match = embedded_count == flat_count

    print(f"\nVerification:")
    print(f"  Embedded items: {embedded_count}")
    print(f"  Flat items:     {flat_count}")
    print(f"  Match: {'✅ YES' if match else '❌ NO — MISMATCH'}")

    if not match:
        # Find missing items
        flat_ids = set(d["_id"] for d in target.find({}, {"_id": 1}))
        for doc in source.find():
            doc_id = doc.get("doc_id", doc.get("_id", ""))
            for item in doc.get("actionables", []):
                key = f"{doc_id}__{item.get('id', '')}"
                if key not in flat_ids:
                    print(f"  MISSING: {key}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run, verify=args.verify)
```

### 3.2 Index Creation Script

```python
# In the same script or as a separate step:
def create_indexes(db):
    col = db["actionables_flat"]

    # Primary lookup patterns
    col.create_index("doc_id")
    col.create_index("item_id")
    col.create_index([("doc_id", 1), ("item_id", 1)], unique=True)

    # Filtering patterns
    col.create_index("task_status")
    col.create_index("approval_status")
    col.create_index("workstream")
    col.create_index("is_delayed")
    col.create_index("deadline")
    col.create_index("assigned_teams")

    # Compound indexes for common query patterns
    col.create_index([("approval_status", 1), ("workstream", 1)])
    col.create_index([("task_status", 1), ("is_delayed", 1)])
    col.create_index([("task_status", 1), ("deadline", 1)])

    # Text search
    col.create_index([
        ("actor", "text"),
        ("action", "text"),
        ("object", "text"),
        ("actionable_id", "text"),
        ("implementation_notes", "text"),
    ], name="actionable_text_search")

    print("Indexes created successfully")
```

### Execution

```bash
# Step 1: Dry run — see what would be migrated
python scripts/migrate_to_flat_actionables.py --dry-run

# Step 2: Run migration
python scripts/migrate_to_flat_actionables.py

# Step 3: Verify
python scripts/migrate_to_flat_actionables.py --verify
```

---

## Phase 4: Backend Layered Architecture {#phase-4}

**Risk**: 🟧 Medium — large refactor but no behavior change
**Effort**: ~12-16 hours
**Dependencies**: Phase 2 + 3 (flat schema)

### Current Problem

`main.py` (4,592 lines) contains:
- 45+ route handlers
- Business logic (risk computation, delay detection, team cascading)
- Database access (direct MongoDB calls)
- Pydantic models
- Seed data
- Admin login
- LLM benchmark endpoints

### Target Structure

```
app_backend/
├── main.py                    # FastAPI app, middleware, startup — ~100 lines
├── constants.py               # Shared enums/constants (Phase 1)
├── models/
│   ├── __init__.py
│   ├── requests.py            # Pydantic request models
│   └── responses.py           # Pydantic response models
├── repositories/
│   ├── __init__.py
│   ├── actionable_repo.py     # Flat actionable CRUD
│   ├── team_repo.py           # Team CRUD
│   ├── chat_repo.py           # Chat/message CRUD
│   ├── dropdown_repo.py       # Dropdown config CRUD
│   └── risk_matrix_repo.py    # Risk matrix CRUD
├── services/
│   ├── __init__.py
│   ├── actionable_service.py  # Business logic: update, risk, delay, justification
│   ├── team_service.py        # Team management, cascading
│   └── risk_service.py        # Risk score computation
├── routers/
│   ├── __init__.py
│   ├── actionables.py         # /documents/{}/actionables/*, /actionables/*
│   ├── documents.py           # /documents/*
│   ├── teams.py               # /teams/*
│   ├── chat.py                # /chat/*, /team-chat/*
│   ├── admin.py               # /admin/*
│   ├── dropdowns.py           # /dropdown-configs/*
│   ├── risk_matrix.py         # /risk-matrix/*
│   ├── conversations.py       # /conversations/*
│   ├── corpus.py              # /corpus/*
│   └── health.py              # /health, /config, /storage
└── middleware/
    └── auth.py                # Session-based role extraction (Phase 5)
```

### Migration Strategy

**Do NOT rewrite all 4,592 lines at once.** Instead:

1. **Extract models** → `models/requests.py`, `models/responses.py` (lines 214-330)
2. **Extract repositories** one at a time (each is a standalone class)
3. **Extract services** (business logic functions like `_recompute_risk_scores`, `_cascade_team_rename`)
4. **Extract routers** one at a time, importing from services/repos
5. **Slim down `main.py`** to just app setup + `include_router()` calls

Each step can be verified independently:
```bash
cd app_backend && python -m pytest  # if tests exist
# or manual verification via API calls
```

### 4.1 Detailed File Breakdown

#### `routers/actionables.py` — Extract from main.py lines 1434-1852

| Current Function (main.py) | New Location |
|---|---|
| `list_all_actionables()` L1434 | `routers/actionables.py` |
| `update_actionable()` L1457 | `routers/actionables.py` → calls `services/actionable_service.py` |
| `create_manual_actionable()` L1750 | `routers/actionables.py` |
| `get_approved_by_team()` L1816 | `routers/actionables.py` |
| `delete_actionable()` L1839 | `routers/actionables.py` |
| `check_delays()` L2653 | `routers/actionables.py` → calls `services/actionable_service.py` |
| `get_delayed_actionables()` L2725 | `routers/actionables.py` |
| `submit_justification()` L2753 | `routers/actionables.py` → calls `services/actionable_service.py` |
| `get_audit_trail()` L2837 | `routers/actionables.py` |

#### `services/actionable_service.py` — Extract business logic

| Current Function (main.py) | New Location |
|---|---|
| `_recompute_risk_scores()` L1599 | `services/risk_service.py` |
| `_safe_score()` L1588 | `services/risk_service.py` |
| `_classify_inherent_risk()` L1645 | `services/risk_service.py` |
| `_resolve_residual_risk_label()` L1656 | `services/risk_service.py` |
| `_interpret_residual_risk()` L1682 | `services/risk_service.py` |
| `_cascade_team_rename()` L3617 | `services/team_service.py` |
| `_cascade_team_delete()` L3463 | `services/team_service.py` |
| `_ensure_system_team()` L3227 | `services/team_service.py` |

#### `routers/teams.py` — Extract from main.py lines 3188-3748

| Current Function | New Location |
|---|---|
| `list_teams()` L3311 | `routers/teams.py` |
| `list_teams_tree()` L3326 | `routers/teams.py` |
| `create_team()` L3360 | `routers/teams.py` |
| `update_team()` L3530 | `routers/teams.py` |
| `delete_team()` L3422 | `routers/teams.py` |
| `seed_default_teams()` L3661 | `routers/teams.py` |

#### `routers/chat.py` — Extract from main.py lines 2856-3186

All team-chat and global-chat endpoints.

#### `routers/admin.py` — Extract from main.py lines 2274-2646 + 3748-4060

Admin login, overview, queries, benchmarks, memory diagnostics.

#### `routers/dropdowns.py` — Extract from main.py lines 4063-4398

All dropdown config CRUD endpoints.

#### `routers/risk_matrix.py` — Extract from main.py lines 4400-4505

All risk matrix CRUD endpoints.

### 4.2 `main.py` After Refactor (~60 lines)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app_backend.routers import (
    actionables, documents, teams, chat,
    admin, dropdowns, risk_matrix, conversations,
    corpus, health,
)

app = FastAPI(title="Govinda V2 API")
# ... CORS setup ...

app.include_router(health.router)
app.include_router(documents.router, prefix="/documents", tags=["documents"])
app.include_router(actionables.router, tags=["actionables"])
app.include_router(teams.router, prefix="/teams", tags=["teams"])
app.include_router(chat.router, tags=["chat"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])
app.include_router(dropdowns.router, tags=["dropdowns"])
app.include_router(risk_matrix.router, tags=["risk-matrix"])
app.include_router(conversations.router, tags=["conversations"])
app.include_router(corpus.router, tags=["corpus"])

@app.on_event("startup")
async def startup():
    _init_singletons()
```

---

## Phase 5: Security — Session-Based Role Extraction {#phase-5}

**Risk**: 🟧 Medium — changes auth flow
**Effort**: ~4-6 hours
**Dependencies**: Phase 4 (layered architecture)

### Current Problem

```python
# main.py L1458 — role comes from the CLIENT, trivially spoofable
def update_actionable(..., caller_role: str = Query("")):
    if caller_role == "compliance_officer":
        for blocked in RISK_MEMBER_ONLY_FIELDS:
            body.pop(blocked, None)
```

The frontend sends the role as a query parameter:
```typescript
// api.ts L304-305
if (forTeam) qs.set('for_team', forTeam);
if (callerRole) qs.set('caller_role', callerRole);
```

### Target: Server-Side Role Resolution

#### 5.1 New File: `app_backend/middleware/auth.py`

```python
"""Extract authenticated user from Better Auth session token."""
from fastapi import Request, HTTPException
from utils.mongo import get_db

AUTH_DB_NAME = "govinda_auth"

async def get_current_user(request: Request) -> dict:
    """Extract user from session cookie/header.

    Better Auth stores sessions in govinda_auth.session collection.
    The session token is in the 'better-auth.session_token' cookie.

    Returns: { "id": str, "email": str, "role": str, "team": str, "name": str }
    """
    # 1. Extract session token from cookie
    token = request.cookies.get("better-auth.session_token")
    if not token:
        # Fallback: check Authorization header
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # 2. Look up session in auth DB
    db = get_db().client[AUTH_DB_NAME]
    session = db["session"].find_one({"token": token})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    # 3. Check expiry
    from datetime import datetime, timezone
    expires = session.get("expiresAt")
    if expires and expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    # 4. Look up user
    user_id = session.get("userId")
    user = db["user"].find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return {
        "id": str(user["_id"]),
        "email": user.get("email", ""),
        "name": user.get("name", ""),
        "role": user.get("role", "team_member"),
        "team": user.get("team", ""),
    }
```

#### 5.2 Usage in Routers

```python
from fastapi import Depends
from app_backend.middleware.auth import get_current_user

@router.put("/documents/{doc_id}/actionables/{item_id}")
def update_actionable(
    doc_id: str,
    item_id: str,
    body: dict = Body(...),
    for_team: str = Query(""),
    user: dict = Depends(get_current_user),  # replaces caller_role
):
    caller_role = user["role"]  # now server-verified
    ...
```

#### 5.3 Frontend Changes

Remove `callerRole` from all API calls:

```typescript
// api.ts — remove callerRole parameter
export async function updateActionable(
    docId: string,
    itemId: string,
    updates: Record<string, unknown>,
    forTeam?: string,
    // callerRole parameter REMOVED — server extracts from session
): Promise<ActionableItem> {
    const qs = new URLSearchParams();
    if (forTeam) qs.set('for_team', forTeam);
    // No more caller_role in query string
    ...
```

**Files affected**:
- `web/src/lib/api.ts` — remove `callerRole` param from `updateActionable()`
- `web/src/lib/use-actionables.ts` — remove `callerRole` from `handleUpdate()`
- All 6 role pages that pass `callerRole` to update calls

---

## Phase 6: Database Indexes & Query Optimization {#phase-6}

**Risk**: ⬜ None — additive only
**Effort**: ~1-2 hours
**Dependencies**: Phase 3 (flat collection exists)

### 6.1 Indexes for `actionables_flat`

See Phase 3 section 3.2 for the full index list.

### 6.2 Indexes for Existing Collections

```python
# teams collection
db["teams"].create_index("name", unique=True)
db["teams"].create_index("parent_name")
db["teams"].create_index("order")

# team_chats / global_chats
db["team_chats"].create_index([("team", 1), ("channel", 1)])
db["global_chats"].create_index("channel", unique=True)

# dropdown_configs — already uses _id as key

# chat_read_cursors
db["chat_read_cursors"].create_index([("role", 1), ("team", 1)])
```

### 6.3 Query Pattern Optimization

**Current** (loads entire collection into memory):
```python
# main.py L1440 — iterates ALL documents
for raw in db.find():
    doc_id = raw.get("doc_id", raw.get("_id", ""))
    ...
```

**After** (targeted queries with indexes):
```python
# With flat collection — direct indexed query
items, total = repo.find_all(
    filters={"task_status": "in_progress", "workstream": team_name},
    sort=[("deadline", 1)],
    skip=page * page_size,
    limit=page_size,
)
```

---

## Phase 7: API Pagination & Filtering {#phase-7}

**Risk**: 🟨 Low-Medium — new API shape, but old shape can be maintained as fallback
**Effort**: ~4-6 hours
**Dependencies**: Phase 2 + 3 + 6 (flat collection with indexes)

### 7.1 New API Shape: `GET /actionables`

**Before** (returns everything):
```json
[
  { "doc_id": "...", "actionables": [...], "stats": {...} },
  { "doc_id": "...", "actionables": [...], "stats": {...} }
]
```

**After** (paginated, filterable):
```
GET /actionables?page=1&page_size=50&status=in_progress&team=Technology&sort=deadline&order=asc&search=KYC
```

Response:
```json
{
  "items": [ { "doc_id": "...", "item_id": "ACT-001", ... } ],
  "total": 342,
  "page": 1,
  "page_size": 50,
  "pages": 7
}
```

### 7.2 Backward Compatibility

Keep the old `GET /actionables` response shape available at `GET /actionables/legacy` for any consumers that haven't migrated yet.

### 7.3 New Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /actionables` | Paginated list with filtering |
| `GET /actionables/stats` | Aggregate counts by status, team, risk level |
| `GET /actionables/by-team/{team}` | Pre-filtered by team (replaces client-side filter) |
| `GET /actionables/{doc_id}/{item_id}` | Single item fetch |

### 7.4 Filter Parameters

| Parameter | Type | Description |
|---|---|---|
| `page` | int | Page number (1-indexed) |
| `page_size` | int | Items per page (default 50, max 200) |
| `status` | string | Filter by task_status |
| `approval` | string | Filter by approval_status |
| `team` | string | Filter by workstream or assigned_teams contains |
| `delayed` | bool | Filter delayed items |
| `search` | string | Text search across actor, action, object, actionable_id |
| `sort` | string | Sort field (deadline, status, created_at) |
| `order` | string | asc or desc |

---

## Phase 8: Frontend Data Flow — Server-Side Pagination {#phase-8}

**Risk**: 🟨 Low-Medium — update hooks and pages
**Effort**: ~6-8 hours
**Dependencies**: Phase 7 (paginated API)

### 8.1 New `useActionables` Hook

```typescript
interface UseActionablesOptions {
  forTeam?: string;
  status?: string;
  search?: string;
  pageSize?: number;
  autoLoad?: boolean;
}

interface PaginatedResult {
  items: ActionableItem[];
  total: number;
  page: number;
  pages: number;
}

export function useActionables(opts: UseActionablesOptions = {}) {
  const [data, setData] = React.useState<PaginatedResult | null>(null);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (p = page) => {
    setLoading(true);
    const result = await fetchActionablesPaginated({
      page: p,
      pageSize: opts.pageSize ?? 50,
      team: opts.forTeam,
      status: opts.status,
      search: opts.search,
    });
    setData(result);
    setLoading(false);
  }, [page, opts.forTeam, opts.status, opts.search]);

  // ... update handler with optimistic UI
}
```

### 8.2 Page-Level Changes

Each role page currently does:
```typescript
const { allDocs, allItems, handleUpdate } = useActionables({ forTeam: team });
// Then filters allItems client-side by status, team, search, etc.
```

After:
```typescript
const { data, loading, handleUpdate, setPage } = useActionables({
  forTeam: team,
  status: activeTab === "completed" ? "completed" : undefined,
  search: searchTerm,
  pageSize: 50,
});
// No client-side filtering needed — server already filtered
```

### 8.3 Files to Modify

| File | Change |
|---|---|
| `web/src/lib/api.ts` | Add `fetchActionablesPaginated()` function |
| `web/src/lib/use-actionables.ts` | Rewrite for pagination support |
| `web/src/app/team-board/page.tsx` | Remove client-side filtering, add pagination controls |
| `web/src/app/team-review/page.tsx` | Same |
| `web/src/app/team-lead/page.tsx` | Same |
| `web/src/app/chief/page.tsx` | Same |
| `web/src/app/dashboard/page.tsx` | Same |
| `web/src/app/actionables/page.tsx` | Same |

---

## Phase 9: React Component Unification {#phase-9}

**Risk**: 🟨 Low-Medium — UI refactor
**Effort**: ~8-12 hours
**Dependencies**: Phase 8 (data flow updated)

### Current Duplication

| Component | File | Lines | Duplicated Logic |
|---|---|---|---|
| `TaskRow` | `team-board/page.tsx` | ~600 | Row layout, expand/collapse, comments, evidence, risk dropdowns |
| `ReviewRow` | `team-review/page.tsx` | ~700 | Same + approve/reject buttons |
| `OversightRow` | `team-lead/page.tsx` | ~500 | Same + justification approval |
| Chief Row | `chief/page.tsx` | ~300 | Same but read-only |
| Dashboard Row | `dashboard/page.tsx` | ~400 | Same + CO-specific actions |

**Estimated shared code**: ~70% identical across all 5 row components.

### 9.1 Unified Component: `ActionableRow`

```
web/src/components/shared/actionable-row/
├── index.tsx              # Main ActionableRow component
├── row-header.tsx         # Collapsed row display (status, title, deadline, team)
├── row-expansion.tsx      # Expanded content container
├── sections/
│   ├── risk-assessment.tsx    # Theme/Tranche/Impact/Likelihood/Control
│   ├── evidence-section.tsx   # File upload and display
│   ├── comments-section.tsx   # Comment thread
│   ├── workflow-actions.tsx   # Status transitions, approve/reject
│   ├── justification.tsx      # Delay justification chain
│   └── circular-info.tsx      # Source document info
└── types.ts               # ActionableRowProps interface
```

### 9.2 Role Configuration Pattern

```typescript
interface ActionableRowConfig {
  role: UserRoleValue;
  // Visibility
  showRiskDropdowns: boolean;       // Member, Reviewer: true; Lead, Chief: false
  showRiskSummary: boolean;         // CO only: true
  showLikelihoodControl: boolean;   // Member, Reviewer: true
  showThemeTranche: boolean;        // All: true (read-only for non-CO)
  showEvidenceUpload: boolean;      // Member, Lead: true when editable
  showCommentInput: boolean;        // Member, Reviewer: true; Lead: optional; Chief: false
  // Actions
  showApproveReject: boolean;       // Reviewer: true
  showBypassActions: boolean;       // Reviewer: true
  showJustificationApproval: boolean; // Lead: true
  showCOActions: boolean;           // CO: true
  // Editability
  isReadOnly: (status: TaskStatus) => boolean;
}

const ROLE_CONFIGS: Record<string, ActionableRowConfig> = {
  team_member: { showRiskDropdowns: true, showLikelihoodControl: true, ... },
  team_reviewer: { showRiskDropdowns: true, showApproveReject: true, ... },
  team_lead: { showRiskDropdowns: false, showJustificationApproval: true, ... },
  chief: { showRiskDropdowns: false, isReadOnly: () => true, ... },
  compliance_officer: { showRiskSummary: true, showCOActions: true, ... },
};
```

### 9.3 Estimated Line Reduction

| Current | Lines | After Unification | Lines |
|---|---|---|---|
| TaskRow (team-board) | ~600 | Role config + ActionableRow usage | ~30 |
| ReviewRow (team-review) | ~700 | Role config + ActionableRow usage | ~30 |
| OversightRow (team-lead) | ~500 | Role config + ActionableRow usage | ~30 |
| Chief row (chief) | ~300 | Role config + ActionableRow usage | ~30 |
| Dashboard row (dashboard) | ~400 | Role config + ActionableRow usage | ~30 |
| **Total** | **~2,500** | **ActionableRow component** | **~800** |

**Net reduction**: ~1,700 lines of duplicated code removed.

---

## Phase 10: UI Consistency {#phase-10}

**Risk**: ⬜ None — styling only
**Effort**: ~2-3 hours
**Dependencies**: Phase 9 (unified components)

### 10.1 Issues to Fix

1. **Grid column widths** vary slightly across role pages
2. **Header styling** (font sizes, padding, colors) differ between Active/Completed sections
3. **Expansion animation** inconsistent (some pages use `transition-all`, others don't)
4. **Empty state** messages differ ("No actionables" vs "No items found" vs nothing)
5. **Loading skeleton** styles differ between pages

### 10.2 Solution

Once Phase 9 unifies the row component, these inconsistencies are automatically resolved — all pages use the same component with the same styling.

Additional cleanup:
- Standardize section header component
- Standardize empty state component
- Standardize loading skeleton

---

## Phase 11: Performance Optimization {#phase-11}

**Risk**: ⬜ None — optimization only
**Effort**: ~3-4 hours
**Dependencies**: Phase 8 + 9

### 11.1 React.memo for Row Components

```typescript
export const ActionableRow = React.memo(function ActionableRow(props: ActionableRowProps) {
  // ...
}, (prev, next) => {
  // Custom comparison — only re-render if actionable data changed
  return prev.item === next.item && prev.expanded === next.expanded;
});
```

### 11.2 Debounced Search

```typescript
// Current: triggers API call on every keystroke
// After: debounce search input by 300ms
const [searchInput, setSearchInput] = React.useState("");
const debouncedSearch = useDebounce(searchInput, 300);

React.useEffect(() => {
  load({ search: debouncedSearch });
}, [debouncedSearch]);
```

### 11.3 Optimistic UI Updates

Currently implemented in `useActionables` but can be improved:
```typescript
// Current: update local state after server confirms
const updated = await updateActionable(docId, itemId, updates);
setAllDocs(prev => prev.map(...));

// Better: optimistic update + rollback on error
setAllDocs(prev => optimisticallyApply(prev, docId, itemId, updates));
try {
  await updateActionable(docId, itemId, updates);
} catch {
  setAllDocs(prev); // rollback
  toast.error("Update failed");
}
```

### 11.4 Risk Score Computation Optimization

```python
# Current: recomputes on EVERY field update
_recompute_risk_scores(target)

# Better: only recompute when risk fields actually changed
RISK_TRIGGER_FIELDS = {
    "likelihood_business_volume", "likelihood_products_processes",
    "likelihood_compliance_violations", "impact_dropdown",
    "control_monitoring", "control_effectiveness",
}
if body.keys() & RISK_TRIGGER_FIELDS:
    _recompute_risk_scores(target)
```

### 11.5 Lazy Loading Expansion Content

```typescript
// Current: all expanded content renders even when collapsed
// After: only render when expanded
{expanded && <ActionableExpansion {...props} />}
```

---

## Phase 12: Validation & System Integrity {#phase-12}

**Risk**: ⬜ None — additive guards
**Effort**: ~3-4 hours
**Dependencies**: Phase 4 (layered architecture)

### 12.1 Pydantic Request Models

Replace raw `dict = Body(...)` with typed models:

```python
class UpdateActionableRequest(BaseModel):
    """Validated request body for actionable updates."""
    actor: Optional[str] = None
    action: Optional[str] = None
    task_status: Optional[TaskStatus] = None
    workstream: Optional[str] = None
    deadline: Optional[str] = None
    # ... only the fields that are actually editable
    # Rejects unknown fields automatically

    class Config:
        extra = "forbid"  # Reject unknown fields
```

### 12.2 Data Integrity Checks

Add a scheduled or on-demand endpoint:

```python
@router.post("/admin/integrity-check")
def check_data_integrity():
    """Verify data consistency across collections."""
    issues = []

    # 1. Check flat collection matches embedded collection
    # 2. Check all team_workflows reference existing teams
    # 3. Check all assigned_teams reference existing teams
    # 4. Check risk scores are consistent with sub-dropdown values
    # 5. Check audit trails are not empty for completed items
    # 6. Check deadline format is valid ISO datetime

    return {"issues": issues, "checked_at": datetime.now().isoformat()}
```

### 12.3 Concurrency Safety

With the flat collection (Phase 2), use MongoDB's `$set` operator for atomic field updates instead of load-modify-save:

```python
# Current (race condition):
result = store.load(doc_id)
target.task_status = "completed"
store.save(result)  # overwrites entire document

# After (atomic):
repo.update_one(doc_id, item_id, {"task_status": "completed"})
```

---

## Execution Order & Dependencies {#execution-order}

```
Phase 1: Constants/Enums ──────────────────────────────┐
    │                                                   │
    ▼                                                   │
Phase 2: Schema Design ─── Phase 3: Migration Script    │
    │                          │                        │
    ▼                          ▼                        │
Phase 6: DB Indexes ──────────┘                         │
    │                                                   │
    ▼                                                   │
Phase 4: Backend Layered Architecture ◄─────────────────┘
    │
    ▼
Phase 5: Security (session auth)
    │
    ▼
Phase 7: API Pagination ── Phase 12: Validation
    │
    ▼
Phase 8: Frontend Data Flow
    │
    ▼
Phase 9: Component Unification ── Phase 10: UI Consistency
    │
    ▼
Phase 11: Performance Optimization
```

### Recommended Session Breakdown

| Session | Phases | Effort | Risk |
|---------|--------|--------|------|
| **Session 1** | Phase 1 (constants) | 2h | None |
| **Session 2** | Phase 2 + 3 (schema + migration) | 10h | High |
| **Session 3** | Phase 4 (backend split) | 12h | Medium |
| **Session 4** | Phase 5 + 6 (security + indexes) | 6h | Medium |
| **Session 5** | Phase 7 + 8 (API pagination + frontend) | 10h | Medium |
| **Session 6** | Phase 9 + 10 (component unification + UI) | 10h | Low |
| **Session 7** | Phase 11 + 12 (performance + validation) | 6h | None |

**Total estimated effort**: ~56 hours across 7 sessions

---

## Risk Assessment {#risk-assessment}

### High Risk (System-Breaking if Incorrect)
- **Phase 2**: Schema change affects every read/write path
- **Phase 3**: Migration script must be perfect or data is corrupted

### Medium Risk (Functional Regression Possible)
- **Phase 4**: Splitting monolith could break import paths or lose shared state
- **Phase 5**: Auth middleware could lock out all users if misconfigured
- **Phase 7**: New API shape requires all consumers to update simultaneously

### Low/No Risk (Pure Additive or Refactor)
- **Phase 1**: Only adds constants, no behavior change
- **Phase 6**: Only adds indexes, no behavior change
- **Phase 10**: Only styling changes
- **Phase 11**: Only performance improvements
- **Phase 12**: Only adds validation guards

### Rollback Strategy

Each phase should:
1. Be implemented on a feature branch
2. Have the old code path available as fallback
3. Be tested against the current dataset before deploying
4. Be reversible within 5 minutes (git revert)

### Critical Invariants to Verify After Each Phase

- [ ] All 6 role dashboards load and display actionables correctly
- [ ] Actionable updates (status, risk, comments, evidence) save correctly
- [ ] Multi-team actionables route to correct team_workflows
- [ ] Delay detection and justification chain works end-to-end
- [ ] Risk score computation produces same values as before
- [ ] Team CRUD (create, rename, delete) cascades correctly
- [ ] Chat channels are accessible per role/team permissions
- [ ] `npx tsc --noEmit` passes with 0 errors

---

## Appendix: Current Endpoint Inventory

| # | Method | Path | Lines | Category |
|---|--------|------|-------|----------|
| 1 | GET | `/health` | 432 | Health |
| 2 | GET | `/documents` | 437 | Documents |
| 3 | GET | `/documents/{doc_id}` | 460 | Documents |
| 4 | GET | `/documents/{doc_id}/raw` | 477 | Documents |
| 5 | POST | `/ingest` | ~530 | Documents |
| 6 | DELETE | `/documents/{doc_id}` | ~600 | Documents |
| 7 | POST | `/query` | ~700 | QA |
| 8 | POST | `/query/{id}/feedback` | ~800 | QA |
| 9 | GET | `/config` | ~900 | Config |
| 10 | PATCH | `/config/retrieval-mode` | ~920 | Config |
| 11 | PATCH | `/config/optimization-features` | ~950 | Config |
| 12 | GET | `/optimization/stats` | ~1000 | Config |
| 13 | GET | `/corpus` | 1860 | Corpus |
| 14 | GET | `/corpus/relationships` | 1868 | Corpus |
| 15 | POST | `/corpus/query` | 1879 | Corpus |
| 16 | GET | `/actionables` | 1434 | Actionables |
| 17 | PUT | `/documents/{doc_id}/actionables/{item_id}` | 1457 | Actionables |
| 18 | POST | `/documents/{doc_id}/actionables` | 1750 | Actionables |
| 19 | GET | `/actionables/approved-by-team` | 1816 | Actionables |
| 20 | DELETE | `/documents/{doc_id}/actionables/{item_id}` | 1839 | Actionables |
| 21 | POST | `/evidence/upload` | 1706 | Evidence |
| 22 | GET | `/evidence/files/{filename}` | 1730 | Evidence |
| 23 | DELETE | `/evidence/files/{filename}` | 1739 | Evidence |
| 24 | GET | `/conversations` | 2071 | Conversations |
| 25 | GET | `/conversations/by-doc/{doc_id}` | 2078 | Conversations |
| 26 | POST | `/conversations` | 2085 | Conversations |
| 27 | GET | `/conversations/{conv_id}` | 2097 | Conversations |
| 28 | DELETE | `/conversations/{conv_id}` | 2107 | Conversations |
| 29 | DELETE | `/conversations` | 2117 | Conversations |
| 30 | GET | `/storage/stats` | 2130 | Storage |
| 31 | GET | `/export/training-data` | 2174 | Export |
| 32 | POST | `/admin/login` | 2287 | Admin |
| 33 | GET | `/admin/overview` | 2297 | Admin |
| 34 | GET | `/admin/queries` | 2488 | Admin |
| 35 | GET | `/admin/query/{id}/full` | 2519 | Admin |
| 36 | GET | `/admin/benchmarks` | 2530 | Admin |
| 37 | GET | `/admin/memory/detailed` | 2553 | Admin |
| 38 | GET | `/admin/system/logs` | 2614 | Admin |
| 39 | GET | `/admin/runtime-config` | 2639 | Admin |
| 40 | POST | `/actionables/check-delays` | 2653 | Delays |
| 41 | GET | `/actionables/delayed` | 2725 | Delays |
| 42 | POST | `/documents/{doc_id}/actionables/{item_id}/justification` | 2753 | Delays |
| 43 | GET | `/documents/{doc_id}/actionables/{item_id}/audit-trail` | 2837 | Delays |
| 44 | GET | `/team-chat/{team}/{channel}` | 2867 | Chat |
| 45 | POST | `/team-chat/{team}/{channel}` | 2883 | Chat |
| 46 | GET | `/chat/channels` | 2971 | Chat |
| 47 | GET | `/chat/messages/{channel}` | 3059 | Chat |
| 48 | POST | `/chat/messages/{channel}` | 3072 | Chat |
| 49 | POST | `/chat/mark-read/{channel}` | 3101 | Chat |
| 50 | GET | `/chat/unread-total` | 3118 | Chat |
| 51 | POST | `/chat/rename/{channel}` | 3160 | Chat |
| 52 | GET | `/teams` | 3311 | Teams |
| 53 | GET | `/teams/tree` | 3326 | Teams |
| 54 | GET | `/teams/{name}/descendants` | 3340 | Teams |
| 55 | POST | `/teams` | 3360 | Teams |
| 56 | DELETE | `/teams/{name}` | 3422 | Teams |
| 57 | PUT | `/teams/{name}` | 3530 | Teams |
| 58 | POST | `/teams/seed-defaults` | 3661 | Teams |
| 59 | GET | `/dropdown-configs` | 4245 | Dropdowns |
| 60 | GET | `/dropdown-configs/{key}` | 4256 | Dropdowns |
| 61 | POST | `/dropdown-configs` | 4268 | Dropdowns |
| 62 | PUT | `/dropdown-configs/{key}` | 4291 | Dropdowns |
| 63 | DELETE | `/dropdown-configs/{key}` | 4317 | Dropdowns |
| 64 | POST | `/dropdown-configs/{key}/options` | 4336 | Dropdowns |
| 65 | PUT | `/dropdown-configs/{key}/options/{idx}` | 4358 | Dropdowns |
| 66 | DELETE | `/dropdown-configs/{key}/options/{idx}` | 4381 | Dropdowns |
| 67 | GET | `/risk-matrix` | 4432 | Risk Matrix |
| 68 | POST | `/risk-matrix` | 4443 | Risk Matrix |
| 69 | PUT | `/risk-matrix/{id}` | 4463 | Risk Matrix |
| 70 | DELETE | `/risk-matrix/{id}` | 4491 | Risk Matrix |
| 71 | POST | `/admin/migrate-risk-fields` | 4511 | Migration |
| 72 | GET | `/admin/llm-benchmark/models` | 3757 | Benchmark |
| 73 | POST | `/admin/llm-benchmark/run` | 3777 | Benchmark |
| 74 | POST | `/admin/llm-benchmark/tournament-battle` | 3837 | Benchmark |
| 75 | GET | `/admin/llm-benchmark/results` | 3870 | Benchmark |
| 76 | GET | `/admin/llm-benchmark/results/{id}` | 3878 | Benchmark |
| 77 | GET | `/admin/llm-benchmark/latest` | 3889 | Benchmark |
| 78 | POST | `/admin/llm-benchmark/experiment` | 3909 | Benchmark |
| 79 | GET | `/admin/memory/health` | 3969 | Memory |
| 80 | GET | `/admin/memory/diagnostics/trends` | 3981 | Memory |
| 81 | GET | `/admin/memory/diagnostics/recent` | 4005 | Memory |
| 82 | GET | `/admin/memory/diagnostics` | 4028 | Memory |

**Total: 82 endpoints in a single file.**
