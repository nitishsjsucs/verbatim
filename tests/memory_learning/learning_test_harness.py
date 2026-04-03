"""
Memory Learning Test Harness — Real Integration Test for GOVINDA's Self-Learning System

Sends the 300 RBI questions to the live backend and measures whether:
1. Response TIME decreases for similar questions within the same theme
2. TOKEN USAGE decreases as the system learns retrieval patterns
3. RETRIEVAL PRECISION improves (fewer wasted sections, more citations)
4. LLM CALLS decrease as the system skips unnecessary steps

The 300 questions are grouped into 60 themes × 5 variations. Within each theme,
questions are intentionally similar. If the memory system works, Q2-Q5 should be
answered faster and more efficiently than Q1 in each theme.

Usage:
    python -m tests.memory_learning.learning_test_harness \
        --backend-url https://your-ngrok-url.ngrok-free.dev \
        --doc-id <your_doc_id> \
        --questions 300 \
        --output results.json
"""

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from tests.memory_learning.qa_parser import (
    QAPair,
    ThemeGroup,
    parse_qa_file,
    group_by_theme,
    get_document_questions,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# Data structures for recording metrics
# ──────────────────────────────────────────────────────────────────────

@dataclass
class QueryMetrics:
    """Metrics captured for a single query execution."""
    question_number: int
    question_text: str
    theme_number: int
    theme_title: str
    document: str
    variation_type: str
    position_in_theme: int          # 1-5

    # Timing
    wall_time_seconds: float = 0.0  # Total wall-clock time (client-side)
    server_time_seconds: float = 0.0  # Total time reported by server
    stage_timings: Dict[str, float] = field(default_factory=dict)

    # Resource usage
    total_tokens: int = 0
    llm_calls: int = 0

    # Retrieval quality
    sections_retrieved: int = 0
    citations_count: int = 0
    retrieval_precision: float = 0.0  # citations / sections_retrieved

    # Routing details
    nodes_located: int = 0
    nodes_read: int = 0
    tokens_retrieved: int = 0

    # Query classification
    query_type: str = ""
    key_terms: List[str] = field(default_factory=list)
    sub_queries: List[str] = field(default_factory=list)

    # Verification
    verification_status: str = ""

    # Answer quality
    answer_length: int = 0

    # Error tracking
    success: bool = True
    error: str = ""

    # Server response record ID
    record_id: str = ""
    conv_id: str = ""

    # Timestamp
    timestamp: str = ""


@dataclass
class ThemeMetrics:
    """Aggregated metrics for a theme group (5 questions)."""
    theme_number: int
    theme_title: str
    document: str
    query_metrics: List[QueryMetrics] = field(default_factory=list)

    @property
    def time_series(self) -> List[float]:
        """Wall times for Q1-Q5 in order."""
        return [m.wall_time_seconds for m in sorted(self.query_metrics, key=lambda x: x.position_in_theme)]

    @property
    def token_series(self) -> List[int]:
        """Token usage for Q1-Q5."""
        return [m.total_tokens for m in sorted(self.query_metrics, key=lambda x: x.position_in_theme)]

    @property
    def precision_series(self) -> List[float]:
        """Retrieval precision for Q1-Q5."""
        return [m.retrieval_precision for m in sorted(self.query_metrics, key=lambda x: x.position_in_theme)]

    @property
    def llm_calls_series(self) -> List[int]:
        """LLM calls for Q1-Q5."""
        return [m.llm_calls for m in sorted(self.query_metrics, key=lambda x: x.position_in_theme)]

    @property
    def time_reduction_pct(self) -> Optional[float]:
        """Percentage time reduction from Q1 to Q5."""
        ts = self.time_series
        if len(ts) >= 2 and ts[0] > 0:
            return ((ts[0] - ts[-1]) / ts[0]) * 100
        return None

    @property
    def token_reduction_pct(self) -> Optional[float]:
        """Percentage token reduction from Q1 to Q5."""
        ts = self.token_series
        if len(ts) >= 2 and ts[0] > 0:
            return ((ts[0] - ts[-1]) / ts[0]) * 100
        return None

    @property
    def avg_time_first_half(self) -> float:
        ts = self.time_series
        first = ts[:len(ts)//2] if ts else []
        return sum(first) / len(first) if first else 0.0

    @property
    def avg_time_second_half(self) -> float:
        ts = self.time_series
        second = ts[len(ts)//2:] if ts else []
        return sum(second) / len(second) if second else 0.0


# ──────────────────────────────────────────────────────────────────────
# Backend client
# ──────────────────────────────────────────────────────────────────────

class BackendClient:
    """Client for sending queries to the GOVINDA backend.

    Supports two modes:
    - Single doc_id: all questions go to /query with the same doc_id
    - Multi-doc: ALM questions use alm_doc_id, KYC use kyc_doc_id,
      cross-document questions use /corpus/query (no doc_id needed)
    """

    def __init__(
        self,
        base_url: str,
        doc_id: str = "",
        alm_doc_id: str = "",
        kyc_doc_id: str = "",
        timeout: int = 300,
    ):
        self.base_url = base_url.rstrip("/")
        self.doc_id = doc_id          # Single-doc mode fallback
        self.alm_doc_id = alm_doc_id  # ALM-specific doc_id
        self.kyc_doc_id = kyc_doc_id  # KYC-specific doc_id
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "1",
        })

    def get_doc_id_for(self, document_type: str) -> str:
        """Resolve the correct doc_id for a document type (ALM/KYC/Cross-document)."""
        if document_type == "ALM" and self.alm_doc_id:
            return self.alm_doc_id
        if document_type == "KYC" and self.kyc_doc_id:
            return self.kyc_doc_id
        return self.doc_id  # Fallback to single doc_id

    def send_query(
        self,
        question: str,
        doc_id: Optional[str] = None,
        conv_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a single-document query to /query.

        Returns:
            Dict with keys: answer, record_id, conv_id, citations, verification_status,
            query_type, key_terms, sub_queries, retrieved_sections, routing_log,
            stage_timings, total_time_seconds, total_tokens, llm_calls
        """
        payload = {
            "query": question,
            "doc_id": doc_id or self.doc_id,
            "verify": True,
            "reflect": False,
        }
        if conv_id:
            payload["conv_id"] = conv_id

        url = f"{self.base_url}/query"
        response = self.session.post(url, json=payload, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def send_corpus_query(
        self,
        question: str,
        conv_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a cross-document query to /corpus/query.

        The corpus endpoint searches across all ingested documents.
        Response format matches single-doc but uses per_doc_routing_logs
        instead of routing_log.
        """
        payload = {
            "query": question,
            "verify": True,
        }
        if conv_id:
            payload["conv_id"] = conv_id

        url = f"{self.base_url}/corpus/query"
        response = self.session.post(url, json=payload, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def send_query_auto(
        self,
        question: str,
        document_type: str,
        conv_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Automatically route to /query or /corpus/query based on document type.

        - ALM/KYC → /query with appropriate doc_id
        - Cross-document → /corpus/query
        """
        if document_type == "Cross-document" and (self.alm_doc_id or self.kyc_doc_id):
            return self.send_corpus_query(question, conv_id=conv_id)
        else:
            target_doc_id = self.get_doc_id_for(document_type)
            return self.send_query(question, doc_id=target_doc_id, conv_id=conv_id)

    def check_health(self) -> bool:
        """Check if the backend is reachable."""
        try:
            resp = self.session.get(f"{self.base_url}/docs", timeout=10)
            return resp.status_code == 200
        except Exception:
            return False

    def get_memory_stats(self, doc_id: Optional[str] = None) -> Optional[Dict]:
        """Get memory system stats from the backend if available."""
        try:
            resp = self.session.get(
                f"{self.base_url}/admin/memory/stats",
                params={"doc_id": doc_id or self.doc_id},
                timeout=15,
            )
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        return None


# ──────────────────────────────────────────────────────────────────────
# Test Runner
# ──────────────────────────────────────────────────────────────────────

class LearningTestRunner:
    """
    Orchestrates the memory learning test.

    Sends questions theme-by-theme, maintaining conversation context within
    each theme (so memory loops see related questions sequentially).
    """

    def __init__(
        self,
        client: BackendClient,
        qa_pairs: List[QAPair],
        output_dir: str = "test_results",
        max_questions: int = 300,
        delay_between_questions: float = 2.0,
        delay_between_themes: float = 5.0,
        resume_from: int = 0,
    ):
        self.client = client
        self.qa_pairs = qa_pairs[:max_questions]
        self.themes = group_by_theme(self.qa_pairs)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.delay_between_questions = delay_between_questions
        self.delay_between_themes = delay_between_themes
        self.resume_from = resume_from

        self.all_metrics: List[QueryMetrics] = []
        self.theme_metrics: Dict[str, ThemeMetrics] = {}

        # Resume support: load existing results if available
        self._results_file = self.output_dir / "raw_results.json"
        if self.resume_from > 0:
            self._load_existing_results()

    def _load_existing_results(self):
        """Load previously saved results for resume support."""
        if self._results_file.exists():
            try:
                data = json.loads(self._results_file.read_text(encoding="utf-8"))
                for entry in data.get("query_metrics", []):
                    qm = QueryMetrics(**{k: v for k, v in entry.items()
                                         if k in QueryMetrics.__dataclass_fields__})
                    self.all_metrics.append(qm)
                logger.info("Resumed with %d previous results", len(self.all_metrics))
            except Exception as e:
                logger.warning("Could not load previous results: %s", e)

    def run(self) -> Dict[str, Any]:
        """
        Execute the full learning test.

        Sends questions theme-by-theme, with the 5 questions within each theme
        sent sequentially within the same conversation context.
        """
        logger.info("=" * 70)
        logger.info("GOVINDA MEMORY LEARNING TEST")
        logger.info("=" * 70)
        logger.info("Backend: %s", self.client.base_url)
        if self.client.alm_doc_id or self.client.kyc_doc_id:
            logger.info("ALM doc_id: %s", self.client.alm_doc_id or "(fallback)")
            logger.info("KYC doc_id: %s", self.client.kyc_doc_id or "(fallback)")
            logger.info("Cross-doc: /corpus/query endpoint")
        else:
            logger.info("Doc ID: %s (single-doc mode)", self.client.doc_id)
        logger.info("Questions: %d across %d themes", len(self.qa_pairs), len(self.themes))
        logger.info("Resume from: Q%d", self.resume_from)
        logger.info("=" * 70)

        # Pre-flight check
        if not self.client.check_health():
            logger.error("Backend is not reachable at %s", self.client.base_url)
            return {"error": "Backend unreachable"}

        # Capture initial memory stats
        initial_memory_stats = self.client.get_memory_stats()

        start_time = time.time()
        total_questions = len(self.qa_pairs)
        completed = 0
        failed = 0

        for theme_idx, theme in enumerate(self.themes):
            logger.info("")
            logger.info("-" * 60)
            logger.info("Theme %d/%d: %s [%s]",
                        theme_idx + 1, len(self.themes), theme.title, theme.document)
            logger.info("-" * 60)

            tm = ThemeMetrics(
                theme_number=theme.theme_number,
                theme_title=theme.title,
                document=theme.document,
            )

            # Each theme gets its own conversation context
            conv_id = None

            for q_idx, qa in enumerate(theme.questions):
                # Skip already-completed questions (resume support)
                if qa.number <= self.resume_from:
                    logger.info("  Skipping Q%d (already completed)", qa.number)
                    continue

                position = q_idx + 1
                logger.info("  Q%d [%d/5] [%s]: %s",
                            qa.number, position, qa.variation_type, qa.question[:60] + "...")

                # Send query and capture metrics
                qm = self._execute_query(qa, position, conv_id)
                self.all_metrics.append(qm)
                tm.query_metrics.append(qm)

                if qm.success:
                    completed += 1
                    conv_id = qm.conv_id or conv_id  # Maintain conversation
                    logger.info("    ✓ %.1fs | %d tokens | %d LLM calls | %d citations | precision=%.2f",
                                qm.wall_time_seconds, qm.total_tokens, qm.llm_calls,
                                qm.citations_count, qm.retrieval_precision)
                else:
                    failed += 1
                    logger.error("    ✗ FAILED: %s", qm.error)

                # Save after each question (crash resilience)
                self._save_incremental()

                # Delay between questions
                if q_idx < len(theme.questions) - 1:
                    time.sleep(self.delay_between_questions)

            self.theme_metrics[theme.theme_key] = tm

            # Log theme summary
            if tm.time_reduction_pct is not None:
                logger.info("  Theme summary: time reduction=%.1f%%, token reduction=%.1f%%",
                            tm.time_reduction_pct or 0, tm.token_reduction_pct or 0)

            # Delay between themes
            if theme_idx < len(self.themes) - 1:
                time.sleep(self.delay_between_themes)

        # Capture final memory stats
        final_memory_stats = self.client.get_memory_stats()

        elapsed = time.time() - start_time
        logger.info("")
        logger.info("=" * 70)
        logger.info("TEST COMPLETE: %d completed, %d failed, %.1fs total",
                     completed, failed, elapsed)
        logger.info("=" * 70)

        # Build and save final report
        report = self._build_report(initial_memory_stats, final_memory_stats, elapsed)
        self._save_report(report)

        return report

    def _execute_query(
        self, qa: QAPair, position: int, conv_id: Optional[str]
    ) -> QueryMetrics:
        """Execute a single query and capture all metrics."""
        qm = QueryMetrics(
            question_number=qa.number,
            question_text=qa.question,
            theme_number=qa.theme_number,
            theme_title=qa.theme_title,
            document=qa.document,
            variation_type=qa.variation_type,
            position_in_theme=position,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        try:
            wall_start = time.time()
            response = self.client.send_query_auto(
                qa.question, document_type=qa.document, conv_id=conv_id,
            )
            wall_end = time.time()

            qm.wall_time_seconds = round(wall_end - wall_start, 3)
            qm.server_time_seconds = response.get("total_time_seconds", 0.0)
            qm.stage_timings = response.get("stage_timings", {})
            qm.total_tokens = response.get("total_tokens", 0)
            qm.llm_calls = response.get("llm_calls", 0)
            qm.sections_retrieved = len(response.get("retrieved_sections", []))
            qm.citations_count = len(response.get("citations", []))
            qm.retrieval_precision = (
                qm.citations_count / qm.sections_retrieved
                if qm.sections_retrieved > 0
                else 0.0
            )
            qm.query_type = response.get("query_type", "")
            qm.key_terms = response.get("key_terms", [])
            qm.sub_queries = response.get("sub_queries", [])
            qm.verification_status = response.get("verification_status", "")
            qm.answer_length = len(response.get("answer", ""))
            qm.record_id = response.get("record_id", "")
            qm.conv_id = response.get("conv_id", "")

            # Extract routing log details
            routing_log = response.get("routing_log", {})
            if routing_log:
                qm.nodes_located = routing_log.get("total_nodes_located", 0)
                qm.nodes_read = routing_log.get("total_sections_read", 0)
                qm.tokens_retrieved = routing_log.get("total_tokens_retrieved", 0)

            qm.success = True

        except requests.exceptions.Timeout:
            qm.success = False
            qm.error = "Request timed out"
        except requests.exceptions.ConnectionError as e:
            qm.success = False
            qm.error = f"Connection error: {str(e)[:200]}"
        except requests.exceptions.HTTPError as e:
            qm.success = False
            qm.error = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
        except Exception as e:
            qm.success = False
            qm.error = f"Unexpected error: {str(e)[:200]}"

        return qm

    def _save_incremental(self):
        """Save current results incrementally (crash resilience)."""
        try:
            data = {
                "query_metrics": [asdict(m) for m in self.all_metrics],
                "last_question": self.all_metrics[-1].question_number if self.all_metrics else 0,
                "saved_at": datetime.now(timezone.utc).isoformat(),
            }
            self._results_file.write_text(
                json.dumps(data, indent=2, default=str), encoding="utf-8"
            )
        except Exception as e:
            logger.warning("Failed to save incremental results: %s", e)

    def _build_report(
        self,
        initial_stats: Optional[Dict],
        final_stats: Optional[Dict],
        elapsed: float,
    ) -> Dict[str, Any]:
        """Build the comprehensive learning analysis report."""
        report = {
            "meta": {
                "backend_url": self.client.base_url,
                "doc_id": self.client.doc_id or "(multi-doc mode)",
                "alm_doc_id": self.client.alm_doc_id,
                "kyc_doc_id": self.client.kyc_doc_id,
                "multi_doc_mode": bool(self.client.alm_doc_id or self.client.kyc_doc_id),
                "total_questions": len(self.qa_pairs),
                "total_themes": len(self.themes),
                "completed": sum(1 for m in self.all_metrics if m.success),
                "failed": sum(1 for m in self.all_metrics if not m.success),
                "total_elapsed_seconds": round(elapsed, 1),
                "run_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            "memory_stats": {
                "initial": initial_stats,
                "final": final_stats,
            },
            "overall_learning": self._compute_overall_learning(),
            "per_document_learning": self._compute_per_document_learning(),
            "per_theme_learning": self._compute_per_theme_learning(),
            "position_analysis": self._compute_position_analysis(),
            "raw_metrics": [asdict(m) for m in self.all_metrics],
        }
        return report

    def _compute_overall_learning(self) -> Dict:
        """Compute overall learning metrics across all questions."""
        successful = [m for m in self.all_metrics if m.success]
        if not successful:
            return {"error": "No successful queries"}

        # Split into first half vs second half
        mid = len(successful) // 2
        first_half = successful[:mid]
        second_half = successful[mid:]

        def avg(items, key):
            vals = [getattr(m, key) for m in items]
            return sum(vals) / len(vals) if vals else 0

        return {
            "total_successful": len(successful),
            "first_half": {
                "avg_wall_time": round(avg(first_half, "wall_time_seconds"), 3),
                "avg_server_time": round(avg(first_half, "server_time_seconds"), 3),
                "avg_tokens": round(avg(first_half, "total_tokens"), 1),
                "avg_llm_calls": round(avg(first_half, "llm_calls"), 2),
                "avg_precision": round(avg(first_half, "retrieval_precision"), 3),
                "avg_citations": round(avg(first_half, "citations_count"), 2),
                "avg_sections": round(avg(first_half, "sections_retrieved"), 2),
            },
            "second_half": {
                "avg_wall_time": round(avg(second_half, "wall_time_seconds"), 3),
                "avg_server_time": round(avg(second_half, "server_time_seconds"), 3),
                "avg_tokens": round(avg(second_half, "total_tokens"), 1),
                "avg_llm_calls": round(avg(second_half, "llm_calls"), 2),
                "avg_precision": round(avg(second_half, "retrieval_precision"), 3),
                "avg_citations": round(avg(second_half, "citations_count"), 2),
                "avg_sections": round(avg(second_half, "sections_retrieved"), 2),
            },
            "improvements": {
                "time_reduction_pct": round(
                    ((avg(first_half, "wall_time_seconds") - avg(second_half, "wall_time_seconds"))
                     / avg(first_half, "wall_time_seconds") * 100)
                    if avg(first_half, "wall_time_seconds") > 0 else 0, 1
                ),
                "token_reduction_pct": round(
                    ((avg(first_half, "total_tokens") - avg(second_half, "total_tokens"))
                     / avg(first_half, "total_tokens") * 100)
                    if avg(first_half, "total_tokens") > 0 else 0, 1
                ),
                "precision_improvement_pct": round(
                    ((avg(second_half, "retrieval_precision") - avg(first_half, "retrieval_precision"))
                     / max(avg(first_half, "retrieval_precision"), 0.01) * 100), 1
                ),
                "llm_calls_reduction_pct": round(
                    ((avg(first_half, "llm_calls") - avg(second_half, "llm_calls"))
                     / avg(first_half, "llm_calls") * 100)
                    if avg(first_half, "llm_calls") > 0 else 0, 1
                ),
            },
        }

    def _compute_per_document_learning(self) -> Dict:
        """Compute learning metrics per document (ALM, KYC, Cross-doc)."""
        results = {}
        for doc in ["ALM", "KYC", "Cross-document"]:
            doc_metrics = [m for m in self.all_metrics if m.success and m.document == doc]
            if not doc_metrics:
                continue

            mid = len(doc_metrics) // 2
            first_half = doc_metrics[:mid] if mid > 0 else doc_metrics
            second_half = doc_metrics[mid:] if mid > 0 else []

            def avg(items, key):
                vals = [getattr(m, key) for m in items]
                return sum(vals) / len(vals) if vals else 0

            results[doc] = {
                "total_questions": len(doc_metrics),
                "avg_wall_time_first": round(avg(first_half, "wall_time_seconds"), 3),
                "avg_wall_time_second": round(avg(second_half, "wall_time_seconds"), 3) if second_half else None,
                "avg_tokens_first": round(avg(first_half, "total_tokens"), 1),
                "avg_tokens_second": round(avg(second_half, "total_tokens"), 1) if second_half else None,
                "avg_precision_first": round(avg(first_half, "retrieval_precision"), 3),
                "avg_precision_second": round(avg(second_half, "retrieval_precision"), 3) if second_half else None,
                "time_reduction_pct": round(
                    ((avg(first_half, "wall_time_seconds") - avg(second_half, "wall_time_seconds"))
                     / avg(first_half, "wall_time_seconds") * 100), 1
                ) if second_half and avg(first_half, "wall_time_seconds") > 0 else None,
            }
        return results

    def _compute_per_theme_learning(self) -> List[Dict]:
        """Compute learning metrics per theme (the 5-question groups)."""
        theme_reports = []
        for theme in self.themes:
            theme_qs = [m for m in self.all_metrics
                        if m.success and m.theme_number == theme.theme_number
                        and m.document == theme.document]
            if len(theme_qs) < 2:
                continue

            sorted_qs = sorted(theme_qs, key=lambda x: x.position_in_theme)
            times = [m.wall_time_seconds for m in sorted_qs]
            tokens = [m.total_tokens for m in sorted_qs]
            precisions = [m.retrieval_precision for m in sorted_qs]
            llm_calls = [m.llm_calls for m in sorted_qs]

            theme_reports.append({
                "theme_number": theme.theme_number,
                "theme_title": theme.title,
                "document": theme.document,
                "questions_completed": len(sorted_qs),
                "time_series": times,
                "token_series": tokens,
                "precision_series": precisions,
                "llm_calls_series": llm_calls,
                "q1_time": times[0] if times else None,
                "q5_time": times[-1] if len(times) >= 5 else times[-1] if times else None,
                "time_reduction_pct": round(
                    ((times[0] - times[-1]) / times[0] * 100), 1
                ) if times and times[0] > 0 else None,
                "token_reduction_pct": round(
                    ((tokens[0] - tokens[-1]) / tokens[0] * 100), 1
                ) if tokens and tokens[0] > 0 else None,
                "precision_improvement": round(
                    precisions[-1] - precisions[0], 3
                ) if precisions else None,
                "learning_detected": (
                    len(times) >= 3 and
                    sum(times[len(times)//2:]) / len(times[len(times)//2:])
                    < sum(times[:len(times)//2]) / len(times[:len(times)//2])
                ) if len(times) >= 3 else None,
            })
        return theme_reports

    def _compute_position_analysis(self) -> Dict:
        """
        Aggregate by position-in-theme (1-5) across ALL themes.

        This is the strongest signal: if Q2 is consistently faster than Q1
        across 60 themes, that's strong evidence of learning.
        """
        position_data = {i: [] for i in range(1, 6)}

        for m in self.all_metrics:
            if m.success and 1 <= m.position_in_theme <= 5:
                position_data[m.position_in_theme].append(m)

        results = {}
        for pos in range(1, 6):
            metrics = position_data[pos]
            if not metrics:
                continue
            results[f"position_{pos}"] = {
                "count": len(metrics),
                "avg_wall_time": round(sum(m.wall_time_seconds for m in metrics) / len(metrics), 3),
                "avg_server_time": round(sum(m.server_time_seconds for m in metrics) / len(metrics), 3),
                "avg_tokens": round(sum(m.total_tokens for m in metrics) / len(metrics), 1),
                "avg_llm_calls": round(sum(m.llm_calls for m in metrics) / len(metrics), 2),
                "avg_precision": round(sum(m.retrieval_precision for m in metrics) / len(metrics), 3),
                "avg_citations": round(sum(m.citations_count for m in metrics) / len(metrics), 2),
                "avg_sections": round(sum(m.sections_retrieved for m in metrics) / len(metrics), 2),
                "avg_nodes_located": round(sum(m.nodes_located for m in metrics) / len(metrics), 2),
            }

        # Compute improvement from position 1 to position 5
        if "position_1" in results and "position_5" in results:
            p1 = results["position_1"]
            p5 = results["position_5"]
            results["improvement_1_to_5"] = {
                "time_reduction_pct": round(
                    ((p1["avg_wall_time"] - p5["avg_wall_time"]) / p1["avg_wall_time"] * 100), 1
                ) if p1["avg_wall_time"] > 0 else 0,
                "token_reduction_pct": round(
                    ((p1["avg_tokens"] - p5["avg_tokens"]) / p1["avg_tokens"] * 100), 1
                ) if p1["avg_tokens"] > 0 else 0,
                "precision_improvement": round(p5["avg_precision"] - p1["avg_precision"], 3),
                "llm_calls_reduction_pct": round(
                    ((p1["avg_llm_calls"] - p5["avg_llm_calls"]) / p1["avg_llm_calls"] * 100), 1
                ) if p1["avg_llm_calls"] > 0 else 0,
            }

        return results

    def _save_report(self, report: Dict):
        """Save the full report to disk."""
        report_file = self.output_dir / "learning_report.json"
        report_file.write_text(
            json.dumps(report, indent=2, default=str), encoding="utf-8"
        )
        logger.info("Full report saved to %s", report_file)

        # Also save a human-readable summary
        summary_file = self.output_dir / "learning_summary.txt"
        summary_file.write_text(self._format_summary(report), encoding="utf-8")
        logger.info("Summary saved to %s", summary_file)

    def _format_summary(self, report: Dict) -> str:
        """Generate a human-readable summary of the learning test."""
        lines = []
        lines.append("=" * 70)
        lines.append("GOVINDA MEMORY LEARNING TEST — SUMMARY REPORT")
        lines.append("=" * 70)
        lines.append("")

        meta = report["meta"]
        lines.append(f"Run: {meta['run_timestamp']}")
        lines.append(f"Backend: {meta['backend_url']}")
        lines.append(f"Doc ID: {meta['doc_id']}")
        lines.append(f"Questions: {meta['completed']} completed, {meta['failed']} failed")
        lines.append(f"Total time: {meta['total_elapsed_seconds']:.0f}s")
        lines.append("")

        # Overall learning
        overall = report.get("overall_learning", {})
        if "improvements" in overall:
            imp = overall["improvements"]
            lines.append("─" * 40)
            lines.append("OVERALL LEARNING METRICS")
            lines.append("─" * 40)
            lines.append(f"  Time reduction (1st half → 2nd half):      {imp['time_reduction_pct']:+.1f}%")
            lines.append(f"  Token reduction (1st half → 2nd half):     {imp['token_reduction_pct']:+.1f}%")
            lines.append(f"  Precision improvement:                     {imp['precision_improvement_pct']:+.1f}%")
            lines.append(f"  LLM calls reduction:                       {imp['llm_calls_reduction_pct']:+.1f}%")
            lines.append("")

        # Position analysis (strongest signal)
        pos = report.get("position_analysis", {})
        if "improvement_1_to_5" in pos:
            imp = pos["improvement_1_to_5"]
            lines.append("─" * 40)
            lines.append("POSITION ANALYSIS (Q1 vs Q5 within themes)")
            lines.append("─" * 40)
            lines.append("This is the key metric. Within each theme, Q1 is the first")
            lines.append("question on a topic and Q5 is the 5th variation. If the")
            lines.append("memory system works, Q5 should be faster and cheaper.")
            lines.append("")

            for p in range(1, 6):
                key = f"position_{p}"
                if key in pos:
                    d = pos[key]
                    lines.append(f"  Position {p}: {d['avg_wall_time']:.1f}s | "
                                 f"{d['avg_tokens']} tokens | "
                                 f"{d['avg_llm_calls']:.1f} LLM calls | "
                                 f"precision={d['avg_precision']:.3f}")
            lines.append("")
            lines.append(f"  Q1→Q5 Time reduction:      {imp['time_reduction_pct']:+.1f}%")
            lines.append(f"  Q1→Q5 Token reduction:     {imp['token_reduction_pct']:+.1f}%")
            lines.append(f"  Q1→Q5 Precision change:    {imp['precision_improvement']:+.3f}")
            lines.append(f"  Q1→Q5 LLM calls reduction: {imp['llm_calls_reduction_pct']:+.1f}%")
            lines.append("")

        # Per-document
        per_doc = report.get("per_document_learning", {})
        if per_doc:
            lines.append("─" * 40)
            lines.append("PER-DOCUMENT LEARNING")
            lines.append("─" * 40)
            for doc, data in per_doc.items():
                lines.append(f"  {doc}: {data['total_questions']} questions")
                if data.get("time_reduction_pct") is not None:
                    lines.append(f"    Time reduction: {data['time_reduction_pct']:+.1f}%")
                lines.append("")

        # Per-theme highlights (top 5 most improved, top 5 least improved)
        theme_reports = report.get("per_theme_learning", [])
        if theme_reports:
            with_reduction = [t for t in theme_reports if t.get("time_reduction_pct") is not None]
            if with_reduction:
                most_improved = sorted(with_reduction, key=lambda x: x["time_reduction_pct"], reverse=True)[:5]
                least_improved = sorted(with_reduction, key=lambda x: x["time_reduction_pct"])[:5]

                lines.append("─" * 40)
                lines.append("TOP 5 MOST IMPROVED THEMES")
                lines.append("─" * 40)
                for t in most_improved:
                    lines.append(f"  Theme {t['theme_number']} ({t['document']}): "
                                 f"{t['time_reduction_pct']:+.1f}% time | "
                                 f"{t.get('token_reduction_pct', 0):+.1f}% tokens")
                    lines.append(f"    {t['theme_title'][:60]}")
                lines.append("")

                lines.append("─" * 40)
                lines.append("TOP 5 LEAST IMPROVED THEMES (potential issues)")
                lines.append("─" * 40)
                for t in least_improved:
                    lines.append(f"  Theme {t['theme_number']} ({t['document']}): "
                                 f"{t['time_reduction_pct']:+.1f}% time | "
                                 f"{t.get('token_reduction_pct', 0):+.1f}% tokens")
                    lines.append(f"    {t['theme_title'][:60]}")
                lines.append("")

        # Verdict
        lines.append("=" * 70)
        lines.append("VERDICT")
        lines.append("=" * 70)

        if "improvement_1_to_5" in pos:
            imp = pos["improvement_1_to_5"]
            time_ok = imp["time_reduction_pct"] > 5
            token_ok = imp["token_reduction_pct"] > 5
            precision_ok = imp["precision_improvement"] > 0

            if time_ok and token_ok:
                lines.append("✓ PASS: The memory system IS learning.")
                lines.append(f"  Time reduces by {imp['time_reduction_pct']:.1f}% from Q1→Q5")
                lines.append(f"  Tokens reduce by {imp['token_reduction_pct']:.1f}% from Q1→Q5")
            elif time_ok or token_ok:
                lines.append("~ PARTIAL: The memory system shows SOME learning.")
                if time_ok:
                    lines.append(f"  Time reduces by {imp['time_reduction_pct']:.1f}%")
                if token_ok:
                    lines.append(f"  Tokens reduce by {imp['token_reduction_pct']:.1f}%")
                if not time_ok:
                    lines.append(f"  But time did NOT improve ({imp['time_reduction_pct']:.1f}%)")
                if not token_ok:
                    lines.append(f"  But tokens did NOT improve ({imp['token_reduction_pct']:.1f}%)")
            else:
                lines.append("✗ FAIL: The memory system is NOT showing measurable learning.")
                lines.append(f"  Time change: {imp['time_reduction_pct']:.1f}%")
                lines.append(f"  Token change: {imp['token_reduction_pct']:.1f}%")
                lines.append(f"  Precision change: {imp['precision_improvement']:.3f}")
        else:
            lines.append("? INSUFFICIENT DATA: Not enough results to determine learning.")

        lines.append("")
        return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="GOVINDA Memory Learning Test Harness",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full 300-question test
  python -m tests.memory_learning.learning_test_harness \\
      --backend-url https://your-url.ngrok-free.dev \\
      --doc-id YOUR_DOC_ID

  # Quick test with first 10 questions
  python -m tests.memory_learning.learning_test_harness \\
      --backend-url http://localhost:8001 \\
      --doc-id YOUR_DOC_ID \\
      --questions 10

  # Resume from question 50
  python -m tests.memory_learning.learning_test_harness \\
      --backend-url http://localhost:8001 \\
      --doc-id YOUR_DOC_ID \\
      --resume-from 50
        """,
    )
    parser.add_argument("--backend-url", required=True, help="Backend URL (e.g. http://localhost:8001)")
    parser.add_argument("--doc-id", default="", help="Single document ID (used for all questions if --alm-doc-id/--kyc-doc-id not set)")
    parser.add_argument("--alm-doc-id", default="", help="Document ID for ALM (163MD) questions")
    parser.add_argument("--kyc-doc-id", default="", help="Document ID for KYC (169MD) questions")
    parser.add_argument("--questions", type=int, default=300, help="Max questions to run (default: 300)")
    parser.add_argument("--output-dir", default="test_results/memory_learning", help="Output directory")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between questions (seconds)")
    parser.add_argument("--theme-delay", type=float, default=5.0, help="Delay between themes (seconds)")
    parser.add_argument("--resume-from", type=int, default=0, help="Resume from question number")
    parser.add_argument("--timeout", type=int, default=300, help="Request timeout in seconds")
    parser.add_argument("--qa-file", default=None, help="Path to QA file (default: auto-detect)")

    args = parser.parse_args()

    # Find QA file
    if args.qa_file:
        qa_file = args.qa_file
    else:
        qa_file = str(PROJECT_ROOT / "rbi_open_ended_300_qa.md")

    logger.info("Parsing QA file: %s", qa_file)
    qa_pairs = parse_qa_file(qa_file)
    logger.info("Parsed %d questions", len(qa_pairs))

    # Validate doc_id arguments
    if not args.doc_id and not args.alm_doc_id and not args.kyc_doc_id:
        parser.error("Must provide --doc-id (single doc) or --alm-doc-id/--kyc-doc-id (multi-doc)")

    # Create client
    client = BackendClient(
        base_url=args.backend_url,
        doc_id=args.doc_id,
        alm_doc_id=args.alm_doc_id,
        kyc_doc_id=args.kyc_doc_id,
        timeout=args.timeout,
    )
    if args.alm_doc_id or args.kyc_doc_id:
        logger.info("Multi-doc mode: ALM=%s, KYC=%s, Cross-doc=corpus endpoint",
                     args.alm_doc_id or "(fallback)", args.kyc_doc_id or "(fallback)")
    else:
        logger.info("Single-doc mode: doc_id=%s", args.doc_id)

    # Create and run test
    runner = LearningTestRunner(
        client=client,
        qa_pairs=qa_pairs,
        output_dir=args.output_dir,
        max_questions=args.questions,
        delay_between_questions=args.delay,
        delay_between_themes=args.theme_delay,
        resume_from=args.resume_from,
    )

    report = runner.run()

    # Print summary to stdout
    if "error" not in report:
        summary_file = Path(args.output_dir) / "learning_summary.txt"
        if summary_file.exists():
            print(summary_file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
