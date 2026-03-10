"use client"

import type { ActionableItem, Team } from "./types"
import { isMultiTeam } from "./types"

export type UserRole = "compliance_officer" | "team_reviewer" | "team_lead" | "team_member" | "chief" | "admin"

/**
 * Determines which teams a user can see based on their role and assigned team.
 * 
 * - CO/Admin: see all teams (global visibility)
 * - Chief: see only their assigned team and all descendants (department/division subtree)
 * - Team Lead/Reviewer/Member: see only their assigned team and all descendants
 * 
 * @param role User's role
 * @param userTeam User's assigned team
 * @param teams All available teams (flat list)
 * @param getDescendants Function to get descendant team names
 * @returns Set of team names visible to the user
 */
export function getVisibleTeamsForRole(
  role: UserRole,
  userTeam: string,
  teams: Team[],
  getDescendants: (teamName: string) => string[]
): Set<string> {
  // CO and Admin see all teams
  if (role === "compliance_officer" || role === "admin") {
    return new Set(teams.filter(t => !t.is_system).map(t => t.name))
  }

  // All other roles (chief, team_lead, team_reviewer, team_member) see their team + descendants
  if (!userTeam) {
    // No team assigned — show nothing
    return new Set<string>()
  }

  // User's team + all descendants
  const visible = [userTeam, ...getDescendants(userTeam)]
  return new Set(visible)
}

/**
 * Filters an actionable item based on visibility rules.
 * 
 * For single-team items: checks if workstream is in visible set
 * For multi-team items: checks if ANY assigned team is in visible set
 * 
 * @param item Actionable item to check
 * @param visibleTeams Set of team names visible to the user
 * @returns true if item should be visible to the user
 */
export function isActionableVisible(
  item: ActionableItem,
  visibleTeams: Set<string>
): boolean {
  // If no visibility restrictions (empty set means no teams visible)
  if (visibleTeams.size === 0) {
    return false
  }

  // Multi-team items: visible if ANY assigned team is in scope
  if (isMultiTeam(item)) {
    const assignedTeams = item.assigned_teams || []
    return assignedTeams.some(team => visibleTeams.has(team))
  }

  // Single-team items: visible if workstream is in scope
  const workstream = item.workstream || "Other"
  return visibleTeams.has(workstream)
}

/**
 * Filters a list of actionable items based on visibility rules.
 * 
 * @param items Actionable items to filter
 * @param visibleTeams Set of team names visible to the user
 * @returns Filtered list of visible items
 */
export function filterActionablesByVisibility(
  items: ActionableItem[],
  visibleTeams: Set<string>
): ActionableItem[] {
  return items.filter(item => isActionableVisible(item, visibleTeams))
}
