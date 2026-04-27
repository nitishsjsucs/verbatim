"""Data models for the Actionable Intelligence System."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Literal, Optional
import uuid


Priority = Literal["High", "Medium", "Low"]
# Category is now user-defined via IntelCategory store. Keep as free-form str.
Category = str
TimelineBucket = Literal["Immediate", "Short-term", "Long-term", "Not Specified"]
NoticeTag = Literal["Informational", "Contextual", "Advisory"]

DEFAULT_CATEGORY = "Uncategorized"


@dataclass
class IntelCategory:
    """A category defined in the AIS Categories Configuration page.

    Used by the enricher to classify actionables. Categories are user-defined
    (see Section 4 of the spec) — there is no fixed taxonomy.
    """

    category_id: str
    name: str
    description: str = ""
    created_at: str = ""
    updated_at: str = ""

    @staticmethod
    def new(name: str, description: str = "") -> "IntelCategory":
        now = datetime.now(timezone.utc).isoformat()
        return IntelCategory(
            category_id=f"CAT-{uuid.uuid4().hex[:10].upper()}",
            name=name.strip(),
            description=(description or "").strip(),
            created_at=now,
            updated_at=now,
        )

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "IntelCategory":
        return IntelCategory(
            category_id=d.get("category_id") or d.get("_id") or f"CAT-{uuid.uuid4().hex[:10].upper()}",
            name=d.get("name", ""),
            description=d.get("description", "") or "",
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
        )


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
    category: Category = DEFAULT_CATEGORY
    timeline_bucket: TimelineBucket = "Not Specified"
    assigned_teams: list[str] = field(default_factory=list)  # team_ids
    assigned_team_names: list[str] = field(default_factory=list)  # denormalized
    deadline_reasoning: str = ""  # how the deadline was derived (or fallback notice)
    notes: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "EnrichedActionable":
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
            category=d.get("category") or DEFAULT_CATEGORY,
            timeline_bucket=d.get("timeline_bucket", "Not Specified"),
            assigned_teams=list(d.get("assigned_teams", []) or []),
            assigned_team_names=list(d.get("assigned_team_names", []) or []),
            deadline_reasoning=d.get("deadline_reasoning", "") or "",
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
