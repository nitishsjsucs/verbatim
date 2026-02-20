"""
MongoDB persistence for conversations.

Collection: `conversations`
Document schema: see models/conversation.py

Each conversation has a unique conv_id (_id = conv_id, a UUID).
Multiple conversations can exist per document (keyed by doc_id).
"research" is the special doc_id for cross-document chat.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from models.conversation import Conversation, ConversationMessage
from utils.mongo import get_db

logger = logging.getLogger(__name__)


class ConversationStore:
    """CRUD operations for conversations in MongoDB."""

    def __init__(self) -> None:
        self._collection = get_db()["conversations"]
        # Ensure index on doc_id for efficient listing per document
        self._collection.create_index("doc_id")

    # ------------------------------------------------------------------
    # Core CRUD
    # ------------------------------------------------------------------

    def load(self, conv_id: str) -> Optional[Conversation]:
        """Load a conversation by conv_id."""
        data = self._collection.find_one({"_id": conv_id})
        if not data:
            return None
        data["conv_id"] = data.pop("_id", conv_id)
        return Conversation.from_dict(data)

    def save(self, conversation: Conversation) -> None:
        """Full save/replace of a conversation."""
        data = conversation.to_dict()
        data["_id"] = conversation.conv_id
        data.pop("conv_id", None)
        self._collection.replace_one({"_id": conversation.conv_id}, data, upsert=True)

    def create(
        self,
        doc_id: str,
        doc_name: str,
        conv_type: str = "document",
        title: str = "",
    ) -> Conversation:
        """Create a new empty conversation and persist it. Returns the new Conversation."""
        now = datetime.now(timezone.utc).isoformat()
        conv = Conversation(
            conv_id=str(uuid.uuid4()),
            doc_id=doc_id,
            doc_name=doc_name,
            conv_type=conv_type,
            title=title,
            messages=[],
            created_at=now,
            updated_at=now,
            message_count=0,
        )
        self.save(conv)
        logger.info("Created conversation %s for doc %s", conv.conv_id, doc_id)
        return conv

    def append_messages(
        self,
        conv_id: str,
        messages: list[ConversationMessage],
    ) -> None:
        """Append multiple messages to an existing conversation."""
        now = datetime.now(timezone.utc).isoformat()
        msg_dicts = []
        for m in messages:
            if not m.timestamp:
                m.timestamp = now
            msg_dicts.append(m.to_dict())

        result = self._collection.update_one(
            {"_id": conv_id},
            {
                "$push": {"messages": {"$each": msg_dicts}},
                "$set": {"updated_at": now},
                "$inc": {"message_count": len(messages)},
            },
        )
        if result.matched_count == 0:
            logger.warning("append_messages: conversation %s not found", conv_id)

    def set_title(self, conv_id: str, title: str) -> None:
        """Update the title of a conversation."""
        self._collection.update_one(
            {"_id": conv_id},
            {"$set": {"title": title}},
        )

    def delete(self, conv_id: str) -> bool:
        """Delete a conversation. Returns True if something was deleted."""
        result = self._collection.delete_one({"_id": conv_id})
        return result.deleted_count > 0

    def delete_all(self) -> int:
        """Delete all conversations. Returns count deleted."""
        result = self._collection.delete_many({})
        return result.deleted_count

    def delete_by_doc(self, doc_id: str) -> int:
        """Delete all conversations for a document. Returns count deleted."""
        result = self._collection.delete_many({"doc_id": doc_id})
        return result.deleted_count

    # ------------------------------------------------------------------
    # Listing & Metadata
    # ------------------------------------------------------------------

    def list_all(self) -> list[dict]:
        """
        Return metadata for all conversations (no message bodies).
        Sorted by updated_at descending (most recent first).
        """
        cursor = self._collection.find(
            {},
            {
                "messages": {"$slice": -1},  # Only last message for preview
                "doc_id": 1,
                "doc_name": 1,
                "type": 1,
                "title": 1,
                "created_at": 1,
                "updated_at": 1,
                "message_count": 1,
            },
        ).sort("updated_at", -1)

        results = []
        for doc in cursor:
            last_msgs = doc.get("messages", [])
            preview = ""
            if last_msgs:
                preview = last_msgs[-1].get("content", "")[:120]

            results.append(
                {
                    "conv_id": doc["_id"],
                    "doc_id": doc.get("doc_id", ""),
                    "doc_name": doc.get("doc_name", ""),
                    "type": doc.get("type", "document"),
                    "title": doc.get("title", ""),
                    "created_at": doc.get("created_at", ""),
                    "updated_at": doc.get("updated_at", ""),
                    "message_count": doc.get("message_count", 0),
                    "last_message_preview": preview,
                }
            )

        return results

    def list_by_doc(self, doc_id: str) -> list[dict]:
        """
        Return metadata for all conversations belonging to a document.
        Sorted by updated_at descending.
        """
        cursor = self._collection.find(
            {"doc_id": doc_id},
            {
                "messages": {"$slice": -1},
                "doc_id": 1,
                "doc_name": 1,
                "type": 1,
                "title": 1,
                "created_at": 1,
                "updated_at": 1,
                "message_count": 1,
            },
        ).sort("updated_at", -1)

        results = []
        for doc in cursor:
            last_msgs = doc.get("messages", [])
            preview = ""
            if last_msgs:
                preview = last_msgs[-1].get("content", "")[:120]

            results.append(
                {
                    "conv_id": doc["_id"],
                    "doc_id": doc.get("doc_id", ""),
                    "doc_name": doc.get("doc_name", ""),
                    "type": doc.get("type", "document"),
                    "title": doc.get("title", ""),
                    "created_at": doc.get("created_at", ""),
                    "updated_at": doc.get("updated_at", ""),
                    "message_count": doc.get("message_count", 0),
                    "last_message_preview": preview,
                }
            )

        return results

    # ------------------------------------------------------------------
    # Storage stats
    # ------------------------------------------------------------------

    def get_collection_size_bytes(self) -> int:
        """Return the total storage size of the conversations collection."""
        try:
            stats = self._collection.database.command("collStats", "conversations")
            return stats.get("storageSize", 0)
        except Exception:
            return 0
