"""
JWT token generation and verification for Intelligence Auth.

Uses HMAC-SHA256 with a compact manual implementation (no PyJWT dependency).
Tokens contain: account_id, role, institution_tags, exp.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional


_SECRET_KEY = os.getenv("INTEL_AUTH_SECRET", "intel-auth-default-secret-change-me-in-prod-32chars!")
_TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 7  # 7 days


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def create_token(
    account_id: str,
    role: str,
    username: str = "",
    institution_tags: list[str] | None = None,
    expiry_seconds: int = _TOKEN_EXPIRY_SECONDS,
) -> str:
    """Create a signed JWT token."""
    now = int(time.time())
    payload = {
        "sub": account_id,
        "role": role,
        "username": username,
        "tags": institution_tags or [],
        "iat": now,
        "exp": now + expiry_seconds,
    }

    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    p = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{h}.{p}"
    sig = hmac.HMAC(
        _SECRET_KEY.encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{_b64url_encode(sig)}"


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode a JWT token. Returns payload dict or None if invalid/expired."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        signing_input = f"{parts[0]}.{parts[1]}"
        expected_sig = hmac.HMAC(
            _SECRET_KEY.encode("utf-8"),
            signing_input.encode("utf-8"),
            hashlib.sha256,
        ).digest()

        actual_sig = _b64url_decode(parts[2])
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None

        payload = json.loads(_b64url_decode(parts[1]))

        # Check expiry
        if payload.get("exp", 0) < int(time.time()):
            return None

        return payload
    except Exception:
        return None
