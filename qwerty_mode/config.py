"""
qwerty_mode configuration.

All env vars are prefixed `QWERTY_` to keep this mode's credentials fully
separate from anything in the actual qwerty repo and from govinda's other
modes. Read once at import time via get_qwerty_config().
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class QwertyConfig:
    # ── OpenAI (shared with govinda) ──────────────────────────────
    openai_api_key: str
    embedding_model: str = "text-embedding-3-small"
    embedding_dims: int = 1536

    # ── Cloudflare R2 (file storage) ──────────────────────────────
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    # https://<account_id>.r2.cloudflarestorage.com
    r2_endpoint: str = ""

    # ── Cloudflare Vectorize (vector DB) ──────────────────────────
    cf_account_id: str = ""
    cf_api_token: str = ""
    vectorize_index: str = "qwerty-mode-index"

    # ── Convex (live data store) ──────────────────────────────────
    # Cloud URL (used by React client): https://<dep>.convex.cloud
    convex_url: str = ""
    # HTTP Actions URL (used by Python): https://<dep>.convex.site
    # If empty, auto-derived from convex_url by swapping .cloud → .site.
    convex_http_url: str = ""
    # Bearer token compared inside http.ts against env var QWERTY_HTTP_KEY.
    convex_deploy_key: str = ""
    # Path namespace exposed by convex_qwerty/http.ts
    convex_http_path: str = "/qwerty"

    # ── Synthesis ─────────────────────────────────────────────────
    synth_model: str = "gpt-5.2"
    synth_reasoning_effort: str = "medium"
    top_k: int = 12
    chunk_size_tokens: int = 600
    chunk_overlap_tokens: int = 80


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@lru_cache(maxsize=1)
def get_qwerty_config() -> QwertyConfig:
    return QwertyConfig(
        openai_api_key=_env("OPENAI_API_KEY"),
        embedding_model=_env("QWERTY_EMBEDDING_MODEL", "text-embedding-3-small"),
        embedding_dims=int(_env("QWERTY_EMBEDDING_DIMS", "1536") or "1536"),
        r2_account_id=_env("QWERTY_CF_ACCOUNT_ID"),
        r2_access_key_id=_env("QWERTY_CF_R2_ACCESS_KEY_ID"),
        r2_secret_access_key=_env("QWERTY_CF_R2_SECRET_ACCESS_KEY"),
        r2_bucket=_env("QWERTY_CF_R2_BUCKET"),
        r2_endpoint=_env("QWERTY_CF_R2_ENDPOINT"),
        cf_account_id=_env("QWERTY_CF_ACCOUNT_ID"),
        cf_api_token=_env("QWERTY_CF_VECTORIZE_API_TOKEN"),
        vectorize_index=_env("QWERTY_CF_VECTORIZE_INDEX", "qwerty-mode-index"),
        convex_url=_env("QWERTY_CONVEX_URL"),
        convex_http_url=_env("QWERTY_CONVEX_HTTP_URL")
        or _env("QWERTY_CONVEX_URL").replace(".convex.cloud", ".convex.site"),
        convex_deploy_key=_env("QWERTY_CONVEX_DEPLOY_KEY"),
        convex_http_path=_env("QWERTY_CONVEX_HTTP_PATH", "/qwerty"),
        synth_model=_env("QWERTY_SYNTH_MODEL", "gpt-5.2"),
        synth_reasoning_effort=_env("QWERTY_SYNTH_EFFORT", "medium"),
        top_k=int(_env("QWERTY_TOP_K", "12") or "12"),
        chunk_size_tokens=int(_env("QWERTY_CHUNK_SIZE", "600") or "600"),
        chunk_overlap_tokens=int(_env("QWERTY_CHUNK_OVERLAP", "80") or "80"),
    )


def assert_qwerty_ready() -> None:
    """Raise a clear error if any required env var is missing."""
    cfg = get_qwerty_config()
    missing: list[str] = []
    if not cfg.openai_api_key:
        missing.append("OPENAI_API_KEY")
    for name, val in [
        ("QWERTY_CF_ACCOUNT_ID", cfg.cf_account_id),
        ("QWERTY_CF_VECTORIZE_API_TOKEN", cfg.cf_api_token),
        ("QWERTY_CF_R2_ACCESS_KEY_ID", cfg.r2_access_key_id),
        ("QWERTY_CF_R2_SECRET_ACCESS_KEY", cfg.r2_secret_access_key),
        ("QWERTY_CF_R2_BUCKET", cfg.r2_bucket),
        ("QWERTY_CF_R2_ENDPOINT", cfg.r2_endpoint),
        ("QWERTY_CONVEX_URL", cfg.convex_url),
    ]:
        if not val:
            missing.append(name)
    if missing:
        raise RuntimeError(
            "qwerty_mode is not configured. Missing env vars: "
            + ", ".join(missing)
            + ". See qwerty_mode/README.md."
        )
