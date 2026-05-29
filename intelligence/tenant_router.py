"""
Multi-tenant intelligence router.

Provides:
  - Tag-filtered document/actionable access for clients
  - Additionals CRUD (admin-only write, client read)
  - Client request submission + admin request management
  - institution_tag field on documents/ingestion

Mounted at /intel/* (separate from /intelligence/* admin-facing router).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from intelligence.auth.dependencies import (
    get_current_account,
    require_admin,
    require_client,
)
from intelligence.additionals import AdditionalEntry, AdditionalsStore
from intelligence.requests import ClientRequest, RequestStore
from intelligence.store import IntelRunStore
from tree.tree_store import TreeStore
from utils.mongo import get_db, get_fs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/intel", tags=["intel-tenant"])

# ---------------------------------------------------------------------------
# Lazy singletons
# ---------------------------------------------------------------------------
_additionals_store: Optional[AdditionalsStore] = None
_request_store: Optional[RequestStore] = None
_run_store: Optional[IntelRunStore] = None
_tree_store: Optional[TreeStore] = None


def _adds() -> AdditionalsStore:
    global _additionals_store
    if _additionals_store is None:
        _additionals_store = AdditionalsStore()
    return _additionals_store


def _reqs() -> RequestStore:
    global _request_store
    if _request_store is None:
        _request_store = RequestStore()
    return _request_store


def _runs() -> IntelRunStore:
    global _run_store
    if _run_store is None:
        _run_store = IntelRunStore()
    return _run_store


def _ts() -> TreeStore:
    global _tree_store
    if _tree_store is None:
        _tree_store = TreeStore()
    return _tree_store


# ---------------------------------------------------------------------------
# Document tag management (stored in tree metadata)
# ---------------------------------------------------------------------------
DOC_TAGS_COLLECTION = "intel_doc_tags"


def _tags_col():
    return get_db()[DOC_TAGS_COLLECTION]


def get_doc_tags(doc_id: str) -> list[str]:
    """Get institution_tags for a document."""
    d = _tags_col().find_one({"_id": doc_id})
    return (d.get("tags") or []) if d else []


def set_doc_tags(doc_id: str, tags: list[str]) -> None:
    """Set institution_tags for a document."""
    _tags_col().update_one(
        {"_id": doc_id},
        {"$set": {"doc_id": doc_id, "tags": tags, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


def get_docs_by_tags(tags: list[str]) -> list[str]:
    """Get all doc_ids that have at least one matching tag."""
    if not tags:
        return []
    cursor = _tags_col().find({"tags": {"$in": tags}}, {"_id": 1})
    return [d["_id"] for d in cursor]


# ---------------------------------------------------------------------------
# Admin: Set document tags
# ---------------------------------------------------------------------------

class SetDocTagsRequest(BaseModel):
    tags: list[str] = Field(..., min_length=1)


@router.post("/documents/{doc_id}/tags")
def set_document_tags(doc_id: str, body: SetDocTagsRequest, _admin: dict = Depends(require_admin)):
    """Admin sets institution tags on a document."""
    if not _ts().exists(doc_id):
        raise HTTPException(404, f"Document {doc_id} not found.")
    set_doc_tags(doc_id, body.tags)
    return {"ok": True, "doc_id": doc_id, "tags": body.tags}


@router.get("/documents/{doc_id}/tags")
def get_document_tags(doc_id: str, account: dict = Depends(get_current_account)):
    """Get institution tags for a document."""
    return {"doc_id": doc_id, "tags": get_doc_tags(doc_id)}


# ---------------------------------------------------------------------------
# Client: Filtered document list
# ---------------------------------------------------------------------------

@router.get("/documents")
def list_documents(account: dict = Depends(get_current_account)):
    """List documents visible to the current user.

    - Admin sees all documents.
    - Client sees only documents matching their institution_tags.
    """
    role = account.get("role")
    client_tags = account.get("tags") or []

    all_docs = _ts().list_documents_summary()  # returns list[dict]

    if role == "admin":
        # Admin sees everything
        results = []
        for d in all_docs:
            doc_id = d.get("id", "")
            tags = get_doc_tags(doc_id)
            results.append({
                "doc_id": doc_id,
                "doc_name": d.get("name", ""),
                "pages": d.get("pages", 0),
                "nodes": d.get("nodes", 0),
                "tags": tags,
                "has_run": _runs().get(doc_id) is not None,
            })
        return results

    # Client: filter by tags
    if not client_tags:
        return []

    visible_doc_ids = set(get_docs_by_tags(client_tags))
    results = []
    for d in all_docs:
        doc_id = d.get("id", "")
        if doc_id in visible_doc_ids:
            results.append({
                "doc_id": doc_id,
                "doc_name": d.get("name", ""),
                "pages": d.get("pages", 0),
                "nodes": d.get("nodes", 0),
                "tags": get_doc_tags(doc_id),
                "has_run": _runs().get(doc_id) is not None,
            })
    return results


# ---------------------------------------------------------------------------
# Client: Filtered actionables (read-only)
# ---------------------------------------------------------------------------

@router.get("/documents/{doc_id}/actionables")
def get_document_actionables(doc_id: str, account: dict = Depends(get_current_account)):
    """Get actionables for a document. Clients only see their tagged docs."""
    role = account.get("role")
    client_tags = account.get("tags") or []

    # Authorization check for clients
    if role == "client":
        doc_tags = get_doc_tags(doc_id)
        if not any(t in client_tags for t in doc_tags):
            raise HTTPException(403, "You do not have access to this document.")

    run = _runs().get(doc_id)
    if not run:
        return {"doc_id": doc_id, "actionables": [], "notice_board": []}

    return {
        "doc_id": doc_id,
        "doc_name": run.doc_name,
        "actionables": [a.to_dict() for a in run.actionables],
        "notice_board": [n.to_dict() for n in (run.notice_board or [])],
        "stats": run.stats or {},
        "created_at": run.created_at,
    }


# ---------------------------------------------------------------------------
# Additionals (admin write, all read)
# ---------------------------------------------------------------------------

class CreateAdditionalRequest(BaseModel):
    title: str = Field(..., min_length=1)
    date: str = ""
    description: str = ""
    notes: str = ""
    actionables: list[dict] = []


class UpdateAdditionalRequest(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    actionables: Optional[list[dict]] = None


@router.get("/documents/{doc_id}/additionals")
def list_additionals(doc_id: str, account: dict = Depends(get_current_account)):
    """List all additionals for a document."""
    role = account.get("role")
    client_tags = account.get("tags") or []

    if role == "client":
        doc_tags = get_doc_tags(doc_id)
        if not any(t in client_tags for t in doc_tags):
            raise HTTPException(403, "You do not have access to this document.")

    entries = _adds().list_for_doc(doc_id)
    return [e.to_dict() for e in entries]


@router.post("/documents/{doc_id}/additionals", status_code=201)
def create_additional(doc_id: str, body: CreateAdditionalRequest, admin: dict = Depends(require_admin)):
    """Admin creates an additional entry for a document."""
    entry = AdditionalEntry(
        doc_id=doc_id,
        title=body.title,
        date=body.date,
        description=body.description,
        notes=body.notes,
        actionables=body.actionables,
        created_by=admin.get("sub", ""),
    )
    _adds().create(entry)
    return entry.to_dict()


@router.patch("/additionals/{entry_id}")
def update_additional(entry_id: str, body: UpdateAdditionalRequest, _admin: dict = Depends(require_admin)):
    """Admin updates an additional entry."""
    existing = _adds().get(entry_id)
    if not existing:
        raise HTTPException(404, "Additional not found.")
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updated = _adds().update(entry_id, fields)
    return updated.to_dict() if updated else {}


@router.delete("/additionals/{entry_id}")
def delete_additional(entry_id: str, _admin: dict = Depends(require_admin)):
    """Admin deletes an additional entry."""
    _adds().delete(entry_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Client Requests (document + team)
# ---------------------------------------------------------------------------

class TeamRequestBody(BaseModel):
    team_name: str = Field(..., min_length=1)
    description: str = ""


@router.post("/requests/document", status_code=201)
def submit_document_request(
    notes: str = Form(""),
    file: Optional[UploadFile] = File(None),
    account: dict = Depends(require_client),
):
    """Client submits a document request (optionally with file upload)."""
    file_id = ""
    file_name = ""
    if file:
        fs = get_fs()
        file_id = str(fs.put(file.file, filename=file.filename, content_type=file.content_type))
        file_name = file.filename or ""

    req = ClientRequest(
        request_type="document",
        client_id=account.get("sub", ""),
        client_username=account.get("username", ""),
        file_name=file_name,
        file_id=file_id,
        request_notes=notes,
    )
    _reqs().create(req)
    return {"request_id": req.request_id, "status": "pending"}


@router.post("/requests/team", status_code=201)
def submit_team_request(body: TeamRequestBody, account: dict = Depends(require_client)):
    """Client submits a team request."""
    req = ClientRequest(
        request_type="team",
        client_id=account.get("sub", ""),
        client_username=account.get("username", ""),
        team_name=body.team_name,
        team_description=body.description,
    )
    _reqs().create(req)
    return {"request_id": req.request_id, "status": "pending"}


@router.get("/requests/mine")
def list_my_requests(account: dict = Depends(require_client)):
    """Client lists their own requests."""
    reqs = _reqs().list_for_client(account.get("sub", ""))
    return [r.to_dict() for r in reqs]


# ---------------------------------------------------------------------------
# Admin: Request management
# ---------------------------------------------------------------------------

@router.get("/requests")
def list_all_requests(
    status: Optional[str] = Query(None),
    request_type: Optional[str] = Query(None),
    _admin: dict = Depends(require_admin),
):
    """Admin lists all client requests."""
    reqs = _reqs().list_all(status=status, request_type=request_type)
    return [r.to_dict() for r in reqs]


class ResolveRequestBody(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected|archived)$")
    notes: str = ""


@router.patch("/requests/{request_id}")
def resolve_request(request_id: str, body: ResolveRequestBody, admin: dict = Depends(require_admin)):
    """Admin approves/rejects/archives a request."""
    existing = _reqs().get(request_id)
    if not existing:
        raise HTTPException(404, "Request not found.")
    updated = _reqs().update_status(
        request_id,
        status=body.status,
        admin_id=admin.get("sub", ""),
        notes=body.notes,
    )
    return updated.to_dict() if updated else {}


# ---------------------------------------------------------------------------
# Institution tags registry (for UI dropdowns)
# ---------------------------------------------------------------------------

TAGS_REGISTRY_COLLECTION = "intel_institution_tags"


@router.get("/tags")
def list_institution_tags(account: dict = Depends(get_current_account)):
    """List all known institution tags."""
    col = get_db()[TAGS_REGISTRY_COLLECTION]
    cursor = col.find({}).sort("name", 1)
    return [{"name": d.get("name", ""), "description": d.get("description", "")} for d in cursor]


class CreateTagRequest(BaseModel):
    name: str = Field(..., min_length=1)
    description: str = ""


@router.post("/tags", status_code=201)
def create_institution_tag(body: CreateTagRequest, _admin: dict = Depends(require_admin)):
    """Admin creates a new institution tag."""
    col = get_db()[TAGS_REGISTRY_COLLECTION]
    existing = col.find_one({"name": body.name})
    if existing:
        raise HTTPException(409, f"Tag '{body.name}' already exists.")
    col.insert_one({"_id": body.name, "name": body.name, "description": body.description})
    return {"ok": True, "name": body.name}


@router.delete("/tags/{tag_name}")
def delete_institution_tag(tag_name: str, _admin: dict = Depends(require_admin)):
    """Admin deletes an institution tag."""
    col = get_db()[TAGS_REGISTRY_COLLECTION]
    col.delete_one({"_id": tag_name})
    return {"ok": True}
