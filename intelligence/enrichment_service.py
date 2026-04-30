"""
Enrichment & classification service.

Given the raw `ActionableItem` list produced by the existing
`agents.actionable_extractor.ActionableExtractor`, produce:

  * EnrichedActionable list   — items that are genuine, execution-ready actionables
  * NoticeItem list           — informational / contextual / advisory content

In a single LLM pass per batch, the model derives structured
semantic fields from the candidate. The prompt is semantic-first —
priority, risk, and deadline are judged from meaning and consequence,
not from the presence of specific words.

The model:
  - confirms kind (actionable vs notice) as a final sanity check
  - rewrites the description into an execution-ready sentence
  - derives deadline (ISO date) and raw phrase from source meaning
  - assigns priority (High/Medium/Low) from expectation strength,
    time pressure, and consequence of failure
  - assigns risk_score 1..5 from magnitude of non-compliance impact
  - assigns a category from the user-defined list

NOTE: The regex-based heuristics below (`_MUST_KEYWORDS`, `_SHOULD_KEYWORDS`,
deadline patterns) exist ONLY as a last-resort resilience fallback for
when the LLM call itself fails. They are NOT part of the primary
semantic path and must not be expanded into the main flow.
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


# version: v2 — semantic-first refactor (no keyword-trigger priority logic).
# Original prompt preserved at intelligence/_original_prompts.py
# (ORIGINAL_PROMPT_ENRICHMENT).
SYSTEM_PROMPT = """You are the enrichment stage of a compliance-intelligence pipeline.

SINGLE RESPONSIBILITY:
Given candidate actionables already identified by the extraction layer
and audited by the validation layer, derive a set of structured
semantic fields that downstream stages (grouping, team mapping,
dashboards) can rely on. You DO NOT re-read raw documents. You DO NOT
extract new actionables. You DO NOT assign teams, departments, or
owners.

CORE PRINCIPLE — SEMANTIC INTERPRETATION (NON-NEGOTIABLE):
Decide every output field by interpreting the MEANING of each
candidate in its context. Do not rely on the presence or absence of
any specific words or phrases. A candidate may carry a strong,
binding expectation through indirect phrasing; a candidate may use
forceful-sounding phrasing while expressing only context. Judge by
intent and consequence, not by surface vocabulary.

INPUTS YOU WILL RECEIVE:
  * CATEGORIES — a fixed, user-defined list of category names with
    descriptions. You must select from this list (or "Uncategorized").
    Do NOT invent categories.
  * DOCUMENT_EFFECTIVE_DATE — the document-level execution date
    (may be empty).
  * INPUTS — pre-extracted candidate actionables, each carrying its
    structured fields and an evidence quote.

FIELDS YOU MUST DERIVE (per candidate):

A. kind ∈ {"actionable","notice"}
   - "actionable" — the candidate, in meaning, requires the entity to
     execute, refrain from, monitor, report, or remain aware of a step.
   - "notice" — the candidate is informational, contextual,
     definitional, or advisory in meaning, with no executable step.
   This is a sanity check; most candidates will be "actionable" because
   the upstream layers have already filtered raw text.

B. description (only when kind == "actionable")
   Rewrite the candidate as a single, imperative, execution-ready
   sentence (≤30 words). No citations, no hedging, no editorial.

C. priority ∈ {"High","Medium","Low"} (only when actionable)
   Judge priority by the COMBINED weight of three semantic signals,
   none of which depend on specific words:
     - Strength of the expectation in meaning: is it binding,
       conditional, or merely encouraged?
     - Time pressure conveyed by the source: near-term horizon,
       medium horizon, long horizon, or no specific horizon?
     - Consequence of failure: would non-compliance, in context,
       expose the entity to material legal, financial, customer, or
       reputational harm — or only minor process drift?
   Map roughly:
     High   — binding expectation, or near-term horizon, or
              significant exposure on failure (any one is usually
              enough on its own).
     Medium — moderate expectation, mid horizon, or meaningful but
              bounded exposure.
     Low    — softly framed expectation, distant or absent horizon,
              and limited exposure.

D. deadline (ISO "YYYY-MM-DD" or "Not Specified")
   - Use an explicit ISO date if the source supplies one in meaning.
   - If the source supplies a relative interval anchored to an event
     that is unambiguously present in the source, derive an ISO date.
     Otherwise leave the ISO empty and capture the phrase in
     `deadline_phrase`.
   - If no specific deadline can be derived from the source AND
     DOCUMENT_EFFECTIVE_DATE is provided, fall back to that date as
     the entity's expected execution date.
   - Otherwise "Not Specified".

E. deadline_phrase
   Verbatim natural-language fragment from the source describing the
   timing, or "" if none.

F. deadline_reasoning
   One sentence describing how `deadline` was derived. Examples:
     "Explicit ISO date in source: 2025-03-31."
     "Relative interval anchored to a stated event in the source."
     "No specific deadline in source; defaulted to document effective date YYYY-MM-DD."
     "No deadline could be derived."

G. risk_score ∈ 1..5 (only when actionable)
   Score by the magnitude of consequence if the entity does NOT
   comply, considering legal, financial, operational, and customer
   impact together. Judge from meaning; do not key off vocabulary:
     1 — minimal consequence; informational drift, easily corrected.
     2 — minor consequence; limited operational rework, low scrutiny.
     3 — moderate consequence; meaningful audit or process exposure.
     4 — significant consequence; regulatory action, fines, or
         material operational disruption likely.
     5 — severe consequence; license / charter risk, large penalties,
         systemic operational failure, or material customer harm.

H. category (only when actionable)
   - Choose EXACTLY ONE category name from the CATEGORIES list whose
     description, in meaning, best matches the responsibility.
   - If multiple categories appear equally relevant, choose the one
     that most directly reflects the primary execution domain of the
     responsibility.
   - If, on a careful reading, no category in the list reflects the
     responsibility, return "Uncategorized".

I. text + tag (only when kind == "notice")
   - text: a single-line summary of the informational content.
   - tag ∈ {"Informational","Contextual","Advisory"}.

CONSISTENCY EXPECTATIONS:
- A near-term horizon almost always implies High priority unless the
  consequence of failure is clearly low.
- A binding, high-consequence responsibility almost always implies
  risk_score ≥ 4 unless the source explicitly limits scope.
- Maintain input order: emit one output per input_id, in the same
  order as INPUTS. Do NOT drop, merge, or duplicate inputs.

OUTPUT (STRICT JSON — no extra fields, no commentary):
{
  "items": [
    {
      "input_id": "<id from input>",
      "kind": "actionable",
      "description": "...",
      "priority": "High|Medium|Low",
      "deadline": "YYYY-MM-DD|Not Specified",
      "deadline_phrase": "...",
      "deadline_reasoning": "...",
      "risk_score": 1,
      "category": "<one of the provided category names, or 'Uncategorized'>"
    },
    {
      "input_id": "<id from input>",
      "kind": "notice",
      "text": "...",
      "tag": "Informational|Contextual|Advisory"
    }
  ]
}

Do NOT invent inputs. Do NOT drop inputs. Do NOT invent categories.
Do NOT assign teams or owners — that is handled by a separate stage."""


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
        elif heur_iso:
            iso = heur_iso
        elif heur_phrase:
            iso = ""
        else:
            iso = ""
        phrase = (row.get("deadline_phrase") or heur_phrase or "").strip()

        # Section 7: fallback to document-level execution/implementation date
        if not iso and doc_effective_date and _ISO_DATE_PAT.fullmatch(doc_effective_date):
            iso = doc_effective_date

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
            team_specific_tasks=[],
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
        if not iso and doc_effective_date and _ISO_DATE_PAT.fullmatch(doc_effective_date):
            iso = doc_effective_date

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
            team_specific_tasks=[],
            notes="",
        )
