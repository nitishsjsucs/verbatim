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
        # Store ingestion timestamp (only on first insert; preserve on re-ingest unless missing)
        from datetime import datetime, timezone
        existing = self._collection.find_one({"_id": tree.doc_id}, {"ingested_at": 1})
        if existing and existing.get("ingested_at"):
            data["ingested_at"] = existing["ingested_at"]
        else:
            data["ingested_at"] = datetime.now(timezone.utc).isoformat()
        
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

    def list_documents_summary(self) -> List[dict]:
        """
        Fetch all documents' summaries in a single batch query (FIX #5).
        
        Instead of N+1 queries (list + load for each), use a single find()
        with projection to get only needed fields.
        """
        cursor = self._collection.find(
            {},
            {
                "_id": 1,
                "doc_id": 1,
                "doc_name": 1,
                "doc_description": 1,
                "total_pages": 1,
                "node_count": 1,
                "ingested_at": 1,
            }
        )
        
        docs = []
        for doc in cursor:
            node_count = doc.get("node_count") or 0
            # Backfill: if node_count is missing/zero, compute from structure
            # and persist so future reads are fast.
            if not node_count:
                node_count = self._compute_and_backfill_node_count(
                    doc.get("_id", doc.get("doc_id", ""))
                )
            docs.append({
                "id": doc.get("_id", doc.get("doc_id", "")),
                "name": doc.get("doc_name", ""),
                "pages": doc.get("total_pages", 0),
                "nodes": node_count,
                "description": doc.get("doc_description", ""),
                "ingested_at": doc.get("ingested_at", ""),
            })
        
        logger.info("Fetched summaries for %d documents in single batch query", len(docs))
        return docs

    def _compute_and_backfill_node_count(self, doc_id: str) -> int:
        """Load a tree, compute its node_count, persist it, and return the value."""
        tree = self.load(doc_id)
        if not tree:
            return 0
        nc = tree.node_count
        if nc > 0:
            self._collection.update_one(
                {"_id": doc_id},
                {"$set": {"node_count": nc}},
            )
            logger.info("Backfilled node_count=%d for %s", nc, doc_id)
        return nc

    def delete(self, doc_id: str) -> bool:
        """Delete a tree."""
        result = self._collection.delete_one({"_id": doc_id})
        if result.deleted_count > 0:
            logger.info("Deleted tree from MongoDB: %s", doc_id)
            return True
        return False

    # ------------------------------------------------------------------
    # Embedding Index persistence (Phase 1 optimization)
    # ------------------------------------------------------------------

    def save_embedding_index(self, index) -> None:
        """Save an EmbeddingIndex to MongoDB."""
        emb_collection = get_db()["embedding_indexes"]
        data = index.to_dict()
        data["_id"] = index.doc_id
        emb_collection.replace_one(
            {"_id": index.doc_id},
            data,
            upsert=True,
        )
        logger.info("Saved embedding index: %s (%d entries)", index.doc_id, len(index.entries))

    def load_embedding_index(self, doc_id: str):
        """Load an EmbeddingIndex from MongoDB. Returns None if not found."""
        emb_collection = get_db()["embedding_indexes"]
        data = emb_collection.find_one({"_id": doc_id})
        if not data:
            logger.debug("No embedding index found for %s", doc_id)
            return None
        if "_id" in data:
            del data["_id"]
        from retrieval.embedding_index import EmbeddingIndex
        idx = EmbeddingIndex.from_dict(data)
        logger.info("Loaded embedding index: %s (%d entries)", doc_id, len(idx.entries))
        return idx
