"""
GOVINDA V2 Configuration.

Minimal Pydantic Settings for the vectorless structure-first RAG system.
No embeddings, no vector DB — just LLM + document trees.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# ---------------------------------------------------------------------------
# Project root = govinda_v2/ directory
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class LLMConfig(BaseSettings):
    """LLM provider configuration — OpenAI + DeepInfra multi-provider."""

    model_config = SettingsConfigDict(
        env_prefix="", env_file=str(PROJECT_ROOT / ".env"), extra="ignore"
    )

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")

    # DeepInfra provider (OpenAI-compatible Chat Completions API)
    deepinfra_api_key: str = Field(default="", alias="DEEPINFRA_API_KEY")
    deepinfra_base_url: str = Field(
        default="https://api.deepinfra.com/v1/openai",
        alias="DEEPINFRA_BASE_URL",
    )

    # Primary model for tree reasoning, locating, reading
    model: str = Field(default="gpt-5.2", alias="LLM_MODEL")

    # Pro model for synthesis and verification (deeper reasoning)
    model_pro: str = Field(default="gpt-5.2-pro", alias="LLM_MODEL_PRO")

    # Temperature (only effective when reasoning_effort="none")
    temperature: float = 0.1
    temperature_deterministic: float = 0.0

    # Token limits
    max_tokens_default: int = 8192
    max_tokens_short: int = 1024
    max_tokens_long: int = 65536
    max_tokens_tree_building: int = 8192  # Tree enrichment needs more room


class TreeConfig(BaseSettings):
    """Document tree building configuration."""

    model_config = SettingsConfigDict(
        env_prefix="", env_file=str(PROJECT_ROOT / ".env"), extra="ignore"
    )

    # TOC detection accuracy threshold — if below this, fall back to next mode
    toc_accuracy_threshold: float = Field(default=0.6, alias="TOC_ACCURACY_THRESHOLD")

    # Node splitting — max tokens before a node is split into children
    max_node_tokens: int = Field(default=3000, alias="MAX_NODE_TOKENS")
    min_node_tokens: int = Field(default=100, alias="MIN_NODE_TOKENS")

    # Summary generation
    summary_max_tokens: int = 200  # Max tokens per node summary
    description_max_tokens: int = 300  # Max tokens per node description

    # Cross-reference patterns (RBI-specific)
    cross_ref_patterns: list[str] = [
        r"(?:as\s+per|refer(?:\s+to)?|see|vide|in\s+terms\s+of)\s+(?:Section|Clause|Para(?:graph)?|Annexure|Appendix|Schedule|Chapter)\s+[\w\.\-]+",
        r"(?:Section|Clause|Para(?:graph)?|Annexure|Appendix|Schedule|Chapter)\s+[\w\.\-]+\s+(?:of|under)\s+(?:these|this|the)",
        r"(?:ibid|supra|infra)",
        r"(?:Master\s+Direction|Master\s+Circular|Notification)\s+(?:No\.?|dated)\s+[\w\.\-/]+",
    ]


class RetrievalConfig(BaseSettings):
    """Retrieval pipeline configuration."""

    model_config = SettingsConfigDict(
        env_prefix="", env_file=str(PROJECT_ROOT / ".env"), extra="ignore"
    )

    # Locate phase — max nodes the LLM can select per query
    max_located_nodes: int = Field(default=15, alias="MAX_LOCATED_NODES")

    # Read phase — expand to neighboring nodes for context
    context_expansion_siblings: int = Field(
        default=1, alias="CONTEXT_EXPANSION_SIBLINGS"
    )
    context_expansion_parent: bool = True

    # Cross-reference following — max depth to follow links
    max_cross_ref_depth: int = Field(default=2, alias="MAX_CROSS_REF_DEPTH")

    # Token budget for retrieved text passed to synthesis
    retrieval_token_budget: int = Field(default=100000, alias="RETRIEVAL_TOKEN_BUDGET")
    # Reflection heuristics: skip reflection when we already have abundant evidence
    reflection_skip_section_threshold: int = Field(default=6, alias="REFLECTION_SKIP_SECTION_THRESHOLD")
    reflection_skip_token_threshold: int = Field(default=50000, alias="REFLECTION_SKIP_TOKEN_THRESHOLD")


class StorageConfig(BaseSettings):
    """Storage paths configuration."""

    model_config = SettingsConfigDict(
        env_prefix="", env_file=str(PROJECT_ROOT / ".env"), extra="ignore"
    )

    trees_path: str = Field(default="data/trees", alias="TREES_PATH")
    prompts_path: str = Field(default="config/prompts", alias="PROMPTS_PATH")
    logs_path: str = Field(default="data/logs", alias="LOGS_PATH")

    def resolve(self, relative: str) -> Path:
        """Resolve a relative path against the project root."""
        return PROJECT_ROOT / relative

    @property
    def trees_dir(self) -> Path:
        return self.resolve(self.trees_path)

    @property
    def prompts_dir(self) -> Path:
        return self.resolve(self.prompts_path)

    @property
    def logs_dir(self) -> Path:
        return self.resolve(self.logs_path)


class OptimizationConfig(BaseSettings):
    """Optimization pipeline configuration — toggle between legacy and optimized retrieval."""

    model_config = SettingsConfigDict(
        env_prefix="", env_file=str(PROJECT_ROOT / ".env"), extra="ignore"
    )

    # Master toggle: "legacy" keeps the current system intact, "optimized" enables new pipeline
    retrieval_mode: str = Field(default="legacy", alias="RETRIEVAL_MODE")

    # Sub-feature toggles (only active when retrieval_mode="optimized")
    enable_locator_cache: bool = Field(default=True, alias="OPT_LOCATOR_CACHE")
    enable_embedding_prefilter: bool = Field(default=True, alias="OPT_EMBEDDING_PREFILTER")
    enable_query_cache: bool = Field(default=True, alias="OPT_QUERY_CACHE")
    enable_verification_skip: bool = Field(default=True, alias="OPT_VERIFICATION_SKIP")
    enable_synthesis_prealloc: bool = Field(default=True, alias="OPT_SYNTHESIS_PREALLOC")
    enable_reflection_tuning: bool = Field(default=True, alias="OPT_REFLECTION_TUNING")

    # Tuned reflection thresholds (used when enable_reflection_tuning is on)
    tuned_reflection_skip_section_threshold: int = 4
    tuned_reflection_skip_token_threshold: int = 30000

    # Embedding prefilter settings
    embedding_model: str = "text-embedding-3-small"
    prefilter_top_k: int = 30

    # Query cache settings
    cache_similarity_threshold: float = 0.95
    cache_max_entries: int = 500

    # Verification skip confidence threshold
    verification_skip_min_citations: int = 2

    # Fast synthesis settings (Phase 2 optimization)
    enable_fast_synthesis: bool = Field(default=True, alias="OPT_FAST_SYNTHESIS")
    synthesis_token_budget: int = 25000  # Max section tokens sent to synthesizer
    synthesis_reasoning_effort: str = "medium"  # Override reasoning effort in optimized mode

    # ── Per-stage model overrides (optimized mode only) ──────────────
    # Tournament-verified optimal model assignments.
    # Each stage maps to a model ID and reasoning effort level.
    # These override the default model/model_pro when retrieval_mode="optimized".
    #
    #   Classify:    gpt-5-mini  (low)      — lightweight classification task
    #   Expand:      gpt-5-mini  (none)     — creative query expansion, no reasoning needed
    #   Locate:      gpt-5-nano  (low)      — node selection from tree index
    #   Reflect:     gpt-5.2     (low)      — retrieval quality assessment
    #   Synthesize:  gpt-5.2     (medium)   — full answer generation with citations
    #   Verify:      gpt-5-nano  (low)       — factual verification pass
    stage_model_classify: str = "gpt-5-mini"
    stage_effort_classify: str = "low"
    stage_model_expand: str = "gpt-5-mini"
    stage_effort_expand: str = "low"
    stage_model_locate: str = "gpt-5-nano"
    stage_effort_locate: str = "low"
    stage_model_reflect: str = "gpt-5.2"
    stage_effort_reflect: str = "low"
    stage_model_synthesize: str = "gpt-5.2"
    stage_effort_synthesize: str = "medium"
    stage_model_verify: str = "gpt-5-nano"
    stage_effort_verify: str = "low"

    # Self-evolving memory toggles (Phase 3 — only active when retrieval_mode="optimized")
    enable_raptor_index: bool = Field(default=True, alias="OPT_RAPTOR_INDEX")
    enable_user_memory: bool = Field(default=True, alias="OPT_USER_MEMORY")
    enable_query_intelligence: bool = Field(default=True, alias="OPT_QUERY_INTELLIGENCE")
    enable_retrieval_feedback: bool = Field(default=True, alias="OPT_RETRIEVAL_FEEDBACK")
    enable_r2r_fallback: bool = Field(default=True, alias="OPT_R2R_FALLBACK")


class AppConfig(BaseSettings):
    """Top-level application configuration."""

    model_config = SettingsConfigDict(
        env_prefix="", env_file=str(PROJECT_ROOT / ".env"), extra="ignore"
    )
    log_level: str = "INFO"


# ---------------------------------------------------------------------------
# Aggregate settings
# ---------------------------------------------------------------------------


class Settings:
    """Aggregated settings container. Instantiates all sub-configs once."""

    def __init__(self) -> None:
        self.app = AppConfig()
        self.llm = LLMConfig()
        self.tree = TreeConfig()
        self.retrieval = RetrievalConfig()
        self.storage = StorageConfig()
        self.optimization = OptimizationConfig()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached singleton settings instance."""
    return Settings()


def get_active_retrieval_mode() -> str:
    """Return the effective retrieval mode (runtime override > .env default).

    Safe to call from any module — uses lazy import to avoid circular deps.
    """
    try:
        from app_backend.main import get_retrieval_mode
        return get_retrieval_mode()
    except Exception:
        return get_settings().optimization.retrieval_mode
