"""
Embedding client for GOVINDA V2.

Thin wrapper around OpenAI embeddings API for text-embedding-3-small.
Tracks API calls and tokens for benchmarking.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from openai import OpenAI

from config.settings import get_settings

logger = logging.getLogger(__name__)


class EmbeddingClient:
    """Generate embeddings via OpenAI API with usage tracking."""

    def __init__(self, model: Optional[str] = None) -> None:
        settings = get_settings()
        self._model = model or settings.optimization.embedding_model
        self._client = OpenAI(api_key=settings.llm.openai_api_key or os.getenv("OPENAI_API_KEY", ""))

        # Thread-safe usage counters
        self._lock = threading.Lock()
        self._total_tokens = 0
        self._total_calls = 0

    def embed(self, text: str) -> list[float]:
        """Embed a single text string. Returns normalized embedding vector."""
        result = self._client.embeddings.create(
            input=[text],
            model=self._model,
        )
        with self._lock:
            self._total_tokens += result.usage.total_tokens
            self._total_calls += 1
        return result.data[0].embedding

    def embed_batch(self, texts: list[str], batch_size: int = 2048) -> list[list[float]]:
        """
        Embed a batch of texts. OpenAI supports up to 2048 inputs per call.
        Returns list of embedding vectors in the same order as input.
        """
        all_embeddings: list[list[float]] = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            result = self._client.embeddings.create(
                input=batch,
                model=self._model,
            )
            with self._lock:
                self._total_tokens += result.usage.total_tokens
                self._total_calls += 1

            # Sort by index to maintain order
            sorted_data = sorted(result.data, key=lambda d: d.index)
            all_embeddings.extend([d.embedding for d in sorted_data])

        logger.info(
            "[BENCHMARK][embedding] Embedded %d texts | %d tokens | %d API calls",
            len(texts), self._total_tokens, self._total_calls,
        )
        return all_embeddings

    def get_usage(self) -> dict:
        """Return cumulative usage stats."""
        with self._lock:
            return {
                "model": self._model,
                "total_tokens": self._total_tokens,
                "total_calls": self._total_calls,
            }

    def reset_usage(self) -> None:
        """Reset usage counters."""
        with self._lock:
            self._total_tokens = 0
            self._total_calls = 0
