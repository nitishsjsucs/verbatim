from __future__ import annotations

import logging
from typing import Optional, List
from models.document import DocumentTree
from utils.mongo import get_db

logger = logging.getLogger(__name__)

class TreeStore:
    """
    Persistence layer for DocumentTree objects using MongoDB.
    """

    def __init__(self) -> None:
        self._collection = get_db()["trees"]

    def save(self, tree: DocumentTree) -> str:
        """
        Save a DocumentTree to MongoDB.
        """
        data = tree.to_dict()
        # Use doc_id as _id for easy lookup
        data["_id"] = tree.doc_id
        
        self._collection.replace_one(
            {"_id": tree.doc_id},
            data,
            upsert=True
        )
        
        logger.info(
            "Saved tree to MongoDB: %s (%d nodes)",
            tree.doc_id,
            tree.node_count,
        )
        return tree.doc_id

    def load(self, doc_id: str) -> Optional[DocumentTree]:
        """
        Load a DocumentTree from MongoDB.
        """
        data = self._collection.find_one({"_id": doc_id})
        if not data:
            logger.warning("Tree not found in MongoDB: %s", doc_id)
            return None
            
        # Remove _id from data before creating object if it interferes, 
        # but to_dict/from_dict usually handles clean data.
        # fast check: from_dict likely doesn't expect _id.
        if "_id" in data:
            del data["_id"]

        tree = DocumentTree.from_dict(data)
        logger.info("Loaded tree from MongoDB: %s (%d nodes)", doc_id, tree.node_count)
        return tree

    def exists(self, doc_id: str) -> bool:
        """Check if a tree exists."""
        return self._collection.count_documents({"_id": doc_id}, limit=1) > 0

    def list_trees(self) -> List[str]:
        """List all available doc_ids."""
        cursor = self._collection.find({}, {"_id": 1})
        return [doc["_id"] for doc in cursor]

    def delete(self, doc_id: str) -> bool:
        """Delete a tree."""
        result = self._collection.delete_one({"_id": doc_id})
        if result.deleted_count > 0:
            logger.info("Deleted tree from MongoDB: %s", doc_id)
            return True
        return False
