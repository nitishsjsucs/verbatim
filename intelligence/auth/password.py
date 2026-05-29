"""
Password hashing utilities for Intelligence Auth.

Uses hashlib-based PBKDF2 (no external dependency needed).
"""

from __future__ import annotations

import hashlib
import os
import secrets


_ITERATIONS = 260_000
_ALGORITHM = "sha256"
_SALT_LENGTH = 32


def hash_password(plain: str) -> str:
    """Hash a plaintext password. Returns a string in format: salt$hash (hex-encoded)."""
    salt = os.urandom(_SALT_LENGTH)
    dk = hashlib.pbkdf2_hmac(_ALGORITHM, plain.encode("utf-8"), salt, _ITERATIONS)
    return f"{salt.hex()}${dk.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    """Verify a plaintext password against a stored hash."""
    try:
        salt_hex, hash_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac(_ALGORITHM, plain.encode("utf-8"), salt, _ITERATIONS)
        return secrets.compare_digest(dk.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False
