"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import {
    ActionableItem,
    TaskStatus,
    ActionableComment,
    Team,
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
    Undo2, FileText, ExternalLink, Download, Flag, RotateCcw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { RoleRedirect } from "@/components/auth/role-redirect"
import {
    safeStr, normalizeRisk, formatDate, formatDateShort, formatTime, formatDateTime, deadlineCategory,
    RISK_STYLES, RISK_OPTIONS, WORKSTREAM_COLORS, DEFAULT_WORKSTREAM_COLORS,
    TASK_STATUS_STYLES, ALL_TASK_STATUSES, STATUS_SORT_ORDER, getWorkstreamClass,
} from "@/lib/status-config"
import { useTeams } from "@/lib/use-teams"
import { useActionables } from "@/lib/use-actionables"
import { RiskIcon, ProgressBar, EvidencePopover, EvidenceFileList, SectionDivider, StatCell, StatDivider, EmptyState } from "@/components/shared/status-components"

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlatRow {
    item: ActionableItem
    docId: string
    docName: string
}

// ─── Main Tracker Page ───────────────────────────────────────────────────────

export default function DashboardPage() {
    const { teamTree } = useTeams()
    const { data: session } = useSession()
    const userName = session?.user?.name || "Compliance Officer"
    const { allDocs, setAllDocs, loading, load: loadAll, handleUpdate, handleAddComment } = useActionables({
        commentRole: "compliance_officer",
        commentAuthor: userName,
    })
    const [searchQuery, setSearchQuery] = React.useState("")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [riskFilter, setRiskFilter] = React.useState<string>("all")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [docFilter, setDocFilter] = React.useState<string>("all")
    const [teamFilter, setTeamFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("risk")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())
    const [activeCollapsed, setActiveCollapsed] = React.useState(true)
    const [completedCollapsed, setCompletedCollapsed] = React.useState(true)
    const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set())
    const toggleRow = React.useCallback((key: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }, [])

    const [rejectingItem, setRejectingItem] = React.useState<{ docId: string; item: ActionableItem } | null>(null)
    const [rejectReason, setRejectReason] = React.useState("")

    // Per-team rejection state for multi-team items
    const [rejectingTeamInfo, setRejectingTeamInfo] = React.useState<{ docId: string; itemId: string; team: string } | null>(null)
    const [rejectTeamReason, setRejectTeamReason] = React.useState("")

    // Unpublish confirmation state
    const [unpublishingItem, setUnpublishingItem] = React.useState<{ docId: string; itemId: string } | null>(null)

    const handleUnpublish = React.useCallback(async (docId: string, item: ActionableItem) => {
        // Reset actionable back to default state in Actionables section
        // Preserve: deadline, text content, implementation, evidence structure, risk
        // Reset: evidence submissions, comments, completion state, task_status, published_at
        const resetUpdates: Record<string, unknown> = {
            published_at: "",
            task_status: "",
            completion_date: "",
            approval_status: "pending",
            evidence_files: [],
            comments: [],
            rejection_reason: "",
            justification: "",
            justification_by: "",
            justification_at: "",
            justification_status: "",
            is_delayed: false,
            delay_detected_at: "",
            submitted_at: "",
            team_reviewer_name: "",
            team_reviewer_approved_at: "",
            team_reviewer_rejected_at: "",
            reviewer_comments: "",
        }
        // For multi-team items, also reset each team workflow's submission fields
        if (isMultiTeam(item) && item.team_workflows) {
            const resetWorkflows: Record<string, unknown> = {}
            for (const team of item.assigned_teams || []) {
                const tw = item.team_workflows[team]
                if (tw) {
                    resetWorkflows[team] = {
                        ...tw,
                        task_status: "",
                        completion_date: "",
                        evidence_files: [],
                        comments: [],
                        rejection_reason: "",
                        justification: "",
                        justification_by: "",
                        justification_at: "",
                        justification_status: "",
                        is_delayed: false,
                        delay_detected_at: "",
                        submitted_at: "",
                        team_reviewer_name: "",
                        team_reviewer_approved_at: "",
                        team_reviewer_rejected_at: "",
                        reviewer_comments: "",
                    }
                }
            }
            resetUpdates.team_workflows = resetWorkflows
        }
        await handleUpdate(docId, item.id, resetUpdates)
        setUnpublishingItem(null)
        toast.success("Actionable unpublished — returned to Actionables")
    }, [handleUpdate])

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

    // Unique doc names for filter dropdown
    const docOptions = React.useMemo(() => {
        const map = new Map<string, string>()
        for (const r of allRows) {
            if (!map.has(r.docId)) map.set(r.docId, r.docName)
        }
        return Array.from(map.entries())
    }, [allRows])

    // Unique team names for filter dropdown
    const teamOptions = React.useMemo(() => {
        const s = new Set<string>()
        for (const r of allRows) {
            const classification = getClassification(r.item)
            s.add(classification)
        }
        return Array.from(s).sort()
    }, [allRows])

    // Filter + Sort
    const filtered = React.useMemo(() => {
        let result = allRows.filter(({ item, docId }) => {
            if (statusFilter !== "all" && (item.task_status || "assigned") !== statusFilter) return false
            if (riskFilter !== "all" && normalizeRisk(item.modality) !== riskFilter) return false
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (docFilter !== "all" && docId !== docFilter) return false
            if (teamFilter !== "all" && getClassification(item) !== teamFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                // Include classification in search so "Mixed Team" is searchable
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
    }, [allRows, statusFilter, riskFilter, deadlineFilter, docFilter, teamFilter, searchQuery, sortBy, sortDir])

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

    // Group active items by classification (multi-team items go to "Mixed Team")
    const grouped = React.useMemo(() => {
        const groups: Record<string, FlatRow[]> = {}
        for (const row of activeRows) {
            // Use getClassification to determine grouping - multi-team items go to "Mixed Team"
            const classification = getClassification(row.item)
            if (!groups[classification]) groups[classification] = []
            groups[classification].push(row)
        }
        return groups
    }, [activeRows])

    // Hierarchical ordered entries: walks teamTree producing parent headers + leaf groups
    type TreeEntry = { type: "parent"; name: string; depth: number; totalCount: number } | { type: "leaf"; name: string; depth: number }
    const orderedEntries = React.useMemo(() => {
        const entries: TreeEntry[] = []
        // Mixed Team first if present
        if (grouped[MIXED_TEAM_CLASSIFICATION]?.length) {
            entries.push({ type: "leaf", name: MIXED_TEAM_CLASSIFICATION, depth: 0 })
        }
        // Walk tree recursively
        function countDescendantItems(node: Team): number {
            const own = (grouped[node.name] || []).length
            return own + (node.children || []).reduce((sum: number, c: Team) => sum + countDescendantItems(c), 0)
        }
        function walk(node: Team, depth: number) {
            const total = countDescendantItems(node)
            if (total === 0) return
            const isLeaf = !node.children?.length
            if (isLeaf) {
                entries.push({ type: "leaf", name: node.name, depth })
            } else {
                entries.push({ type: "parent", name: node.name, depth, totalCount: total })
                for (const child of node.children || []) {
                    walk(child as Team, depth + 1)
                }
            }
        }
        for (const root of teamTree) walk(root, 0)
        // Any teams not in tree (e.g. "Other")
        const treeNames = new Set(entries.map(e => e.name))
        for (const key of Object.keys(grouped)) {
            if (!treeNames.has(key) && key !== MIXED_TEAM_CLASSIFICATION && grouped[key].length > 0) {
                entries.push({ type: "leaf", name: key, depth: 0 })
            }
        }
        return entries
    }, [grouped, teamTree])

    // Group completed by classification (multi-team items go to "Mixed Team")
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

    // Hierarchical completed entries: walks teamTree producing parent headers + leaf groups
    const completedEntries = React.useMemo(() => {
        const entries: TreeEntry[] = []
        if (completedByTeam[MIXED_TEAM_CLASSIFICATION]?.length) {
            entries.push({ type: "leaf", name: MIXED_TEAM_CLASSIFICATION, depth: 0 })
        }
        function countDescendantCompleted(node: Team): number {
            const own = (completedByTeam[node.name] || []).length
            return own + (node.children || []).reduce((sum: number, c: Team) => sum + countDescendantCompleted(c), 0)
        }
        function walk(node: Team, depth: number) {
            const total = countDescendantCompleted(node)
            if (total === 0) return
            const isLeaf = !node.children?.length
            if (isLeaf) {
                entries.push({ type: "leaf", name: node.name, depth })
            } else {
                entries.push({ type: "parent", name: node.name, depth, totalCount: total })
                for (const child of node.children || []) walk(child as Team, depth + 1)
            }
        }
        for (const root of teamTree) walk(root, 0)
        const treeNames = new Set(entries.map(e => e.name))
        for (const key of Object.keys(completedByTeam)) {
            if (!treeNames.has(key) && key !== MIXED_TEAM_CLASSIFICATION && completedByTeam[key].length > 0) {
                entries.push({ type: "leaf", name: key, depth: 0 })
            }
        }
        return entries
    }, [completedByTeam, teamTree])

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
                    <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
                        <LayoutDashboard className="h-4 w-4 text-primary" />
                        Implementation Tracker
                    </h1>
                </div>

                {/* ── Stats row ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-3 flex items-center gap-4 overflow-x-auto">
                    <div className="flex items-center gap-4">
                        <StatCell value={stats.total} label="Total" colorClass="text-foreground" />
                        <StatDivider />
                        <StatCell value={stats.completed} label="Completed" colorClass="text-emerald-400" />
                        <StatCell value={stats.inProgress} label="In Progress" colorClass="text-amber-400" />
                        <StatCell value={stats.teamReview} label="Team Review" colorClass="text-teal-400" />
                        <StatCell value={stats.review} label="Under Review" colorClass="text-blue-400" />
                        <StatCell value={stats.reworking} label="Reworking" colorClass="text-orange-400" />
                        <StatCell value={stats.pendingAllTeams} label="Pending Teams" colorClass="text-amber-400" />
                        <StatCell value={stats.assigned} label="Assigned" colorClass="text-slate-400" />
                        <StatDivider />
                        <StatCell value={stats.yetToDeadline} label="Yet to DL" colorClass="text-emerald-500" />
                        <StatCell value={stats.delayed30} label="Delayed 30d" colorClass="text-amber-500" />
                        <StatCell value={stats.delayed60} label="Delayed 60d" colorClass="text-orange-500" />
                        <StatCell value={stats.delayed90} label="Delayed 90d" colorClass="text-red-500" />
                    </div>

                    <div className="flex-1" />

                    <div className="w-48">
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Overall Progress</p>
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

                    <select
                        value={docFilter}
                        onChange={e => setDocFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground max-w-[160px]"
                    >
                        <option value="all">All Documents</option>
                        {docOptions.map(([id, name]) => (
                            <option key={id} value={id}>{name}</option>
                        ))}
                    </select>

                    <select
                        value={teamFilter}
                        onChange={e => setTeamFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground max-w-[160px]"
                    >
                        <option value="all">All Teams</option>
                        {teamOptions.map(t => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>

                    {(statusFilter !== "all" || riskFilter !== "all" || deadlineFilter !== "all" || docFilter !== "all" || teamFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => {
                                setStatusFilter("all")
                                setRiskFilter("all")
                                setDeadlineFilter("all")
                                setDocFilter("all")
                                setTeamFilter("all")
                                setSearchQuery("")
                            }}
                            className="px-2.5 py-1.5 text-xs rounded-md bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/40 focus:border-border"
                        >
                            Clear Filters
                        </button>
                    )}

                    <div className="flex items-center gap-1 ml-auto">
                        <span className="text-xs text-muted-foreground/50">Sort:</span>
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
                            <span className="text-xs">Loading tracker...</span>
                        </div>
                    )}

                    {!loading && allRows.length === 0 && (
                        <EmptyState
                            icon={<LayoutDashboard className="h-8 w-8 text-muted-foreground" />}
                            title="No actionables to track yet"
                            description="Publish actionables from the Actionables page to see them here."
                            className="py-20"
                        />
                    )}

                    {/* ── Active section header ── */}
                    {!loading && activeRows.length > 0 && (
                        <SectionDivider label="Active" count={activeRows.length} icon={<AlertTriangle className="h-3.5 w-3.5" />} borderClass="border-b border-yellow-500/20" textClass="text-yellow-500" collapsed={activeCollapsed} onToggle={() => setActiveCollapsed(!activeCollapsed)} />
                    )}

                    {!loading && !activeCollapsed && orderedEntries.map(entry => {
                        // Check if any ancestor parent is collapsed — applies to both parent and leaf entries
                        const isHiddenByAncestor = (() => {
                            for (let i = orderedEntries.indexOf(entry) - 1; i >= 0; i--) {
                                const prev = orderedEntries[i]
                                if (prev.type === "parent" && prev.depth < entry.depth) {
                                    if (collapsedGroups.has(prev.name)) return true
                                }
                            }
                            return false
                        })()
                        if (isHiddenByAncestor) return null

                        // Parent team header — expandable container
                        if (entry.type === "parent") {
                            const wsColors = WORKSTREAM_COLORS[entry.name] || DEFAULT_WORKSTREAM_COLORS
                            const isCollapsed = collapsedGroups.has(entry.name)
                            return (
                                <div key={`parent-${entry.name}`} style={{ marginLeft: entry.depth > 0 ? `${entry.depth * 12}px` : undefined }}>
                                    <div
                                        className="flex items-center gap-2 px-3 py-2 bg-background/95 backdrop-blur-sm border-b border-border/30 cursor-pointer hover:bg-muted/20 transition-colors"
                                        onClick={() => toggleGroup(entry.name)}
                                    >
                                        {isCollapsed
                                            ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                                        <div className={cn("h-5 w-1.5 rounded-full shrink-0", wsColors.header)} />
                                        <span className="text-xs font-bold text-foreground">{entry.name}</span>
                                        <span className="text-[10px] text-muted-foreground/50 font-mono">{entry.totalCount} items</span>
                                        <div className="h-px bg-border/30 flex-1" />
                                    </div>
                                </div>
                            )
                        }

                        // Leaf team group — render existing table group
                        const ws = entry.name
                        const rows = grouped[ws] || []
                        const isCollapsed = collapsedGroups.has(ws)
                        const wsColors = WORKSTREAM_COLORS[ws] || DEFAULT_WORKSTREAM_COLORS
                        const groupCompleted = rows.filter(r => r.item.task_status === "completed").length
                        const pct = rows.length > 0 ? Math.round((groupCompleted / rows.length) * 100) : 0

                        return (
                            <div key={ws} className="mb-1" style={{ marginLeft: entry.depth > 0 ? `${entry.depth * 12}px` : undefined }}>
                                {/* ── Group header ── */}
                                <div className="flex items-center gap-2 px-3 py-1.5 sticky top-0 z-10 bg-background border-b border-border/20">
                                    <button onClick={() => toggleGroup(ws)} className="flex items-center gap-2 flex-1 min-w-0">
                                        {isCollapsed
                                            ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        }
                                        <div className={cn("h-4 w-1 rounded-full shrink-0", wsColors.header)} />
                                        <span className="text-xs font-semibold text-foreground">{ws}</span>
                                        <span className="text-xs text-muted-foreground/50 font-mono">{rows.length} items</span>
                                    </button>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <div className="w-16 h-1 rounded-full bg-muted/50 overflow-hidden">
                                            <div className="bg-emerald-500 h-full transition-all" style={{ width: `${pct}%` }} />
                                        </div>
                                        <span className="text-[10px] font-mono text-muted-foreground">{groupCompleted}/{rows.length} ({pct}%)</span>
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
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Actions</div>
                                    </div>
                                )}

                                {/* ── Rows ── */}
                                {!isCollapsed && rows.map(({ item, docId, docName }) => {
                                    const rowKey = `${docId}-${item.id}`
                                    const taskStatus = item.task_status || "assigned"
                                    const statusStyle = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
                                    const isExpanded = expandedRows.has(rowKey)
                                    const commentCount = (item.comments || []).length
                                    const multi = isMultiTeam(item)
                                    const assignedTeams = item.assigned_teams || []
                                    // Multi-team progress
                                    const teamCompletedCount = multi ? assignedTeams.filter(t => (item.team_workflows?.[t]?.task_status || "") === "completed").length : 0
                                    // Multi-team parent deadline: latest child deadline
                                    const parentDeadline = multi
                                        ? assignedTeams.reduce((latest, t) => {
                                            const d = item.team_workflows?.[t]?.deadline || ""
                                            return d > latest ? d : latest
                                        }, item.deadline || "")
                                        : (item.deadline || "")

                                    return (
                                        <div key={rowKey} className={cn("border-b border-border/10", taskStatus === "completed" && "opacity-70")}>
                                            {/* ── Parent row ── */}
                                            <div
                                                className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                                                style={{ gridTemplateColumns: gridCols }}
                                                onClick={() => toggleRow(rowKey)}
                                            >
                                                {/* Team */}
                                                <div className="py-1.5 px-1">
                                                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", getWorkstreamClass(getClassification(item)))}>
                                                        {getClassification(item)}
                                                    </span>
                                                </div>
                                                {/* Risk icon */}
                                                <div className="py-1.5 flex justify-center">
                                                    <RiskIcon modality={item.modality} />
                                                </div>
                                                {/* Actionable text + progress indicator for multi-team */}
                                                <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                                                    {isExpanded
                                                        ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                                                        : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                                                    <span className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</span>
                                                    {commentCount > 0 && (
                                                        <span className="shrink-0 flex items-center gap-0.5 text-xs text-primary/60">
                                                            <MessageSquare className="h-2.5 w-2.5" />{commentCount}
                                                        </span>
                                                    )}
                                                    {multi && (
                                                        <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-purple-400/70 bg-purple-500/10 px-1 py-0.5 rounded">
                                                            <span className="inline-block w-8 h-1 rounded-full bg-purple-500/20 overflow-hidden"><span className="block h-full bg-purple-400/70 rounded-full" style={{ width: `${assignedTeams.length ? (teamCompletedCount / assignedTeams.length) * 100 : 0}%` }} /></span>
                                                            {teamCompletedCount}/{assignedTeams.length}
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Status */}
                                                <div className="py-1.5 px-1 text-center">
                                                    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                                                        {statusStyle.label}
                                                    </span>
                                                </div>
                                                {/* Deadline date */}
                                                <div className="py-1.5 px-1 text-center relative" onClick={e => e.stopPropagation()}>
                                                    {!multi ? (
                                                        <DeadlineCell
                                                            value={item.deadline || ""}
                                                            onSave={v => handleUpdate(docId, item.id, { deadline: v })}
                                                            disabled={taskStatus === "completed"}
                                                        />
                                                    ) : (
                                                        <span className={cn(
                                                            "text-[10px] px-1.5 py-0.5 rounded border border-dashed flex items-center justify-center gap-1",
                                                            parentDeadline && new Date(parentDeadline).getTime() < Date.now()
                                                                ? "text-red-400 border-red-400/30"
                                                                : "text-muted-foreground/70 border-muted-foreground/20"
                                                        )} title="Latest child deadline">
                                                            <Calendar className="h-2.5 w-2.5" />
                                                            {parentDeadline ? formatDateShort(parentDeadline) : "—"}
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Deadline time */}
                                                <div className="py-1.5 px-1 text-center">
                                                    <span className="text-[10px] text-muted-foreground/60">
                                                        {!multi ? formatTime(item.deadline) : (parentDeadline ? formatTime(parentDeadline) : "—")}
                                                    </span>
                                                </div>
                                                {/* Evidence */}
                                                <div className="py-1.5 px-1 flex justify-center" onClick={e => e.stopPropagation()}>
                                                    {!multi ? (
                                                        <EvidencePopover files={item.evidence_files || []} taskStatus={taskStatus} />
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground/40">—</span>
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
                                                {/* Actions */}
                                                <div className="py-1.5 px-1 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                                                    {taskStatus === "review" && !multi && (
                                                        <>
                                                            <button
                                                                onClick={() => handleUpdate(docId, item.id, { task_status: "completed", completion_date: new Date().toISOString() })}
                                                                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors font-medium"
                                                                title="Approve — mark as completed"
                                                            >
                                                                <CheckCircle2 className="h-2.5 w-2.5" /> Approve
                                                            </button>
                                                            <button
                                                                onClick={() => { setRejectingItem({ docId, item }); setRejectReason("") }}
                                                                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium"
                                                                title="Reject — send back for rework"
                                                            >
                                                                <XCircle className="h-2.5 w-2.5" /> Reject
                                                            </button>
                                                        </>
                                                    )}
                                                    {taskStatus === "completed" && (
                                                        <span className="text-[10px] text-emerald-400">Approved</span>
                                                    )}
                                                    {taskStatus === "reworking" && (
                                                        <span className="text-[10px] text-orange-400">Reworking</span>
                                                    )}
                                                    {taskStatus === "team_review" && (
                                                        <span className="text-[10px] text-teal-400">Team Review</span>
                                                    )}
                                                    {taskStatus === "reviewer_rejected" && (
                                                        <span className="text-[10px] text-rose-400">Rejected by Reviewer</span>
                                                    )}
                                                    {taskStatus === "awaiting_justification" && (
                                                        <span className="text-[10px] text-yellow-500">Awaiting Lead</span>
                                                    )}
                                                    {taskStatus === "pending_all_teams" && (
                                                        <span className="text-[10px] text-amber-400">Pending Teams</span>
                                                    )}
                                                    {!multi && (taskStatus === "assigned" || taskStatus === "in_progress") && (
                                                        <span className="text-[10px] text-muted-foreground/30">—</span>
                                                    )}
                                                    {/* Bypass flag indicator */}
                                                    {item.bypass_tag && (
                                                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium" title={`Flagged by ${item.bypass_tagged_by || "team member"}`}>
                                                            <Flag className="h-2.5 w-2.5" /> Bypass
                                                        </span>
                                                    )}
                                                    {/* Reset Team — for bypassed items under CO review */}
                                                    {item.bypass_tag && taskStatus === "review" && (
                                                        <button
                                                            onClick={() => handleUpdate(docId, item.id, {
                                                                task_status: "assigned",
                                                                bypass_tag: false,
                                                                bypass_tagged_at: "",
                                                                bypass_tagged_by: "",
                                                                bypass_approved_by: "",
                                                                bypass_approved_at: "",
                                                                team_reviewer_approved_at: "",
                                                                team_reviewer_name: "",
                                                            }).then(() => toast.success("Team reset — actionable returned to Assigned for reassignment"))}
                                                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors font-medium"
                                                            title="Reset team assignment — return to Assigned status"
                                                        >
                                                            <RotateCcw className="h-2.5 w-2.5" /> Reset Team
                                                        </button>
                                                    )}
                                                    {/* Unpublish button */}
                                                    <button
                                                        onClick={() => setUnpublishingItem({ docId, itemId: item.id })}
                                                        className="inline-flex items-center gap-0.5 text-xs px-1 py-0.5 rounded text-muted-foreground/40 hover:bg-amber-500/10 hover:text-amber-500 transition-colors"
                                                        title="Unpublish — return to Actionables"
                                                    >
                                                        <Undo2 className="h-2.5 w-2.5" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* ── Multi-team: Cascading per-team rows ── */}
                                            {multi && isExpanded && assignedTeams.map(team => {
                                                const tw = item.team_workflows?.[team]
                                                const twStatus = (tw?.task_status || "assigned") as TaskStatus
                                                const twStyle = TASK_STATUS_STYLES[twStatus] || TASK_STATUS_STYLES.assigned
                                                const teamColors = WORKSTREAM_COLORS[team] || DEFAULT_WORKSTREAM_COLORS
                                                const teamRowKey = `${rowKey}-team-${team}`
                                                const isTeamExpanded = expandedRows.has(teamRowKey)
                                                const isRejectingThisTeam = rejectingTeamInfo?.docId === docId && rejectingTeamInfo?.itemId === item.id && rejectingTeamInfo?.team === team
                                                const teamCommentCount = (tw?.comments || []).length

                                                return (
                                                    <div key={teamRowKey} className="border-t border-border/5 bg-muted/5">
                                                        {/* Team child row — same grid as parent */}
                                                        <div
                                                            className="grid gap-0 items-center hover:bg-muted/15 transition-colors px-3 cursor-pointer pl-8"
                                                            style={{ gridTemplateColumns: gridCols }}
                                                            onClick={() => toggleRow(teamRowKey)}
                                                        >
                                                            {/* Team tag */}
                                                            <div className="py-1.5 px-1">
                                                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", teamColors.bg, teamColors.text)}>
                                                                    {team}
                                                                </span>
                                                            </div>
                                                            {/* Risk — inherit parent */}
                                                            <div className="py-1.5 flex justify-center">
                                                                <RiskIcon modality={item.modality} />
                                                            </div>
                                                            {/* Implementation text */}
                                                            <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                                                                {isTeamExpanded
                                                                    ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                                                                    : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                                                                <span className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</span>
                                                                {teamCommentCount > 0 && (
                                                                    <span className="shrink-0 flex items-center gap-0.5 text-xs text-primary/60">
                                                                        <MessageSquare className="h-2.5 w-2.5" />{teamCommentCount}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* Status */}
                                                            <div className="py-1.5 px-1 text-center">
                                                                <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", twStyle.bg, twStyle.text)}>
                                                                    {twStyle.label}
                                                                </span>
                                                            </div>
                                                            {/* Deadline date */}
                                                            <div className="py-1.5 px-1 text-center relative" onClick={e => e.stopPropagation()}>
                                                                <DeadlineCell
                                                                    value={tw?.deadline || item.deadline || ""}
                                                                    onSave={v => handleUpdate(docId, item.id, { deadline: v }, team)}
                                                                    disabled={twStatus === "completed"}
                                                                />
                                                            </div>
                                                            {/* Deadline time */}
                                                            <div className="py-1.5 px-1 text-center">
                                                                <span className="text-[10px] text-muted-foreground/60">
                                                                    {formatTime(tw?.deadline || item.deadline)}
                                                                </span>
                                                            </div>
                                                            {/* Evidence */}
                                                            <div className="py-1.5 px-1 flex justify-center" onClick={e => e.stopPropagation()}>
                                                                <EvidencePopover files={tw?.evidence_files || []} taskStatus={twStatus} />
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
                                                                    {twStatus === "completed" ? formatDate(tw?.completion_date) : "—"}
                                                                </span>
                                                            </div>
                                                            {/* Actions */}
                                                            <div className="py-1.5 px-1 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                                                                {twStatus === "review" && (
                                                                    <>
                                                                        <button
                                                                            onClick={() => handleApproveTeam(docId, item, team)}
                                                                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors font-medium"
                                                                        >
                                                                            <CheckCircle2 className="h-2.5 w-2.5" /> Approve
                                                                        </button>
                                                                        <button
                                                                            onClick={() => { setRejectingTeamInfo({ docId, itemId: item.id, team }); setRejectTeamReason("") }}
                                                                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium"
                                                                        >
                                                                            <XCircle className="h-2.5 w-2.5" /> Reject
                                                                        </button>
                                                                    </>
                                                                )}
                                                                {twStatus === "completed" && <span className="text-[10px] text-emerald-400">Approved</span>}
                                                                {twStatus === "reworking" && <span className="text-[10px] text-orange-400">Reworking</span>}
                                                                {(twStatus === "assigned" || twStatus === "in_progress") && <span className="text-[10px] text-muted-foreground/30">—</span>}
                                                                {twStatus === "team_review" && <span className="text-[10px] text-teal-400">Team Review</span>}
                                                                {twStatus === "awaiting_justification" && <span className="text-[10px] text-yellow-500">Awaiting Lead</span>}
                                                            </div>
                                                        </div>

                                                        {/* Per-team rejection input */}
                                                        {isRejectingThisTeam && (
                                                            <div className="bg-red-500/5 border-t border-red-500/20 px-8 py-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
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
                                                                    className="text-xs px-2 py-1.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                                >
                                                                    Reject
                                                                </button>
                                                                <button
                                                                    onClick={() => { setRejectingTeamInfo(null); setRejectTeamReason("") }}
                                                                    className="text-xs px-1.5 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        )}

                                                        {/* Per-team expanded: 2-column layout — styled like single-team */}
                                                        {isTeamExpanded && (
                                                            <div className={cn("border-t border-border/10 px-6 py-4 space-y-3", teamColors.bg)}>
                                                                {/* Circular Source Information */}
                                                                <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                                                                    <div className="flex items-center justify-between">
                                                                        <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <div className="col-span-2">
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable ID</p>
                                                                            <p className="text-xs text-foreground/80 font-mono bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular ID</p>
                                                                            <p className="text-xs text-foreground/80 font-mono">{docId || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Title</p>
                                                                            <p className="text-xs text-foreground/80">{docName || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Issued Date</p>
                                                                            <p className="text-xs text-foreground/80 font-mono">{item.regulation_issue_date ? formatDate(item.regulation_issue_date) : "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Effective Date</p>
                                                                            <p className="text-xs text-foreground/80 font-mono">{item.circular_effective_date ? formatDate(item.circular_effective_date) : "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Regulator</p>
                                                                            <p className="text-xs text-foreground/80">{item.regulator || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable Created</p>
                                                                            <p className="text-xs text-foreground/80 font-mono">{item.created_at ? formatDate(item.created_at) : "—"}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Risk Assessment Framework */}
                                                                <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                                                                    <div className="flex items-center justify-between">
                                                                        <p className="text-xs font-semibold text-foreground/70">Risk Assessment</p>
                                                                    </div>

                                                                    {/* Row 1: Theme + Tranche3 + Impact */}
                                                                    <div className="grid grid-cols-3 gap-2">
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                                                            <p className="text-xs text-foreground/80">{item.theme || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Tranche 3</p>
                                                                            <p className="text-xs text-foreground/80">{item.tranche3 || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Impact</p>
                                                                            <p className="text-xs text-foreground/80">{item.impact_dropdown?.label || "—"}</p>
                                                                        </div>
                                                                    </div>

                                                                    {/* Row 2: Likelihood */}
                                                                    <div>
                                                                        <div className="flex items-center justify-between mb-1">
                                                                            <p className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wider">Likelihood</p>
                                                                            <span className="text-[10px] text-muted-foreground/40">Score: {item.likelihood_score != null ? item.likelihood_score : "—"} (MAX of 3)</span>
                                                                        </div>
                                                                        <div className="grid grid-cols-3 gap-2">
                                                                            <div>
                                                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">Business Volume</p>
                                                                                <p className="text-xs text-foreground/80">{item.likelihood_business_volume?.label || "—"}</p>
                                                                            </div>
                                                                            <div>
                                                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">Products & Processes</p>
                                                                                <p className="text-xs text-foreground/80">{item.likelihood_products_processes?.label || "—"}</p>
                                                                            </div>
                                                                            <div>
                                                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">Compliance Violations</p>
                                                                                <p className="text-xs text-foreground/80">{item.likelihood_compliance_violations?.label || "—"}</p>
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    {/* Row 3: Control */}
                                                                    <div>
                                                                        <div className="flex items-center justify-between mb-1">
                                                                            <p className="text-[10px] font-semibold text-teal-400/80 uppercase tracking-wider">Control</p>
                                                                            <span className="text-[10px] text-muted-foreground/40">Score: {item.control_score != null ? item.control_score.toFixed(1) : "—"} (avg)</span>
                                                                        </div>
                                                                        <div className="grid grid-cols-2 gap-2">
                                                                            <div>
                                                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">Monitoring Mechanism</p>
                                                                                <p className="text-xs text-foreground/80">{item.control_monitoring?.label || "—"}</p>
                                                                            </div>
                                                                            <div>
                                                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">Control Effectiveness</p>
                                                                                <p className="text-xs text-foreground/80">{item.control_effectiveness?.label || "—"}</p>
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    {/* Row 4: Scores */}
                                                                    <div>
                                                                        <div className="flex items-center justify-between mb-1">
                                                                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Scores</p>
                                                                            <span className="text-[10px] text-muted-foreground/40">Derived automatically</span>
                                                                        </div>
                                                                        <div className="grid grid-cols-3 gap-2">
                                                                            <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                                                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Inherent Risk Score</p>
                                                                                <p className="text-sm font-semibold text-foreground">
                                                                                    {item.inherent_risk_score != null ? item.inherent_risk_score.toFixed(2) : <span className="text-muted-foreground/60 text-xs">Not yet calculated</span>}
                                                                                </p>
                                                                            </div>
                                                                            <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                                                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Residual Risk Score</p>
                                                                                <p className="text-sm font-semibold text-foreground">
                                                                                    {item.residual_risk_score != null ? item.residual_risk_score.toFixed(2) : <span className="text-muted-foreground/60 text-xs">Not yet calculated</span>}
                                                                                </p>
                                                                            </div>
                                                                            <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                                                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Residual Risk Interpretation</p>
                                                                                <p className="text-sm font-semibold text-foreground">
                                                                                    {item.residual_risk_label || <span className="text-muted-foreground/60 text-xs">Not yet calculated</span>}
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Banners: justification + rejection */}
                                                                {tw?.justification && tw?.justification_status === "pending_review" && (
                                                                    <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
                                                                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                                                                        <div className="flex-1">
                                                                            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-0.5">Justification — Pending Your Review</p>
                                                                            <p className="text-xs text-foreground/80 mb-1">{tw.justification}</p>
                                                                            <p className="text-xs text-muted-foreground/50 mb-2">Submitted by {tw.justification_by}{tw.justification_at ? ` on ${formatDate(tw.justification_at)}` : ""}</p>
                                                                            <button
                                                                                onClick={() => handleUpdate(docId, item.id, { justification_status: "reviewed" }, team)}
                                                                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-colors font-medium"
                                                                            >
                                                                                <CheckCircle2 className="h-2.5 w-2.5" /> Acknowledge Justification
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {tw?.justification && tw?.justification_status === "reviewed" && (
                                                                    <div className="flex items-start gap-2.5 bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-4 py-3">
                                                                        <CheckCircle2 className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                                                                        <div>
                                                                            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-0.5">Justification — Reviewed</p>
                                                                            <p className="text-xs text-foreground/80">{tw.justification}</p>
                                                                            <p className="text-xs text-muted-foreground/50 mt-1">By {tw.justification_by}</p>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {twStatus === "reworking" && tw?.rejection_reason && (
                                                                    <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                                                                        <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                                                                        <div>
                                                                            <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-0.5">Rejection Reason</p>
                                                                            <p className="text-xs text-foreground/80">{tw.rejection_reason}</p>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {/* Approve/Reject buttons for items under review */}
                                                                {twStatus === "review" && (
                                                                    <div className="flex items-center gap-3 mb-3">
                                                                        <button
                                                                            onClick={() => handleApproveTeam(docId, item, team)}
                                                                            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium"
                                                                        >
                                                                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve & Complete
                                                                        </button>
                                                                        <button
                                                                            onClick={() => { setRejectingTeamInfo({ docId, itemId: item.id, team }); setRejectTeamReason("") }}
                                                                            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                                                                        >
                                                                            <XCircle className="h-3.5 w-3.5" /> Reject for Rework
                                                                        </button>
                                                                    </div>
                                                                )}

                                                                <div className="grid grid-cols-2 gap-4">
                                                                    <div className="space-y-3">
                                                                        <div>
                                                                            <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Implementation</p>
                                                                            <p className="text-xs text-foreground/80 whitespace-pre-wrap">{safeStr(tw?.implementation_notes || item.implementation_notes) || <span className="italic text-muted-foreground/30">No implementation notes</span>}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Evidence</p>
                                                                            <p className="text-xs text-foreground/80 whitespace-pre-wrap italic">{safeStr(tw?.evidence_quote || item.evidence_quote) || <span className="text-muted-foreground/30">No evidence</span>}</p>
                                                                        </div>

                                                                        {/* Evidence Files */}
                                                                        {(tw?.evidence_files && tw.evidence_files.length > 0) && (
                                                                            <div>
                                                                                <div className="flex items-center gap-2 mb-2">
                                                                                    <Paperclip className="h-3.5 w-3.5 text-primary/60" />
                                                                                    <span className="text-xs font-semibold text-foreground/80">Evidence Files</span>
                                                                                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{tw.evidence_files.length}</span>
                                                                                </div>
                                                                                <EvidenceFileList
                                                                                    files={tw.evidence_files}
                                                                                    formatDate={formatDate}
                                                                                    readOnly
                                                                                />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                                                        <CommentThread
                                                                            comments={tw?.comments || []}
                                                                            currentUser={userName}
                                                                            currentRole="compliance_officer"
                                                                            onAddComment={async (text) => {
                                                                                const newComment: ActionableComment = {
                                                                                    id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                                                                    author: userName,
                                                                                    role: "compliance_officer",
                                                                                    text,
                                                                                    timestamp: new Date().toISOString(),
                                                                                }
                                                                                const existing = tw?.comments || []
                                                                                await handleUpdate(docId, item.id, { comments: [...existing, newComment] }, team)
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}

                                            {/* ── Single-team rejection reason input ── */}
                                            {!multi && rejectingItem?.item.id === item.id && rejectingItem.docId === docId && (
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
                                                        className="text-xs px-2.5 py-1.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                    >
                                                        Confirm Reject
                                                    </button>
                                                    <button
                                                        onClick={() => { setRejectingItem(null); setRejectReason("") }}
                                                        className="text-xs px-2 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            )}

                                            {/* ── Unpublish confirmation ── */}
                                            {unpublishingItem?.itemId === item.id && unpublishingItem.docId === docId && (
                                                <div className="bg-amber-500/5 border-t border-amber-500/20 px-6 py-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                                    <span className="text-xs text-amber-500 font-medium">Unpublish this actionable? It will return to the Actionables page with submissions reset.</span>
                                                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                                        <button
                                                            onClick={() => handleUnpublish(docId, item)}
                                                            className="text-xs px-2.5 py-1.5 rounded bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 font-medium transition-colors"
                                                        >
                                                            Confirm Unpublish
                                                        </button>
                                                        <button
                                                            onClick={() => setUnpublishingItem(null)}
                                                            className="text-xs px-2 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* ── Single-team expanded: 2-column layout ── */}
                                            {!multi && isExpanded && (() => {
                                                const teamColor = WORKSTREAM_COLORS[item.workstream] || DEFAULT_WORKSTREAM_COLORS
                                                return (
                                                <div className={cn("border-t border-border/10 px-6 py-4 space-y-3", teamColor.bg)}>
                                                
                                                    {/* Banners: justification + rejection */}
                                                    {item.justification && item.justification_status === "pending_review" && (
                                                        <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
                                                            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                                                            <div className="flex-1">
                                                                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-0.5">Justification — Pending Your Review</p>
                                                                <p className="text-xs text-foreground/80 mb-1">{item.justification}</p>
                                                                <p className="text-xs text-muted-foreground/50 mb-2">Submitted by {item.justification_by}{item.justification_at ? ` on ${formatDate(item.justification_at)}` : ""}</p>
                                                                <button
                                                                    onClick={() => handleUpdate(docId, item.id, { justification_status: "reviewed" })}
                                                                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-colors font-medium"
                                                                >
                                                                    <CheckCircle2 className="h-2.5 w-2.5" /> Acknowledge Justification
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {item.justification && item.justification_status === "reviewed" && (
                                                        <div className="flex items-start gap-2.5 bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-4 py-3">
                                                            <CheckCircle2 className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-0.5">Justification — Reviewed</p>
                                                                <p className="text-xs text-foreground/80">{item.justification}</p>
                                                                <p className="text-xs text-muted-foreground/50 mt-1">By {item.justification_by}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {taskStatus === "reworking" && item.rejection_reason && (
                                                        <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                                                            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-0.5">Rejection Reason</p>
                                                                <p className="text-xs text-foreground/80">{item.rejection_reason}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Bypass tag banner */}
                                                    {item.bypass_tag && (
                                                        <div className="flex items-start gap-2.5 bg-orange-500/5 border border-orange-500/20 rounded-lg px-4 py-3">
                                                            <Flag className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                                                            <div className="flex-1">
                                                                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Tagged as Incorrectly Assigned</p>
                                                                <p className="text-xs text-foreground/80">This task was flagged by a team member and approved by the Team Reviewer for reassignment.</p>
                                                                {item.bypass_tagged_by && (
                                                                    <p className="text-xs text-muted-foreground/50 mt-1">Flagged by {item.bypass_tagged_by}{item.bypass_tagged_at ? ` on ${formatDate(item.bypass_tagged_at)}` : ""}</p>
                                                                )}
                                                                {item.bypass_approved_by && (
                                                                    <p className="text-xs text-muted-foreground/50">Bypass approved by {item.bypass_approved_by}{item.bypass_approved_at ? ` on ${formatDate(item.bypass_approved_at)}` : ""}</p>
                                                                )}
                                                                {taskStatus === "review" && (
                                                                    <button
                                                                        onClick={() => handleUpdate(docId, item.id, {
                                                                            task_status: "assigned",
                                                                            bypass_tag: false,
                                                                            bypass_tagged_at: "",
                                                                            bypass_tagged_by: "",
                                                                            bypass_approved_by: "",
                                                                            bypass_approved_at: "",
                                                                            team_reviewer_approved_at: "",
                                                                            team_reviewer_name: "",
                                                                        }).then(() => toast.success("Team reset — actionable returned to Assigned for reassignment"))}
                                                                        className="mt-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors font-medium"
                                                                    >
                                                                        <RotateCcw className="h-3 w-3" /> Reset Team Assignment
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Approve/Reject buttons for items under review */}
                                                    {taskStatus === "review" && (
                                                        <div className="flex items-center gap-3 mb-3">
                                                            <button
                                                                onClick={() => handleUpdate(docId, item.id, { task_status: "completed", completion_date: new Date().toISOString() })}
                                                                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium"
                                                            >
                                                                <CheckCircle2 className="h-3.5 w-3.5" /> Approve & Complete
                                                            </button>
                                                            <button
                                                                onClick={() => { setRejectingItem({ docId, item }); setRejectReason("") }}
                                                                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                                                            >
                                                                <XCircle className="h-3.5 w-3.5" /> Reject for Rework
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* 2-column: left=impl+evidence, right=comments (full height) */}
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="space-y-3">
                                                            {item.actionable_id && (
                                                                <div>
                                                                    <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Actionable ID</p>
                                                                    <p className="text-xs font-mono text-foreground/80 bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id}</p>
                                                                </div>
                                                            )}
                                                            <div>
                                                                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Implementation</p>
                                                                <p className="text-xs text-foreground/80 whitespace-pre-wrap">{safeStr(item.implementation_notes) || <span className="italic text-muted-foreground/30">No implementation notes</span>}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Evidence</p>
                                                                <p className="text-xs text-foreground/80 whitespace-pre-wrap italic">{safeStr(item.evidence_quote) || <span className="text-muted-foreground/30">No evidence</span>}</p>
                                                            </div>

                                                            {/* Circular Source Information */}
                                                            <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                                                                <div className="flex items-center justify-between">
                                                                    <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <div className="col-span-2">
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable ID</p>
                                                                        <p className="text-xs text-foreground/80 font-mono bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular ID</p>
                                                                        <p className="text-xs text-foreground/80 font-mono">{docId || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Title</p>
                                                                        <p className="text-xs text-foreground/80">{docName || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Issued Date</p>
                                                                        <p className="text-xs text-foreground/80 font-mono">{item.regulation_issue_date ? formatDate(item.regulation_issue_date) : "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Effective Date</p>
                                                                        <p className="text-xs text-foreground/80 font-mono">{item.circular_effective_date ? formatDate(item.circular_effective_date) : "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Regulator</p>
                                                                        <p className="text-xs text-foreground/80">{item.regulator || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable Created</p>
                                                                        <p className="text-xs text-foreground/80 font-mono">{item.created_at ? formatDate(item.created_at) : "—"}</p>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Risk Assessment Framework */}
                                                            <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                                                                <div className="flex items-center justify-between">
                                                                    <p className="text-xs font-semibold text-foreground/70">Risk Assessment</p>
                                                                </div>

                                                                {/* Row 1: Theme + Tranche3 + Impact */}
                                                                <div className="grid grid-cols-3 gap-2">
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                                                        <p className="text-xs text-foreground/80">{item.theme || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Tranche 3</p>
                                                                        <p className="text-xs text-foreground/80">{item.tranche3 || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Impact</p>
                                                                        <p className="text-xs text-foreground/80">{item.impact_dropdown?.label || "—"}</p>
                                                                    </div>
                                                                </div>

                                                                {/* Row 2: Likelihood */}
                                                                <div>
                                                                    <div className="flex items-center justify-between mb-1">
                                                                        <p className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wider">Likelihood</p>
                                                                        <span className="text-[10px] font-mono text-blue-400/60">
                                                                            Score: {item.likelihood_score != null ? item.likelihood_score : "—"} (MAX of 3)
                                                                        </span>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-2">
                                                                        <div>
                                                                            <p className="text-[10px] text-muted-foreground/40 mb-0.5">Business Volume</p>
                                                                            <p className="text-xs text-foreground/80">{item.likelihood_business_volume?.label || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] text-muted-foreground/40 mb-0.5">Products & Processes</p>
                                                                            <p className="text-xs text-foreground/80">{item.likelihood_products_processes?.label || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] text-muted-foreground/40 mb-0.5">Compliance Violations</p>
                                                                            <p className="text-xs text-foreground/80">{item.likelihood_compliance_violations?.label || "—"}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Row 3: Control */}
                                                                <div>
                                                                    <div className="flex items-center justify-between mb-1">
                                                                        <p className="text-[10px] font-semibold text-teal-400/80 uppercase tracking-wider">Control</p>
                                                                        <span className="text-[10px] font-mono text-teal-400/60">
                                                                            Score: {item.control_score != null ? item.control_score.toFixed(1) : "—"} (avg)
                                                                        </span>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <div>
                                                                            <p className="text-[10px] text-muted-foreground/40 mb-0.5">Monitoring Mechanism</p>
                                                                            <p className="text-xs text-foreground/80">{item.control_monitoring?.label || "—"}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] text-muted-foreground/40 mb-0.5">Control Effectiveness</p>
                                                                            <p className="text-xs text-foreground/80">{item.control_effectiveness?.label || "—"}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Row 4: Scores */}
                                                                <div>
                                                                    <div className="flex items-center justify-between mb-1">
                                                                        <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Scores</p>
                                                                        <span className="text-[10px] text-muted-foreground/40">Derived automatically</span>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-2">
                                                                        <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                                                            <p className="text-[10px] text-muted-foreground/50 mb-0.5">Inherent Risk Score</p>
                                                                            <p className="text-sm font-semibold text-foreground">
                                                                                {item.inherent_risk_score != null ? item.inherent_risk_score.toFixed(2) : <span className="text-muted-foreground/60 text-xs">Not yet calculated</span>}
                                                                            </p>
                                                                        </div>
                                                                        <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                                                            <p className="text-[10px] text-muted-foreground/50 mb-0.5">Residual Risk Score</p>
                                                                            <p className="text-sm font-semibold text-foreground">
                                                                                {item.residual_risk_score != null ? item.residual_risk_score.toFixed(2) : <span className="text-muted-foreground/60 text-xs">Not yet calculated</span>}
                                                                            </p>
                                                                        </div>
                                                                        <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                                                            <p className="text-[10px] text-muted-foreground/50 mb-0.5">Residual Risk Interpretation</p>
                                                                            <p className="text-sm font-semibold text-foreground">
                                                                                {item.residual_risk_label || <span className="text-muted-foreground/60 text-xs">Not yet calculated</span>}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Evidence Files */}
                                                            {(item.evidence_files && item.evidence_files.length > 0) && (
                                                                <div>
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <Paperclip className="h-3.5 w-3.5 text-primary/60" />
                                                                        <span className="text-xs font-semibold text-foreground/80">Evidence Files</span>
                                                                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{item.evidence_files.length}</span>
                                                                    </div>
                                                                    <EvidenceFileList
                                                                        files={item.evidence_files}
                                                                        formatDate={formatDate}
                                                                        readOnly
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                                            <CommentThread
                                                                comments={item.comments || []}
                                                                currentUser={userName}
                                                                currentRole="compliance_officer"
                                                                onAddComment={async (text) => handleAddComment(docId, item, text)}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                )
                                            })()}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}

                    {/* ── Completed Section ── */}
                    {!loading && completedRows.length > 0 && (
                        <div className="mt-4">
                            <SectionDivider label="Completed" count={completedRows.length} icon={<CheckCircle2 className="h-3.5 w-3.5" />} borderClass="border-y border-border/20" textClass="text-muted-foreground" collapsed={completedCollapsed} onToggle={() => setCompletedCollapsed(!completedCollapsed)} />

                            {!completedCollapsed && completedEntries.map(entry => {
                                // Check if any ancestor parent is collapsed
                                const isHiddenByAncestor = (() => {
                                    for (let i = completedEntries.indexOf(entry) - 1; i >= 0; i--) {
                                        const prev = completedEntries[i]
                                        if (prev.type === "parent" && prev.depth < entry.depth) {
                                            if (collapsedCompletedTeams.has(prev.name)) return true
                                        }
                                    }
                                    return false
                                })()
                                if (isHiddenByAncestor) return null

                                // Parent team header
                                if (entry.type === "parent") {
                                    const wsColors = WORKSTREAM_COLORS[entry.name] || DEFAULT_WORKSTREAM_COLORS
                                    const isCollapsed = collapsedCompletedTeams.has(entry.name)
                                    return (
                                        <div key={`completed-parent-${entry.name}`} style={{ marginLeft: entry.depth > 0 ? `${entry.depth * 12}px` : undefined }}>
                                            <div
                                                className="flex items-center gap-2 px-3 py-1.5 bg-background/95 backdrop-blur-sm border-b border-border/20 cursor-pointer hover:bg-muted/20 transition-colors"
                                                onClick={() => toggleCompletedTeam(entry.name)}
                                            >
                                                {isCollapsed
                                                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                                <div className={cn("h-4 w-1 rounded-full shrink-0", wsColors.header)} />
                                                <span className="text-xs font-bold text-muted-foreground">{entry.name}</span>
                                                <span className="text-[10px] text-muted-foreground/40 font-mono">{entry.totalCount}</span>
                                                <div className="h-px bg-border/20 flex-1" />
                                            </div>
                                        </div>
                                    )
                                }

                                // Leaf team group
                                const ws = entry.name
                                const rows = completedByTeam[ws] || []
                                if (rows.length === 0) return null
                                const isCollapsed = collapsedCompletedTeams.has(ws)
                                const wsColors = WORKSTREAM_COLORS[ws] || DEFAULT_WORKSTREAM_COLORS

                                return (
                                    <div key={`completed-${ws}`} className="mb-0.5" style={{ marginLeft: entry.depth > 0 ? `${entry.depth * 12}px` : undefined }}>
                                        <div className="flex items-center gap-2 px-3 py-1 bg-background/50 border-b border-border/10">
                                            <button onClick={() => toggleCompletedTeam(ws)} className="flex items-center gap-2 flex-1 min-w-0">
                                                {isCollapsed
                                                    ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                                                    : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                                                <div className={cn("h-3 w-0.5 rounded-full shrink-0", wsColors.header)} />
                                                <span className="text-xs font-medium text-muted-foreground">{ws}</span>
                                                <span className="text-xs text-muted-foreground/40 font-mono">{rows.length}</span>
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

                                        {!isCollapsed && rows.map(({ item, docId, docName }) => {
                                            const rowKey = `completed-${docId}-${item.id}`
                                            const isExpanded = expandedRows.has(rowKey)
                                            const commentCount = (item.comments || []).length

                                            return (
                                                <div key={rowKey} className="border-b border-border/5 opacity-70">
                                                    <div
                                                        className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                                                        style={{ gridTemplateColumns: gridCols }}
                                                        onClick={() => toggleRow(rowKey)}
                                                    >
                                                        <div className="py-1.5 px-1">
                                                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", getWorkstreamClass(getClassification(item)))}>
                                                                {getClassification(item)}
                                                            </span>
                                                        </div>
                                                        <div className="py-1.5 flex justify-center"><RiskIcon modality={item.modality} /></div>
                                                        <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                                                            {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                                                            <span className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</span>
                                                            {commentCount > 0 && <span className="shrink-0 flex items-center gap-0.5 text-xs text-primary/60"><MessageSquare className="h-2.5 w-2.5" />{commentCount}</span>}
                                                            {item.actionable_id && (
                                                                <span className="shrink-0 text-[9px] font-mono text-muted-foreground/40 bg-muted/30 px-1 py-0.5 rounded border border-border/20">{item.actionable_id}</span>
                                                            )}
                                                        </div>
                                                        <div className="py-1.5 px-1 text-center">
                                                            <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", TASK_STATUS_STYLES.completed.bg, TASK_STATUS_STYLES.completed.text)}>
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
                                                        <div className="py-1.5 px-1 text-center"><span className="text-[10px] text-emerald-400">Approved</span></div>
                                                    </div>
                                                    {isExpanded && (
                                                        <div className="border border-border/30 rounded-lg mx-3 my-2 px-6 py-4 space-y-3">
                                                            {/* Circular Source Information */}
                                                            <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                                                                <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <div className="col-span-2">
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable ID</p>
                                                                        <p className="text-xs text-foreground/80 font-mono bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular ID</p>
                                                                        <p className="text-xs text-foreground/80 font-mono">{docId || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Title</p>
                                                                        <p className="text-xs text-foreground/80">{docName || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Issued Date</p>
                                                                        <p className="text-xs text-foreground/80 font-mono">{item.regulation_issue_date ? formatDate(item.regulation_issue_date) : "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Effective Date</p>
                                                                        <p className="text-xs text-foreground/80 font-mono">{item.circular_effective_date ? formatDate(item.circular_effective_date) : "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Regulator</p>
                                                                        <p className="text-xs text-foreground/80">{item.regulator || "—"}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable Created</p>
                                                                        <p className="text-xs text-foreground/80 font-mono">{item.created_at ? formatDate(item.created_at) : "—"}</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div className="space-y-3">
                                                                    <div>
                                                                        <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Implementation</p>
                                                                        <p className="text-xs text-foreground/80 whitespace-pre-wrap">{safeStr(item.implementation_notes) || <span className="italic text-muted-foreground/30">No implementation notes</span>}</p>
                                                                    </div>
                                                                </div>
                                                                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                                                    <CommentThread
                                                                        comments={item.comments || []}
                                                                        currentUser={userName}
                                                                        currentRole="compliance_officer"
                                                                        onAddComment={async (text) => handleAddComment(docId, item, text)}
                                                                    />
                                                                </div>
                                                            </div>
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
                        <div className="text-center text-xs text-muted-foreground/60 py-12">
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

function DeadlineCell({ value, onSave, disabled = false }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
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
            const _d = new Date(v); return `${String(_d.getDate()).padStart(2, "0")} ${_d.toLocaleDateString("en-US", { month: "short" })}`
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

    if (disabled) {
        return (
            <span className={cn("text-xs", isOverdue ? "text-red-400" : "text-muted-foreground/60")}>
                {display}
            </span>
        )
    }

    return (
        <div className="inline-flex items-center gap-0.5">
            <div
                className="relative cursor-pointer"
                onClick={() => inputRef.current?.showPicker()}
            >
                <span
                    className={cn(
                        "text-xs px-1.5 py-0.5 rounded border border-dashed hover:border-primary/50 hover:bg-muted/30 transition-colors flex items-center gap-1 group/dl",
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
                    className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 font-medium transition-colors"
                    title="Save deadline"
                >
                    {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
                </button>
            )}
        </div>
    )
}
