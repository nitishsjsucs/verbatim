"""
Actionable Extractor for GOVINDA V2.

Three-step pipeline for extracting compliance actionables from a document tree:
  Step 1: Pre-filter — identify nodes containing deontic language (cheap regex)
  Step 2: LLM extraction — extract structured actionables from batched sections
  Step 3: LLM validation — verify, deduplicate, catch misses

Batches multiple sections per LLM call to minimize total calls (~3-5 instead of ~40).
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Generator, Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.actionable import (
    ActionableItem,
    ActionablesResult,
    Modality,
    Workstream,
)
from models.document import DocumentTree, TreeNode
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)

# --- Strong deontic markers (obligation / prohibition / permission) ---
STRONG_DEONTIC = re.compile(
    r"\b(?:"
    r"shall|must|required\s+to|obligated"
    r"|shall\s+not|must\s+not|prohibited|not\s+permitted|barred"
    r"|should|endeavour\s+to"
    r")\b",
    re.IGNORECASE,
)

# --- Weaker signals (temporal/reporting/conditional) ---
WEAK_DEONTIC = re.compile(
    r"\b(?:"
    r"within\s+\d+\s+(?:days?|working\s+days?|months?|years?)"
    r"|not\s+later\s+than|at\s+least"
    r"|with\s+effect\s+from"
    r"|report\s+to|inform\s+the|notify"
    r"|subject\s+to|provided\s+that|notwithstanding"
    r")\b",
    re.IGNORECASE,
)

# Section title patterns that signal high actionable density
ACTIONABLE_TITLE_PATTERNS = re.compile(
    r"(?:applicability|reporting|responsibilities|compliance|obligation"
    r"|effective\s+date|commencement|penal|customer\s+due\s+diligence"
    r"|record\s+management|wire\s+transfer|monitoring|sanctions"
    r"|risk\s+management|simplified|enhanced|ongoing|identification"
    r"|verification|freezing|unfreezing)",
    re.IGNORECASE,
)

# Title patterns that signal definitional or non-actionable content
SKIP_TITLE_PATTERNS = re.compile(
    r"(?:^definition|^interpretation|^glossary|^abbreviation|^acronym"
    r"|^table\s+of\s+contents|^index$|^list\s+of\s+annexure"
    r"|^foreword|^preface|^introduction$)",
    re.IGNORECASE,
)

# Minimum number of strong deontic matches to qualify a node
MIN_DEONTIC_MATCHES = 2

# Max chars per batch to stay within model context (~8000 tokens of source)
BATCH_CHAR_LIMIT = 30000


class ActionableExtractor:
    """Extract compliance actionables from a document tree."""

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()

    def extract(self, tree: DocumentTree) -> ActionablesResult:
        """
        Full extraction pipeline: pre-filter → batch extract → validate.
        """
        start = time.time()
        self._llm.reset_usage()

        result = ActionablesResult(
            doc_id=tree.doc_id,
            doc_name=tree.doc_name,
        )

        # Step 1: Pre-filter nodes containing deontic language
        logger.info("[Actionables 1/3] Pre-filtering nodes for deontic language...")
        candidate_nodes = self._prefilter_nodes(tree)
        logger.info(
            "  -> %d/%d nodes contain deontic language",
            len(candidate_nodes),
            tree.node_count,
        )
        result.nodes_processed = len(candidate_nodes)

        if not candidate_nodes:
            logger.info("No deontic language found — no actionables to extract")
            result.extracted_at = datetime.now(timezone.utc).isoformat()
            return result

        # Step 2: Batched LLM extraction
        logger.info("[Actionables 2/3] Extracting actionables (batched)...")
        batches = self._build_batches(candidate_nodes)
        logger.info("  -> %d batches from %d nodes", len(batches), len(candidate_nodes))

        all_actionables: list[ActionableItem] = []
        id_offset = 1
        nodes_with_actionables_set: set[str] = set()

        for batch_idx, batch_nodes in enumerate(batches):
            logger.info(
                "  -> Batch %d/%d: %d sections (%s)",
                batch_idx + 1,
                len(batches),
                len(batch_nodes),
                ", ".join(n.title[:25] for n in batch_nodes[:3])
                + ("..." if len(batch_nodes) > 3 else ""),
            )
            extracted = self._extract_from_batch(tree, batch_nodes, id_offset)
            if extracted:
                all_actionables.extend(extracted)
                for item in extracted:
                    nodes_with_actionables_set.add(item.source_node_id)
                id_offset += len(extracted)
                logger.info("    -> %d actionables extracted", len(extracted))
            else:
                logger.info("    -> no actionables")

        result.nodes_with_actionables = len(nodes_with_actionables_set)
        logger.info(
            "  -> Total: %d actionables from %d nodes",
            len(all_actionables),
            result.nodes_with_actionables,
        )

        if not all_actionables:
            result.extracted_at = datetime.now(timezone.utc).isoformat()
            return result

        # Step 3: Validation pass (single call — much cheaper)
        logger.info(
            "[Actionables 3/3] Validating %d actionables...", len(all_actionables)
        )
        validated = self._validate_actionables(tree, all_actionables, candidate_nodes)

        result.actionables = validated
        result.compute_stats()

        elapsed = time.time() - start
        usage = self._llm.get_usage_summary()
        result.extraction_time_seconds = elapsed
        result.llm_calls = usage["total_calls"]
        result.total_tokens = usage["total_tokens"]
        result.extracted_at = datetime.now(timezone.utc).isoformat()

        logger.info("=" * 60)
        logger.info("ACTIONABLE EXTRACTION COMPLETE: %s", tree.doc_name)
        logger.info("  Total actionables: %d", result.total_extracted)
        logger.info(
            "  Validated: %d, Flagged: %d",
            result.total_validated,
            result.total_flagged,
        )
        logger.info("  By modality: %s", result.by_modality)
        logger.info("  By workstream: %s", result.by_workstream)
        logger.info(
            "  Time: %.1fs, LLM calls: %d, Tokens: %d",
            elapsed,
            result.llm_calls,
            result.total_tokens,
        )
        logger.info("=" * 60)

        return result

    # ------------------------------------------------------------------
    # Streaming variant — yields progress events as dicts
    # ------------------------------------------------------------------

    def extract_streaming(self, tree: DocumentTree) -> Generator[dict, None, None]:
        """
        Same pipeline as extract(), but yields progress dicts at each stage.

        Event types:
          {"event": "start", "total_nodes": int}
          {"event": "prefilter_done", "candidate_count": int, "total_nodes": int}
          {"event": "batches_planned", "total_batches": int, "candidate_count": int}
          {"event": "batch_start", "batch": int, "total_batches": int, "sections": [...]}
          {"event": "batch_done", "batch": int, "total_batches": int,
           "batch_actionables": int, "cumulative_actionables": int}
          {"event": "validation_start", "total_actionables": int}
          {"event": "validation_done", "validated": int, "flagged": int}
          {"event": "complete", "result": <full ActionablesResult dict>}
          {"event": "error", "message": str}
        """
        start = time.time()
        self._llm.reset_usage()

        yield {"event": "start", "total_nodes": tree.node_count}

        result = ActionablesResult(
            doc_id=tree.doc_id,
            doc_name=tree.doc_name,
        )

        # Step 1: Pre-filter
        candidate_nodes = self._prefilter_nodes(tree)
        result.nodes_processed = len(candidate_nodes)

        yield {
            "event": "prefilter_done",
            "candidate_count": len(candidate_nodes),
            "total_nodes": tree.node_count,
        }

        if not candidate_nodes:
            result.extracted_at = datetime.now(timezone.utc).isoformat()
            yield {"event": "complete", "result": result.to_dict()}
            return

        # Step 2: Batched LLM extraction
        batches = self._build_batches(candidate_nodes)

        yield {
            "event": "batches_planned",
            "total_batches": len(batches),
            "candidate_count": len(candidate_nodes),
        }

        all_actionables: list[ActionableItem] = []
        id_offset = 1
        nodes_with_actionables_set: set[str] = set()

        for batch_idx, batch_nodes in enumerate(batches):
            section_names = [n.title[:40] for n in batch_nodes[:4]]

            yield {
                "event": "batch_start",
                "batch": batch_idx + 1,
                "total_batches": len(batches),
                "sections": section_names,
            }

            extracted = self._extract_from_batch(tree, batch_nodes, id_offset)
            if extracted:
                all_actionables.extend(extracted)
                for item in extracted:
                    nodes_with_actionables_set.add(item.source_node_id)
                id_offset += len(extracted)

            yield {
                "event": "batch_done",
                "batch": batch_idx + 1,
                "total_batches": len(batches),
                "batch_actionables": len(extracted) if extracted else 0,
                "cumulative_actionables": len(all_actionables),
            }

        result.nodes_with_actionables = len(nodes_with_actionables_set)

        if not all_actionables:
            result.extracted_at = datetime.now(timezone.utc).isoformat()
            yield {"event": "complete", "result": result.to_dict()}
            return

        # Step 3: Validation
        yield {
            "event": "validation_start",
            "total_actionables": len(all_actionables),
        }

        validated = self._validate_actionables(tree, all_actionables, candidate_nodes)

        result.actionables = validated
        result.compute_stats()

        elapsed = time.time() - start
        usage = self._llm.get_usage_summary()
        result.extraction_time_seconds = elapsed
        result.llm_calls = usage["total_calls"]
        result.total_tokens = usage["total_tokens"]
        result.extracted_at = datetime.now(timezone.utc).isoformat()

        yield {
            "event": "validation_done",
            "validated": result.total_validated,
            "flagged": result.total_flagged,
        }

        yield {"event": "complete", "result": result.to_dict()}

    # ------------------------------------------------------------------
    # Step 1: Pre-filter
    # ------------------------------------------------------------------

    def _prefilter_nodes(self, tree: DocumentTree) -> list[TreeNode]:
        """
        Cheap regex pre-filter: find nodes likely to contain actionables.

        Scoring:
          - Require >= MIN_DEONTIC_MATCHES strong deontic hits, OR
          - At least 1 strong hit + a high-signal title match.
          - Skip definitional/index sections entirely.
          - Prefer leaf nodes to avoid double-extraction.
        """
        candidates = []

        for node in tree._all_nodes():
            text = node.text or ""
            title = node.title or ""

            if len(text.strip()) < 50:
                continue

            # Skip purely definitional sections
            if SKIP_TITLE_PATTERNS.search(title):
                continue

            strong_hits = len(STRONG_DEONTIC.findall(text))
            weak_hits = len(WEAK_DEONTIC.findall(text))
            has_title_signal = bool(ACTIONABLE_TITLE_PATTERNS.search(title))

            # Qualify if:
            #   (a) >= MIN_DEONTIC_MATCHES strong hits, OR
            #   (b) >= 1 strong hit AND a high-signal title, OR
            #   (c) >= 1 strong hit AND >= 2 weak hits (temporal/conditional signals)
            qualifies = (
                strong_hits >= MIN_DEONTIC_MATCHES
                or (strong_hits >= 1 and has_title_signal)
                or (strong_hits >= 1 and weak_hits >= 2)
            )

            if qualifies:
                if not node.children:
                    candidates.append(node)
                else:
                    children_text_len = sum(len(c.text or "") for c in node.children)
                    if len(text) > children_text_len * 1.3:
                        candidates.append(node)

        return candidates

    # ------------------------------------------------------------------
    # Step 2: Batched Extraction
    # ------------------------------------------------------------------

    def _build_batches(self, nodes: list[TreeNode]) -> list[list[TreeNode]]:
        """
        Group nodes into batches that fit within the char limit per LLM call.
        Each section is truncated to 4000 chars max to keep batches reasonable.
        """
        batches: list[list[TreeNode]] = []
        current_batch: list[TreeNode] = []
        current_chars = 0

        for node in nodes:
            node_chars = min(len(node.text or ""), 4000) + 200  # +200 for header
            if current_chars + node_chars > BATCH_CHAR_LIMIT and current_batch:
                batches.append(current_batch)
                current_batch = []
                current_chars = 0
            current_batch.append(node)
            current_chars += node_chars

        if current_batch:
            batches.append(current_batch)

        return batches

    def _extract_from_batch(
        self,
        tree: DocumentTree,
        nodes: list[TreeNode],
        id_offset: int,
    ) -> list[ActionableItem]:
        """Extract actionables from a batch of nodes in a single LLM call."""
        prompt_data = load_prompt("actionables", "extract")
        system_prompt = prompt_data["system"]

        # Build combined sections text
        sections_parts = []
        for node in nodes:
            text = (node.text or "")[:4000]
            page_range = f"pp.{node.start_page}-{node.end_page}"
            sections_parts.append(
                f"=== SECTION: {node.title} ({page_range}) [node_id: {node.node_id}] ===\n"
                f"{text}"
            )
        combined_text = "\n\n".join(sections_parts)

        # Use a batched user message (not the single-section template)
        user_msg = (
            f"DOCUMENT: {tree.doc_name}\n\n"
            f"The following {len(nodes)} sections have been identified as containing "
            f"deontic language (obligations, prohibitions, permissions). "
            f"Extract ALL compliance actionables from ALL sections below.\n\n"
            f"Number IDs sequentially starting from ACT-{id_offset:03d}.\n"
            f"For each actionable, set source_node_id to the node_id of the section "
            f"it came from, and source_location to the section title + page range.\n\n"
            f"SECTIONS:\n{combined_text}\n\n"
            f"Extract all compliance actionables. Return as JSON."
        )

        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model,
                max_tokens=self._settings.llm.max_tokens_long,
                reasoning_effort="medium",
            )

            items = []
            for raw in result.get("actionables", []):
                item = ActionableItem.from_dict(raw)
                # Validate source_node_id against batch
                valid_node_ids = {n.node_id for n in nodes}
                if item.source_node_id not in valid_node_ids and nodes:
                    item.source_node_id = nodes[0].node_id
                items.append(item)

            return items

        except Exception as e:
            logger.error("Batch extraction failed: %s", str(e))
            return []

    # ------------------------------------------------------------------
    # Step 3: Validation
    # ------------------------------------------------------------------

    def _validate_actionables(
        self,
        tree: DocumentTree,
        actionables: list[ActionableItem],
        source_nodes: list[TreeNode],
    ) -> list[ActionableItem]:
        """
        Validate extracted actionables: check grounding, deduplicate, catch misses.
        Single LLM call using the pro model.
        """
        prompt_data = load_prompt("actionables", "validate")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        # Build compact source text for validation
        source_parts = []
        for node in source_nodes:
            text = (node.text or "")[:2500]  # shorter per node for validation
            source_parts.append(
                f"--- {node.title} (pp.{node.start_page}-{node.end_page}) "
                f"[{node.node_id}] ---\n{text}"
            )
        source_text = "\n\n".join(source_parts)

        # Truncate if too large
        max_source_chars = 40000
        if len(source_text) > max_source_chars:
            source_text = source_text[:max_source_chars] + "\n\n[... truncated ...]"

        actionables_json = json.dumps(
            [a.to_dict() for a in actionables],
            indent=2,
        )

        user_msg = format_prompt(
            user_template,
            doc_name=tree.doc_name,
            source_sections_text=source_text,
            actionables_json=actionables_json,
        )

        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model_pro,
                max_tokens=self._settings.llm.max_tokens_long,
                reasoning_effort="medium",
            )

            all_validated: list[ActionableItem] = []

            for raw in result.get("validated_actionables", []):
                item = ActionableItem.from_dict(raw)
                all_validated.append(item)

            for raw in result.get("missed_actionables", []):
                item = ActionableItem.from_dict(raw)
                item.validation_status = "added_by_validator"
                all_validated.append(item)

            missed_count = len(result.get("missed_actionables", []))
            if missed_count > 0:
                logger.info("  Validation added %d missed actionables", missed_count)

            return all_validated

        except Exception as e:
            logger.error("Validation failed: %s", str(e))
            # On failure, keep the unvalidated originals
            for item in actionables:
                item.validation_status = "validation_failed"
            return actionables
