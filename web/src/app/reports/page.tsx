"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { AuthGuard, getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { useSession } from "@/lib/auth-client"
import { fetchAllActionables } from "@/lib/api"
import { ActionableItem, ActionablesResult, TaskStatus } from "@/lib/types"
import {
    LayoutDashboard, Loader2, Search, Filter,
    Users, MoreHorizontal, Download, AlertTriangle, Shield,
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
    review: "Under Review",
    completed: "Completed",
    reworking: "Reworking",
}

const STATUS_COLORS: Record<TaskStatus, string> = {
    assigned: "#94a3b8",
    in_progress: "#f59e0b",
    review: "#3b82f6",
    completed: "#22c55e",
    reworking: "#f97316",
}

const RISK_COLORS: Record<string, string> = {
    "High Risk": "#ef4444",
    "Medium Risk": "#eab308",
    "Low Risk": "#22c55e",
}

const PIE_COLORS = ["#94a3b8", "#f59e0b", "#3b82f6", "#22c55e", "#f97316"]
const RISK_PIE_COLORS = ["#ef4444", "#eab308", "#22c55e"]

const WORKSTREAM_BAR_COLORS = [
    "#8b5cf6", "#06b6d4", "#3b82f6", "#ec4899",
    "#6366f1", "#0ea5e9", "#7c3aed", "#d946ef", "#71717a",
]

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
                "flex-1 min-w-[130px] bg-card border border-border rounded-lg p-4 text-left transition-all hover:shadow-md",
                filterActive && "ring-2 ring-primary"
            )}
        >
            <h3 className="text-[11px] font-medium text-muted-foreground mb-2">{title}</h3>
            <p className="text-3xl font-bold" style={{ color: color || "var(--foreground)" }}>{value}</p>
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

// ─── Main Content ────────────────────────────────────────────────────────────

function ReportsContent() {
    const { data: session } = useSession()
    const role = getUserRole(session)
    const isOfficer = role === "compliance_officer" || role === "admin"
    const userTeam = getUserTeam(session)

    const [allItems, setAllItems] = React.useState<ActionableItem[]>([])
    const [allActionables, setAllActionables] = React.useState<ActionableItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [statusFilter, setStatusFilter] = React.useState<TaskStatus | "all">("all")

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
        return "d90"
    }, [])

    // Stats
    const stats = React.useMemo(() => {
        const total = allItems.length
        const totalActionables = allActionables.length
        const approved = allActionables.filter(a => a.approval_status === "approved").length
        const pending = allActionables.filter(a => a.approval_status === "pending").length
        const published = allItems.length

        const byStatus: Record<TaskStatus, number> = { assigned: 0, in_progress: 0, review: 0, completed: 0, reworking: 0 }
        for (const a of allItems) {
            const s = (a.task_status || "assigned") as TaskStatus
            byStatus[s] = (byStatus[s] || 0) + 1
        }

        const byRisk: Record<string, number> = { "High Risk": 0, "Medium Risk": 0, "Low Risk": 0 }
        for (const a of allItems) {
            const risk = normalizeRisk(a.modality)
            byRisk[risk] = (byRisk[risk] || 0) + 1
        }

        const byWorkstream: Record<string, { total: number; done: number }> = {}
        for (const a of allItems) {
            const team = safeStr(a.workstream) || "Other"
            if (!byWorkstream[team]) byWorkstream[team] = { total: 0, done: 0 }
            byWorkstream[team].total++
            if (a.task_status === "completed") byWorkstream[team].done++
        }

        const completionRate = total > 0 ? ((byStatus.completed / total) * 100).toFixed(1) : "0"

        // Deadline adherence stats
        const dlMet = allItems.filter(a => a.task_status === "completed" && a.deadline && a.completion_date && new Date(a.completion_date).getTime() <= new Date(a.deadline).getTime()).length
        const dlMissed = allItems.filter(a => a.task_status === "completed" && a.deadline && a.completion_date && new Date(a.completion_date).getTime() > new Date(a.deadline).getTime()).length
        const dlYet = allItems.filter(a => dlCategory(a.deadline, a.task_status) === "yet").length
        const dlD30 = allItems.filter(a => dlCategory(a.deadline, a.task_status) === "d30").length
        const dlD60 = allItems.filter(a => dlCategory(a.deadline, a.task_status) === "d60").length
        const dlD90 = allItems.filter(a => dlCategory(a.deadline, a.task_status) === "d90").length

        // Workload by team (how many active tasks each team has)
        const workload: Record<string, { active: number; review: number; completed: number; reworking: number }> = {}
        for (const a of allItems) {
            const team = safeStr(a.workstream) || "Other"
            if (!workload[team]) workload[team] = { active: 0, review: 0, completed: 0, reworking: 0 }
            const s = a.task_status || "assigned"
            if (s === "assigned" || s === "in_progress") workload[team].active++
            else if (s === "review") workload[team].review++
            else if (s === "completed") workload[team].completed++
            else if (s === "reworking") workload[team].reworking++
        }

        return {
            total, totalActionables, approved, pending, published,
            byStatus, byRisk, byWorkstream, completionRate,
            dlMet, dlMissed, dlYet, dlD30, dlD60, dlD90,
            workload,
        }
    }, [allItems, allActionables, dlCategory])

    // Pie chart data — by status
    const statusPieData = React.useMemo(() => {
        const statuses: TaskStatus[] = ["assigned", "in_progress", "review", "completed", "reworking"]
        return statuses.map((s, i) => ({
            label: STATUS_LABELS[s],
            value: stats.byStatus[s],
            color: PIE_COLORS[i],
        }))
    }, [stats.byStatus])

    // Pie chart data — by risk
    const riskPieData = React.useMemo(() => {
        const risks = ["High Risk", "Medium Risk", "Low Risk"]
        return risks.map((r, i) => ({
            label: r,
            value: stats.byRisk[r],
            color: RISK_PIE_COLORS[i],
        }))
    }, [stats.byRisk])

    // Bar chart data — by workstream
    const workstreamBarData = React.useMemo(() => {
        return Object.entries(stats.byWorkstream)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([label, { total }], i) => ({
                label,
                value: total,
                color: WORKSTREAM_BAR_COLORS[i % WORKSTREAM_BAR_COLORS.length],
            }))
    }, [stats.byWorkstream])

    // Deadline adherence pie
    const deadlinePieData = React.useMemo(() => [
        { label: "Met Deadline", value: stats.dlMet, color: "#22c55e" },
        { label: "Missed Deadline", value: stats.dlMissed, color: "#ef4444" },
        { label: "Yet to Deadline", value: stats.dlYet, color: "#3b82f6" },
    ], [stats.dlMet, stats.dlMissed, stats.dlYet])

    // Delay breakdown bar
    const delayBarData = React.useMemo(() => [
        { label: "Yet to DL", value: stats.dlYet, color: "#22c55e" },
        { label: "Delayed ≤30d", value: stats.dlD30, color: "#f59e0b" },
        { label: "Delayed ≤60d", value: stats.dlD60, color: "#f97316" },
        { label: "Delayed >60d", value: stats.dlD90, color: "#ef4444" },
    ], [stats.dlYet, stats.dlD30, stats.dlD60, stats.dlD90])

    // Workload stacked bar data
    const workloadData = React.useMemo(() => {
        return Object.entries(stats.workload)
            .sort((a, b) => {
                const aTotal = a[1].active + a[1].review + a[1].completed + a[1].reworking
                const bTotal = b[1].active + b[1].review + b[1].completed + b[1].reworking
                return bTotal - aTotal
            })
    }, [stats.workload])

    // Team member individual stats
    const myTeamStats = React.useMemo(() => {
        if (isOfficer || !userTeam) return null
        const teamItems = allItems.filter(a => safeStr(a.workstream) === userTeam)
        const total = teamItems.length
        const byStatus: Record<TaskStatus, number> = { assigned: 0, in_progress: 0, review: 0, completed: 0, reworking: 0 }
        for (const a of teamItems) {
            const s = (a.task_status || "assigned") as TaskStatus
            byStatus[s] = (byStatus[s] || 0) + 1
        }
        const byRisk: Record<string, number> = { "High Risk": 0, "Medium Risk": 0, "Low Risk": 0 }
        for (const a of teamItems) {
            const risk = normalizeRisk(a.modality)
            byRisk[risk] = (byRisk[risk] || 0) + 1
        }
        const completionRate = total > 0 ? ((byStatus.completed / total) * 100).toFixed(1) : "0"
        return { total, byStatus, byRisk, completionRate, teamItems }
    }, [allItems, isOfficer, userTeam])

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <LayoutDashboard className="h-4 w-4 text-primary" />
                        Reports & Analytics
                    </h1>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors">
                        <Download className="h-3 w-3" /> Export
                    </button>
                </div>

                {/* ── Dashboard content ── */}
                <div className="flex-1 overflow-auto p-5 space-y-5">
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading dashboard...</span>
                        </div>
                    )}

                    {!loading && (
                        <>
                            {/* ── My Team Performance (team members only) ── */}
                            {!isOfficer && myTeamStats && (
                                <div>
                                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                                        My Team — {userTeam}
                                    </h2>
                                    <div className="flex gap-3 flex-wrap mb-4">
                                        <KpiCard title="Total Assigned" value={myTeamStats.total} />
                                        <KpiCard title="Completed" value={myTeamStats.byStatus.completed} color="#22c55e" />
                                        <KpiCard title="In Progress" value={myTeamStats.byStatus.in_progress} color="#f59e0b" />
                                        <KpiCard title="Under Review" value={myTeamStats.byStatus.review} color="#3b82f6" />
                                        <KpiCard title="Reworking" value={myTeamStats.byStatus.reworking} color="#f97316" />
                                        <KpiCard title="Completion Rate" value={Number(myTeamStats.completionRate)} color="#22c55e" />
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div className="bg-card border border-border rounded-lg p-5">
                                            <h3 className="text-sm font-medium text-foreground mb-4">My Tasks by Status</h3>
                                            <PieChart data={
                                                (["assigned", "in_progress", "review", "completed", "reworking"] as TaskStatus[]).map((s, i) => ({
                                                    label: STATUS_LABELS[s],
                                                    value: myTeamStats.byStatus[s],
                                                    color: PIE_COLORS[i],
                                                }))
                                            } />
                                        </div>
                                        <div className="bg-card border border-border rounded-lg p-5">
                                            <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                                                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                                                My Tasks by Risk Level
                                            </h3>
                                            <PieChart data={
                                                ["High Risk", "Medium Risk", "Low Risk"].map((r, i) => ({
                                                    label: r,
                                                    value: myTeamStats.byRisk[r],
                                                    color: RISK_PIE_COLORS[i],
                                                }))
                                            } />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ── Overview KPIs (Compliance Officer) ── */}
                            {isOfficer && (
                            <div>
                                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Overview</h2>
                                <div className="flex gap-3 flex-wrap">
                                    <KpiCard title="Total Actionables" value={stats.totalActionables} />
                                    <KpiCard title="Approved" value={stats.approved} color="#22c55e" />
                                    <KpiCard title="Pending Review" value={stats.pending} color="#94a3b8" />
                                    <KpiCard title="Published to Tracker" value={stats.published} color="#3b82f6" />
                                    <KpiCard title="Completion Rate" value={Number(stats.completionRate)} color="#22c55e" />
                                </div>
                            </div>
                            )}

                            {/* ── Status KPIs — clickable filter ── */}
                            <div>
                                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tasks by Status (Published)</h2>
                                <div className="flex gap-3 flex-wrap">
                                    <KpiCard
                                        title="All Published"
                                        value={stats.total}
                                        filterActive={statusFilter === "all"}
                                        onClick={() => setStatusFilter("all")}
                                    />
                                    <KpiCard
                                        title="Assigned"
                                        value={stats.byStatus.assigned}
                                        color={STATUS_COLORS.assigned}
                                        filterActive={statusFilter === "assigned"}
                                        onClick={() => setStatusFilter("assigned")}
                                    />
                                    <KpiCard
                                        title="In Progress"
                                        value={stats.byStatus.in_progress}
                                        color={STATUS_COLORS.in_progress}
                                        filterActive={statusFilter === "in_progress"}
                                        onClick={() => setStatusFilter("in_progress")}
                                    />
                                    <KpiCard
                                        title="Under Review"
                                        value={stats.byStatus.review}
                                        color={STATUS_COLORS.review}
                                        filterActive={statusFilter === "review"}
                                        onClick={() => setStatusFilter("review")}
                                    />
                                    <KpiCard
                                        title="Completed"
                                        value={stats.byStatus.completed}
                                        color={STATUS_COLORS.completed}
                                        filterActive={statusFilter === "completed"}
                                        onClick={() => setStatusFilter("completed")}
                                    />
                                    <KpiCard
                                        title="Reworking"
                                        value={stats.byStatus.reworking}
                                        color={STATUS_COLORS.reworking}
                                        filterActive={statusFilter === "reworking"}
                                        onClick={() => setStatusFilter("reworking")}
                                    />
                                </div>
                            </div>

                            {/* ── Charts row ── */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Pie chart: Tasks by status */}
                                <div className="bg-card border border-border rounded-lg p-5">
                                    <h3 className="text-sm font-medium text-foreground mb-4">Tasks by Status</h3>
                                    <PieChart data={statusPieData} />
                                </div>

                                {/* Pie chart: Tasks by risk */}
                                <div className="bg-card border border-border rounded-lg p-5">
                                    <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                                        Tasks by Risk Level
                                    </h3>
                                    <PieChart data={riskPieData} />
                                </div>
                            </div>

                            {/* ── Bar chart: by workstream ── */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                    Tasks by Team / Workstream
                                </h3>
                                {workstreamBarData.length > 0 ? (
                                    <BarChart data={workstreamBarData} />
                                ) : (
                                    <div className="flex items-center justify-center h-40 text-muted-foreground/40 text-sm">No data</div>
                                )}
                            </div>

                            {/* ── Progress by team ── */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <h3 className="text-sm font-medium text-foreground mb-4">Completion Progress by Team</h3>
                                <div className="space-y-2">
                                    {Object.entries(stats.byWorkstream)
                                        .sort((a, b) => b[1].total - a[1].total)
                                        .map(([team, { total, done }]) => {
                                            const pct = total > 0 ? ((done / total) * 100).toFixed(0) : "0"
                                            return (
                                                <div key={team} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/10 transition-colors">
                                                    <span className="text-xs text-foreground font-medium truncate max-w-[200px]">{team}</span>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-xs font-mono font-bold text-foreground">{done}<span className="text-muted-foreground/50 font-normal">/{total}</span></span>
                                                        <span className={cn(
                                                            "text-xs font-bold font-mono min-w-[40px] text-right",
                                                            Number(pct) === 100 ? "text-emerald-500" : Number(pct) >= 50 ? "text-amber-500" : "text-muted-foreground"
                                                        )}>
                                                            {pct}%
                                                        </span>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    {Object.keys(stats.byWorkstream).length === 0 && (
                                        <div className="text-sm text-muted-foreground/40 text-center py-8">
                                            No published tasks yet
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Risk breakdown by team ── */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                                    Risk Distribution by Team
                                </h3>
                                <div className="space-y-3">
                                    {(() => {
                                        const teamRisk: Record<string, Record<string, number>> = {}
                                        for (const a of allItems) {
                                            const team = safeStr(a.workstream) || "Other"
                                            const risk = normalizeRisk(a.modality)
                                            if (!teamRisk[team]) teamRisk[team] = { "High Risk": 0, "Medium Risk": 0, "Low Risk": 0 }
                                            teamRisk[team][risk]++
                                        }
                                        return Object.entries(teamRisk)
                                            .sort((a, b) => {
                                                const aTotal = Object.values(a[1]).reduce((s, v) => s + v, 0)
                                                const bTotal = Object.values(b[1]).reduce((s, v) => s + v, 0)
                                                return bTotal - aTotal
                                            })
                                            .map(([team, risks]) => {
                                                const total = Object.values(risks).reduce((s, v) => s + v, 0)
                                                return (
                                                    <div key={team} className="flex items-center gap-3">
                                                        <span className="text-xs text-foreground w-44 truncate font-medium">{team}</span>
                                                        <div className="flex-1 h-3 rounded-full overflow-hidden flex bg-muted/30">
                                                            {["High Risk", "Medium Risk", "Low Risk"].map(r => {
                                                                const pct = total > 0 ? (risks[r] / total) * 100 : 0
                                                                if (pct === 0) return null
                                                                return (
                                                                    <div
                                                                        key={r}
                                                                        className="h-full transition-all"
                                                                        style={{ width: `${pct}%`, backgroundColor: RISK_COLORS[r] }}
                                                                        title={`${r}: ${risks[r]}`}
                                                                    />
                                                                )
                                                            })}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0 w-28">
                                                            <span className="text-[9px] font-mono text-red-500">{risks["High Risk"]}</span>
                                                            <span className="text-[9px] text-muted-foreground/30">/</span>
                                                            <span className="text-[9px] font-mono text-yellow-500">{risks["Medium Risk"]}</span>
                                                            <span className="text-[9px] text-muted-foreground/30">/</span>
                                                            <span className="text-[9px] font-mono text-emerald-500">{risks["Low Risk"]}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })
                                    })()}
                                    {allItems.length === 0 && (
                                        <div className="text-sm text-muted-foreground/40 text-center py-8">
                                            No published tasks yet
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ══════════ Compliance Officer Graphs ══════════ */}
                            {isOfficer && (<>

                            {/* ── Deadline Adherence + Delay Breakdown ── */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-card border border-border rounded-lg p-5">
                                    <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                                        Deadline Adherence
                                    </h3>
                                    <PieChart data={deadlinePieData} />
                                </div>

                                <div className="bg-card border border-border rounded-lg p-5">
                                    <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                                        Delay Breakdown (Active Tasks)
                                    </h3>
                                    <BarChart data={delayBarData} />
                                </div>
                            </div>

                            {/* ── Approvals Overview ── */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                                    <Shield className="h-3.5 w-3.5 text-emerald-500" />
                                    Approvals Overview
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-muted/20 rounded-lg p-4 text-center">
                                        <p className="text-2xl font-bold text-foreground">{stats.totalActionables}</p>
                                        <p className="text-[10px] text-muted-foreground mt-1">Total Extracted</p>
                                    </div>
                                    <div className="bg-emerald-500/10 rounded-lg p-4 text-center">
                                        <p className="text-2xl font-bold text-emerald-500">{stats.approved}</p>
                                        <p className="text-[10px] text-muted-foreground mt-1">Approved</p>
                                    </div>
                                    <div className="bg-yellow-500/10 rounded-lg p-4 text-center">
                                        <p className="text-2xl font-bold text-yellow-500">{stats.pending}</p>
                                        <p className="text-[10px] text-muted-foreground mt-1">Pending Review</p>
                                    </div>
                                    <div className="bg-blue-500/10 rounded-lg p-4 text-center">
                                        <p className="text-2xl font-bold text-blue-500">{stats.published}</p>
                                        <p className="text-[10px] text-muted-foreground mt-1">Published</p>
                                    </div>
                                </div>
                                {stats.totalActionables > 0 && (
                                    <div className="mt-4 flex items-center gap-3">
                                        <span className="text-[10px] text-muted-foreground">Approval Rate</span>
                                        <div className="flex-1 h-2.5 rounded-full bg-muted/30 overflow-hidden">
                                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(stats.approved / stats.totalActionables) * 100}%` }} />
                                        </div>
                                        <span className="text-[10px] font-mono text-muted-foreground">{((stats.approved / stats.totalActionables) * 100).toFixed(1)}%</span>
                                    </div>
                                )}
                            </div>

                            {/* ── Team Workload ── */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                    Team Workload Distribution
                                </h3>
                                <div className="space-y-3">
                                    {workloadData.map(([team, w]) => {
                                        const total = w.active + w.review + w.completed + w.reworking
                                        return (
                                            <div key={team} className="flex items-center gap-3">
                                                <span className="text-xs text-foreground w-44 truncate font-medium">{team}</span>
                                                <div className="flex-1 h-4 rounded-full overflow-hidden flex bg-muted/30">
                                                    {w.active > 0 && (
                                                        <div className="h-full bg-amber-500" style={{ width: `${(w.active / total) * 100}%` }} title={`Active: ${w.active}`} />
                                                    )}
                                                    {w.review > 0 && (
                                                        <div className="h-full bg-blue-500" style={{ width: `${(w.review / total) * 100}%` }} title={`Review: ${w.review}`} />
                                                    )}
                                                    {w.reworking > 0 && (
                                                        <div className="h-full bg-orange-500" style={{ width: `${(w.reworking / total) * 100}%` }} title={`Reworking: ${w.reworking}`} />
                                                    )}
                                                    {w.completed > 0 && (
                                                        <div className="h-full bg-emerald-500" style={{ width: `${(w.completed / total) * 100}%` }} title={`Completed: ${w.completed}`} />
                                                    )}
                                                </div>
                                                <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-8 text-right">{total}</span>
                                            </div>
                                        )
                                    })}
                                    {workloadData.length === 0 && (
                                        <div className="text-sm text-muted-foreground/40 text-center py-8">No data</div>
                                    )}
                                    {workloadData.length > 0 && (
                                        <div className="flex items-center gap-4 pt-2 mt-2 border-t border-border/20">
                                            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-amber-500" /><span className="text-[10px] text-muted-foreground">Active</span></div>
                                            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-blue-500" /><span className="text-[10px] text-muted-foreground">Review</span></div>
                                            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-orange-500" /><span className="text-[10px] text-muted-foreground">Reworking</span></div>
                                            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><span className="text-[10px] text-muted-foreground">Completed</span></div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            </>)}
                        </>
                    )}
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
