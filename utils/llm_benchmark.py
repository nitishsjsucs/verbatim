"""
LLM Benchmark Runner — Test multiple models across all pipeline stages.

Tests each LLM call point (classification, expansion, location, reflection,
synthesis, verification) with different models to find the best model for
each step.  Results are stored in MongoDB for the admin dashboard.
"""

from __future__ import annotations

import json
import logging
import time
import traceback
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from config.prompt_loader import format_prompt, load_prompt
from config.settings import get_settings
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


# ─── Pipeline Stages ──────────────────────────────────────────────────────────

class PipelineStage(str, Enum):
    CLASSIFICATION = "classification"
    EXPANSION = "expansion"
    LOCATION = "location"
    REFLECTION = "reflection"
    SYNTHESIS = "synthesis"
    VERIFICATION = "verification"


STAGE_META: dict[str, dict[str, Any]] = {
    PipelineStage.CLASSIFICATION: {
        "label": "Query Classification",
        "prompt_category": "retrieval",
        "prompt_name": "query_classification",
        "llm_method": "chat_json",
        "default_model": "primary",
        "max_tokens": 1024,
        "reasoning_effort": "low",
        "temperature": None,
        "expected_keys": ["query_type", "key_terms"],
    },
    PipelineStage.EXPANSION: {
        "label": "Query Expansion",
        "prompt_category": "retrieval",
        "prompt_name": "query_expansion",
        "llm_method": "chat_json",
        "default_model": "primary",
        "max_tokens": 1024,
        "reasoning_effort": "none",
        "temperature": 0.3,
        "expected_keys": ["expanded_queries"],
    },
    PipelineStage.LOCATION: {
        "label": "Node Location",
        "prompt_category": "retrieval",
        "prompt_name": "node_location",
        "llm_method": "chat_json",
        "default_model": "primary",
        "max_tokens": 4096,
        "reasoning_effort": "medium",
        "temperature": None,
        "expected_keys": ["located_nodes"],
    },
    PipelineStage.REFLECTION: {
        "label": "Retrieval Reflection",
        "prompt_category": "retrieval",
        "prompt_name": "retrieval_reflection",
        "llm_method": "chat_json",
        "default_model": "primary",
        "max_tokens": 1024,
        "reasoning_effort": "low",
        "temperature": None,
        "expected_keys": ["sufficient", "confidence"],
    },
    PipelineStage.SYNTHESIS: {
        "label": "Answer Synthesis",
        "prompt_category": "answering",
        "prompt_name": "synthesis",
        "llm_method": "chat_json",
        "default_model": "pro",
        "max_tokens": 16384,
        "reasoning_effort": "medium",
        "temperature": None,
        "expected_keys": ["answer_text"],
    },
    PipelineStage.VERIFICATION: {
        "label": "Answer Verification",
        "prompt_category": "answering",
        "prompt_name": "verification",
        "llm_method": "chat_json",
        "default_model": "pro",
        "max_tokens": 8192,
        "reasoning_effort": "medium",
        "temperature": None,
        "expected_keys": ["verification_status"],
    },
}


# ─── Available Models ─────────────────────────────────────────────────────────

# Models the user can select from in the benchmark UI
AVAILABLE_MODELS = [
    # OpenAI flagship
    {"id": "gpt-4o",          "provider": "openai", "label": "GPT-4o"},
    {"id": "gpt-4o-mini",     "provider": "openai", "label": "GPT-4o Mini"},
    {"id": "gpt-4.1",         "provider": "openai", "label": "GPT-4.1"},
    {"id": "gpt-4.1-mini",    "provider": "openai", "label": "GPT-4.1 Mini"},
    {"id": "gpt-4.1-nano",    "provider": "openai", "label": "GPT-4.1 Nano"},
    {"id": "gpt-5.2",         "provider": "openai", "label": "GPT-5.2"},
    {"id": "gpt-5.2-pro",     "provider": "openai", "label": "GPT-5.2 Pro"},
    # Reasoning
    {"id": "o1",              "provider": "openai", "label": "o1"},
    {"id": "o1-mini",         "provider": "openai", "label": "o1-mini"},
    {"id": "o3",              "provider": "openai", "label": "o3"},
    {"id": "o3-mini",         "provider": "openai", "label": "o3-mini"},
    {"id": "o4-mini",         "provider": "openai", "label": "o4-mini"},
    # Open Source (via OpenRouter or compatible API)
    {"id": "deepseek/deepseek-r1",                 "provider": "openrouter", "label": "DeepSeek R1"},
    {"id": "deepseek/deepseek-chat-v3-0324",       "provider": "openrouter", "label": "DeepSeek V3"},
    {"id": "google/gemini-2.5-pro-preview",        "provider": "openrouter", "label": "Gemini 2.5 Pro"},
    {"id": "google/gemini-2.5-flash-preview",      "provider": "openrouter", "label": "Gemini 2.5 Flash"},
    {"id": "anthropic/claude-sonnet-4",            "provider": "openrouter", "label": "Claude Sonnet 4"},
    {"id": "anthropic/claude-3.5-haiku",           "provider": "openrouter", "label": "Claude 3.5 Haiku"},
    {"id": "meta-llama/llama-4-maverick",          "provider": "openrouter", "label": "Llama 4 Maverick"},
    {"id": "meta-llama/llama-4-scout",             "provider": "openrouter", "label": "Llama 4 Scout"},
    {"id": "qwen/qwen3-235b-a22b",                "provider": "openrouter", "label": "Qwen3 235B"},
    {"id": "mistralai/mistral-large-2411",         "provider": "openrouter", "label": "Mistral Large"},
]


# ─── Test Questions ───────────────────────────────────────────────────────────

TEST_QUESTIONS = [
    {
        "id": "q1",
        "query": "What is the definition of Beneficial Owner under these Master Directions?",
        "expected_type": "definitional",
        "complexity": "simple",
    },
    {
        "id": "q2",
        "query": "What are the CDD requirements for opening a savings account for an individual?",
        "expected_type": "single_hop",
        "complexity": "medium",
    },
    {
        "id": "q3",
        "query": "What are all the documents required for KYC verification of a company? Compare the requirements for different types of legal entities.",
        "expected_type": "multi_hop",
        "complexity": "complex",
    },
    {
        "id": "q4",
        "query": "Summarize all the record-keeping and retention requirements mentioned across the document.",
        "expected_type": "global",
        "complexity": "complex",
    },
    {
        "id": "q5",
        "query": "What penalties or enforcement actions can RBI take for non-compliance with KYC norms?",
        "expected_type": "single_hop",
        "complexity": "medium",
    },
]


# ─── Synthetic Stage Inputs ───────────────────────────────────────────────────
# Pre-built inputs for stages that depend on earlier pipeline output

_MOCK_TREE_INDEX = json.dumps({
    "doc_id": "test_doc",
    "doc_name": "Master Directions on KYC",
    "nodes": [
        {"id": "1", "title": "Chapter I – Preliminary", "level": 1, "children": ["1.1", "1.2"]},
        {"id": "1.1", "title": "Short Title and Commencement", "level": 2, "children": []},
        {"id": "1.2", "title": "Definitions", "level": 2, "children": ["1.2.1", "1.2.2"]},
        {"id": "1.2.1", "title": "Beneficial Owner", "level": 3, "children": []},
        {"id": "1.2.2", "title": "Officially Valid Documents", "level": 3, "children": []},
        {"id": "2", "title": "Chapter II – KYC Policy", "level": 1, "children": ["2.1", "2.2"]},
        {"id": "2.1", "title": "Customer Acceptance Policy", "level": 2, "children": []},
        {"id": "2.2", "title": "Customer Due Diligence", "level": 2, "children": ["2.2.1", "2.2.2"]},
        {"id": "2.2.1", "title": "CDD for Individual Customers", "level": 3, "children": []},
        {"id": "2.2.2", "title": "CDD for Legal Entities", "level": 3, "children": []},
        {"id": "3", "title": "Chapter III – Enhanced Due Diligence", "level": 1, "children": ["3.1"]},
        {"id": "3.1", "title": "PEPs and High-Risk Customers", "level": 2, "children": []},
        {"id": "4", "title": "Chapter IV – Record Keeping", "level": 1, "children": ["4.1"]},
        {"id": "4.1", "title": "Retention Requirements", "level": 2, "children": []},
        {"id": "5", "title": "Chapter V – Penalties", "level": 1, "children": []},
    ],
}, indent=2)

_MOCK_SECTIONS_TEXT = """=== Definitions (Pages 2-5) [id:1.2] ===
"Beneficial Owner" means the natural person who ultimately owns or controls a client or the person on whose behalf a transaction is being conducted. For a company, it is the natural person who, whether acting alone or together, or through one or more persons, exercises control through ownership or who ultimately has a controlling ownership interest. The controlling ownership interest means ownership of, or entitlement to, more than 25% of the shares or capital or profit of the company.

=== CDD for Individual Customers (Pages 8-12) [id:2.2.1] ===
Customer Due Diligence for individuals requires verification of identity using Officially Valid Documents (OVD). The following documents are accepted as OVD: Passport, Driving License, Voter's Identity Card, Aadhaar Card. Banks must verify the customer's current address. For low-risk customers, simplified measures may be applied.

=== CDD for Legal Entities (Pages 12-16) [id:2.2.2] ===
For legal entities, banks must obtain Certificate of Incorporation, Memorandum and Articles of Association, Board resolution for account opening, PAN of the entity, and proof of registered office address. The bank must identify the beneficial owners controlling 25% or more of the entity.

=== Record Keeping (Pages 20-22) [id:4.1] ===
Records of transactions must be maintained for a minimum period of five years from the date of the transaction. Records pertaining to the identity of customers must be preserved for at least five years after the business relationship has ended."""

_MOCK_ANSWER = """Under the RBI's Master Directions on KYC, a "Beneficial Owner" is defined as the natural person who ultimately owns or controls a client, or the person on whose behalf a transaction is being conducted.

For a company, the beneficial owner is the natural person who, whether acting alone or together, or through one or more persons, exercises control through ownership or who ultimately has a controlling ownership interest. The controlling ownership interest is defined as ownership of, or entitlement to, more than 25% of the shares or capital or profit of the company.

**Citations:**
- Section 1.2.1 "Beneficial Owner" (Pages 2-5)"""

_MOCK_INFERRED_POINTS = """1. [INFERRED, confidence=low] The 25% threshold applies uniformly across all types of legal entities, including trusts and partnerships.
   - Reasoning: While the Master Directions explicitly state the 25% threshold for companies, the same standard is generally applied across entity types for consistency.
   - Supporting definitions: "Beneficial Owner", "controlling ownership interest"
   - Source sections: 1.2.1, 2.2.2"""


# ─── Benchmark Runner ────────────────────────────────────────────────────────

class BenchmarkRunner:
    """Runs LLM benchmarks for specific pipeline stages with different models."""

    def __init__(self) -> None:
        self._llm = LLMClient()
        self._settings = get_settings()

    def _build_messages(
        self, stage: PipelineStage, question: dict[str, Any]
    ) -> list[dict[str, str]]:
        """Build the messages list for a given stage, simulating the real pipeline."""
        meta = STAGE_META[stage]
        prompt_data = load_prompt(meta["prompt_category"], meta["prompt_name"])
        system_prompt = prompt_data["system"]
        user_template = prompt_data.get("user_template", "")

        query_text = question["query"]
        query_type = question.get("expected_type", "single_hop")
        key_terms = "beneficial owner, KYC, CDD"

        if stage == PipelineStage.CLASSIFICATION:
            user_msg = format_prompt(user_template, query_text=query_text)

        elif stage == PipelineStage.EXPANSION:
            user_msg = format_prompt(
                user_template,
                query_text=query_text,
                query_type=query_type,
                key_terms=key_terms,
            )

        elif stage == PipelineStage.LOCATION:
            system_prompt = format_prompt(
                system_prompt,
                max_nodes=self._settings.retrieval.max_located_nodes,
            )
            user_msg = format_prompt(
                user_template,
                query_text=query_text,
                query_type=query_type,
                key_terms=key_terms,
                tree_index=_MOCK_TREE_INDEX,
            )

        elif stage == PipelineStage.REFLECTION:
            user_msg = format_prompt(
                user_template,
                query_text=query_text,
                query_type=query_type,
                key_terms=key_terms,
                section_count="4",
                total_tokens="2500",
                section_summaries=(
                    "1. Definitions (Pages 2-5) — 800 tokens [direct] — Preview: \"Beneficial Owner\" means the natural person...\n"
                    "2. CDD for Individual Customers (Pages 8-12) — 600 tokens [direct] — Preview: Customer Due Diligence for individuals...\n"
                    "3. CDD for Legal Entities (Pages 12-16) — 700 tokens [direct] — Preview: For legal entities, banks must obtain...\n"
                    "4. Record Keeping (Pages 20-22) — 400 tokens [direct] — Preview: Records of transactions must be maintained..."
                ),
            )

        elif stage == PipelineStage.SYNTHESIS:
            user_msg = format_prompt(
                user_template,
                query_text=query_text,
                query_type=query_type,
                retrieved_text=_MOCK_SECTIONS_TEXT,
            )

        elif stage == PipelineStage.VERIFICATION:
            user_msg = format_prompt(
                user_template,
                query_text=query_text,
                answer_text=_MOCK_ANSWER,
                inferred_text=_MOCK_INFERRED_POINTS,
                source_text=_MOCK_SECTIONS_TEXT,
            )

        else:
            user_msg = f"Query: {query_text}"

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ]

    def run_single(
        self,
        stage: PipelineStage,
        model_id: str,
        question: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Run a single benchmark: one stage × one model × one question.

        Returns a result dict with timing, token usage, output quality, etc.
        """
        meta = STAGE_META[stage]
        messages = self._build_messages(stage, question)

        result: dict[str, Any] = {
            "stage": stage.value,
            "stage_label": meta["label"],
            "model": model_id,
            "question_id": question["id"],
            "question_text": question["query"],
            "question_type": question.get("expected_type", "unknown"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "success": False,
            "error": None,
            "latency_seconds": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "output_text": "",
            "output_json": None,
            "quality_score": None,
            "expected_keys_present": [],
            "expected_keys_missing": [],
        }

        params: dict[str, Any] = {
            "messages": messages,
            "model": model_id,
            "max_tokens": meta["max_tokens"],
        }
        if meta["reasoning_effort"]:
            params["reasoning_effort"] = meta["reasoning_effort"]
        if meta["temperature"] is not None:
            params["temperature"] = meta["temperature"]

        start = time.time()
        try:
            raw_output = self._llm.chat_json(**params)
            elapsed = time.time() - start

            result["success"] = True
            result["latency_seconds"] = round(elapsed, 3)

            # Pull usage from client's tracker
            usage = self._llm.get_usage_summary()
            result["input_tokens"] = usage.get("total_input_tokens", 0)
            result["output_tokens"] = usage.get("total_output_tokens", 0)

            # Store the parsed JSON
            if isinstance(raw_output, (dict, list)):
                result["output_json"] = raw_output
                result["output_text"] = json.dumps(raw_output, indent=2)[:5000]
            else:
                result["output_text"] = str(raw_output)[:5000]

            # Check expected keys
            if isinstance(raw_output, dict):
                for key in meta["expected_keys"]:
                    if key in raw_output:
                        result["expected_keys_present"].append(key)
                    else:
                        result["expected_keys_missing"].append(key)

                # Quality heuristic
                quality = self._score_quality(stage, raw_output, question)
                result["quality_score"] = quality

        except Exception as e:
            elapsed = time.time() - start
            result["latency_seconds"] = round(elapsed, 3)
            result["error"] = f"{type(e).__name__}: {str(e)[:500]}"
            logger.warning(
                "Benchmark failed: stage=%s model=%s q=%s err=%s",
                stage.value, model_id, question["id"], str(e)[:200],
            )

        return result

    def _score_quality(
        self, stage: PipelineStage, output: dict, question: dict
    ) -> float:
        """
        Heuristic quality score (0–100) for a benchmark output.
        Tests structural correctness, key presence, and content relevance.
        """
        score = 0.0
        meta = STAGE_META[stage]

        # Key presence: 40 points
        expected = meta["expected_keys"]
        if expected:
            present = sum(1 for k in expected if k in output)
            score += (present / len(expected)) * 40

        if stage == PipelineStage.CLASSIFICATION:
            qtype = output.get("query_type", "")
            valid_types = {"single_hop", "multi_hop", "global", "definitional"}
            if qtype in valid_types:
                score += 30  # valid type
            if qtype == question.get("expected_type"):
                score += 30  # correct type
            terms = output.get("key_terms", [])
            if isinstance(terms, list) and len(terms) > 0:
                score += 10 if score < 100 else 0

        elif stage == PipelineStage.EXPANSION:
            queries = output.get("expanded_queries", [])
            if isinstance(queries, list) and len(queries) >= 2:
                score += 30
            elif isinstance(queries, list) and len(queries) >= 1:
                score += 15
            # Are they different from original?
            if isinstance(queries, list):
                orig = question["query"].lower()
                different = sum(1 for q in queries if q.lower().strip() != orig)
                score += min(different * 10, 30)

        elif stage == PipelineStage.LOCATION:
            nodes = output.get("located_nodes", [])
            if isinstance(nodes, list) and len(nodes) >= 1:
                score += 20
            if isinstance(nodes, list) and len(nodes) >= 3:
                score += 10
            # Each node has required fields?
            valid_nodes = sum(
                1 for n in (nodes if isinstance(nodes, list) else [])
                if isinstance(n, dict) and "node_id" in n
            )
            score += min(valid_nodes * 5, 30)

        elif stage == PipelineStage.REFLECTION:
            if "sufficient" in output and isinstance(output["sufficient"], bool):
                score += 30
            conf = output.get("confidence", -1)
            if isinstance(conf, (int, float)) and 0 <= conf <= 1:
                score += 30

        elif stage == PipelineStage.SYNTHESIS:
            text = output.get("answer_text", "")
            if isinstance(text, str) and len(text) > 100:
                score += 20
            if isinstance(text, str) and len(text) > 500:
                score += 10
            cites = output.get("citations", [])
            if isinstance(cites, list) and len(cites) >= 1:
                score += 15
            inferred = output.get("inferred_points", [])
            if isinstance(inferred, list):
                score += 15

        elif stage == PipelineStage.VERIFICATION:
            status = output.get("verification_status", "")
            valid_statuses = {"verified", "partially_verified", "failed", "insufficient_evidence"}
            if status in valid_statuses:
                score += 30
            for score_key in ["factual_accuracy_score", "completeness_score"]:
                val = output.get(score_key)
                if isinstance(val, (int, float)) and 0 <= val <= 1:
                    score += 15

        return min(round(score, 1), 100.0)

    def run_batch(
        self,
        stages: list[PipelineStage],
        models: list[str],
        questions: list[dict[str, Any]] | None = None,
        on_progress: Any = None,
    ) -> dict[str, Any]:
        """
        Run a full benchmark batch: multiple stages × models × questions.

        Args:
            stages: Pipeline stages to test.
            models: Model IDs to test.
            questions: Test questions (defaults to built-in TEST_QUESTIONS).
            on_progress: Optional callback(current, total, result).

        Returns:
            Summary with all individual results + aggregated comparisons.
        """
        if questions is None:
            questions = TEST_QUESTIONS

        total = len(stages) * len(models) * len(questions)
        results: list[dict[str, Any]] = []
        current = 0

        for stage in stages:
            for model in models:
                for question in questions:
                    current += 1
                    logger.info(
                        "Benchmark %d/%d: %s × %s × %s",
                        current, total, stage.value, model, question["id"],
                    )
                    r = self.run_single(stage, model, question)
                    results.append(r)
                    if on_progress:
                        try:
                            on_progress(current, total, r)
                        except Exception:
                            pass

        # Aggregate
        summary = self._aggregate(results)
        summary["total_runs"] = total
        summary["completed"] = len(results)
        summary["results"] = results

        return summary

    def _aggregate(self, results: list[dict[str, Any]]) -> dict[str, Any]:
        """Build per-stage, per-model aggregations from individual results."""
        # Group by (stage, model)
        groups: dict[tuple[str, str], list[dict]] = {}
        for r in results:
            key = (r["stage"], r["model"])
            groups.setdefault(key, []).append(r)

        aggregated: list[dict[str, Any]] = []
        for (stage, model), items in groups.items():
            success = [i for i in items if i["success"]]
            failed = [i for i in items if not i["success"]]
            agg: dict[str, Any] = {
                "stage": stage,
                "model": model,
                "runs": len(items),
                "success_count": len(success),
                "failure_count": len(failed),
                "success_rate": round(len(success) / len(items) * 100, 1) if items else 0,
            }
            if success:
                latencies = [s["latency_seconds"] for s in success]
                qualities = [s["quality_score"] for s in success if s["quality_score"] is not None]
                agg["avg_latency"] = round(sum(latencies) / len(latencies), 3)
                agg["min_latency"] = round(min(latencies), 3)
                agg["max_latency"] = round(max(latencies), 3)
                agg["avg_quality"] = round(sum(qualities) / len(qualities), 1) if qualities else None
                agg["avg_input_tokens"] = round(sum(s["input_tokens"] for s in success) / len(success))
                agg["avg_output_tokens"] = round(sum(s["output_tokens"] for s in success) / len(success))
            else:
                agg["avg_latency"] = None
                agg["min_latency"] = None
                agg["max_latency"] = None
                agg["avg_quality"] = None
                agg["avg_input_tokens"] = None
                agg["avg_output_tokens"] = None

            aggregated.append(agg)

        # Best model per stage
        best_per_stage: dict[str, dict[str, Any]] = {}
        stages_seen = {a["stage"] for a in aggregated}
        for stage in stages_seen:
            stage_aggs = [a for a in aggregated if a["stage"] == stage and a["avg_quality"] is not None]
            if stage_aggs:
                best = max(stage_aggs, key=lambda a: (a["avg_quality"], -a["avg_latency"]))
                best_per_stage[stage] = {
                    "model": best["model"],
                    "avg_quality": best["avg_quality"],
                    "avg_latency": best["avg_latency"],
                }

        return {
            "aggregated": aggregated,
            "best_per_stage": best_per_stage,
        }


# ─── MongoDB Storage ──────────────────────────────────────────────────────────

class BenchmarkResultStore:
    """Stores LLM benchmark results in MongoDB."""

    def __init__(self) -> None:
        from utils.mongo import get_db
        self._db = get_db()
        self._collection = self._db["llm_benchmarks"]

    def save_run(self, run_data: dict[str, Any]) -> str:
        """Save a complete benchmark run. Returns the run ID."""
        run_data["_created_at"] = datetime.now(timezone.utc).isoformat()
        result = self._collection.insert_one(run_data)
        return str(result.inserted_id)

    def list_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        """List recent benchmark runs (metadata only, no individual results)."""
        runs = []
        for doc in self._collection.find().sort("_created_at", -1).limit(limit):
            doc["_id"] = str(doc["_id"])
            # Don't send all individual results in the list view
            if "results" in doc:
                doc["result_count"] = len(doc["results"])
                del doc["results"]
            runs.append(doc)
        return runs

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        """Load a full benchmark run including all results."""
        from bson import ObjectId
        doc = self._collection.find_one({"_id": ObjectId(run_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def get_latest(self) -> dict[str, Any] | None:
        """Get the most recent benchmark run."""
        doc = self._collection.find_one(sort=[("_created_at", -1)])
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def delete_run(self, run_id: str) -> bool:
        """Delete a benchmark run."""
        from bson import ObjectId
        result = self._collection.delete_one({"_id": ObjectId(run_id)})
        return result.deleted_count > 0


# ─── Memory Health Checker ────────────────────────────────────────────────────

class MemoryHealthChecker:
    """Tests each memory subsystem to verify it's actually working."""

    def check_all(self) -> dict[str, Any]:
        """
        Run health checks on all memory subsystems.
        
        Returns a dict with overall status and per-subsystem results.
        """
        results: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "overall_status": "unknown",
            "subsystems": {},
        }

        checks = [
            ("memory_manager", self._check_memory_manager),
            ("raptor_index", self._check_raptor),
            ("user_memory", self._check_user_memory),
            ("query_intelligence", self._check_query_intelligence),
            ("retrieval_feedback", self._check_retrieval_feedback),
            ("r2r_fallback", self._check_r2r),
            ("mongodb", self._check_mongodb),
            ("llm_client", self._check_llm),
            ("embedding_model", self._check_embeddings),
        ]

        healthy_count = 0
        total = len(checks)

        for name, check_fn in checks:
            try:
                start = time.time()
                status = check_fn()
                elapsed = round(time.time() - start, 3)
                status["latency_seconds"] = elapsed
                results["subsystems"][name] = status
                if status.get("healthy"):
                    healthy_count += 1
            except Exception as e:
                results["subsystems"][name] = {
                    "healthy": False,
                    "status": "error",
                    "error": f"{type(e).__name__}: {str(e)[:300]}",
                    "latency_seconds": round(time.time() - start, 3),
                }

        # Overall
        if healthy_count == total:
            results["overall_status"] = "healthy"
        elif healthy_count > total // 2:
            results["overall_status"] = "degraded"
        elif healthy_count > 0:
            results["overall_status"] = "unhealthy"
        else:
            results["overall_status"] = "down"

        results["healthy_count"] = healthy_count
        results["total_checks"] = total

        return results

    def _check_memory_manager(self) -> dict[str, Any]:
        """Check if MemoryManager is initialized and responsive."""
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            initialized = mm._initialized
            stats = mm.get_stats() if initialized else {}
            return {
                "healthy": initialized,
                "status": "initialized" if initialized else "not_initialized",
                "details": {
                    "subsystem_count": len(stats.get("subsystems", {})),
                },
            }
        except ImportError:
            return {"healthy": False, "status": "not_available", "error": "Module not found"}
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_raptor(self) -> dict[str, Any]:
        """Check RAPTOR index subsystem."""
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not mm._initialized or not mm._raptor:
                return {"healthy": False, "status": "disabled"}
            stats = mm._raptor.get_stats() if hasattr(mm._raptor, "get_stats") else {}
            return {
                "healthy": True,
                "status": "active",
                "details": stats,
            }
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_user_memory(self) -> dict[str, Any]:
        """Check user memory subsystem."""
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not mm._initialized or not mm._user_memory:
                return {"healthy": False, "status": "disabled"}
            stats = mm._user_memory.get_stats() if hasattr(mm._user_memory, "get_stats") else {}
            return {
                "healthy": True,
                "status": "active",
                "details": stats,
            }
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_query_intelligence(self) -> dict[str, Any]:
        """Check query intelligence subsystem."""
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not mm._initialized or not mm._query_intel:
                return {"healthy": False, "status": "disabled"}
            stats = mm._query_intel.get_stats() if hasattr(mm._query_intel, "get_stats") else {}
            return {
                "healthy": True,
                "status": "active",
                "details": stats,
            }
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_retrieval_feedback(self) -> dict[str, Any]:
        """Check retrieval feedback subsystem."""
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not mm._initialized or not mm._retrieval_fb:
                return {"healthy": False, "status": "disabled"}
            stats = mm._retrieval_fb.get_stats() if hasattr(mm._retrieval_fb, "get_stats") else {}
            return {
                "healthy": True,
                "status": "active",
                "details": stats,
            }
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_r2r(self) -> dict[str, Any]:
        """Check R2R fallback subsystem."""
        try:
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not mm._initialized or not mm._r2r:
                return {"healthy": False, "status": "disabled"}
            stats = mm._r2r.get_stats() if hasattr(mm._r2r, "get_stats") else {}
            return {
                "healthy": True,
                "status": "active",
                "details": stats,
            }
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_mongodb(self) -> dict[str, Any]:
        """Verify MongoDB connectivity."""
        try:
            from utils.mongo import get_db
            db = get_db()
            # Ping
            db.command("ping")
            colls = db.list_collection_names()
            return {
                "healthy": True,
                "status": "connected",
                "details": {"collection_count": len(colls)},
            }
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_llm(self) -> dict[str, Any]:
        """Quick LLM connectivity test (tiny request)."""
        try:
            llm = LLMClient()
            response = llm.chat(
                messages=[{"role": "user", "content": "Reply with exactly: OK"}],
                max_tokens=10,
                reasoning_effort="none",
            )
            ok = "ok" in response.lower()
            return {
                "healthy": ok,
                "status": "responsive" if ok else "unexpected_response",
                "details": {"response": response[:100]},
            }
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_embeddings(self) -> dict[str, Any]:
        """Quick embedding model test."""
        try:
            from openai import OpenAI
            import os
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            resp = client.embeddings.create(
                model="text-embedding-3-small",
                input="health check",
            )
            dim = len(resp.data[0].embedding)
            return {
                "healthy": dim > 0,
                "status": "responsive",
                "details": {"dimensions": dim},
            }
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}
