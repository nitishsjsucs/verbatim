"""
Data models for the Intelligence Auth system.

Collections:
  - intel_accounts: stores admin and client accounts
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone


@dataclass
class IntelAccount:
    """A user account in the intelligence multi-tenant system."""

    account_id: str = field(default_factory=lambda: f"IA-{uuid.uuid4().hex[:12].upper()}")
    username: str = ""
    email: str = ""
    password_hash: str = ""
    role: str = "client"  # "admin" or "client"
    display_name: str = ""
    institution_type: str = ""  # tag for client filtering (e.g. "banking", "insurance")
    institution_tags: list[str] = field(default_factory=list)  # multiple tags allowed
    is_active: bool = True
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = ""
    last_login: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> IntelAccount:
        if not d:
            return cls()
        return cls(
            account_id=d.get("account_id", ""),
            username=d.get("username", ""),
            email=d.get("email", ""),
            password_hash=d.get("password_hash", ""),
            role=d.get("role", "client"),
            display_name=d.get("display_name", ""),
            institution_type=d.get("institution_type", ""),
            institution_tags=d.get("institution_tags") or [],
            is_active=d.get("is_active", True),
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
            last_login=d.get("last_login", ""),
            metadata=d.get("metadata") or {},
        )

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_client(self) -> bool:
        return self.role == "client"
