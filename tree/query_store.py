from __future__ import annotations

import logging
from typing import Optional, List
from datetime import datetime, timezone
from models.query import QueryRecord
from utils.mongo import get_db

logger = logging.getLogger(__name__)

class QueryStore:
    """
    Persistence layer for QueryRecord objects using MongoDB.
    """

    def __init__(self) -> None:
        self._collection = get_db()["queries"]

    def save(self, record: QueryRecord) -> str:
        """Save a QueryRecord."""
        data = record.to_dict()
        data["_id"] = record.record_id
        
        self._collection.replace_one(
            {"_id": record.record_id},
            data,
            upsert=True
        )
        logger.info("Saved query record to MongoDB: %s", record.record_id)
        return record.record_id

    def load(self, record_id: str) -> Optional[QueryRecord]:
        """Load a QueryRecord by its ID."""
        data = self._collection.find_one({"_id": record_id})
        if not data:
            return None
        
        if "_id" in data:
            del data["_id"]
            
        return QueryRecord.from_dict(data)

    def update_feedback(
        self,
        record_id: str,
        feedback_text: str,
        rating: Optional[int] = None,
    ) -> bool:
        """Update the feedback field atomically."""
        feedback_data = {
            "text": feedback_text,
            "rating": rating,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        
        result = self._collection.update_one(
            {"_id": record_id},
            {"$set": {"feedback": feedback_data}}
        )
        
        if result.modified_count > 0:
            logger.info("Updated feedback in MongoDB for: %s", record_id)
            return True
        return False

    def list_records(self) -> List[str]:
        """List all record IDs."""
        cursor = self._collection.find({}, {"_id": 1}).sort("timestamp", -1)
        return [doc["_id"] for doc in cursor]
