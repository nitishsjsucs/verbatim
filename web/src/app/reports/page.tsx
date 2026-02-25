"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { AuthGuard, getUserRole } from "@/components/auth/auth-guard"
import { useSession } from "@/lib/auth-client"
import { fetchAllActionables } from "@/lib/api"
import { ActionableItem, ActionablesResult, TaskStatus } from "@/lib/types"
import {
    LayoutDashboard, Loader2, Search, Filter,
    Users, MoreHorizontal, Download,
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

const STATUS_LABELS: Record<TaskStatus, string> = {
    assigned: "Assigned",
    in_progress: "In Progress",
    review: "Under Review",
    completed: "Completed",
    reworking: "Reworking",
}

const STATUS_COLORS: Record<TaskStatus, string> = {
    assigned: "#94a3b8",    // slate
    in_progress: "#f59e0b", // amber
    review: "#3b82f6",      // blue
    completed: "#22c55e",   // green
    reworking: "#f97316",   // orange
}

const PIE_COLORS = ["#94a3b8", "#f59e0b", "#3b82f6", "#22c55e", "#f97316"]

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ title, value, filterActive, onClick }: {
    title: string
    value: number
    filterActive?: boolean
    onClick?: () => void
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex-1 min-w-[160px] bg-card border border-border rounded-lg p-5 text-left transition-all hover:shadow-md",
                filterActive && "ring-2 ring-primary"
            )}
        >
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-foreground">{title}</h3>
                <div className="flex items-center gap-1">
                    <Filter className="h-3 w-3 text-muted-foreground/40" />
                    <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/40" />
                </div>
            </div>
            <p className="text-4xl font-bold text-foreground">{value}</p>
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
            // Full circle — draw two half arcs
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
            <svg viewBox="0 0 200 200" className="w-44 h-44 shrink-0">
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
            <div className="space-y-2">
                {slices.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="text-xs text-foreground">{s.label}: {s.pct}%</span>
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
                {/* Y-axis lines */}
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
                {/* Bars */}
                {data.map((d, i) => {
                    const barHeight = (d.value / yMax) * chartHeight
                    const x = gap + i * (barWidth + gap) + 30
                    const y = chartHeight - barHeight
                    return (
                        <g key={i}>
                            <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={Math.max(barHeight, 1)}
                                fill={d.color}
                                rx={3}
                            />
                            <text
                                x={x + barWidth / 2}
                                y={y - 4}
                                textAnchor="middle"
                                className="text-[9px] fill-foreground font-medium"
                            >
                                {d.value}
                            </text>
                            <text
                                x={x + barWidth / 2}
                                y={chartHeight + 14}
                                textAnchor="middle"
                                className="text-[8px] fill-muted-foreground/60"
                            >
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
    const isComplianceOfficer = role === "compliance_officer" || role === "admin"

    const [allItems, setAllItems] = React.useState<ActionableItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [statusFilter, setStatusFilter] = React.useState<TaskStatus | "all">("all")

    const loadData = React.useCallback(async () => {
        try {
            setLoading(true)
            const results = await fetchAllActionables()
            const items: ActionableItem[] = []
            for (const r of results) {
                if (!r.actionables) continue
                for (const a of r.actionables) {
                    if (a.published_at) items.push(a)
                }
            }
            setAllItems(items)
        } catch {
            toast.error("Failed to load data")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => { loadData() }, [loadData])

    // Stats
    const stats = React.useMemo(() => {
        const items = statusFilter === "all" ? allItems : allItems.filter(a => (a.task_status || "assigned") === statusFilter)
        const total = allItems.length
        const byStatus: Record<TaskStatus, number> = { assigned: 0, in_progress: 0, review: 0, completed: 0, reworking: 0 }
        for (const a of allItems) {
            const s = (a.task_status || "assigned") as TaskStatus
            byStatus[s] = (byStatus[s] || 0) + 1
        }

        // By owner (actor)
        const byOwner: Record<string, number> = {}
        for (const a of items) {
            const owner = safeStr(a.actor) || "Unassigned"
            byOwner[owner] = (byOwner[owner] || 0) + 1
        }

        return { total, byStatus, byOwner, filteredCount: items.length }
    }, [allItems, statusFilter])

    // Pie chart data
    const pieData = React.useMemo(() => {
        const statuses: TaskStatus[] = ["assigned", "in_progress", "review", "completed", "reworking"]
        return statuses.map((s, i) => ({
            label: STATUS_LABELS[s],
            value: stats.byStatus[s],
            color: PIE_COLORS[i],
        }))
    }, [stats.byStatus])

    // Bar chart data (by owner)
    const barData = React.useMemo(() => {
        const entries = Object.entries(stats.byOwner).sort((a, b) => b[1] - a[1]).slice(0, 10)
        const colors = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#818cf8", "#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#818cf8"]
        return entries.map(([label, value], i) => ({
            label,
            value,
            color: colors[i % colors.length],
        }))
    }, [stats.byOwner])

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <div className="flex items-center gap-3">
                        <h1 className="text-sm font-semibold text-foreground">
                            Dashboard and reporting
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors">
                            <Download className="h-3 w-3" /> Export
                        </button>
                    </div>
                </div>

                {/* ── Toolbar ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2">
                    <div className="bg-primary/10 text-primary text-[11px] font-medium px-3 py-1 rounded-md">
                        + Add widget
                    </div>
                    <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                        1 connected board
                    </span>
                    <div className="flex-1" />
                    <div className="relative max-w-xs">
                        <Search className="absolute left-2.5 top-[6px] h-3 w-3 text-muted-foreground/40" />
                        <input placeholder="Type to filter" className="bg-muted/20 text-xs rounded-md pl-7 pr-3 py-1 border border-transparent focus:border-border focus:outline-none w-40" />
                    </div>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors">
                        <Users className="h-3 w-3" /> People
                    </button>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/30 transition-colors">
                        <Filter className="h-3 w-3" /> Filter
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
                            {/* ── KPI Cards row ── */}
                            <div className="flex gap-4 flex-wrap">
                                <KpiCard
                                    title="All Tasks"
                                    value={stats.total}
                                    filterActive={statusFilter === "all"}
                                    onClick={() => setStatusFilter("all")}
                                />
                                <KpiCard
                                    title="In Progress"
                                    value={stats.byStatus.in_progress}
                                    filterActive={statusFilter === "in_progress"}
                                    onClick={() => setStatusFilter("in_progress")}
                                />
                                <KpiCard
                                    title="Completed"
                                    value={stats.byStatus.completed}
                                    filterActive={statusFilter === "completed"}
                                    onClick={() => setStatusFilter("completed")}
                                />
                                <KpiCard
                                    title="Reworking"
                                    value={stats.byStatus.reworking}
                                    filterActive={statusFilter === "reworking"}
                                    onClick={() => setStatusFilter("reworking")}
                                />
                            </div>

                            {/* ── Charts row ── */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Pie chart: Tasks by status */}
                                <div className="bg-card border border-border rounded-lg p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-sm font-medium text-foreground">Tasks by status</h3>
                                        <div className="flex items-center gap-1">
                                            <Filter className="h-3 w-3 text-muted-foreground/40" />
                                            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/40" />
                                        </div>
                                    </div>
                                    <PieChart data={pieData} />
                                </div>

                                {/* Bar chart: Tasks by owner */}
                                <div className="bg-card border border-border rounded-lg p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-sm font-medium text-foreground">Tasks by owner</h3>
                                        <div className="flex items-center gap-1">
                                            <Filter className="h-3 w-3 text-muted-foreground/40" />
                                            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/40" />
                                        </div>
                                    </div>
                                    {barData.length > 0 ? (
                                        <BarChart data={barData} />
                                    ) : (
                                        <div className="flex items-center justify-center h-40 text-muted-foreground/40 text-sm">
                                            No data to display
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Breakdown by workstream ── */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-medium text-foreground">Tasks by team / workstream</h3>
                                    <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/40" />
                                </div>
                                <div className="space-y-2">
                                    {(() => {
                                        const byTeam: Record<string, { total: number; done: number }> = {}
                                        for (const a of allItems) {
                                            const team = safeStr(a.workstream) || "Other"
                                            if (!byTeam[team]) byTeam[team] = { total: 0, done: 0 }
                                            byTeam[team].total++
                                            if (a.task_status === "completed") byTeam[team].done++
                                        }
                                        return Object.entries(byTeam)
                                            .sort((a, b) => b[1].total - a[1].total)
                                            .map(([team, { total, done }]) => (
                                                <div key={team} className="flex items-center gap-3">
                                                    <span className="text-xs text-foreground w-40 truncate">{team}</span>
                                                    <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
                                                        <div
                                                            className="h-full bg-emerald-500 rounded-full transition-all"
                                                            style={{ width: `${(done / (total || 1)) * 100}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground font-mono w-16 text-right">
                                                        {done}/{total}
                                                    </span>
                                                </div>
                                            ))
                                    })()}
                                </div>
                            </div>
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
