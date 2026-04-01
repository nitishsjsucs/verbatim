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
    RiskSubDropdown,
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
    Users, Paperclip, FileText, ExternalLink, Download, Upload, Trash2, Flag, Save, Calendar,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
    safeStr, formatDate, formatTime, deadlineCategory,
    TASK_STATUS_STYLES, STATUS_SORT_ORDER, getWorkstreamClass,
    RESIDUAL_RISK_INTERPRETATION_STYLES,
} from "@/lib/status-config"
import { ProgressBar, EvidencePopover, EvidenceFileList, SectionDivider, StatCell, StatDivider, EmptyState } from "@/components/shared/status-components"
import { useTeams } from "@/lib/use-teams"
import { DropdownOption, useDropdownConfig } from "@/lib/use-dropdown-config"
import { useActionables } from "@/lib/use-actionables"
import { getVisibleTeamsForRole, isActionableVisible } from "@/lib/visibility"
import { notifyForwardedToCO, notifyCheckerRejectedToMaker, notifyBypassApprovedByChecker, notifyDelayJustificationReviewerApproved } from "@/lib/notifications-helper"

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
    const userName = session?.user?.name || "Checker"
    const { teams, getDescendants } = useTeams()

    // Determine visible teams based on reviewer's role and assigned team
    const visibleTeams = React.useMemo(
        () => getVisibleTeamsForRole(role as any, userTeam, teams, getDescendants),
        [role, userTeam, teams, getDescendants]
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
        callerRole: "team_reviewer",
        autoLoad: false,
    })
    const [searchQuery, setSearchQuery] = React.useState("")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [docFilter, setDocFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("risk")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
    const [expandedRow, setExpandedRow] = React.useState<string | null>(null)
    const [activeCollapsed, setActiveCollapsed] = React.useState(true)
    const [completedCollapsed, setCompletedCollapsed] = React.useState(true)
    // Tab: "pending" shows team_review items, "all" shows all published items for the reviewer's team
    const [tab, setTab] = React.useState<"pending" | "all">("pending")

    React.useEffect(() => { if (isTeamReviewer) loadAll() }, [loadAll, isTeamReviewer])

    // Team Reviewer approve: team_review → review (sends to compliance officer)
    // GATE: If delay justification exists but not approved by Reviewer, block actionable approval
    const handleApprove = React.useCallback(async (docId: string, item: ActionableItem) => {
        // Validate reviewer_comment is filled before approval
        if (!item.reviewer_comment?.trim()) {
            toast.error("Cannot approve — Checker Comment is required. Please save your comment first.")
            return
        }

        const isDelayed = item.is_delayed || (item.deadline && new Date(item.deadline).getTime() < Date.now() && (item.task_status || "assigned") !== "completed")
        
        // GATE: If delay justification exists but Reviewer hasn't approved it yet, block actionable approval
        if (isDelayed && item.delay_justification_member_submitted && !item.delay_justification_reviewer_approved) {
            toast.error("Please approve the delay justification before approving this actionable.")
            return
        }

        const delayJustFullyApproved = item.delay_justification_lead_approved

        // Determine next status: gate delayed tasks until lead approves justification
        const nextStatus = (isDelayed && !delayJustFullyApproved) ? "awaiting_justification" : "review"
        const statusLabel = nextStatus === "awaiting_justification"
            ? "Approved — awaiting Team Head justification approval before Compliance review"
            : "Approved by Checker — forwarded to Compliance Officer for final review."

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
            toast.success("Task approved — blocked until delay justification is fully approved")
        } else {
            toast.success("Task approved — sent to Compliance Officer for review")
            notifyForwardedToCO(item.action || "Actionable", item.workstream || "Technology", userName, docId, item.actionable_id || item.id)
        }
    }, [userName, handleUpdate])

    // Team Reviewer approve bypass: sends flagged item to CO for final decision
    const handleBypassApprove = React.useCallback(async (docId: string, item: ActionableItem) => {
        const bypassComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_reviewer",
            text: "Wrongly tagged flag approved by Team Reviewer — forwarded to Compliance Officer for final decision.",
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        await handleUpdate(docId, item.id, {
            task_status: "bypass_approved",
            bypass_approved_by: userName,
            bypass_approved_at: new Date().toISOString(),
            team_reviewer_approved_at: new Date().toISOString(),
            team_reviewer_name: userName,
            comments: [...existing, bypassComment],
        })
        toast.success("Wrongly tagged flag approved — sent to Compliance Officer")
        notifyBypassApprovedByChecker(item.action || "Actionable", userName, docId, item.actionable_id || item.id)
    }, [userName, handleUpdate])

    // Team Reviewer reject bypass: returns flagged item back to member
    const handleBypassReject = React.useCallback(async (docId: string, item: ActionableItem, reason: string) => {
        const rejectComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_reviewer",
            text: `Wrongly tagged flag rejected by Checker: ${reason}`,
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        await handleUpdate(docId, item.id, {
            task_status: "in_progress",
            bypass_tag: false,
            bypass_tagged_at: "",
            bypass_tagged_by: "",
            bypass_reviewer_rejected_by: userName,
            bypass_reviewer_rejected_at: new Date().toISOString(),
            bypass_reviewer_rejection_reason: reason,
            comments: [...existing, rejectComment],
        })
        toast.success("Wrongly tagged flag rejected — returned to Team Member")
    }, [userName, handleUpdate])

    // Team Reviewer reject: team_review → in_progress (sends back to team member)
    const handleReject = React.useCallback(async (docId: string, item: ActionableItem, reason: string) => {
        const rejectComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_reviewer",
            text: `Rejected by Checker: ${reason}`,
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
        notifyCheckerRejectedToMaker(item.action || "Actionable", item.workstream || "Technology", reason, docId, item.actionable_id || item.id)
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

    // Filter by tab
    const tabRows = React.useMemo(() => {
        if (tab === "pending") {
            return viewRows.filter(r =>
                r.item.task_status === "team_review" ||
                r.item.task_status === "tagged_incorrectly"
            )
        }
        return viewRows
    }, [viewRows, tab])

    // Unique doc names for filter dropdown
    const docOptions = React.useMemo(() => {
        const map = new Map<string, string>()
        for (const r of viewRows) {
            if (!map.has(r.docId)) map.set(r.docId, r.docName)
        }
        return Array.from(map.entries())
    }, [viewRows])

    // Filter + Sort
    const filtered = React.useMemo(() => {
        let result = tabRows.filter(({ item, docId }) => {
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (docFilter !== "all" && docId !== docFilter) return false
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
    }, [tabRows, deadlineFilter, docFilter, searchQuery, sortBy, sortDir])

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

    const gridCols = "minmax(180px,3fr) 100px 100px 70px 80px 90px 90px"

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
                        {activeRows.length > 0 ? (
                            <ProgressBar completed={activeRows.filter(r => r.item.task_status === "completed").length} total={activeRows.length} />
                        ) : (
                            <ProgressBar completed={completedRows.length} total={completedRows.length} />
                        )}
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

                    {(deadlineFilter !== "all" || docFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => {
                                setDeadlineFilter("all")
                                setDocFilter("all")
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
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Actions</div>
                                    </div>

                                    {/* Rows */}
                                    {activeRows.map(({ item, docId, docName }) => (
                                        <ReviewRow
                                            key={`${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            docName={docName}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            onApprove={handleApprove}
                                            onReject={handleReject}
                                            onBypassApprove={handleBypassApprove}
                                            onBypassReject={handleBypassReject}
                                            onAddComment={handleAddComment}
                                            onUpload={handleUpload}
                                            onUpdate={handleUpdate}
                                            gridCols={gridCols}
                                        />
                                    ))}
                                </>
                            )}
                        </>
                    )}

                    {/* ── Completed section — matches Active with same content, read-only ── */}
                    {!loading && completedRows.length > 0 && (
                        <div className="mt-4">
                            <SectionDivider label="Completed" count={completedRows.length} icon={<CheckCircle2 className="h-3.5 w-3.5" />} borderClass="border-y border-border/20" textClass="text-muted-foreground" collapsed={completedCollapsed} onToggle={() => setCompletedCollapsed(!completedCollapsed)} />

                            {!completedCollapsed && (
                                <>
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Actions</div>
                                    </div>
                                    {completedRows.map(({ item, docId, docName }) => (
                                        <ReviewRow
                                            key={`completed-${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            docName={docName}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            onApprove={handleApprove}
                                            onReject={handleReject}
                                            onBypassApprove={handleBypassApprove}
                                            onBypassReject={handleBypassReject}
                                            onAddComment={handleAddComment}
                                            onUpload={handleUpload}
                                            onUpdate={handleUpdate}
                                            gridCols={gridCols}
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
    docName,
    expandedRow,
    setExpandedRow,
    userName,
    onApprove,
    onReject,
    onBypassApprove,
    onBypassReject,
    onAddComment,
    onUpload,
    onUpdate,
    gridCols,
}: {
    item: ActionableItem
    docId: string
    docName: string
    expandedRow: string | null
    setExpandedRow: (v: string | null) => void
    userName: string
    onApprove: (docId: string, item: ActionableItem) => Promise<void>
    onReject: (docId: string, item: ActionableItem, reason: string) => Promise<void>
    onBypassApprove: (docId: string, item: ActionableItem) => Promise<void>
    onBypassReject: (docId: string, item: ActionableItem, reason: string) => Promise<void>
    onAddComment: (docId: string, item: ActionableItem, text: string) => Promise<void>
    onUpload: (docId: string, itemId: string, file: File) => void
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>, teamOverride?: string) => Promise<void>
    gridCols: string
}) {
    const rowKey = `${docId}-${item.id}`
    const taskStatus = (item.task_status || "assigned") as TaskStatus
    const statusStyle = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
    const isExpanded = expandedRow === rowKey
    const commentCount = (item.comments || []).length
    const isTeamReviewStatus = taskStatus === "team_review"
    const isTaggedIncorrectly = taskStatus === "tagged_incorrectly"
    const isReworking = taskStatus === "reworking"
    const isReadOnly = taskStatus === "completed" || taskStatus === "review" || taskStatus === "bypass_approved"

    const [rejectReason, setRejectReason] = React.useState("")
    const [showRejectInput, setShowRejectInput] = React.useState(false)
    const [bypassRejectReason, setBypassRejectReason] = React.useState("")
    const [showBypassRejectInput, setShowBypassRejectInput] = React.useState(false)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const files = item.evidence_files || []
    const { getOptions, getLabel } = useDropdownConfig()

    const FALLBACK_RISK_OPTIONS: Record<string, DropdownOption[]> = React.useMemo(() => ({
        likelihood_business_volume: [
            { label: "Moderate Increase — Up to 15%", value: 1 },
            { label: "Substantial Increase — Between 15% and 30%", value: 2 },
            { label: "Very High Increase — More than 30%", value: 3 },
        ],
        likelihood_products_processes: [
            { label: "Products/processes rolled out during the year — Less than 4", value: 1 },
            { label: "Products/processes rolled out during the year — Between 4 and 7", value: 2 },
            { label: "Many products rolled out during the year — More than 7", value: 3 },
        ],
        likelihood_compliance_violations: [
            { label: "No violation", value: 1 },
            { label: "1 violation", value: 2 },
            { label: "Greater than 1", value: 3 },
        ],
        control_monitoring: [
            { label: "Automated", value: 1 },
            { label: "Maker-Checker", value: 2 },
            { label: "No Checker / No Control", value: 3 },
        ],
        control_effectiveness: [
            { label: "Well Controlled / Meets Requirements", value: 1 },
            { label: "Improvement Needed", value: 2 },
            { label: "Significant Improvement Needed", value: 3 },
        ],
    }), [])

    const getSafeOptions = React.useCallback((key: string): DropdownOption[] => {
        const opts = getOptions(key)
        return opts.length ? opts : (FALLBACK_RISK_OPTIONS[key] || [])
    }, [getOptions, FALLBACK_RISK_OPTIONS])

    const pickSubDropdown = React.useCallback((configKey: string, selectedLabel: string): RiskSubDropdown => {
        const opt = getSafeOptions(configKey).find(o => o.label === selectedLabel)
        return opt ? { label: opt.label, score: opt.value } : ({} as RiskSubDropdown)
    }, [getSafeOptions])

    // Draft state for risk overrides + reviewer comment (Save button pattern)
    const emptyRSD = {} as RiskSubDropdown
    const [draftLikeBV, setDraftLikeBV] = React.useState<RiskSubDropdown>(item.likelihood_business_volume || emptyRSD)
    const [draftLikePP, setDraftLikePP] = React.useState<RiskSubDropdown>(item.likelihood_products_processes || emptyRSD)
    const [draftLikeCV, setDraftLikeCV] = React.useState<RiskSubDropdown>(item.likelihood_compliance_violations || emptyRSD)
    const [draftCtrlMon, setDraftCtrlMon] = React.useState<RiskSubDropdown>(item.control_monitoring || emptyRSD)
    const [draftCtrlEff, setDraftCtrlEff] = React.useState<RiskSubDropdown>(item.control_effectiveness || emptyRSD)
    const [draftReviewerComment, setDraftReviewerComment] = React.useState(item.reviewer_comment || "")
    const [saving, setSaving] = React.useState(false)
    // Delay justification state (shared field)
    const [draftDelayJustification, setDraftDelayJustification] = React.useState(item.delay_justification || "")
    const [showDelayJustApprove, setShowDelayJustApprove] = React.useState(false)

    React.useEffect(() => {
        setDraftLikeBV(item.likelihood_business_volume || emptyRSD)
        setDraftLikePP(item.likelihood_products_processes || emptyRSD)
        setDraftLikeCV(item.likelihood_compliance_violations || emptyRSD)
        setDraftCtrlMon(item.control_monitoring || emptyRSD)
        setDraftCtrlEff(item.control_effectiveness || emptyRSD)
        setDraftReviewerComment(item.reviewer_comment || "")
        setDraftDelayJustification(item.delay_justification || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id])

    const subDiffers = (a: RiskSubDropdown | undefined, b: RiskSubDropdown | undefined) =>
        (a?.label || "") !== (b?.label || "")

    const isDirty = React.useMemo(() => {
        if (subDiffers(draftLikeBV, item.likelihood_business_volume)) return true
        if (subDiffers(draftLikePP, item.likelihood_products_processes)) return true
        if (subDiffers(draftLikeCV, item.likelihood_compliance_violations)) return true
        if (subDiffers(draftCtrlMon, item.control_monitoring)) return true
        if (subDiffers(draftCtrlEff, item.control_effectiveness)) return true
        if (draftReviewerComment !== (item.reviewer_comment || "")) return true
        return false
    }, [draftLikeBV, draftLikePP, draftLikeCV, draftCtrlMon, draftCtrlEff, draftReviewerComment, item])

    const safeRSD = (d: RiskSubDropdown | undefined) => (d && typeof d.score === "number" ? d.score : 0)
    const draftLikScore = Math.max(safeRSD(draftLikeBV), safeRSD(draftLikePP), safeRSD(draftLikeCV))
    const draftImpScore = safeRSD(item.impact_dropdown) ** 2
    const draftMonS = safeRSD(draftCtrlMon)
    const draftEffS = safeRSD(draftCtrlEff)
    const draftCtrlScore = (draftMonS || draftEffS) ? (draftMonS + draftEffS) / 2 : 0
    const draftInherent = draftLikScore * draftImpScore
    const draftAllFilled = !!(draftLikeBV?.label && draftLikePP?.label && draftLikeCV?.label && item.impact_dropdown?.label && draftCtrlMon?.label && draftCtrlEff?.label)
    const draftResidual = draftAllFilled ? draftInherent * draftCtrlScore : 0
    const classifyRisk = (s: number) => s <= 0 ? "" : s <= 3 ? "Low" : s <= 9 ? "Medium" : "High"
    const classifyInherentRisk = (s: number) => s <= 0 ? "" : s <= 3 ? "Low" : s <= 6 ? "Medium" : "High"

    const handleSaveChanges = React.useCallback(async () => {
        setSaving(true)
        try {
            const updates: Record<string, unknown> = {}
            if (subDiffers(draftLikeBV, item.likelihood_business_volume)) updates.likelihood_business_volume = draftLikeBV
            if (subDiffers(draftLikePP, item.likelihood_products_processes)) updates.likelihood_products_processes = draftLikePP
            if (subDiffers(draftLikeCV, item.likelihood_compliance_violations)) updates.likelihood_compliance_violations = draftLikeCV
            if (subDiffers(draftCtrlMon, item.control_monitoring)) updates.control_monitoring = draftCtrlMon
            if (subDiffers(draftCtrlEff, item.control_effectiveness)) updates.control_effectiveness = draftCtrlEff
            if (draftReviewerComment !== (item.reviewer_comment || "")) updates.reviewer_comment = draftReviewerComment
            const interp = !draftAllFilled ? "" : draftResidual < 13 ? "Satisfactory (Low)" : draftResidual < 28 ? "Improvement Needed (Medium)" : "Weak (High)"
            updates.likelihood_score = draftLikScore
            updates.control_score = draftCtrlScore
            updates.overall_likelihood_score = Math.round(draftLikScore)
            updates.overall_impact_score = Math.round(draftImpScore)
            updates.overall_control_score = draftCtrlScore
            updates.inherent_risk_score = draftInherent
            updates.inherent_risk_label = classifyInherentRisk(draftInherent)
            updates.residual_risk_score = draftResidual
            updates.residual_risk_label = draftAllFilled ? classifyRisk(draftResidual) : ""
            updates.residual_risk_interpretation = interp
            await onUpdate(docId, item.id, updates)
            toast.success("Changes saved")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save")
        } finally {
            setSaving(false)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftLikeBV, draftLikePP, draftLikeCV, draftCtrlMon, draftCtrlEff, draftReviewerComment, draftLikScore, draftCtrlScore, draftImpScore, draftInherent, draftAllFilled, draftResidual, item, docId, onUpdate])

    // Approve delay justification (Reviewer approves + optionally saves edited text)
    const handleApproveDelayJustification = React.useCallback(async () => {
        const updates: Record<string, unknown> = {
            delay_justification_reviewer_approved: true,
            delay_justification_updated_by: userName,
            delay_justification_updated_at: new Date().toISOString(),
        }
        // If checker edited the text, save that too
        if (draftDelayJustification.trim() && draftDelayJustification.trim() !== (item.delay_justification || "").trim()) {
            updates.delay_justification = draftDelayJustification.trim()
        }
        await onUpdate(docId, item.id, updates)
        toast.success("Delay justification approved — forwarded to Team Head")
        notifyDelayJustificationReviewerApproved(item.action || "Actionable", item.workstream || "Technology", docId, item.actionable_id || item.id)
    }, [onUpdate, docId, item.id, userName, draftDelayJustification, item.delay_justification])

    // Reject delay justification — resets chain, sends back to Member for rework
    const handleRejectDelayJustification = React.useCallback(async () => {
        await onUpdate(docId, item.id, {
            delay_justification: "",
            delay_justification_member_submitted: false,
            delay_justification_reviewer_approved: false,
            delay_justification_lead_approved: false,
            delay_justification_updated_by: userName,
            delay_justification_updated_at: new Date().toISOString(),
            task_status: "reworking",
            rejection_reason: "Delay justification denied by Checker — please revise and resubmit.",
        })
        setShowDelayJustApprove(false)
        setDraftDelayJustification("")
        toast.success("Delay justification denied — sent back to Maker for revision")
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

    return (
        <div className={cn("border-b border-border/10", taskStatus === "completed" && "opacity-70")}>
            <div
                className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                style={{ gridTemplateColumns: gridCols }}
                onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
            >
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
                    {/* Regular task review actions */}
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
                    {/* Wrongly-tagged bypass actions */}
                    {isTaggedIncorrectly && (
                        <>
                            <button
                                onClick={() => onBypassApprove(docId, item)}
                                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-500 hover:bg-orange-500/25 transition-colors font-medium"
                                title="Approve wrongly-tagged flag — forward to CO"
                            >
                                <Flag className="h-2.5 w-2.5" /> Approve Flag
                            </button>
                            <button
                                onClick={() => setShowBypassRejectInput(true)}
                                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium"
                                title="Reject wrongly-tagged flag — return to member"
                            >
                                <XCircle className="h-2.5 w-2.5" /> Reject Flag
                            </button>
                        </>
                    )}
                    {taskStatus === "bypass_approved" && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium">
                            <Flag className="h-2.5 w-2.5" /> With CO
                        </span>
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
                    {(taskStatus === "assigned" || taskStatus === "in_progress" || taskStatus === "reviewer_rejected") && (
                        <span className="text-[10px] text-muted-foreground/30">—</span>
                    )}
                </div>
            </div>

            {/* Regular reject reason input */}
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

            {/* Bypass reject reason input */}
            {showBypassRejectInput && (
                <div className="bg-amber-500/5 border-t border-amber-500/20 px-6 py-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <Flag className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <input
                        value={bypassRejectReason}
                        onChange={e => setBypassRejectReason(e.target.value)}
                        placeholder="Reason for rejecting the wrongly-tagged flag..."
                        className="flex-1 bg-background text-xs rounded-md px-3 py-1.5 border border-amber-500/30 focus:border-amber-500 focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === "Enter" && bypassRejectReason.trim()) {
                                onBypassReject(docId, item, bypassRejectReason.trim())
                                setShowBypassRejectInput(false)
                                setBypassRejectReason("")
                            }
                            if (e.key === "Escape") {
                                setShowBypassRejectInput(false)
                                setBypassRejectReason("")
                            }
                        }}
                    />
                    <button
                        onClick={() => {
                            if (bypassRejectReason.trim()) {
                                onBypassReject(docId, item, bypassRejectReason.trim())
                                setShowBypassRejectInput(false)
                                setBypassRejectReason("")
                            }
                        }}
                        disabled={!bypassRejectReason.trim()}
                        className="text-xs px-2.5 py-1.5 rounded bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Confirm Reject Flag
                    </button>
                    <button
                        onClick={() => { setShowBypassRejectInput(false); setBypassRejectReason("") }}
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
                    {(item.bypass_tag || isTaggedIncorrectly || taskStatus === "bypass_approved") && (
                        <div className="flex items-start gap-2.5 bg-orange-500/5 border border-orange-500/20 rounded-lg px-4 py-3">
                            <Flag className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Wrongly Tagged Flag</p>
                                <p className="text-xs text-foreground/80">
                                    {taskStatus === "bypass_approved"
                                        ? "You approved this flag — it is now with the Compliance Officer for final decision."
                                        : "A team member has flagged this task as incorrectly assigned to their team."}
                                </p>
                                {item.bypass_tagged_by && (
                                    <p className="text-xs text-muted-foreground/50 mt-1">Flagged by {item.bypass_tagged_by}{item.bypass_tagged_at ? ` on ${formatDate(item.bypass_tagged_at)}` : ""}</p>
                                )}
                                {item.bypass_approved_by && (
                                    <p className="text-xs text-muted-foreground/50">Approved by: {item.bypass_approved_by}{item.bypass_approved_at ? ` on ${formatDate(item.bypass_approved_at)}` : ""}</p>
                                )}
                                {isTaggedIncorrectly && (
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            onClick={() => onBypassApprove(docId, item)}
                                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors font-medium"
                                        >
                                            <CheckCircle2 className="h-3 w-3" /> Approve Flag — Forward to CO
                                        </button>
                                        <button
                                            onClick={() => setShowBypassRejectInput(true)}
                                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                                        >
                                            <XCircle className="h-3 w-3" /> Reject Flag — Return to Member
                                        </button>
                                    </div>
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

                    {/* Risk Assessment — Theme/Tranche/Impact read-only, Likelihood+Control overridable by reviewer */}
                    <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground/70">Risk Assessment</p>
                            <span className="text-[10px] text-muted-foreground/40 italic">Reviewer can override Likelihood &amp; Control · Theme, Tranche, Impact set by Compliance</span>
                        </div>

                        {/* Row 1: Theme + Tranche3 + Impact (read-only from CO) */}
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

                        {/* New Product — read-only (set by CAG) */}
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">New Product</p>
                                <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.new_product === "Yes" ? <span className="text-cyan-400 font-medium">Yes</span> : (item.new_product || <span className="text-muted-foreground/40 italic">—</span>)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Product Live Date</p>
                                <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.new_product === "Yes" && item.product_live_date ? <span className="text-cyan-400 font-mono">{item.product_live_date}</span> : <span className="text-muted-foreground/40 italic">—</span>}</p>
                            </div>
                        </div>

                        {/* Row 2: Likelihood (3 dropdowns) — reviewer override via draft */}
                        <div className="rounded-md border border-border/20 p-2 bg-muted/10">
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wider">Likelihood Assessment</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_business_volume") || "Business Volumes"}</p>
                                    {(isTeamReviewStatus || isTaggedIncorrectly) ? (
                                        <select value={draftLikeBV?.label || ""} onChange={e => setDraftLikeBV(pickSubDropdown("likelihood_business_volume", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("likelihood_business_volume").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.likelihood_business_volume?.label || "—"}</p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_products_processes") || "Products & Processes"}</p>
                                    {(isTeamReviewStatus || isTaggedIncorrectly) ? (
                                        <select value={draftLikePP?.label || ""} onChange={e => setDraftLikePP(pickSubDropdown("likelihood_products_processes", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("likelihood_products_processes").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.likelihood_products_processes?.label || "—"}</p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_compliance_violations") || "Compliance Violations"}</p>
                                    {(isTeamReviewStatus || isTaggedIncorrectly) ? (
                                        <select value={draftLikeCV?.label || ""} onChange={e => setDraftLikeCV(pickSubDropdown("likelihood_compliance_violations", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("likelihood_compliance_violations").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.likelihood_compliance_violations?.label || "—"}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Row 3: Control (2 dropdowns) — reviewer override via draft */}
                        <div className="rounded-md border border-border/20 p-2 bg-muted/10">
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[10px] font-semibold text-teal-400/80 uppercase tracking-wider">Control Assessment</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("control_monitoring") || "Monitoring Mechanism"}</p>
                                    {(isTeamReviewStatus || isTaggedIncorrectly) ? (
                                        <select value={draftCtrlMon?.label || ""} onChange={e => setDraftCtrlMon(pickSubDropdown("control_monitoring", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-teal-400/30 focus:border-teal-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("control_monitoring").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.control_monitoring?.label || "—"}</p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("control_effectiveness") || "Control Effectiveness"}</p>
                                    {(isTeamReviewStatus || isTaggedIncorrectly) ? (
                                        <select value={draftCtrlEff?.label || ""} onChange={e => setDraftCtrlEff(pickSubDropdown("control_effectiveness", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-teal-400/30 focus:border-teal-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("control_effectiveness").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.control_effectiveness?.label || "—"}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Save Changes button */}
                        {(isTeamReviewStatus || isTaggedIncorrectly || isReworking) && isDirty && (
                            <div className="flex justify-end pt-1">
                                <button
                                    onClick={handleSaveChanges}
                                    disabled={saving || !draftReviewerComment.trim()}
                                    title={!draftReviewerComment.trim() ? "Checker comment is required" : ""}
                                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary/15 text-primary hover:bg-primary/25 font-semibold transition-colors disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                    {saving ? "Saving…" : "Save Changes"}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Delay Justification — Checker can edit text (optional) and must approve */}
                    {(item.is_delayed || (item.deadline && new Date(item.deadline).getTime() < Date.now() && taskStatus !== "completed")) && item.delay_justification_member_submitted && !item.delay_justification_reviewer_approved && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Delay Justification — Checker Approval Required</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Reason for Delay (editable)</p>
                                <textarea
                                    value={draftDelayJustification}
                                    onChange={e => setDraftDelayJustification(e.target.value)}
                                    rows={3}
                                    className="w-full bg-muted/20 text-xs rounded px-2 py-1.5 border border-amber-400/30 focus:border-amber-400 focus:outline-none text-foreground resize-none"
                                    placeholder="You may edit the justification text if needed…"
                                />
                                {item.delay_justification_updated_at && <p className="text-[10px] text-muted-foreground/40 mt-0.5">Last updated: {formatDate(item.delay_justification_updated_at)} {item.delay_justification_updated_by && `by ${item.delay_justification_updated_by}`}</p>}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleApproveDelayJustification} className="text-xs px-2.5 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 font-semibold">Approve Justification</button>
                                <button onClick={handleRejectDelayJustification} className="text-xs px-2.5 py-1.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 font-semibold">Deny &amp; Return to Maker</button>
                            </div>
                        </div>
                    )}
                    {/* Show approved delay justification status when reviewer already approved */}
                    {(item.is_delayed || (item.deadline && new Date(item.deadline).getTime() < Date.now() && taskStatus !== "completed")) && item.delay_justification_reviewer_approved && (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                <p className="text-xs font-semibold text-emerald-400">Delay Justification — Reviewer Approved</p>
                            </div>
                            <div className="bg-muted/20 rounded p-2 text-xs">
                                <span className="font-semibold text-foreground/60">Reason: </span>
                                <span className="text-foreground/80">{item.delay_justification}</span>
                            </div>
                            <div className="flex gap-3">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">Checker: Approved</span>
                                <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", item.delay_justification_lead_approved ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/20 text-muted-foreground/50")}>
                                    Team Head: {item.delay_justification_lead_approved ? "Approved" : "Pending"}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Member comment display — show in all statuses when available */}
                    {item.member_comment && (
                        <div className="rounded-lg border border-border/30 bg-muted/5 p-3">
                            <p className="text-xs font-semibold text-foreground/60 mb-1">{isReworking ? "Maker's Rework Comment" : "Maker's Comment"}</p>
                            <p className="text-xs text-foreground/80">{item.member_comment}</p>
                        </div>
                    )}

                    {/* 2-column: left=impl+files, right=mandatory reviewer comment + chat */}
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
                            {/* Member comment display — read-only for reviewer reference */}
                            {item.member_comment && (
                                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                    <p className="text-xs font-semibold text-foreground/70 mb-1">Maker Comment</p>
                                    <p className="text-xs text-foreground/80">{item.member_comment}</p>
                                </div>
                            )}
                            {/* Mandatory reviewer comment — required in team_review and reworking statuses */}
                            {(isTeamReviewStatus || isReworking) && (
                                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <p className="text-xs font-semibold text-foreground/70">Checker Comment</p>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-semibold">Required {isReworking ? "for rework review" : "before approval"}</span>
                                    </div>
                                    <textarea
                                        value={draftReviewerComment}
                                        onChange={e => setDraftReviewerComment(e.target.value)}
                                        rows={4}
                                        placeholder={isReworking ? "Review the reworked implementation and provide your feedback (required)…" : "Provide your review comments, observations, and any issues found. This is mandatory before you can approve or reject."}
                                        className="w-full bg-muted/20 text-xs rounded px-2 py-1.5 border border-border/30 focus:border-primary focus:outline-none text-foreground resize-none"
                                    />
                                    {item.reviewer_comment && (
                                        <p className="text-[10px] text-muted-foreground/40 mt-1">Previously saved: <span className="text-foreground/60">{item.reviewer_comment}</span></p>
                                    )}
                                </div>
                            )}
                            {!isTeamReviewStatus && !isReworking && item.reviewer_comment && (
                                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                    <p className="text-xs font-semibold text-foreground/70 mb-1">Checker Comment</p>
                                    <p className="text-xs text-foreground/80">{item.reviewer_comment}</p>
                                </div>
                            )}
                            {/* Lead Comment - show for completed items */}
                            {taskStatus === "completed" && item.lead_comment && (
                                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                    <p className="text-xs font-semibold text-foreground/70 mb-1">Team Head Comment</p>
                                    <p className="text-xs text-foreground/80">{item.lead_comment}</p>
                                </div>
                            )}
                            {/* CAG Comment - show for completed items */}
                            {taskStatus === "completed" && item.co_comment && (
                                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                    <p className="text-xs font-semibold text-primary/70 mb-1">CAG Comment</p>
                                    <p className="text-xs text-foreground/80">{item.co_comment}</p>
                                </div>
                            )}
                            {/* Chat thread — accessible always; read-only when completed */}
                            <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                <p className="text-xs font-semibold text-foreground/50 mb-2">
                                    Discussion Thread
                                    {taskStatus === "completed" && <span className="text-[10px] text-muted-foreground/40 ml-1.5 font-normal">(read-only)</span>}
                                </p>
                                <CommentThread
                                    comments={item.comments || []}
                                    currentUser={userName}
                                    currentRole="team_reviewer"
                                    onAddComment={taskStatus === "completed" ? undefined : async (text) => onAddComment(docId, item, text)}
                                    readOnly={taskStatus === "completed"}
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

export default function TeamReviewPage() {
    return (
        <AuthGuard>
            <TeamReviewContent />
        </AuthGuard>
    )
}
