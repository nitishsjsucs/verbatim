/**
 * Centralized status configuration — colors, labels, utilities.
 *
 * Single source of truth for:
 *  • Risk styles & hex colors
 *  • Task-status styles, labels & hex colors
 *  • Workstream colors
 *  • Role badge styles
 *  • Common helper functions (safeStr, normalizeRisk, formatDate, …)
 */

import type { TaskStatus, ActionableModality } from "./types"

// ─── Utility Functions ───────────────────────────────────────────────────────

/** Safely convert any value to a renderable, trimmed string. */
export function safeStr(v: unknown): string {
    if (v === null || v === undefined) return ""
    if (typeof v === "string") return v
    if (typeof v === "number" || typeof v === "boolean") return String(v)
    try { return JSON.stringify(v) } catch { return String(v) }
}

/** Map legacy modality values to canonical risk levels. */
export function normalizeRisk(modality: string): string {
    const map: Record<string, string> = {
        "Mandatory": "High Risk",
        "Prohibited": "High Risk",
        "Recommended": "Medium Risk",
        "Permitted": "Low Risk",
    }
    return map[modality] || (RISK_STYLES[modality] ? modality : "Medium Risk")
}

/** Format ISO date → "05 Jan 2025" */
export function formatDate(iso: string | undefined): string {
    if (!iso) return "—"
    try {
        const d = new Date(iso)
        const day = String(d.getDate()).padStart(2, "0")
        const month = d.toLocaleDateString("en-US", { month: "short" })
        const year = d.getFullYear()
        return `${day} ${month} ${year}`
    } catch { return iso ?? "—" }
}

/** Format ISO date → "05 Jan" (no year) */
export function formatDateShort(iso: string | undefined): string {
    if (!iso) return "—"
    try {
        const d = new Date(iso)
        const day = String(d.getDate()).padStart(2, "0")
        const month = d.toLocaleDateString("en-US", { month: "short" })
        return `${day} ${month}`
    } catch { return iso ?? "—" }
}

/** Format ISO date → "03:45 PM" */
export function formatTime(iso: string | undefined): string {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
    } catch { return "" }
}

/** Format ISO date → "Jan 5, 2025 03:45 PM" */
export function formatDateTime(iso: string | undefined): string {
    if (!iso) return "—"
    const date = formatDate(iso)
    const time = formatTime(iso)
    return time ? `${date} ${time}` : date
}

/** Bucket an overdue deadline by age. */
export function deadlineCategory(deadline: string | undefined): string {
    if (!deadline) return "none"
    const dl = new Date(deadline).getTime()
    const now = Date.now()
    if (dl >= now) return "yet"
    const days = (now - dl) / (1000 * 60 * 60 * 24)
    if (days <= 30) return "d30"
    if (days <= 60) return "d60"
    return "d90"
}

// ─── Risk Styles (Tailwind classes) ──────────────────────────────────────────

export const RISK_STYLES: Record<string, { bg: string; text: string }> = {
    "High Risk":   { bg: "bg-red-500/15",    text: "text-red-500" },
    "Medium Risk": { bg: "bg-yellow-500/15",  text: "text-yellow-500" },
    "Low Risk":    { bg: "bg-emerald-500/15", text: "text-emerald-500" },
}

// ─── Risk Colors (hex — for SVG / inline styles / charts) ────────────────────

export const RISK_COLORS_HEX: Record<string, string> = {
    "High Risk": "#ef4444",
    "Medium Risk": "#eab308",
    "Low Risk": "#22c55e",
}

// ─── Risk Options ────────────────────────────────────────────────────────────

export const RISK_OPTIONS: ActionableModality[] = ["High Risk", "Medium Risk", "Low Risk"]

// ─── Workstream Colors ───────────────────────────────────────────────────────
// NOTE: This is now a RUNTIME MUTABLE cache populated from the database via
// `syncTeamColors()`. It starts with a minimal fallback so early renders work.

export const DEFAULT_WORKSTREAM_COLORS = { bg: "bg-zinc-500/10", text: "text-zinc-400", header: "bg-zinc-500" }

export const WORKSTREAM_COLORS: Record<string, { bg: string; text: string; header: string }> = {
    "Mixed Team":             { bg: "bg-purple-500/10", text: "text-purple-400", header: "bg-purple-500" },
}

/**
 * Sync the WORKSTREAM_COLORS lookup from the dynamic teams fetched from DB.
 * Call this once after `fetchTeams()` resolves.
 */
export function syncTeamColors(teams: { name: string; colors: { bg: string; text: string; header: string } }[]) {
    // Clear existing entries except keep fallbacks
    for (const key of Object.keys(WORKSTREAM_COLORS)) {
        if (key !== "Mixed Team") {
            delete WORKSTREAM_COLORS[key]
        }
    }
    for (const t of teams) {
        WORKSTREAM_COLORS[t.name] = t.colors
    }
}

/** Flat workstream class string (bg + text combined) for simple badge usage. */
export function getWorkstreamClass(name: string): string {
    const ws = WORKSTREAM_COLORS[name]
    return ws ? `${ws.bg} ${ws.text}` : "bg-muted text-muted-foreground"
}


// ─── Task Status Styles (Tailwind — semi-transparent pills) ──────────────────

export const TASK_STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
    assigned:               { bg: "bg-slate-500/15",   text: "text-slate-400",   label: "Assigned" },
    in_progress:            { bg: "bg-amber-500/15",   text: "text-amber-400",   label: "In Progress" },
    team_review:            { bg: "bg-teal-500/15",    text: "text-teal-400",    label: "Team Review" },
    review:                 { bg: "bg-blue-500/15",    text: "text-blue-400",    label: "Under Review" },
    completed:              { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Completed" },
    reworking:              { bg: "bg-orange-500/15",  text: "text-orange-400",  label: "Reworking" },
    reviewer_rejected:      { bg: "bg-rose-500/15",    text: "text-rose-400",    label: "Rejected by Reviewer" },
    awaiting_justification: { bg: "bg-yellow-600/15",  text: "text-yellow-500",  label: "Awaiting Justification" },
    pending_all_teams:      { bg: "bg-violet-500/15",  text: "text-violet-400",  label: "Pending All Teams" },
    tagged_incorrectly:     { bg: "bg-orange-500/15",  text: "text-orange-400",  label: "Wrongly Tagged — Awaiting Reviewer" },
    bypass_approved:        { bg: "bg-sky-500/15",     text: "text-sky-400",     label: "Wrongly Tagged — Awaiting CO" },
}

// ─── Task Status Colors (hex — for SVG / charts) ────────────────────────────

export const STATUS_COLORS_HEX: Record<TaskStatus, string> = {
    assigned: "#94a3b8",
    in_progress: "#f59e0b",
    team_review: "#14b8a6",
    review: "#3b82f6",
    completed: "#22c55e",
    reworking: "#f97316",
    reviewer_rejected: "#f43f5e",
    awaiting_justification: "#ca8a04",
    pending_all_teams: "#8b5cf6",
    tagged_incorrectly: "#d946ef",
    bypass_approved: "#0ea5e9",
}

// ─── Status Labels (derived from TASK_STATUS_STYLES) ─────────────────────────

export const STATUS_LABELS: Record<TaskStatus, string> = Object.fromEntries(
    Object.entries(TASK_STATUS_STYLES).map(([k, v]) => [k, v.label])
) as Record<TaskStatus, string>

// ─── All Task Statuses (ordered list) ────────────────────────────────────────

export const ALL_TASK_STATUSES: TaskStatus[] = [
    "assigned", "in_progress", "team_review", "review", "completed",
    "reworking", "reviewer_rejected", "awaiting_justification", "pending_all_teams",
    "tagged_incorrectly", "bypass_approved",
]

// ─── Status Sort Order ───────────────────────────────────────────────────────

export const STATUS_SORT_ORDER: Record<string, number> = {
    bypass_approved: 0,
    tagged_incorrectly: 1,
    awaiting_justification: 2,
    pending_all_teams: 3,
    team_review: 4,
    reviewer_rejected: 5,
    review: 6,
    reworking: 7,
    in_progress: 8,
    assigned: 9,
    completed: 10,
}

// ─── Residual Risk Interpretation Styles ─────────────────────────────────────

export const RESIDUAL_RISK_INTERPRETATION_STYLES: Record<string, { bg: string; text: string }> = {
    "Satisfactory (Low)":          { bg: "bg-emerald-500/15", text: "text-emerald-400" },
    "Improvement Needed (Medium)": { bg: "bg-yellow-500/15",  text: "text-yellow-400" },
    "Weak (High)":                 { bg: "bg-red-500/15",     text: "text-red-400" },
}

// ─── Theme Options (categorical — no scoring) ───────────────────────────────

export const THEME_OPTIONS: string[] = [
    "Audit",
    "Branch Banking",
    "Business Continuity",
    "CMS",
    "Compliance",
    "Corporate Governance",
    "Credit Card",
    "Credit Risk",
    "Customer Service",
    "Cyber & Information Security",
    "Debit Card",
    "Deposit",
    "Digital Banking",
    "Employer Communications",
    "Financial Accounting & Records",
    "Information Technology Governance / Data Governance",
    "KYC / AML",
    "Loans & Advances",
    "Market Risk",
    "NPA & Restructuring",
    "Other Operating Regulations",
    "Outsourcing",
    "Priority Sector Lending (PSL)",
    "Third Party Products",
    "Trade & FEMA",
    "Treasury",
    "FCRM (Earlier part of the Vigilance theme)",
]

// ─── Role Badge Config ──────────────────────────────────────────────────────

export const ROLE_BADGE: Record<string, { label: string; className: string }> = {
    compliance_officer: { label: "CO",       className: "bg-pink-500/15 text-pink-400" },
    team_lead:          { label: "Lead",     className: "bg-indigo-500/15 text-indigo-400" },
    team_reviewer:      { label: "Reviewer", className: "bg-teal-500/15 text-teal-400" },
    team_member:        { label: "Member",   className: "bg-amber-500/15 text-amber-400" },
    chief:              { label: "Chief",    className: "bg-purple-500/15 text-purple-400" },
    admin:              { label: "Admin",    className: "bg-red-500/15 text-red-400" },
}
