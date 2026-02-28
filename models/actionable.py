"""
Actionable data models for GOVINDA V2.

An "actionable" is a deontic statement extracted from a regulatory document:
an obligation, prohibition, permission, or recommendation — with implementation
constraints (who, when, how, thresholds, reporting).

Schema follows the pattern:
  identify deontic sentences → structure into fields → validate → group
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Modality(str, Enum):
    """Deontic modality of the actionable."""

    MANDATORY = "Mandatory"  # shall, must, required to
    PROHIBITED = "Prohibited"  # shall not, must not, prohibited
    PERMITTED = "Permitted"  # may, at its option
    RECOMMENDED = "Recommended"  # should, endeavour to
    HIGH_RISK = "High Risk"
    MEDIUM_RISK = "Medium Risk"
    LOW_RISK = "Low Risk"


class Workstream(str, Enum):
    """Implementation workstream category."""

    POLICY = "Policy"
    TECHNOLOGY = "Technology"
    OPERATIONS = "Operations"
    TRAINING = "Training"
    REPORTING = "Reporting"
    CUSTOMER_COMMUNICATION = "Customer Communication"
    GOVERNANCE = "Governance"
    LEGAL = "Legal"
    OTHER = "Other"


@dataclass
class ActionableItem:
    """A single extracted compliance actionable."""

    id: str  # e.g., "ACT-001"
    modality: Modality
    actor: str  # Who must do it
    action: str  # Verb phrase
    object: str  # What is acted upon
    trigger_or_condition: str = ""  # IF/WHERE/PROVIDED THAT
    thresholds: str = ""  # Numbers, limits, amounts
    deadline_or_frequency: str = ""  # within X days, periodic
    effective_date: str = ""  # with effect from...
    reporting_or_notification_to: str = ""  # Recipient of reports
    evidence_quote: str = ""  # Verbatim ≤25 words
    source_location: str = ""  # Page + section heading
    source_node_id: str = ""  # Tree node ID
    implementation_notes: str = ""  # Short operational guidance
    workstream: Workstream = Workstream.OTHER  # Implementation category
    needs_legal_review: bool = False  # Ambiguous items flagged
    validation_status: str = "pending"  # pending, validated, flagged
    validation_notes: str = ""  # Notes from validation pass
    approval_status: str = "pending"  # pending, approved, rejected
    is_manual: bool = False  # True if manually created by user
    published_at: str = ""  # ISO timestamp when published to tracker
    deadline: str = ""  # ISO datetime deadline for completion
    task_status: str = ""  # assigned, in_progress, team_review, review, completed, reworking
    completion_date: str = ""  # ISO timestamp when completed
    reviewer_comments: str = ""  # Comments from reviewer or team member
    evidence_files: list = field(default_factory=list)  # List of {name, url, uploaded_at}
    comments: list = field(default_factory=list)  # List of {id, author, role, text, timestamp}
    submitted_at: str = ""  # ISO timestamp when team member submitted for review
    team_reviewer_name: str = ""  # Name of the team reviewer who acted
    team_reviewer_approved_at: str = ""  # ISO timestamp when team reviewer approved
    team_reviewer_rejected_at: str = ""  # ISO timestamp when team reviewer rejected
    # ── Delay monitoring & Team Lead fields ──
    is_delayed: bool = False  # True if deadline has passed and task not completed
    delay_detected_at: str = ""  # ISO timestamp when delay was first detected
    justification: str = ""  # Team Lead's explanation for the delay
    justification_by: str = ""  # Name of team lead who provided justification
    justification_at: str = ""  # ISO timestamp when justification was provided
    justification_status: str = ""  # "pending_review" or "reviewed"
    audit_trail: list = field(default_factory=list)  # List of {event, actor, role, timestamp, details}
    # ── Multi-team assignment ──
    assigned_teams: list = field(default_factory=list)  # e.g. ["Policy", "Technology"] — empty = single-team via workstream
    team_workflows: dict = field(default_factory=dict)  # Per-team workflow state, keyed by team name

    # ── Multi-team helpers ──
    TEAM_WORKFLOW_FIELDS = [
        "task_status", "submitted_at", "team_reviewer_name",
        "team_reviewer_approved_at", "team_reviewer_rejected_at",
        "reviewer_comments", "rejection_reason",
        "is_delayed", "delay_detected_at",
        "justification", "justification_by", "justification_at", "justification_status",
        "evidence_files", "comments", "completion_date",
    ]

    @property
    def is_multi_team(self) -> bool:
        return len(self.assigned_teams) > 1

    def effective_teams(self) -> list:
        if self.assigned_teams:
            return list(self.assigned_teams)
        return [self.workstream.value if isinstance(self.workstream, Workstream) else self.workstream]

    def init_team_workflows(self) -> None:
        """Initialize team_workflows for all assigned_teams."""
        for t in self.assigned_teams:
            if t not in self.team_workflows:
                self.team_workflows[t] = {
                    "task_status": "assigned",
                    "submitted_at": "",
                    "team_reviewer_name": "",
                    "team_reviewer_approved_at": "",
                    "team_reviewer_rejected_at": "",
                    "reviewer_comments": "",
                    "rejection_reason": "",
                    "is_delayed": False,
                    "delay_detected_at": "",
                    "justification": "",
                    "justification_by": "",
                    "justification_at": "",
                    "justification_status": "",
                    "evidence_files": [],
                    "comments": [],
                    "completion_date": "",
                }

    def compute_aggregate_status(self) -> None:
        """For multi-team items, compute top-level task_status from per-team statuses.

        - All teams completed → top-level "completed" (set completion_date)
        - Any team at "review" (CO can act) → top-level "review"
        - Otherwise → "pending_all_teams"
        """
        if not self.is_multi_team:
            return
        statuses = [tw.get("task_status", "assigned") for tw in self.team_workflows.values()]
        if all(s == "completed" for s in statuses):
            self.task_status = "completed"
            if not self.completion_date:
                from datetime import datetime, timezone
                self.completion_date = datetime.now(timezone.utc).isoformat()
        elif any(s == "review" for s in statuses):
            self.task_status = "review"
        else:
            self.task_status = "pending_all_teams"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "modality": self.modality.value,
            "actor": self.actor,
            "action": self.action,
            "object": self.object,
            "trigger_or_condition": self.trigger_or_condition,
            "thresholds": self.thresholds,
            "deadline_or_frequency": self.deadline_or_frequency,
            "effective_date": self.effective_date,
            "reporting_or_notification_to": self.reporting_or_notification_to,
            "evidence_quote": self.evidence_quote,
            "source_location": self.source_location,
            "source_node_id": self.source_node_id,
            "implementation_notes": self.implementation_notes,
            "workstream": self.workstream.value,
            "needs_legal_review": self.needs_legal_review,
            "validation_status": self.validation_status,
            "validation_notes": self.validation_notes,
            "approval_status": self.approval_status,
            "is_manual": self.is_manual,
            "published_at": self.published_at,
            "deadline": self.deadline,
            "task_status": self.task_status,
            "completion_date": self.completion_date,
            "reviewer_comments": self.reviewer_comments,
            "evidence_files": self.evidence_files,
            "comments": self.comments,
            "submitted_at": self.submitted_at,
            "team_reviewer_name": self.team_reviewer_name,
            "team_reviewer_approved_at": self.team_reviewer_approved_at,
            "team_reviewer_rejected_at": self.team_reviewer_rejected_at,
            "is_delayed": self.is_delayed,
            "delay_detected_at": self.delay_detected_at,
            "justification": self.justification,
            "justification_by": self.justification_by,
            "justification_at": self.justification_at,
            "justification_status": self.justification_status,
            "audit_trail": self.audit_trail,
            "assigned_teams": self.assigned_teams,
            "team_workflows": self.team_workflows,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ActionableItem:
        modality_str = data.get("modality", "Mandatory")
        try:
            modality = Modality(modality_str)
        except ValueError:
            modality = Modality.MANDATORY

        workstream_str = data.get("workstream", "Other")
        try:
            workstream = Workstream(workstream_str)
        except ValueError:
            workstream = Workstream.OTHER

        return cls(
            id=data.get("id", ""),
            modality=modality,
            actor=data.get("actor", ""),
            action=data.get("action", ""),
            object=data.get("object", ""),
            trigger_or_condition=data.get("trigger_or_condition", ""),
            thresholds=data.get("thresholds", ""),
            deadline_or_frequency=data.get("deadline_or_frequency", ""),
            effective_date=data.get("effective_date", ""),
            reporting_or_notification_to=data.get("reporting_or_notification_to", ""),
            evidence_quote=data.get("evidence_quote", ""),
            source_location=data.get("source_location", ""),
            source_node_id=data.get("source_node_id", ""),
            implementation_notes=data.get("implementation_notes", ""),
            workstream=workstream,
            needs_legal_review=data.get("needs_legal_review", False),
            validation_status=data.get("validation_status", "pending"),
            validation_notes=data.get("validation_notes", ""),
            approval_status=data.get("approval_status", "pending"),
            is_manual=data.get("is_manual", False),
            published_at=data.get("published_at", ""),
            deadline=data.get("deadline", ""),
            task_status=data.get("task_status", ""),
            completion_date=data.get("completion_date", ""),
            reviewer_comments=data.get("reviewer_comments", ""),
            evidence_files=data.get("evidence_files", []),
            comments=data.get("comments", []),
            submitted_at=data.get("submitted_at", ""),
            team_reviewer_name=data.get("team_reviewer_name", ""),
            team_reviewer_approved_at=data.get("team_reviewer_approved_at", ""),
            team_reviewer_rejected_at=data.get("team_reviewer_rejected_at", ""),
            is_delayed=data.get("is_delayed", False),
            delay_detected_at=data.get("delay_detected_at", ""),
            justification=data.get("justification", ""),
            justification_by=data.get("justification_by", ""),
            justification_at=data.get("justification_at", ""),
            justification_status=data.get("justification_status", ""),
            audit_trail=data.get("audit_trail", []),
            assigned_teams=data.get("assigned_teams", []),
            team_workflows=data.get("team_workflows", {}),
        )


@dataclass
class ActionablesResult:
    """Complete extraction result for a document."""

    doc_id: str
    doc_name: str = ""
    actionables: list[ActionableItem] = field(default_factory=list)
    total_extracted: int = 0
    total_validated: int = 0
    total_flagged: int = 0
    nodes_processed: int = 0
    nodes_with_actionables: int = 0
    extraction_time_seconds: float = 0.0
    llm_calls: int = 0
    total_tokens: int = 0
    extracted_at: str = ""  # ISO timestamp

    # Summary stats by modality
    by_modality: dict[str, int] = field(default_factory=dict)
    # Summary stats by workstream
    by_workstream: dict[str, int] = field(default_factory=dict)

    def compute_stats(self) -> None:
        """Recompute summary statistics from the actionables list."""
        self.total_extracted = len(self.actionables)
        self.total_validated = sum(
            1 for a in self.actionables if a.validation_status == "validated"
        )
        self.total_flagged = sum(
            1
            for a in self.actionables
            if a.needs_legal_review or a.validation_status == "flagged"
        )
        self.by_modality = {}
        for a in self.actionables:
            key = a.modality.value
            self.by_modality[key] = self.by_modality.get(key, 0) + 1
        self.by_workstream = {}
        for a in self.actionables:
            key = a.workstream.value
            self.by_workstream[key] = self.by_workstream.get(key, 0) + 1

    def to_dict(self) -> dict:
        self.compute_stats()
        return {
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "actionables": [a.to_dict() for a in self.actionables],
            "total_extracted": self.total_extracted,
            "total_validated": self.total_validated,
            "total_flagged": self.total_flagged,
            "nodes_processed": self.nodes_processed,
            "nodes_with_actionables": self.nodes_with_actionables,
            "extraction_time_seconds": self.extraction_time_seconds,
            "llm_calls": self.llm_calls,
            "total_tokens": self.total_tokens,
            "extracted_at": self.extracted_at,
            "by_modality": self.by_modality,
            "by_workstream": self.by_workstream,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ActionablesResult:
        result = cls(
            doc_id=data.get("doc_id", ""),
            doc_name=data.get("doc_name", ""),
            actionables=[
                ActionableItem.from_dict(a) for a in data.get("actionables", [])
            ],
            nodes_processed=data.get("nodes_processed", 0),
            nodes_with_actionables=data.get("nodes_with_actionables", 0),
            extraction_time_seconds=data.get("extraction_time_seconds", 0.0),
            llm_calls=data.get("llm_calls", 0),
            total_tokens=data.get("total_tokens", 0),
            extracted_at=data.get("extracted_at", ""),
        )
        result.compute_stats()
        return result
