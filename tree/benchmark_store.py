"""
MongoDB persistence for pipeline benchmarks.

Stores PipelineBenchmark records for A/B comparison between legacy and optimized modes.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from utils.mongo import get_db
from utils.benchmark import PipelineBenchmark

logger = logging.getLogger(__name__)

COLLECTION_NAME = "benchmarks"


class BenchmarkStore:
    """Store and query pipeline benchmarks in MongoDB."""

    def __init__(self) -> None:
        self._collection = get_db()[COLLECTION_NAME]

    def save(self, benchmark: PipelineBenchmark) -> str:
        """Save a benchmark record. Returns the record ID."""
        record_id = str(uuid.uuid4())
        doc = benchmark.to_dict()
        doc["_id"] = record_id
        self._collection.insert_one(doc)
        logger.info("Benchmark saved: %s (mode=%s, %.1fs)", record_id, benchmark.retrieval_mode, benchmark.total_time)
        return record_id

    def load(self, record_id: str) -> Optional[PipelineBenchmark]:
        """Load a benchmark by record ID."""
        raw = self._collection.find_one({"_id": record_id})
        if not raw:
            return None
        return PipelineBenchmark.from_dict(raw)

    def query_by_doc(self, doc_id: str, limit: int = 50) -> list[dict]:
        """Get recent benchmarks for a document."""
        cursor = (
            self._collection.find({"doc_id": doc_id})
            .sort("timestamp", -1)
            .limit(limit)
        )
        return [self._summarize(raw) for raw in cursor]

    def query_by_mode(self, mode: str, limit: int = 100) -> list[dict]:
        """Get recent benchmarks for a retrieval mode."""
        cursor = (
            self._collection.find({"retrieval_mode": mode})
            .sort("timestamp", -1)
            .limit(limit)
        )
        return [self._summarize(raw) for raw in cursor]

    def aggregate_stats(self, mode: str, last_n: int = 100) -> dict:
        """Compute aggregate statistics for a retrieval mode."""
        cursor = (
            self._collection.find({"retrieval_mode": mode})
            .sort("timestamp", -1)
            .limit(last_n)
        )
        records = list(cursor)
        if not records:
            return {"mode": mode, "count": 0}

        total_times = [r.get("total_time", 0) for r in records]
        total_tokens = [r.get("total_input_tokens", 0) + r.get("total_output_tokens", 0) for r in records]
        total_calls = [r.get("total_llm_calls", 0) for r in records]
        cache_hits = [r.get("cache_hits", 0) for r in records]
        skips = [r.get("stages_skipped", 0) for r in records]

        return {
            "mode": mode,
            "count": len(records),
            "avg_time": round(sum(total_times) / len(total_times), 2),
            "avg_tokens": round(sum(total_tokens) / len(total_tokens)),
            "avg_llm_calls": round(sum(total_calls) / len(total_calls), 1),
            "avg_cache_hits": round(sum(cache_hits) / len(cache_hits), 2),
            "avg_skips": round(sum(skips) / len(skips), 2),
            "min_time": round(min(total_times), 2),
            "max_time": round(max(total_times), 2),
            "min_tokens": min(total_tokens),
            "max_tokens": max(total_tokens),
        }

    def compare(self, legacy_id: str, optimized_id: str) -> dict:
        """Compare two benchmark records side-by-side."""
        legacy = self.load(legacy_id)
        optimized = self.load(optimized_id)
        if not legacy or not optimized:
            return {"error": "One or both records not found"}

        l_tokens = legacy.total_input_tokens + legacy.total_output_tokens
        o_tokens = optimized.total_input_tokens + optimized.total_output_tokens

        return {
            "legacy": legacy.to_dict(),
            "optimized": optimized.to_dict(),
            "delta": {
                "time_saved_seconds": round(legacy.total_time - optimized.total_time, 2),
                "time_saved_pct": round((1 - optimized.total_time / max(legacy.total_time, 0.01)) * 100, 1),
                "tokens_saved": l_tokens - o_tokens,
                "tokens_saved_pct": round((1 - o_tokens / max(l_tokens, 1)) * 100, 1),
                "llm_calls_saved": legacy.total_llm_calls - optimized.total_llm_calls,
                "cache_hits": optimized.cache_hits,
                "stages_skipped": optimized.stages_skipped,
            },
        }

    @staticmethod
    def _summarize(raw: dict) -> dict:
        """Return a lightweight summary of a benchmark record."""
        return {
            "record_id": raw.get("_id", ""),
            "query_text": raw.get("query_text", "")[:80],
            "retrieval_mode": raw.get("retrieval_mode", ""),
            "total_time": raw.get("total_time", 0),
            "total_tokens": raw.get("total_input_tokens", 0) + raw.get("total_output_tokens", 0),
            "total_llm_calls": raw.get("total_llm_calls", 0),
            "cache_hits": raw.get("cache_hits", 0),
            "stages_skipped": raw.get("stages_skipped", 0),
            "timestamp": raw.get("timestamp", ""),
        }
