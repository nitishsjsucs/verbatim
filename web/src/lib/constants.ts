/**
 * Shared constants — single source of truth for roles, statuses, field names.
 *
 * Mirrors app_backend/constants.py so both layers stay in sync.
 * Import these instead of using raw magic strings throughout the frontend.
 */

// ---------------------------------------------------------------------------
// User Roles
// ---------------------------------------------------------------------------

export const UserRole = {
  COMPLIANCE_OFFICER: "compliance_officer",
  TEAM_LEAD: "team_lead",
  TEAM_REVIEWER: "team_reviewer",
  TEAM_MEMBER: "team_member",
  CHIEF: "chief",
  ADMIN: "admin",
} as const;
export type UserRoleValue = (typeof UserRole)[keyof typeof UserRole];

/** Roles that see the compliance / privileged UI */
export const PRIVILEGED_ROLES: ReadonlySet<string> = new Set([
  UserRole.COMPLIANCE_OFFICER,
  UserRole.ADMIN,
]);

/** Roles that are part of a team */
export const TEAM_ROLES: ReadonlySet<string> = new Set([
  UserRole.TEAM_MEMBER,
  UserRole.TEAM_REVIEWER,
  UserRole.TEAM_LEAD,
]);

// ---------------------------------------------------------------------------
// Task Statuses
// ---------------------------------------------------------------------------

export const TaskStatus = {
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  TEAM_REVIEW: "team_review",
  REVIEW: "review",
  COMPLETED: "completed",
  REWORKING: "reworking",
  REVIEWER_REJECTED: "reviewer_rejected",
  AWAITING_JUSTIFICATION: "awaiting_justification",
  PENDING_ALL_TEAMS: "pending_all_teams",
  TAGGED_INCORRECTLY: "tagged_incorrectly",
  BYPASS_APPROVED: "bypass_approved",
} as const;
export type TaskStatusValue = (typeof TaskStatus)[keyof typeof TaskStatus];

/** Statuses where the item is fully done — no further edits allowed */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  TaskStatus.COMPLETED,
]);

// ---------------------------------------------------------------------------
// Approval / Justification Statuses
// ---------------------------------------------------------------------------

export const ApprovalStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;
export type ApprovalStatusValue =
  (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const JustificationStatus = {
  PENDING_REVIEW: "pending_review",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

// ---------------------------------------------------------------------------
// Chat Channels
// ---------------------------------------------------------------------------

export const ChatChannel = {
  INTERNAL: "internal",
  COMPLIANCE: "compliance",
} as const;

export const CHAT_CHANNEL_PREFIX_INTERNAL = "team_internal:";
export const CHAT_CHANNEL_PREFIX_COMPLIANCE = "team_compliance:";
export const CHAT_CHANNEL_COMPLIANCE_INTERNAL = "compliance_internal";

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export const SYSTEM_TEAM_NAME = "Mixed Team";

// ---------------------------------------------------------------------------
// Audit Trail Event Types
// ---------------------------------------------------------------------------

export const AuditEvent = {
  DELAY_DETECTED: "delay_detected",
  JUSTIFICATION_SUBMITTED: "justification_submitted",
  STATUS_CHANGE: "status_change",
  TAGGED_INCORRECTLY: "tagged_incorrectly",
  BYPASS_APPROVED: "bypass_approved",
  TEAM_RESET: "team_reset",
} as const;
