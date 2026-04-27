"""
Enrichment & classification service.

Given the raw `ActionableItem` list produced by the existing
`agents.actionable_extractor.ActionableExtractor`, produce:

  * EnrichedActionable list   — items that are genuine, execution-ready actionables
  * NoticeItem list           — informational / contextual / advisory content

In a single LLM pass per batch, the model:
  - rewrites the description for clarity and execution
  - decides actionable vs notice
  - extracts deadline (ISO date) & raw phrase
  - assigns priority (High/Medium/Low) using regulatory keywords + deadlines + risk
  - assigns compliance risk score 1..5
  - assigns a functional category
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from models.actionable import ActionableItem
from models.document import DocumentTree
from utils.llm_client import LLMClient
from config.settings import get_settings

from intelligence.models import (
    DEFAULT_CATEGORY,
    EnrichedActionable,
    IntelCategory,
    NoticeItem,
)

logger = logging.getLogger(__name__)


_MUST_KEYWORDS = re.compile(
    r"\b(?:must|shall|mandatory|required|obligation|obligated|prohibited|forbidden)\b",
    re.IGNORECASE,
)
_SHOULD_KEYWORDS = re.compile(
    r"\b(?:should|recommended|expected|endeavou?r|ensure)\b",
    re.IGNORECASE,
)
_WITHIN_PAT = re.compile(
    r"within\s+(\d+)\s+(day|days|working\s+day|working\s+days|week|weeks|month|months|year|years)",
    re.IGNORECASE,
)
_ISO_DATE_PAT = re.compile(r"\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b")
_DATE_PHRASE_PAT = re.compile(
    r"\b(?:on or before|no later than|by)\s+([A-Za-z0-9 ,\-/]+?\b\d{4})\b",
    re.IGNORECASE,
)


def _heuristic_deadline(text: str) -> tuple[str, str, Optional[str]]:
    """
    Quick, deterministic deadline hints fed to the LLM as a prior.
    Returns (iso_date_or_empty, raw_phrase, bucket_hint).
    bucket_hint ∈ {"Immediate","Short-term","Long-term", None}
    """
    if not text:
        return "", "", None

    m = _WITHIN_PAT.search(text)
    if m:
        n = int(m.group(1))
        unit = m.group(2).lower()
        phrase = m.group(0)
        if "day" in unit:
            days = n
        elif "week" in unit:
            days = n * 7
        elif "month" in unit:
            days = n * 30
        else:
            days = n * 365
        bucket = (
            "Immediate" if days <= 30 else
            "Short-term" if days <= 180 else
            "Long-term"
        )
        return "", phrase, bucket

    m = _ISO_DATE_PAT.search(text)
    if m:
        return m.group(0), m.group(0), None

    m = _DATE_PHRASE_PAT.search(text)
    if m:
        return "", m.group(0), None

    return "", "", None


def _clamp_risk(v) -> int:
    try:
        x = int(v)
    except (TypeError, ValueError):
        return 3
    return max(1, min(5, x))


def _norm_priority(p: str, modality: str, deadline_bucket: Optional[str]) -> str:
    p = (p or "").strip().title()
    if p in ("High", "Medium", "Low"):
        base = p
    elif modality == "mandatory" or deadline_bucket == "Immediate":
        base = "High"
    elif modality == "prohibited":
        base = "High"
    elif modality == "recommended":
        base = "Low"
    else:
        base = "Medium"
    return base


def _norm_category(c: str, allowed_names: list[str]) -> str:
    """Validate `c` against the user-defined category list. Falls back to
    `DEFAULT_CATEGORY` when unrecognized or no roster is configured."""
    c = (c or "").strip()
    if not c:
        return DEFAULT_CATEGORY
    if not allowed_names:
        # No user-defined roster yet — keep whatever the LLM produced so users
        # can re-classify after defining categories. Treat empty as default.
        return c or DEFAULT_CATEGORY
    # exact match
    if c in allowed_names:
        return c
    # case-insensitive match
    lc = c.lower()
    for name in allowed_names:
        if name.lower() == lc:
            return name
    return DEFAULT_CATEGORY


def _timeline_bucket_from_deadline(iso_date: str, hint: Optional[str]) -> str:
    if hint in ("Immediate", "Short-term", "Long-term"):
        return hint
    if iso_date:
        try:
            d = datetime.fromisoformat(iso_date).replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            delta = (d - now).days
            if delta <= 30:
                return "Immediate"
            if delta <= 180:
                return "Short-term"
            return "Long-term"
        except ValueError:
            return "Not Specified"
    return "Not Specified"


SYSTEM_PROMPT = """You are a compliance-intelligence enricher for financial-sector regulatory circulars.

You will receive:
  * CATEGORIES — a user-defined list of categories (name + description). The category set is fixed; do NOT invent new categories.
  * DOCUMENT_EFFECTIVE_DATE — the document-level execution / implementation date (may be empty).
  * INPUTS — candidate actionables to enrich.

For EACH candidate you must:

1. Decide `kind`:
   - "actionable": expresses a concrete obligation, prohibition, or required step someone in the regulated entity must execute.
   - "notice": informational, contextual, definitional, or advisory — no execution step.

2. If `kind == "actionable"`:
   a. Rewrite `description` as a crisp, imperative, execution-ready sentence (≤30 words). No citations, no hedging.
   b. `priority` ∈ {"High","Medium","Low"} based on regulatory keywords (must/shall/mandatory → higher), tight deadlines, and risk impact.
   c. `deadline`: ISO date "YYYY-MM-DD" if explicit in the source. If no specific deadline is found AND DOCUMENT_EFFECTIVE_DATE is provided, you MAY use that as a default fallback. Otherwise "Not Specified".
   d. `deadline_phrase`: raw natural-language phrase from the source (e.g. "within 30 days", "by 31 March 2025"), or "" if none.
   e. `deadline_reasoning`: ONE sentence explaining how `deadline` was derived. Examples:
        - "Explicit ISO date in source: 2025-03-31."
        - "'within 30 days' from issue date."
        - "No specific deadline; defaulted to document effective date YYYY-MM-DD."
        - "No deadline could be derived."
   f. `risk_score` ∈ 1..5 (1=trivial, 5=severe legal/financial/operational exposure).
   g. `category`: choose EXACTLY ONE name from the CATEGORIES list whose description best matches the actionable. If none clearly match, return "Uncategorized".

3. If `kind == "notice"`:
   a. `tag` ∈ {"Informational","Contextual","Advisory"}.
   b. `text`: one-line summary.

Return STRICT JSON:
{
  "items": [
    {
      "input_id": "<id from input>",
      "kind": "actionable" | "notice",
      "description": "...",
      "priority": "High|Medium|Low",
      "deadline": "YYYY-MM-DD|Not Specified",
      "deadline_phrase": "...",
      "deadline_reasoning": "...",
      "risk_score": 1-5,
      "category": "<one of the provided category names, or 'Uncategorized'>",
      "text": "...",
      "tag": "Informational|Contextual|Advisory"
    }
  ]
}

Do NOT invent inputs. Do NOT drop inputs. Do NOT invent categories."""


NO_CATS_NOTE = '(none defined — use "Uncategorized")'


class IntelligenceEnricher:
    """Classifies + enriches raw actionables in batches."""

    BATCH_SIZE = 15  # items per LLM call

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()

    def enrich(
        self,
        raw_actionables: list[ActionableItem],
        tree: DocumentTree,
        categories: Optional[list[IntelCategory]] = None,
        doc_effective_date: str = "",
    ) -> tuple[list[EnrichedActionable], list[NoticeItem]]:
        if not raw_actionables:
            return [], []

        categories = list(categories or [])
        enriched: list[EnrichedActionable] = []
        notices: list[NoticeItem] = []

        for start in range(0, len(raw_actionables), self.BATCH_SIZE):
            batch = raw_actionables[start : start + self.BATCH_SIZE]
            try:
                batch_enriched, batch_notices = self._enrich_batch(
                    batch, tree, categories, doc_effective_date,
                )
            except Exception as e:
                logger.error("Enrichment batch failed: %s", e)
                # graceful fallback: treat all as actionables with heuristics only
                batch_enriched = [
                    self._heuristic_enrich(item, doc_effective_date) for item in batch
                ]
                batch_notices = []
            enriched.extend(batch_enriched)
            notices.extend(batch_notices)

        return enriched, notices

    # ------------------------------------------------------------------
    @staticmethod
    def _action_statement(it: ActionableItem) -> str:
        parts = [
            (it.actor or "").strip(),
            (getattr(it, "action", "") or "").strip(),
            (getattr(it, "object", "") or "").strip(),
        ]
        stmt = " ".join(p for p in parts if p)
        if not stmt:
            stmt = (it.evidence_quote or "").strip()
        return stmt[:400]

    @staticmethod
    def _deadline_source(it: ActionableItem) -> str:
        chunks = [
            getattr(it, "deadline_or_frequency", "") or "",
            getattr(it, "effective_date", "") or "",
            getattr(it, "deadline", "") or "",
        ]
        return " ".join(c for c in chunks if c)[:300]

    def _input_payload(self, items: list[ActionableItem]) -> list[dict]:
        payload: list[dict] = []
        for i, it in enumerate(items):
            raw_text = (it.evidence_quote or "")[:600]
            stmt = self._action_statement(it)
            deadline_text = self._deadline_source(it)
            payload.append({
                "input_id": it.id or f"IN-{i:03d}",
                "modality": it.modality or "",
                "actor": it.actor or "",
                "action_statement": stmt,
                "evidence_quote": raw_text,
                "deadline_text": deadline_text,
                "source_location": it.source_location or "",
                "workstream": getattr(it, "workstream", "") or "",
            })
        return payload

    def _enrich_batch(
        self,
        items: list[ActionableItem],
        tree: DocumentTree,
        categories: list[IntelCategory],
        doc_effective_date: str,
    ) -> tuple[list[EnrichedActionable], list[NoticeItem]]:
        payload = self._input_payload(items)
        category_payload = [
            {"name": c.name, "description": c.description or ""} for c in categories
        ]
        user_msg = (
            f"DOCUMENT: {tree.doc_name}\n"
            f"DOCUMENT_EFFECTIVE_DATE: {doc_effective_date or '(not provided)'}\n\n"
            f"CATEGORIES:\n{(json.dumps(category_payload, indent=2) if category_payload else NO_CATS_NOTE)}\n\n"
            f"Enrich the following {len(payload)} candidate actionables. "
            f"Return one output entry per input_id in the same order.\n\n"
            f"INPUTS:\n{json.dumps(payload, indent=2)}"
        )
        try:
            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model,
                max_tokens=self._settings.llm.max_tokens_long,
                reasoning_effort="low",
            )
        except Exception as e:
            logger.warning("LLM enrichment failed: %s — falling back to heuristics", e)
            return [self._heuristic_enrich(it, doc_effective_date) for it in items], []

        rows = result.get("items", []) if isinstance(result, dict) else []
        by_id: dict[str, dict] = {}
        for row in rows:
            key = str(row.get("input_id", "")).strip()
            if key:
                by_id[key] = row

        category_names = [c.name for c in categories]
        enriched: list[EnrichedActionable] = []
        notices: list[NoticeItem] = []
        for it in items:
            row = by_id.get(it.id or "", {})
            kind = (row.get("kind") or "actionable").lower()
            if kind == "notice":
                notices.append(NoticeItem(
                    id=f"N-{uuid.uuid4().hex[:8].upper()}",
                    text=(row.get("text") or self._action_statement(it) or it.evidence_quote or "")[:500],
                    source=it.source_location or "",
                    source_node_id=it.source_node_id or "",
                    tag=row.get("tag", "Informational"),
                ))
                continue
            enriched.append(
                self._merge_enriched(it, row, category_names, doc_effective_date)
            )

        return enriched, notices

    def _merge_enriched(
        self,
        it: ActionableItem,
        row: dict,
        category_names: list[str],
        doc_effective_date: str,
    ) -> EnrichedActionable:
        stmt = self._action_statement(it)
        raw_text = it.evidence_quote or stmt or ""
        heur_iso, heur_phrase, bucket_hint = _heuristic_deadline(
            self._deadline_source(it) + " " + raw_text
        )

        llm_deadline = (row.get("deadline") or "").strip()
        if llm_deadline and llm_deadline.lower() != "not specified" and _ISO_DATE_PAT.fullmatch(llm_deadline):
            iso = llm_deadline
            reasoning_default = f"Explicit deadline in source: {iso}."
        elif heur_iso:
            iso = heur_iso
            reasoning_default = f"Extracted from source text ({heur_phrase or heur_iso})."
        elif heur_phrase:
            iso = ""
            reasoning_default = f"Phrase '{heur_phrase}' detected; no explicit ISO date."
        else:
            iso = ""
            reasoning_default = ""
        phrase = (row.get("deadline_phrase") or heur_phrase or "").strip()

        # Section 7: fallback to document-level execution/implementation date
        used_doc_fallback = False
        if not iso and doc_effective_date and _ISO_DATE_PAT.fullmatch(doc_effective_date):
            iso = doc_effective_date
            used_doc_fallback = True
            reasoning_default = (
                f"No specific deadline in source; defaulted to document effective date {iso}."
            )

        priority = _norm_priority(
            row.get("priority", ""),
            (it.modality or "").lower(),
            bucket_hint,
        )
        risk = _clamp_risk(row.get("risk_score", 3))
        category = _norm_category(row.get("category", ""), category_names)
        description = (row.get("description") or stmt or raw_text or "").strip()
        if len(description) > 600:
            description = description[:600].rstrip() + "…"

        bucket = _timeline_bucket_from_deadline(iso, bucket_hint)

        # Prefer LLM-supplied reasoning; otherwise use derived default.
        reasoning = (row.get("deadline_reasoning") or "").strip() or reasoning_default
        if used_doc_fallback and "effective date" not in reasoning.lower():
            reasoning = (
                f"No specific deadline in source; defaulted to document effective date {iso}."
            )

        return EnrichedActionable(
            id=f"A-{uuid.uuid4().hex[:8].upper()}",
            description=description,
            source=it.source_location or "",
            source_node_id=it.source_node_id or "",
            original_text=raw_text[:1000],
            priority=priority,
            deadline=iso or "Not Specified",
            deadline_phrase=phrase,
            risk_score=risk,
            category=category,
            timeline_bucket=bucket,
            assigned_teams=[],
            assigned_team_names=[],
            deadline_reasoning=reasoning,
            notes="",
        )

    def _heuristic_enrich(
        self,
        it: ActionableItem,
        doc_effective_date: str = "",
    ) -> EnrichedActionable:
        """Pure-regex fallback used when the LLM call fails."""
        stmt = self._action_statement(it)
        raw_text = it.evidence_quote or stmt or ""
        heur_iso, heur_phrase, bucket_hint = _heuristic_deadline(
            self._deadline_source(it) + " " + raw_text
        )
        modality = (it.modality or "").lower()
        if _MUST_KEYWORDS.search(raw_text) or modality in ("mandatory", "prohibited"):
            priority, risk = "High", 4
        elif _SHOULD_KEYWORDS.search(raw_text) or modality == "recommended":
            priority, risk = "Low", 2
        else:
            priority, risk = "Medium", 3

        iso = heur_iso
        reasoning = ""
        if iso:
            reasoning = f"Extracted from source text ({heur_phrase or iso})."
        elif heur_phrase:
            reasoning = f"Phrase '{heur_phrase}' detected; no explicit ISO date."
        if not iso and doc_effective_date and _ISO_DATE_PAT.fullmatch(doc_effective_date):
            iso = doc_effective_date
            reasoning = (
                f"No specific deadline in source; defaulted to document effective date {iso}."
            )

        bucket = _timeline_bucket_from_deadline(iso, bucket_hint)
        description = (stmt or raw_text or "").strip()[:500]
        return EnrichedActionable(
            id=f"A-{uuid.uuid4().hex[:8].upper()}",
            description=description,
            source=it.source_location or "",
            source_node_id=it.source_node_id or "",
            original_text=raw_text[:1000],
            priority=priority,
            deadline=iso or "Not Specified",
            deadline_phrase=heur_phrase,
            risk_score=risk,
            category=DEFAULT_CATEGORY,
            timeline_bucket=bucket,
            deadline_reasoning=reasoning,
        )
