"""
Auto-grouping & insights service.

Pure, deterministic post-processing over an `IntelRun.actionables` list.
No LLM calls. Produces:

  * functional groups (by category)
  * department groups (by assigned-team department)
  * timeline groups (Immediate / Short-term / Long-term / Not Specified)
  * aggregate stats used by the insights panel and the cross-document dashboard
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from intelligence.models import EnrichedActionable, IntelTeam


def group_by_category(items: list[EnrichedActionable]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = defaultdict(list)
    for a in items:
        out[a.category or "Uncategorized"].append(a.id)
    return dict(out)


def group_by_department(
    items: list[EnrichedActionable],
    teams: Iterable[IntelTeam],
) -> dict[str, list[str]]:
    dept_by_tid = {t.team_id: (t.department or "Unassigned Dept") for t in teams}
    out: dict[str, list[str]] = defaultdict(list)
    for a in items:
        if not a.assigned_teams:
            out["Unassigned"].append(a.id)
            continue
        seen = set()
        for tid in a.assigned_teams:
            dept = dept_by_tid.get(tid, "Unassigned Dept")
            if dept in seen:
                continue
            seen.add(dept)
            out[dept].append(a.id)
    return dict(out)


def group_by_timeline(items: list[EnrichedActionable]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {
        "Immediate": [],
        "Short-term": [],
        "Long-term": [],
        "Not Specified": [],
    }
    for a in items:
        key = a.timeline_bucket if a.timeline_bucket in out else "Not Specified"
        out[key].append(a.id)
    return out


def compute_stats(
    items: list[EnrichedActionable],
    teams: Iterable[IntelTeam] | None = None,
) -> dict:
    team_list = list(teams or [])
    team_name_by_id = {t.team_id: t.name for t in team_list}
    team_workload: dict[str, int] = defaultdict(int)

    priority_counts = defaultdict(int)
    category_counts = defaultdict(int)
    risk_counts = defaultdict(int)
    timeline_counts = defaultdict(int)

    total = len(items)
    unassigned = 0
    upcoming_deadlines = 0

    for a in items:
        priority_counts[a.priority] += 1
        category_counts[a.category] += 1
        risk_counts[str(a.risk_score)] += 1
        timeline_counts[a.timeline_bucket] += 1
        if not a.assigned_teams:
            unassigned += 1
        if a.deadline and a.deadline != "Not Specified":
            upcoming_deadlines += 1
        for tid in a.assigned_teams:
            name = team_name_by_id.get(tid, tid)
            team_workload[name] += 1

    return {
        "total": total,
        "high_priority": priority_counts.get("High", 0),
        "medium_priority": priority_counts.get("Medium", 0),
        "low_priority": priority_counts.get("Low", 0),
        "unassigned": unassigned,
        "upcoming_deadlines": upcoming_deadlines,
        "priority_counts": dict(priority_counts),
        "category_counts": dict(category_counts),
        "risk_counts": dict(risk_counts),
        "timeline_counts": dict(timeline_counts),
        "team_workload": dict(team_workload),
    }


def build_groupings(
    items: list[EnrichedActionable],
    teams: Iterable[IntelTeam] | None = None,
) -> dict:
    team_list = list(teams or [])
    return {
        "by_category": group_by_category(items),
        "by_department": group_by_department(items, team_list),
        "by_timeline": group_by_timeline(items),
    }
