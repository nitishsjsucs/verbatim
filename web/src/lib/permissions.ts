import { createAccessControl } from "better-auth/plugins/access"

/**
 * Access control definitions for Govinda v2.
 *
 * Roles:
 *   - compliance_officer: Full access to everything (documents, research, actionables, dashboards, admin)
 *   - team_member: Can only see their team's Monday.com board and submit evidence
 */

export const statement = {
    actionable: ["view", "approve", "reject", "edit", "create", "delete"],
    document: ["view", "upload", "query", "research"],
    dashboard: ["view", "manage"],
    evidence: ["view", "submit"],
    admin: ["manage_users", "manage_roles"],
} as const

export const ac = createAccessControl(statement)

export const complianceOfficer = ac.newRole({
    actionable: ["view", "approve", "reject", "edit", "create", "delete"],
    document: ["view", "upload", "query", "research"],
    dashboard: ["view", "manage"],
    evidence: ["view", "submit"],
    admin: ["manage_users", "manage_roles"],
})

export const teamMember = ac.newRole({
    actionable: ["view"],
    dashboard: ["view"],
    evidence: ["view", "submit"],
})
