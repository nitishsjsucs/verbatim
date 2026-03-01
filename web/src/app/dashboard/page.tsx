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
    ActionableComment,
    isMultiTeam,
    getClassification,
    MIXED_TEAM_CLASSIFICATION,
} from "@/lib/types"
import { CommentThread } from "@/components/shared/comment-thread"
import { useSession } from "@/lib/auth-client"
import {
    LayoutDashboard, ChevronDown, ChevronRight,
    Loader2, Search, AlertTriangle,
    Paperclip, Calendar, Save,
    CheckCircle2,
    XCircle, MessageSquare, SortAsc, SortDesc, Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { RoleRedirect } from "@/components/auth/role-redirect"
import {
    safeStr, normalizeRisk, formatDate, formatTime, formatDateTime, deadlineCategory,
    RISK_STYLES, RISK_OPTIONS, WORKSTREAM_COLORS, WORKSTREAM_OPTIONS,
    TASK_STATUS_STYLES, ALL_TASK_STATUSES, STATUS_SORT_ORDER,
} from "@/lib/status-config"
import { RiskIcon, ProgressBar, EvidencePopover } from "@/components/shared/status-components"

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlatRow {
    item: ActionableItem
    docId: string
    docName: string
}

// ─── Main Tracker Page ───────────────────────────────────────────────────────

export default function DashboardPage() {
    const { data: session } = useSession()
    const [allDocs, setAllDocs] = React.useState<{ doc_id: string; doc_name: string; actionables: ActionableItem[] }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [riskFilter, setRiskFilter] = React.useState<string>("all")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("risk")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())
    const [activeCollapsed, setActiveCollapsed] = React.useState(false)
    const [completedCollapsed, setCompletedCollapsed] = React.useState(false)
    const [expandedRow, setExpandedRow] = React.useState<string | null>(null)

    const userName = session?.user?.name || "Compliance Officer"

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

    const handleUpdate = React.useCallback(async (docId: string, itemId: string, updates: Record<string, unknown>, forTeam?: string) => {
        try {
            const updated = await updateActionable(docId, itemId, updates, forTeam)
            setAllDocs(prev => prev.map(d => {
                if (d.doc_id !== docId) return d
                return { ...d, actionables: d.actionables.map(a => a.id === itemId ? { ...a, ...updated } : a) }
            }))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed")
        }
    }, [])

    const handleAddComment = React.useCallback(async (docId: string, item: ActionableItem, text: string) => {
        const newComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "compliance_officer",
            text,
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        await handleUpdate(docId, item.id, { comments: [...existing, newComment] })
    }, [userName, handleUpdate])

    const [rejectingItem, setRejectingItem] = React.useState<{ docId: string; item: ActionableItem } | null>(null)
    const [rejectReason, setRejectReason] = React.useState("")

    // Per-team rejection state for multi-team items
    const [rejectingTeamInfo, setRejectingTeamInfo] = React.useState<{ docId: string; itemId: string; team: string } | null>(null)
    const [rejectTeamReason, setRejectTeamReason] = React.useState("")

    const handleApproveTeam = React.useCallback(async (docId: string, item: ActionableItem, team: string) => {
        // Multi-team approval: approving any team marks ALL teams as approved
        const assignedTeams = item.assigned_teams || [item.workstream]
        const completionDate = new Date().toISOString()
        
        // Update all teams to completed status
        await Promise.all(assignedTeams.map(t => 
            handleUpdate(docId, item.id, {
                task_status: "completed",
                completion_date: completionDate,
            }, t)
        ))
        
        // Also update the main item status to completed
        await handleUpdate(docId, item.id, {
            task_status: "completed",
            completion_date: completionDate,
        })
        
        toast.success(`All teams approved (triggered by ${team})`)
    }, [handleUpdate])

    const handleRejectTeam = React.useCallback(async (docId: string, item: ActionableItem, team: string, reason: string) => {
        const rejectComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "compliance_officer",
            text: `Rejected ${team} team: ${reason}`,
            timestamp: new Date().toISOString(),
        }
        // Add rejection comment to the team's workflow comments
        const teamComments = item.team_workflows?.[team]?.comments || []
        await handleUpdate(docId, item.id, {
            task_status: "reworking",
            rejection_reason: reason,
            comments: [...teamComments, rejectComment],
            justification: "",
            justification_by: "",
            justification_at: "",
            justification_status: "",
        }, team)
        toast.success(`${team} team rejected — returned for rework`)
    }, [userName, handleUpdate])

    const handleReject = React.useCallback(async (docId: string, item: ActionableItem, reason: string) => {
        const rejectComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "compliance_officer",
            text: `Rejected by Compliance Officer: ${reason}`,
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        await handleUpdate(docId, item.id, {
            task_status: "reworking",
            rejection_reason: reason,
            comments: [...existing, rejectComment],
            // Clear justification so Lead must re-justify if still delayed
            justification: "",
            justification_by: "",
            justification_at: "",
            justification_status: "",
        })
        toast.success("Task rejected — returned for rework")
    }, [userName, handleUpdate])

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

    // Filter + Sort
    const filtered = React.useMemo(() => {
        let result = allRows.filter(({ item }) => {
            if (statusFilter !== "all" && (item.task_status || "assigned") !== statusFilter) return false
            if (riskFilter !== "all" && normalizeRisk(item.modality) !== riskFilter) return false
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                // Include classification in search so "Mixed Team Projects" is searchable
                const classification = getClassification(item)
                const s = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.workstream)} ${classification}`.toLowerCase()
                if (!s.includes(q)) return false
            }
            return true
        })
        // Sort
        result = [...result].sort((a, b) => {
            let cmp = 0
            if (sortBy === "status") {
                cmp = (STATUS_SORT_ORDER[a.item.task_status || "assigned"] || 3) - (STATUS_SORT_ORDER[b.item.task_status || "assigned"] || 3)
            } else if (sortBy === "deadline") {
                const da = a.item.deadline ? new Date(a.item.deadline).getTime() : Infinity
                const db = b.item.deadline ? new Date(b.item.deadline).getTime() : Infinity
                cmp = da - db
            } else if (sortBy === "risk") {
                const ro: Record<string, number> = { "High Risk": 0, "Medium Risk": 1, "Low Risk": 2 }
                cmp = (ro[normalizeRisk(a.item.modality)] ?? 1) - (ro[normalizeRisk(b.item.modality)] ?? 1)
            } else if (sortBy === "published") {
                const pa = a.item.published_at ? new Date(a.item.published_at).getTime() : 0
                const pb = b.item.published_at ? new Date(b.item.published_at).getTime() : 0
                cmp = pb - pa
            }
            return sortDir === "desc" ? -cmp : cmp
        })
        return result
    }, [allRows, statusFilter, riskFilter, deadlineFilter, searchQuery, sortBy, sortDir])

    // Split into active (non-completed) and completed
    const activeRows = React.useMemo(() => filtered.filter(r => r.item.task_status !== "completed"), [filtered])
    const completedRows = React.useMemo(() => {
        const rows = filtered.filter(r => r.item.task_status === "completed")
        return rows.sort((a, b) => {
            const da = a.item.completion_date ? new Date(a.item.completion_date).getTime() : 0
            const db = b.item.completion_date ? new Date(b.item.completion_date).getTime() : 0
            return db - da
        })
    }, [filtered])

    // Separate multi-team (Mixed Group Projects) from single-team items
    const mixedGroupRows = React.useMemo(() => activeRows.filter(r => isMultiTeam(r.item)), [activeRows])
    const singleTeamRows = React.useMemo(() => activeRows.filter(r => !isMultiTeam(r.item)), [activeRows])

    // State for Mixed Group Projects section collapse
    const [mixedGroupCollapsed, setMixedGroupCollapsed] = React.useState(false)

    // Group single-team active by workstream
    const grouped = React.useMemo(() => {
        const groups: Record<string, FlatRow[]> = {}
        for (const row of singleTeamRows) {
            const ws = safeStr(row.item.workstream) || "Other"
            if (!groups[ws]) groups[ws] = []
            groups[ws].push(row)
        }
        return groups
    }, [singleTeamRows])

    const sortedGroupKeys = React.useMemo(() => {
        return [...WORKSTREAM_OPTIONS, "Other"].filter(ws => grouped[ws] && grouped[ws].length > 0)
    }, [grouped])

    // Group completed by classification (multi-team items go to "Mixed Team Projects")
    const completedByTeam = React.useMemo(() => {
        const groups: Record<string, FlatRow[]> = {}
        for (const row of completedRows) {
            // Use getClassification to determine grouping
            const classification = getClassification(row.item)
            if (!groups[classification]) groups[classification] = []
            groups[classification].push(row)
        }
        return groups
    }, [completedRows])

    // Ordered completed team keys: Mixed Team Projects first (if exists), then regular teams
    const completedTeamKeys = React.useMemo(() => {
        const keys = Object.keys(completedByTeam)
        const mixedIndex = keys.indexOf(MIXED_TEAM_CLASSIFICATION)
        if (mixedIndex > -1) {
            keys.splice(mixedIndex, 1)
            return [MIXED_TEAM_CLASSIFICATION, ...WORKSTREAM_OPTIONS.filter(ws => keys.includes(ws)), ...keys.filter(k => !WORKSTREAM_OPTIONS.includes(k as ActionableWorkstream) && k !== MIXED_TEAM_CLASSIFICATION)]
        }
        return [...WORKSTREAM_OPTIONS, "Other"].filter(ws => completedByTeam[ws] && completedByTeam[ws].length > 0)
    }, [completedByTeam])

    const [collapsedCompletedTeams, setCollapsedCompletedTeams] = React.useState<Set<string>>(new Set())
    const toggleCompletedTeam = (ws: string) => {
        setCollapsedCompletedTeams(prev => {
            const next = new Set(prev)
            if (next.has(ws)) next.delete(ws); else next.add(ws)
            return next
        })
    }

    // Stats
    const stats = React.useMemo(() => {
        const s = { total: allRows.length, completed: 0, inProgress: 0, teamReview: 0, reworking: 0, review: 0, assigned: 0, pendingAllTeams: 0, highRisk: 0, midRisk: 0, lowRisk: 0, yetToDeadline: 0, delayed30: 0, delayed60: 0, delayed90: 0 }
        for (const r of allRows) {
            const st = r.item.task_status || "assigned"
            if (st === "completed") s.completed++
            else if (st === "in_progress") s.inProgress++
            else if (st === "team_review") s.teamReview++
            else if (st === "review") s.review++
            else if (st === "reworking") s.reworking++
            else if (st === "pending_all_teams") s.pendingAllTeams++
            else s.assigned++
            const risk = normalizeRisk(r.item.modality)
            if (risk === "High Risk") s.highRisk++
            else if (risk === "Medium Risk") s.midRisk++
            else s.lowRisk++
            if (st !== "completed") {
                const dc = deadlineCategory(r.item.deadline)
                if (dc === "yet") s.yetToDeadline++
                else if (dc === "d30") s.delayed30++
                else if (dc === "d60") s.delayed60++
                else if (dc === "d90") s.delayed90++
            }
        }
        return s
    }, [allRows])

    const toggleGroup = (ws: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(ws)) next.delete(ws); else next.add(ws)
            return next
        })
    }

    // Grid columns: Team | Risk | Actionable | Status | Deadline (date) | Deadline (time) | Evidence | Published | Completion | Actions
    const gridCols = "minmax(80px,0.7fr) 36px minmax(180px,3fr) 100px 100px 70px 80px 90px 90px 90px"

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
                <div className="shrink-0 border-b border-border/40 px-5 py-3 flex items-center gap-4 overflow-x-auto">
                    <div className="flex items-center gap-4">
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-foreground">{stats.total}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Total</p>
                        </div>
                        <div className="h-8 w-px bg-border/40" />
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-emerald-400">{stats.completed}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Completed</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-amber-400">{stats.inProgress}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">In Progress</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-teal-400">{stats.teamReview}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Team Review</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-blue-400">{stats.review}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Under Review</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-orange-400">{stats.reworking}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Reworking</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-violet-400">{stats.pendingAllTeams}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Pending Teams</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-slate-400">{stats.assigned}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Assigned</p>
                        </div>
                        <div className="h-8 w-px bg-border/40" />
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-emerald-500">{stats.yetToDeadline}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Yet to DL</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-amber-500">{stats.delayed30}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Delayed 30d</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-orange-500">{stats.delayed60}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Delayed 60d</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-red-500">{stats.delayed90}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Delayed 90d</p>
                        </div>
                    </div>

                    <div className="flex-1" />

                    <div className="w-48">
                        <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-1">Overall Progress</p>
                        <ProgressBar completed={stats.completed} total={stats.total} />
                    </div>
                </div>

                {/* ── Filters ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search tracker..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Status</option>
                        {ALL_TASK_STATUSES.map(s => (
                            <option key={s} value={s}>{TASK_STATUS_STYLES[s].label}</option>
                        ))}
                    </select>

                    <select
                        value={riskFilter}
                        onChange={e => setRiskFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Risk</option>
                        {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>

                    <select
                        value={deadlineFilter}
                        onChange={e => setDeadlineFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Deadlines</option>
                        <option value="yet">Yet to Deadline</option>
                        <option value="d30">Delayed 30d</option>
                        <option value="d60">Delayed 60d</option>
                        <option value="d90">Delayed 90d</option>
                    </select>

                    {(statusFilter !== "all" || riskFilter !== "all" || deadlineFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => {
                                setStatusFilter("all")
                                setRiskFilter("all")
                                setDeadlineFilter("all")
                                setSearchQuery("")
                            }}
                            className="px-2.5 py-1.5 text-xs rounded-md bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/40 focus:border-border"
                        >
                            Clear Filters
                        </button>
                    )}

                    <div className="flex items-center gap-1 ml-auto">
                        <span className="text-[10px] text-muted-foreground/50">Sort:</span>
                        <select
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value)}
                            className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                        >
                            <option value="status">Status</option>
                            <option value="deadline">Deadline</option>
                            <option value="risk">Risk</option>
                            <option value="published">Date Published</option>
                        </select>
                        <button
                            onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                            className="p-1 rounded hover:bg-muted/30 text-muted-foreground/50 hover:text-foreground transition-colors"
                            title={sortDir === "asc" ? "Ascending" : "Descending"}
                        >
                            {sortDir === "asc" ? <SortAsc className="h-3.5 w-3.5" /> : <SortDesc className="h-3.5 w-3.5" />}
                        </button>
                    </div>
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

                    {/* ── Mixed Group Projects section (multi-team items) ── */}
                    {!loading && mixedGroupRows.length > 0 && (
                        <>
                            <div className="px-3 py-2 bg-background border-b border-violet-500/20 cursor-pointer sticky top-0 z-20" onClick={() => setMixedGroupCollapsed(!mixedGroupCollapsed)}>
                                <span className="text-xs font-semibold text-violet-500 flex items-center gap-2">
                                    {mixedGroupCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    <Users className="h-3.5 w-3.5" />
                                    Mixed Group Projects ({mixedGroupRows.length})
                                </span>
                            </div>
                            {!mixedGroupCollapsed && (
                                <>
                                    <div className="grid gap-0 border-b border-border/20 bg-violet-500/5 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Teams</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1">Risk</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Completed</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Actions</div>
                                    </div>
                                    {mixedGroupRows.map(({ item, docId }) => {
                                        const rowKey = `mixed-${docId}-${item.id}`
                                        const taskStatus = item.task_status || "assigned"
                                        const statusStyle = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
                                        const isExpanded = expandedRow === rowKey
                                        const commentCount = (item.comments || []).length
                                        const assignedTeams = item.assigned_teams || [item.workstream]

                                        return (
                                            <div key={rowKey} className={cn("border-b border-border/10 bg-violet-500/5", taskStatus === "completed" && "opacity-70")}>
                                                <div
                                                    className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                                                    style={{ gridTemplateColumns: gridCols }}
                                                    onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                                                >
                                                    {/* Stacked Teams */}
                                                    <div className="py-1.5 px-1 flex flex-wrap gap-0.5">
                                                        {assignedTeams.map(team => (
                                                            <span key={team} className={cn("px-1 py-0.5 rounded text-[8px] font-medium", WORKSTREAM_COLORS[team]?.bg, WORKSTREAM_COLORS[team]?.text || "text-muted-foreground")}>
                                                                {team}
                                                            </span>
                                                        ))}
                                                    </div>

                                                    {/* Risk icon */}
                                                    <div className="py-1.5 flex justify-center">
                                                        <RiskIcon modality={item.modality} />
                                                    </div>

                                                    {/* Actionable text */}
                                                    <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                                                        {isExpanded
                                                            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                                                            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                                                        <span className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</span>
                                                        {commentCount > 0 && (
                                                            <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-primary/60">
                                                                <MessageSquare className="h-2.5 w-2.5" />{commentCount}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Status */}
                                                    <div className="py-1.5 px-1 text-center">
                                                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                                                            {statusStyle.label}
                                                        </span>
                                                    </div>

                                                    {/* Deadline date */}
                                                    <div className="py-1.5 px-1 text-center relative" onClick={e => e.stopPropagation()}>
                                                        <DeadlineCell
                                                            value={item.deadline || ""}
                                                            onSave={v => handleUpdate(docId, item.id, { deadline: v })}
                                                        />
                                                    </div>

                                                    {/* Deadline time */}
                                                    <div className="py-1.5 px-1 text-center">
                                                        <span className="text-[10px] text-muted-foreground/60">
                                                            {formatTime(item.deadline)}
                                                        </span>
                                                    </div>

                                                    {/* Evidence */}
                                                    <div className="py-1.5 px-1 flex justify-center" onClick={e => e.stopPropagation()}>
                                                        <EvidencePopover files={item.evidence_files || []} taskStatus={taskStatus} />
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

                                                    {/* Actions */}
                                                    <div className="py-1.5 px-1 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                                                        <span className="text-[9px] text-violet-400 italic">Review per team ↓</span>
                                                    </div>
                                                </div>

                                                {/* Expanded: Per-team workflow breakdown */}
                                                {isExpanded && (
                                                    <div className="bg-muted/5 border-t border-border/10 px-6 py-4 space-y-4">
                                                        {/* Multi-team workflow breakdown with per-team approve/reject */}
                                                        {item.team_workflows && (
                                                            <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg px-4 py-3">
                                                                <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-2">Team Workflow Status</p>
                                                                <div className="space-y-2">
                                                                    {assignedTeams.map(team => {
                                                                        const tw = item.team_workflows?.[team]
                                                                        const twStatus = (tw?.task_status || "assigned") as TaskStatus
                                                                        const twStyle = TASK_STATUS_STYLES[twStatus] || TASK_STATUS_STYLES.assigned
                                                                        const isRejectingThisTeam = rejectingTeamInfo?.docId === docId && rejectingTeamInfo?.itemId === item.id && rejectingTeamInfo?.team === team
                                                                        return (
                                                                            <div key={team}>
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium min-w-[80px]", WORKSTREAM_COLORS[team]?.bg, WORKSTREAM_COLORS[team]?.text || "text-muted-foreground")}>{team}</span>
                                                                                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium", twStyle.bg, twStyle.text)}>{twStyle.label}</span>
                                                                                    {tw?.deadline && <span className="text-[9px] text-muted-foreground/50"><Calendar className="h-2.5 w-2.5 inline" /> {formatDate(tw.deadline)}</span>}
                                                                                    {tw?.evidence_files && tw.evidence_files.length > 0 && <span className="text-[9px] text-muted-foreground/50"><Paperclip className="h-2.5 w-2.5 inline" /> {tw.evidence_files.length}</span>}
                                                                                    {twStatus === "review" && (
                                                                                        <div className="flex items-center gap-1 ml-auto">
                                                                                            <button
                                                                                                onClick={() => handleApproveTeam(docId, item, team)}
                                                                                                className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors font-medium"
                                                                                                title={`Approve ${team}`}
                                                                                            >
                                                                                                <CheckCircle2 className="h-2.5 w-2.5" /> Approve
                                                                                            </button>
                                                                                            <button
                                                                                                onClick={() => { setRejectingTeamInfo({ docId, itemId: item.id, team }); setRejectTeamReason("") }}
                                                                                                className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium"
                                                                                                title={`Reject ${team}`}
                                                                                            >
                                                                                                <XCircle className="h-2.5 w-2.5" /> Reject
                                                                                            </button>
                                                                                        </div>
                                                                                    )}
                                                                                    {twStatus === "completed" && <span className="text-[9px] text-emerald-400 italic ml-auto">Approved</span>}
                                                                                </div>
                                                                                {/* Per-team rejection reason input */}
                                                                                {isRejectingThisTeam && (
                                                                                    <div className="flex items-center gap-2 mt-1.5 ml-[88px]">
                                                                                        <input
                                                                                            value={rejectTeamReason}
                                                                                            onChange={e => setRejectTeamReason(e.target.value)}
                                                                                            placeholder="Reason for rejection (required)..."
                                                                                            className="flex-1 bg-background text-xs rounded-md px-3 py-1.5 border border-red-500/30 focus:border-red-500 focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                                                                                            autoFocus
                                                                                            onKeyDown={e => {
                                                                                                if (e.key === "Enter" && rejectTeamReason.trim()) {
                                                                                                    handleRejectTeam(docId, item, team, rejectTeamReason.trim())
                                                                                                    setRejectingTeamInfo(null)
                                                                                                    setRejectTeamReason("")
                                                                                                }
                                                                                                if (e.key === "Escape") {
                                                                                                    setRejectingTeamInfo(null)
                                                                                                    setRejectTeamReason("")
                                                                                                }
                                                                                            }}
                                                                                        />
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                if (rejectTeamReason.trim()) {
                                                                                                    handleRejectTeam(docId, item, team, rejectTeamReason.trim())
                                                                                                    setRejectingTeamInfo(null)
                                                                                                    setRejectTeamReason("")
                                                                                                }
                                                                                            }}
                                                                                            disabled={!rejectTeamReason.trim()}
                                                                                            className="text-[9px] px-2 py-1.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                                                        >
                                                                                            Reject
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => { setRejectingTeamInfo(null); setRejectTeamReason("") }}
                                                                                            className="text-[9px] px-1.5 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                                                                                        >
                                                                                            Cancel
                                                                                        </button>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <CommentThread
                                                            comments={item.comments || []}
                                                            currentUser={userName}
                                                            currentRole="compliance_officer"
                                                            onAddComment={async (text) => handleAddComment(docId, item, text)}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </>
                            )}
                        </>
                    )}

                    {/* ── Active section header ── */}
                    {!loading && singleTeamRows.length > 0 && (
                        <div className="px-3 py-2 bg-background border-b border-yellow-500/20 cursor-pointer sticky top-0 z-20" onClick={() => setActiveCollapsed(!activeCollapsed)}>
                            <span className="text-xs font-semibold text-yellow-500 flex items-center gap-2">
                                {activeCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Active ({singleTeamRows.length})
                            </span>
                        </div>
                    )}

                    {!loading && !activeCollapsed && sortedGroupKeys.map(ws => {
                        const rows = grouped[ws] || []
                        const isCollapsed = collapsedGroups.has(ws)
                        const wsColors = WORKSTREAM_COLORS[ws] || WORKSTREAM_COLORS.Other
                        const groupCompleted = rows.filter(r => r.item.task_status === "completed").length
                        const pct = rows.length > 0 ? Math.round((groupCompleted / rows.length) * 100) : 0

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
                                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">{groupCompleted}/{rows.length} ({pct}%)</span>
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
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Actions</div>
                                    </div>
                                )}

                                {/* ── Rows ── */}
                                {!isCollapsed && rows.map(({ item, docId }) => {
                                    const rowKey = `${docId}-${item.id}`
                                    const taskStatus = item.task_status || "assigned"
                                    const statusStyle = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
                                    const isExpanded = expandedRow === rowKey
                                    const commentCount = (item.comments || []).length

                                    return (
                                        <div key={rowKey} className={cn("border-b border-border/10", taskStatus === "completed" && "opacity-70")}>
                                            <div
                                                className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                                                style={{ gridTemplateColumns: gridCols }}
                                                onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
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
                                                <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                                                    {isExpanded
                                                        ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                                                        : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                                                    <span className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</span>
                                                    {isMultiTeam(item) && (
                                                        <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-violet-400" title={`Multi-team: ${item.assigned_teams?.join(", ")}`}>
                                                            <Users className="h-2.5 w-2.5" />{item.assigned_teams?.length}
                                                        </span>
                                                    )}
                                                    {commentCount > 0 && (
                                                        <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-primary/60">
                                                            <MessageSquare className="h-2.5 w-2.5" />{commentCount}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Status (read-only) */}
                                                <div className="py-1.5 px-1 text-center">
                                                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                                                        {statusStyle.label}
                                                    </span>
                                                </div>

                                                {/* Deadline date (editable) */}
                                                <div className="py-1.5 px-1 text-center relative" onClick={e => e.stopPropagation()}>
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

                                                {/* Evidence (clickable popover — only visible after review submission) */}
                                                <div className="py-1.5 px-1 flex justify-center" onClick={e => e.stopPropagation()}>
                                                    <EvidencePopover files={item.evidence_files || []} taskStatus={taskStatus} />
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

                                                {/* Actions (approve/reject for compliance officer) */}
                                                <div className="py-1.5 px-1 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                                                    {taskStatus === "review" && !isMultiTeam(item) && (
                                                        <>
                                                            <button
                                                                onClick={() => handleUpdate(docId, item.id, { task_status: "completed", completion_date: new Date().toISOString() })}
                                                                className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors font-medium"
                                                                title="Approve — mark as completed"
                                                            >
                                                                <CheckCircle2 className="h-2.5 w-2.5" /> Approve
                                                            </button>
                                                            <button
                                                                onClick={() => { setRejectingItem({ docId, item }); setRejectReason("") }}
                                                                className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium"
                                                                title="Reject — send back for rework"
                                                            >
                                                                <XCircle className="h-2.5 w-2.5" /> Reject
                                                            </button>
                                                        </>
                                                    )}
                                                    {taskStatus === "review" && isMultiTeam(item) && (
                                                        <span className="text-[9px] text-violet-400 italic">Review per team ↓</span>
                                                    )}
                                                    {taskStatus === "completed" && (
                                                        <span className="text-[9px] text-emerald-400 italic">Approved</span>
                                                    )}
                                                    {taskStatus === "reworking" && (
                                                        <span className="text-[9px] text-orange-400 italic">Reworking</span>
                                                    )}
                                                    {taskStatus === "team_review" && (
                                                        <span className="text-[9px] text-teal-400 italic">Team Review</span>
                                                    )}
                                                    {taskStatus === "reviewer_rejected" && (
                                                        <span className="text-[9px] text-rose-400 italic">Rejected by Reviewer</span>
                                                    )}
                                                    {taskStatus === "awaiting_justification" && (
                                                        <span className="text-[9px] text-yellow-500 italic">Awaiting Lead Justification</span>
                                                    )}
                                                    {taskStatus === "pending_all_teams" && (
                                                        <span className="text-[9px] text-violet-400 italic">Pending Teams</span>
                                                    )}
                                                    {(taskStatus === "assigned" || taskStatus === "in_progress") && (
                                                        <span className="text-[9px] text-muted-foreground/30">—</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Rejection reason input */}
                                            {rejectingItem?.item.id === item.id && rejectingItem.docId === docId && (
                                                <div className="bg-red-500/5 border-t border-red-500/20 px-6 py-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        value={rejectReason}
                                                        onChange={e => setRejectReason(e.target.value)}
                                                        placeholder="Reason for rejection (required)..."
                                                        className="flex-1 bg-background text-xs rounded-md px-3 py-1.5 border border-red-500/30 focus:border-red-500 focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                                                        autoFocus
                                                        onKeyDown={e => {
                                                            if (e.key === "Enter" && rejectReason.trim()) {
                                                                handleReject(docId, item, rejectReason.trim())
                                                                setRejectingItem(null)
                                                                setRejectReason("")
                                                            }
                                                            if (e.key === "Escape") {
                                                                setRejectingItem(null)
                                                                setRejectReason("")
                                                            }
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            if (rejectReason.trim()) {
                                                                handleReject(docId, item, rejectReason.trim())
                                                                setRejectingItem(null)
                                                                setRejectReason("")
                                                            }
                                                        }}
                                                        disabled={!rejectReason.trim()}
                                                        className="text-[10px] px-2.5 py-1.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                    >
                                                        Confirm Reject
                                                    </button>
                                                    <button
                                                        onClick={() => { setRejectingItem(null); setRejectReason("") }}
                                                        className="text-[10px] px-2 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            )}

                                            {/* Expanded: Comment thread */}
                                            {isExpanded && (
                                                <div className="bg-muted/5 border-t border-border/10 px-6 py-4 space-y-4">
                                                    {/* Pending justification review banner */}
                                                    {item.justification && item.justification_status === "pending_review" && (
                                                        <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
                                                            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                                                            <div className="flex-1">
                                                                <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-0.5">Justification — Pending Your Review</p>
                                                                <p className="text-xs text-foreground/80 mb-1">{item.justification}</p>
                                                                <p className="text-[9px] text-muted-foreground/50 mb-2">Submitted by {item.justification_by}{item.justification_at ? ` on ${formatDate(item.justification_at)}` : ""}</p>
                                                                <button
                                                                    onClick={() => handleUpdate(docId, item.id, { justification_status: "reviewed" })}
                                                                    className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-colors font-medium"
                                                                >
                                                                    <CheckCircle2 className="h-2.5 w-2.5" /> Acknowledge Justification
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Reviewed justification info */}
                                                    {item.justification && item.justification_status === "reviewed" && (
                                                        <div className="flex items-start gap-2.5 bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-4 py-3">
                                                            <CheckCircle2 className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-0.5">Justification — Reviewed</p>
                                                                <p className="text-xs text-foreground/80">{item.justification}</p>
                                                                <p className="text-[9px] text-muted-foreground/50 mt-1">By {item.justification_by}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Rejection reason banner */}
                                                    {taskStatus === "reworking" && item.rejection_reason && (
                                                        <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                                                            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-0.5">Rejection Reason</p>
                                                                <p className="text-xs text-foreground/80">{item.rejection_reason}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Multi-team workflow breakdown with per-team approve/reject */}
                                                    {isMultiTeam(item) && item.team_workflows && (
                                                        <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg px-4 py-3">
                                                            <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-2">Team Workflow Status</p>
                                                            <div className="space-y-2">
                                                                {(item.assigned_teams || []).map(team => {
                                                                    const tw = item.team_workflows?.[team]
                                                                    const twStatus = (tw?.task_status || "assigned") as TaskStatus
                                                                    const twStyle = TASK_STATUS_STYLES[twStatus] || TASK_STATUS_STYLES.assigned
                                                                    const isRejectingThisTeam = rejectingTeamInfo?.docId === docId && rejectingTeamInfo?.itemId === item.id && rejectingTeamInfo?.team === team
                                                                    return (
                                                                        <div key={team}>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium min-w-[80px]", WORKSTREAM_COLORS[team]?.bg, WORKSTREAM_COLORS[team]?.text || "text-muted-foreground")}>{team}</span>
                                                                                <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium", twStyle.bg, twStyle.text)}>{twStyle.label}</span>
                                                                                {tw?.evidence_files && tw.evidence_files.length > 0 && <span className="text-[9px] text-muted-foreground/50"><Paperclip className="h-2.5 w-2.5 inline" /> {tw.evidence_files.length}</span>}
                                                                                {twStatus === "review" && (
                                                                                    <div className="flex items-center gap-1 ml-auto">
                                                                                        <button
                                                                                            onClick={() => handleApproveTeam(docId, item, team)}
                                                                                            className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors font-medium"
                                                                                            title={`Approve ${team}`}
                                                                                        >
                                                                                            <CheckCircle2 className="h-2.5 w-2.5" /> Approve
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => { setRejectingTeamInfo({ docId, itemId: item.id, team }); setRejectTeamReason("") }}
                                                                                            className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium"
                                                                                            title={`Reject ${team}`}
                                                                                        >
                                                                                            <XCircle className="h-2.5 w-2.5" /> Reject
                                                                                        </button>
                                                                                    </div>
                                                                                )}
                                                                                {twStatus === "completed" && <span className="text-[9px] text-emerald-400 italic ml-auto">Approved</span>}
                                                                            </div>
                                                                            {/* Per-team rejection reason input */}
                                                                            {isRejectingThisTeam && (
                                                                                <div className="flex items-center gap-2 mt-1.5 ml-[88px]">
                                                                                    <input
                                                                                        value={rejectTeamReason}
                                                                                        onChange={e => setRejectTeamReason(e.target.value)}
                                                                                        placeholder="Reason for rejection (required)..."
                                                                                        className="flex-1 bg-background text-xs rounded-md px-3 py-1.5 border border-red-500/30 focus:border-red-500 focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                                                                                        autoFocus
                                                                                        onKeyDown={e => {
                                                                                            if (e.key === "Enter" && rejectTeamReason.trim()) {
                                                                                                handleRejectTeam(docId, item, team, rejectTeamReason.trim())
                                                                                                setRejectingTeamInfo(null)
                                                                                                setRejectTeamReason("")
                                                                                            }
                                                                                            if (e.key === "Escape") {
                                                                                                setRejectingTeamInfo(null)
                                                                                                setRejectTeamReason("")
                                                                                            }
                                                                                        }}
                                                                                    />
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            if (rejectTeamReason.trim()) {
                                                                                                handleRejectTeam(docId, item, team, rejectTeamReason.trim())
                                                                                                setRejectingTeamInfo(null)
                                                                                                setRejectTeamReason("")
                                                                                            }
                                                                                        }}
                                                                                        disabled={!rejectTeamReason.trim()}
                                                                                        className="text-[9px] px-2 py-1.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                                                    >
                                                                                        Reject
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => { setRejectingTeamInfo(null); setRejectTeamReason("") }}
                                                                                        className="text-[9px] px-1.5 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                                                                                    >
                                                                                        Cancel
                                                                                    </button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                    <CommentThread
                                                        comments={item.comments || []}
                                                        currentUser={userName}
                                                        currentRole="compliance_officer"
                                                        onAddComment={async (text) => handleAddComment(docId, item, text)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}

                    {/* ── Completed Section ── */}
                    {!loading && completedRows.length > 0 && (
                        <div className="mt-4">
                            <div className="px-3 py-2 bg-background border-y border-emerald-500/20 cursor-pointer sticky top-0 z-20" onClick={() => setCompletedCollapsed(!completedCollapsed)}>
                                <span className="text-xs font-semibold text-emerald-500 flex items-center gap-2">
                                    {completedCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Completed ({completedRows.length})
                                </span>
                            </div>

                            {!completedCollapsed && completedTeamKeys.map(ws => {
                                const rows = completedByTeam[ws] || []
                                if (rows.length === 0) return null
                                const isCollapsed = collapsedCompletedTeams.has(ws)
                                const wsColors = WORKSTREAM_COLORS[ws] || WORKSTREAM_COLORS.Other
                                const isMixedTeam = ws === MIXED_TEAM_CLASSIFICATION

                                return (
                                    <div key={`completed-${ws}`} className={cn("mb-0.5", isMixedTeam && "bg-gradient-to-r from-violet-500/5 to-amber-500/5 rounded-lg")}>
                                        <div className={cn("flex items-center gap-2 px-3 py-1 bg-background/50 border-b border-border/10", isMixedTeam && "bg-transparent")}>
                                            <button onClick={() => toggleCompletedTeam(ws)} className="flex items-center gap-2 flex-1 min-w-0">
                                                {isCollapsed
                                                    ? <ChevronRight className={cn("h-3 w-3 shrink-0", isMixedTeam ? "text-amber-400" : "text-muted-foreground/50")} />
                                                    : <ChevronDown className={cn("h-3 w-3 shrink-0", isMixedTeam ? "text-amber-400" : "text-muted-foreground/50")} />}
                                                {isMixedTeam && <Users className="h-3 w-3 text-amber-400" />}
                                                <div className={cn("h-3 w-0.5 rounded-full shrink-0", wsColors.header)} />
                                                <span className={cn("text-[11px] font-medium", isMixedTeam ? "text-amber-400" : "text-muted-foreground")}>{ws}</span>
                                                <span className="text-[9px] text-muted-foreground/40 font-mono">{rows.length}</span>
                                            </button>
                                        </div>

                                        {!isCollapsed && (
                                            <div className="grid gap-0 border-b border-border/10 bg-muted/5 px-3" style={{ gridTemplateColumns: gridCols }}>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-2">Team</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1">Risk</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-2">Actionable</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-2 text-center">Status</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-2 text-center">Deadline</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Time</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Evidence</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Published</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Completed</div>
                                                <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Actions</div>
                                            </div>
                                        )}

                                        {!isCollapsed && rows.map(({ item, docId }) => {
                                            const rowKey = `completed-${docId}-${item.id}`
                                            const isExpanded = expandedRow === rowKey
                                            const commentCount = (item.comments || []).length

                                            return (
                                                <div key={rowKey} className="border-b border-border/5 opacity-70">
                                                    <div
                                                        className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                                                        style={{ gridTemplateColumns: gridCols }}
                                                        onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                                                    >
                                                        <div className="py-1.5 px-1">
                                                            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium", WORKSTREAM_COLORS[item.workstream]?.bg, WORKSTREAM_COLORS[item.workstream]?.text || "text-muted-foreground")}>
                                                                {item.workstream}
                                                            </span>
                                                        </div>
                                                        <div className="py-1.5 flex justify-center"><RiskIcon modality={item.modality} /></div>
                                                        <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                                                            {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                                                            <span className="text-xs text-foreground/90 truncate line-through decoration-emerald-500/40">{safeStr(item.action)}</span>
                                                            {isMultiTeam(item) && <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-violet-400" title={`Multi-team: ${item.assigned_teams?.join(", ")}`}><Users className="h-2.5 w-2.5" />{item.assigned_teams?.length}</span>}
                                                            {commentCount > 0 && <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-primary/60"><MessageSquare className="h-2.5 w-2.5" />{commentCount}</span>}
                                                        </div>
                                                        <div className="py-1.5 px-1 text-center">
                                                            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium", TASK_STATUS_STYLES.completed.bg, TASK_STATUS_STYLES.completed.text)}>
                                                                {TASK_STATUS_STYLES.completed.label}
                                                            </span>
                                                        </div>
                                                        <div className="py-1.5 px-1 text-center"><span className="text-[10px] text-muted-foreground/50">{formatDate(item.deadline)}</span></div>
                                                        <div className="py-1.5 px-1 text-center"><span className="text-[10px] text-muted-foreground/50">{formatTime(item.deadline)}</span></div>
                                                        <div className="py-1.5 px-1 flex justify-center" onClick={e => e.stopPropagation()}>
                                                            <EvidencePopover files={item.evidence_files || []} taskStatus="completed" />
                                                        </div>
                                                        <div className="py-1.5 px-1 text-center"><span className="text-[10px] text-muted-foreground/50">{formatDate(item.published_at)}</span></div>
                                                        <div className="py-1.5 px-1 text-center"><span className="text-[10px] text-emerald-400/70">{formatDate(item.completion_date)}</span></div>
                                                        <div className="py-1.5 px-1 text-center"><span className="text-[9px] text-emerald-400 italic">Approved</span></div>
                                                    </div>
                                                    {isExpanded && (
                                                        <div className="bg-muted/5 border-t border-border/10 px-6 py-4">
                                                            <CommentThread
                                                                comments={item.comments || []}
                                                                currentUser={userName}
                                                                currentRole="compliance_officer"
                                                                onAddComment={async (text) => handleAddComment(docId, item, text)}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )
                            })}
                        </div>
                    )}

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
    const [localValue, setLocalValue] = React.useState(value || "")
    const [saving, setSaving] = React.useState(false)

    // Sync if the prop changes externally
    React.useEffect(() => { setLocalValue(value || "") }, [value])

    const isDirty = localValue !== (value || "")

    const display = React.useMemo(() => {
        const v = localValue || value
        if (!v) return "—"
        try {
            return new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        } catch { return v }
    }, [localValue, value])

    const isOverdue = React.useMemo(() => {
        const v = localValue || value
        if (!v) return false
        try { return new Date(v).getTime() < Date.now() } catch { return false }
    }, [localValue, value])

    const todayMin = React.useMemo(() => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00`
    }, [])

    const handleSave = async () => {
        if (!localValue) return
        setSaving(true)
        try {
            onSave(localValue)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="inline-flex items-center gap-0.5">
            <div
                className="relative cursor-pointer"
                onClick={() => inputRef.current?.showPicker()}
            >
                <span
                    className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded border border-dashed hover:border-primary/50 hover:bg-muted/30 transition-colors flex items-center gap-1 group/dl",
                        isOverdue ? "text-red-400 border-red-400/30" : "text-muted-foreground/70 border-muted-foreground/20"
                    )}
                >
                    <Calendar className="h-2.5 w-2.5" />
                    {display}
                </span>
                <input
                    ref={inputRef}
                    type="datetime-local"
                    value={localValue}
                    min={todayMin}
                    onChange={e => setLocalValue(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full [color-scheme:dark] dark:[color-scheme:dark]"
                />
            </div>
            {isDirty && (
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 font-medium transition-colors"
                    title="Save deadline"
                >
                    {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
                </button>
            )}
        </div>
    )
}
