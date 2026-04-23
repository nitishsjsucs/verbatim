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

from intelligence.models import EnrichedActionable, NoticeItem

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


def _norm_category(c: str) -> str:
    c = (c or "").strip()
    allowed = {
        "Compliance",
        "Risk",
        "Operations",
        "IT / Systems",
        "Reporting",
        "Customer Impact",
        "Other",
    }
    if c in allowed:
        return c
    lc = c.lower()
    if "it" in lc or "system" in lc or "technolog" in lc or "cyber" in lc:
        return "IT / Systems"
    if "report" in lc or "disclos" in lc or "filing" in lc:
        return "Reporting"
    if "customer" in lc or "consumer" in lc or "client" in lc:
        return "Customer Impact"
    if "risk" in lc:
        return "Risk"
    if "operation" in lc or "process" in lc:
        return "Operations"
    if "compliance" in lc or "regulator" in lc or "legal" in lc:
        return "Compliance"
    return "Other"


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

You will receive a list of candidate actionables extracted from a regulatory document. For EACH candidate you must:

1. Decide `kind`:
   - "actionable": the item expresses a concrete obligation, prohibition, or required step someone in the regulated entity must execute.
   - "notice": the item is informational, contextual, definitional, or advisory and does not require a specific execution step.

2. If `kind == "actionable"`:
   a. Rewrite `description` as a crisp, imperative, execution-ready sentence (max ~30 words). No citations. No hedging.
   b. Fill `priority` ∈ {"High","Medium","Low"} based on regulatory keywords (must/shall/mandatory → higher), deadlines (tight → higher), and risk impact.
   c. Fill `deadline` either as an ISO date "YYYY-MM-DD" if explicit, else "Not Specified".
   d. Fill `deadline_phrase` with the raw natural-language phrase from the source (e.g. "within 30 days", "by 31 March 2025"), or "" if none.
   e. Fill `risk_score` as an integer 1..5 (1=trivial, 5=severe legal/financial/operational exposure).
   f. Fill `category` ∈ {"Compliance","Risk","Operations","IT / Systems","Reporting","Customer Impact","Other"}.

3. If `kind == "notice"`:
   a. Fill `tag` ∈ {"Informational","Contextual","Advisory"}.
   b. Fill `text` with a one-line summary of the informational point.

Return STRICT JSON:
{
  "items": [
    {
      "input_id": "<id from input>",
      "kind": "actionable" | "notice",
      "description": "...",        // for actionable
      "priority": "High|Medium|Low",
      "deadline": "YYYY-MM-DD|Not Specified",
      "deadline_phrase": "...",
      "risk_score": 1-5,
      "category": "...",
      "text": "...",                 // for notice
      "tag": "Informational|Contextual|Advisory"  // for notice
    }
  ]
}

Do NOT invent items. Do NOT drop items — every input must have exactly one output entry."""


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
    ) -> tuple[list[EnrichedActionable], list[NoticeItem]]:
        if not raw_actionables:
            return [], []

        enriched: list[EnrichedActionable] = []
        notices: list[NoticeItem] = []

        for start in range(0, len(raw_actionables), self.BATCH_SIZE):
            batch = raw_actionables[start : start + self.BATCH_SIZE]
            try:
                batch_enriched, batch_notices = self._enrich_batch(batch, tree)
            except Exception as e:
                logger.error("Enrichment batch failed: %s", e)
                # graceful fallback: treat all as actionables with heuristics only
                batch_enriched = [self._heuristic_enrich(item) for item in batch]
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
    ) -> tuple[list[EnrichedActionable], list[NoticeItem]]:
        payload = self._input_payload(items)
        user_msg = (
            f"DOCUMENT: {tree.doc_name}\n\n"
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
            return [self._heuristic_enrich(it) for it in items], []

        rows = result.get("items", []) if isinstance(result, dict) else []
        by_id: dict[str, dict] = {}
        for row in rows:
            key = str(row.get("input_id", "")).strip()
            if key:
                by_id[key] = row

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
            enriched.append(self._merge_enriched(it, row))

        return enriched, notices

    def _merge_enriched(self, it: ActionableItem, row: dict) -> EnrichedActionable:
        stmt = self._action_statement(it)
        raw_text = it.evidence_quote or stmt or ""
        heur_iso, heur_phrase, bucket_hint = _heuristic_deadline(
            self._deadline_source(it) + " " + raw_text
        )

        llm_deadline = (row.get("deadline") or "").strip()
        if llm_deadline and llm_deadline.lower() != "not specified" and _ISO_DATE_PAT.fullmatch(llm_deadline):
            iso = llm_deadline
        else:
            iso = heur_iso
        phrase = (row.get("deadline_phrase") or heur_phrase or "").strip()

        priority = _norm_priority(
            row.get("priority", ""),
            (it.modality or "").lower(),
            bucket_hint,
        )
        risk = _clamp_risk(row.get("risk_score", 3))
        category = _norm_category(row.get("category", ""))
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
            status="Pending",
            notes="",
        )

    def _heuristic_enrich(self, it: ActionableItem) -> EnrichedActionable:
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
        bucket = _timeline_bucket_from_deadline(heur_iso, bucket_hint)
        description = (stmt or raw_text or "").strip()[:500]
        return EnrichedActionable(
            id=f"A-{uuid.uuid4().hex[:8].upper()}",
            description=description,
            source=it.source_location or "",
            source_node_id=it.source_node_id or "",
            original_text=raw_text[:1000],
            priority=priority,
            deadline=heur_iso or "Not Specified",
            deadline_phrase=heur_phrase,
            risk_score=risk,
            category="Other",
            timeline_bucket=bucket,
        )
