import { createAccessControl } from "better-auth/plugins/access"

/**
 * Access control definitions for Govinda v2.
 *
 * Roles:
 *   - compliance_officer: Full access to everything (documents, research, actionables, dashboards, admin)
 *   - team_reviewer: Intermediate reviewer — can approve/reject team submissions before compliance officer
 *   - team_lead: Oversight role — can view all team tasks, provide justifications, read-only
 *   - team_member: Can only see their team's board and submit evidence
 */

export const statement = {
    actionable: ["view", "approve", "reject", "edit", "create", "delete"],
    document: ["view", "upload", "query", "research"],
    dashboard: ["view", "manage"],
    evidence: ["view", "submit"],
    admin: ["manage_users", "manage_roles"],
    delay: ["view", "justify"],
} as const

export const ac = createAccessControl(statement)

export const complianceOfficer = ac.newRole({
    actionable: ["view", "approve", "reject", "edit", "create", "delete"],
    document: ["view", "upload", "query", "research"],
    dashboard: ["view", "manage"],
    evidence: ["view", "submit"],
    admin: ["manage_users", "manage_roles"],
    delay: ["view", "justify"],
})

export const teamReviewer = ac.newRole({
    actionable: ["view", "approve", "reject"],
    dashboard: ["view"],
    evidence: ["view", "submit"],
    delay: ["view"],
})

export const teamLead = ac.newRole({
    actionable: ["view"],
    dashboard: ["view"],
    evidence: ["view"],
    delay: ["view", "justify"],
})

export const teamMember = ac.newRole({
    actionable: ["view"],
    dashboard: ["view"],
    evidence: ["view", "submit"],
})

export const chief = ac.newRole({
    actionable: ["view"],
    dashboard: ["view"],
    evidence: ["view"],
    delay: ["view", "justify"],
})
