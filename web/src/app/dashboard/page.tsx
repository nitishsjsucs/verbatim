"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import {
    fetchAllActionables,
    updateActionable,
} from "@/lib/api"
import {
    ActionableItem,
    ActionablesResult,
    ActionableWorkstream,
    TaskStatus,
} from "@/lib/types"
import {
    LayoutDashboard, ChevronDown, ChevronRight,
    Loader2, Search, AlertTriangle,
    Paperclip, Calendar,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { RoleRedirect } from "@/components/auth/role-redirect"

// ─── Constants ───────────────────────────────────────────────────────────────

const WORKSTREAM_OPTIONS: ActionableWorkstream[] = [
    "Policy", "Technology", "Operations", "Training",
    "Reporting", "Customer Communication", "Governance", "Legal", "Other",
]

const RISK_OPTIONS = ["High Risk", "Medium Risk", "Low Risk"]

function safeStr(v: unknown): string {
    if (v === null || v === undefined) return ""
    if (typeof v === "string") return v
    if (typeof v === "number" || typeof v === "boolean") return String(v)
    try { return JSON.stringify(v) } catch { return String(v) }
}

// ─── Color configs ───────────────────────────────────────────────────────────

const WORKSTREAM_COLORS: Record<string, { bg: string; text: string; header: string }> = {
    Policy:                   { bg: "bg-purple-500/10", text: "text-purple-400", header: "bg-purple-500" },
    Technology:               { bg: "bg-cyan-500/10",   text: "text-cyan-400",   header: "bg-cyan-500" },
    Operations:               { bg: "bg-blue-500/10",   text: "text-blue-400",   header: "bg-blue-500" },
    Training:                 { bg: "bg-pink-500/10",   text: "text-pink-400",   header: "bg-pink-500" },
    Reporting:                { bg: "bg-indigo-500/10",  text: "text-indigo-400", header: "bg-indigo-500" },
    "Customer Communication": { bg: "bg-sky-500/10",    text: "text-sky-400",    header: "bg-sky-500" },
    Governance:               { bg: "bg-violet-500/10", text: "text-violet-400", header: "bg-violet-500" },
    Legal:                    { bg: "bg-fuchsia-500/10", text: "text-fuchsia-400", header: "bg-fuchsia-500" },
    Other:                    { bg: "bg-zinc-500/10",   text: "text-zinc-400",   header: "bg-zinc-500" },
}

const RISK_STYLES: Record<string, { bg: string; text: string }> = {
    "High Risk":   { bg: "bg-red-500/15",    text: "text-red-500" },
    "Medium Risk": { bg: "bg-yellow-500/15",  text: "text-yellow-500" },
    "Low Risk":    { bg: "bg-emerald-500/15", text: "text-emerald-500" },
}

const TASK_STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
    assigned:    { bg: "bg-slate-500/15",   text: "text-slate-400",   label: "Assigned" },
    in_progress: { bg: "bg-amber-500/15",   text: "text-amber-400",   label: "In Progress" },
    review:      { bg: "bg-blue-500/15",    text: "text-blue-400",    label: "Under Review" },
    completed:   { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Completed" },
    reworking:   { bg: "bg-orange-500/15",  text: "text-orange-400",  label: "Reworking" },
}

const ALL_TASK_STATUSES: TaskStatus[] = ["assigned", "in_progress", "review", "completed", "reworking"]

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlatRow {
    item: ActionableItem
    docId: string
    docName: string
}

// ─── Risk Icon ───────────────────────────────────────────────────────────────

function RiskIcon({ modality }: { modality: string }) {
    const cfg = RISK_STYLES[modality] || RISK_STYLES["Medium Risk"]
    return (
        <span className={cn("inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-bold shrink-0", cfg.bg, cfg.text)} title={modality}>
            !
        </span>
    )
}

// ─── Progress bar ────────────────────────────────────────────────────────────

function ProgressBar({ completed, total }: { completed: number; total: number }) {
    if (total === 0) return <span className="text-[10px] text-muted-foreground/40">—</span>
    const pct = (completed / total) * 100
    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <div className="bg-emerald-500 h-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {completed}/{total}
            </span>
        </div>
    )
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatDate(iso: string | undefined): string {
    if (!iso) return "—"
    try {
        const d = new Date(iso)
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    } catch { return iso }
}

function formatTime(iso: string | undefined): string {
    if (!iso) return ""
    try {
        const d = new Date(iso)
        return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    } catch { return "" }
}

function formatDateTime(iso: string | undefined): string {
    if (!iso) return "—"
    const date = formatDate(iso)
    const time = formatTime(iso)
    return time ? `${date} ${time}` : date
}

// ─── Main Tracker Page ───────────────────────────────────────────────────────

export default function DashboardPage() {
    const [allDocs, setAllDocs] = React.useState<{ doc_id: string; doc_name: string; actionables: ActionableItem[] }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [riskFilter, setRiskFilter] = React.useState<string>("all")
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())

    const loadAll = React.useCallback(async () => {
        try {
            setLoading(true)
            const results = await fetchAllActionables()
            const docs = results
                .filter((r: ActionablesResult) => r.actionables && r.actionables.length > 0)
                .map((r: ActionablesResult) => ({
                    doc_id: r.doc_id,
                    doc_name: r.doc_name || r.doc_id,
                    actionables: r.actionables,
                }))
            setAllDocs(docs)
        } catch {
            toast.error("Failed to load actionables")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => { loadAll() }, [loadAll])

    const handleUpdate = React.useCallback(async (docId: string, itemId: string, updates: Record<string, unknown>) => {
        try {
            const updated = await updateActionable(docId, itemId, updates)
            setAllDocs(prev => prev.map(d => {
                if (d.doc_id !== docId) return d
                return { ...d, actionables: d.actionables.map(a => a.id === itemId ? { ...a, ...updated } : a) }
            }))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed")
        }
    }, [])

    // Only show PUBLISHED actionables
    const allRows: FlatRow[] = React.useMemo(() => {
        const rows: FlatRow[] = []
        for (const doc of allDocs) {
            for (const item of doc.actionables) {
                if (item.published_at) {
                    rows.push({ item, docId: doc.doc_id, docName: doc.doc_name })
                }
            }
        }
        return rows
    }, [allDocs])

    // Filter
    const filtered = React.useMemo(() => {
        return allRows.filter(({ item }) => {
            if (statusFilter !== "all" && (item.task_status || "assigned") !== statusFilter) return false
            if (riskFilter !== "all" && item.modality !== riskFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.workstream)}`.toLowerCase()
                if (!s.includes(q)) return false
            }
            return true
        })
    }, [allRows, statusFilter, riskFilter, searchQuery])

    // Group by workstream
    const grouped = React.useMemo(() => {
        const groups: Record<string, FlatRow[]> = {}
        for (const row of filtered) {
            const ws = safeStr(row.item.workstream) || "Other"
            if (!groups[ws]) groups[ws] = []
            groups[ws].push(row)
        }
        return groups
    }, [filtered])

    const sortedGroupKeys = React.useMemo(() => {
        return [...WORKSTREAM_OPTIONS, "Other"].filter(ws => grouped[ws] && grouped[ws].length > 0)
    }, [grouped])

    // Stats
    const stats = React.useMemo(() => {
        const total = allRows.length
        const completed = allRows.filter(r => r.item.task_status === "completed").length
        const inProgress = allRows.filter(r => r.item.task_status === "in_progress").length
        const reworking = allRows.filter(r => r.item.task_status === "reworking").length
        const review = allRows.filter(r => r.item.task_status === "review").length
        const assigned = allRows.filter(r => !r.item.task_status || r.item.task_status === "assigned").length
        const highRisk = allRows.filter(r => r.item.modality === "High Risk").length
        const midRisk = allRows.filter(r => r.item.modality === "Medium Risk").length
        const lowRisk = allRows.filter(r => r.item.modality === "Low Risk").length
        return { total, completed, inProgress, reworking, review, assigned, highRisk, midRisk, lowRisk }
    }, [allRows])

    const toggleGroup = (ws: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(ws)) next.delete(ws); else next.add(ws)
            return next
        })
    }

    // Grid columns: Team | Risk | Actionable | Status | Deadline (date) | Deadline (time) | Evidence | Published | Completion
    const gridCols = "minmax(80px,0.7fr) 36px minmax(180px,3fr) 100px 100px 70px 80px 90px 90px"

    // ─── Render ──────────────────────────────────────────────────────────

    return (
        <RoleRedirect>
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <LayoutDashboard className="h-4 w-4 text-primary" />
                        Implementation Tracker
                    </h1>
                </div>

                {/* ── Stats row ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-3 flex items-center gap-4">
                    <div className="flex items-center gap-6">
                        <div className="text-center">
                            <p className="text-lg font-bold text-foreground">{stats.total}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Total</p>
                        </div>
                        <div className="h-8 w-px bg-border/40" />
                        <div className="text-center">
                            <p className="text-lg font-bold text-emerald-400">{stats.completed}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Completed</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-amber-400">{stats.inProgress}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">In Progress</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-orange-400">{stats.reworking}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Reworking</p>
                        </div>
                        <div className="h-8 w-px bg-border/40" />
                        <div className="text-center">
                            <p className="text-lg font-bold text-red-500">{stats.highRisk}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">High Risk</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-yellow-500">{stats.midRisk}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Mid Risk</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-emerald-500">{stats.lowRisk}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Low Risk</p>
                        </div>
                    </div>

                    <div className="flex-1" />

                    <div className="w-48">
                        <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-1">Overall Progress</p>
                        <ProgressBar completed={stats.completed} total={stats.total} />
                    </div>
                </div>

                {/* ── Filters ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search tracker..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-transparent focus:border-border focus:outline-none"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Status</option>
                        {ALL_TASK_STATUSES.map(s => (
                            <option key={s} value={s}>{TASK_STATUS_STYLES[s].label}</option>
                        ))}
                    </select>

                    <select
                        value={riskFilter}
                        onChange={e => setRiskFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Risk</option>
                        {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>

                {/* ── Board table ── */}
                <div className="flex-1 overflow-auto">
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading tracker...</span>
                        </div>
                    )}

                    {!loading && allRows.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                                <LayoutDashboard className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-sm font-medium mb-1">No published actionables to track</h3>
                            <p className="text-xs text-muted-foreground/60 max-w-sm">
                                Publish approved actionables from the Actionables &gt; Publish tab to see them here.
                            </p>
                        </div>
                    )}

                    {!loading && sortedGroupKeys.map(ws => {
                        const rows = grouped[ws] || []
                        const isCollapsed = collapsedGroups.has(ws)
                        const wsColors = WORKSTREAM_COLORS[ws] || WORKSTREAM_COLORS.Other
                        const groupCompleted = rows.filter(r => r.item.task_status === "completed").length

                        return (
                            <div key={ws} className="mb-1">
                                {/* ── Group header ── */}
                                <div className="flex items-center gap-2 px-3 py-1.5 sticky top-0 z-10 bg-background border-b border-border/20">
                                    <button onClick={() => toggleGroup(ws)} className="flex items-center gap-2 flex-1 min-w-0">
                                        {isCollapsed
                                            ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        }
                                        <div className={cn("h-4 w-1 rounded-full shrink-0", wsColors.header)} />
                                        <span className="text-xs font-semibold text-foreground">{ws}</span>
                                        <span className="text-[10px] text-muted-foreground/50 font-mono">{rows.length} items</span>
                                    </button>
                                    <div className="w-32 shrink-0">
                                        <ProgressBar completed={groupCompleted} total={rows.length} />
                                    </div>
                                </div>

                                {/* ── Column headers ── */}
                                {!isCollapsed && (
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1">Risk</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Completed</div>
                                    </div>
                                )}

                                {/* ── Rows ── */}
                                {!isCollapsed && rows.map(({ item, docId }) => {
                                    const rowKey = `${docId}-${item.id}`
                                    const taskStatus = item.task_status || "assigned"
                                    const statusStyle = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
                                    const evidenceCount = (item.evidence_files || []).length

                                    return (
                                        <div
                                            key={rowKey}
                                            className={cn(
                                                "grid gap-0 border-b border-border/10 items-center hover:bg-muted/10 transition-colors px-3",
                                                taskStatus === "completed" && "opacity-70"
                                            )}
                                            style={{ gridTemplateColumns: gridCols }}
                                        >
                                            {/* Team */}
                                            <div className="py-1.5 px-1">
                                                <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium", WORKSTREAM_COLORS[item.workstream]?.bg, WORKSTREAM_COLORS[item.workstream]?.text || "text-muted-foreground")}>
                                                    {item.workstream}
                                                </span>
                                            </div>

                                            {/* Risk icon */}
                                            <div className="py-1.5 flex justify-center">
                                                <RiskIcon modality={item.modality} />
                                            </div>

                                            {/* Actionable text (read-only) */}
                                            <div className="py-1.5 px-2 min-w-0">
                                                <span className="text-xs text-foreground/90 truncate block">{safeStr(item.action)}</span>
                                            </div>

                                            {/* Status (read-only) */}
                                            <div className="py-1.5 px-1 text-center">
                                                <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                                                    {statusStyle.label}
                                                </span>
                                            </div>

                                            {/* Deadline date (editable) */}
                                            <div className="py-1.5 px-1 text-center relative">
                                                <DeadlineCell
                                                    value={item.deadline || ""}
                                                    onSave={v => handleUpdate(docId, item.id, { deadline: v })}
                                                />
                                            </div>

                                            {/* Deadline time (from same field) */}
                                            <div className="py-1.5 px-1 text-center">
                                                <span className="text-[10px] text-muted-foreground/60">
                                                    {formatTime(item.deadline)}
                                                </span>
                                            </div>

                                            {/* Evidence */}
                                            <div className="py-1.5 px-1 text-center">
                                                {evidenceCount > 0 ? (
                                                    <span className="text-[10px] text-foreground/70 flex items-center justify-center gap-1">
                                                        <Paperclip className="h-2.5 w-2.5" />{evidenceCount}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-muted-foreground/30 italic">empty</span>
                                                )}
                                            </div>

                                            {/* Published date */}
                                            <div className="py-1.5 px-1 text-center">
                                                <span className="text-[10px] text-muted-foreground/60">
                                                    {formatDate(item.published_at)}
                                                </span>
                                            </div>

                                            {/* Completion date */}
                                            <div className="py-1.5 px-1 text-center">
                                                <span className="text-[10px] text-muted-foreground/60">
                                                    {item.task_status === "completed" ? formatDate(item.completion_date) : "—"}
                                                </span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}

                    {!loading && filtered.length === 0 && allRows.length > 0 && (
                        <div className="text-center text-sm text-muted-foreground/60 py-12">
                            No actionables match the current filters
                        </div>
                    )}
                </div>
            </main>
        </div>
        </RoleRedirect>
    )
}

// ─── Deadline editable cell ──────────────────────────────────────────────────

function DeadlineCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
    const inputRef = React.useRef<HTMLInputElement>(null)

    const display = React.useMemo(() => {
        if (!value) return "—"
        try {
            return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        } catch { return value }
    }, [value])

    const isOverdue = React.useMemo(() => {
        if (!value) return false
        try { return new Date(value).getTime() < Date.now() } catch { return false }
    }, [value])

    return (
        <div className="relative inline-flex items-center">
            <button
                onClick={() => inputRef.current?.showPicker()}
                className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded hover:bg-muted/30 transition-colors flex items-center gap-1",
                    isOverdue ? "text-red-400" : "text-muted-foreground/70"
                )}
            >
                <Calendar className="h-2.5 w-2.5" />
                {display}
            </button>
            <input
                ref={inputRef}
                type="datetime-local"
                value={value || ""}
                onChange={e => onSave(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
            />
        </div>
    )
}
