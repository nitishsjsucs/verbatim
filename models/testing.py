"""
Testing Cycle data model — completely separate from Control Cycle.

Testing items wrap references to existing Control Cycle actionables and
track them through the Testing Head → Tester → Maker → Checker workflow.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import List, Optional


class TestingSection(str, Enum):
    THEME = "theme"
    PRODUCT = "product"
    TRANCHE3 = "tranche3"
    ADHOC = "adhoc"


class TestingStatus(str, Enum):
    PENDING_ASSIGNMENT = "pending_assignment"
    ASSIGNED_TO_TESTER = "assigned_to_tester"
    TESTER_REVIEW = "tester_review"
    ASSIGNED_TO_MAKER = "assigned_to_maker"
    MAKER_OPEN = "maker_open"
    CHECKER_REVIEW = "checker_review"
    ACTIVE = "active"
    MAKER_CLOSED = "maker_closed"
    TESTER_VALIDATION = "tester_validation"
    PASSED = "passed"
    REJECTED_TO_MAKER = "rejected_to_maker"


@dataclass
class TestingComment:
    id: str = ""
    author: str = ""
    role: str = ""  # testing_head | tester | testing_maker | testing_checker
    text: str = ""
    timestamp: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TestingComment":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class TestingEvidenceFile:
    name: str = ""
    url: str = ""
    uploaded_at: str = ""
    stored_name: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TestingEvidenceFile":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class TestingAuditEntry:
    event: str = ""
    actor: str = ""
    role: str = ""
    timestamp: str = ""
    details: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TestingAuditEntry":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class TestingItem:
    """A testing item wraps a reference to a control cycle actionable."""
    id: str = ""
    # Source reference
    source_actionable_id: str = ""
    source_doc_id: str = ""
    source_doc_name: str = ""
    source_actionable_text: str = ""
    source_theme: str = ""
    source_new_product: str = ""
    source_product_live_date: str = ""
    source_tranche3: str = ""
    source_workstream: str = ""
    # Testing section
    testing_section: str = "theme"
    # Assignment
    assigned_tester_id: str = ""
    assigned_tester_name: str = ""
    assigned_maker_id: str = ""
    assigned_maker_name: str = ""
    # Status
    status: str = "pending_assignment"
    # Deadlines
    testing_deadline: str = ""
    maker_deadline: str = ""
    maker_deadline_confirmed: bool = False
    maker_deadline_confirmed_by: str = ""
    maker_deadline_confirmed_at: str = ""
    # Maker decision
    maker_decision: str = ""  # "" | "open" | "close"
    # Evidence
    testing_evidence_files: List[dict] = field(default_factory=list)
    testing_comments: List[dict] = field(default_factory=list)
    # Tester validation
    tester_pass_reject_reason: str = ""
    # Rework
    rework_count: int = 0
    # Ad-hoc
    adhoc_window_id: str = ""
    # Timestamps
    created_at: str = ""
    assigned_at: str = ""
    tester_forwarded_at: str = ""
    maker_submitted_at: str = ""
    checker_confirmed_at: str = ""
    active_at: str = ""
    closed_at: str = ""
    passed_at: str = ""
    # Audit
    testing_audit_trail: List[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TestingItem":
        known = set(cls.__dataclass_fields__.keys())
        filtered = {k: v for k, v in d.items() if k in known}
        return cls(**filtered)

    def add_audit(self, event: str, actor: str, role: str, details: str = "") -> None:
        entry = TestingAuditEntry(
            event=event,
            actor=actor,
            role=role,
            timestamp=datetime.utcnow().isoformat() + "Z",
            details=details,
        )
        self.testing_audit_trail.append(entry.to_dict())

    def add_comment(self, author: str, role: str, text: str) -> dict:
        comment = TestingComment(
            id=str(uuid.uuid4())[:8],
            author=author,
            role=role,
            text=text,
            timestamp=datetime.utcnow().isoformat() + "Z",
        )
        self.testing_comments.append(comment.to_dict())
        return comment.to_dict()


@dataclass
class TestingAdHocWindow:
    """Ad-hoc testing window created by Testing Head."""
    id: str = ""
    name: str = ""
    start_date: str = ""
    end_date: str = ""
    completion_deadline: str = ""
    themes: List[str] = field(default_factory=list)
    created_by: str = ""
    created_at: str = ""
    status: str = "active"  # active | completed | cancelled

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TestingAdHocWindow":
        known = set(cls.__dataclass_fields__.keys())
        filtered = {k: v for k, v in d.items() if k in known}
        return cls(**filtered)


def determine_testing_section(actionable: dict) -> str:
    """
    Determine which testing section an actionable belongs to.
    Priority: tranche3 > product > theme (highest priority wins).
    """
    tranche3 = (actionable.get("tranche3") or "").strip().lower()
    new_product = (actionable.get("new_product") or "").strip().lower()
    theme = (actionable.get("theme") or "").strip()

    if tranche3 == "yes":
        return TestingSection.TRANCHE3.value
    if new_product == "yes":
        return TestingSection.PRODUCT.value
    if theme:
        return TestingSection.THEME.value
    # Fallback — items without any category go to theme
    return TestingSection.THEME.value
