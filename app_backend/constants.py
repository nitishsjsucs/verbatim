"""
Shared constants for the GOVINDA backend.

Single source of truth for roles, statuses, field sets, and system names.
Import these instead of using raw magic strings throughout the codebase.
"""
import sys
if sys.version_info >= (3, 11):
    from enum import StrEnum
else:
    from enum import Enum
    class StrEnum(str, Enum):
        """Backport of StrEnum for Python < 3.11."""
        pass


# ---------------------------------------------------------------------------
# User Roles
# ---------------------------------------------------------------------------

class UserRole(StrEnum):
    COMPLIANCE_OFFICER = "compliance_officer"
    TEAM_LEAD = "team_lead"
    TEAM_REVIEWER = "team_reviewer"
    TEAM_MEMBER = "team_member"
    CHIEF = "chief"
    ADMIN = "admin"


# Role groups for permission checks
PRIVILEGED_ROLES = frozenset({UserRole.COMPLIANCE_OFFICER, UserRole.ADMIN})
TEAM_ROLES = frozenset({UserRole.TEAM_MEMBER, UserRole.TEAM_REVIEWER, UserRole.TEAM_LEAD})
INTERNAL_CHAT_ROLES = frozenset({UserRole.TEAM_MEMBER, UserRole.TEAM_REVIEWER, UserRole.TEAM_LEAD})
COMPLIANCE_CHAT_ROLES = frozenset({
    UserRole.TEAM_MEMBER, UserRole.TEAM_REVIEWER, UserRole.TEAM_LEAD, UserRole.COMPLIANCE_OFFICER,
})


# ---------------------------------------------------------------------------
# Task Statuses
# ---------------------------------------------------------------------------

class TaskStatus(StrEnum):
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    TEAM_REVIEW = "team_review"
    REVIEW = "review"
    COMPLETED = "completed"
    REWORKING = "reworking"
    REVIEWER_REJECTED = "reviewer_rejected"
    AWAITING_JUSTIFICATION = "awaiting_justification"
    PENDING_ALL_TEAMS = "pending_all_teams"
    TAGGED_INCORRECTLY = "tagged_incorrectly"
    BYPASS_APPROVED = "bypass_approved"


# Statuses where delay checking is skipped
DELAY_EXEMPT_STATUSES = frozenset({TaskStatus.COMPLETED, ""})

# Statuses where the item should not be further edited by team members
TERMINAL_STATUSES = frozenset({TaskStatus.COMPLETED})


# ---------------------------------------------------------------------------
# Approval / Justification Statuses
# ---------------------------------------------------------------------------

class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class JustificationStatus(StrEnum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"


# ---------------------------------------------------------------------------
# Chat Channels
# ---------------------------------------------------------------------------

class ChatChannel(StrEnum):
    INTERNAL = "internal"
    COMPLIANCE = "compliance"


CHAT_CHANNEL_PREFIX_INTERNAL = "team_internal:"
CHAT_CHANNEL_PREFIX_COMPLIANCE = "team_compliance:"
CHAT_CHANNEL_COMPLIANCE_INTERNAL = "compliance_internal"


# ---------------------------------------------------------------------------
# Risk Assessment — Field Sets
# ---------------------------------------------------------------------------

# Risk fields that only team_member / team_reviewer / team_lead / admin can write.
# compliance_officer is READ-ONLY for these (per spec §11A).
# NOTE: impact_dropdown is NOT in this set — compliance CAN set/confirm impact.
RISK_MEMBER_ONLY_FIELDS = frozenset({
    "likelihood_business_volume",
    "likelihood_products_processes",
    "likelihood_compliance_violations",
    "control_monitoring",
    "control_effectiveness",
})

# Fields that trigger risk score recomputation when changed
RISK_TRIGGER_FIELDS = frozenset({
    "likelihood_business_volume",
    "likelihood_products_processes",
    "likelihood_compliance_violations",
    "impact_dropdown",
    "control_monitoring",
    "control_effectiveness",
})


# ---------------------------------------------------------------------------
# Dropdown Config — Protected Keys
# ---------------------------------------------------------------------------

PROTECTED_DROPDOWN_KEYS = frozenset({
    "impact", "likelihood", "control", "inherent_risk", "residual_risk",
    "tranche3", "theme",
    "likelihood_business_volume", "likelihood_products_processes",
    "likelihood_compliance_violations",
    "impact_dropdown",
    "control_monitoring", "control_effectiveness",
})


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

SYSTEM_TEAM_NAME = "Mixed Team"
DEFAULT_TEAM_NAME = "Technology"


# ---------------------------------------------------------------------------
# Collection Names
# ---------------------------------------------------------------------------

class Collection(StrEnum):
    ACTIONABLES = "actionables"
    ACTIONABLES_FLAT = "actionables_flat"
    TEAMS = "teams"
    TEAM_CHATS = "team_chats"
    GLOBAL_CHATS = "global_chats"
    CHAT_READ_CURSORS = "chat_read_cursors"
    CHAT_CHANNEL_NAMES = "chat_channel_names"
    DROPDOWN_CONFIGS = "dropdown_configs"
    RESIDUAL_RISK_MATRIX = "residual_risk_matrix"
    RUNTIME_CONFIG = "runtime_config"
    COUNTERS = "counters"
    QUERIES = "queries"
    CONVERSATIONS = "conversations"
    TREES = "trees"
    CORPUS = "corpus"
    BENCHMARKS = "benchmarks"


# ---------------------------------------------------------------------------
# Audit Trail Event Types
# ---------------------------------------------------------------------------

class AuditEvent(StrEnum):
    DELAY_DETECTED = "delay_detected"
    JUSTIFICATION_SUBMITTED = "justification_submitted"
    STATUS_CHANGE = "status_change"
    TAGGED_INCORRECTLY = "tagged_incorrectly"
    BYPASS_APPROVED = "bypass_approved"
    TEAM_RESET = "team_reset"


# ---------------------------------------------------------------------------
# Editable Fields Whitelist
# ---------------------------------------------------------------------------

EDITABLE_FIELDS = [
    "actor", "action", "object", "trigger_or_condition",
    "thresholds", "deadline_or_frequency", "effective_date",
    "reporting_or_notification_to", "evidence_quote", "source_location",
    "implementation_notes", "workstream", "needs_legal_review",
    "approval_status", "validation_notes",
    "published_at", "deadline", "task_status", "completion_date",
    "reviewer_comments", "rejection_reason", "evidence_files", "comments",
    "submitted_at", "team_reviewer_name",
    "team_reviewer_approved_at", "team_reviewer_rejected_at",
    "is_delayed", "delay_detected_at",
    "justification", "justification_by", "justification_at",
    "justification_status",
    # 4-stage delay justification approval chain
    "justification_member_text", "justification_member_at", "justification_member_by",
    "justification_reviewer_approved", "justification_reviewer_comment",
    "justification_reviewer_by", "justification_reviewer_at",
    "justification_lead_approved", "justification_lead_comment",
    "justification_lead_by", "justification_lead_at",
    "justification_co_approved", "justification_co_comment",
    "justification_co_by", "justification_co_at",
    # Legacy justification fields (backward compat)
    "justification_reviewer_text", "justification_lead_approved_at",
    "justification_compliance_comment", "justification_compliance_approved_at",
    # Role-specific mandatory comment fields
    "member_comment", "reviewer_comment", "lead_comment", "co_comment",
    "audit_trail",
    "assigned_teams", "team_workflows",
    # Document metadata (inherited from parent doc)
    "regulation_issue_date", "circular_effective_date", "regulator",
    # Unique actionable display ID
    "actionable_id",
    # Risk assessment dropdowns (legacy flat fields kept for compat)
    "impact", "tranche3", "control", "likelihood", "residual_risk", "inherent_risk",
    # Structured risk scoring
    "likelihood_business_volume", "likelihood_products_processes", "likelihood_compliance_violations",
    "likelihood_score",
    "impact_dropdown",
    "impact_score",
    "control_monitoring", "control_effectiveness",
    "control_score",
    "inherent_risk_score", "inherent_risk_label",
    "residual_risk_score", "residual_risk_label",
    "residual_risk_interpretation",
    # Spec-compliant overall score aliases
    "overall_likelihood_score", "overall_impact_score", "overall_control_score",
    # Legacy impact sub-fields (backward compat)
    "impact_sub1", "impact_sub2", "impact_sub3",
    # Theme dropdown
    "theme",
    # Tagged Incorrectly bypass flow
    "bypass_tag", "bypass_tagged_at", "bypass_tagged_by",
    "bypass_approved_by", "bypass_approved_at",
    "bypass_disapproved_by", "bypass_disapproved_at", "bypass_disapproval_reason",
    "bypass_reviewer_rejected_by", "bypass_reviewer_rejected_at", "bypass_reviewer_rejection_reason",
]
