"""
Locator for GOVINDA V2 — DeepRead Phase 1.

The LLM reasons over the document tree index (titles + summaries)
to identify which sections are relevant to the query.

This is the core vectorless retrieval mechanism: no embeddings,
no similarity search — pure LLM reasoning over structure.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.document import DocumentTree
from models.query import LocatedNode, Query
from utils.llm_client import LLMClient
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from retrieval.embedding_index import EmbeddingIndex

logger = logging.getLogger(__name__)


class Locator:
    """
    Locate relevant document sections using LLM tree reasoning.

    Presents the tree index (titles + summaries + page ranges) to
    the LLM and asks it to select relevant node_ids.
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._settings = get_settings()
        self._cache: dict[tuple[str, str], list[LocatedNode]] = {}

    def _is_cache_enabled(self) -> bool:
        """Check if locator cache is enabled via optimization toggle."""
        if self._settings.optimization.retrieval_mode != "optimized":
            return False
        try:
            from app_backend.main import _runtime_config, get_retrieval_mode
            if get_retrieval_mode() != "optimized":
                return False
            return _runtime_config.get("enable_locator_cache", self._settings.optimization.enable_locator_cache)
        except Exception:
            return self._settings.optimization.enable_locator_cache

    def _is_prefilter_enabled(self) -> bool:
        """Check if embedding pre-filter is enabled via optimization toggle."""
        if self._settings.optimization.retrieval_mode != "optimized":
            try:
                from app_backend.main import get_retrieval_mode
                if get_retrieval_mode() != "optimized":
                    return False
            except Exception:
                return False
        try:
            from app_backend.main import _runtime_config
            return _runtime_config.get("enable_embedding_prefilter", self._settings.optimization.enable_embedding_prefilter)
        except Exception:
            return self._settings.optimization.enable_embedding_prefilter

    def clear_cache(self) -> None:
        """Clear the locator cache."""
        self._cache.clear()

    def locate(
        self,
        query: Query,
        tree: DocumentTree,
        embedding_index: Optional["EmbeddingIndex"] = None,
        embedding_client=None,
    ) -> list[LocatedNode]:
        """
        Locate relevant nodes in the document tree.

        Args:
            query: The classified query.
            tree: The document tree to search.
            embedding_index: Optional pre-built embedding index for pre-filtering.
            embedding_client: Optional EmbeddingClient for query embedding.

        Returns:
            List of LocatedNode objects with relevance reasoning.
        """
        # Cache check (Phase 0A optimization)
        cache_key = (query.text.strip().lower(), tree.doc_id)
        if self._is_cache_enabled() and cache_key in self._cache:
            logger.info("[BENCHMARK][locator_cache] HIT for query='%s' doc=%s", query.text[:40], tree.doc_id)
            return list(self._cache[cache_key])  # return copy

        prompt_data = load_prompt("retrieval", "node_location")
        system_prompt = format_prompt(
            prompt_data["system"],
            max_nodes=self._settings.retrieval.max_located_nodes,
        )
        user_template = prompt_data["user_template"]

        # Phase 1: Use embedding pre-filter if available and enabled
        _used_prefilter = False
        if (
            embedding_index
            and embedding_client
            and self._is_prefilter_enabled()
        ):
            try:
                query_embedding = embedding_client.embed(query.text)
                top_k = self._settings.optimization.prefilter_top_k
                candidate_ids = set(embedding_index.search(query_embedding, top_k=top_k))
                tree_index = json.dumps(tree.to_compressed_index(candidate_ids), indent=2)
                _used_prefilter = True
                logger.info(
                    "[BENCHMARK][prefilter] Using compressed index: %d candidates / %d total nodes",
                    len(candidate_ids), tree.node_count,
                )
            except Exception as e:
                logger.warning("[BENCHMARK][prefilter] Failed, falling back to full index: %s", e)
                tree_index = json.dumps(tree.to_index(), indent=2)
        else:
            tree_index = json.dumps(tree.to_index(), indent=2)

        user_msg = format_prompt(
            user_template,
            query_text=query.text,
            query_type=query.query_type.value,
            key_terms=", ".join(query.key_terms) if query.key_terms else "none",
            tree_index=tree_index,
        )

        try:
            # Adaptive reasoning effort based on query complexity
            _effort_map = {
                "definitional": "low",
                "single_hop": "medium",
                "multi_hop": "medium",
                "global": "high",
            }
            effort = _effort_map.get(query.query_type.value, "medium")

            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=4096,
                reasoning_effort=effort,
            )

            located = []
            for item in result.get("located_nodes", []):
                node_id = item.get("node_id", "")
                # Verify the node actually exists in the tree
                tree_node = tree.get_node(node_id)
                if not tree_node:
                    logger.warning("Locator returned invalid node_id: %s", node_id)
                    continue

                located.append(
                    LocatedNode(
                        node_id=node_id,
                        title=tree_node.title,
                        relevance_reason=item.get("relevance_reason", ""),
                        confidence=float(item.get("confidence", 0.8)),
                        page_range=tree_node.page_range_str,
                    )
                )

            # Sort by confidence (highest first)
            located.sort(key=lambda n: n.confidence, reverse=True)

            # Limit to max
            located = located[: self._settings.retrieval.max_located_nodes]

            reasoning = result.get("reasoning_summary", "")
            logger.info(
                "Located %d nodes (strategy: %s)",
                len(located),
                reasoning[:100],
            )

            # Store in cache
            if self._is_cache_enabled():
                self._cache[cache_key] = list(located)
                logger.info("[BENCHMARK][locator_cache] MISS — stored %d results for query='%s'", len(located), query.text[:40])

            return located

        except Exception as e:
            logger.error("Location failed: %s", str(e))
            return []
