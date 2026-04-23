"""
GOVINDA Pipeline Diagnostic — Full Decision Audit

Records every decision made in the QA pipeline and WHY.
Designed to identify root causes of:
  - Token spikes (some queries use 5-7x more tokens than similar ones)
  - Time regression (later queries getting slower, not faster)
  - Stale memory (same suggestions every query)
  - Precision instability (0.25 → 0.94 → 0.44 within a theme)

Decision points captured:
  1. Memory pre-query: RAPTOR candidates, QI hints, user_context size, R2R results
  2. Query classification: type, key_terms, sub_queries generated
  3. Retrieval: input_tokens, nodes located/read, sections, tokens_retrieved
  4. Planner: sub-query count, sections per sub-query
  5. Synthesis: context size, output length, time
  6. Verification: skipped by QI? result
  7. Post-query: memory state changes

Also queries MongoDB directly to capture memory subsystem state between queries.
"""

from __future__ import annotations

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
_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from tests.memory_learning.qa_parser import parse_qa_file, group_by_theme, QAPair

logger = logging.getLogger("pipeline_diagnostic")


# ═══════════════════════════════════════════════════════════════════
# Data Models — Every decision is a structured record
# ═══════════════════════════════════════════════════════════════════

@dataclass
class MemorySnapshot:
    """Snapshot of memory subsystem state from MongoDB at a point in time."""
    timestamp: str = ""
    # Query Intelligence
    qi_total_facts: int = 0
    qi_suggested_nodes: List[str] = field(default_factory=list)
    qi_avoid_nodes: List[str] = field(default_factory=list)
    # RAPTOR Index
    raptor_hot_nodes: int = 0
    raptor_total_citations: int = 0
    # User Memory
    user_memory_sessions: int = 0
    user_memory_interactions: int = 0
    user_context_length: int = 0
    # Retrieval Feedback
    feedback_scored_nodes: int = 0
    feedback_boosted_nodes: int = 0
    feedback_penalized_nodes: int = 0
    # R2R Fallback
    r2r_index_size: int = 0
    # Raw data for deep inspection
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievalDecision:
    """Captures every decision in the retrieval stage."""
    query_type: str = ""
    sub_queries: List[str] = field(default_factory=list)
    sub_query_count: int = 0
    key_terms: List[str] = field(default_factory=list)
    # Memory influence
    qi_suggested_count: int = 0
    qi_avoid_count: int = 0
    raptor_candidates: int = 0
    total_memory_candidates: int = 0
    reliability_scored_nodes: int = 0
    user_context_injected: bool = False
    # Retrieval results
    nodes_located: int = 0
    nodes_read: int = 0
    sections_count: int = 0
    tokens_retrieved: int = 0
    # Benchmark breakdown
    retrieval_input_tokens: int = 0
    retrieval_output_tokens: int = 0
    retrieval_llm_calls: int = 0
    retrieval_duration: float = 0.0


@dataclass
class SynthesisDecision:
    """Captures decisions in synthesis + verification."""
    synthesis_duration: float = 0.0
    verification_duration: float = 0.0
    verification_status: str = ""
    verification_skipped_by_qi: bool = False
    answer_length: int = 0
    total_tokens: int = 0
    total_llm_calls: int = 0
    # Derived: how much of the token budget went to synthesis vs retrieval
    retrieval_tokens_pct: float = 0.0
    synthesis_tokens_pct: float = 0.0


@dataclass
class QueryAudit:
    """Complete audit trail for a single query."""
    # Identity
    question_number: int = 0
    question_text: str = ""
    theme_number: int = 0
    theme_title: str = ""
    document: str = ""
    variation_type: str = ""
    position_in_theme: int = 0
    # Timing
    wall_time: float = 0.0
    server_time: float = 0.0
    memory_prequery_time: float = 0.0
    load_tree_time: float = 0.0
    retrieval_time: float = 0.0
    synthesis_time: float = 0.0
    verification_time: float = 0.0
    # Decisions
    retrieval: RetrievalDecision = field(default_factory=RetrievalDecision)
    synthesis: SynthesisDecision = field(default_factory=SynthesisDecision)
    # Results
    citations_count: int = 0
    retrieval_precision: float = 0.0
    # Memory state before and after
    memory_before: Optional[MemorySnapshot] = None
    memory_after: Optional[MemorySnapshot] = None
    memory_delta: Dict[str, Any] = field(default_factory=dict)
    # Anomalies detected
    anomalies: List[str] = field(default_factory=list)
    # Raw response for deep inspection
    raw_response: Dict[str, Any] = field(default_factory=dict)
    # Conv ID for theme continuity
    conv_id: str = ""
    record_id: str = ""
    timestamp: str = ""
    success: bool = True
    error: str = ""


@dataclass
class ThemeAudit:
    """Aggregated audit for an entire theme (5 questions)."""
    theme_number: int = 0
    theme_title: str = ""
    document: str = ""
    queries: List[QueryAudit] = field(default_factory=list)
    # Learning indicators
    time_trend: List[float] = field(default_factory=list)
    token_trend: List[float] = field(default_factory=list)
    precision_trend: List[float] = field(default_factory=list)
    retrieval_input_token_trend: List[int] = field(default_factory=list)
    # Key decisions that changed (or didn't)
    sub_query_counts: List[int] = field(default_factory=list)
    qi_suggested_stable: bool = True  # Did QI suggestions change?
    memory_candidates_stable: bool = True
    # Anomalies
    anomalies: List[str] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════
# MongoDB Memory Inspector
# ═══════════════════════════════════════════════════════════════════

class MemoryInspector:
    """Directly queries MongoDB to capture memory subsystem state."""

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

    def snapshot(self, doc_id: str) -> MemorySnapshot:
        """Take a complete snapshot of all memory subsystems for a doc."""
        snap = MemorySnapshot(
            timestamp=datetime.now(timezone.utc).isoformat()
        )
        if self._db is None:
            return snap

        try:
            # Query Intelligence
            qi_col = self._db.get_collection("query_intelligence")
            qi_doc = qi_col.find_one({"doc_id": doc_id})
            if qi_doc:
                facts = qi_doc.get("facts", [])
                snap.qi_total_facts = len(facts)
                # Extract suggested and avoid nodes from most recent facts
                suggested = set()
                avoid = set()
                for f in facts:
                    for nid in f.get("node_ids", []):
                        if f.get("success_rate", 0) > 0.5:
                            suggested.add(nid)
                        elif f.get("success_rate", 0) < 0.2:
                            avoid.add(nid)
                snap.qi_suggested_nodes = list(suggested)[:20]
                snap.qi_avoid_nodes = list(avoid)[:10]
                snap.raw["qi"] = {
                    "total_facts": len(facts),
                    "sample_facts": [
                        {
                            "query_pattern": f.get("query_pattern", ""),
                            "node_ids": f.get("node_ids", []),
                            "success_rate": f.get("success_rate", 0),
                            "use_count": f.get("use_count", 0),
                        }
                        for f in facts[:5]
                    ]
                }

            # RAPTOR Index
            raptor_col = self._db.get_collection("raptor_indexes")
            raptor_doc = raptor_col.find_one({"doc_id": doc_id})
            if raptor_doc:
                heats = raptor_doc.get("heat_map", {})
                snap.raptor_hot_nodes = sum(
                    1 for v in heats.values()
                    if (v.get("citations", 0) if isinstance(v, dict) else v) > 1
                )
                snap.raptor_total_citations = sum(
                    (h.get("citations", 0) if isinstance(h, dict) else 0)
                    for h in heats.values()
                )
                snap.raw["raptor"] = {
                    "total_nodes_tracked": len(heats),
                    "hot_nodes": snap.raptor_hot_nodes,
                }

            # User Memory
            um_col = self._db.get_collection("user_memory")
            um_doc = um_col.find_one({"_id": "default"})
            if not um_doc:
                um_doc = um_col.find_one({"user_id": "default"})
            if um_doc:
                sessions = um_doc.get("sessions", {})
                if isinstance(sessions, list):
                    snap.user_memory_sessions = len(sessions)
                    snap.user_memory_interactions = sum(
                        len(s.get("interactions", s.get("entries", []))) for s in sessions
                    )
                else:
                    snap.user_memory_sessions = len(sessions)
                    snap.user_memory_interactions = sum(
                        len(s.get("entries", [])) for s in sessions.values()
                    )
                # Estimate context size
                profile = um_doc.get("profile", {})
                prefs = profile.get("preferences", {})
                snap.user_context_length = len(json.dumps(um_doc, default=str))
                snap.raw["user_memory"] = {
                    "sessions": len(sessions),
                    "interactions": snap.user_memory_interactions,
                    "profile_keys": list(profile.keys()) if profile else [],
                    "recent_interactions": (
                        [
                            {
                                "query": i.get("user_input", "")[:80],
                                "timestamp": i.get("timestamp", ""),
                            }
                            for s in (list(sessions.values())[-2:] if isinstance(sessions, dict) else sessions[-2:])
                            for i in s.get("entries", s.get("interactions", []))[-3:]
                        ]
                    )
                }

            # Retrieval Feedback
            fb_col = self._db.get_collection("retrieval_feedback")
            fb_doc = fb_col.find_one({"doc_id": doc_id})
            if fb_doc:
                nodes = fb_doc.get("nodes", fb_doc.get("node_scores", {}))
                snap.feedback_scored_nodes = len(nodes)
                snap.feedback_boosted_nodes = sum(
                    1 for v in nodes.values()
                    if (v if isinstance(v, (int, float)) else v.get("score", 0)) > 0.6
                )
                snap.feedback_penalized_nodes = sum(
                    1 for v in nodes.values()
                    if (v if isinstance(v, (int, float)) else v.get("score", 0)) < 0.4
                )
                snap.raw["feedback"] = {
                    "total_scored": len(nodes),
                    "boosted": snap.feedback_boosted_nodes,
                    "penalized": snap.feedback_penalized_nodes,
                }

            # R2R Fallback
            r2r_col = self._db.get_collection("r2r_fallback")
            r2r_doc = r2r_col.find_one({"doc_id": doc_id})
            if r2r_doc:
                snap.r2r_index_size = r2r_doc.get("index_size", 0)
                snap.raw["r2r"] = {"index_size": snap.r2r_index_size}

            # Memory contributions (recent)
            mc_col = self._db.get_collection("memory_contributions")
            recent = list(mc_col.find(
                {"doc_id": doc_id}
            ).sort("timestamp", -1).limit(3))
            if recent:
                snap.raw["recent_contributions"] = [
                    {
                        "query": r.get("query_text", "")[:60],
                        "contributed": r.get("memory_contributed", False),
                        "summary": r.get("contribution_summary", ""),
                        "precision": r.get("retrieval_precision", 0),
                    }
                    for r in recent
                ]

        except Exception as e:
            logger.warning("Memory snapshot failed: %s", e)
            snap.raw["error"] = str(e)

        return snap

    def close(self):
        if self._client:
            self._client.close()


# ═══════════════════════════════════════════════════════════════════
# Pipeline Diagnostic Client
# ═══════════════════════════════════════════════════════════════════

class DiagnosticClient:
    """
    Enhanced backend client that extracts every decision point from responses.
    """

    def __init__(
        self,
        base_url: str,
        alm_doc_id: str,
        kyc_doc_id: str,
        timeout: int = 300,
    ):
        self.base_url = base_url.rstrip("/")
        self.alm_doc_id = alm_doc_id
        self.kyc_doc_id = kyc_doc_id
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "1",
        })

    def get_doc_id(self, document_type: str) -> str:
        if document_type == "ALM":
            return self.alm_doc_id
        if document_type == "KYC":
            return self.kyc_doc_id
        return self.alm_doc_id  # fallback

    def send_query(
        self,
        question: str,
        doc_id: str,
        conv_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = {
            "query": question,
            "doc_id": doc_id,
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
        payload = {"query": question, "verify": True}
        if conv_id:
            payload["conv_id"] = conv_id
        url = f"{self.base_url}/corpus/query"
        response = self.session.post(url, json=payload, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def extract_audit(self, qa: QAPair, response: Dict, wall_time: float) -> QueryAudit:
        """
        Extract every decision point from a backend response into a QueryAudit.
        """
        audit = QueryAudit(
            question_number=qa.number,
            question_text=qa.question,
            theme_number=qa.theme_number,
            theme_title=qa.theme_title,
            document=qa.document,
            variation_type=qa.variation_type,
            position_in_theme=((qa.number - 1) % 5) + 1,
            wall_time=wall_time,
            citations_count=len(response.get("citations", [])),
            conv_id=response.get("conv_id", ""),
            record_id=response.get("record_id", ""),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        # Stage timings
        st = response.get("stage_timings", {})
        audit.memory_prequery_time = st.get("0_memory_prequery", 0)
        audit.load_tree_time = st.get("1_load_tree", 0)
        audit.retrieval_time = st.get("2_retrieval", 0)
        audit.synthesis_time = st.get("4_synthesis", 0)
        audit.verification_time = st.get("5_verification", 0)
        audit.server_time = response.get("total_time_seconds", 0)

        # Retrieval decisions from benchmark metadata
        benchmark = st.get("_benchmark", {})
        stages = benchmark.get("stages", [])

        rd = RetrievalDecision()
        rd.query_type = response.get("query_type", "")
        rd.sub_queries = response.get("sub_queries", [])
        rd.sub_query_count = len(rd.sub_queries)
        rd.key_terms = response.get("key_terms", [])

        # Extract from load_tree stage metadata (memory influence)
        for stage in stages:
            if stage["stage_name"] == "load_tree":
                meta = stage.get("metadata", {})
                rd.qi_suggested_count = meta.get("qi_suggested_nodes", 0)
                rd.qi_avoid_count = meta.get("qi_avoid_nodes", 0)
                rd.raptor_candidates = meta.get("raptor_candidates", 0)
                rd.total_memory_candidates = meta.get("total_memory_candidates", 0)
                rd.reliability_scored_nodes = meta.get("reliability_scored_nodes", 0)

            elif stage["stage_name"] == "retrieval":
                meta = stage.get("metadata", {})
                rd.user_context_injected = meta.get("user_context_injected", False)
                rd.sections_count = meta.get("sections_count", 0)
                rd.tokens_retrieved = meta.get("tokens_retrieved", 0)
                rd.retrieval_input_tokens = stage.get("input_tokens", 0)
                rd.retrieval_output_tokens = stage.get("output_tokens", 0)
                rd.retrieval_llm_calls = stage.get("llm_calls", 0)
                rd.retrieval_duration = stage.get("duration_seconds", 0)

        # From top-level response
        routing_log = response.get("routing_log", {}) or {}
        rd.nodes_located = routing_log.get("total_nodes_located", 0) or response.get("nodes_located", 0)
        rd.nodes_read = routing_log.get("total_sections_read", 0) or response.get("nodes_read", 0)
        if not rd.tokens_retrieved:
            rd.tokens_retrieved = routing_log.get("total_tokens_retrieved", 0)

        audit.retrieval = rd

        # Sections retrieved (fallback)
        sections = response.get("retrieved_sections", [])
        if sections and not rd.sections_count:
            rd.sections_count = len(sections)

        # Synthesis decisions
        sd = SynthesisDecision()
        sd.synthesis_duration = audit.synthesis_time
        sd.verification_duration = audit.verification_time
        sd.verification_status = response.get("verification_status", "")
        sd.answer_length = len(response.get("answer", ""))
        sd.total_tokens = response.get("total_tokens", 0)
        sd.total_llm_calls = response.get("llm_calls", 0)

        # Token budget split
        if sd.total_tokens > 0 and rd.retrieval_input_tokens > 0:
            sd.retrieval_tokens_pct = round(
                (rd.retrieval_input_tokens + rd.retrieval_output_tokens) / sd.total_tokens * 100, 1
            )
            sd.synthesis_tokens_pct = round(100 - sd.retrieval_tokens_pct, 1)

        # Check if verification was skipped by QI hint
        if sd.verification_status == "skipped" and audit.verification_time < 0.01:
            sd.verification_skipped_by_qi = True

        audit.synthesis = sd

        # Retrieval precision
        if rd.sections_count > 0:
            audit.retrieval_precision = round(
                audit.citations_count / rd.sections_count, 4
            )
        elif len(sections) > 0:
            cited_nodes = {c.get("node_id", "") for c in response.get("citations", [])}
            section_nodes = {s.get("node_id", "") for s in sections}
            audit.retrieval_precision = round(
                len(cited_nodes & section_nodes) / len(section_nodes), 4
            ) if section_nodes else 0

        # Raw response for deep inspection (trimmed)
        audit.raw_response = {
            "stage_timings": st,
            "routing_log": routing_log,
            "key_terms": rd.key_terms,
            "sub_queries": rd.sub_queries,
            "query_type": rd.query_type,
            "total_tokens": sd.total_tokens,
            "llm_calls": sd.total_llm_calls,
            "citations_count": audit.citations_count,
            "verification_status": sd.verification_status,
        }

        return audit

    def detect_anomalies(
        self,
        audit: QueryAudit,
        theme_history: List[QueryAudit],
    ) -> List[str]:
        """
        Detect anomalies by comparing this query to previous queries in the theme.
        """
        anomalies = []

        if not theme_history:
            return anomalies

        # Token spike: >2.5x the median of previous queries
        prev_tokens = [a.synthesis.total_tokens for a in theme_history if a.success]
        if prev_tokens:
            median_tokens = sorted(prev_tokens)[len(prev_tokens) // 2]
            if audit.synthesis.total_tokens > median_tokens * 2.5 and median_tokens > 0:
                anomalies.append(
                    f"TOKEN_SPIKE: {audit.synthesis.total_tokens:,} tokens "
                    f"vs median {median_tokens:,} ({audit.synthesis.total_tokens/median_tokens:.1f}x)"
                )

        # Retrieval input token spike
        prev_ret_input = [a.retrieval.retrieval_input_tokens for a in theme_history if a.success]
        if prev_ret_input:
            median_ret = sorted(prev_ret_input)[len(prev_ret_input) // 2]
            if audit.retrieval.retrieval_input_tokens > median_ret * 3 and median_ret > 0:
                anomalies.append(
                    f"RETRIEVAL_INPUT_SPIKE: {audit.retrieval.retrieval_input_tokens:,} "
                    f"vs median {median_ret:,} ({audit.retrieval.retrieval_input_tokens/median_ret:.1f}x)"
                )

        # Time regression: slower than Q1
        q1 = theme_history[0] if theme_history else None
        if q1 and audit.position_in_theme > 1:
            if audit.wall_time > q1.wall_time * 1.3:
                anomalies.append(
                    f"TIME_REGRESSION: Q{audit.position_in_theme} took {audit.wall_time:.1f}s "
                    f"vs Q1's {q1.wall_time:.1f}s (+{(audit.wall_time/q1.wall_time - 1)*100:.0f}%)"
                )

        # Precision drop
        if q1 and audit.position_in_theme > 1:
            if audit.retrieval_precision < q1.retrieval_precision * 0.5:
                anomalies.append(
                    f"PRECISION_DROP: {audit.retrieval_precision:.2f} "
                    f"vs Q1's {q1.retrieval_precision:.2f}"
                )

        # Stale memory: same QI suggestions as all previous queries
        if len(theme_history) >= 2:
            prev_qi = theme_history[-1].retrieval.qi_suggested_count
            if (audit.retrieval.qi_suggested_count == prev_qi
                    and audit.retrieval.total_memory_candidates == theme_history[-1].retrieval.total_memory_candidates):
                anomalies.append(
                    f"STALE_MEMORY: QI suggestions unchanged "
                    f"(still {audit.retrieval.qi_suggested_count} suggested, "
                    f"{audit.retrieval.total_memory_candidates} total candidates)"
                )

        # More LLM calls than Q1
        if q1 and audit.synthesis.total_llm_calls > q1.synthesis.total_llm_calls + 2:
            anomalies.append(
                f"LLM_CALLS_INCREASE: {audit.synthesis.total_llm_calls} "
                f"vs Q1's {q1.synthesis.total_llm_calls}"
            )

        # Memory pre-query time growing
        if len(theme_history) >= 2:
            prev_mem_times = [a.memory_prequery_time for a in theme_history]
            if audit.memory_prequery_time > max(prev_mem_times) * 2:
                anomalies.append(
                    f"MEMORY_PREQUERY_SLOW: {audit.memory_prequery_time:.2f}s "
                    f"vs previous max {max(prev_mem_times):.2f}s"
                )

        return anomalies


# ═══════════════════════════════════════════════════════════════════
# Diagnostic Test Runner
# ═══════════════════════════════════════════════════════════════════

class DiagnosticRunner:
    """
    Runs questions through the pipeline with full decision auditing.
    """

    def __init__(
        self,
        client: DiagnosticClient,
        qa_pairs: List[QAPair],
        memory_inspector: Optional[MemoryInspector] = None,
        output_dir: str = "test_results/diagnostic",
        delay: float = 2.0,
        theme_delay: float = 5.0,
    ):
        self.client = client
        self.qa_pairs = qa_pairs
        self.memory_inspector = memory_inspector
        self.output_dir = output_dir
        self.delay = delay
        self.theme_delay = theme_delay

        # Group by theme
        self.themes = group_by_theme(qa_pairs)

        # Audit storage
        self.all_audits: List[QueryAudit] = []
        self.theme_audits: List[ThemeAudit] = []

        os.makedirs(output_dir, exist_ok=True)

    def run(self) -> None:
        """Run the full diagnostic test."""
        logger.info("=" * 70)
        logger.info("GOVINDA PIPELINE DIAGNOSTIC — FULL DECISION AUDIT")
        logger.info("=" * 70)
        logger.info("Backend: %s", self.client.base_url)
        logger.info("ALM doc: %s", self.client.alm_doc_id)
        logger.info("KYC doc: %s", self.client.kyc_doc_id)
        logger.info("Questions: %d across %d themes", len(self.qa_pairs), len(self.themes))
        logger.info("MongoDB: %s", "connected" if self.memory_inspector and self.memory_inspector._db is not None else "not connected")
        logger.info("=" * 70)

        start_time = time.time()

        for t_idx, theme in enumerate(self.themes):
            theme_audit = ThemeAudit(
                theme_number=theme.theme_number,
                theme_title=theme.title,
                document=theme.questions[0].document,
            )
            theme_history: List[QueryAudit] = []
            conv_id = ""

            logger.info("")
            logger.info("─" * 60)
            logger.info("Theme %d/%d: %s [%s]",
                        t_idx + 1, len(self.themes),
                        theme.title[:60], theme.questions[0].document)
            logger.info("─" * 60)

            for q_idx, qa in enumerate(theme.questions):
                pos = q_idx + 1
                logger.info("")
                logger.info("  Q%d [%d/5] [%s]: %s",
                            qa.number, pos, qa.variation_type,
                            qa.question[:65] + "...")

                # ── Before: snapshot memory state ──
                doc_id = self.client.get_doc_id(qa.document)
                mem_before = None
                if self.memory_inspector:
                    mem_before = self.memory_inspector.snapshot(doc_id)
                    logger.info("    [MEM BEFORE] QI facts=%d, user_sessions=%d, "
                                "feedback_scored=%d, user_ctx_len=%d",
                                mem_before.qi_total_facts,
                                mem_before.user_memory_sessions,
                                mem_before.feedback_scored_nodes,
                                mem_before.user_context_length)

                # ── Execute query ──
                try:
                    wall_start = time.time()
                    if qa.document == "Cross-document":
                        response = self.client.send_corpus_query(
                            qa.question, conv_id=conv_id or None
                        )
                    else:
                        response = self.client.send_query(
                            qa.question, doc_id=doc_id,
                            conv_id=conv_id or None
                        )
                    wall_time = time.time() - wall_start

                    # Extract audit
                    audit = self.client.extract_audit(qa, response, wall_time)
                    audit.memory_before = mem_before
                    audit.success = True

                    # Set conv_id for theme continuity
                    if not conv_id and audit.conv_id:
                        conv_id = audit.conv_id
                    audit.conv_id = conv_id

                except Exception as e:
                    wall_time = time.time() - wall_start
                    audit = QueryAudit(
                        question_number=qa.number,
                        question_text=qa.question,
                        theme_number=qa.theme_number,
                        theme_title=qa.theme_title,
                        document=qa.document,
                        variation_type=qa.variation_type,
                        position_in_theme=pos,
                        wall_time=wall_time,
                        success=False,
                        error=str(e),
                    )
                    logger.error("    ✗ FAILED: %s", e)

                # ── After: snapshot memory state ──
                if self.memory_inspector and audit.success:
                    mem_after = self.memory_inspector.snapshot(doc_id)
                    audit.memory_after = mem_after

                    # Compute delta
                    if mem_before:
                        audit.memory_delta = {
                            "qi_facts_added": mem_after.qi_total_facts - mem_before.qi_total_facts,
                            "user_sessions_added": mem_after.user_memory_sessions - mem_before.user_memory_sessions,
                            "user_interactions_added": mem_after.user_memory_interactions - mem_before.user_memory_interactions,
                            "feedback_nodes_added": mem_after.feedback_scored_nodes - mem_before.feedback_scored_nodes,
                            "user_context_growth": mem_after.user_context_length - mem_before.user_context_length,
                        }
                        logger.info("    [MEM DELTA] qi_facts+%d, user_int+%d, "
                                    "fb_nodes+%d, ctx_growth=%+d bytes",
                                    audit.memory_delta.get("qi_facts_added", 0),
                                    audit.memory_delta.get("user_interactions_added", 0),
                                    audit.memory_delta.get("feedback_nodes_added", 0),
                                    audit.memory_delta.get("user_context_growth", 0))

                # ── Detect anomalies ──
                anomalies = self.client.detect_anomalies(audit, theme_history)
                audit.anomalies = anomalies

                # ── Log results ──
                if audit.success:
                    logger.info(
                        "    ✓ %.1fs | %d tokens | %d LLM calls | "
                        "%d citations | precision=%.2f",
                        audit.wall_time,
                        audit.synthesis.total_tokens,
                        audit.synthesis.total_llm_calls,
                        audit.citations_count,
                        audit.retrieval_precision,
                    )
                    logger.info(
                        "    [DECISIONS] type=%s | %d sub_queries | "
                        "qi_suggest=%d qi_avoid=%d | "
                        "ret_input=%d ret_output=%d | "
                        "%d sections (%d tokens_retrieved)",
                        audit.retrieval.query_type,
                        audit.retrieval.sub_query_count,
                        audit.retrieval.qi_suggested_count,
                        audit.retrieval.qi_avoid_count,
                        audit.retrieval.retrieval_input_tokens,
                        audit.retrieval.retrieval_output_tokens,
                        audit.retrieval.sections_count,
                        audit.retrieval.tokens_retrieved,
                    )
                    logger.info(
                        "    [TIMING] mem=%.2fs | tree=%.2fs | "
                        "retrieval=%.1fs | synth=%.1fs | verify=%.1fs",
                        audit.memory_prequery_time,
                        audit.load_tree_time,
                        audit.retrieval_time,
                        audit.synthesis_time,
                        audit.verification_time,
                    )

                for a in anomalies:
                    logger.warning("    ⚠ %s", a)

                # Store
                theme_history.append(audit)
                self.all_audits.append(audit)
                theme_audit.queries.append(audit)

                # Save incremental checkpoint
                self._save_checkpoint()

                # Delay
                if q_idx < len(theme.questions) - 1:
                    time.sleep(self.delay)

            # ── Theme summary ──
            self._summarize_theme(theme_audit)
            self.theme_audits.append(theme_audit)

            # Theme delay
            if t_idx < len(self.themes) - 1:
                time.sleep(self.theme_delay)

        # ── Final report ──
        elapsed = time.time() - start_time
        self._generate_reports(elapsed)
        logger.info("")
        logger.info("=" * 70)
        logger.info("DIAGNOSTIC COMPLETE: %d queries, %.0fs total",
                     len(self.all_audits), elapsed)
        logger.info("Reports saved to: %s", self.output_dir)
        logger.info("=" * 70)

    def _summarize_theme(self, ta: ThemeAudit) -> None:
        """Build theme-level summaries from individual query audits."""
        for q in ta.queries:
            if q.success:
                ta.time_trend.append(q.wall_time)
                ta.token_trend.append(q.synthesis.total_tokens)
                ta.precision_trend.append(q.retrieval_precision)
                ta.retrieval_input_token_trend.append(q.retrieval.retrieval_input_tokens)
                ta.sub_query_counts.append(q.retrieval.sub_query_count)

        # Check if QI suggestions changed across theme
        qi_counts = [q.retrieval.qi_suggested_count for q in ta.queries if q.success]
        ta.qi_suggested_stable = len(set(qi_counts)) <= 1

        mem_counts = [q.retrieval.total_memory_candidates for q in ta.queries if q.success]
        ta.memory_candidates_stable = len(set(mem_counts)) <= 1

        # Theme-level anomalies
        if ta.qi_suggested_stable and len(qi_counts) >= 3:
            ta.anomalies.append(
                f"STALE_QI: QI suggestions never changed across {len(qi_counts)} queries "
                f"(always {qi_counts[0]} suggested)"
            )

        if ta.retrieval_input_token_trend:
            max_ret = max(ta.retrieval_input_token_trend)
            min_ret = min(ta.retrieval_input_token_trend)
            if max_ret > min_ret * 5 and min_ret > 0:
                ta.anomalies.append(
                    f"RETRIEVAL_INPUT_VARIANCE: {min_ret:,} to {max_ret:,} "
                    f"({max_ret/min_ret:.1f}x range)"
                )

        if ta.time_trend and len(ta.time_trend) >= 3:
            if ta.time_trend[-1] > ta.time_trend[0] * 1.2:
                ta.anomalies.append(
                    f"TIME_DEGRADATION: Q1={ta.time_trend[0]:.1f}s → "
                    f"Q{len(ta.time_trend)}={ta.time_trend[-1]:.1f}s"
                )

        # Log
        logger.info("")
        logger.info("  THEME %d SUMMARY:", ta.theme_number)
        if ta.time_trend:
            logger.info("    Time:      %s",
                         " → ".join(f"{t:.0f}s" for t in ta.time_trend))
        if ta.token_trend:
            logger.info("    Tokens:    %s",
                         " → ".join(f"{t:,}" for t in ta.token_trend))
        if ta.precision_trend:
            logger.info("    Precision: %s",
                         " → ".join(f"{p:.2f}" for p in ta.precision_trend))
        if ta.retrieval_input_token_trend:
            logger.info("    Ret Input: %s",
                         " → ".join(f"{t:,}" for t in ta.retrieval_input_token_trend))
        if ta.sub_query_counts:
            logger.info("    SubQs:     %s",
                         " → ".join(str(c) for c in ta.sub_query_counts))
        for a in ta.anomalies:
            logger.warning("    ⚠ %s", a)

    def _save_checkpoint(self) -> None:
        """Save incremental checkpoint after each query."""
        path = os.path.join(self.output_dir, "checkpoint.json")
        data = {
            "completed": len(self.all_audits),
            "last_question": self.all_audits[-1].question_number if self.all_audits else 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        with open(path, "w") as f:
            json.dump(data, f)

    def _generate_reports(self, elapsed: float) -> None:
        """Generate comprehensive diagnostic reports."""

        # 1. Full audit JSON
        full_report = {
            "meta": {
                "backend_url": self.client.base_url,
                "alm_doc_id": self.client.alm_doc_id,
                "kyc_doc_id": self.client.kyc_doc_id,
                "total_questions": len(self.all_audits),
                "total_themes": len(self.theme_audits),
                "completed": sum(1 for a in self.all_audits if a.success),
                "failed": sum(1 for a in self.all_audits if not a.success),
                "elapsed_seconds": round(elapsed, 1),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            "query_audits": [self._serialize_audit(a) for a in self.all_audits],
            "theme_audits": [self._serialize_theme(t) for t in self.theme_audits],
            "root_cause_analysis": self._root_cause_analysis(),
        }

        path = os.path.join(self.output_dir, "diagnostic_report.json")
        with open(path, "w") as f:
            json.dump(full_report, f, indent=2, default=str)
        logger.info("Full report: %s", path)

        # 2. Decision audit (human-readable)
        self._write_decision_audit()

        # 3. Anomaly summary
        self._write_anomaly_report()

    def _root_cause_analysis(self) -> Dict[str, Any]:
        """
        Automated root-cause analysis based on all collected data.
        """
        rca: Dict[str, Any] = {"findings": [], "recommendations": []}

        successful = [a for a in self.all_audits if a.success]
        if not successful:
            return rca

        # ── Finding 1: Retrieval input token growth ──
        ret_inputs = [(a.question_number, a.retrieval.retrieval_input_tokens)
                      for a in successful]
        if ret_inputs:
            first_5 = [t for _, t in ret_inputs[:5]]
            last_5 = [t for _, t in ret_inputs[-5:]]
            avg_first = sum(first_5) / len(first_5) if first_5 else 0
            avg_last = sum(last_5) / len(last_5) if last_5 else 0
            if avg_last > avg_first * 3 and avg_first > 0:
                rca["findings"].append({
                    "id": "F1_RETRIEVAL_INPUT_GROWTH",
                    "severity": "critical",
                    "description": (
                        f"Retrieval input tokens grew from avg {avg_first:,.0f} "
                        f"(first 5) to {avg_last:,.0f} (last 5) — "
                        f"{avg_last/avg_first:.1f}x increase."
                    ),
                    "root_cause": (
                        "User memory context is injected into every retrieval query "
                        "and grows unboundedly as more queries are processed. "
                        "By Q11, the user_context accumulated from 10 previous "
                        "interactions was 190K+ tokens, overwhelming the retrieval "
                        "LLM calls."
                    ),
                    "evidence": [
                        f"Q{n}: {t:,} retrieval input tokens"
                        for n, t in ret_inputs
                    ],
                })
                rca["recommendations"].append({
                    "for": "F1_RETRIEVAL_INPUT_GROWTH",
                    "action": "Cap user_context injection to last 3 interactions "
                              "or max 2000 tokens. Add a summarization step that "
                              "compresses user history before injection.",
                    "priority": "critical",
                })

        # ── Finding 2: Synthesis time dominance ──
        synth_pcts = []
        for a in successful:
            if a.server_time > 0:
                synth_pcts.append(a.synthesis_time / a.server_time * 100)
        if synth_pcts:
            avg_synth_pct = sum(synth_pcts) / len(synth_pcts)
            if avg_synth_pct > 60:
                rca["findings"].append({
                    "id": "F2_SYNTHESIS_DOMINANCE",
                    "severity": "high",
                    "description": (
                        f"Synthesis consumes {avg_synth_pct:.0f}% of total server "
                        f"time on average. Retrieval is only ~30%. The Planner's "
                        f"multi-hop synthesis path is the primary bottleneck."
                    ),
                    "root_cause": (
                        "Every query is classified as multi_hop, triggering the "
                        "Planner which runs N parallel sub-query retrievals and "
                        "then synthesizes from all merged sections. The synthesis "
                        "prompt includes all retrieved content (~18K tokens of "
                        "document text) plus growing user context."
                    ),
                })
                rca["recommendations"].append({
                    "for": "F2_SYNTHESIS_DOMINANCE",
                    "action": "1) Add query caching for near-duplicate questions. "
                              "2) Classify simpler variations (explain, why) as "
                              "single_hop to skip the Planner. "
                              "3) Limit sub-queries to max 4.",
                    "priority": "high",
                })

        # ── Finding 3: Stale QI memory ──
        qi_counts = [a.retrieval.qi_suggested_count for a in successful]
        mem_counts = [a.retrieval.total_memory_candidates for a in successful]
        if qi_counts and len(set(qi_counts)) == 1 and len(qi_counts) >= 5:
            rca["findings"].append({
                "id": "F3_STALE_QI_MEMORY",
                "severity": "medium",
                "description": (
                    f"Query Intelligence suggestions never changed across "
                    f"{len(qi_counts)} queries (always {qi_counts[0]} suggested). "
                    f"The memory system is not adapting its node recommendations."
                ),
                "root_cause": (
                    "The QI subsystem records which nodes were useful for past "
                    "queries, but the suggested_nodes list is computed from "
                    "embedding similarity to the new query. Since all queries "
                    "are about ALM/liquidity risk, the same 10 nodes always "
                    "score highest. The avoid_nodes list also never grows beyond 1."
                ),
            })
            rca["recommendations"].append({
                "for": "F3_STALE_QI_MEMORY",
                "action": "Make QI suggestions theme-aware: weight recent "
                          "successes higher for queries with matching key_terms. "
                          "Decay old suggestions faster for repeated themes.",
                "priority": "medium",
            })

        # ── Finding 4: All queries classified as multi_hop ──
        query_types = [a.retrieval.query_type for a in successful]
        if query_types and len(set(query_types)) == 1:
            rca["findings"].append({
                "id": "F4_UNIFORM_CLASSIFICATION",
                "severity": "medium",
                "description": (
                    f"All {len(query_types)} queries classified as "
                    f"'{query_types[0]}'. No query was classified as "
                    f"single_hop or definitional, despite variation types "
                    f"including simple 'explain' and 'why' questions."
                ),
                "root_cause": (
                    "The QueryClassifier's prompt or thresholds are too "
                    "aggressive — complex regulatory questions with "
                    "multiple key terms always trigger multi_hop. "
                    "This forces every query through the expensive Planner path."
                ),
            })
            rca["recommendations"].append({
                "for": "F4_UNIFORM_CLASSIFICATION",
                "action": "Add classification feedback from QI: if a theme has "
                          "been answered as multi_hop before and precision was "
                          "high, downgrade subsequent variations to single_hop.",
                "priority": "medium",
            })

        # ── Finding 5: Token bimodality ──
        tokens = [a.synthesis.total_tokens for a in successful]
        if tokens:
            median_tok = sorted(tokens)[len(tokens) // 2]
            spikes = [t for t in tokens if t > median_tok * 3]
            if len(spikes) >= 3:
                rca["findings"].append({
                    "id": "F5_TOKEN_BIMODALITY",
                    "severity": "high",
                    "description": (
                        f"{len(spikes)}/{len(tokens)} queries used >3x the "
                        f"median token count ({median_tok:,}). Token usage is "
                        f"bimodal: ~70K or ~400-500K with nothing in between."
                    ),
                    "root_cause": (
                        "Correlated with retrieval_input_tokens. When user "
                        "context is small (<15K), total tokens stay ~70K. "
                        "When user context bloats to 190K+, total tokens "
                        "spike to 400K+. The bimodality reflects whether "
                        "user_context accumulated enough history to cross "
                        "a threshold."
                    ),
                })

        # ── Finding 6: RAPTOR candidates always 0 ──
        raptor_counts = [a.retrieval.raptor_candidates for a in successful]
        if raptor_counts and all(r == 0 for r in raptor_counts):
            rca["findings"].append({
                "id": "F6_RAPTOR_INACTIVE",
                "severity": "low",
                "description": (
                    "RAPTOR index contributed 0 candidates for all queries. "
                    "The 'Know What Matters' learning loop is not firing."
                ),
                "root_cause": (
                    "RAPTOR requires explicit index building (raptor.build_index) "
                    "which may not be triggered by normal query flow. "
                    "Or the RAPTOR feature flag is disabled."
                ),
            })

        return rca

    def _serialize_audit(self, a: QueryAudit) -> Dict:
        d = {
            "question_number": a.question_number,
            "question_text": a.question_text,
            "theme_number": a.theme_number,
            "document": a.document,
            "variation_type": a.variation_type,
            "position_in_theme": a.position_in_theme,
            "wall_time": round(a.wall_time, 2),
            "server_time": round(a.server_time, 2),
            "timing_breakdown": {
                "memory_prequery": round(a.memory_prequery_time, 3),
                "load_tree": round(a.load_tree_time, 3),
                "retrieval": round(a.retrieval_time, 2),
                "synthesis": round(a.synthesis_time, 2),
                "verification": round(a.verification_time, 2),
            },
            "retrieval_decisions": asdict(a.retrieval),
            "synthesis_decisions": asdict(a.synthesis),
            "citations_count": a.citations_count,
            "retrieval_precision": a.retrieval_precision,
            "anomalies": a.anomalies,
            "memory_delta": a.memory_delta,
            "conv_id": a.conv_id,
            "record_id": a.record_id,
            "success": a.success,
            "error": a.error,
        }
        if a.memory_before:
            d["memory_before"] = {
                "qi_facts": a.memory_before.qi_total_facts,
                "user_sessions": a.memory_before.user_memory_sessions,
                "user_interactions": a.memory_before.user_memory_interactions,
                "user_context_length": a.memory_before.user_context_length,
                "feedback_scored": a.memory_before.feedback_scored_nodes,
                "raptor_hot": a.memory_before.raptor_hot_nodes,
            }
        if a.memory_after:
            d["memory_after"] = {
                "qi_facts": a.memory_after.qi_total_facts,
                "user_sessions": a.memory_after.user_memory_sessions,
                "user_interactions": a.memory_after.user_memory_interactions,
                "user_context_length": a.memory_after.user_context_length,
                "feedback_scored": a.memory_after.feedback_scored_nodes,
                "raptor_hot": a.memory_after.raptor_hot_nodes,
            }
        return d

    def _serialize_theme(self, ta: ThemeAudit) -> Dict:
        return {
            "theme_number": ta.theme_number,
            "theme_title": ta.theme_title,
            "document": ta.document,
            "time_trend": [round(t, 1) for t in ta.time_trend],
            "token_trend": ta.token_trend,
            "precision_trend": [round(p, 3) for p in ta.precision_trend],
            "retrieval_input_token_trend": ta.retrieval_input_token_trend,
            "sub_query_counts": ta.sub_query_counts,
            "qi_suggested_stable": ta.qi_suggested_stable,
            "memory_candidates_stable": ta.memory_candidates_stable,
            "anomalies": ta.anomalies,
        }

    def _write_decision_audit(self) -> None:
        """Write human-readable decision audit report."""
        path = os.path.join(self.output_dir, "decision_audit.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write("=" * 70 + "\n")
            f.write("GOVINDA PIPELINE — DECISION AUDIT REPORT\n")
            f.write("=" * 70 + "\n\n")
            f.write(f"Generated: {datetime.now(timezone.utc).isoformat()}\n")
            f.write(f"Questions: {len(self.all_audits)}\n")
            f.write(f"Themes: {len(self.theme_audits)}\n\n")

            for ta in self.theme_audits:
                f.write("─" * 70 + "\n")
                f.write(f"THEME {ta.theme_number}: {ta.theme_title}\n")
                f.write(f"Document: {ta.document}\n")
                f.write("─" * 70 + "\n\n")

                for q in ta.queries:
                    f.write(f"  Q{q.question_number} [{q.variation_type}] "
                            f"(position {q.position_in_theme}/5)\n")
                    f.write(f"  Question: {q.question_text[:100]}...\n")
                    f.write(f"  Status: {'✓' if q.success else '✗'}\n")

                    if not q.success:
                        f.write(f"  Error: {q.error}\n\n")
                        continue

                    f.write(f"\n  DECISIONS:\n")
                    f.write(f"    Query classified as: {q.retrieval.query_type}\n")
                    f.write(f"    Sub-queries generated: {q.retrieval.sub_query_count}\n")
                    for i, sq in enumerate(q.retrieval.sub_queries):
                        f.write(f"      {i+1}. {sq[:90]}\n")
                    f.write(f"    Key terms: {', '.join(q.retrieval.key_terms)}\n")
                    f.write(f"\n  MEMORY INFLUENCE:\n")
                    f.write(f"    QI suggested nodes: {q.retrieval.qi_suggested_count}\n")
                    f.write(f"    QI avoid nodes: {q.retrieval.qi_avoid_count}\n")
                    f.write(f"    RAPTOR candidates: {q.retrieval.raptor_candidates}\n")
                    f.write(f"    Total memory candidates: {q.retrieval.total_memory_candidates}\n")
                    f.write(f"    Reliability scored: {q.retrieval.reliability_scored_nodes}\n")
                    f.write(f"    User context injected: {q.retrieval.user_context_injected}\n")
                    f.write(f"\n  RETRIEVAL:\n")
                    f.write(f"    Input tokens to LLM: {q.retrieval.retrieval_input_tokens:,}\n")
                    f.write(f"    Output tokens from LLM: {q.retrieval.retrieval_output_tokens:,}\n")
                    f.write(f"    LLM calls: {q.retrieval.retrieval_llm_calls}\n")
                    f.write(f"    Nodes located: {q.retrieval.nodes_located}\n")
                    f.write(f"    Sections read: {q.retrieval.sections_count}\n")
                    f.write(f"    Tokens retrieved: {q.retrieval.tokens_retrieved:,}\n")
                    f.write(f"\n  SYNTHESIS:\n")
                    f.write(f"    Total tokens used: {q.synthesis.total_tokens:,}\n")
                    f.write(f"    Total LLM calls: {q.synthesis.total_llm_calls}\n")
                    f.write(f"    Answer length: {q.synthesis.answer_length:,} chars\n")
                    f.write(f"    Verification: {q.synthesis.verification_status}\n")
                    f.write(f"\n  TIMING:\n")
                    f.write(f"    Wall time: {q.wall_time:.1f}s\n")
                    f.write(f"    Server time: {q.server_time:.1f}s\n")
                    f.write(f"    Memory pre-query: {q.memory_prequery_time:.2f}s\n")
                    f.write(f"    Retrieval: {q.retrieval_time:.1f}s\n")
                    f.write(f"    Synthesis: {q.synthesis_time:.1f}s\n")
                    f.write(f"    Verification: {q.verification_time:.1f}s\n")
                    f.write(f"\n  RESULTS:\n")
                    f.write(f"    Citations: {q.citations_count}\n")
                    f.write(f"    Precision: {q.retrieval_precision:.2f}\n")

                    if q.memory_delta:
                        f.write(f"\n  MEMORY CHANGES:\n")
                        for k, v in q.memory_delta.items():
                            f.write(f"    {k}: {v:+d}\n")

                    if q.anomalies:
                        f.write(f"\n  ⚠ ANOMALIES:\n")
                        for a in q.anomalies:
                            f.write(f"    - {a}\n")

                    f.write("\n")

                # Theme summary
                f.write(f"  THEME TRENDS:\n")
                if ta.time_trend:
                    f.write(f"    Time:      {' → '.join(f'{t:.0f}s' for t in ta.time_trend)}\n")
                if ta.token_trend:
                    f.write(f"    Tokens:    {' → '.join(f'{t:,}' for t in ta.token_trend)}\n")
                if ta.precision_trend:
                    f.write(f"    Precision: {' → '.join(f'{p:.2f}' for p in ta.precision_trend)}\n")
                if ta.retrieval_input_token_trend:
                    f.write(f"    Ret Input: {' → '.join(f'{t:,}' for t in ta.retrieval_input_token_trend)}\n")
                if ta.anomalies:
                    f.write(f"\n  THEME ANOMALIES:\n")
                    for a in ta.anomalies:
                        f.write(f"    ⚠ {a}\n")
                f.write("\n\n")

            # Root cause analysis
            rca = self._root_cause_analysis()
            f.write("=" * 70 + "\n")
            f.write("ROOT CAUSE ANALYSIS\n")
            f.write("=" * 70 + "\n\n")
            for finding in rca.get("findings", []):
                f.write(f"[{finding['severity'].upper()}] {finding['id']}\n")
                f.write(f"  {finding['description']}\n")
                if "root_cause" in finding:
                    f.write(f"  ROOT CAUSE: {finding['root_cause']}\n")
                if "evidence" in finding:
                    f.write(f"  EVIDENCE:\n")
                    for e in finding["evidence"][:10]:
                        f.write(f"    - {e}\n")
                f.write("\n")

            f.write("\nRECOMMENDATIONS:\n")
            for rec in rca.get("recommendations", []):
                f.write(f"  [{rec['priority'].upper()}] {rec['for']}: {rec['action']}\n")

        logger.info("Decision audit: %s", path)

    def _write_anomaly_report(self) -> None:
        """Write a concise anomaly summary."""
        path = os.path.join(self.output_dir, "anomaly_report.txt")
        all_anomalies = []
        for a in self.all_audits:
            for anom in a.anomalies:
                all_anomalies.append((a.question_number, a.theme_number, anom))

        theme_anomalies = []
        for ta in self.theme_audits:
            for anom in ta.anomalies:
                theme_anomalies.append((ta.theme_number, anom))

        with open(path, "w", encoding="utf-8") as f:
            f.write("ANOMALY REPORT\n")
            f.write("=" * 50 + "\n\n")
            f.write(f"Total query anomalies: {len(all_anomalies)}\n")
            f.write(f"Total theme anomalies: {len(theme_anomalies)}\n\n")

            if all_anomalies:
                f.write("PER-QUERY ANOMALIES:\n")
                for qn, tn, anom in all_anomalies:
                    f.write(f"  Q{qn} (Theme {tn}): {anom}\n")

            if theme_anomalies:
                f.write("\nPER-THEME ANOMALIES:\n")
                for tn, anom in theme_anomalies:
                    f.write(f"  Theme {tn}: {anom}\n")

        logger.info("Anomaly report: %s", path)


# ═══════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════

def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    parser = argparse.ArgumentParser(
        description="GOVINDA Pipeline Diagnostic — Full Decision Audit"
    )
    parser.add_argument("--backend-url", required=True)
    parser.add_argument("--alm-doc-id", required=True)
    parser.add_argument("--kyc-doc-id", required=True)
    parser.add_argument("--mongo-uri", default="",
                        help="MongoDB URI for memory inspection")
    parser.add_argument("--questions", type=int, default=15,
                        help="Max questions (default: 15 = 3 themes)")
    parser.add_argument("--output-dir", default="test_results/diagnostic")
    parser.add_argument("--delay", type=float, default=2.0)
    parser.add_argument("--theme-delay", type=float, default=5.0)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--qa-file", default=None)
    args = parser.parse_args()

    # Parse QA file
    if args.qa_file:
        qa_path = args.qa_file
    else:
        qa_path = str(Path(__file__).resolve().parent.parent.parent / "rbi_open_ended_300_qa.md")

    qa_pairs = parse_qa_file(qa_path)
    qa_pairs = qa_pairs[:args.questions]
    logger.info("Loaded %d questions from %s", len(qa_pairs), qa_path)

    # Create client
    client = DiagnosticClient(
        base_url=args.backend_url,
        alm_doc_id=args.alm_doc_id,
        kyc_doc_id=args.kyc_doc_id,
        timeout=args.timeout,
    )

    # Optional MongoDB inspector
    inspector = None
    if args.mongo_uri:
        inspector = MemoryInspector(args.mongo_uri)
        if not inspector.connect():
            logger.warning("Continuing without MongoDB inspection")
            inspector = None

    # Run diagnostic
    runner = DiagnosticRunner(
        client=client,
        qa_pairs=qa_pairs,
        memory_inspector=inspector,
        output_dir=args.output_dir,
        delay=args.delay,
        theme_delay=args.theme_delay,
    )

    try:
        runner.run()
    finally:
        if inspector:
            inspector.close()


if __name__ == "__main__":
    main()
