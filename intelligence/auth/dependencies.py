"""
FastAPI dependencies for Intelligence Auth.

Provides:
  - get_current_account: extracts and validates JWT from Authorization header
  - require_admin: dependency that raises 403 if not admin
  - require_client: dependency that raises 403 if not client
  - get_client_tags: returns the institution_tags for the current client
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request

from intelligence.auth.jwt_utils import verify_token

logger = logging.getLogger(__name__)


def _extract_token(request: Request) -> Optional[str]:
    """Extract Bearer token from Authorization header or cookie."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    # Fallback: cookie-based token
    return request.cookies.get("intel_token")


def get_current_account(request: Request) -> dict:
    """Decode the JWT and return the payload as a dict.

    Raises 401 if no valid token found.
    Payload keys: sub (account_id), role, username, tags, iat, exp.
    """
    token = _extract_token(request)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please log in to the Intelligence System.",
        )
    payload = verify_token(token)
    if payload is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token. Please log in again.",
        )
    return payload


def require_admin(account: dict = Depends(get_current_account)) -> dict:
    """Dependency: raises 403 if the current user is not an admin."""
    if account.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required.",
        )
    return account


def require_client(account: dict = Depends(get_current_account)) -> dict:
    """Dependency: raises 403 if the current user is not a client."""
    if account.get("role") != "client":
        raise HTTPException(
            status_code=403,
            detail="Client access required.",
        )
    return account


def get_client_tags(account: dict = Depends(get_current_account)) -> list[str]:
    """Return the institution tags for a client. Empty for admin."""
    return account.get("tags") or []
