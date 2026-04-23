"""
GOVINDA Accuracy Diagnostic — Key-Fact Scoring with Memory Tracking

Measures answer accuracy by checking coverage of known key facts from a
reference QA bank.  Tracks how memory accumulation affects accuracy over
successive queries on the same document.

Scoring method:
  For each question the system answers, an LLM judge checks which of the
  reference key_facts are present in the system answer.  This gives:
    - fact_coverage: fraction of key facts found (0.0–1.0)
    - per-fact verdicts: hit / miss for each fact
    - hallucination_flag: true if answer asserts something contradicting refs

Memory tracking:
  Before and after each query, MongoDB is queried for QI facts, user memory,
  and retrieval feedback state — so we can correlate memory growth with
  accuracy changes.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

logger = logging.getLogger("accuracy_diagnostic")


# ═══════════════════════════════════════════════════════════════════
# Data Models
# ═══════════════════════════════════════════════════════════════════

@dataclass
class FactVerdict:
    """Verdict for a single key fact."""
    fact: str = ""
    found: bool = False
    evidence: str = ""  # snippet from system answer that matches


@dataclass
class AccuracyScore:
    """Accuracy scoring result for a single question."""
    question_id: int = 0
    question_text: str = ""
    category: str = ""
    fact_coverage: float = 0.0  # 0.0–1.0
    facts_hit: int = 0
    facts_total: int = 0
    fact_verdicts: List[Dict[str, Any]] = field(default_factory=list)
    hallucination_detected: bool = False
    hallucination_details: str = ""
    # Timing / cost
    wall_time: float = 0.0
    total_tokens: int = 0
    llm_calls: int = 0
    citations_count: int = 0
    # Memory state
    memory_before: Dict[str, Any] = field(default_factory=dict)
    memory_after: Dict[str, Any] = field(default_factory=dict)
    # System answer for inspection
    system_answer: str = ""
    reference_answer: str = ""
    # LLM Decision Chain — tracks what the pipeline decided at each stage
    query_type: str = ""              # classification result
    sub_queries: List[str] = field(default_factory=list)
    key_terms: List[str] = field(default_factory=list)
    sections_retrieved: int = 0       # how many sections the LLM saw
    section_titles: List[str] = field(default_factory=list)  # what sections
    tokens_retrieved: int = 0         # total tokens in retrieved sections
    verification_status: str = ""     # verified / partially_verified / unverified
    inferred_points_count: int = 0    # how many inferences the LLM made
    # Meta
    conv_id: str = ""
    success: bool = True
    error: str = ""


@dataclass
class AccuracyReport:
    """Aggregated accuracy report."""
    total_questions: int = 0
    completed: int = 0
    failed: int = 0
    mean_fact_coverage: float = 0.0
    median_fact_coverage: float = 0.0
    min_fact_coverage: float = 0.0
    max_fact_coverage: float = 0.0
    hallucination_count: int = 0
    category_scores: Dict[str, float] = field(default_factory=dict)
    memory_correlation: Dict[str, Any] = field(default_factory=dict)
    scores: List[AccuracyScore] = field(default_factory=list)
    elapsed_seconds: float = 0.0
    timestamp: str = ""


# ═══════════════════════════════════════════════════════════════════
# Key-Fact Scorer (local, no LLM needed)
# ═══════════════════════════════════════════════════════════════════

class KeyFactScorer:
    """
    Scores system answers against reference key facts using fuzzy
    substring matching with paragraph-number awareness and stopword
    filtering.  No LLM call needed — fast and deterministic.
    """

    # Common words that inflate term counts without adding semantic signal
    STOPWORDS = frozenset({
        "the", "and", "is", "are", "for", "in", "of", "to", "a", "an",
        "by", "or", "on", "at", "be", "as", "it", "its", "has", "have",
        "was", "were", "not", "but", "with", "this", "that", "from",
        "also", "must", "can", "may", "shall", "should", "will",
        "all", "any", "each", "every", "both", "such", "than",
        "into", "through", "during", "before", "after", "between",
    })

    # Paragraph reference pattern: "Paragraph 5(2)(iii)" etc.
    PARA_PATTERN = re.compile(
        r"paragraph\s+(\d+)(?:\s*\([^)]+\))*", re.IGNORECASE
    )

    @staticmethod
    def _normalize(text: str) -> str:
        """Lowercase, collapse whitespace, strip punctuation for matching."""
        text = text.lower()
        text = re.sub(r"[''\"\"\"']", "", text)
        text = re.sub(r"[^\w\s₹%/><=]", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    @classmethod
    def _extract_paragraph_nums(cls, text: str) -> set:
        """Extract paragraph numbers mentioned in text (e.g., '5', '39')."""
        return {m.group(1) for m in cls.PARA_PATTERN.finditer(text.lower())}

    @classmethod
    def _significant_terms(cls, text: str) -> list:
        """Extract significant terms: length>=3 and not a stopword."""
        return [
            t for t in text.split()
            if len(t) >= 3 and t not in cls.STOPWORDS
        ]

    @staticmethod
    def _fuzzy_contains(haystack: str, needle: str, threshold: float = 0.60) -> tuple[bool, str]:
        """
        Check if the needle's key terms are substantially present in the
        haystack.  Returns (found, evidence_snippet).

        Strategy:
          1. Direct substring match
          2. Paragraph-number check (if fact references a paragraph)
          3. Significant-term overlap (stopwords filtered, threshold=0.60)
        """
        h_norm = KeyFactScorer._normalize(haystack)
        n_norm = KeyFactScorer._normalize(needle)

        # Direct substring match first
        if n_norm in h_norm:
            idx = h_norm.find(n_norm)
            start = max(0, idx - 20)
            end = min(len(h_norm), idx + len(n_norm) + 20)
            return True, h_norm[start:end]

        # Paragraph-number aware matching:
        # If the fact mentions a paragraph number, check if that paragraph
        # number appears anywhere in the answer (even with different clause
        # formatting). This gives partial credit.
        fact_paras = KeyFactScorer._extract_paragraph_nums(needle)
        answer_paras = KeyFactScorer._extract_paragraph_nums(haystack)
        para_match = bool(fact_paras and fact_paras & answer_paras)

        # Significant-term overlap (excluding stopwords)
        terms = KeyFactScorer._significant_terms(n_norm)
        if not terms:
            return n_norm in h_norm, ""

        hits = sum(1 for t in terms if t in h_norm)
        ratio = hits / len(terms)

        # If paragraph number matches AND term overlap >= 0.45, it's a hit
        # (the paragraph reference provides strong grounding)
        if para_match and ratio >= 0.45:
            matched = [t for t in terms if t in h_norm]
            return True, f"para+terms: {', '.join(matched[:5])}"

        if ratio >= threshold:
            matched = [t for t in terms if t in h_norm]
            return True, f"matched terms: {', '.join(matched[:5])}"

        return False, ""

    def score(
        self,
        system_answer: str,
        key_facts: List[str],
    ) -> tuple[float, List[FactVerdict]]:
        """
        Score a system answer against a list of key facts.

        Returns:
            (coverage_ratio, list_of_verdicts)
        """
        verdicts: List[FactVerdict] = []

        for fact in key_facts:
            found, evidence = self._fuzzy_contains(system_answer, fact)
            verdicts.append(FactVerdict(
                fact=fact,
                found=found,
                evidence=evidence,
            ))

        hits = sum(1 for v in verdicts if v.found)
        coverage = hits / len(key_facts) if key_facts else 0.0

        return coverage, verdicts


# ═══════════════════════════════════════════════════════════════════
# LLM-based Hallucination Detector (optional, uses OpenAI)
# ═══════════════════════════════════════════════════════════════════

class HallucinationDetector:
    """
    Uses a lightweight LLM call to check if the system answer contains
    factual assertions that directly contradict the reference answer.
    Only called when key_fact coverage is high (to avoid false positives
    on incomplete answers).
    """

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self._enabled = bool(self._api_key)

    def check(
        self,
        question: str,
        system_answer: str,
        reference_answer: str,
    ) -> tuple[bool, str]:
        """Returns (hallucination_detected, details)."""
        if not self._enabled:
            return False, "hallucination check skipped (no API key)"

        try:
            from openai import OpenAI
            client = OpenAI(api_key=self._api_key)

            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                temperature=0,
                max_tokens=300,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a regulatory compliance fact-checker. "
                            "Compare a SYSTEM answer against a REFERENCE answer "
                            "for a question about Indian banking KYC/AML regulations. "
                            "Identify if the SYSTEM answer contains any factual "
                            "assertions that DIRECTLY CONTRADICT the reference "
                            "(wrong paragraph numbers, wrong thresholds, wrong "
                            "definitions, inverted rules). "
                            "Respond with JSON: {\"hallucination\": true/false, "
                            "\"details\": \"explanation or empty string\"}"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"QUESTION: {question}\n\n"
                            f"REFERENCE ANSWER: {reference_answer[:2000]}\n\n"
                            f"SYSTEM ANSWER: {system_answer[:2000]}"
                        ),
                    },
                ],
            )

            text = resp.choices[0].message.content.strip()
            # Parse JSON from response
            json_match = re.search(r"\{.*\}", text, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return result.get("hallucination", False), result.get("details", "")
            return False, f"unparseable: {text[:100]}"

        except Exception as e:
            return False, f"hallucination check failed: {e}"


# ═══════════════════════════════════════════════════════════════════
# Memory Snapshot (lightweight, reuses logic from pipeline_diagnostic)
# ═══════════════════════════════════════════════════════════════════

class MemoryTracker:
    """Tracks memory state before/after queries for correlation analysis."""

    def __init__(self, mongo_uri: str, db_name: str = "govinda_v2"):
        self._uri = mongo_uri
        self._db_name = db_name
        self._client = None
        self._db = None

    def connect(self) -> bool:
        try:
            from pymongo import MongoClient
            self._client = MongoClient(self._uri, serverSelectionTimeoutMS=5000)
            self._client.admin.command("ping")
            self._db = self._client[self._db_name]
            logger.info("MongoDB connected: %s", self._db_name)
            return True
        except Exception as e:
            logger.warning("MongoDB connection failed: %s", e)
            return False

    def snapshot(self, doc_id: str) -> Dict[str, Any]:
        """Lightweight memory snapshot for accuracy correlation."""
        snap = {"timestamp": datetime.now(timezone.utc).isoformat()}
        if self._db is None:
            return snap

        try:
            # QI facts count
            qi_doc = self._db.query_intelligence.find_one({"doc_id": doc_id})
            snap["qi_facts"] = len(qi_doc.get("facts", [])) if qi_doc else 0

            # User memory
            um_doc = (
                self._db.user_memory.find_one({"_id": "default"})
                or self._db.user_memory.find_one({"user_id": "default"})
            )
            if um_doc:
                sessions = um_doc.get("sessions", {})
                if isinstance(sessions, dict):
                    total_entries = sum(
                        len(s.get("entries", []))
                        for s in sessions.values()
                        if isinstance(s, dict)
                    )
                else:
                    total_entries = 0
                snap["user_interactions"] = total_entries
                ctx = um_doc.get("context", "")
                snap["user_context_len"] = len(ctx) if isinstance(ctx, str) else 0
            else:
                snap["user_interactions"] = 0
                snap["user_context_len"] = 0

            # Retrieval feedback
            fb_doc = self._db.retrieval_feedback.find_one({"doc_id": doc_id})
            snap["feedback_nodes"] = len(fb_doc.get("nodes", {})) if fb_doc else 0

        except Exception as e:
            snap["error"] = str(e)

        return snap

    def close(self):
        if self._client:
            self._client.close()


# ═══════════════════════════════════════════════════════════════════
# Backend Client
# ═══════════════════════════════════════════════════════════════════

class AccuracyClient:
    """Sends queries to the GOVINDA backend and extracts answers."""

    def __init__(self, base_url: str, doc_id: str, timeout: int = 300):
        self.base_url = base_url.rstrip("/")
        self.doc_id = doc_id
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "1",
        })

    def query(
        self,
        question: str,
        conv_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a query and return the full response."""
        payload = {
            "query": question,
            "doc_id": self.doc_id,
            "verify": True,
            "reflect": False,
        }
        if conv_id:
            payload["conv_id"] = conv_id

        url = f"{self.base_url}/query"
        response = self.session.post(url, json=payload, timeout=self.timeout)
        response.raise_for_status()
        return response.json()


# ═══════════════════════════════════════════════════════════════════
# Accuracy Diagnostic Runner
# ═══════════════════════════════════════════════════════════════════

class AccuracyDiagnostic:
    """
    Runs accuracy diagnostic:
      1. Sends questions to backend
      2. Scores answers against key facts
      3. Optionally checks for hallucinations
      4. Tracks memory state correlation
      5. Produces detailed JSON + TXT reports
    """

    def __init__(
        self,
        client: AccuracyClient,
        qa_bank: List[Dict[str, Any]],
        scorer: KeyFactScorer,
        memory_tracker: Optional[MemoryTracker] = None,
        hallucination_detector: Optional[HallucinationDetector] = None,
        output_dir: str = "test_results/accuracy",
        delay: float = 3.0,
        max_questions: Optional[int] = None,
    ):
        self.client = client
        self.qa_bank = qa_bank[:max_questions] if max_questions else qa_bank
        self.scorer = scorer
        self.memory_tracker = memory_tracker
        self.hallucination_detector = hallucination_detector
        self.output_dir = output_dir
        self.delay = delay

        os.makedirs(output_dir, exist_ok=True)

    def run(self) -> AccuracyReport:
        """Run the full accuracy diagnostic."""
        report = AccuracyReport(
            total_questions=len(self.qa_bank),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        logger.info("=" * 70)
        logger.info("GOVINDA ACCURACY DIAGNOSTIC")
        logger.info("=" * 70)
        logger.info("Backend: %s", self.client.base_url)
        logger.info("Doc ID: %s", self.client.doc_id)
        logger.info("Questions: %d", len(self.qa_bank))
        logger.info("Hallucination check: %s",
                     "enabled" if self.hallucination_detector and self.hallucination_detector._enabled else "disabled")
        logger.info("Memory tracking: %s",
                     "enabled" if self.memory_tracker else "disabled")
        logger.info("=" * 70)

        start_time = time.time()
        conv_id = ""

        for i, qa in enumerate(self.qa_bank):
            qid = qa["id"]
            question = qa["question"]
            ref_answer = qa["reference_answer"]
            key_facts = qa["key_facts"]
            category = qa.get("category", "unknown")

            logger.info("")
            logger.info("  Q%d [%d/%d] [%s]: %s",
                        qid, i + 1, len(self.qa_bank), category,
                        question[:70] + "...")

            score = AccuracyScore(
                question_id=qid,
                question_text=question,
                category=category,
                reference_answer=ref_answer,
                facts_total=len(key_facts),
            )

            # Memory before
            if self.memory_tracker:
                score.memory_before = self.memory_tracker.snapshot(self.client.doc_id)
                logger.info("    [MEM] QI=%d, interactions=%d, feedback=%d",
                            score.memory_before.get("qi_facts", 0),
                            score.memory_before.get("user_interactions", 0),
                            score.memory_before.get("feedback_nodes", 0))

            # Send query
            try:
                wall_start = time.time()
                response = self.client.query(question, conv_id=conv_id or None)
                score.wall_time = time.time() - wall_start

                answer_text = response.get("answer", "")
                score.system_answer = answer_text
                score.total_tokens = response.get("total_tokens", 0)
                score.llm_calls = response.get("llm_calls", 0)
                score.citations_count = len(response.get("citations", []))
                score.conv_id = response.get("conv_id", "")

                # ── Extract LLM Decision Chain ──
                score.query_type = response.get("query_type", "")
                score.sub_queries = response.get("sub_queries", [])
                score.key_terms = response.get("key_terms", [])
                score.verification_status = response.get("verification_status", "")
                score.inferred_points_count = len(response.get("inferred_points", []))

                # Extract section info from routing_log or retrieved_sections
                routing_log = response.get("routing_log", {}) or {}
                retrieved_sections = response.get("retrieved_sections", [])
                if retrieved_sections:
                    score.sections_retrieved = len(retrieved_sections)
                    score.section_titles = [
                        s.get("title", "?")[:80] for s in retrieved_sections[:15]
                    ]
                    score.tokens_retrieved = sum(
                        s.get("token_count", 0) for s in retrieved_sections
                    )
                else:
                    score.sections_retrieved = routing_log.get("total_sections_read", 0)
                    score.tokens_retrieved = routing_log.get("total_tokens_retrieved", 0)
                    read_results = routing_log.get("read_results", [])
                    if read_results:
                        score.section_titles = [
                            r.get("title", "?")[:80] for r in read_results[:15]
                        ]

                logger.info(
                    "    [CHAIN] type=%s | subs=%d | sections=%d | %d tokens",
                    score.query_type, len(score.sub_queries),
                    score.sections_retrieved, score.tokens_retrieved,
                )

                if not conv_id and score.conv_id:
                    conv_id = score.conv_id

                # Score against key facts
                coverage, verdicts = self.scorer.score(answer_text, key_facts)
                score.fact_coverage = round(coverage, 4)
                score.facts_hit = sum(1 for v in verdicts if v.found)
                score.fact_verdicts = [asdict(v) for v in verdicts]

                # Hallucination check (only if coverage > 0.5 to avoid noise)
                if (
                    self.hallucination_detector
                    and self.hallucination_detector._enabled
                    and coverage > 0.5
                ):
                    h_found, h_details = self.hallucination_detector.check(
                        question, answer_text, ref_answer
                    )
                    score.hallucination_detected = h_found
                    score.hallucination_details = h_details

                score.success = True

                # Log result
                missed = [v.fact for v in verdicts if not v.found]
                logger.info(
                    "    ✓ %.1fs | %d/%d facts (%.0f%%) | %d tokens | %d citations%s",
                    score.wall_time, score.facts_hit, score.facts_total,
                    score.fact_coverage * 100, score.total_tokens,
                    score.citations_count,
                    " | ⚠ HALLUCINATION" if score.hallucination_detected else "",
                )
                if missed:
                    logger.info("    MISSED: %s",
                                "; ".join(m[:50] for m in missed[:3]))

            except Exception as e:
                score.wall_time = time.time() - wall_start
                score.success = False
                score.error = str(e)
                logger.error("    ✗ FAILED: %s", e)

            # Memory after
            if self.memory_tracker and score.success:
                score.memory_after = self.memory_tracker.snapshot(self.client.doc_id)

            report.scores.append(score)

            # Delay between queries
            if i < len(self.qa_bank) - 1:
                time.sleep(self.delay)

        report.elapsed_seconds = round(time.time() - start_time, 1)
        report.completed = sum(1 for s in report.scores if s.success)
        report.failed = sum(1 for s in report.scores if not s.success)

        # Aggregate stats
        coverages = [s.fact_coverage for s in report.scores if s.success]
        if coverages:
            report.mean_fact_coverage = round(sum(coverages) / len(coverages), 4)
            sorted_c = sorted(coverages)
            mid = len(sorted_c) // 2
            report.median_fact_coverage = round(
                sorted_c[mid] if len(sorted_c) % 2 else
                (sorted_c[mid - 1] + sorted_c[mid]) / 2, 4
            )
            report.min_fact_coverage = round(min(coverages), 4)
            report.max_fact_coverage = round(max(coverages), 4)

        report.hallucination_count = sum(
            1 for s in report.scores if s.hallucination_detected
        )

        # Category breakdown
        cats: Dict[str, List[float]] = {}
        for s in report.scores:
            if s.success:
                cats.setdefault(s.category, []).append(s.fact_coverage)
        report.category_scores = {
            cat: round(sum(vals) / len(vals), 4)
            for cat, vals in cats.items()
        }

        # Memory-accuracy correlation
        report.memory_correlation = self._compute_memory_correlation(report.scores)

        # Save reports
        self._save_json_report(report)
        self._save_text_report(report)

        logger.info("")
        logger.info("=" * 70)
        logger.info("ACCURACY DIAGNOSTIC COMPLETE")
        logger.info("  Questions: %d/%d completed", report.completed, report.total_questions)
        logger.info("  Mean coverage: %.1f%%", report.mean_fact_coverage * 100)
        logger.info("  Hallucinations: %d", report.hallucination_count)
        logger.info("  Time: %.0fs", report.elapsed_seconds)
        logger.info("  Reports: %s", self.output_dir)
        logger.info("=" * 70)

        return report

    def _compute_memory_correlation(
        self, scores: List[AccuracyScore]
    ) -> Dict[str, Any]:
        """Analyze whether more memory correlates with higher accuracy."""
        data_points = []
        for s in scores:
            if s.success and s.memory_before:
                data_points.append({
                    "qi_facts": s.memory_before.get("qi_facts", 0),
                    "user_interactions": s.memory_before.get("user_interactions", 0),
                    "feedback_nodes": s.memory_before.get("feedback_nodes", 0),
                    "fact_coverage": s.fact_coverage,
                })

        if len(data_points) < 3:
            return {"note": "insufficient data for correlation"}

        # Simple trend: first-third vs last-third accuracy
        n = len(data_points)
        third = max(1, n // 3)
        early = data_points[:third]
        late = data_points[-third:]

        early_acc = sum(d["fact_coverage"] for d in early) / len(early)
        late_acc = sum(d["fact_coverage"] for d in late) / len(late)

        return {
            "early_mean_coverage": round(early_acc, 4),
            "late_mean_coverage": round(late_acc, 4),
            "accuracy_trend": "improving" if late_acc > early_acc + 0.02
                              else "declining" if late_acc < early_acc - 0.02
                              else "stable",
            "early_qi_facts": early[0]["qi_facts"],
            "late_qi_facts": late[-1]["qi_facts"],
            "qi_growth": late[-1]["qi_facts"] - early[0]["qi_facts"],
            "data_points": len(data_points),
        }

    def _save_json_report(self, report: AccuracyReport) -> None:
        """Save detailed JSON report."""
        path = os.path.join(self.output_dir, "accuracy_report.json")
        data = {
            "meta": {
                "total_questions": report.total_questions,
                "completed": report.completed,
                "failed": report.failed,
                "elapsed_seconds": report.elapsed_seconds,
                "timestamp": report.timestamp,
            },
            "summary": {
                "mean_fact_coverage": report.mean_fact_coverage,
                "median_fact_coverage": report.median_fact_coverage,
                "min_fact_coverage": report.min_fact_coverage,
                "max_fact_coverage": report.max_fact_coverage,
                "hallucination_count": report.hallucination_count,
                "category_scores": report.category_scores,
            },
            "memory_correlation": report.memory_correlation,
            "scores": [asdict(s) for s in report.scores],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.info("JSON report: %s", path)

    def _save_text_report(self, report: AccuracyReport) -> None:
        """Save human-readable text report."""
        path = os.path.join(self.output_dir, "accuracy_report.txt")
        lines = [
            "=" * 70,
            "GOVINDA ACCURACY DIAGNOSTIC REPORT",
            "=" * 70,
            "",
            f"Date: {report.timestamp}",
            f"Questions: {report.completed}/{report.total_questions} completed",
            f"Time: {report.elapsed_seconds:.0f}s",
            "",
            "─" * 70,
            "SUMMARY",
            "─" * 70,
            f"  Mean fact coverage:   {report.mean_fact_coverage * 100:.1f}%",
            f"  Median fact coverage: {report.median_fact_coverage * 100:.1f}%",
            f"  Min:                  {report.min_fact_coverage * 100:.1f}%",
            f"  Max:                  {report.max_fact_coverage * 100:.1f}%",
            f"  Hallucinations:       {report.hallucination_count}",
            "",
            "  By Category:",
        ]
        for cat, score in sorted(report.category_scores.items()):
            lines.append(f"    {cat:25s} {score * 100:.1f}%")

        lines += [
            "",
            "─" * 70,
            "MEMORY ↔ ACCURACY CORRELATION",
            "─" * 70,
        ]
        mc = report.memory_correlation
        for k, v in mc.items():
            lines.append(f"  {k}: {v}")

        lines += [
            "",
            "─" * 70,
            "PER-QUESTION DETAILS",
            "─" * 70,
        ]

        for s in report.scores:
            status = "✓" if s.success else "✗"
            lines.append("")
            lines.append(
                f"  Q{s.question_id} [{s.category}] {status}"
            )
            lines.append(f"  {s.question_text[:80]}...")
            if s.success:
                lines.append(
                    f"  Coverage: {s.facts_hit}/{s.facts_total} "
                    f"({s.fact_coverage * 100:.0f}%) | "
                    f"{s.wall_time:.0f}s | "
                    f"{s.total_tokens} tokens | "
                    f"{s.citations_count} citations"
                )
                # Decision chain
                lines.append(
                    f"  DECISION CHAIN: type={s.query_type} | "
                    f"sub_queries={len(s.sub_queries)} | "
                    f"sections={s.sections_retrieved} ({s.tokens_retrieved} tok) | "
                    f"verification={s.verification_status} | "
                    f"inferences={s.inferred_points_count}"
                )
                if s.key_terms:
                    lines.append(f"  KEY TERMS: {', '.join(s.key_terms[:8])}")
                if s.section_titles:
                    lines.append(f"  SECTIONS RETRIEVED:")
                    for t in s.section_titles[:8]:
                        lines.append(f"    - {t}")
                missed = [
                    v["fact"] for v in s.fact_verdicts if not v["found"]
                ]
                if missed:
                    lines.append(f"  MISSED FACTS:")
                    for m in missed:
                        lines.append(f"    - {m}")
                if s.hallucination_detected:
                    lines.append(f"  ⚠ HALLUCINATION: {s.hallucination_details}")
            else:
                lines.append(f"  ERROR: {s.error}")

        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        logger.info("Text report: %s", path)


# ═══════════════════════════════════════════════════════════════════
# CLI Entry Point
# ═══════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="GOVINDA Accuracy Diagnostic"
    )
    parser.add_argument(
        "--backend-url", required=True,
        help="Backend URL (e.g. https://...ngrok-free.dev)"
    )
    parser.add_argument(
        "--doc-id", required=True,
        help="Document ID to query against (KYC doc)"
    )
    parser.add_argument(
        "--qa-bank", required=True,
        help="Path to QA bank JSON file"
    )
    parser.add_argument(
        "--mongo-uri", default=None,
        help="MongoDB URI for memory tracking"
    )
    parser.add_argument(
        "--questions", type=int, default=None,
        help="Limit number of questions to run"
    )
    parser.add_argument(
        "--output-dir", default="test_results/accuracy",
        help="Output directory for reports"
    )
    parser.add_argument(
        "--timeout", type=int, default=300,
        help="Per-query timeout in seconds"
    )
    parser.add_argument(
        "--delay", type=float, default=3.0,
        help="Delay between queries in seconds"
    )
    parser.add_argument(
        "--hallucination-check", action="store_true",
        help="Enable LLM-based hallucination detection (requires OPENAI_API_KEY)"
    )
    args = parser.parse_args()

    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    # Load QA bank
    qa_bank_path = Path(args.qa_bank)
    if not qa_bank_path.exists():
        logger.error("QA bank not found: %s", args.qa_bank)
        sys.exit(1)

    with open(qa_bank_path, "r", encoding="utf-8") as f:
        qa_bank = json.load(f)
    logger.info("Loaded %d questions from %s", len(qa_bank), args.qa_bank)

    # Initialize components
    client = AccuracyClient(
        base_url=args.backend_url,
        doc_id=args.doc_id,
        timeout=args.timeout,
    )

    scorer = KeyFactScorer()

    memory_tracker = None
    if args.mongo_uri:
        memory_tracker = MemoryTracker(args.mongo_uri)
        if not memory_tracker.connect():
            logger.warning("Proceeding without memory tracking")
            memory_tracker = None

    hallucination_detector = None
    if args.hallucination_check:
        hallucination_detector = HallucinationDetector()
        if not hallucination_detector._enabled:
            logger.warning("OPENAI_API_KEY not set — hallucination check disabled")
            hallucination_detector = None

    # Run diagnostic
    diagnostic = AccuracyDiagnostic(
        client=client,
        qa_bank=qa_bank,
        scorer=scorer,
        memory_tracker=memory_tracker,
        hallucination_detector=hallucination_detector,
        output_dir=args.output_dir,
        delay=args.delay,
        max_questions=args.questions,
    )

    try:
        report = diagnostic.run()
    finally:
        if memory_tracker:
            memory_tracker.close()

    sys.exit(0 if report.failed == 0 else 1)


if __name__ == "__main__":
    main()
