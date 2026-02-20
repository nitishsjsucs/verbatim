"""
Conversation data models for GOVINDA V2.

A conversation is a thread of user/assistant messages. Multiple conversations
can exist for a single document (like ChatGPT threads).

Each conversation has a unique `conv_id` (UUID) used as `_id` in MongoDB,
plus a `doc_id` linking it to a document (or "research" for cross-doc chat).

Messages are lean — heavy data (routing logs, retrieved sections, citations)
lives in the `queries` collection and is linked via `record_id`. When loading
a conversation the backend can optionally *hydrate* assistant messages by
fetching their linked QueryRecord data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


@dataclass
class ConversationMessage:
    """A single message in a conversation."""

    id: str  # Client-side ID (Date.now() string)
    role: str  # "user" or "assistant"
    content: str
    record_id: str = (
        ""  # Links to QueryRecord in 'queries' collection (assistant msgs only)
    )
    timestamp: str = ""  # ISO format

    # --- Hydrated fields (populated from QueryRecord on load, NOT stored) ---
    citations: list = field(default_factory=list)
    inferred_points: list = field(default_factory=list)
    verification_status: str = ""
    verification_notes: str = ""
    query_type: str = ""
    sub_queries: list = field(default_factory=list)
    key_terms: list = field(default_factory=list)
    retrieved_sections: list = field(default_factory=list)
    routing_log: Optional[dict] = None
    stage_timings: dict = field(default_factory=dict)
    total_time_seconds: float = 0.0
    total_tokens: int = 0
    llm_calls: int = 0

    def to_dict(self) -> dict:
        """Serialize for storage (lean — no hydrated fields)."""
        return {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "record_id": self.record_id,
            "timestamp": self.timestamp or datetime.now(timezone.utc).isoformat(),
        }

    def to_hydrated_dict(self) -> dict:
        """Serialize with all hydrated fields (for API responses)."""
        d = self.to_dict()
        if self.role == "assistant" and self.record_id:
            d["citations"] = self.citations
            d["inferred_points"] = self.inferred_points
            d["verification_status"] = self.verification_status
            d["verification_notes"] = self.verification_notes
            d["query_type"] = self.query_type
            d["sub_queries"] = self.sub_queries
            d["key_terms"] = self.key_terms
            d["retrieved_sections"] = self.retrieved_sections
            d["routing_log"] = self.routing_log
            d["stage_timings"] = self.stage_timings
            d["total_time_seconds"] = self.total_time_seconds
            d["total_tokens"] = self.total_tokens
            d["llm_calls"] = self.llm_calls
        return d

    @classmethod
    def from_dict(cls, data: dict) -> ConversationMessage:
        return cls(
            id=data.get("id", ""),
            role=data.get("role", "user"),
            content=data.get("content", ""),
            record_id=data.get("record_id", ""),
            timestamp=data.get("timestamp", ""),
        )


@dataclass
class Conversation:
    """A conversation thread. Multiple threads can exist per document."""

    conv_id: str  # UUID — used as _id in MongoDB
    doc_id: str  # Document ID, or "research" for cross-doc
    doc_name: str = ""
    conv_type: str = "document"  # "document" or "research"
    title: str = ""  # Auto-generated from first user query
    messages: list[ConversationMessage] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    message_count: int = 0

    def to_dict(self, hydrated: bool = False) -> dict:
        msg_fn = (
            (lambda m: m.to_hydrated_dict()) if hydrated else (lambda m: m.to_dict())
        )
        return {
            "conv_id": self.conv_id,
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "type": self.conv_type,
            "title": self.title,
            "messages": [msg_fn(m) for m in self.messages],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "message_count": len(self.messages),
        }

    def to_meta_dict(self) -> dict:
        """Lightweight dict for listing (no messages)."""
        return {
            "conv_id": self.conv_id,
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "type": self.conv_type,
            "title": self.title,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "message_count": len(self.messages),
            "last_message_preview": self.messages[-1].content[:120]
            if self.messages
            else "",
        }

    @classmethod
    def from_dict(cls, data: dict) -> Conversation:
        return cls(
            conv_id=data.get("conv_id", ""),
            doc_id=data.get("doc_id", ""),
            doc_name=data.get("doc_name", ""),
            conv_type=data.get("type", "document"),
            title=data.get("title", ""),
            messages=[
                ConversationMessage.from_dict(m) for m in data.get("messages", [])
            ],
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            message_count=data.get("message_count", 0),
        )
