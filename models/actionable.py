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
from typing import Optional  # noqa: F401 — kept for potential future use


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
    """Implementation workstream category.
    
    NOTE: This enum is kept for backward compatibility with existing data.
    New teams are dynamic (database-driven). The from_dict / to_dict methods
    gracefully handle any string value, not just enum members.
    """

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
    workstream: str = "Other"  # Implementation category (dynamic — any team name)
    needs_legal_review: bool = False  # Ambiguous items flagged
    validation_status: str = "pending"  # pending, validated, flagged
    validation_notes: str = ""  # Notes from validation pass
    approval_status: str = "pending"  # pending, approved, rejected
    is_manual: bool = False  # True if manually created by user
    published_at: str = ""  # ISO timestamp when published to tracker
    first_published_at: str = ""  # ISO timestamp of the FIRST time this was published (never overwritten)
    deadline: str = ""  # ISO datetime deadline for completion
    new_product: str = ""  # "Yes" or "No"
    product_live_date: str = ""  # ISO date — Product Live Date (only when new_product="Yes")
    task_status: str = ""  # assigned, in_progress, team_review, review, completed, reworking
    completion_date: str = ""  # ISO timestamp when completed
    reviewer_comments: str = ""  # Comments from reviewer or team member
    evidence_files: list = field(default_factory=list)  # List of {name, url, uploaded_at}
    comments: list = field(default_factory=list)  # List of {id, author, role, text, timestamp}
    submitted_at: str = ""  # ISO timestamp when team member submitted for review
    team_reviewer_name: str = ""  # Name of the team reviewer who acted
    team_reviewer_approved_at: str = ""  # ISO timestamp when team reviewer approved
    team_reviewer_rejected_at: str = ""  # ISO timestamp when team reviewer rejected
    rejection_reason: str = ""  # Reason provided when CO or team reviewer rejects a task
    # ── Delay monitoring & Team Lead fields ──
    is_delayed: bool = False  # True if deadline has passed and task not completed
    delay_detected_at: str = ""  # ISO timestamp when delay was first detected
    justification: str = ""  # Team Lead's explanation for the delay (legacy)
    justification_by: str = ""  # Name of team lead who provided justification (legacy)
    justification_at: str = ""  # ISO timestamp when justification was provided (legacy)
    justification_status: str = ""  # "pending_review" or "reviewed" (legacy)
    # ── NEW: 4-stage delay justification workflow (Member → Reviewer → Lead → CO) ──
    justification_member_text: str = ""  # Stage 1: Member submits justification
    justification_member_by: str = ""  # Stage 1: Member name
    justification_member_at: str = ""  # Stage 1: ISO timestamp
    justification_reviewer_approved: bool = False  # Stage 2: Reviewer approval status
    justification_reviewer_comment: str = ""  # Stage 2: Reviewer comment
    justification_reviewer_by: str = ""  # Stage 2: Reviewer name
    justification_reviewer_at: str = ""  # Stage 2: ISO timestamp
    justification_lead_approved: bool = False  # Stage 3: Lead approval status
    justification_lead_comment: str = ""  # Stage 3: Lead comment
    justification_lead_by: str = ""  # Stage 3: Lead name
    justification_lead_at: str = ""  # Stage 3: ISO timestamp
    justification_co_approved: bool = False  # Stage 4: CO approval status
    justification_co_comment: str = ""  # Stage 4: CO comment
    justification_co_by: str = ""  # Stage 4: CO name
    justification_co_at: str = ""  # Stage 4: ISO timestamp
    # ── NEW: Shared delay justification workflow (Member → Reviewer → Lead) ──
    delay_justification: str = ""  # Single shared text field editable by Member/Reviewer/Lead
    delay_justification_member_submitted: bool = False  # Member has entered justification
    delay_justification_reviewer_approved: bool = False  # Reviewer approved the justification
    delay_justification_lead_approved: bool = False  # Lead approved the justification
    delay_justification_updated_by: str = ""  # Last person who edited the text
    delay_justification_updated_at: str = ""  # ISO timestamp of last edit
    audit_trail: list = field(default_factory=list)  # List of {event, actor, role, timestamp, details}
    # ── NEW: Role-specific mandatory comments (separate from chat thread) ──
    member_comment: str = ""  # Mandatory comment from member before submission
    member_comment_history: list = field(default_factory=list)  # List of {comment, submitted_at} for rework tracking
    reviewer_comment: str = ""  # Mandatory comment from reviewer before approval
    lead_comment: str = ""  # Mandatory comment from lead (if applicable)
    co_comment: str = ""  # Mandatory comment from CO before final approval
    # ── Document metadata (inherited from parent document) ──
    regulation_issue_date: str = ""  # ISO date — when the regulation was issued
    circular_effective_date: str = ""  # ISO date — when the circular becomes effective
    regulator: str = ""  # Regulator name (e.g. "RBI", "SEBI")
    # ── Unique actionable display ID ──
    actionable_id: str = ""  # Human-readable unique ID, e.g. "ACT-20260304-001"
    # ── Creation timestamp ──
    created_at: str = ""  # ISO timestamp when this actionable was created
    # ── Risk assessment dropdowns (legacy flat fields — kept for backward compat) ──
    impact: str = ""  # Legacy: flat string
    tranche3: str = ""  # Yes / No
    control: str = ""  # Legacy: flat string
    likelihood: str = ""  # Legacy: flat string
    residual_risk: str = ""  # Legacy: flat string
    inherent_risk: str = ""  # Legacy: flat string
    # ── Structured risk scoring (new) ──
    # Each is a dict: {"label": str, "score": int/float} or None/empty-dict
    # Likelihood: 3 independent sub-dropdowns → overall = MAX of 3 scores
    likelihood_business_volume: dict = field(default_factory=dict)   # {label, score}
    likelihood_products_processes: dict = field(default_factory=dict) # {label, score}
    likelihood_compliance_violations: dict = field(default_factory=dict) # {label, score}
    likelihood_score: float = 0  # MAX of 3 likelihood sub-scores
    # Impact: single dropdown → overall = score²
    impact_dropdown: dict = field(default_factory=dict)  # {label, score}
    impact_score: float = 0  # (selected impact score)²
    # Control: 2 sub-dropdowns → overall = average of 2 scores
    control_monitoring: dict = field(default_factory=dict)    # {label, score}
    control_effectiveness: dict = field(default_factory=dict) # {label, score}
    control_score: float = 0  # (monitoring + effectiveness) / 2
    # Derived risk scores
    inherent_risk_score: float = 0  # likelihood_score × impact_score
    inherent_risk_label: str = ""  # Display label
    residual_risk_score: float = 0  # inherent_risk_score × control_score
    residual_risk_label: str = ""  # Display label
    residual_risk_interpretation: str = ""  # "Satisfactory (Low)" / "Improvement Needed (Medium)" / "Weak (High)"
    # Aliases for spec-compliant field names (stored as integers)
    overall_likelihood_score: int = 0  # MAX(L1, L2, L3)
    overall_impact_score: int = 0  # (impact_dropdown.score)²
    overall_control_score: float = 0  # (monitoring + effectiveness) / 2
    # Legacy impact sub-fields (kept for backward compat with existing data)
    impact_sub1: dict = field(default_factory=dict)  # Deprecated → use impact_dropdown
    impact_sub2: dict = field(default_factory=dict)  # Deprecated
    impact_sub3: dict = field(default_factory=dict)  # Deprecated
    # ── Theme dropdown ──
    theme: str = ""  # Configurable theme category
    # ── Tagged Incorrectly bypass flow ──
    bypass_tag: bool = False  # True if team member tagged this as incorrectly assigned
    bypass_tagged_at: str = ""  # ISO timestamp when bypass was tagged
    bypass_tagged_by: str = ""  # Name of team member who tagged
    bypass_approved_by: str = ""  # Name of checker who approved the bypass
    bypass_approved_at: str = ""  # ISO timestamp when checker approved bypass
    bypass_disapproved_by: str = ""  # CO who disapproved the bypass
    bypass_disapproved_at: str = ""
    bypass_disapproval_reason: str = ""  # Reason CO disapproved
    bypass_reviewer_rejected_by: str = ""  # Reviewer who rejected the bypass
    bypass_reviewer_rejected_at: str = ""
    bypass_reviewer_rejection_reason: str = ""  # Reason reviewer rejected bypass
    # ── Multi-team assignment ──
    assigned_teams: list = field(default_factory=list)  # e.g. ["Policy", "Technology"] — empty = single-team via workstream
    team_workflows: dict = field(default_factory=dict)  # Per-team workflow state, keyed by team name
    # ── Feature 2: Tracker isolation by account ──
    published_by_account_id: str = ""  # Account ID of the CO who published this actionable
    # ── Feature 3: Delegation ──
    delegated_from_account_id: str = ""  # If delegated, the original CO's account ID
    delegation_request_id: str = ""  # Pending delegation request ID (blank when none)

    # ── Multi-team helpers ──
    TEAM_WORKFLOW_FIELDS = [
        "task_status", "submitted_at", "team_reviewer_name",
        "team_reviewer_approved_at", "team_reviewer_rejected_at",
        "reviewer_comments", "rejection_reason",
        "is_delayed", "delay_detected_at",
        "justification", "justification_by", "justification_at", "justification_status",
        "delay_justification", "delay_justification_member_submitted",
        "delay_justification_reviewer_approved", "delay_justification_lead_approved",
        "delay_justification_updated_by", "delay_justification_updated_at",
        "evidence_files", "comments", "completion_date",
        "deadline", "implementation_notes", "evidence_quote",
    ]

    @property
    def is_multi_team(self) -> bool:
        return len(self.assigned_teams) > 1

    def effective_teams(self) -> list:
        if self.assigned_teams:
            return list(self.assigned_teams)
        ws = self.workstream
        return [ws.value if isinstance(ws, Workstream) else str(ws)]

    def init_team_workflows(self) -> None:
        """Initialize team_workflows for all assigned_teams."""
        if not isinstance(self.team_workflows, dict):
            self.team_workflows = {}
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
                    "delay_justification": "",
                    "delay_justification_member_submitted": False,
                    "delay_justification_reviewer_approved": False,
                    "delay_justification_lead_approved": False,
                    "delay_justification_updated_by": "",
                    "delay_justification_updated_at": "",
                    "evidence_files": [],
                    "comments": [],
                    "completion_date": "",
                    "deadline": "",
                    "implementation_notes": "",
                    "evidence_quote": "",
                }

    def compute_aggregate_status(self) -> None:
        """For multi-team items, compute top-level task_status from per-team statuses.

        Priority order (highest → lowest):
        1. All completed → "completed"
        2. Any awaiting_justification → "awaiting_justification"
        3. Any review → "review"
        4. Any team_review → "team_review"
        5. Any reworking / reviewer_rejected → "reworking"
        6. Any in_progress → "in_progress"
        7. All assigned → "assigned"
        8. Otherwise → "pending_all_teams"
        """
        if not self.is_multi_team:
            return
        statuses = [tw.get("task_status", "assigned") for tw in self.team_workflows.values()]
        if not statuses:
            return
        if all(s == "completed" for s in statuses):
            self.task_status = "completed"
            if not self.completion_date:
                from datetime import datetime, timezone
                self.completion_date = datetime.now(timezone.utc).isoformat()
        elif any(s == "awaiting_justification" for s in statuses):
            self.task_status = "awaiting_justification"
        elif any(s == "review" for s in statuses):
            self.task_status = "review"
        elif any(s == "team_review" for s in statuses):
            self.task_status = "team_review"
        elif any(s in ("reworking", "reviewer_rejected") for s in statuses):
            self.task_status = "reworking"
        elif any(s == "in_progress" for s in statuses):
            self.task_status = "in_progress"
        elif all(s == "assigned" for s in statuses):
            self.task_status = "assigned"
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
            "workstream": self.workstream.value if isinstance(self.workstream, Workstream) else str(self.workstream),
            "needs_legal_review": self.needs_legal_review,
            "validation_status": self.validation_status,
            "validation_notes": self.validation_notes,
            "approval_status": self.approval_status,
            "is_manual": self.is_manual,
            "published_at": self.published_at,
            "first_published_at": self.first_published_at,
            "deadline": self.deadline,
            "new_product": self.new_product,
            "product_live_date": self.product_live_date,
            "task_status": self.task_status,
            "completion_date": self.completion_date,
            "reviewer_comments": self.reviewer_comments,
            "evidence_files": self.evidence_files,
            "comments": self.comments,
            "submitted_at": self.submitted_at,
            "team_reviewer_name": self.team_reviewer_name,
            "team_reviewer_approved_at": self.team_reviewer_approved_at,
            "team_reviewer_rejected_at": self.team_reviewer_rejected_at,
            "rejection_reason": self.rejection_reason,
            "is_delayed": self.is_delayed,
            "delay_detected_at": self.delay_detected_at,
            "justification": self.justification,
            "justification_by": self.justification_by,
            "justification_at": self.justification_at,
            "justification_status": self.justification_status,
            # 4-stage justification approval chain
            "justification_member_text": self.justification_member_text,
            "justification_member_at": self.justification_member_at,
            "justification_member_by": self.justification_member_by,
            "justification_reviewer_approved": self.justification_reviewer_approved,
            "justification_reviewer_comment": self.justification_reviewer_comment,
            "justification_reviewer_by": self.justification_reviewer_by,
            "justification_reviewer_at": self.justification_reviewer_at,
            "justification_lead_approved": self.justification_lead_approved,
            "justification_lead_comment": self.justification_lead_comment,
            "justification_lead_by": self.justification_lead_by,
            "justification_lead_at": self.justification_lead_at,
            "justification_co_approved": self.justification_co_approved,
            "justification_co_comment": self.justification_co_comment,
            "justification_co_by": self.justification_co_by,
            "justification_co_at": self.justification_co_at,
            # Shared delay justification workflow
            "delay_justification": self.delay_justification,
            "delay_justification_member_submitted": self.delay_justification_member_submitted,
            "delay_justification_reviewer_approved": self.delay_justification_reviewer_approved,
            "delay_justification_lead_approved": self.delay_justification_lead_approved,
            "delay_justification_updated_by": self.delay_justification_updated_by,
            "delay_justification_updated_at": self.delay_justification_updated_at,
            # Role-specific mandatory comment fields
            "member_comment": self.member_comment,
            "member_comment_history": self.member_comment_history,
            "reviewer_comment": self.reviewer_comment,
            "lead_comment": self.lead_comment,
            "co_comment": self.co_comment,
            "audit_trail": self.audit_trail,
            "regulation_issue_date": self.regulation_issue_date,
            "circular_effective_date": self.circular_effective_date,
            "regulator": self.regulator,
            "actionable_id": self.actionable_id,
            "created_at": self.created_at,
            "impact": self.impact,
            "tranche3": self.tranche3,
            "control": self.control,
            "likelihood": self.likelihood,
            "residual_risk": self.residual_risk,
            "inherent_risk": self.inherent_risk,
            # Structured risk scoring
            "likelihood_business_volume": self.likelihood_business_volume,
            "likelihood_products_processes": self.likelihood_products_processes,
            "likelihood_compliance_violations": self.likelihood_compliance_violations,
            "likelihood_score": self.likelihood_score,
            "impact_dropdown": self.impact_dropdown,
            "impact_score": self.impact_score,
            "control_monitoring": self.control_monitoring,
            "control_effectiveness": self.control_effectiveness,
            "control_score": self.control_score,
            "inherent_risk_score": self.inherent_risk_score,
            "inherent_risk_label": self.inherent_risk_label,
            "residual_risk_score": self.residual_risk_score,
            "residual_risk_label": self.residual_risk_label,
            "residual_risk_interpretation": self.residual_risk_interpretation,
            # Spec-compliant overall score aliases
            "overall_likelihood_score": self.overall_likelihood_score,
            "overall_impact_score": self.overall_impact_score,
            "overall_control_score": self.overall_control_score,
            # Legacy impact sub-fields (backward compat)
            "impact_sub1": self.impact_sub1,
            "impact_sub2": self.impact_sub2,
            "impact_sub3": self.impact_sub3,
            "theme": self.theme,
            "bypass_tag": self.bypass_tag,
            "bypass_tagged_at": self.bypass_tagged_at,
            "bypass_tagged_by": self.bypass_tagged_by,
            "bypass_approved_by": self.bypass_approved_by,
            "bypass_approved_at": self.bypass_approved_at,
            "bypass_disapproved_by": self.bypass_disapproved_by,
            "bypass_disapproved_at": self.bypass_disapproved_at,
            "bypass_disapproval_reason": self.bypass_disapproval_reason,
            "bypass_reviewer_rejected_by": self.bypass_reviewer_rejected_by,
            "bypass_reviewer_rejected_at": self.bypass_reviewer_rejected_at,
            "bypass_reviewer_rejection_reason": self.bypass_reviewer_rejection_reason,
            "assigned_teams": self.assigned_teams,
            "team_workflows": self.team_workflows,
            "published_by_account_id": self.published_by_account_id,
            "delegated_from_account_id": self.delegated_from_account_id,
            "delegation_request_id": self.delegation_request_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ActionableItem:
        modality_str = data.get("modality", "Mandatory")
        try:
            modality = Modality(modality_str)
        except ValueError:
            modality = Modality.MANDATORY

        # Accept any string — teams are now dynamic
        workstream_val = data.get("workstream", "Other")
        if isinstance(workstream_val, Workstream):
            workstream_val = workstream_val.value
        workstream_str = str(workstream_val) if workstream_val else "Other"

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
            workstream=workstream_str,
            needs_legal_review=data.get("needs_legal_review", False),
            validation_status=data.get("validation_status", "pending"),
            validation_notes=data.get("validation_notes", ""),
            approval_status=data.get("approval_status", "pending"),
            is_manual=data.get("is_manual", False),
            published_at=data.get("published_at", ""),
            first_published_at=data.get("first_published_at", ""),
            deadline=data.get("deadline", ""),
            new_product=data.get("new_product", ""),
            product_live_date=data.get("product_live_date", ""),
            task_status=data.get("task_status", ""),
            completion_date=data.get("completion_date", ""),
            reviewer_comments=data.get("reviewer_comments", ""),
            evidence_files=data.get("evidence_files", []),
            comments=data.get("comments", []),
            submitted_at=data.get("submitted_at", ""),
            team_reviewer_name=data.get("team_reviewer_name", ""),
            team_reviewer_approved_at=data.get("team_reviewer_approved_at", ""),
            team_reviewer_rejected_at=data.get("team_reviewer_rejected_at", ""),
            rejection_reason=data.get("rejection_reason", ""),
            is_delayed=data.get("is_delayed", False),
            delay_detected_at=data.get("delay_detected_at", ""),
            justification=data.get("justification", ""),
            justification_by=data.get("justification_by", ""),
            justification_at=data.get("justification_at", ""),
            justification_status=data.get("justification_status", ""),
            # 4-stage justification approval chain
            justification_member_text=data.get("justification_member_text", ""),
            justification_member_at=data.get("justification_member_at", ""),
            justification_member_by=data.get("justification_member_by", ""),
            justification_reviewer_approved=data.get("justification_reviewer_approved", False),
            justification_reviewer_comment=data.get("justification_reviewer_comment", ""),
            justification_reviewer_by=data.get("justification_reviewer_by", ""),
            justification_reviewer_at=data.get("justification_reviewer_at", ""),
            justification_lead_approved=data.get("justification_lead_approved", False),
            justification_lead_comment=data.get("justification_lead_comment", ""),
            justification_lead_by=data.get("justification_lead_by", ""),
            justification_lead_at=data.get("justification_lead_at", ""),
            justification_co_approved=data.get("justification_co_approved", False),
            justification_co_comment=data.get("justification_co_comment", ""),
            justification_co_by=data.get("justification_co_by", ""),
            justification_co_at=data.get("justification_co_at", ""),
            # Shared delay justification workflow
            delay_justification=data.get("delay_justification", ""),
            delay_justification_member_submitted=data.get("delay_justification_member_submitted", False),
            delay_justification_reviewer_approved=data.get("delay_justification_reviewer_approved", False),
            delay_justification_lead_approved=data.get("delay_justification_lead_approved", False),
            delay_justification_updated_by=data.get("delay_justification_updated_by", ""),
            delay_justification_updated_at=data.get("delay_justification_updated_at", ""),
            # Role-specific mandatory comment fields
            member_comment=data.get("member_comment", ""),
            member_comment_history=data.get("member_comment_history", []),
            reviewer_comment=data.get("reviewer_comment", ""),
            lead_comment=data.get("lead_comment", ""),
            co_comment=data.get("co_comment", ""),
            audit_trail=data.get("audit_trail", []),
            regulation_issue_date=data.get("regulation_issue_date", ""),
            circular_effective_date=data.get("circular_effective_date", ""),
            regulator=data.get("regulator", ""),
            actionable_id=data.get("actionable_id", ""),
            created_at=data.get("created_at", ""),
            impact=data.get("impact", ""),
            tranche3=data.get("tranche3", ""),
            control=data.get("control", ""),
            likelihood=data.get("likelihood", ""),
            residual_risk=data.get("residual_risk", ""),
            inherent_risk=data.get("inherent_risk", ""),
            # Structured risk scoring
            likelihood_business_volume=data.get("likelihood_business_volume", {}),
            likelihood_products_processes=data.get("likelihood_products_processes", {}),
            likelihood_compliance_violations=data.get("likelihood_compliance_violations", {}),
            likelihood_score=data.get("likelihood_score", 0),
            # impact_dropdown: prefer new key, fall back to legacy impact_sub1
            impact_dropdown=data.get("impact_dropdown") or data.get("impact_sub1", {}),
            impact_score=data.get("impact_score", 0),
            control_monitoring=data.get("control_monitoring", {}),
            control_effectiveness=data.get("control_effectiveness", {}),
            control_score=data.get("control_score", 0),
            inherent_risk_score=data.get("inherent_risk_score", 0),
            inherent_risk_label=data.get("inherent_risk_label", ""),
            residual_risk_score=data.get("residual_risk_score", 0),
            residual_risk_label=data.get("residual_risk_label", ""),
            residual_risk_interpretation=data.get("residual_risk_interpretation", ""),
            overall_likelihood_score=data.get("overall_likelihood_score", 0),
            overall_impact_score=data.get("overall_impact_score", 0),
            overall_control_score=data.get("overall_control_score", 0),
            # Legacy impact sub-fields (backward compat)
            impact_sub1=data.get("impact_sub1", {}),
            impact_sub2=data.get("impact_sub2", {}),
            impact_sub3=data.get("impact_sub3", {}),
            theme=data.get("theme", ""),
            bypass_tag=data.get("bypass_tag", False),
            bypass_tagged_at=data.get("bypass_tagged_at", ""),
            bypass_tagged_by=data.get("bypass_tagged_by", ""),
            bypass_approved_by=data.get("bypass_approved_by", ""),
            bypass_approved_at=data.get("bypass_approved_at", ""),
            bypass_disapproved_by=data.get("bypass_disapproved_by", ""),
            bypass_disapproved_at=data.get("bypass_disapproved_at", ""),
            bypass_disapproval_reason=data.get("bypass_disapproval_reason", ""),
            bypass_reviewer_rejected_by=data.get("bypass_reviewer_rejected_by", ""),
            bypass_reviewer_rejected_at=data.get("bypass_reviewer_rejected_at", ""),
            bypass_reviewer_rejection_reason=data.get("bypass_reviewer_rejection_reason", ""),
            assigned_teams=data.get("assigned_teams", []),
            team_workflows=data.get("team_workflows", {}),
            published_by_account_id=data.get("published_by_account_id", ""),
            delegated_from_account_id=data.get("delegated_from_account_id", ""),
            delegation_request_id=data.get("delegation_request_id", ""),
        )


@dataclass
class ActionablesResult:
    """Complete extraction result for a document."""

    doc_id: str
    doc_name: str = ""
    regulation_issue_date: str = ""  # ISO date — regulation issued date
    circular_effective_date: str = ""  # ISO date — circular effective date
    regulator: str = ""  # Regulator name
    global_theme: str = ""  # Document-level default theme (Feature 1)
    # ── Document-level likelihood (single source of truth) ──
    document_likelihood_breakdown: dict = field(default_factory=dict)  # {business_volume: {label,score}, products_processes: {label,score}, compliance_violations: {label,score}}
    document_likelihood_score: float = 0  # MAX of 3 breakdown sub-scores
    document_likelihood_owner_team: str = ""  # Per-doc override of bank-level owner team (empty = use global)
    document_likelihood_updated_at: str = ""  # ISO timestamp
    document_likelihood_updated_by: str = ""  # Username/ID of last updater
    document_likelihood_updated_by_role: str = ""  # Role of last updater
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
            key = a.workstream.value if isinstance(a.workstream, Workstream) else str(a.workstream)
            self.by_workstream[key] = self.by_workstream.get(key, 0) + 1

    def to_dict(self) -> dict:
        self.compute_stats()
        return {
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "regulation_issue_date": self.regulation_issue_date,
            "circular_effective_date": self.circular_effective_date,
            "regulator": self.regulator,
            "global_theme": self.global_theme,
            "document_likelihood_breakdown": self.document_likelihood_breakdown,
            "document_likelihood_score": self.document_likelihood_score,
            "document_likelihood_owner_team": self.document_likelihood_owner_team,
            "document_likelihood_updated_at": self.document_likelihood_updated_at,
            "document_likelihood_updated_by": self.document_likelihood_updated_by,
            "document_likelihood_updated_by_role": self.document_likelihood_updated_by_role,
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
            regulation_issue_date=data.get("regulation_issue_date", ""),
            circular_effective_date=data.get("circular_effective_date", ""),
            regulator=data.get("regulator", ""),
            global_theme=data.get("global_theme", ""),
            document_likelihood_breakdown=data.get("document_likelihood_breakdown", {}),
            document_likelihood_score=data.get("document_likelihood_score", 0),
            document_likelihood_owner_team=data.get("document_likelihood_owner_team", ""),
            document_likelihood_updated_at=data.get("document_likelihood_updated_at", ""),
            document_likelihood_updated_by=data.get("document_likelihood_updated_by", ""),
            document_likelihood_updated_by_role=data.get("document_likelihood_updated_by_role", ""),
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
