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
        "max_tokens": 4096,           # capped from 16384 for benchmark (avoids ngrok timeout)
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

# Pricing: USD per 1M tokens  (source: OpenAI model page + DeepInfra pricing, Mar 2026)
MODEL_PRICING: dict[str, dict[str, float]] = {
    # ── OpenAI (Responses API) ───────────────────────────────────────
    "gpt-5.2":     {"input": 1.75,  "output": 14.00},
    "gpt-5.2-pro": {"input": 1.75,  "output": 14.00},   # same pricing tier
    "gpt-5-mini":  {"input": 0.25,  "output":  2.00},
    "gpt-5-nano":  {"input": 0.05,  "output":  0.40},
    # ── DeepInfra (Chat Completions API) ─────────────────────────────
    "zai-org/GLM-5":                {"input": 0.80, "output": 2.56,  "cached": 0.16},
    "zai-org/GLM-4.7-Flash":         {"input": 0.06, "output": 0.40,  "cached": 0.01},
    "deepseek-ai/DeepSeek-V3":      {"input": 0.28, "output": 0.42,  "cached": 0.028},
    "deepseek-ai/DeepSeek-R1":      {"input": 0.55, "output": 2.19,  "cached": 0.14},
    "Qwen/Qwen3-235B-A22B":         {"input": 0.022, "output": 0.216, "cached": 0.0},
    "Qwen/QwQ-32B":                 {"input": 0.05, "output": 0.50,  "cached": 0.0},
    "moonshotai/Kimi-K2":            {"input": 0.60, "output": 3.00,  "cached": 0.0},
    "mistralai/Mistral-Medium-3":   {"input": 0.40, "output": 2.00,  "cached": 0.0},
}

# Models to benchmark — focused set the user wants to compare
BENCHMARK_MODELS = [
    # ── OpenAI ────────────────────────────────────────────────────────
    {"id": "gpt-5.2",     "label": "GPT-5.2",     "tier": "flagship",  "speed": "medium",    "reasoning": "highest", "provider": "openai",    "context": 128000},
    {"id": "gpt-5.2-pro", "label": "GPT-5.2 Pro", "tier": "flagship",  "speed": "slow",      "reasoning": "highest", "provider": "openai",    "context": 128000},
    {"id": "gpt-5-mini",  "label": "GPT-5 Mini",  "tier": "mid",       "speed": "fast",      "reasoning": "high",    "provider": "openai",    "context": 128000},
    {"id": "gpt-5-nano",  "label": "GPT-5 Nano",  "tier": "budget",    "speed": "very_fast", "reasoning": "average", "provider": "openai",    "context": 128000},
    # ── DeepInfra ─────────────────────────────────────────────────────
    {"id": "zai-org/GLM-5",                "label": "GLM-5",              "tier": "flagship",  "speed": "medium",    "reasoning": "highest", "provider": "deepinfra", "context": 202752},
    {"id": "zai-org/GLM-4.7-Flash",         "label": "GLM-4.7 Flash",     "tier": "budget",    "speed": "very_fast", "reasoning": "high",    "provider": "deepinfra", "context": 202752},
    {"id": "deepseek-ai/DeepSeek-V3",      "label": "DeepSeek V3.2",      "tier": "budget",    "speed": "fast",      "reasoning": "high",    "provider": "deepinfra", "context": 128000},
    {"id": "deepseek-ai/DeepSeek-R1",      "label": "DeepSeek R1",        "tier": "mid",       "speed": "medium",    "reasoning": "highest", "provider": "deepinfra", "context": 128000},
    {"id": "Qwen/Qwen3-235B-A22B",         "label": "Qwen3 235B (Flash)", "tier": "budget",    "speed": "very_fast", "reasoning": "high",    "provider": "deepinfra", "context": 131072},
    {"id": "Qwen/QwQ-32B",                 "label": "QwQ 32B (Turbo)",    "tier": "budget",    "speed": "fast",      "reasoning": "high",    "provider": "deepinfra", "context": 131072},
    {"id": "moonshotai/Kimi-K2",            "label": "Kimi K2.5",          "tier": "mid",       "speed": "medium",    "reasoning": "high",    "provider": "deepinfra", "context": 131072},
    {"id": "mistralai/Mistral-Medium-3",   "label": "Mistral Medium 3",   "tier": "mid",       "speed": "fast",      "reasoning": "high",    "provider": "deepinfra", "context": 131072},
]

# Full list for the dropdown (kept for admin UI)
AVAILABLE_MODELS = [
    # ── OpenAI ────────────────────────────────────────────────────────
    {"id": "gpt-5.2",     "provider": "openai", "label": "GPT-5.2"},
    {"id": "gpt-5.2-pro", "provider": "openai", "label": "GPT-5.2 Pro"},
    {"id": "gpt-5-mini",  "provider": "openai", "label": "GPT-5 Mini"},
    {"id": "gpt-5-nano",  "provider": "openai", "label": "GPT-5 Nano"},
    # ── DeepInfra ─────────────────────────────────────────────────────
    {"id": "zai-org/GLM-5",                "provider": "deepinfra", "label": "GLM-5"},
    {"id": "zai-org/GLM-4.7-Flash",         "provider": "deepinfra", "label": "GLM-4.7 Flash"},
    {"id": "deepseek-ai/DeepSeek-V3",      "provider": "deepinfra", "label": "DeepSeek V3.2"},
    {"id": "deepseek-ai/DeepSeek-R1",      "provider": "deepinfra", "label": "DeepSeek R1"},
    {"id": "Qwen/Qwen3-235B-A22B",         "provider": "deepinfra", "label": "Qwen3 235B (Flash)"},
    {"id": "Qwen/QwQ-32B",                 "provider": "deepinfra", "label": "QwQ 32B (Turbo)"},
    {"id": "moonshotai/Kimi-K2",            "provider": "deepinfra", "label": "Kimi K2.5"},
    {"id": "mistralai/Mistral-Medium-3",   "provider": "deepinfra", "label": "Mistral Medium 3"},
]


def compute_cost(model_id: str, input_tokens: int, output_tokens: int) -> float:
    """Compute USD cost for a single LLM call."""
    pricing = MODEL_PRICING.get(model_id)
    if not pricing:
        return 0.0
    return (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000


# ─── Test Questions ───────────────────────────────────────────────────────────

TEST_QUESTIONS = [
    # ── KYC Directions, 2025 ─────────────────────────────────────────────────
    {
        "id": "kyc1_layered_bo",
        "query": (
            "A customer is Company X. Ownership is: Company A holds 9% of X; "
            "Company B holds 9% of X; Trust T holds 12% of X; remaining is widely held. "
            "In the Shareholders' Agreement, Company A has the right to appoint 3/5 directors "
            "and veto key policy decisions. Trust T has 4 beneficiaries; one beneficiary has "
            "8% interest in the trust; trustee is a corporate trustee.\n\n"
            "Identify all Beneficial Owners you must determine for X, and explain why each "
            "qualifies (ownership vs control vs 'senior managing official' fallback). Also list "
            "whose CDD you must perform (customer, BOs, authorised signatories, POA holders, etc.) "
            "and what evidence you'd rely on."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "kyc",
    },
    {
        "id": "kyc2_vcip_design",
        "query": (
            "Your bank proposes V-CIP where: video files are stored on a cloud vendor for "
            "7 days 'for processing,' the app allows logins from any IP, the liveness model "
            "is not periodically re-trained, and a call drop creates a second video file that "
            "is stitched later.\n\n"
            "Identify the specific non-compliances and the minimum fixes needed to make this "
            "V-CIP setup acceptable — cover data ownership/retention, geo/IP controls, "
            "encryption/audit trail, handling disruptions, and audit before activation."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "kyc",
    },
    {
        "id": "kyc3_aadhaar_limits",
        "query": (
            "A customer opened 2 deposit accounts using Aadhaar OTP e-KYC (non-face-to-face). "
            "Over 9 months, combined balances reach INR 1.12 lakh, annual credits reach "
            "INR 1.95 lakh, and the bank has also sanctioned two term loans of INR 40,000 and "
            "INR 30,000 in the same year.\n\n"
            "Which limits are breached (if any), what immediate operational restrictions must "
            "be applied, and by what deadline must the bank complete full identification (and "
            "what happens if it doesn't)? Include how you'd handle the required customer "
            "declaration about not having OTP-based accounts elsewhere."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "kyc",
    },
    # ── ALM Directions, 2025 ─────────────────────────────────────────────────
    {
        "id": "alm1_sls_mismatch",
        "query": (
            "Given the bank's domestic SLS shows cumulative cash outflows of: "
            "Next day: INR 10,000 cr; 2-7 days: INR 22,000 cr; 8-14 days: INR 15,000 cr; "
            "15-30 days: INR 18,000 cr. "
            "And cumulative net gaps (inflows minus outflows) are: "
            "Next day: -INR 650 cr; 2-7 days: -INR 2,050 cr; 8-14 days: -INR 2,100 cr; "
            "15-30 days: -INR 3,900 cr.\n\n"
            "For each bucket, determine whether the bank breaches the regulatory net "
            "cumulative negative mismatch limits and explain what 'cumulative' means "
            "operationally for monitoring and escalation."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "alm",
    },
    {
        "id": "alm2_ibl_limits",
        "query": (
            "A bank's Net Worth as of prior March 31 is INR 8,000 cr; CRAR is 11.5%. "
            "Its India fund-based interbank liabilities are: "
            "Call/notice/term borrowings: INR 7,500 cr; Interbank CDs: INR 6,000 cr; "
            "Interbank FCY liabilities within India: INR 2,500 cr; "
            "TREPS collateralised borrowing: INR 4,000 cr; NABARD refinance: INR 1,500 cr; "
            "Interbank liabilities outside India: INR 3,000 cr.\n\n"
            "Compute IBL for limit purposes, decide the maximum permitted IBL % applicable, "
            "and conclude whether it is compliant. Clearly justify inclusions/exclusions."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "alm",
    },
    {
        "id": "alm3_intraday_liquidity",
        "query": (
            "You have settlement-account transaction stamps for a day and must compute the "
            "bank's maximum intraday liquidity usage (largest net cumulative negative position), "
            "and then decide what should be reported as the three largest negative/positive net "
            "cumulative positions for the month.\n\n"
            "Explain the exact step-by-step method to compute 'largest net negative position "
            "during the business day' from transaction-by-transaction data, and what it implies "
            "about minimum intraday liquidity access."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "alm",
    },
    # ── Combined KYC + ALM ───────────────────────────────────────────────────
    {
        "id": "combined1_board_governance",
        "query": (
            "During a market-wide stress event, Treasury proposes aggressive short-term "
            "wholesale funding and rapid onboarding of new counterparties. Simultaneously, "
            "AML flags unusual flows that may be linked to TF risk, but compliance worries "
            "that deeper questioning could 'tip off.'\n\n"
            "Design a Board-level governance response that satisfies both directions: who "
            "approves/oversees what, what must be escalated, how risk tolerance/limits and "
            "KYC controls interact, and how you proceed when suspicion + tip-off risk exists."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "combined",
    },
    {
        "id": "combined2_correspondent_banking",
        "query": (
            "Your bank wants a new cross-border correspondent banking relationship that "
            "will also be a major source of intraday liquidity and settlement flows in a "
            "significant foreign currency.\n\n"
            "Specify the combined due diligence and monitoring you would mandate, covering: "
            "(i) approval/oversight requirements for correspondent banking, "
            "(ii) how you ensure AML/CTF controls on payable-through/third-party usage risks, "
            "and (iii) how you monitor/limit intraday liquidity reliance and stress scenarios "
            "when that correspondent is disrupted."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "combined",
    },
    {
        "id": "combined3_overseas_branch",
        "query": (
            "An overseas branch operates in a host country with (a) weaker KYC rules than "
            "RBI, and (b) ring-fencing/FX controls that may prevent liquidity transfers to "
            "the parent during stress.\n\n"
            "What standards must the branch follow for KYC, and how should the group reflect "
            "liquidity transfer restrictions in its liquidity risk management, stress testing, "
            "and contingency planning? Include the operational implications for both compliance "
            "and ALCO decisions."
        ),
        "expected_type": "multi_hop",
        "complexity": "complex",
        "document": "combined",
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
            "cost_usd": 0.0,
            "output_text": "",
            "output_json": None,
            "quality_score": None,
            "expected_keys_present": [],
            "expected_keys_missing": [],
        }

        max_tokens = meta["max_tokens"]
        # For synthesis, cap mini/nano to 2048 tokens (they can't produce
        # quality 4096-token synthesis and it wastes time/money)
        if stage == PipelineStage.SYNTHESIS and ("mini" in model_id or "nano" in model_id):
            max_tokens = min(max_tokens, 2048)

        params: dict[str, Any] = {
            "messages": messages,
            "model": model_id,
            "max_tokens": max_tokens,
        }
        if meta["reasoning_effort"]:
            effort = meta["reasoning_effort"]
            # Model-specific reasoning_effort compatibility:
            #   gpt-5.2:         none, low, medium, high
            #   gpt-5.2-pro:     medium, high, xhigh
            #   gpt-5-mini:      minimal, low, medium, high
            #   gpt-5-nano:      minimal, low, medium, high
            #   DeepInfra models: none, low, medium, high
            from utils.llm_client import is_deepinfra_model
            if is_deepinfra_model(model_id):
                # DeepInfra supports none/low/medium/high — clamp unsupported values
                if effort == "xhigh":
                    effort = "high"
                if effort == "minimal":
                    effort = "low"
            elif "pro" in model_id:
                if effort in ("none", "low", "minimal"):
                    effort = "medium"
            elif "mini" in model_id or "nano" in model_id:
                if effort == "none":
                    effort = "minimal"
                # For synthesis, drop mini/nano to low (medium + huge prompt
                # causes them to fail JSON generation and burn retries)
                if stage == PipelineStage.SYNTHESIS and effort == "medium":
                    effort = "low"
            params["reasoning_effort"] = effort
        if meta["temperature"] is not None:
            # temperature only effective when reasoning_effort is "none"
            if params.get("reasoning_effort") == "none":
                params["temperature"] = meta["temperature"]

        self._llm.reset_usage()
        start = time.time()
        try:
            # For synthesis/verification, use chat_json_with_status which has
            # truncation repair logic (salvages broken JSON from long outputs).
            # For other stages, use chat_json with retries=1 for speed.
            if stage in (PipelineStage.SYNTHESIS, PipelineStage.VERIFICATION):
                # Remove retries param — chat_json_with_status doesn't take it
                status_params = {k: v for k, v in params.items()}
                raw_output, was_truncated = self._llm.chat_json_with_status(
                    **status_params
                )
                if was_truncated:
                    result["was_truncated"] = True
                    logger.info(
                        "Benchmark truncated: stage=%s model=%s q=%s (salvaged)",
                        stage.value, model_id, question["id"],
                    )
            else:
                raw_output = self._llm.chat_json(**params, retries=1)

            elapsed = time.time() - start

            result["success"] = True
            result["latency_seconds"] = round(elapsed, 3)

            # Pull usage from client's tracker
            usage = self._llm.get_usage_summary()
            result["input_tokens"] = usage.get("total_input_tokens", 0)
            result["output_tokens"] = usage.get("total_output_tokens", 0)
            result["cost_usd"] = round(compute_cost(
                model_id, result["input_tokens"], result["output_tokens"]
            ), 6)

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

    # ------------------------------------------------------------------
    # Tournament: run all models on one stage×question, then judge
    # ------------------------------------------------------------------

    def tournament_battle(
        self,
        stage: PipelineStage,
        models: list[str],
        question: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Run a tournament battle: all models compete on one stage × one question.

        1. Run each model on the stage×question to get their outputs.
        2. Send all outputs to GPT-5.2-pro (high reasoning) for comparative judging.
        3. Return individual results + judge rankings.
        """
        meta = STAGE_META[stage]
        battle: dict[str, Any] = {
            "stage": stage.value,
            "stage_label": meta["label"],
            "question_id": question["id"],
            "question_text": question["query"],
            "question_type": question.get("expected_type", "unknown"),
            "models": models,
            "results": {},
            "judge": None,
            "error": None,
        }

        # Phase 1: Run all models
        for model_id in models:
            logger.info(
                "Tournament: %s × %s × %s",
                stage.value, model_id, question["id"],
            )
            result = self.run_single(stage, model_id, question)
            battle["results"][model_id] = result

        # Phase 2: Judge with GPT-5.2-pro (high reasoning)
        successful = {
            m: r for m, r in battle["results"].items()
            if r["success"] and r.get("output_text")
        }

        if len(successful) < 2:
            battle["error"] = f"Only {len(successful)} model(s) succeeded — need at least 2 for judging"
            # Still rank what we have
            if successful:
                sole_model = list(successful.keys())[0]
                battle["judge"] = {
                    "rankings": [{"model": sole_model, "rank": 1, "score": 100, "reasoning": "Only model that succeeded"}],
                    "winner": sole_model,
                    "judge_model": "n/a",
                    "judge_latency": 0,
                    "judge_cost": 0,
                }
            return battle

        try:
            judge_result = self._judge_outputs(stage, question, successful)
            battle["judge"] = judge_result
        except Exception as e:
            logger.error("Tournament judge failed: %s", str(e)[:300])
            battle["error"] = f"Judge failed: {type(e).__name__}: {str(e)[:300]}"

        return battle

    def _judge_outputs(
        self,
        stage: PipelineStage,
        question: dict[str, Any],
        model_outputs: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Use GPT-5.2-pro with high reasoning to comparatively judge model outputs.

        Returns rankings with scores and detailed reasoning.
        """
        meta = STAGE_META[stage]

        # Build the judge prompt with all outputs anonymised then revealed
        outputs_text = ""
        model_list = list(model_outputs.keys())
        for i, model_id in enumerate(model_list):
            label = chr(65 + i)  # A, B, C, D
            output = model_outputs[model_id]
            output_preview = output.get("output_text", "")[:3000]
            latency = output.get("latency_seconds", 0)
            cost = output.get("cost_usd", 0)
            outputs_text += (
                f"\n--- Model {label} ({model_id}) ---\n"
                f"Latency: {latency:.1f}s | Cost: ${cost:.6f}\n"
                f"Output:\n{output_preview}\n"
            )

        judge_system = (
            "You are an expert evaluator for a regulatory compliance QA pipeline. "
            "You are judging the quality of LLM outputs for a specific pipeline stage.\n\n"
            "Evaluate ONLY the quality and correctness of each output for the given task. "
            "Consider: structural correctness, completeness, accuracy, specificity, and "
            "how well it would serve the downstream pipeline.\n\n"
            "You MUST return valid JSON with this exact structure:\n"
            "{\n"
            '  "rankings": [\n'
            '    {"model": "<model_id>", "rank": 1, "score": <0-100>, "reasoning": "<why>"},\n'
            '    {"model": "<model_id>", "rank": 2, "score": <0-100>, "reasoning": "<why>"},\n'
            "    ...\n"
            "  ],\n"
            '  "winner": "<model_id of rank 1>",\n'
            '  "analysis": "<overall comparison summary>"\n'
            "}\n\n"
            "Score guidelines:\n"
            "- 90-100: Excellent — correct, complete, well-structured\n"
            "- 70-89: Good — mostly correct with minor issues\n"
            "- 50-69: Acceptable — usable but with notable gaps\n"
            "- 30-49: Poor — significant issues that affect downstream use\n"
            "- 0-29: Failed — wrong, empty, or unusable output"
        )

        judge_user = (
            f"## Task\n"
            f"Pipeline Stage: **{meta['label']}** ({stage.value})\n"
            f"Expected output keys: {meta['expected_keys']}\n\n"
            f"## Question\n{question['query']}\n\n"
            f"## Model Outputs to Judge\n{outputs_text}\n\n"
            f"Rank all models from best to worst. Use the model IDs (e.g. gpt-5.2) in your response, not the letter labels."
        )

        self._llm.reset_usage()
        start = time.time()
        judge_output = self._llm.chat_json(
            messages=[
                {"role": "system", "content": judge_system},
                {"role": "user", "content": judge_user},
            ],
            model="gpt-5.2-pro",
            reasoning_effort="high",
            max_tokens=4096,
            retries=1,
        )
        judge_latency = time.time() - start
        judge_usage = self._llm.get_usage_summary()
        judge_cost = compute_cost(
            "gpt-5.2-pro",
            judge_usage.get("total_input_tokens", 0),
            judge_usage.get("total_output_tokens", 0),
        )

        if isinstance(judge_output, dict):
            judge_output["judge_model"] = "gpt-5.2-pro"
            judge_output["judge_reasoning_effort"] = "high"
            judge_output["judge_latency"] = round(judge_latency, 2)
            judge_output["judge_cost"] = round(judge_cost, 6)
            judge_output["judge_input_tokens"] = judge_usage.get("total_input_tokens", 0)
            judge_output["judge_output_tokens"] = judge_usage.get("total_output_tokens", 0)
            return judge_output
        else:
            return {
                "rankings": [],
                "winner": None,
                "analysis": str(judge_output)[:1000],
                "judge_model": "gpt-5.2-pro",
                "judge_latency": round(judge_latency, 2),
                "judge_cost": round(judge_cost, 6),
            }

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
                costs = [s.get("cost_usd", 0) for s in success]
                agg["avg_latency"] = round(sum(latencies) / len(latencies), 3)
                agg["min_latency"] = round(min(latencies), 3)
                agg["max_latency"] = round(max(latencies), 3)
                agg["avg_quality"] = round(sum(qualities) / len(qualities), 1) if qualities else None
                agg["avg_input_tokens"] = round(sum(s["input_tokens"] for s in success) / len(success))
                agg["avg_output_tokens"] = round(sum(s["output_tokens"] for s in success) / len(success))
                agg["avg_cost_usd"] = round(sum(costs) / len(costs), 6) if costs else 0
                agg["total_cost_usd"] = round(sum(costs), 6)
            else:
                agg["avg_latency"] = None
                agg["min_latency"] = None
                agg["max_latency"] = None
                agg["avg_quality"] = None
                agg["avg_input_tokens"] = None
                agg["avg_output_tokens"] = None
                agg["avg_cost_usd"] = None
                agg["total_cost_usd"] = None

            aggregated.append(agg)

        # Best model per stage (three picks: best quality, cheapest viable, fastest viable)
        best_per_stage: dict[str, dict[str, Any]] = {}
        stages_seen = {a["stage"] for a in aggregated}
        for stage in stages_seen:
            stage_aggs = [a for a in aggregated if a["stage"] == stage and a["avg_quality"] is not None]
            if not stage_aggs:
                continue

            by_quality = max(stage_aggs, key=lambda a: (a["avg_quality"], -a["avg_latency"]))
            viable = [a for a in stage_aggs if a["avg_quality"] >= by_quality["avg_quality"] * 0.85]
            if not viable:
                viable = stage_aggs
            by_cost = min(viable, key=lambda a: a.get("avg_cost_usd") or 999)
            by_speed = min(viable, key=lambda a: a.get("avg_latency") or 999)

            best_per_stage[stage] = {
                "best_quality": {"model": by_quality["model"], "avg_quality": by_quality["avg_quality"], "avg_latency": by_quality["avg_latency"], "avg_cost_usd": by_quality.get("avg_cost_usd")},
                "cheapest_viable": {"model": by_cost["model"], "avg_quality": by_cost["avg_quality"], "avg_latency": by_cost["avg_latency"], "avg_cost_usd": by_cost.get("avg_cost_usd")},
                "fastest_viable": {"model": by_speed["model"], "avg_quality": by_speed["avg_quality"], "avg_latency": by_speed["avg_latency"], "avg_cost_usd": by_speed.get("avg_cost_usd")},
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


# ─── Model Optimization Experiment ────────────────────────────────────────────

# The 6 core QA stages that run for every single-doc question
CORE_QA_STAGES = [
    PipelineStage.CLASSIFICATION,
    PipelineStage.EXPANSION,
    PipelineStage.LOCATION,
    PipelineStage.REFLECTION,
    PipelineStage.SYNTHESIS,
    PipelineStage.VERIFICATION,
]

# Current baseline assignment: what model each stage uses today
CURRENT_BASELINE: dict[str, str] = {
    PipelineStage.CLASSIFICATION: "gpt-5.2",
    PipelineStage.EXPANSION:      "gpt-5.2",
    PipelineStage.LOCATION:        "gpt-5.2",
    PipelineStage.REFLECTION:      "gpt-5.2",
    PipelineStage.SYNTHESIS:       "gpt-5.2-pro",
    PipelineStage.VERIFICATION:    "gpt-5.2-pro",
}


class ModelExperiment:
    """
    Full model optimization experiment.

    Phase 1: Per-stage isolation — test each of the 3 candidate models on
             each pipeline stage independently (3 models × 6 stages × N questions).
    Phase 2: Combo optimization — from Phase 1 data, compute the Pareto-optimal
             model assignments and compare against the current baseline.

    The result is a ranked list of model combos sorted by a weighted score
    that balances quality, cost, and latency.
    """

    def __init__(self) -> None:
        self._runner = BenchmarkRunner()

    def run_experiment(
        self,
        questions: list[dict[str, Any]] | None = None,
        models: list[str] | None = None,
        quality_weight: float = 0.5,
        cost_weight: float = 0.3,
        latency_weight: float = 0.2,
        on_progress: Any = None,
    ) -> dict[str, Any]:
        """
        Run the full experiment.

        Args:
            questions: Questions to test (defaults to TEST_QUESTIONS).
            models: Model IDs to test (defaults to BENCHMARK_MODELS).
            quality_weight: Weight for quality in combo scoring (0-1).
            cost_weight: Weight for cost in combo scoring (0-1).
            latency_weight: Weight for latency in combo scoring (0-1).
            on_progress: Optional callback(phase, current, total, detail_msg).

        Returns:
            Complete experiment results with per-stage data, combos, and recommendations.
        """
        if questions is None:
            questions = TEST_QUESTIONS
        if models is None:
            models = [m["id"] for m in BENCHMARK_MODELS]

        experiment_start = time.time()
        experiment: dict[str, Any] = {
            "experiment_type": "model_optimization",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "config": {
                "models_tested": models,
                "questions": [q["id"] for q in questions],
                "question_count": len(questions),
                "stages": [s.value for s in CORE_QA_STAGES],
                "weights": {"quality": quality_weight, "cost": cost_weight, "latency": latency_weight},
                "baseline": {s.value: m for s, m in CURRENT_BASELINE.items()},
            },
        }

        # ── Phase 1: Per-stage isolation ──────────────────────────────────
        logger.info("═══ Phase 1: Per-stage model testing ═══")
        phase1_results: list[dict[str, Any]] = []
        total_phase1 = len(CORE_QA_STAGES) * len(models) * len(questions)
        current = 0

        for stage in CORE_QA_STAGES:
            for model in models:
                for question in questions:
                    current += 1
                    if on_progress:
                        try:
                            on_progress(1, current, total_phase1, f"{stage.value} × {model} × {question['id']}")
                        except Exception:
                            pass
                    logger.info(
                        "Phase1 [%d/%d] %s × %s × %s",
                        current, total_phase1, stage.value, model, question["id"],
                    )
                    r = self._runner.run_single(stage, model, question)
                    phase1_results.append(r)

        # ── Aggregate Phase 1 ─────────────────────────────────────────────
        phase1_summary = self._runner._aggregate(phase1_results)
        experiment["phase1"] = {
            "total_runs": total_phase1,
            "completed": len(phase1_results),
            "results": phase1_results,
            **phase1_summary,
        }

        # ── Phase 2: Combo optimization ───────────────────────────────────
        logger.info("═══ Phase 2: Computing optimal combos ═══")
        combos = self._compute_combos(
            phase1_summary["aggregated"],
            models,
            quality_weight,
            cost_weight,
            latency_weight,
        )
        experiment["phase2"] = {
            "combos": combos,
            "total_combos_evaluated": len(combos),
        }

        # ── Baseline comparison ───────────────────────────────────────────
        baseline_combo = self._extract_baseline_stats(phase1_summary["aggregated"])
        experiment["baseline"] = baseline_combo

        # ── Recommendations ───────────────────────────────────────────────
        experiment["recommendations"] = self._build_recommendations(
            combos, baseline_combo
        )

        experiment["total_time_seconds"] = round(time.time() - experiment_start, 2)
        logger.info("Experiment complete in %.1fs", experiment["total_time_seconds"])
        return experiment

    def _compute_combos(
        self,
        aggregated: list[dict[str, Any]],
        models: list[str],
        w_quality: float,
        w_cost: float,
        w_latency: float,
    ) -> list[dict[str, Any]]:
        """
        Enumerate all possible model assignments (one model per stage)
        and score each combo.  3 models × 6 stages = 729 combos.
        """
        import itertools

        # Build lookup: (stage, model) -> {avg_quality, avg_cost_usd, avg_latency}
        lookup: dict[tuple[str, str], dict] = {}
        for agg in aggregated:
            key = (agg["stage"], agg["model"])
            lookup[key] = agg

        stages = [s.value for s in CORE_QA_STAGES]

        # Find global max/min for normalization
        all_qualities = [a["avg_quality"] for a in aggregated if a["avg_quality"] is not None]
        all_costs = [a.get("avg_cost_usd", 0) for a in aggregated if a.get("avg_cost_usd") is not None]
        all_latencies = [a["avg_latency"] for a in aggregated if a["avg_latency"] is not None]

        q_max = max(all_qualities) if all_qualities else 1
        q_min = min(all_qualities) if all_qualities else 0
        c_max = max(all_costs) if all_costs else 1
        c_min = min(all_costs) if all_costs else 0
        l_max = max(all_latencies) if all_latencies else 1
        l_min = min(all_latencies) if all_latencies else 0

        def _norm(val: float, vmin: float, vmax: float) -> float:
            if vmax == vmin:
                return 1.0
            return (val - vmin) / (vmax - vmin)

        combos: list[dict[str, Any]] = []
        for assignment in itertools.product(models, repeat=len(stages)):
            combo_map = dict(zip(stages, assignment))
            total_quality = 0.0
            total_cost = 0.0
            total_latency = 0.0
            valid = True

            for stage, model in combo_map.items():
                data = lookup.get((stage, model))
                if not data or data["avg_quality"] is None:
                    valid = False
                    break
                total_quality += data["avg_quality"]
                total_cost += data.get("avg_cost_usd", 0) or 0
                total_latency += data.get("avg_latency", 0) or 0

            if not valid:
                continue

            avg_quality = total_quality / len(stages)
            # Normalize: quality higher=better, cost lower=better, latency lower=better
            norm_q = _norm(avg_quality, q_min, q_max)
            norm_c = 1.0 - _norm(total_cost, c_min * len(stages), c_max * len(stages)) if c_max > c_min else 1.0
            norm_l = 1.0 - _norm(total_latency, l_min * len(stages), l_max * len(stages)) if l_max > l_min else 1.0

            weighted_score = w_quality * norm_q + w_cost * norm_c + w_latency * norm_l

            combos.append({
                "assignment": combo_map,
                "avg_quality": round(avg_quality, 1),
                "total_cost_per_question_usd": round(total_cost, 6),
                "total_latency_seconds": round(total_latency, 2),
                "normalized_quality": round(norm_q, 3),
                "normalized_cost": round(norm_c, 3),
                "normalized_latency": round(norm_l, 3),
                "weighted_score": round(weighted_score, 4),
                "unique_models_used": len(set(assignment)),
            })

        # Sort by weighted score descending
        combos.sort(key=lambda c: c["weighted_score"], reverse=True)

        # Add rank
        for i, c in enumerate(combos):
            c["rank"] = i + 1

        return combos

    def _extract_baseline_stats(self, aggregated: list[dict[str, Any]]) -> dict[str, Any]:
        """Extract stats for the current baseline model assignment."""
        stages = [s.value for s in CORE_QA_STAGES]
        total_quality = 0.0
        total_cost = 0.0
        total_latency = 0.0
        per_stage: dict[str, Any] = {}

        for stage_enum, model in CURRENT_BASELINE.items():
            stage = stage_enum.value
            match = [a for a in aggregated if a["stage"] == stage and a["model"] == model]
            if match:
                data = match[0]
                per_stage[stage] = {
                    "model": model,
                    "avg_quality": data["avg_quality"],
                    "avg_cost_usd": data.get("avg_cost_usd"),
                    "avg_latency": data["avg_latency"],
                }
                total_quality += data["avg_quality"] or 0
                total_cost += data.get("avg_cost_usd") or 0
                total_latency += data.get("avg_latency") or 0
            else:
                per_stage[stage] = {"model": model, "avg_quality": None, "avg_cost_usd": None, "avg_latency": None}

        return {
            "assignment": {s.value: m for s, m in CURRENT_BASELINE.items()},
            "per_stage": per_stage,
            "avg_quality": round(total_quality / len(stages), 1) if total_quality else None,
            "total_cost_per_question_usd": round(total_cost, 6),
            "total_latency_seconds": round(total_latency, 2),
        }

    def _build_recommendations(
        self,
        combos: list[dict[str, Any]],
        baseline: dict[str, Any],
    ) -> dict[str, Any]:
        """Build the final recommendations comparing top combos to baseline."""
        if not combos:
            return {"error": "No valid combos found"}

        top = combos[0]
        base_cost = baseline.get("total_cost_per_question_usd", 0) or 0.001
        base_latency = baseline.get("total_latency_seconds", 0) or 0.001
        base_quality = baseline.get("avg_quality", 0) or 1

        # Find specific optimal combos
        cheapest = min(combos, key=lambda c: c["total_cost_per_question_usd"])
        fastest = min(combos, key=lambda c: c["total_latency_seconds"])
        best_quality = max(combos, key=lambda c: c["avg_quality"])

        def _compare(combo: dict, label: str) -> dict:
            cost_save = ((base_cost - combo["total_cost_per_question_usd"]) / base_cost) * 100 if base_cost else 0
            latency_save = ((base_latency - combo["total_latency_seconds"]) / base_latency) * 100 if base_latency else 0
            quality_diff = combo["avg_quality"] - base_quality
            return {
                "label": label,
                "assignment": combo["assignment"],
                "rank": combo["rank"],
                "weighted_score": combo["weighted_score"],
                "avg_quality": combo["avg_quality"],
                "total_cost_per_question_usd": combo["total_cost_per_question_usd"],
                "total_latency_seconds": combo["total_latency_seconds"],
                "vs_baseline": {
                    "cost_saving_pct": round(cost_save, 1),
                    "latency_saving_pct": round(latency_save, 1),
                    "quality_change": round(quality_diff, 1),
                },
            }

        return {
            "overall_best": _compare(top, "Best Overall (Weighted)"),
            "cheapest": _compare(cheapest, "Cheapest Per Question"),
            "fastest": _compare(fastest, "Fastest Per Question"),
            "best_quality": _compare(best_quality, "Highest Quality"),
            "top_10": [_compare(c, f"Rank #{c['rank']}") for c in combos[:10]],
            "total_combos": len(combos),
        }


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
            from memory.raptor_index import RaptorIndex  # noqa: F401
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not getattr(mm, "_initialized", False):
                return {"healthy": False, "status": "not_initialized"}
            settings = get_settings()
            enabled = getattr(settings.optimization, "enable_raptor_index", False)
            store = getattr(mm, "_raptor_indexes", getattr(mm, "_raptor", None))
            loaded = len(store) if isinstance(store, dict) else (1 if store else 0)
            return {
                "healthy": True,
                "status": "enabled" if enabled else "disabled_by_flag",
                "details": {"enabled": enabled, "loaded_docs": loaded},
            }
        except ImportError as e:
            return {"healthy": False, "status": "import_error", "error": str(e)[:300]}
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_user_memory(self) -> dict[str, Any]:
        """Check user memory subsystem."""
        try:
            from memory.user_memory import UserMemoryManager  # noqa: F401
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not getattr(mm, "_initialized", False):
                return {"healthy": False, "status": "not_initialized"}
            settings = get_settings()
            enabled = getattr(settings.optimization, "enable_user_memory", False)
            store = getattr(mm, "_user_memories", getattr(mm, "_user_memory", None))
            loaded = len(store) if isinstance(store, dict) else (1 if store else 0)
            return {
                "healthy": True,
                "status": "enabled" if enabled else "disabled_by_flag",
                "details": {"enabled": enabled, "loaded_users": loaded},
            }
        except ImportError as e:
            return {"healthy": False, "status": "import_error", "error": str(e)[:300]}
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_query_intelligence(self) -> dict[str, Any]:
        """Check query intelligence subsystem."""
        try:
            from memory.query_intelligence import QueryIntelligence  # noqa: F401
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not getattr(mm, "_initialized", False):
                return {"healthy": False, "status": "not_initialized"}
            settings = get_settings()
            enabled = getattr(settings.optimization, "enable_query_intelligence", False)
            store = getattr(mm, "_query_intel", None) or {}
            loaded = len(store) if isinstance(store, dict) else 0
            return {
                "healthy": True,
                "status": "enabled" if enabled else "disabled_by_flag",
                "details": {"enabled": enabled, "loaded_docs": loaded},
            }
        except ImportError as e:
            return {"healthy": False, "status": "import_error", "error": str(e)[:300]}
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_retrieval_feedback(self) -> dict[str, Any]:
        """Check retrieval feedback subsystem."""
        try:
            from memory.retrieval_feedback import RetrievalFeedback  # noqa: F401
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not getattr(mm, "_initialized", False):
                return {"healthy": False, "status": "not_initialized"}
            settings = get_settings()
            enabled = getattr(settings.optimization, "enable_retrieval_feedback", False)
            store = getattr(mm, "_retrieval_fb", None) or {}
            loaded = len(store) if isinstance(store, dict) else 0
            return {
                "healthy": True,
                "status": "enabled" if enabled else "disabled_by_flag",
                "details": {"enabled": enabled, "loaded_docs": loaded},
            }
        except ImportError as e:
            return {"healthy": False, "status": "import_error", "error": str(e)[:300]}
        except Exception as e:
            return {"healthy": False, "status": "error", "error": str(e)[:300]}

    def _check_r2r(self) -> dict[str, Any]:
        """Check R2R fallback subsystem."""
        try:
            from memory.r2r_fallback import R2RFallback  # noqa: F401
            from memory.memory_manager import get_memory_manager
            mm = get_memory_manager()
            if not getattr(mm, "_initialized", False):
                return {"healthy": False, "status": "not_initialized"}
            settings = get_settings()
            enabled = getattr(settings.optimization, "enable_r2r_fallback", False)
            store = getattr(mm, "_r2r_fallbacks", getattr(mm, "_r2r", None))
            loaded = len(store) if isinstance(store, dict) else (1 if store else 0)
            return {
                "healthy": True,
                "status": "enabled" if enabled else "disabled_by_flag",
                "details": {"enabled": enabled, "loaded_docs": loaded},
            }
        except ImportError as e:
            return {"healthy": False, "status": "import_error", "error": str(e)[:300]}
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
                max_tokens=20,
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
