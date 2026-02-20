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
    """LLM provider configuration — GPT-5.2 / GPT-5.2-pro only."""

    model_config = SettingsConfigDict(
        env_prefix="", env_file=str(PROJECT_ROOT / ".env"), extra="ignore"
    )

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")

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


class AppConfig(BaseSettings):
    """Top-level application configuration."""

    model_config = SettingsConfigDict(
        env_prefix="", env_file=str(PROJECT_ROOT / ".env"), extra="ignore"
    )

    streamlit_port: int = 8502  # Different port from V1 (8501)
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached singleton settings instance."""
    return Settings()
