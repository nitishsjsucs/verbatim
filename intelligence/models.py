"""Data models for the Actionable Intelligence System."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Literal, Optional
import uuid


Priority = Literal["High", "Medium", "Low"]
TimelineBucket = Literal["Immediate", "Short-term", "Long-term", "Not Specified"]
NoticeTag = Literal["Informational", "Contextual", "Advisory"]


@dataclass
class IntelTeam:
    """A team defined in the AIS Teams Configuration page."""

    team_id: str
    name: str
    function: str
    department: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""

    @staticmethod
    def new(name: str, function: str, department: Optional[str] = None) -> "IntelTeam":
        now = datetime.now(timezone.utc).isoformat()
        return IntelTeam(
            team_id=f"TEAM-{uuid.uuid4().hex[:10].upper()}",
            name=name.strip(),
            function=function.strip(),
            department=(department or "").strip() or None,
            created_at=now,
            updated_at=now,
        )

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "IntelTeam":
        return IntelTeam(
            team_id=d.get("team_id") or d.get("_id") or f"TEAM-{uuid.uuid4().hex[:10].upper()}",
            name=d.get("name", ""),
            function=d.get("function", ""),
            department=d.get("department"),
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
        )


@dataclass
class TeamTaskAssignment:
    """Maps a team to its specific task for a given actionable."""

    team_id: str
    team_name: str
    team_specific_task: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "TeamTaskAssignment":
        return TeamTaskAssignment(
            team_id=d.get("team_id", ""),
            team_name=d.get("team_name", ""),
            team_specific_task=d.get("team_specific_task", ""),
        )


@dataclass
class EnrichedActionable:
    """A single enriched actionable produced by the AIS pipeline."""

    id: str
    description: str
    source: str  # e.g. "Section 5.2, pp.12-13"
    source_node_id: str = ""
    original_text: str = ""
    priority: Priority = "Medium"
    deadline: str = "Not Specified"  # ISO date (YYYY-MM-DD) or "Not Specified"
    deadline_phrase: str = ""  # raw phrase captured from doc, e.g. "within 30 days"
    risk_score: int = 3  # 1..5
    timeline_bucket: TimelineBucket = "Not Specified"
    assigned_teams: list[str] = field(default_factory=list)  # team_ids
    assigned_team_names: list[str] = field(default_factory=list)  # denormalized
    team_specific_tasks: list[TeamTaskAssignment] = field(default_factory=list)  # per-team task mapping
    notes: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["team_specific_tasks"] = [t.to_dict() if isinstance(t, TeamTaskAssignment) else t for t in (self.team_specific_tasks or [])]
        return d

    @staticmethod
    def from_dict(d: dict) -> "EnrichedActionable":
        raw_tasks = d.get("team_specific_tasks", []) or []
        tasks = [
            TeamTaskAssignment.from_dict(t) if isinstance(t, dict) else t
            for t in raw_tasks
        ]
        return EnrichedActionable(
            id=d.get("id") or f"A-{uuid.uuid4().hex[:8].upper()}",
            description=d.get("description", ""),
            source=d.get("source", ""),
            source_node_id=d.get("source_node_id", ""),
            original_text=d.get("original_text", ""),
            priority=d.get("priority", "Medium"),
            deadline=d.get("deadline", "Not Specified"),
            deadline_phrase=d.get("deadline_phrase", ""),
            risk_score=int(d.get("risk_score", 3) or 3),
            timeline_bucket=d.get("timeline_bucket", "Not Specified"),
            assigned_teams=list(d.get("assigned_teams", []) or []),
            assigned_team_names=list(d.get("assigned_team_names", []) or []),
            team_specific_tasks=tasks,
            notes=d.get("notes", ""),
        )


@dataclass
class NoticeItem:
    """A non-actionable informational item surfaced alongside actionables."""

    id: str
    text: str
    source: str
    source_node_id: str = ""
    tag: NoticeTag = "Informational"

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "NoticeItem":
        return NoticeItem(
            id=d.get("id") or f"N-{uuid.uuid4().hex[:8].upper()}",
            text=d.get("text", ""),
            source=d.get("source", ""),
            source_node_id=d.get("source_node_id", ""),
            tag=d.get("tag", "Informational"),
        )


@dataclass
class IntelRun:
    """One intelligence-enrichment run against a document."""

    doc_id: str
    doc_name: str
    actionables: list[EnrichedActionable] = field(default_factory=list)
    notice_board: list[NoticeItem] = field(default_factory=list)
    team_snapshot: list[dict] = field(default_factory=list)  # teams available at run time
    created_at: str = ""
    updated_at: str = ""
    stats: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "actionables": [a.to_dict() for a in self.actionables],
            "notice_board": [n.to_dict() for n in self.notice_board],
            "team_snapshot": self.team_snapshot,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "stats": self.stats,
        }

    @staticmethod
    def from_dict(d: dict) -> "IntelRun":
        return IntelRun(
            doc_id=d.get("doc_id", ""),
            doc_name=d.get("doc_name", ""),
            actionables=[EnrichedActionable.from_dict(x) for x in d.get("actionables", [])],
            notice_board=[NoticeItem.from_dict(x) for x in d.get("notice_board", [])],
            team_snapshot=list(d.get("team_snapshot", [])),
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
            stats=dict(d.get("stats", {})),
        )
