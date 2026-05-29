"""
Client Request System — allows clients to submit document and team requests.
Admin reviews and fulfills manually.

Collection: intel_requests
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

from utils.mongo import get_db

logger = logging.getLogger(__name__)

COLLECTION = "intel_requests"


@dataclass
class ClientRequest:
    """A request submitted by a client (document request or team request)."""
    request_id: str = field(default_factory=lambda: f"REQ-{uuid.uuid4().hex[:8].upper()}")
    request_type: str = ""  # "document" or "team"
    client_id: str = ""  # account_id of the requesting client
    client_username: str = ""
    status: str = "pending"  # "pending", "approved", "rejected", "archived"

    # Document request fields
    file_name: str = ""
    file_id: str = ""  # GridFS id if file was uploaded
    request_notes: str = ""

    # Team request fields
    team_name: str = ""
    team_description: str = ""

    # Admin response
    admin_notes: str = ""
    resolved_by: str = ""  # admin account_id
    resolved_at: str = ""

    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> ClientRequest:
        if not d:
            return cls()
        return cls(
            request_id=d.get("request_id", ""),
            request_type=d.get("request_type", ""),
            client_id=d.get("client_id", ""),
            client_username=d.get("client_username", ""),
            status=d.get("status", "pending"),
            file_name=d.get("file_name", ""),
            file_id=d.get("file_id", ""),
            request_notes=d.get("request_notes", ""),
            team_name=d.get("team_name", ""),
            team_description=d.get("team_description", ""),
            admin_notes=d.get("admin_notes", ""),
            resolved_by=d.get("resolved_by", ""),
            resolved_at=d.get("resolved_at", ""),
            created_at=d.get("created_at", ""),
        )


class RequestStore:
    """CRUD for client requests."""

    def __init__(self) -> None:
        self._col = get_db()[COLLECTION]
        try:
            self._col.create_index("request_id", unique=True)
            self._col.create_index("client_id")
            self._col.create_index("request_type")
            self._col.create_index("status")
        except Exception as e:
            logger.warning("intel_requests index init failed: %s", e)

    def create(self, req: ClientRequest) -> ClientRequest:
        doc = req.to_dict()
        doc["_id"] = req.request_id
        self._col.insert_one(doc)
        return req

    def get(self, request_id: str) -> Optional[ClientRequest]:
        d = self._col.find_one({"request_id": request_id})
        return ClientRequest.from_dict(d) if d else None

    def list_all(self, status: Optional[str] = None, request_type: Optional[str] = None) -> list[ClientRequest]:
        query: dict = {}
        if status:
            query["status"] = status
        if request_type:
            query["request_type"] = request_type
        cursor = self._col.find(query).sort("created_at", -1)
        return [ClientRequest.from_dict(d) for d in cursor]

    def list_for_client(self, client_id: str) -> list[ClientRequest]:
        cursor = self._col.find({"client_id": client_id}).sort("created_at", -1)
        return [ClientRequest.from_dict(d) for d in cursor]

    def update_status(self, request_id: str, status: str, admin_id: str = "", notes: str = "") -> Optional[ClientRequest]:
        patch: dict = {"status": status}
        if admin_id:
            patch["resolved_by"] = admin_id
            patch["resolved_at"] = datetime.now(timezone.utc).isoformat()
        if notes:
            patch["admin_notes"] = notes
        self._col.update_one({"request_id": request_id}, {"$set": patch})
        return self.get(request_id)

    def delete(self, request_id: str) -> bool:
        res = self._col.delete_one({"request_id": request_id})
        return res.deleted_count > 0
