"""
Corpus Router for GOVINDA V2 — Cross-Document Retrieval.

Two-stage retrieval pipeline:
  Stage 1: Document Selection — LLM sees corpus index + relationship graph,
           selects 1-5 relevant documents.
  Stage 2: Per-Document Node Location — For each selected doc, runs the
           existing StructuralRouter pipeline (classify, locate, read, etc.)

This is the retrieval entry point for cross-document Q&A.
"""

from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.corpus import Corpus, CorpusRetrievalResult
from models.document import DocumentTree
from models.query import RetrievedSection, RoutingLog
from retrieval.router import StructuralRouter
from tree.tree_store import TreeStore
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class CorpusRouter:
    """
    Two-stage cross-document retrieval: select docs → per-doc retrieval.
    """

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()
        self._tree_store = TreeStore()
        self._per_doc_router = StructuralRouter(self._llm)

        # Cache loaded trees
        self._trees: dict[str, DocumentTree] = {}

    def _load_tree(self, doc_id: str) -> Optional[DocumentTree]:
        """Load a document tree by ID (cached)."""
        if doc_id in self._trees:
            return self._trees[doc_id]
        tree = self._tree_store.load(doc_id)
        if tree:
            self._trees[doc_id] = tree
        return tree

    def retrieve(
        self,
        query_text: str,
        corpus: Corpus,
    ) -> CorpusRetrievalResult:
        """
        Full cross-document retrieval pipeline.

        Args:
            query_text: The user's query string.
            corpus: The corpus graph with all documents and relationships.

        Returns:
            CorpusRetrievalResult with sections from multiple documents.
        """
        start = time.time()
        timings: dict[str, float] = {}

        result = CorpusRetrievalResult(
            query_text=query_text,
            start_time=start,
        )

        if not corpus.documents:
            logger.warning("Empty corpus — no documents to search")
            return result

        # =============================================================
        # Stage 1: Document Selection
        # =============================================================
        logger.info(
            "[Corpus 1/3] Selecting relevant documents from %d in corpus...",
            len(corpus.documents),
        )
        t0 = time.time()

        selected = self._select_documents(query_text, corpus)
        timings["1_document_selection"] = time.time() - t0

        result.selected_documents = selected

        if not selected:
            logger.warning("No documents selected for query: %s", query_text[:80])
            result.timings = timings
            return result

        doc_ids = [s["doc_id"] for s in selected]
        logger.info(
            "  -> Selected %d documents: %s (%.1fs)",
            len(selected),
            ", ".join(s.get("doc_name", s["doc_id"])[:30] for s in selected),
            timings["1_document_selection"],
        )

        # =============================================================
        # Stage 2: Per-Document Node Retrieval (parallel)
        # =============================================================
        logger.info("[Corpus 2/3] Retrieving from %d documents...", len(doc_ids))
        t0 = time.time()

        sections_by_doc: dict[str, list[RetrievedSection]] = {}
        per_doc_routing_logs: dict[str, dict] = {}
        all_sections: list[RetrievedSection] = []

        # Retrieve from each document (sequentially to avoid LLM contention)
        for sel in selected:
            doc_id = sel["doc_id"]
            doc_name = sel.get("doc_name", doc_id)

            tree = self._load_tree(doc_id)
            if not tree:
                logger.warning("Could not load tree for %s — skipping", doc_id)
                continue

            logger.info("  -> Retrieving from '%s'...", doc_name[:40])
            try:
                query, sections, routing_log = self._per_doc_router.retrieve(
                    query_text, tree
                )

                # Tag each section with its source document
                for s in sections:
                    # Store doc info on the section for the synthesis prompt
                    s._doc_id = doc_id  # type: ignore[attr-defined]
                    s._doc_name = doc_name  # type: ignore[attr-defined]

                sections_by_doc[doc_id] = sections
                all_sections.extend(sections)

                # Capture first query classification for the result
                if not result.query_type:
                    result.query_type = query.query_type.value
                    result.sub_queries = query.sub_queries
                    result.key_terms = query.key_terms

                # Merge key terms from all docs
                for kt in query.key_terms:
                    if kt not in result.key_terms:
                        result.key_terms.append(kt)

                # Store per-doc routing log
                per_doc_routing_logs[doc_id] = {
                    "doc_name": doc_name,
                    "query_type": routing_log.query_type.value
                    if routing_log.query_type
                    else "unknown",
                    "nodes_located": routing_log.total_nodes_located,
                    "sections_read": routing_log.total_sections_read,
                    "tokens_retrieved": routing_log.total_tokens_retrieved,
                    "stage_timings": routing_log.stage_timings,
                    "locate_results": routing_log.locate_results,
                }

                logger.info(
                    "    -> %d sections, %d tokens from '%s'",
                    len(sections),
                    sum(s.token_count for s in sections),
                    doc_name[:30],
                )

            except Exception as e:
                logger.error("Retrieval failed for %s: %s", doc_id, str(e))
                continue

        timings["2_per_doc_retrieval"] = time.time() - t0

        # =============================================================
        # Stage 3: Merge and enforce token budget
        # =============================================================
        logger.info(
            "[Corpus 3/3] Merging sections from %d documents...", len(sections_by_doc)
        )
        t0 = time.time()

        budget = self._settings.retrieval.retrieval_token_budget
        total_tokens = sum(s.token_count for s in all_sections)

        if total_tokens > budget:
            # Trim sections from lowest-confidence documents first
            all_sections = self._trim_to_budget(all_sections, selected, budget)
            logger.info(
                "  -> Trimmed from %d to %d tokens (budget: %d)",
                total_tokens,
                sum(s.token_count for s in all_sections),
                budget,
            )

        timings["3_merge"] = time.time() - t0

        result.sections_by_doc = sections_by_doc
        result.all_sections = all_sections
        result.per_doc_routing_logs = per_doc_routing_logs
        result.timings = timings
        result.llm_usage_snapshot = self._llm.get_usage_summary()

        elapsed = time.time() - start
        logger.info(
            "Corpus retrieval complete: %d docs, %d total sections, %d tokens, %.1fs",
            len(sections_by_doc),
            len(all_sections),
            sum(s.token_count for s in all_sections),
            elapsed,
        )

        return result

    def _select_documents(self, query_text: str, corpus: Corpus) -> list[dict]:
        """
        Stage 1: LLM selects relevant documents from the corpus.

        Returns list of selected document dicts with doc_id, doc_name,
        relevance_reason, confidence, role.
        """
        corpus_index = corpus.to_index()
        corpus_index_json = json.dumps(corpus_index, indent=2)

        prompt_data = load_prompt("corpus", "document_selection")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        user_msg = format_prompt(
            user_template,
            query_text=query_text,
            corpus_index_json=corpus_index_json,
        )

        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model,
                max_tokens=self._settings.llm.max_tokens_default,
                reasoning_effort="medium",
            )

            selected = result.get("selected_documents", [])
            valid_doc_ids = {d.doc_id for d in corpus.documents}

            # Validate and enrich selected documents
            validated = []
            for sel in selected:
                doc_id = sel.get("doc_id", "")
                if doc_id not in valid_doc_ids:
                    logger.warning("LLM selected unknown doc_id: %s", doc_id)
                    continue

                # Ensure doc_name is populated
                corpus_doc = corpus.get_document(doc_id)
                if corpus_doc and not sel.get("doc_name"):
                    sel["doc_name"] = corpus_doc.doc_name

                validated.append(sel)

            # Cap at 5 documents
            return validated[:5]

        except Exception as e:
            logger.error("Document selection failed: %s", str(e))
            # Fallback: select all documents (up to 5)
            return [
                {
                    "doc_id": d.doc_id,
                    "doc_name": d.doc_name,
                    "relevance_reason": "Fallback — selection LLM failed",
                    "confidence": 0.5,
                    "role": "fallback",
                }
                for d in corpus.documents[:5]
            ]

    def _trim_to_budget(
        self,
        sections: list[RetrievedSection],
        selected: list[dict],
        budget: int,
    ) -> list[RetrievedSection]:
        """
        Trim sections to fit within token budget.

        Priority: sections from higher-confidence documents are kept first.
        Within a document, sections maintain their original order (by reader).
        """
        # Build confidence map
        doc_confidence = {}
        for sel in selected:
            doc_confidence[sel["doc_id"]] = sel.get("confidence", 0.5)

        # Sort: higher confidence first, then original order
        sections_with_priority = []
        for i, s in enumerate(sections):
            doc_id = getattr(s, "_doc_id", "")
            conf = doc_confidence.get(doc_id, 0.5)
            sections_with_priority.append((conf, i, s))

        sections_with_priority.sort(key=lambda x: (-x[0], x[1]))

        trimmed = []
        total = 0
        for _, _, s in sections_with_priority:
            if total + s.token_count <= budget:
                trimmed.append(s)
                total += s.token_count

        return trimmed
