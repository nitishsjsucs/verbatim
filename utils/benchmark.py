"""
Pipeline benchmarking framework for GOVINDA V2.

Provides per-stage timing, token tracking, cache hit/miss logging,
and skip recording for A/B comparison between legacy and optimized pipelines.

Usage:
    tracker = BenchmarkTracker(query_text="...", doc_id="...", retrieval_mode="optimized")

    with tracker.stage("classify") as s:
        result = classifier.classify(query)
        s.metadata["query_type"] = result.query_type.value

    tracker.record_cache_hit("locate")
    tracker.record_skip("verify", reason="high_confidence")

    benchmark = tracker.finalize()
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

BENCHMARK_PREFIX = "[BENCHMARK]"


@dataclass
class StageMetric:
    """Metrics captured for a single pipeline stage."""

    stage_name: str
    start_time: float = 0.0
    end_time: float = 0.0
    duration_seconds: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    llm_calls: int = 0
    cache_hit: bool = False
    skipped: bool = False
    skip_reason: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "stage_name": self.stage_name,
            "duration_seconds": round(self.duration_seconds, 3),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "llm_calls": self.llm_calls,
            "cache_hit": self.cache_hit,
            "skipped": self.skipped,
            "skip_reason": self.skip_reason,
            "metadata": self.metadata,
        }


@dataclass
class PipelineBenchmark:
    """Complete benchmark for a single query execution."""

    query_text: str
    doc_id: str
    retrieval_mode: str  # "legacy" or "optimized"
    timestamp: str = ""
    stages: list[StageMetric] = field(default_factory=list)

    # Aggregate metrics (computed by finalize())
    total_time: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_llm_calls: int = 0
    stages_skipped: int = 0
    cache_hits: int = 0

    # Comparison fields
    comparison_record_id: str = ""

    def to_dict(self) -> dict:
        return {
            "query_text": self.query_text,
            "doc_id": self.doc_id,
            "retrieval_mode": self.retrieval_mode,
            "timestamp": self.timestamp,
            "stages": [s.to_dict() for s in self.stages],
            "total_time": round(self.total_time, 3),
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_llm_calls": self.total_llm_calls,
            "stages_skipped": self.stages_skipped,
            "cache_hits": self.cache_hits,
            "comparison_record_id": self.comparison_record_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> PipelineBenchmark:
        stages = [
            StageMetric(
                stage_name=s["stage_name"],
                duration_seconds=s.get("duration_seconds", 0),
                input_tokens=s.get("input_tokens", 0),
                output_tokens=s.get("output_tokens", 0),
                llm_calls=s.get("llm_calls", 0),
                cache_hit=s.get("cache_hit", False),
                skipped=s.get("skipped", False),
                skip_reason=s.get("skip_reason", ""),
                metadata=s.get("metadata", {}),
            )
            for s in data.get("stages", [])
        ]
        return cls(
            query_text=data.get("query_text", ""),
            doc_id=data.get("doc_id", ""),
            retrieval_mode=data.get("retrieval_mode", "legacy"),
            timestamp=data.get("timestamp", ""),
            stages=stages,
            total_time=data.get("total_time", 0),
            total_input_tokens=data.get("total_input_tokens", 0),
            total_output_tokens=data.get("total_output_tokens", 0),
            total_llm_calls=data.get("total_llm_calls", 0),
            stages_skipped=data.get("stages_skipped", 0),
            cache_hits=data.get("cache_hits", 0),
            comparison_record_id=data.get("comparison_record_id", ""),
        )


class StageContext:
    """Context manager for timing a pipeline stage and capturing token deltas."""

    def __init__(self, tracker: BenchmarkTracker, stage_name: str) -> None:
        self._tracker = tracker
        self._stage_name = stage_name
        self._metric = StageMetric(stage_name=stage_name)
        self._llm_snapshot_before: Optional[dict] = None

    @property
    def metadata(self) -> dict:
        return self._metric.metadata

    @metadata.setter
    def metadata(self, value: dict) -> None:
        self._metric.metadata = value

    def set_metadata(self, key: str, value) -> None:
        self._metric.metadata[key] = value

    def __enter__(self) -> StageContext:
        self._metric.start_time = time.time()
        if self._tracker._llm_client:
            self._llm_snapshot_before = self._tracker._llm_client.get_usage_summary()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self._metric.end_time = time.time()
        self._metric.duration_seconds = self._metric.end_time - self._metric.start_time

        # Compute token delta from LLM client
        if self._tracker._llm_client and self._llm_snapshot_before:
            after = self._tracker._llm_client.get_usage_summary()
            self._metric.input_tokens = (
                after["total_input_tokens"] - self._llm_snapshot_before["total_input_tokens"]
            )
            self._metric.output_tokens = (
                after["total_output_tokens"] - self._llm_snapshot_before["total_output_tokens"]
            )
            self._metric.llm_calls = (
                after["total_calls"] - self._llm_snapshot_before["total_calls"]
            )

        self._tracker._stages.append(self._metric)

        # Structured log
        total_tok = self._metric.input_tokens + self._metric.output_tokens
        cache_str = "cache=HIT" if self._metric.cache_hit else "cache=MISS"
        logger.info(
            "%s[%s] %s input_tokens | %s output_tokens | %.2fs | %s llm_calls | %s",
            BENCHMARK_PREFIX,
            self._stage_name,
            f"{self._metric.input_tokens:,}",
            f"{self._metric.output_tokens:,}",
            self._metric.duration_seconds,
            self._metric.llm_calls,
            cache_str,
        )

        return None  # Do not suppress exceptions


class BenchmarkTracker:
    """
    Tracks benchmark metrics across all stages of a pipeline execution.

    Attach an LLMClient to automatically capture per-stage token deltas.
    """

    def __init__(
        self,
        query_text: str = "",
        doc_id: str = "",
        retrieval_mode: str = "legacy",
        llm_client=None,
    ) -> None:
        self._query_text = query_text
        self._doc_id = doc_id
        self._retrieval_mode = retrieval_mode
        self._llm_client = llm_client
        self._stages: list[StageMetric] = []
        self._start_time = time.time()

    def stage(self, name: str) -> StageContext:
        """Create a context manager that times a pipeline stage and tracks tokens."""
        return StageContext(self, name)

    def record_skip(self, stage_name: str, reason: str) -> None:
        """Record that a stage was intentionally skipped."""
        metric = StageMetric(
            stage_name=stage_name,
            skipped=True,
            skip_reason=reason,
        )
        self._stages.append(metric)
        logger.info(
            "%s[%s] SKIPPED | reason=%s",
            BENCHMARK_PREFIX,
            stage_name,
            reason,
        )

    def record_cache_hit(self, stage_name: str, **extra_metadata) -> None:
        """Record that a stage returned from cache."""
        metric = StageMetric(
            stage_name=stage_name,
            cache_hit=True,
            metadata=extra_metadata,
        )
        self._stages.append(metric)
        logger.info(
            "%s[%s] CACHE HIT | %s",
            BENCHMARK_PREFIX,
            stage_name,
            " ".join(f"{k}={v}" for k, v in extra_metadata.items()) or "—",
        )

    def finalize(self) -> PipelineBenchmark:
        """Compute aggregates and return the complete benchmark."""
        total_time = time.time() - self._start_time

        benchmark = PipelineBenchmark(
            query_text=self._query_text,
            doc_id=self._doc_id,
            retrieval_mode=self._retrieval_mode,
            timestamp=datetime.now(timezone.utc).isoformat(),
            stages=list(self._stages),
            total_time=total_time,
            total_input_tokens=sum(s.input_tokens for s in self._stages),
            total_output_tokens=sum(s.output_tokens for s in self._stages),
            total_llm_calls=sum(s.llm_calls for s in self._stages),
            stages_skipped=sum(1 for s in self._stages if s.skipped),
            cache_hits=sum(1 for s in self._stages if s.cache_hit),
        )

        # Summary log
        logger.info(
            "%s[TOTAL] %s tokens | %.1fs | %d llm_calls | %d cache_hits | %d skips | mode=%s",
            BENCHMARK_PREFIX,
            f"{benchmark.total_input_tokens + benchmark.total_output_tokens:,}",
            benchmark.total_time,
            benchmark.total_llm_calls,
            benchmark.cache_hits,
            benchmark.stages_skipped,
            benchmark.retrieval_mode,
        )

        return benchmark
