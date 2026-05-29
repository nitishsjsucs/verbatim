"""
FastAPI router for Intelligence Auth endpoints.

Mounted at /intel-auth/* — completely separate from the main app auth.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from intelligence.auth.account_store import IntelAccountStore
from intelligence.auth.dependencies import get_current_account, require_admin
from intelligence.auth.jwt_utils import create_token
from intelligence.auth.models import IntelAccount
from intelligence.auth.password import hash_password, verify_password

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/intel-auth", tags=["intel-auth"])

# Lazy singleton
_store: Optional[IntelAccountStore] = None


def _get_store() -> IntelAccountStore:
    global _store
    if _store is None:
        _store = IntelAccountStore()
        _store.ensure_default_admin()
    return _store


# ---------------------------------------------------------------------------
# Public: Login
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    token: str
    account_id: str
    role: str
    username: str
    display_name: str
    institution_tags: list[str] = []


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    """Authenticate and return a JWT token."""
    store = _get_store()
    account = store.get_by_username(body.username)
    if not account:
        # Try email as fallback
        account = store.get_by_email(body.username)
    if not account:
        raise HTTPException(401, "Invalid username or password.")
    if not account.is_active:
        raise HTTPException(403, "Account is deactivated. Contact your administrator.")
    if not verify_password(body.password, account.password_hash):
        raise HTTPException(401, "Invalid username or password.")

    token = create_token(
        account_id=account.account_id,
        role=account.role,
        username=account.username,
        institution_tags=account.institution_tags,
    )
    store.record_login(account.account_id)
    return LoginResponse(
        token=token,
        account_id=account.account_id,
        role=account.role,
        username=account.username,
        display_name=account.display_name or account.username,
        institution_tags=account.institution_tags,
    )


# ---------------------------------------------------------------------------
# Protected: Get current user info
# ---------------------------------------------------------------------------

@router.get("/me")
def get_me(account: dict = Depends(get_current_account)):
    """Return info about the currently authenticated user."""
    store = _get_store()
    full = store.get_by_id(account["sub"])
    if not full:
        raise HTTPException(404, "Account not found.")
    return {
        "account_id": full.account_id,
        "username": full.username,
        "email": full.email,
        "role": full.role,
        "display_name": full.display_name,
        "institution_type": full.institution_type,
        "institution_tags": full.institution_tags,
        "is_active": full.is_active,
        "last_login": full.last_login,
    }


# ---------------------------------------------------------------------------
# Admin-only: Client account management
# ---------------------------------------------------------------------------

class CreateClientRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str = ""
    email: str = ""
    institution_type: str = ""
    institution_tags: list[str] = []
    metadata: dict = {}


class UpdateClientRequest(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    institution_type: Optional[str] = None
    institution_tags: Optional[list[str]] = None
    is_active: Optional[bool] = None
    metadata: Optional[dict] = None


class SetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=128)


@router.post("/clients", status_code=201)
def create_client(body: CreateClientRequest, _admin: dict = Depends(require_admin)):
    """Admin creates a new client account."""
    store = _get_store()

    # Check uniqueness
    if store.get_by_username(body.username):
        raise HTTPException(409, f"Username '{body.username}' already exists.")
    if body.email and store.get_by_email(body.email):
        raise HTTPException(409, f"Email '{body.email}' already in use.")

    account = IntelAccount(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        role="client",
        display_name=body.display_name or body.username,
        institution_type=body.institution_type,
        institution_tags=body.institution_tags or [],
        is_active=True,
        metadata=body.metadata or {},
    )
    store.create(account)
    logger.info("[intel-auth] Client created: %s (tags=%s)", body.username, body.institution_tags)
    return {
        "account_id": account.account_id,
        "username": account.username,
        "role": "client",
        "institution_tags": account.institution_tags,
    }


@router.get("/clients")
def list_clients(_admin: dict = Depends(require_admin)):
    """List all client accounts."""
    store = _get_store()
    clients = store.list_clients()
    return [
        {
            "account_id": c.account_id,
            "username": c.username,
            "email": c.email,
            "display_name": c.display_name,
            "institution_type": c.institution_type,
            "institution_tags": c.institution_tags,
            "is_active": c.is_active,
            "created_at": c.created_at,
            "last_login": c.last_login,
        }
        for c in clients
    ]


@router.get("/clients/{account_id}")
def get_client(account_id: str, _admin: dict = Depends(require_admin)):
    """Get a single client's details."""
    store = _get_store()
    c = store.get_by_id(account_id)
    if not c or c.role != "client":
        raise HTTPException(404, "Client not found.")
    return {
        "account_id": c.account_id,
        "username": c.username,
        "email": c.email,
        "display_name": c.display_name,
        "institution_type": c.institution_type,
        "institution_tags": c.institution_tags,
        "is_active": c.is_active,
        "created_at": c.created_at,
        "last_login": c.last_login,
        "metadata": c.metadata,
    }


@router.patch("/clients/{account_id}")
def update_client(account_id: str, body: UpdateClientRequest, _admin: dict = Depends(require_admin)):
    """Update client account fields."""
    store = _get_store()
    existing = store.get_by_id(account_id)
    if not existing or existing.role != "client":
        raise HTTPException(404, "Client not found.")

    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updated = store.update(account_id, fields)
    if not updated:
        raise HTTPException(500, "Update failed.")
    return {"ok": True, "account_id": account_id}


@router.post("/clients/{account_id}/set-password")
def set_client_password(account_id: str, body: SetPasswordRequest, _admin: dict = Depends(require_admin)):
    """Admin resets a client's password."""
    store = _get_store()
    existing = store.get_by_id(account_id)
    if not existing:
        raise HTTPException(404, "Account not found.")
    store.set_password(account_id, body.new_password)
    return {"ok": True}


@router.delete("/clients/{account_id}")
def delete_client(account_id: str, _admin: dict = Depends(require_admin)):
    """Delete a client account."""
    store = _get_store()
    existing = store.get_by_id(account_id)
    if not existing or existing.role != "client":
        raise HTTPException(404, "Client not found.")
    store.delete(account_id)
    return {"ok": True}
