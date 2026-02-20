"""
Corpus QA Engine for GOVINDA V2 — Cross-Document Question Answering.

Top-level orchestrator for queries that span multiple documents:
  1. Load corpus graph
  2. Select relevant documents (Stage 1)
  3. Per-document retrieval (Stage 2)
  4. Cross-document synthesis with per-document citations
  5. Verify answer against multi-document sources

This parallels QAEngine but operates on the corpus level.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.corpus import Corpus, CorpusRetrievalResult
from models.query import (
    Answer,
    Citation,
    InferredPoint,
    Query,
    QueryType,
    RetrievedSection,
)
from retrieval.corpus_router import CorpusRouter
from agents.verifier import Verifier
from tree.corpus_store import CorpusStore
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class CorpusQAEngine:
    """
    End-to-end cross-document question answering over the corpus.

    Pipeline:
    1. Load corpus graph
    2. CorpusRouter: select documents → per-doc retrieval
    3. Synthesize answer with multi-document citations
    4. Verify answer
    5. Return complete Answer with metadata
    """

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()
        self._corpus_store = CorpusStore()
        self._corpus_router = CorpusRouter(self._llm)
        self._verifier = Verifier(self._llm)

    # ------------------------------------------------------------------
    # Phase 1 — Retrieval (corpus-level)
    # ------------------------------------------------------------------

    def retrieve(
        self,
        query_text: str,
    ) -> CorpusRetrievalResult:
        """
        Phase 1: Load corpus, select documents, retrieve from each.

        Returns a CorpusRetrievalResult that can be displayed immediately.
        """
        self._llm.reset_usage()

        # Load corpus
        corpus = self._corpus_store.load_or_create()
        if not corpus.documents:
            logger.warning("No documents in corpus — cannot answer")
            return CorpusRetrievalResult(
                query_text=query_text,
                start_time=time.time(),
            )

        logger.info(
            "[CorpusQA] Querying across %d documents, %d relationships",
            len(corpus.documents),
            len(corpus.relationships),
        )

        # Run corpus retrieval
        result = self._corpus_router.retrieve(query_text, corpus)
        return result

    # ------------------------------------------------------------------
    # Phase 2 — Synthesis + Verification
    # ------------------------------------------------------------------

    def synthesize_and_verify(
        self,
        rr: CorpusRetrievalResult,
        verify: bool = True,
    ) -> Answer:
        """
        Phase 2: Synthesize cross-document answer and verify.
        """
        timings = dict(rr.timings)
        sections = rr.all_sections

        if not sections:
            return Answer(
                text="No relevant sections were found across any documents to answer this query.",
                query_type=QueryType(rr.query_type)
                if rr.query_type
                else QueryType.SINGLE_HOP,
            )

        # Step 1: Synthesis
        logger.info(
            "[CorpusQA] Synthesizing cross-document answer from %d sections...",
            len(sections),
        )
        t0 = time.time()
        answer = self._synthesize_corpus(rr)
        timings["4_corpus_synthesis"] = time.time() - t0
        logger.info("  -> Synthesis complete (%.1fs)", timings["4_corpus_synthesis"])

        # Attach retrieval metadata
        answer.retrieved_sections = sections

        # Step 2: Verify
        t0 = time.time()
        if verify:
            logger.info("[CorpusQA] Verifying answer...")
            answer = self._verifier.verify(answer, query_text=rr.query_text)
        else:
            answer.verification_status = "skipped"
        timings["5_verification"] = time.time() - t0

        # Finalize metrics
        elapsed = time.time() - rr.start_time
        usage = self._llm.get_usage_summary()
        answer.total_time_seconds = elapsed
        answer.total_tokens = usage["total_tokens"]
        answer.llm_calls = usage["total_calls"]
        answer.stage_timings = timings

        logger.info(
            "[CorpusQA] Complete: %s, %d citations, %.1fs, %d LLM calls, %d tokens",
            answer.verification_status,
            len(answer.citations),
            elapsed,
            answer.llm_calls,
            answer.total_tokens,
        )

        return answer

    # ------------------------------------------------------------------
    # Convenience wrapper
    # ------------------------------------------------------------------

    def ask(
        self,
        query_text: str,
        verify: bool = True,
    ) -> Answer:
        """Ask a question across all documents (retrieve + synthesize)."""
        rr = self.retrieve(query_text)
        return self.synthesize_and_verify(rr, verify=verify)

    # ------------------------------------------------------------------
    # Internal: Cross-document synthesis
    # ------------------------------------------------------------------

    def _synthesize_corpus(self, rr: CorpusRetrievalResult) -> Answer:
        """
        Generate an answer from sections spanning multiple documents.

        Uses the corpus_synthesis prompt which handles per-document attribution.
        """
        prompt_data = load_prompt("answering", "corpus_synthesis")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]

        # Format sections with document attribution
        retrieved_text = self._format_multi_doc_sections(rr.all_sections)

        user_msg = format_prompt(
            user_template,
            query_text=rr.query_text,
            retrieved_text=retrieved_text,
        )

        try:
            # Adaptive reasoning effort
            effort = "high"  # Cross-doc queries are always complex

            result, was_truncated = self._llm.chat_json_with_status(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model_pro,
                max_tokens=self._settings.llm.max_tokens_long,
                reasoning_effort=effort,
            )

            answer_text = result.get("answer_text", "")
            if not answer_text:
                answer_text = result.get("answer", result.get("text", str(result)))

            # Handle truncation with continuation
            if was_truncated or self._is_truncated(answer_text):
                answer_text = self._handle_truncation(
                    answer_text, system_prompt, user_msg
                )

            # Parse citations with doc_id/doc_name
            citations = self._parse_corpus_citations(result, rr)

            # Parse inferred points
            inferred_points = self._parse_inferred_points(result)

            query_type = QueryType.GLOBAL  # Cross-doc is always global-level

            return Answer(
                text=answer_text,
                citations=citations,
                inferred_points=inferred_points,
                query_type=query_type,
            )

        except Exception as e:
            logger.error("Corpus synthesis failed: %s", str(e))
            return Answer(
                text=f"Error generating cross-document answer: {str(e)}",
                query_type=QueryType.GLOBAL,
            )

    def _format_multi_doc_sections(self, sections: list[RetrievedSection]) -> str:
        """
        Format sections from multiple documents with clear document attribution.

        Groups sections by document so the LLM can see which doc each comes from.
        """
        # Group by doc
        by_doc: dict[str, list[RetrievedSection]] = {}
        doc_names: dict[str, str] = {}

        for s in sections:
            doc_id = getattr(s, "_doc_id", "unknown")
            doc_name = getattr(s, "_doc_name", doc_id)
            if doc_id not in by_doc:
                by_doc[doc_id] = []
                doc_names[doc_id] = doc_name
            by_doc[doc_id].append(s)

        parts = []
        for doc_id, doc_sections in by_doc.items():
            doc_name = doc_names.get(doc_id, doc_id)
            parts.append(f"{'=' * 60}")
            parts.append(f"DOCUMENT: {doc_name} (doc_id: {doc_id})")
            parts.append(f"{'=' * 60}")

            for s in doc_sections:
                header = f"--- {s.title} ({s.page_range}) [id:{s.node_id}] ---"
                parts.append(f"{header}\n{s.text}")

            parts.append("")  # Blank line between docs

        return "\n\n".join(parts)

    def _parse_corpus_citations(
        self, result: dict, rr: CorpusRetrievalResult
    ) -> list[Citation]:
        """Parse citations from LLM result, enriching with doc_id/doc_name."""
        citations = []

        # Build a lookup from node_id to (doc_id, doc_name, page_range)
        node_doc_map: dict[str, dict] = {}
        for s in rr.all_sections:
            doc_id = getattr(s, "_doc_id", "")
            doc_name = getattr(s, "_doc_name", "")
            node_doc_map[s.node_id] = {
                "doc_id": doc_id,
                "doc_name": doc_name,
                "page_range": s.page_range,
            }

        for c in result.get("citations", []):
            node_id = c.get("node_id", "")
            doc_info = node_doc_map.get(node_id, {})

            # The LLM might include doc_id directly
            doc_id = c.get("doc_id", doc_info.get("doc_id", ""))
            doc_name = c.get("doc_name", doc_info.get("doc_name", ""))
            page_range = doc_info.get("page_range", "")

            citations.append(
                Citation(
                    citation_id=c.get("citation_id", f"[{node_id}]"),
                    node_id=node_id,
                    title=c.get("title", ""),
                    page_range=page_range,
                    excerpt=c.get("excerpt", ""),
                    # Store doc info as extra attributes
                )
            )
            # Attach doc info to the citation object
            citations[-1]._doc_id = doc_id  # type: ignore[attr-defined]
            citations[-1]._doc_name = doc_name  # type: ignore[attr-defined]

        return citations

    def _parse_inferred_points(self, result: dict) -> list[InferredPoint]:
        """Parse inferred points from LLM result."""
        inferred_points = []
        for ip in result.get("inferred_points", []):
            if not ip.get("point"):
                continue
            confidence = str(ip.get("confidence", "medium"))
            if confidence not in ("high", "medium", "low"):
                confidence = "medium"
            raw_defs = ip.get("supporting_definitions", [])
            if isinstance(raw_defs, str):
                raw_defs = [raw_defs]
            raw_secs = ip.get("supporting_sections", [])
            if isinstance(raw_secs, str):
                raw_secs = [raw_secs]
            inferred_points.append(
                InferredPoint(
                    point=str(ip["point"]),
                    supporting_definitions=[str(d) for d in raw_defs if d],
                    supporting_sections=[str(s) for s in raw_secs if s],
                    reasoning=str(ip.get("reasoning", "")),
                    confidence=confidence,
                )
            )
        return inferred_points

    @staticmethod
    def _is_truncated(text: str) -> bool:
        """Check if text appears to end mid-sentence."""
        stripped = text.rstrip()
        if not stripped:
            return False
        valid_endings = {".", ")", ":", '"', "]", "!", "?", "*", "-"}
        return stripped[-1] not in valid_endings

    def _handle_truncation(
        self,
        answer_text: str,
        system_prompt: str,
        user_msg: str,
    ) -> str:
        """Simple truncation continuation (one round)."""
        logger.warning("Corpus answer truncated, attempting continuation...")
        tail = answer_text[-500:]
        continuation_prompt = (
            "The previous answer was cut off. Here is the tail end:\n\n"
            f"...{tail}\n\n"
            "Continue from EXACTLY where it was cut off. "
            "Maintain the same [DocName | Section Title, p.XX] citation format. "
            "Return JSON with key: answer_continuation (string)."
        )
        try:
            cont_result, _ = self._llm.chat_json_with_status(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                    {"role": "assistant", "content": answer_text},
                    {"role": "user", "content": continuation_prompt},
                ],
                model=self._settings.llm.model_pro,
                max_tokens=self._settings.llm.max_tokens_long,
                reasoning_effort="medium",
            )
            continuation = cont_result.get(
                "answer_continuation",
                cont_result.get("answer_text", ""),
            )
            if continuation:
                answer_text = answer_text.rstrip() + " " + continuation.lstrip()
        except Exception as e:
            logger.error("Truncation continuation failed: %s", str(e))

        return answer_text
