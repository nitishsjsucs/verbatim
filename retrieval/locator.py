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
from config.settings import get_active_retrieval_mode, get_settings
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
        memory_candidates: Optional[list[str]] = None,
        reliability_scores: Optional[dict[str, float]] = None,
    ) -> list[LocatedNode]:
        """
        Locate relevant nodes in the document tree.

        Args:
            query: The classified query.
            tree: The document tree to search.
            embedding_index: Optional pre-built embedding index for pre-filtering.
            embedding_client: Optional EmbeddingClient for query embedding.
            memory_candidates: Optional node_ids from RAPTOR/memory pre-filter.
            reliability_scores: Optional node reliability scores from retrieval feedback.

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

                # Merge memory candidates (RAPTOR pre-filter) into candidate set
                if memory_candidates:
                    candidate_ids.update(memory_candidates)
                    logger.info(
                        "[BENCHMARK][memory_merge] Added %d memory candidates to pre-filter",
                        len(memory_candidates),
                    )

                tree_index = json.dumps(tree.to_compressed_index(candidate_ids), indent=2)
                _used_prefilter = True
                logger.info(
                    "[BENCHMARK][prefilter] Using compressed index: %d candidates / %d total nodes",
                    len(candidate_ids), tree.node_count,
                )
            except Exception as e:
                logger.warning("[BENCHMARK][prefilter] Failed, falling back to full index: %s", e)
                tree_index = json.dumps(tree.to_index(), indent=2)
        elif memory_candidates:
            # No embedding pre-filter but we have memory candidates — use compressed index
            try:
                candidate_ids = set(memory_candidates)
                tree_index = json.dumps(tree.to_compressed_index(candidate_ids), indent=2)
                _used_prefilter = True
                logger.info(
                    "[BENCHMARK][memory_only] Using memory-only compressed index: %d candidates / %d total nodes",
                    len(candidate_ids), tree.node_count,
                )
            except Exception as e:
                logger.warning("[BENCHMARK][memory_only] Failed, falling back to full index: %s", e)
                tree_index = json.dumps(tree.to_index(), indent=2)
        else:
            # No memory candidates and no embedding pre-filter.
            # Full tree index can be extremely large (183 nodes → ~30K tokens per
            # LLM call).  Cap the index to the top-level + second-level nodes to
            # keep the locate prompt under control while still allowing the LLM
            # to reason over the document structure.
            _MAX_FULL_INDEX_TOKENS = 20_000
            full_index = tree.to_index()
            full_json = json.dumps(full_index, indent=2)
            _est_tokens = len(full_json) // 4  # rough char-to-token estimate
            if _est_tokens > _MAX_FULL_INDEX_TOKENS:
                # Fall back to top-2 level summary index to keep locate affordable
                try:
                    tree_index = json.dumps(
                        tree.to_summary_index(max_depth=2), indent=2,
                    )
                    logger.info(
                        "[BENCHMARK][index_cap] Full index too large (~%d tokens), "
                        "using depth-2 summary index instead",
                        _est_tokens,
                    )
                except Exception:
                    # to_summary_index not available — truncate JSON directly
                    tree_index = full_json[:_MAX_FULL_INDEX_TOKENS * 4]
                    logger.info(
                        "[BENCHMARK][index_cap] Full index truncated from ~%d tokens",
                        _est_tokens,
                    )
            else:
                tree_index = full_json

        user_msg = format_prompt(
            user_template,
            query_text=query.text,
            query_type=query.query_type.value,
            key_terms=", ".join(query.key_terms) if query.key_terms else "none",
            tree_index=tree_index,
        )

        try:
            # Optimized mode: use tournament-verified model for this stage
            settings = get_settings()
            opt = settings.optimization
            if get_active_retrieval_mode() == "optimized":
                _model = opt.stage_model_locate
                effort = opt.stage_effort_locate
            else:
                _model = None  # default (gpt-5.2)
                # Adaptive reasoning effort based on query complexity
                _effort_map = {
                    "definitional": "low",
                    "single_hop": "medium",
                    "multi_hop": "medium",
                    "global": "high",
                }
                effort = _effort_map.get(query.query_type.value, "medium")

            # Reasoning tokens count toward max_output_tokens, so reasoning-
            # enabled models need a larger budget to leave room for visible
            # output.  Scale by effort level to avoid wasting reasoning tokens.
            _effort_budget = {"none": 4096, "low": 8192, "medium": 16384, "high": 16384}
            _locate_max = _effort_budget.get(effort, 8192)

            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=_model,
                max_tokens=_locate_max,
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

            # Phase 3: Adjust confidence with reliability scores
            if reliability_scores:
                for node in located:
                    score = reliability_scores.get(node.node_id)
                    if score is not None:
                        # Boost/penalize confidence based on reliability
                        # Neutral = 0.5, above = boost, below = penalize
                        adjustment = (score - 0.5) * 0.2  # ±10% max adjustment
                        node.confidence = max(0.1, min(1.0, node.confidence + adjustment))
                # Re-sort after adjustment
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
