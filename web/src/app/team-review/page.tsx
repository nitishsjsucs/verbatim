"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import {
    uploadEvidence,
    deleteEvidence,
} from "@/lib/api"
import {
    ActionableItem,
    TaskStatus,
    ActionableComment,
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
    XCircle, MessageSquare, SortAsc, SortDesc,
    Users, Paperclip, FileText, ExternalLink, Download, Upload, Trash2, Flag,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
    safeStr, normalizeRisk, formatDate, formatTime, deadlineCategory,
    RISK_STYLES, RISK_OPTIONS, WORKSTREAM_COLORS,
    TASK_STATUS_STYLES, STATUS_SORT_ORDER, getWorkstreamClass,
} from "@/lib/status-config"
import { RiskIcon, ProgressBar, EvidencePopover, EvidenceFileList, SectionDivider, StatCell, StatDivider, EmptyState } from "@/components/shared/status-components"
import { useTeams } from "@/lib/use-teams"
import { useActionables } from "@/lib/use-actionables"

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlatRow {
    item: ActionableItem
    docId: string
    docName: string
}

// ─── Main Team Review Page ───────────────────────────────────────────────────

function TeamReviewContent() {
    const router = useRouter()
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userTeam = getUserTeam(session)
    const userName = session?.user?.name || "Team Reviewer"
    const { getVisibleTeams } = useTeams()

    // Get all teams visible to this user (their team + all descendants)
    const visibleTeams = React.useMemo(
        () => userTeam ? new Set(getVisibleTeams(userTeam)) : new Set<string>(),
        [userTeam, getVisibleTeams]
    )

    // Redirect non-team-reviewers away
    const isTeamReviewer = role === "team_reviewer"
    React.useEffect(() => {
        if (role === "compliance_officer" || role === "admin") {
            router.replace("/dashboard")
        } else if (role === "team_member") {
            router.replace("/team-board")
        }
    }, [role, router])

    const { allDocs, setAllDocs, loading, load: loadAll, handleUpdate, handleAddComment } = useActionables({
        forTeam: userTeam || undefined,
        commentRole: "team_reviewer",
        commentAuthor: userName,
        autoLoad: false,
    })
    const [searchQuery, setSearchQuery] = React.useState("")
    const [riskFilter, setRiskFilter] = React.useState<string>("all")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("risk")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
    const [expandedRow, setExpandedRow] = React.useState<string | null>(null)
    const [activeCollapsed, setActiveCollapsed] = React.useState(true)
    const [completedCollapsed, setCompletedCollapsed] = React.useState(true)
    // Tab: "pending" shows team_review items, "all" shows all published items for the reviewer's team
    const [tab, setTab] = React.useState<"pending" | "all">("pending")

    React.useEffect(() => { if (isTeamReviewer) loadAll() }, [loadAll, isTeamReviewer])

    // Team Reviewer approve: team_review → review (sends to compliance officer)
    // If delayed and no justification, gate at awaiting_justification
    const handleApprove = React.useCallback(async (docId: string, item: ActionableItem) => {
        const isDelayed = item.is_delayed || (item.deadline && new Date(item.deadline).getTime() < Date.now() && (item.task_status || "assigned") !== "completed")
        const hasJustification = !!item.justification

        // Determine next status: gate delayed tasks without justification
        const nextStatus = (isDelayed && !hasJustification) ? "awaiting_justification" : "review"
        const statusLabel = nextStatus === "awaiting_justification"
            ? "Approved — awaiting Lead justification before Compliance review"
            : "Approved by Team Reviewer — forwarded to Compliance Officer for final review."

        const approveComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_reviewer",
            text: statusLabel,
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        await handleUpdate(docId, item.id, {
            task_status: nextStatus,
            team_reviewer_approved_at: new Date().toISOString(),
            team_reviewer_name: userName,
            comments: [...existing, approveComment],
        })
        if (nextStatus === "awaiting_justification") {
            toast.success("Task approved — blocked until Team Lead submits justification")
        } else {
            toast.success("Task approved — sent to Compliance Officer for review")
        }
    }, [userName, handleUpdate])

    // Team Reviewer approve bypass: sends flagged item directly to CO review
    const handleBypassApprove = React.useCallback(async (docId: string, item: ActionableItem) => {
        const bypassComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_reviewer",
            text: "Bypass approved by Team Reviewer — forwarded to Compliance Officer for reassignment.",
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        await handleUpdate(docId, item.id, {
            task_status: "review",
            bypass_approved_by: userName,
            bypass_approved_at: new Date().toISOString(),
            team_reviewer_approved_at: new Date().toISOString(),
            team_reviewer_name: userName,
            comments: [...existing, bypassComment],
        })
        toast.success("Bypass approved — sent to Compliance Officer for reassignment")
    }, [userName, handleUpdate])

    // Team Reviewer reject: team_review → in_progress (sends back to team member)
    const handleReject = React.useCallback(async (docId: string, item: ActionableItem, reason: string) => {
        const rejectComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_reviewer",
            text: `Rejected by Team Reviewer: ${reason}`,
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        await handleUpdate(docId, item.id, {
            task_status: "reviewer_rejected",
            rejection_reason: reason,
            team_reviewer_rejected_at: new Date().toISOString(),
            team_reviewer_name: userName,
            comments: [...existing, rejectComment],
        })
        toast.success("Task rejected — returned to Team Member with 'Rejected by Reviewer' status")
    }, [userName, handleUpdate])

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

    // Build flat rows — only published items for the reviewer's team (+ descendant teams)
    const allRows: FlatRow[] = React.useMemo(() => {
        const rows: FlatRow[] = []
        for (const doc of allDocs) {
            for (const item of doc.actionables) {
                if (item.published_at) {
                    // If reviewer has a team assigned, filter by it + descendants; otherwise show all
                    if (!userTeam || visibleTeams.has(item.workstream) || (item.assigned_teams && item.assigned_teams.some(t => visibleTeams.has(t)))) {
                        rows.push({ item, docId: doc.doc_id, docName: doc.doc_name })
                    }
                }
            }
        }
        return rows
    }, [allDocs, userTeam, visibleTeams])

    // Project multi-team items to show team-specific status/evidence/comments
    const viewRows = React.useMemo(() => {
        if (!userTeam) return allRows
        return allRows.map(r => ({ ...r, item: getTeamView(r.item, userTeam) }))
    }, [allRows, userTeam])

    // Filter by tab
    const tabRows = React.useMemo(() => {
        if (tab === "pending") {
            return viewRows.filter(r => r.item.task_status === "team_review")
        }
        return viewRows
    }, [viewRows, tab])

    // Filter + Sort
    const filtered = React.useMemo(() => {
        let result = tabRows.filter(({ item }) => {
            if (riskFilter !== "all" && normalizeRisk(item.modality) !== riskFilter) return false
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.workstream)}`.toLowerCase()
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
    }, [tabRows, riskFilter, deadlineFilter, searchQuery, sortBy, sortDir])

    // Split
    const activeRows = React.useMemo(() => filtered.filter(r => r.item.task_status !== "completed"), [filtered])
    const completedRows = React.useMemo(() => filtered.filter(r => r.item.task_status === "completed"), [filtered])

    // Stats
    const stats = React.useMemo(() => {
        const total = viewRows.length
        const teamReview = viewRows.filter(r => r.item.task_status === "team_review").length
        const review = viewRows.filter(r => r.item.task_status === "review").length
        const completed = viewRows.filter(r => r.item.task_status === "completed").length
        const inProgress = viewRows.filter(r => r.item.task_status === "in_progress").length
        const reworking = viewRows.filter(r => r.item.task_status === "reworking").length
        return { total, teamReview, review, completed, inProgress, reworking }
    }, [viewRows])

    const gridCols = "minmax(80px,0.7fr) 36px minmax(180px,3fr) 100px 100px 70px 80px 90px 120px"

    if (!isTeamReviewer) return null

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
                        <Users className="h-4 w-4 text-teal-500" />
                        Team Review Board
                    </h1>
                </div>

                {/* ── Stats row ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-3 flex items-center gap-4 overflow-x-auto">
                    <div className="flex items-center gap-4">
                        <StatCell value={stats.total} label="Total" colorClass="text-foreground" />
                        <StatDivider />
                        <StatCell value={stats.teamReview} label="Pending Review" colorClass="text-teal-400" />
                        <StatCell value={stats.review} label="Forwarded" colorClass="text-blue-400" />
                        <StatCell value={stats.completed} label="Completed" colorClass="text-emerald-400" />
                        <StatCell value={stats.inProgress} label="In Progress" colorClass="text-amber-400" />
                        <StatCell value={stats.reworking} label="Reworking" colorClass="text-orange-400" />
                    </div>

                    <div className="flex-1" />

                    <div className="w-48">
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Review Progress</p>
                        <ProgressBar completed={stats.review + stats.completed} total={stats.total} />
                    </div>
                </div>

                {/* ── Tabs + Filters ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                    {/* Tabs */}
                    <div className="flex items-center gap-1 mr-3">
                        <button
                            onClick={() => setTab("pending")}
                            className={cn(
                                "px-3 py-1 text-xs rounded-md font-medium transition-colors",
                                tab === "pending"
                                    ? "bg-teal-500/15 text-teal-500 border border-teal-500/30"
                                    : "bg-muted/30 text-muted-foreground hover:text-foreground border border-border/40"
                            )}
                        >
                            Pending Review ({stats.teamReview})
                        </button>
                        <button
                            onClick={() => setTab("all")}
                            className={cn(
                                "px-3 py-1 text-xs rounded-md font-medium transition-colors",
                                tab === "all"
                                    ? "bg-primary/15 text-primary border border-primary/30"
                                    : "bg-muted/30 text-muted-foreground hover:text-foreground border border-border/40"
                            )}
                        >
                            All Items ({stats.total})
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

                    {(riskFilter !== "all" || deadlineFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => {
                                setRiskFilter("all")
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
                            <span className="text-xs">Loading review items...</span>
                        </div>
                    )}

                    {!loading && filtered.length === 0 && (
                        <EmptyState
                            icon={<Users className="h-8 w-8 text-muted-foreground" />}
                            title={tab === "pending" ? "No items pending your review" : "No published actionables"}
                            description={tab === "pending"
                                ? "When team members submit their work, it will appear here for your review."
                                : "No published tasks for your team yet."
                            }
                            className="py-20"
                        />
                    )}

                    {/* ── Active section ── */}
                    {!loading && activeRows.length > 0 && (
                        <>
                            <SectionDivider label={tab === "pending" ? "Pending Review" : "Active"} count={activeRows.length} icon={<AlertTriangle className="h-3.5 w-3.5" />} borderClass="border-b border-teal-500/20" textClass="text-teal-500" collapsed={activeCollapsed} onToggle={() => setActiveCollapsed(!activeCollapsed)} />

                            {!activeCollapsed && (
                                <>
                                    {/* Column headers */}
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1">Risk</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Actions</div>
                                    </div>

                                    {/* Rows */}
                                    {activeRows.map(({ item, docId }) => (
                                        <ReviewRow
                                            key={`${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            onApprove={handleApprove}
                                            onReject={handleReject}
                                            onBypassApprove={handleBypassApprove}
                                            onAddComment={handleAddComment}
                                            onUpload={handleUpload}
                                            onUpdate={handleUpdate}
                                        />
                                    ))}
                                </>
                            )}
                        </>
                    )}

                    {/* ── Completed section ── */}
                    {!loading && completedRows.length > 0 && (
                        <div className="mt-4">
                            <SectionDivider label="Completed" count={completedRows.length} icon={<CheckCircle2 className="h-3.5 w-3.5" />} borderClass="border-y border-border/20" textClass="text-muted-foreground" collapsed={completedCollapsed} onToggle={() => setCompletedCollapsed(!completedCollapsed)} />

                            {!completedCollapsed && (
                                <>
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-2">Team</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1">Risk</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Actions</div>
                                    </div>
                                    {completedRows.map(({ item, docId }) => (
                                        <ReviewRow
                                            key={`completed-${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            onApprove={handleApprove}
                                            onReject={handleReject}
                                            onBypassApprove={handleBypassApprove}
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

// ─── Review Row ──────────────────────────────────────────────────────────────

function ReviewRow({
    item,
    docId,
    expandedRow,
    setExpandedRow,
    userName,
    onApprove,
    onReject,
    onBypassApprove,
    onAddComment,
    onUpload,
    onUpdate,
}: {
    item: ActionableItem
    docId: string
    expandedRow: string | null
    setExpandedRow: (v: string | null) => void
    userName: string
    onApprove: (docId: string, item: ActionableItem) => Promise<void>
    onReject: (docId: string, item: ActionableItem, reason: string) => Promise<void>
    onBypassApprove: (docId: string, item: ActionableItem) => Promise<void>
    onAddComment: (docId: string, item: ActionableItem, text: string) => Promise<void>
    onUpload: (docId: string, itemId: string, file: File) => void
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>, teamOverride?: string) => Promise<void>
}) {
    const rowKey = `${docId}-${item.id}`
    const taskStatus = (item.task_status || "assigned") as TaskStatus
    const statusStyle = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
    const isExpanded = expandedRow === rowKey
    const commentCount = (item.comments || []).length
    const isTeamReviewStatus = taskStatus === "team_review"
    const isReadOnly = taskStatus === "completed" || taskStatus === "review"

    const [rejectReason, setRejectReason] = React.useState("")
    const [showRejectInput, setShowRejectInput] = React.useState(false)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const files = item.evidence_files || []

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

    const gridCols = "minmax(80px,0.7fr) 36px minmax(180px,3fr) 100px 100px 70px 80px 90px 120px"

    return (
        <div className={cn("border-b border-border/10", taskStatus === "completed" && "opacity-70")}>
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

                {/* Risk icon */}
                <div className="py-1.5 flex justify-center">
                    <RiskIcon modality={item.modality} />
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
                            ? "text-red-400"
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

                {/* Actions */}
                <div className="py-1.5 px-1 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                    {isTeamReviewStatus && (
                        <>
                            <button
                                onClick={() => onApprove(docId, item)}
                                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors font-medium"
                                title="Approve — forward to Compliance Officer"
                            >
                                <CheckCircle2 className="h-2.5 w-2.5" /> Approve
                            </button>
                            <button
                                onClick={() => setShowRejectInput(true)}
                                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium"
                                title="Reject — send back to Team Member"
                            >
                                <XCircle className="h-2.5 w-2.5" /> Reject
                            </button>
                        </>
                    )}
                    {taskStatus === "review" && (
                        <span className="text-[10px] text-blue-400">CO Review</span>
                    )}
                    {taskStatus === "completed" && (
                        <span className="text-[10px] text-emerald-400">Approved</span>
                    )}
                    {taskStatus === "reworking" && (
                        <span className="text-[10px] text-orange-400">Reworking</span>
                    )}
                    {(taskStatus === "assigned" || taskStatus === "in_progress") && (
                        <span className="text-[10px] text-muted-foreground/30">—</span>
                    )}
                    {/* Bypass tag indicator + approve bypass button */}
                    {item.bypass_tag && isTeamReviewStatus && (
                        <button
                            onClick={() => onBypassApprove(docId, item)}
                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-500 hover:bg-orange-500/25 transition-colors font-medium"
                            title="Approve bypass — forward to CO for reassignment"
                        >
                            <Flag className="h-2.5 w-2.5" /> Approve Bypass
                        </button>
                    )}
                    {item.bypass_tag && !isTeamReviewStatus && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium">
                            <Flag className="h-2.5 w-2.5" /> Flagged
                        </span>
                    )}
                </div>
            </div>

            {/* Reject reason input */}
            {showRejectInput && (
                <div className="bg-red-500/5 border-t border-red-500/20 px-6 py-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <input
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Reason for rejection..."
                        className="flex-1 bg-background text-xs rounded-md px-3 py-1.5 border border-red-500/30 focus:border-red-500 focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === "Enter" && rejectReason.trim()) {
                                onReject(docId, item, rejectReason.trim())
                                setShowRejectInput(false)
                                setRejectReason("")
                            }
                            if (e.key === "Escape") {
                                setShowRejectInput(false)
                                setRejectReason("")
                            }
                        }}
                    />
                    <button
                        onClick={() => {
                            if (rejectReason.trim()) {
                                onReject(docId, item, rejectReason.trim())
                                setShowRejectInput(false)
                                setRejectReason("")
                            }
                        }}
                        disabled={!rejectReason.trim()}
                        className="text-xs px-2.5 py-1.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Confirm Reject
                    </button>
                    <button
                        onClick={() => { setShowRejectInput(false); setRejectReason("") }}
                        className="text-xs px-2 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {/* Expanded: Comment thread */}
            {isExpanded && (
                <div className="border border-border/30 rounded-lg mx-3 my-2 px-6 py-4 space-y-3">
                    {/* Bypass tag banner */}
                    {item.bypass_tag && (
                        <div className="flex items-start gap-2.5 bg-orange-500/5 border border-orange-500/20 rounded-lg px-4 py-3">
                            <Flag className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Tagged as Incorrectly Assigned</p>
                                <p className="text-xs text-foreground/80">A team member has flagged this task as incorrectly assigned to their team.</p>
                                {item.bypass_tagged_by && (
                                    <p className="text-xs text-muted-foreground/50 mt-1">Flagged by {item.bypass_tagged_by}{item.bypass_tagged_at ? ` on ${formatDate(item.bypass_tagged_at)}` : ""}</p>
                                )}
                                {isTeamReviewStatus && (
                                    <button
                                        onClick={() => onBypassApprove(docId, item)}
                                        className="mt-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors font-medium"
                                    >
                                        <CheckCircle2 className="h-3 w-3" /> Approve Bypass — Forward to CO
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    {/* Rejection reason banner (CO or team reviewer rejection) */}
                    {(taskStatus === "reworking" || taskStatus === "in_progress") && item.rejection_reason && (
                        <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-0.5">Rejection Reason</p>
                                <p className="text-xs text-foreground/80">{item.rejection_reason}</p>
                            </div>
                        </div>
                    )}
                    {/* Risk Assessment Framework */}
                    <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5 mb-4">
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

                    {/* 2-column: left=impl+evidence+files, right=comments */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-3">
                            <div>
                                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Implementation</p>
                                <p className="text-xs text-foreground/80 whitespace-pre-wrap">{safeStr(item.implementation_notes) || <span className="italic text-muted-foreground/30">No implementation notes</span>}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Evidence</p>
                                <p className="text-xs text-foreground/80 whitespace-pre-wrap italic">{safeStr(item.evidence_quote) || <span className="text-muted-foreground/30">No evidence</span>}</p>
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
                                            <button
                                                onClick={handleUploadClick}
                                                className="text-xs text-primary hover:underline mt-1"
                                            >
                                                Click to upload
                                            </button>
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
                        <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                            <CommentThread
                                comments={item.comments || []}
                                currentUser={userName}
                                currentRole="team_reviewer"
                                onAddComment={async (text) => onAddComment(docId, item, text)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Exported page with AuthGuard ────────────────────────────────────────────

export default function TeamReviewPage() {
    return (
        <AuthGuard>
            <TeamReviewContent />
        </AuthGuard>
    )
}
