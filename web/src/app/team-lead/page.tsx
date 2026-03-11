"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import {
    uploadEvidence,
    deleteEvidence,
} from "@/lib/api"
import {
    ActionableItem,
    ActionableComment,
    TaskStatus,
    getTeamView,
    isMultiTeam,
    getClassification,
    MIXED_TEAM_CLASSIFICATION,
} from "@/lib/types"
import { CommentThread } from "@/components/shared/comment-thread"
import { useSession } from "@/lib/auth-client"
import { getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { AuthGuard } from "@/components/auth/auth-guard"
import { useRouter } from "next/navigation"
import {
    ChevronDown, ChevronRight,
    Loader2, Search, AlertTriangle,
    CheckCircle2,
    MessageSquare, SortAsc, SortDesc,
    Eye, Clock, Users, Paperclip, FileText, ExternalLink, Download, Upload, Trash2, Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
    safeStr, formatDate, formatTime, deadlineCategory,
    WORKSTREAM_COLORS,
    TASK_STATUS_STYLES, STATUS_SORT_ORDER, getWorkstreamClass,
    RESIDUAL_RISK_INTERPRETATION_STYLES,
} from "@/lib/status-config"
import { ProgressBar, EvidencePopover, EvidenceFileList, SectionDivider, StatCell, StatDivider, EmptyState } from "@/components/shared/status-components"
import { useTeams } from "@/lib/use-teams"
import { useActionables } from "@/lib/use-actionables"
import { getVisibleTeamsForRole, isActionableVisible } from "@/lib/visibility"

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlatRow {
    item: ActionableItem
    docId: string
    docName: string
}

// ─── Main Team Lead Content ──────────────────────────────────────────────────

function TeamLeadContent() {
    const router = useRouter()
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userTeam = getUserTeam(session)
    const userName = session?.user?.name || "Team Lead"
    const { teams, getDescendants } = useTeams()

    // Determine visible teams based on lead's role and assigned team
    const visibleTeams = React.useMemo(
        () => getVisibleTeamsForRole(role as any, userTeam, teams, getDescendants),
        [role, userTeam, teams, getDescendants]
    )

    // Redirect non-team-leads away
    const isTeamLead = role === "team_lead"
    React.useEffect(() => {
        if (role === "compliance_officer" || role === "admin") {
            router.replace("/dashboard")
        } else if (role === "team_member") {
            router.replace("/team-board")
        } else if (role === "team_reviewer") {
            router.replace("/team-review")
        }
    }, [role, router])

    const { allDocs, setAllDocs, loading, load: loadAll, handleUpdate } = useActionables({
        forTeam: userTeam || undefined,
        commentRole: "team_lead",
        commentAuthor: userName,
        autoLoad: false,
    })
    const [searchQuery, setSearchQuery] = React.useState("")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("risk")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
    const [expandedRow, setExpandedRow] = React.useState<string | null>(null)
    const [activeCollapsed, setActiveCollapsed] = React.useState(true)
    const [completedCollapsed, setCompletedCollapsed] = React.useState(true)
    const [delayedCollapsed, setDelayedCollapsed] = React.useState(true)
    // Tab: "overview" shows all items, "delayed" shows only delayed items
    const [tab, setTab] = React.useState<"overview" | "delayed">("delayed")

    React.useEffect(() => { if (isTeamLead) loadAll() }, [loadAll, isTeamLead])

    const handleAddComment = React.useCallback(async (docId: string, itemId: string, text: string) => {
        const doc = allDocs.find(d => d.doc_id === docId)
        const rawItem = doc?.actionables.find(a => a.id === itemId)
        const newComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_lead",
            text,
            timestamp: new Date().toISOString(),
        }
        // Get team-specific comments for multi-team items
        let existing: ActionableComment[] = []
        if (rawItem && isMultiTeam(rawItem) && userTeam) {
            existing = rawItem.team_workflows?.[userTeam]?.comments || []
        } else {
            existing = rawItem?.comments || []
        }
        await handleUpdate(docId, itemId, { comments: [...existing, newComment] })
    }, [userName, allDocs, userTeam, handleUpdate])

    const handleUpload = React.useCallback(async (docId: string, itemId: string, file: File) => {
        try {
            const fileData = await uploadEvidence(file)
            const doc = allDocs.find(d => d.doc_id === docId)
            const item = doc?.actionables.find(a => a.id === itemId)
            if (!item) return
            
            const newFile = {
                name: fileData.filename,
                url: fileData.url,
                uploaded_at: new Date().toISOString(),
                stored_name: fileData.stored_name,
            }
            const updatedFiles = [...(item.evidence_files || []), newFile]
            await handleUpdate(docId, itemId, { evidence_files: updatedFiles })
            toast.success(`File "${file.name}" uploaded`)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Upload failed")
        }
    }, [allDocs, handleUpdate])

    // Build flat rows — only published items for the lead's team (+ descendant teams)
    const allRows: FlatRow[] = React.useMemo(() => {
        const rows: FlatRow[] = []
        for (const doc of allDocs) {
            for (const item of doc.actionables) {
                if (item.published_at && isActionableVisible(item, visibleTeams)) {
                    rows.push({ item, docId: doc.doc_id, docName: doc.doc_name })
                }
            }
        }
        return rows
    }, [allDocs, visibleTeams])

    // Project multi-team items to show team-specific status/evidence/comments
    const viewRows = React.useMemo(() => {
        if (!userTeam) return allRows
        return allRows.map(r => ({ ...r, item: getTeamView(r.item, userTeam) }))
    }, [allRows, userTeam])

    // Tab filter
    const tabRows = React.useMemo(() => {
        if (tab === "delayed") {
            return viewRows.filter(r => r.item.is_delayed || (r.item.deadline && new Date(r.item.deadline).getTime() < Date.now() && r.item.task_status !== "completed"))
        }
        return viewRows
    }, [viewRows, tab])

    // Filter + Sort
    const filtered = React.useMemo(() => {
        let result = tabRows.filter(({ item }) => {
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (statusFilter !== "all" && item.task_status !== statusFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.workstream)} ${safeStr(item.actionable_id)}`.toLowerCase()
                if (!s.includes(q)) return false
            }
            return true
        })
        result = [...result].sort((a, b) => {
            let cmp = 0
            if (sortBy === "status") {
                cmp = (STATUS_SORT_ORDER[a.item.task_status || "assigned"] || 3) - (STATUS_SORT_ORDER[b.item.task_status || "assigned"] || 3)
            } else if (sortBy === "deadline") {
                const da = a.item.deadline ? new Date(a.item.deadline).getTime() : Infinity
                const db = b.item.deadline ? new Date(b.item.deadline).getTime() : Infinity
                cmp = da - db
            } else if (sortBy === "published") {
                const pa = a.item.published_at ? new Date(a.item.published_at).getTime() : 0
                const pb = b.item.published_at ? new Date(b.item.published_at).getTime() : 0
                cmp = pb - pa
            }
            return sortDir === "desc" ? -cmp : cmp
        })
        return result
    }, [tabRows, deadlineFilter, statusFilter, searchQuery, sortBy, sortDir])

    // Split
    const delayedRows = React.useMemo(() => filtered.filter(r => r.item.is_delayed || (r.item.deadline && new Date(r.item.deadline).getTime() < Date.now() && r.item.task_status !== "completed")), [filtered])
    const activeRows = React.useMemo(() => filtered.filter(r => r.item.task_status !== "completed" && !(r.item.is_delayed || (r.item.deadline && new Date(r.item.deadline).getTime() < Date.now()))), [filtered])
    const completedRows = React.useMemo(() => filtered.filter(r => r.item.task_status === "completed"), [filtered])

    // Stats
    const stats = React.useMemo(() => {
        const total = viewRows.length
        const delayed = viewRows.filter(r => r.item.is_delayed || (r.item.deadline && new Date(r.item.deadline).getTime() < Date.now() && r.item.task_status !== "completed")).length
        const completed = viewRows.filter(r => r.item.task_status === "completed").length
        const inProgress = viewRows.filter(r => ["in_progress", "assigned"].includes(r.item.task_status || "assigned")).length
        const inReview = viewRows.filter(r => ["team_review", "review"].includes(r.item.task_status || "")).length
        const reworking = viewRows.filter(r => r.item.task_status === "reworking").length
        const justified = viewRows.filter(r => r.item.justification).length
        return { total, delayed, completed, inProgress, inReview, reworking, justified }
    }, [viewRows])

    const gridCols = "minmax(80px,0.7fr) minmax(180px,3fr) 100px 100px 70px 80px 90px 80px"

    if (!isTeamLead) return null

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
                        <Eye className="h-4 w-4 text-indigo-500" />
                        Team Oversight — {userTeam || "All Teams"}
                    </h1>
                    <span className="text-xs text-muted-foreground/50 italic">Read-only oversight view</span>
                </div>

                {/* ── Stats row ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-3 flex items-center gap-4 overflow-x-auto">
                    <div className="flex items-center gap-4">
                        <StatCell value={stats.total} label="Total" colorClass="text-foreground" />
                        <StatDivider />
                        <StatCell value={stats.delayed} label="Delayed" colorClass={stats.delayed > 0 ? "text-red-400" : "text-muted-foreground/40"} />
                        <StatCell value={stats.justified} label="Justified" colorClass="text-indigo-400" />
                        <StatDivider />
                        <StatCell value={stats.inReview} label="In Review" colorClass="text-teal-400" />
                        <StatCell value={stats.completed} label="Completed" colorClass="text-emerald-400" />
                        <StatCell value={stats.inProgress} label="In Progress" colorClass="text-amber-400" />
                        <StatCell value={stats.reworking} label="Reworking" colorClass="text-orange-400" />
                    </div>

                    <div className="flex-1" />

                    <div className="w-48">
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Completion</p>
                        <ProgressBar completed={stats.completed} total={stats.total} />
                    </div>
                </div>

                {/* ── Tabs + Filters ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                    {/* Tabs */}
                    <div className="flex items-center gap-1 mr-3">
                        <button
                            onClick={() => setTab("delayed")}
                            className={cn(
                                "px-3 py-1 text-xs rounded-md font-medium transition-colors",
                                tab === "delayed"
                                    ? "bg-red-500/15 text-red-500 border border-red-500/30"
                                    : "bg-muted/30 text-muted-foreground hover:text-foreground border border-border/40"
                            )}
                        >
                            Delayed ({stats.delayed})
                        </button>
                        <button
                            onClick={() => setTab("overview")}
                            className={cn(
                                "px-3 py-1 text-xs rounded-md font-medium transition-colors",
                                tab === "overview"
                                    ? "bg-indigo-500/15 text-indigo-500 border border-indigo-500/30"
                                    : "bg-muted/30 text-muted-foreground hover:text-foreground border border-border/40"
                            )}
                        >
                            Overview ({stats.total})
                        </button>
                    </div>

                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search actionables..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                        />
                    </div>


                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Status</option>
                        <option value="assigned">Assigned</option>
                        <option value="in_progress">In Progress</option>
                        <option value="team_review">Team Review</option>
                        <option value="review">Under Review</option>
                        <option value="reworking">Reworking</option>
                        <option value="completed">Completed</option>
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

                    {(statusFilter !== "all" || deadlineFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => {
                                setStatusFilter("all")
                                setDeadlineFilter("all")
                                setSearchQuery("")
                            }}
                            className="px-2.5 py-1.5 text-xs rounded-md bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/40"
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
                            <span className="text-xs">Loading team data...</span>
                        </div>
                    )}

                    {!loading && filtered.length === 0 && (
                        <EmptyState
                            icon={<Eye className="h-8 w-8 text-muted-foreground" />}
                            title={tab === "delayed" ? "No delayed actionables" : "No published actionables"}
                            description={tab === "delayed"
                                ? "All tasks for your team are on schedule."
                                : "No published tasks for your team yet."
                            }
                            className="py-20"
                        />
                    )}

                    {/* ── Delayed section (always first if items exist) ── */}
                    {!loading && tab === "overview" && delayedRows.length > 0 && (
                        <>
                            <SectionDivider label="Delayed" count={delayedRows.length} icon={<Clock className="h-3.5 w-3.5" />} borderClass="border-b border-red-500/20" textClass="text-red-500" collapsed={delayedCollapsed} onToggle={() => setDelayedCollapsed(!delayedCollapsed)} />

                            {!delayedCollapsed && (
                                <>
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Delay</div>
                                    </div>
                                    {delayedRows.map(({ item, docId, docName }) => (
                                        <OversightRow
                                            key={`delayed-${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            docName={docName}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            userTeam={userTeam || ""}
                                            onAddComment={handleAddComment}
                                            onUpload={handleUpload}
                                            onUpdate={handleUpdate}
                                        />
                                    ))}
                                </>
                            )}
                        </>
                    )}

                    {/* ── Active section ── */}
                    {!loading && activeRows.length > 0 && (
                        <>
                            <SectionDivider label="Active" count={activeRows.length} icon={<AlertTriangle className="h-3.5 w-3.5" />} borderClass="border-b border-indigo-500/20" textClass="text-indigo-500" collapsed={activeCollapsed} onToggle={() => setActiveCollapsed(!activeCollapsed)} />

                            {!activeCollapsed && (
                                <>
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Delay</div>
                                    </div>
                                    {activeRows.map(({ item, docId, docName }) => (
                                        <OversightRow
                                            key={`active-${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            docName={docName}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            userTeam={userTeam || ""}
                                            onAddComment={handleAddComment}
                                            onUpload={handleUpload}
                                            onUpdate={handleUpdate}
                                        />
                                    ))}
                                </>
                            )}
                        </>
                    )}

                    {/* ── Delayed-only tab rows ── */}
                    {!loading && tab === "delayed" && filtered.length > 0 && (
                        <>
                            <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Delay</div>
                            </div>
                            {filtered.map(({ item, docId, docName }) => (
                                <OversightRow
                                    key={`delayed-tab-${docId}-${item.id}`}
                                    item={item}
                                    docId={docId}
                                    docName={docName}
                                    expandedRow={expandedRow}
                                    setExpandedRow={setExpandedRow}
                                    userName={userName}
                                    userTeam={userTeam || ""}
                                    onAddComment={handleAddComment}
                                    onUpload={handleUpload}
                                    onUpdate={handleUpdate}
                                />
                            ))}
                        </>
                    )}

                    {/* ── Completed section — matches Active with same content, read-only ── */}
                    {!loading && tab === "overview" && completedRows.length > 0 && (
                        <div className="mt-4">
                            <SectionDivider label="Completed" count={completedRows.length} icon={<CheckCircle2 className="h-3.5 w-3.5" />} borderClass="border-y border-border/20" textClass="text-muted-foreground" collapsed={completedCollapsed} onToggle={() => setCompletedCollapsed(!completedCollapsed)} />

                            {!completedCollapsed && (
                                <>
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Delay</div>
                                    </div>
                                    {completedRows.map(({ item, docId, docName }) => (
                                        <OversightRow
                                            key={`completed-${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            docName={docName}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            userTeam={userTeam || ""}
                                            onAddComment={handleAddComment}
                                            onUpload={handleUpload}
                                            onUpdate={handleUpdate}
                                        />
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    )

}

// ─── Oversight Row (read-only + delay management) ────────────────────────────

function OversightRow({
    item,
    docId,
    docName,
    expandedRow,
    setExpandedRow,
    userName,
    userTeam,
    onAddComment,
    onUpload,
    onUpdate,
}: {
    item: ActionableItem
    docId: string
    docName: string
    expandedRow: string | null
    setExpandedRow: (v: string | null) => void
    userName: string
    userTeam: string
    onAddComment: (docId: string, itemId: string, text: string) => Promise<void>
    onUpload: (docId: string, itemId: string, file: File) => void
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
}) {
    const rowKey = `${docId}-${item.id}`
    const taskStatus = (item.task_status || "assigned") as TaskStatus
    const statusStyle = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
    const isExpanded = expandedRow === rowKey
    const commentCount = (item.comments || []).length
    const isDelayed = item.is_delayed || (item.deadline && new Date(item.deadline).getTime() < Date.now() && taskStatus !== "completed")
    const isAwaitingJustification = taskStatus === "awaiting_justification"
    const isReadOnly = taskStatus === "completed" || taskStatus === "review"

    const inputRef = React.useRef<HTMLInputElement>(null)
    const files = item.evidence_files || []

    // Draft state for lead comment + Save button
    const [draftLeadComment, setDraftLeadComment] = React.useState(item.lead_comment || "")
    const [saving, setSaving] = React.useState(false)
    // Delay justification state (shared field)
    const [draftDelayJustification, setDraftDelayJustification] = React.useState(item.delay_justification || "")
    const [showDelayJustApprove, setShowDelayJustApprove] = React.useState(false)

    React.useEffect(() => {
        setDraftLeadComment(item.lead_comment || "")
        setDraftDelayJustification(item.delay_justification || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id])

    const isCommentDirty = draftLeadComment !== (item.lead_comment || "")

    const handleSaveComment = React.useCallback(async () => {
        setSaving(true)
        try {
            await onUpdate(docId, item.id, { lead_comment: draftLeadComment })
            toast.success("Comment saved")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save")
        } finally {
            setSaving(false)
        }
    }, [draftLeadComment, onUpdate, docId, item.id])

    // Approve delay justification (Lead optionally edits shared text + approves)
    const handleApproveDelayJustification = React.useCallback(async () => {
        if (!draftDelayJustification.trim()) return
        await onUpdate(docId, item.id, {
            delay_justification: draftDelayJustification.trim(),
            delay_justification_lead_approved: true,
            delay_justification_updated_by: userName,
            delay_justification_updated_at: new Date().toISOString(),
        })
        setShowDelayJustApprove(false)
        toast.success("Delay justification approved — fully approved")
    }, [draftDelayJustification, onUpdate, docId, item.id, userName])

    // Reject delay justification — resets entire chain, member must re-enter
    const handleRejectDelayJustification = React.useCallback(async () => {
        await onUpdate(docId, item.id, {
            delay_justification: "",
            delay_justification_member_submitted: false,
            delay_justification_reviewer_approved: false,
            delay_justification_lead_approved: false,
            delay_justification_updated_by: userName,
            delay_justification_updated_at: new Date().toISOString(),
        })
        setShowDelayJustApprove(false)
        setDraftDelayJustification("")
        toast.success("Delay justification rejected — member must resubmit")
    }, [onUpdate, docId, item.id, userName])

    const handleUploadClick = () => {
        inputRef.current?.click()
    }

    const handleFileSelected = async (file: File) => {
        onUpload(docId, item.id, file)
    }

    const handleDeleteFile = async (idx: number) => {
        const file = files[idx]
        if (!file) return
        const updated = [...files]
        updated.splice(idx, 1)
        try {
            await onUpdate(docId, item.id, { evidence_files: updated })
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update task")
            return
        }

        const storedName = file.stored_name || file.url?.split("/").pop()
        if (storedName) {
            try {
                await deleteEvidence(storedName)
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "File removed from task but failed to delete from storage")
                return
            }
        }

        toast.success("File removed")
    }


    const gridCols = "minmax(80px,0.7fr) minmax(180px,3fr) 100px 100px 70px 80px 90px 80px"

    return (
        <div className={cn("border-b border-border/10", taskStatus === "completed" && "opacity-70", isDelayed && "bg-red-500/[0.03]")}>
            <div
                className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                style={{ gridTemplateColumns: gridCols }}
                onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
            >
                {/* Team */}
                <div className="py-1.5 px-1">
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", WORKSTREAM_COLORS[item.workstream]?.bg, WORKSTREAM_COLORS[item.workstream]?.text || "text-muted-foreground")}>
                        {item.workstream}
                    </span>
                </div>

                {/* Actionable text */}
                <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                    {isExpanded
                        ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                        : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                    <span className="text-xs text-foreground/90 truncate">
                        {safeStr(item.action)}
                    </span>
                    {isMultiTeam(item) && (
                        <span className={cn("shrink-0 px-1.5 py-0.5 rounded text-xs font-medium", getWorkstreamClass(MIXED_TEAM_CLASSIFICATION))} title={`Teams: ${item.assigned_teams!.join(", ")}`}>
                            {MIXED_TEAM_CLASSIFICATION}
                        </span>
                    )}
                    {commentCount > 0 && (
                        <span className="shrink-0 flex items-center gap-0.5 text-xs text-primary/60">
                            <MessageSquare className="h-2.5 w-2.5" />{commentCount}
                        </span>
                    )}
                    {isDelayed && (
                        <span className="shrink-0 flex items-center gap-0.5 text-xs text-red-400">
                            <Clock className="h-2.5 w-2.5" />
                        </span>
                    )}
                </div>

                {/* Status */}
                <div className="py-1.5 px-1 text-center">
                    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                        {statusStyle.label}
                    </span>
                </div>

                {/* Deadline */}
                <div className="py-1.5 px-1 text-center">
                    <span className={cn(
                        "text-[10px]",
                        item.deadline && new Date(item.deadline).getTime() < Date.now()
                            ? "text-red-400 font-semibold"
                            : "text-muted-foreground/60"
                    )}>
                        {formatDate(item.deadline)}
                    </span>
                </div>

                {/* Time */}
                <div className="py-1.5 px-1 text-center">
                    <span className="text-[10px] text-muted-foreground/60">
                        {formatTime(item.deadline)}
                    </span>
                </div>

                {/* Evidence */}
                <div className="py-1.5 px-1 flex justify-center" onClick={e => e.stopPropagation()}>
                    <EvidencePopover files={item.evidence_files || []} taskStatus={taskStatus} />
                </div>

                {/* Published */}
                <div className="py-1.5 px-1 text-center">
                    <span className="text-[10px] text-muted-foreground/60">
                        {formatDate(item.published_at)}
                    </span>
                </div>

                {/* Delay indicator */}
                <div className="py-1.5 px-1 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                    {isDelayed && item.delay_justification_lead_approved && (
                        <span className="text-[10px] text-emerald-400 font-medium" title="Delay justification fully approved">Approved</span>
                    )}
                    {isDelayed && item.delay_justification_reviewer_approved && !item.delay_justification_lead_approved && (
                        <span className="text-[10px] text-amber-400 font-semibold animate-pulse" title="Awaiting your approval">Lead Review</span>
                    )}
                    {isDelayed && item.delay_justification_member_submitted && !item.delay_justification_reviewer_approved && (
                        <span className="text-[10px] text-amber-400/70 font-medium" title="Awaiting Reviewer approval">Reviewer Pending</span>
                    )}
                    {isDelayed && !item.delay_justification_member_submitted && (
                        <span className="text-[10px] text-red-400 font-medium" title="Member must submit justification">No Justification</span>
                    )}
                    {!isDelayed && !isAwaitingJustification && (
                        <span className="text-[10px] text-muted-foreground/30">—</span>
                    )}
                </div>
            </div>

            {/* Expanded: 2-column layout */}
            {isExpanded && (
                <div className="border border-border/30 rounded-lg mx-3 my-2 px-6 py-4 space-y-3">
                    {/* Bypass tag banner */}
                    {(item.bypass_tag || taskStatus === "bypass_approved") && (
                        <div className="flex items-start gap-2.5 bg-orange-500/5 border border-orange-500/20 rounded-lg px-4 py-3">
                            <Eye className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Tagged as Incorrectly Assigned</p>
                                <p className="text-xs text-foreground/80">
                                    {taskStatus === "bypass_approved"
                                        ? "Reviewer approved this flag — it is now with the Compliance Officer for final decision."
                                        : "A team member has flagged this task as incorrectly assigned to their team."}
                                </p>
                                {item.bypass_tagged_by && (
                                    <p className="text-xs text-muted-foreground/50 mt-1">Flagged by {item.bypass_tagged_by}{item.bypass_tagged_at ? ` on ${formatDate(item.bypass_tagged_at)}` : ""}</p>
                                )}
                                {item.bypass_approved_by && (
                                    <p className="text-xs text-muted-foreground/50">Approved by reviewer: {item.bypass_approved_by}{item.bypass_approved_at ? ` on ${formatDate(item.bypass_approved_at)}` : ""}</p>
                                )}
                            </div>
                        </div>
                    )}
                    {/* CO disapproval banner */}
                    {item.bypass_disapproval_reason && (
                        <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                            <Eye className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-0.5">Wrongly Tagged Request Disapproved by Compliance Officer</p>
                                <p className="text-xs text-foreground/80">{item.bypass_disapproval_reason}</p>
                                {item.bypass_disapproved_by && (
                                    <p className="text-xs text-muted-foreground/50 mt-1">By {item.bypass_disapproved_by}{item.bypass_disapproved_at ? ` on ${formatDate(item.bypass_disapproved_at)}` : ""}</p>
                                )}
                            </div>
                        </div>
                    )}
                    {/* Reviewer bypass rejection banner */}
                    {item.bypass_reviewer_rejection_reason && (
                        <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
                            <Eye className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-0.5">Wrongly Tagged Request Rejected by Reviewer</p>
                                <p className="text-xs text-foreground/80">{item.bypass_reviewer_rejection_reason}</p>
                                {item.bypass_reviewer_rejected_by && (
                                    <p className="text-xs text-muted-foreground/50 mt-1">By {item.bypass_reviewer_rejected_by}{item.bypass_reviewer_rejected_at ? ` on ${formatDate(item.bypass_reviewer_rejected_at)}` : ""}</p>
                                )}
                            </div>
                        </div>
                    )}
                    {/* Rejection reason banner */}
                    {(taskStatus === "reworking" || taskStatus === "in_progress") && item.rejection_reason && (
                        <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                            <Eye className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-0.5">Rejection Reason</p>
                                <p className="text-xs text-foreground/80">{item.rejection_reason}</p>
                            </div>
                        </div>
                    )}
                    {/* Assigned To */}
                    {item.assigned_to && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">Assigned To</span>
                            <span className="text-xs text-foreground/70">{item.assigned_to}</span>
                        </div>
                    )}
                    {/* Circular Source Information */}
                    <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5 mb-4">
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

                    {/* Theme / Tranche / Impact — read-only from Compliance */}
                    <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                        <p className="text-xs font-semibold text-foreground/70">Compliance Parameters</p>
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.theme || <span className="text-muted-foreground/40 italic">—</span>}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Tranche 3</p>
                                <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.tranche3 || <span className="text-muted-foreground/40 italic">—</span>}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Impact</p>
                                <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.impact_dropdown?.label || <span className="text-muted-foreground/40 italic">—</span>}</p>
                            </div>
                        </div>
                    </div>

                    {/* Delay Justification — shared field: Lead can edit + approve/reject */}
                    {(isDelayed || isAwaitingJustification) && item.delay_justification_member_submitted && item.delay_justification_reviewer_approved && !item.delay_justification_lead_approved && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Delay Justification — Lead Approval Required</p>
                            </div>
                            {!showDelayJustApprove ? (
                                <div className="space-y-2">
                                    <div className="bg-muted/20 rounded p-2 text-xs">
                                        <span className="font-semibold text-foreground/60">Reason for Delay: </span>
                                        <span className="text-foreground/80">{item.delay_justification}</span>
                                        {item.delay_justification_updated_at && <span className="text-muted-foreground/40 ml-1">· {formatDate(item.delay_justification_updated_at)}</span>}
                                    </div>
                                    <div className="text-xs text-emerald-400/80">Reviewer: Approved</div>
                                    <button onClick={() => setShowDelayJustApprove(true)} className="text-xs px-2.5 py-1.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-medium">Review &amp; Approve Justification</button>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <p className="text-[10px] text-amber-400/70">You may edit the justification text before approving, or reject to return to the member.</p>
                                    <textarea
                                        value={draftDelayJustification}
                                        onChange={e => setDraftDelayJustification(e.target.value)}
                                        rows={3}
                                        placeholder="Edit or confirm the delay justification…"
                                        className="w-full bg-muted/30 text-xs rounded px-2 py-1.5 border border-amber-400/30 focus:border-amber-400 focus:outline-none text-foreground resize-none"
                                    />
                                    <div className="flex gap-2">
                                        <button onClick={handleApproveDelayJustification} disabled={!draftDelayJustification.trim()} className="text-xs px-2.5 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 font-semibold disabled:opacity-40">Approve Justification</button>
                                        <button onClick={handleRejectDelayJustification} className="text-xs px-2.5 py-1.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 font-semibold">Reject &amp; Return to Member</button>
                                        <button onClick={() => { setShowDelayJustApprove(false); setDraftDelayJustification(item.delay_justification || "") }} className="text-xs px-2.5 py-1.5 rounded bg-muted/30 text-muted-foreground hover:bg-muted/50">Cancel</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {/* Show fully-approved delay justification */}
                    {(isDelayed || isAwaitingJustification) && item.delay_justification_lead_approved && (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                <p className="text-xs font-semibold text-emerald-400">Delay Justification — Fully Approved</p>
                            </div>
                            <div className="bg-muted/20 rounded p-2 text-xs">
                                <span className="font-semibold text-foreground/60">Reason: </span>
                                <span className="text-foreground/80">{item.delay_justification}</span>
                            </div>
                            <div className="flex gap-3">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">Member: Submitted</span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">Reviewer: Approved</span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">Lead: Approved</span>
                            </div>
                        </div>
                    )}

                    {/* Member + Reviewer comments display */}
                    {(item.member_comment || item.reviewer_comment) && (
                        <div className="grid grid-cols-2 gap-2">
                            {item.member_comment && (
                                <div className="rounded-lg border border-border/30 bg-muted/5 p-2">
                                    <p className="text-[10px] font-semibold text-foreground/50 mb-1">Member Comment</p>
                                    <p className="text-xs text-foreground/70">{item.member_comment}</p>
                                </div>
                            )}
                            {item.reviewer_comment && (
                                <div className="rounded-lg border border-border/30 bg-muted/5 p-2">
                                    <p className="text-[10px] font-semibold text-foreground/50 mb-1">Reviewer Comment</p>
                                    <p className="text-xs text-foreground/70">{item.reviewer_comment}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 2-column: left=impl+files, right=lead comment + chat */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-3">
                            <div>
                                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Implementation</p>
                                <p className="text-xs text-foreground/80 whitespace-pre-wrap">{safeStr(item.implementation_notes) || <span className="italic text-muted-foreground/30">No implementation notes</span>}</p>
                            </div>
                            {/* Evidence files */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Paperclip className="h-3.5 w-3.5 text-primary/60" />
                                        <span className="text-xs font-semibold text-foreground/80">Evidence Files</span>
                                        {files.length > 0 && (
                                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{files.length}</span>
                                        )}
                                    </div>
                                    {!isReadOnly && (
                                        <>
                                            <button
                                                onClick={handleUploadClick}
                                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
                                            >
                                                <Upload className="h-3 w-3" /> Upload File
                                            </button>
                                            <input ref={inputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = "" }} />
                                        </>
                                    )}
                                </div>

                                {files.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-4 bg-background rounded-lg border border-dashed border-border/40">
                                        <Paperclip className="h-5 w-5 text-muted-foreground/20 mb-1" />
                                        <p className="text-xs text-muted-foreground/40">No evidence files uploaded yet</p>
                                        {!isReadOnly && (
                                            <button onClick={handleUploadClick} className="text-xs text-primary hover:underline mt-1">Click to upload</button>
                                        )}
                                    </div>
                                ) : (
                                    <EvidenceFileList
                                        files={files}
                                        formatDate={formatDate}
                                        onDelete={!isReadOnly ? handleDeleteFile : undefined}
                                        readOnly={isReadOnly}
                                    />
                                )}
                            </div>
                        </div>
                        <div className="space-y-3">
                            {/* Lead mandatory comment */}
                            {!isReadOnly && (
                                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-xs font-semibold text-foreground/70">Lead Comment</p>
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-semibold">Required</span>
                                        </div>
                                        {isCommentDirty && (
                                            <button
                                                onClick={handleSaveComment}
                                                disabled={saving}
                                                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary/25 font-semibold transition-colors disabled:opacity-50"
                                            >
                                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                                {saving ? "Saving…" : "Save"}
                                            </button>
                                        )}
                                    </div>
                                    <textarea
                                        value={draftLeadComment}
                                        onChange={e => setDraftLeadComment(e.target.value)}
                                        rows={4}
                                        placeholder="Provide your oversight observations and any escalation notes. Required for all active items."
                                        className="w-full bg-muted/20 text-xs rounded px-2 py-1.5 border border-border/30 focus:border-primary focus:outline-none text-foreground resize-none"
                                    />
                                    {item.lead_comment && (
                                        <p className="text-[10px] text-muted-foreground/40 mt-1">Previously saved: <span className="text-foreground/60">{item.lead_comment}</span></p>
                                    )}
                                </div>
                            )}
                            {isReadOnly && item.lead_comment && (
                                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                    <p className="text-xs font-semibold text-foreground/70 mb-1">Lead Comment</p>
                                    <p className="text-xs text-foreground/80">{item.lead_comment}</p>
                                </div>
                            )}
                            {/* Chat thread */}
                            <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                <p className="text-xs font-semibold text-foreground/50 mb-2">Discussion Thread</p>
                                <CommentThread
                                    comments={item.comments || []}
                                    currentUser={userName}
                                    currentRole="team_lead"
                                    onAddComment={taskStatus !== "completed"
                                        ? async (text) => onAddComment(docId, item.id, text)
                                        : undefined
                                    }
                                />
                            </div>
                        </div>
                    </div>
                    {/* Source info */}
                    <div className="text-xs text-muted-foreground/30 pt-2 border-t border-border/10">
                        Source: {docName}
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Exported page with AuthGuard ────────────────────────────────────────────

export default function TeamLeadPage() {
    return (
        <AuthGuard>
            <TeamLeadContent />
        </AuthGuard>
    )
}
