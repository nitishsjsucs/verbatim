"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { AuthGuard, getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { useSession } from "@/lib/auth-client"
import { fetchAllActionables } from "@/lib/api"
import { ActionableItem, TaskStatus } from "@/lib/types"
import {
    LayoutDashboard, Loader2, Download, AlertTriangle, Shield,
    Users, ChevronDown, ChevronRight, Clock, CheckCircle2,
    TrendingUp, BarChart3, FileText, Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeStr(v: unknown): string {
    if (v === null || v === undefined) return ""
    if (typeof v === "string") return v
    if (typeof v === "number" || typeof v === "boolean") return String(v)
    try { return JSON.stringify(v) } catch { return String(v) }
}

function normalizeRisk(modality: string): string {
    const map: Record<string, string> = {
        "Mandatory": "High Risk",
        "Prohibited": "High Risk",
        "Recommended": "Medium Risk",
        "Permitted": "Low Risk",
    }
    return map[modality] || (["High Risk", "Medium Risk", "Low Risk"].includes(modality) ? modality : "Medium Risk")
}

const STATUS_LABELS: Record<TaskStatus, string> = {
    assigned: "Assigned",
    in_progress: "In Progress",
    team_review: "Team Review",
    review: "Under Review",
    completed: "Completed",
    reworking: "Reworking",
    reviewer_rejected: "Rejected by Reviewer",
    awaiting_justification: "Awaiting Justification",
}

const STATUS_COLORS: Record<TaskStatus, string> = {
    assigned: "#94a3b8",
    in_progress: "#f59e0b",
    team_review: "#14b8a6",
    review: "#3b82f6",
    completed: "#22c55e",
    reworking: "#f97316",
    reviewer_rejected: "#f43f5e",
    awaiting_justification: "#ca8a04",
}

const RISK_COLORS: Record<string, string> = {
    "High Risk": "#ef4444",
    "Medium Risk": "#eab308",
    "Low Risk": "#22c55e",
}

const PIE_COLORS = ["#94a3b8", "#f59e0b", "#14b8a6", "#3b82f6", "#22c55e", "#f97316"]
const RISK_PIE_COLORS = ["#ef4444", "#eab308", "#22c55e"]

const WORKSTREAM_BAR_COLORS = [
    "#8b5cf6", "#06b6d4", "#3b82f6", "#ec4899",
    "#6366f1", "#0ea5e9", "#7c3aed", "#d946ef", "#71717a",
]

// ─── Collapsible Section ─────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true }: {
    title: string
    icon?: React.ReactNode
    children: React.ReactNode
    defaultOpen?: boolean
}) {
    const [open, setOpen] = React.useState(defaultOpen)
    return (
        <div className="border border-border/60 rounded-lg bg-card/50 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-2 py-2.5 px-4 text-left hover:bg-muted/20 transition-colors"
            >
                {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                {icon}
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
            </button>
            {open && <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border/30">{children}</div>}
        </div>
    )
}

// ─── Stat Tile ───────────────────────────────────────────────────────────────

function Stat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
    return (
        <div className="bg-card border border-border/40 rounded-lg px-4 py-3 text-center min-w-[110px]">
            <p className="text-[15px] font-bold font-mono" style={{ color: color || "var(--foreground)" }}>{value}</p>
            <p className="text-[9px] text-muted-foreground/60 mt-0.5">{label}</p>
            {sub && <p className="text-[8px] text-muted-foreground/40 mt-0.5">{sub}</p>}
        </div>
    )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ title, value, color, filterActive, onClick }: {
    title: string
    value: number
    color?: string
    filterActive?: boolean
    onClick?: () => void
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex-1 min-w-[130px] bg-card border border-border/40 rounded-lg p-4 text-left transition-all hover:shadow-md",
                filterActive && "ring-2 ring-primary"
            )}
        >
            <h3 className="text-[11px] font-medium text-muted-foreground mb-2">{title}</h3>
            <p className="text-[15px] font-bold" style={{ color: color || "var(--foreground)" }}>{value}</p>
        </button>
    )
}

// ─── Pie Chart (pure SVG) ────────────────────────────────────────────────────

function PieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
    const total = data.reduce((sum, d) => sum + d.value, 0)
    if (total === 0) {
        return <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">No data</div>
    }

    let cumulative = 0
    const slices = data.filter(d => d.value > 0).map(d => {
        const startAngle = (cumulative / total) * 360
        cumulative += d.value
        const endAngle = (cumulative / total) * 360
        const pct = ((d.value / total) * 100).toFixed(1)
        return { ...d, startAngle, endAngle, pct }
    })

    const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => {
        const rad = ((angle - 90) * Math.PI) / 180
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
    }

    const describeArc = (cx: number, cy: number, r: number, start: number, end: number) => {
        if (end - start >= 360) {
            const mid = start + 180
            const s1 = polarToCartesian(cx, cy, r, start)
            const m1 = polarToCartesian(cx, cy, r, mid)
            const e1 = polarToCartesian(cx, cy, r, end - 0.01)
            return `M ${s1.x} ${s1.y} A ${r} ${r} 0 0 1 ${m1.x} ${m1.y} A ${r} ${r} 0 0 1 ${e1.x} ${e1.y}`
        }
        const s = polarToCartesian(cx, cy, r, start)
        const e = polarToCartesian(cx, cy, r, end)
        const largeArc = end - start > 180 ? 1 : 0
        return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y} Z`
    }

    return (
        <div className="flex items-center gap-6">
            <svg viewBox="0 0 200 200" className="w-40 h-40 shrink-0">
                {slices.map((s, i) => (
                    <path
                        key={i}
                        d={describeArc(100, 100, 85, s.startAngle, s.endAngle)}
                        fill={s.color}
                        stroke="var(--background)"
                        strokeWidth="2"
                    />
                ))}
            </svg>
            <div className="space-y-1.5">
                {slices.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="text-xs text-foreground">{s.label}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{s.value} ({s.pct}%)</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ─── Bar Chart (pure SVG) ────────────────────────────────────────────────────

function BarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
    const maxVal = Math.max(...data.map(d => d.value), 1)
    const barWidth = 50
    const gap = 20
    const chartWidth = data.length * (barWidth + gap) + gap
    const chartHeight = 180
    const ySteps = 5
    const yMax = Math.ceil(maxVal * 1.25) || 1

    return (
        <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${Math.max(chartWidth, 300)} ${chartHeight + 30}`} className="w-full h-48">
                {Array.from({ length: ySteps + 1 }).map((_, i) => {
                    const y = chartHeight - (i / ySteps) * chartHeight
                    const val = ((i / ySteps) * yMax).toFixed(yMax >= 5 ? 0 : 1)
                    return (
                        <g key={i}>
                            <line x1={30} y1={y} x2={chartWidth} y2={y} stroke="var(--border)" strokeWidth="0.5" />
                            <text x={25} y={y + 3} textAnchor="end" className="text-[8px] fill-muted-foreground/50">{val}</text>
                        </g>
                    )
                })}
                {data.map((d, i) => {
                    const barHeight = (d.value / yMax) * chartHeight
                    const x = gap + i * (barWidth + gap) + 30
                    const y = chartHeight - barHeight
                    return (
                        <g key={i}>
                            <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} fill={d.color} rx={3} />
                            <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="text-[9px] fill-foreground font-medium">{d.value}</text>
                            <text x={x + barWidth / 2} y={chartHeight + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground/60">
                                {d.label.length > 10 ? d.label.slice(0, 9) + "…" : d.label}
                            </text>
                        </g>
                    )
                })}
            </svg>
        </div>
    )
}

// ─── Helpers for advanced metrics ────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
    return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24))
}

function daysOpen(item: ActionableItem): number {
    const start = item.published_at || ""
    if (!start) return 0
    const end = item.completion_date || new Date().toISOString()
    return daysBetween(start, end)
}

function upcomingIn(items: ActionableItem[], days: number): ActionableItem[] {
    const now = Date.now()
    const limit = now + days * 86400000
    return items.filter(a => {
        if (a.task_status === "completed") return false
        if (!a.deadline) return false
        const dl = new Date(a.deadline).getTime()
        return dl >= now && dl <= limit
    })
}

// ─── Main Content ────────────────────────────────────────────────────────────

function ReportsContent() {
    const { data: session } = useSession()
    const role = getUserRole(session)
    const isOfficer = role === "compliance_officer" || role === "admin"
    const userTeam = getUserTeam(session)

    const [allItems, setAllItems] = React.useState<ActionableItem[]>([])
    const [allActionables, setAllActionables] = React.useState<ActionableItem[]>([])
    const [loading, setLoading] = React.useState(true)

    const loadData = React.useCallback(async () => {
        try {
            setLoading(true)
            const results = await fetchAllActionables()
            const published: ActionableItem[] = []
            const all: ActionableItem[] = []
            for (const r of results) {
                if (!r.actionables) continue
                for (const a of r.actionables) {
                    all.push(a)
                    if (a.published_at) published.push(a)
                }
            }
            setAllItems(published)
            setAllActionables(all)
        } catch {
            toast.error("Failed to load data")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => { loadData() }, [loadData])

    // Deadline category helper
    const dlCategory = React.useCallback((deadline: string | undefined, status: string | undefined): string => {
        if (!deadline) return "none"
        if (status === "completed") return "met"
        const dl = new Date(deadline).getTime()
        const now = Date.now()
        if (dl >= now) return "yet"
        const days = (now - dl) / (1000 * 60 * 60 * 24)
        if (days <= 30) return "d30"
        if (days <= 60) return "d60"
        if (days <= 90) return "d90"
        return "d90plus"
    }, [])

    // ── Comprehensive stats ──────────────────────────────────────────────────
    const stats = React.useMemo(() => {
        const items = allItems  // published items
        const total = items.length
        const totalActionables = allActionables.length
        const approved = allActionables.filter(a => a.approval_status === "approved").length
        const pending = allActionables.filter(a => a.approval_status === "pending").length

        // By status
        const byStatus: Record<TaskStatus, number> = { assigned: 0, in_progress: 0, team_review: 0, review: 0, completed: 0, reworking: 0, reviewer_rejected: 0, awaiting_justification: 0 }
        for (const a of items) {
            const s = (a.task_status || "assigned") as TaskStatus
            byStatus[s] = (byStatus[s] || 0) + 1
        }
        const openTasks = total - byStatus.completed
        const completionRate = total > 0 ? ((byStatus.completed / total) * 100).toFixed(1) : "0"

        // By risk
        const byRisk: Record<string, number> = { "High Risk": 0, "Medium Risk": 0, "Low Risk": 0 }
        const openByRisk: Record<string, number> = { "High Risk": 0, "Medium Risk": 0, "Low Risk": 0 }
        const overdueByRisk: Record<string, number> = { "High Risk": 0, "Medium Risk": 0, "Low Risk": 0 }
        for (const a of items) {
            const risk = normalizeRisk(a.modality)
            byRisk[risk] = (byRisk[risk] || 0) + 1
            if (a.task_status !== "completed") {
                openByRisk[risk] = (openByRisk[risk] || 0) + 1
                if (a.deadline && new Date(a.deadline).getTime() < Date.now()) {
                    overdueByRisk[risk] = (overdueByRisk[risk] || 0) + 1
                }
            }
        }

        // By workstream
        const byWorkstream: Record<string, { total: number; done: number }> = {}
        for (const a of items) {
            const team = safeStr(a.workstream) || "Other"
            if (!byWorkstream[team]) byWorkstream[team] = { total: 0, done: 0 }
            byWorkstream[team].total++
            if (a.task_status === "completed") byWorkstream[team].done++
        }

        // Deadline buckets
        const dlYet = items.filter(a => dlCategory(a.deadline, a.task_status) === "yet").length
        const dlD30 = items.filter(a => dlCategory(a.deadline, a.task_status) === "d30").length
        const dlD60 = items.filter(a => dlCategory(a.deadline, a.task_status) === "d60").length
        const dlD90 = items.filter(a => dlCategory(a.deadline, a.task_status) === "d90").length
        const dlD90plus = items.filter(a => dlCategory(a.deadline, a.task_status) === "d90plus").length
        const totalOverdue = dlD30 + dlD60 + dlD90 + dlD90plus

        // Upcoming deadlines
        const upcoming7 = upcomingIn(items, 7).length
        const upcoming14 = upcomingIn(items, 14).length
        const upcoming30 = upcomingIn(items, 30).length

        // Average completion time (days)
        const completedItems = items.filter(a => a.task_status === "completed" && a.published_at && a.completion_date)
        const avgCompletionDays = completedItems.length > 0
            ? (completedItems.reduce((sum, a) => sum + daysBetween(a.published_at!, a.completion_date!), 0) / completedItems.length).toFixed(1)
            : "—"

        // Average time in review
        const reviewItems = items.filter(a => a.task_status === "review")
        const avgReviewDays = reviewItems.length > 0
            ? (reviewItems.reduce((sum, a) => sum + daysOpen(a), 0) / reviewItems.length).toFixed(1)
            : "—"

        // High risk open
        const highRiskOpen = openByRisk["High Risk"] || 0

        // Workload by team (detailed)
        const workload: Record<string, { assigned: number; in_progress: number; team_review: number; review: number; completed: number; reworking: number; reviewer_rejected: number; awaiting_justification: number; total: number; avgDays: number; reworkCount: number }> = {}
        for (const a of items) {
            const team = safeStr(a.workstream) || "Other"
            if (!workload[team]) workload[team] = { assigned: 0, in_progress: 0, team_review: 0, review: 0, completed: 0, reworking: 0, reviewer_rejected: 0, awaiting_justification: 0, total: 0, avgDays: 0, reworkCount: 0 }
            const s = (a.task_status || "assigned") as TaskStatus
            workload[team][s] = (workload[team][s] || 0) + 1
            workload[team].total++
        }
        // Compute per-team avg completion and completion rate
        const teamPerf: Record<string, { completionRate: string; avgDays: string; reworkRate: string; stuckAssigned: number }> = {}
        for (const [team, w] of Object.entries(workload)) {
            const teamItems = items.filter(a => (safeStr(a.workstream) || "Other") === team)
            const teamCompleted = teamItems.filter(a => a.task_status === "completed" && a.published_at && a.completion_date)
            const rate = w.total > 0 ? ((w.completed / w.total) * 100).toFixed(1) : "0"
            const avg = teamCompleted.length > 0
                ? (teamCompleted.reduce((s, a) => s + daysBetween(a.published_at!, a.completion_date!), 0) / teamCompleted.length).toFixed(1)
                : "—"
            const reworking = teamItems.filter(a => a.task_status === "reworking").length
            const reworkRate = w.total > 0 ? ((reworking / w.total) * 100).toFixed(1) : "0"
            const stuckAssigned = teamItems.filter(a => a.task_status === "assigned" && daysOpen(a) > 7).length
            teamPerf[team] = { completionRate: rate, avgDays: avg, reworkRate, stuckAssigned }
        }

        // Evidence metrics
        const withEvidence = items.filter(a => a.evidence_files && a.evidence_files.length > 0).length
        const evidenceRate = total > 0 ? ((withEvidence / total) * 100).toFixed(1) : "0"
        const pendingEvidence = items.filter(a => a.task_status !== "completed" && (!a.evidence_files || a.evidence_files.length === 0)).length

        return {
            total, totalActionables, approved, pending, openTasks,
            byStatus, byRisk, openByRisk, overdueByRisk, byWorkstream, completionRate,
            dlYet, dlD30, dlD60, dlD90, dlD90plus, totalOverdue,
            upcoming7, upcoming14, upcoming30,
            avgCompletionDays, avgReviewDays, highRiskOpen,
            workload, teamPerf,
            withEvidence, evidenceRate, pendingEvidence,
        }
    }, [allItems, allActionables, dlCategory])

    // Chart data
    const statusPieData = React.useMemo(() => {
        const statuses: TaskStatus[] = ["assigned", "in_progress", "team_review", "review", "completed", "reworking"]
        return statuses.map((s, i) => ({ label: STATUS_LABELS[s], value: stats.byStatus[s], color: PIE_COLORS[i] }))
    }, [stats.byStatus])

    const riskPieData = React.useMemo(() => {
        return ["High Risk", "Medium Risk", "Low Risk"].map((r, i) => ({ label: r, value: stats.byRisk[r], color: RISK_PIE_COLORS[i] }))
    }, [stats.byRisk])

    const openRiskPieData = React.useMemo(() => {
        return ["High Risk", "Medium Risk", "Low Risk"].map((r, i) => ({ label: r, value: stats.openByRisk[r], color: RISK_PIE_COLORS[i] }))
    }, [stats.openByRisk])

    const overdueRiskBarData = React.useMemo(() => {
        return ["High Risk", "Medium Risk", "Low Risk"].map((r, i) => ({ label: r, value: stats.overdueByRisk[r], color: RISK_PIE_COLORS[i] }))
    }, [stats.overdueByRisk])

    const workstreamBarData = React.useMemo(() => {
        return Object.entries(stats.byWorkstream)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([label, { total }], i) => ({ label, value: total, color: WORKSTREAM_BAR_COLORS[i % WORKSTREAM_BAR_COLORS.length] }))
    }, [stats.byWorkstream])

    const delayBarData = React.useMemo(() => [
        { label: "Not Due", value: stats.dlYet, color: "#22c55e" },
        { label: "0–30d", value: stats.dlD30, color: "#f59e0b" },
        { label: "31–60d", value: stats.dlD60, color: "#f97316" },
        { label: "61–90d", value: stats.dlD90, color: "#ef4444" },
        { label: "90+", value: stats.dlD90plus, color: "#991b1b" },
    ], [stats])

    const deadlinePieData = React.useMemo(() => {
        const met = allItems.filter(a => a.task_status === "completed" && a.deadline && a.completion_date && new Date(a.completion_date).getTime() <= new Date(a.deadline).getTime()).length
        const missed = allItems.filter(a => a.task_status === "completed" && a.deadline && a.completion_date && new Date(a.completion_date).getTime() > new Date(a.deadline).getTime()).length
        return [
            { label: "Met Deadline", value: met, color: "#22c55e" },
            { label: "Missed Deadline", value: missed, color: "#ef4444" },
            { label: "Yet to Deadline", value: stats.dlYet, color: "#3b82f6" },
        ]
    }, [allItems, stats.dlYet])

    // Team member scoped stats
    const myStats = React.useMemo(() => {
        if (isOfficer || !userTeam) return null
        const teamItems = allItems.filter(a => safeStr(a.workstream) === userTeam)
        const total = teamItems.length
        const byStatus: Record<TaskStatus, number> = { assigned: 0, in_progress: 0, team_review: 0, review: 0, completed: 0, reworking: 0, reviewer_rejected: 0, awaiting_justification: 0 }
        for (const a of teamItems) { const s = (a.task_status || "assigned") as TaskStatus; byStatus[s]++ }
        const byRisk: Record<string, number> = { "High Risk": 0, "Medium Risk": 0, "Low Risk": 0 }
        for (const a of teamItems) { byRisk[normalizeRisk(a.modality)]++ }
        const completionRate = total > 0 ? ((byStatus.completed / total) * 100).toFixed(1) : "0"
        const overdue = teamItems.filter(a => a.task_status !== "completed" && a.deadline && new Date(a.deadline).getTime() < Date.now()).length
        const due7 = upcomingIn(teamItems, 7).length
        const due30 = upcomingIn(teamItems, 30).length
        const highRisk = teamItems.filter(a => normalizeRisk(a.modality) === "High Risk" && a.task_status !== "completed").length
        const highRiskDue7 = upcomingIn(teamItems.filter(a => normalizeRisk(a.modality) === "High Risk"), 7).length
        const highRiskOverdue = teamItems.filter(a => normalizeRisk(a.modality) === "High Risk" && a.task_status !== "completed" && a.deadline && new Date(a.deadline).getTime() < Date.now()).length
        const completedItems = teamItems.filter(a => a.task_status === "completed" && a.published_at && a.completion_date)
        const avgDays = completedItems.length > 0
            ? (completedItems.reduce((s, a) => s + daysBetween(a.published_at!, a.completion_date!), 0) / completedItems.length).toFixed(1) : "—"
        const reworking = byStatus.reworking
        const stuckAssigned = teamItems.filter(a => a.task_status === "assigned" && daysOpen(a) > 7).length
        const stuckRework = teamItems.filter(a => a.task_status === "reworking" && daysOpen(a) > 7).length
        const oldestOpen = teamItems.filter(a => a.task_status !== "completed").reduce((max, a) => {
            const d = daysOpen(a); return d > max ? d : max
        }, 0)

        return { total, byStatus, byRisk, completionRate, overdue, due7, due30, highRisk, highRiskDue7, highRiskOverdue, avgDays, reworking, stuckAssigned, stuckRework, oldestOpen, teamItems }
    }, [allItems, isOfficer, userTeam])

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <LayoutDashboard className="h-4 w-4 text-primary" />
                        Reports & Analytics
                    </h1>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors">
                        <Download className="h-3 w-3" /> Export
                    </button>
                </div>

                {/* ── Dashboard content ── */}
                <div className="flex-1 overflow-auto p-6 space-y-3">
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading dashboard...</span>
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════════
                         COMPLIANCE OFFICER DASHBOARD — 8 collapsible sections
                       ═══════════════════════════════════════════════════════════════ */}
                    {!loading && isOfficer && (<>

                        {/* S1: Overall Health */}
                        <Section title="Section 1 — Overall Health" icon={<Activity className="h-3.5 w-3.5 text-emerald-500" />}>
                            <div className="flex gap-3 flex-wrap">
                                <Stat label="Open Tasks" value={stats.openTasks} color={stats.openTasks > 0 ? "#f59e0b" : "#22c55e"} />
                                <Stat label="Completion %" value={`${stats.completionRate}%`} color="#22c55e" />
                                <Stat label="Total Overdue" value={stats.totalOverdue} color={stats.totalOverdue > 0 ? "#ef4444" : "#22c55e"} />
                                <Stat label="High Risk Open" value={stats.highRiskOpen} color={stats.highRiskOpen > 0 ? "#ef4444" : "#22c55e"} />
                                <Stat label="Under Review" value={stats.byStatus.review} color="#3b82f6" />
                                <Stat label="Avg Completion (d)" value={stats.avgCompletionDays} />
                                <Stat label="Avg Review (d)" value={stats.avgReviewDays} />
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-[10px] text-muted-foreground">Completion</span>
                                <div className="flex-1 h-2.5 rounded-full bg-muted/30 overflow-hidden">
                                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${stats.completionRate}%` }} />
                                </div>
                                <span className="text-[10px] font-mono">{stats.completionRate}%</span>
                            </div>
                        </Section>

                        {/* S2: Deadline Pressure */}
                        <Section title="Section 2 — Deadline Pressure" icon={<Clock className="h-3.5 w-3.5 text-amber-500" />}>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-foreground mb-3">Overdue Bucket Distribution</h3>
                                    <BarChart data={delayBarData} />
                                </div>
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-foreground mb-3">Upcoming Deadlines</h3>
                                    <div className="flex gap-3 flex-wrap">
                                        <Stat label="Next 7 Days" value={stats.upcoming7} color={stats.upcoming7 > 0 ? "#ef4444" : "#22c55e"} />
                                        <Stat label="Next 14 Days" value={stats.upcoming14} color="#f59e0b" />
                                        <Stat label="Next 30 Days" value={stats.upcoming30} />
                                    </div>
                                </div>
                            </div>
                        </Section>

                        {/* S3: Risk Exposure */}
                        <Section title="Section 3 — Risk Exposure" icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />}>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-foreground mb-3">Open Tasks by Risk Level</h3>
                                    <PieChart data={openRiskPieData} />
                                </div>
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-foreground mb-3">Overdue Tasks by Risk Level</h3>
                                    <BarChart data={overdueRiskBarData} />
                                </div>
                            </div>
                        </Section>

                        {/* S4: Team Performance */}
                        <Section title="Section 4 — Team Performance" icon={<Users className="h-3.5 w-3.5 text-blue-500" />}>
                            <div className="bg-card border border-border/30 rounded-lg p-4">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-muted-foreground/60">
                                                <th className="text-left py-1.5 px-2 font-medium">Team</th>
                                                <th className="text-right py-1.5 px-2 font-medium">Open</th>
                                                <th className="text-right py-1.5 px-2 font-medium">Completed</th>
                                                <th className="text-right py-1.5 px-2 font-medium">Rate</th>
                                                <th className="text-right py-1.5 px-2 font-medium">Avg Days</th>
                                                <th className="text-right py-1.5 px-2 font-medium">Rework %</th>
                                                <th className="text-right py-1.5 px-2 font-medium">Stuck &gt;7d</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(stats.workload).sort((a, b) => b[1].total - a[1].total).map(([team, w]) => {
                                                const perf = stats.teamPerf[team]
                                                return (
                                                    <tr key={team} className="hover:bg-muted/10">
                                                        <td className="py-1.5 px-2 font-medium text-foreground truncate max-w-[160px]">{team}</td>
                                                        <td className="py-1.5 px-2 text-right font-mono">{w.total - w.completed}</td>
                                                        <td className="py-1.5 px-2 text-right font-mono text-emerald-500">{w.completed}</td>
                                                        <td className="py-1.5 px-2 text-right font-mono">{perf?.completionRate}%</td>
                                                        <td className="py-1.5 px-2 text-right font-mono">{perf?.avgDays}</td>
                                                        <td className="py-1.5 px-2 text-right font-mono">{perf?.reworkRate}%</td>
                                                        <td className="py-1.5 px-2 text-right font-mono" style={{ color: (perf?.stuckAssigned || 0) > 0 ? "#ef4444" : undefined }}>{perf?.stuckAssigned}</td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="bg-card border border-border/30 rounded-lg p-4">
                                <h3 className="text-sm font-medium text-foreground mb-3">Tasks by Team</h3>
                                {workstreamBarData.length > 0 ? <BarChart data={workstreamBarData} /> : <p className="text-sm text-muted-foreground/40 text-center py-4">No data</p>}
                            </div>
                        </Section>

                        {/* S5: Process Bottlenecks */}
                        <Section title="Section 5 — Process Bottlenecks" icon={<TrendingUp className="h-3.5 w-3.5 text-purple-500" />}>
                            <div className="flex gap-3 flex-wrap">
                                {(["assigned", "in_progress", "review", "reworking"] as TaskStatus[]).map(s => {
                                    const itemsInStatus = allItems.filter(a => a.task_status === s)
                                    const avg = itemsInStatus.length > 0
                                        ? (itemsInStatus.reduce((sum, a) => sum + daysOpen(a), 0) / itemsInStatus.length).toFixed(1)
                                        : "—"
                                    return <Stat key={s} label={`Avg Days in ${STATUS_LABELS[s]}`} value={avg} color={STATUS_COLORS[s]} />
                                })}
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                {(["assigned", "in_progress", "review", "reworking", "completed"] as TaskStatus[]).map(s => (
                                    <div key={s} className="bg-muted/20 rounded-lg p-3 text-center">
                                        <p className="text-[15px] font-bold" style={{ color: STATUS_COLORS[s] }}>{stats.byStatus[s]}</p>
                                        <p className="text-[9px] text-muted-foreground mt-1">{STATUS_LABELS[s]}</p>
                                    </div>
                                ))}
                            </div>
                        </Section>

                        {/* S6: Trend Analysis */}
                        <Section title="Section 6 — Trend Analysis" icon={<BarChart3 className="h-3.5 w-3.5 text-cyan-500" />}>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-foreground mb-3">Tasks by Status</h3>
                                    <PieChart data={statusPieData} />
                                </div>
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-foreground mb-3">Deadline Adherence</h3>
                                    <PieChart data={deadlinePieData} />
                                </div>
                            </div>
                            <div className="bg-card border border-border/30 rounded-lg p-4">
                                <h3 className="text-sm font-medium text-foreground mb-3">Completion Progress by Team</h3>
                                <div className="space-y-2">
                                    {Object.entries(stats.byWorkstream).sort((a, b) => b[1].total - a[1].total).map(([team, { total, done }]) => {
                                        const pct = total > 0 ? ((done / total) * 100).toFixed(0) : "0"
                                        return (
                                            <div key={team} className="flex items-center gap-3">
                                                <span className="text-xs text-foreground w-44 truncate font-medium">{team}</span>
                                                <div className="flex-1 h-2.5 rounded-full bg-muted/30 overflow-hidden">
                                                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                                </div>
                                                <span className="text-[10px] font-mono font-bold">{pct}%</span>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </Section>

                        {/* S7: Regulatory Exposure */}
                        <Section title="Section 7 — Regulatory Exposure" icon={<Shield className="h-3.5 w-3.5 text-amber-500" />}>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-foreground mb-3">Tasks by Risk Level</h3>
                                    <PieChart data={riskPieData} />
                                </div>
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-foreground mb-3">Risk Distribution by Team</h3>
                                    <div className="space-y-2">
                                        {(() => {
                                            const teamRisk: Record<string, Record<string, number>> = {}
                                            for (const a of allItems) {
                                                const team = safeStr(a.workstream) || "Other"
                                                const risk = normalizeRisk(a.modality)
                                                if (!teamRisk[team]) teamRisk[team] = { "High Risk": 0, "Medium Risk": 0, "Low Risk": 0 }
                                                teamRisk[team][risk]++
                                            }
                                            return Object.entries(teamRisk).sort((a, b) => {
                                                const aT = Object.values(a[1]).reduce((s, v) => s + v, 0)
                                                const bT = Object.values(b[1]).reduce((s, v) => s + v, 0)
                                                return bT - aT
                                            }).map(([team, risks]) => {
                                                const total = Object.values(risks).reduce((s, v) => s + v, 0)
                                                return (
                                                    <div key={team} className="flex items-center gap-3">
                                                        <span className="text-xs text-foreground w-36 truncate font-medium">{team}</span>
                                                        <div className="flex-1 h-3 rounded-full overflow-hidden flex bg-muted/30">
                                                            {["High Risk", "Medium Risk", "Low Risk"].map(r => {
                                                                const pct = total > 0 ? (risks[r] / total) * 100 : 0
                                                                if (pct === 0) return null
                                                                return <div key={r} className="h-full" style={{ width: `${pct}%`, backgroundColor: RISK_COLORS[r] }} title={`${r}: ${risks[r]}`} />
                                                            })}
                                                        </div>
                                                        <div className="flex gap-1 shrink-0 text-[9px] font-mono">
                                                            <span className="text-red-500">{risks["High Risk"]}</span>
                                                            <span className="text-muted-foreground/30">/</span>
                                                            <span className="text-yellow-500">{risks["Medium Risk"]}</span>
                                                            <span className="text-muted-foreground/30">/</span>
                                                            <span className="text-emerald-500">{risks["Low Risk"]}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </Section>

                        {/* S8: Evidence & Defensibility */}
                        <Section title="Section 8 — Evidence & Defensibility" icon={<FileText className="h-3.5 w-3.5 text-indigo-500" />}>
                            <div className="flex gap-3 flex-wrap">
                                <Stat label="Evidence Submission %" value={`${stats.evidenceRate}%`} color={Number(stats.evidenceRate) >= 80 ? "#22c55e" : "#f59e0b"} />
                                <Stat label="Tasks Pending Evidence" value={stats.pendingEvidence} color={stats.pendingEvidence > 0 ? "#ef4444" : "#22c55e"} />
                                <Stat label="Total Extracted" value={stats.totalActionables} />
                                <Stat label="Approved" value={stats.approved} color="#22c55e" />
                                <Stat label="Pending Review" value={stats.pending} color="#94a3b8" />
                                <Stat label="Published" value={stats.total} color="#3b82f6" />
                            </div>
                            {stats.totalActionables > 0 && (
                                <div className="flex items-center gap-3">
                                    <span className="text-[10px] text-muted-foreground">Approval Rate</span>
                                    <div className="flex-1 h-2.5 rounded-full bg-muted/30 overflow-hidden">
                                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(stats.approved / stats.totalActionables) * 100}%` }} />
                                    </div>
                                    <span className="text-[10px] font-mono">{((stats.approved / stats.totalActionables) * 100).toFixed(1)}%</span>
                                </div>
                            )}
                        </Section>

                    </>)}

                    {/* ═══════════════════════════════════════════════════════════════
                         TEAM MEMBER DASHBOARD — 5 collapsible sections
                       ═══════════════════════════════════════════════════════════════ */}
                    {!loading && !isOfficer && myStats && (<>

                        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                            My Team — {userTeam}
                        </h2>

                        {/* S1: My Workload */}
                        <Section title="Section 1 — My Workload" icon={<Activity className="h-3.5 w-3.5 text-emerald-500" />}>
                            <div className="flex gap-3 flex-wrap">
                                <Stat label="Total Active" value={myStats.total - myStats.byStatus.completed} color="#f59e0b" />
                                <Stat label="Assigned" value={myStats.byStatus.assigned} color={STATUS_COLORS.assigned} />
                                <Stat label="In Progress" value={myStats.byStatus.in_progress} color={STATUS_COLORS.in_progress} />
                                <Stat label="Under Review" value={myStats.byStatus.review} color={STATUS_COLORS.review} />
                                <Stat label="Reworking" value={myStats.byStatus.reworking} color={STATUS_COLORS.reworking} />
                                <Stat label="Completed" value={myStats.byStatus.completed} color={STATUS_COLORS.completed} />
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-[10px] text-muted-foreground">Completion</span>
                                <div className="flex-1 h-2.5 rounded-full bg-muted/30 overflow-hidden">
                                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${myStats.completionRate}%` }} />
                                </div>
                                <span className="text-[10px] font-mono font-bold">{myStats.completionRate}%</span>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium mb-3">Tasks by Status</h3>
                                    <PieChart data={(["assigned", "in_progress", "team_review", "review", "completed", "reworking"] as TaskStatus[]).map((s, i) => ({
                                        label: STATUS_LABELS[s], value: myStats.byStatus[s], color: PIE_COLORS[i],
                                    }))} />
                                </div>
                                <div className="bg-card border border-border/30 rounded-lg p-4">
                                    <h3 className="text-sm font-medium mb-3">Tasks by Risk Level</h3>
                                    <PieChart data={["High Risk", "Medium Risk", "Low Risk"].map((r, i) => ({
                                        label: r, value: myStats.byRisk[r], color: RISK_PIE_COLORS[i],
                                    }))} />
                                </div>
                            </div>
                        </Section>

                        {/* S2: Deadline Awareness */}
                        <Section title="Section 2 — Deadline Awareness" icon={<Clock className="h-3.5 w-3.5 text-amber-500" />}>
                            <div className="flex gap-3 flex-wrap">
                                <Stat label="Overdue" value={myStats.overdue} color={myStats.overdue > 0 ? "#ef4444" : "#22c55e"} />
                                <Stat label="Due in 7 Days" value={myStats.due7} color={myStats.due7 > 0 ? "#f59e0b" : "#22c55e"} />
                                <Stat label="Due in 30 Days" value={myStats.due30} />
                                <Stat label="Oldest Open (d)" value={Math.round(myStats.oldestOpen)} color={myStats.oldestOpen > 30 ? "#ef4444" : undefined} />
                            </div>
                        </Section>

                        {/* S3: Risk Awareness */}
                        <Section title="Section 3 — Risk Awareness" icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />}>
                            <div className="flex gap-3 flex-wrap">
                                <Stat label="High Risk Assigned" value={myStats.highRisk} color={myStats.highRisk > 0 ? "#ef4444" : "#22c55e"} />
                                <Stat label="High Risk Due 7d" value={myStats.highRiskDue7} color={myStats.highRiskDue7 > 0 ? "#ef4444" : "#22c55e"} />
                                <Stat label="High Risk Overdue" value={myStats.highRiskOverdue} color={myStats.highRiskOverdue > 0 ? "#ef4444" : "#22c55e"} />
                            </div>
                        </Section>

                        {/* S4: Personal Performance */}
                        <Section title="Section 4 — Personal Performance" icon={<TrendingUp className="h-3.5 w-3.5 text-purple-500" />}>
                            <div className="flex gap-3 flex-wrap">
                                <Stat label="Avg Completion (d)" value={myStats.avgDays} />
                                <Stat label="Reworking Tasks" value={myStats.reworking} color={myStats.reworking > 0 ? "#f97316" : "#22c55e"} />
                                <Stat label="Completion Rate" value={`${myStats.completionRate}%`} color="#22c55e" />
                            </div>
                        </Section>

                        {/* S5: Work Health */}
                        <Section title="Section 5 — Work Health Indicators" icon={<CheckCircle2 className="h-3.5 w-3.5 text-cyan-500" />}>
                            <div className="flex gap-3 flex-wrap">
                                <Stat label="Stuck Assigned >7d" value={myStats.stuckAssigned} color={myStats.stuckAssigned > 0 ? "#ef4444" : "#22c55e"} />
                                <Stat label="Stuck Rework >7d" value={myStats.stuckRework} color={myStats.stuckRework > 0 ? "#ef4444" : "#22c55e"} />
                            </div>
                        </Section>

                    </>)}
                </div>
            </main>
        </div>
    )
}

// ─── Exported page ───────────────────────────────────────────────────────────

export default function ReportsPage() {
    return (
        <AuthGuard>
            <ReportsContent />
        </AuthGuard>
    )
}
