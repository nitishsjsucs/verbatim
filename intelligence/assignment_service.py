"""
Team-assignment service.

Given a list of `EnrichedActionable` items and the current team roster
(`IntelTeam` list), assign relevant teams to each actionable via semantic
matching. Multiple teams per item are allowed; "Unassigned" when no match.

Implementation: one LLM call per batch. The model sees all team functions
simultaneously and emits `team_ids` per actionable. Falls back to a
keyword-overlap heuristic if the LLM call fails.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

from utils.llm_client import LLMClient
from config.settings import get_settings

from intelligence.models import EnrichedActionable, IntelTeam, TeamTaskAssignment

logger = logging.getLogger(__name__)


_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "by",
    "with", "is", "are", "be", "shall", "must", "should", "may",
    "this", "that", "these", "those", "as", "at", "it", "its", "from",
    "their", "they", "all", "any", "within", "not", "no",
}


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[A-Za-z][A-Za-z\-]{2,}", (text or "").lower()) if t not in _STOPWORDS}


# version: v2 — semantic-first refactor (function-meaning alignment, not
# vocabulary overlap). Original prompt preserved at
# intelligence/_original_prompts.py (ORIGINAL_PROMPT_ASSIGNMENT).
SYSTEM_PROMPT = """You are the team-mapping stage of a compliance-intelligence pipeline.

SINGLE RESPONSIBILITY:
Given enriched, structured actionables and a roster of teams (each
with a function description), assign the most relevant team(s) to
each actionable. You operate ONLY on the structured fields you are
given. You DO NOT read raw regulatory text, re-classify the
actionable, or modify priority, risk, deadline, or category. You DO
NOT invent or rename teams.

CORE PRINCIPLE — SEMANTIC INTERPRETATION (NON-NEGOTIABLE):
Decide assignments by judging whether the MEANING of a team's
function description aligns with the responsibility expressed by the
actionable's description and category. Do not rely on shared words
or surface tokens. A team whose function shares no vocabulary with
the actionable may still be the correct owner if its purpose, in
meaning, covers the work. A team whose function shares overlapping
vocabulary may be wrong if its actual purpose does not cover the
responsibility.

INPUTS:
  * TEAMS — list of teams with id, name, function description, and
    (optional) department.
  * ACTIONABLES — enriched actionables with id, description, category,
    priority, and risk_score.

ASSIGNMENT RULES:
1. Coverage — every actionable should ideally have at least one
   owning team. Use up to three team ids when the responsibility,
   in meaning, genuinely spans multiple distinct functions;
   otherwise prefer one or two.
2. Primary owner — the FIRST team_id in the list should be the team
   whose function most directly executes the responsibility.
   Additional teams may follow when they support or share execution.
3. Cross-functional cases — assign multiple teams ONLY when the
   actionable, in meaning, requires distinct work in distinct
   functions (for example: a single responsibility that bundles
   policy authorship and technology implementation).
4. No fit — return an empty array ONLY when no team's function, in
   meaning, supports any portion of the responsibility. Do NOT
   force-fit a team merely because it is the closest available
   option; an empty array is the correct signal that the team
   roster does not yet cover this work.

OUTPUT (STRICT JSON — no extra commentary):
{
  "assignments": [
    {
      "actionable_id": "<id>",
      "team_tasks": [
        {"team_id": "<team_id>", "task": "<what this team specifically needs to do>"}
      ]
    }
  ]
}

Use only team ids that appear in TEAMS. Emit one assignment entry
per actionable, in the same order as ACTIONABLES."""


class IntelligenceAssigner:
    BATCH_SIZE = 25

    def __init__(self, llm: Optional[LLMClient] = None) -> None:
        self._llm = llm or LLMClient()
        self._settings = get_settings()

    def assign(
        self,
        actionables: list[EnrichedActionable],
        teams: list[IntelTeam],
    ) -> list[EnrichedActionable]:
        if not actionables:
            return actionables
        if not teams:
            for a in actionables:
                a.assigned_teams = []
                a.assigned_team_names = []
                a.team_specific_tasks = []
            return actionables

        for start in range(0, len(actionables), self.BATCH_SIZE):
            batch = actionables[start : start + self.BATCH_SIZE]
            try:
                mapping = self._assign_batch(batch, teams)
            except Exception as e:
                logger.error("Assignment batch failed: %s — falling back", e)
                mapping = self._heuristic_assign(batch, teams)

            team_by_id = {t.team_id: t for t in teams}
            for a in batch:
                raw_tasks = mapping.get(a.id, [])
                # raw_tasks is a list of {"team_id": ..., "task": ...}
                valid_tasks = [t for t in raw_tasks if t.get("team_id") in team_by_id]
                a.assigned_teams = [t["team_id"] for t in valid_tasks]
                a.assigned_team_names = [team_by_id[t["team_id"]].name for t in valid_tasks]
                a.team_specific_tasks = [
                    TeamTaskAssignment(
                        team_id=t["team_id"],
                        team_name=team_by_id[t["team_id"]].name,
                        team_specific_task=t.get("task", ""),
                    )
                    for t in valid_tasks
                ]

        return actionables

    # ------------------------------------------------------------------
    def _assign_batch(
        self,
        actionables: list[EnrichedActionable],
        teams: list[IntelTeam],
    ) -> dict[str, list[dict]]:
        teams_payload = [
            {
                "id": t.team_id,
                "name": t.name,
                "function": t.function,
                "department": t.department or "",
            }
            for t in teams
        ]
        acts_payload = [
            {
                "id": a.id,
                "description": a.description[:400],
                "category": a.category,
                "priority": a.priority,
                "risk_score": a.risk_score,
            }
            for a in actionables
        ]
        user_msg = (
            "TEAMS:\n"
            f"{json.dumps(teams_payload, indent=2)}\n\n"
            "ACTIONABLES:\n"
            f"{json.dumps(acts_payload, indent=2)}\n\n"
            "Assign relevant teams and team-specific tasks per actionable."
        )
        result = self._llm.chat_json(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            model=self._settings.llm.model,
            max_tokens=self._settings.llm.max_tokens_long,
            reasoning_effort="low",
        )
        mapping: dict[str, list[dict]] = {}
        rows = result.get("assignments", []) if isinstance(result, dict) else []
        for row in rows:
            aid = str(row.get("actionable_id", "")).strip()
            team_tasks = row.get("team_tasks") or []
            parsed = [
                {"team_id": str(tt.get("team_id", "")).strip(), "task": str(tt.get("task", "")).strip()}
                for tt in team_tasks
                if str(tt.get("team_id", "")).strip()
            ]
            if aid:
                mapping[aid] = parsed
        return mapping

    def _heuristic_assign(
        self,
        actionables: list[EnrichedActionable],
        teams: list[IntelTeam],
    ) -> dict[str, list[dict]]:
        team_toks = [(t, _tokens(t.function + " " + t.name + " " + (t.department or ""))) for t in teams]
        out: dict[str, list[dict]] = {}
        for a in actionables:
            atoks = _tokens(a.description + " " + a.category)
            ranked: list[tuple[int, IntelTeam]] = []
            for t, tt in team_toks:
                overlap = len(atoks & tt)
                if overlap >= 2:
                    ranked.append((overlap, t))
            ranked.sort(key=lambda x: -x[0])
            out[a.id] = [
                {"team_id": t.team_id, "task": f"Handle {a.category.lower()} aspects related to: {a.description[:100]}"}
                for _, t in ranked[:2]
            ]
        return out
