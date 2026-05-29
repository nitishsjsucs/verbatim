"""
MongoDB persistence for Intelligence accounts.

Collection: intel_accounts
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from utils.mongo import get_db
from intelligence.auth.models import IntelAccount
from intelligence.auth.password import hash_password

logger = logging.getLogger(__name__)

COLLECTION = "intel_accounts"


class IntelAccountStore:
    """CRUD for intel system accounts (admin + client)."""

    def __init__(self) -> None:
        self._col = get_db()[COLLECTION]
        try:
            self._col.create_index("account_id", unique=True)
            self._col.create_index("username", unique=True)
            self._col.create_index("email", sparse=True)
            self._col.create_index("role")
            self._col.create_index("institution_tags")
            self._col.create_index("is_active")
        except Exception as e:
            logger.warning("intel_accounts index init failed: %s", e)

    def get_by_id(self, account_id: str) -> Optional[IntelAccount]:
        d = self._col.find_one({"account_id": account_id})
        return IntelAccount.from_dict(d) if d else None

    def get_by_username(self, username: str) -> Optional[IntelAccount]:
        d = self._col.find_one({"username": username})
        return IntelAccount.from_dict(d) if d else None

    def get_by_email(self, email: str) -> Optional[IntelAccount]:
        if not email:
            return None
        d = self._col.find_one({"email": email})
        return IntelAccount.from_dict(d) if d else None

    def list_all(self, role: Optional[str] = None) -> list[IntelAccount]:
        query = {}
        if role:
            query["role"] = role
        cursor = self._col.find(query).sort("created_at", -1)
        return [IntelAccount.from_dict(d) for d in cursor]

    def list_clients(self) -> list[IntelAccount]:
        return self.list_all(role="client")

    def create(self, account: IntelAccount) -> IntelAccount:
        doc = account.to_dict()
        doc["_id"] = account.account_id
        self._col.insert_one(doc)
        return account

    def update(self, account_id: str, fields: dict) -> Optional[IntelAccount]:
        """Update specific fields on an account."""
        allowed = {
            "display_name", "email", "institution_type", "institution_tags",
            "is_active", "metadata", "role",
        }
        patch = {k: v for k, v in fields.items() if k in allowed}
        if not patch:
            return self.get_by_id(account_id)
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._col.update_one({"account_id": account_id}, {"$set": patch})
        return self.get_by_id(account_id)

    def set_password(self, account_id: str, new_password: str) -> bool:
        """Hash and store a new password."""
        hashed = hash_password(new_password)
        res = self._col.update_one(
            {"account_id": account_id},
            {"$set": {
                "password_hash": hashed,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return res.modified_count > 0

    def record_login(self, account_id: str) -> None:
        self._col.update_one(
            {"account_id": account_id},
            {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}},
        )

    def delete(self, account_id: str) -> bool:
        res = self._col.delete_one({"account_id": account_id})
        return res.deleted_count > 0

    def ensure_default_admin(self) -> None:
        """Create a default admin account if none exists. Called on startup."""
        existing = self._col.find_one({"role": "admin"})
        if existing:
            return
        import os
        default_user = os.getenv("INTEL_ADMIN_USERNAME", "admin")
        default_pass = os.getenv("INTEL_ADMIN_PASSWORD", "admin123")
        admin = IntelAccount(
            username=default_user,
            email="admin@intel.local",
            password_hash=hash_password(default_pass),
            role="admin",
            display_name="System Administrator",
            is_active=True,
        )
        try:
            self.create(admin)
            logger.info("[intel-auth] Default admin account created: %s", default_user)
        except Exception as e:
            logger.warning("[intel-auth] Failed to create default admin: %s", e)
