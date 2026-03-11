"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import {
    ActionableItem,
    TaskStatus,
    isMultiTeam,
    getClassification,
    MIXED_TEAM_CLASSIFICATION,
} from "@/lib/types"
import { CommentThread } from "@/components/shared/comment-thread"
import { useSession } from "@/lib/auth-client"
import { AuthGuard, getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { useRouter } from "next/navigation"
import {
    LayoutDashboard, ChevronDown, ChevronRight,
    Loader2, Search, AlertTriangle,
    Paperclip, Calendar,
    CheckCircle2,
    MessageSquare, SortAsc, SortDesc,
    Flag,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    safeStr, formatDateShort as formatDate, formatTime, deadlineCategory,
    WORKSTREAM_COLORS, DEFAULT_WORKSTREAM_COLORS,
    TASK_STATUS_STYLES, ALL_TASK_STATUSES, STATUS_SORT_ORDER, getWorkstreamClass,
} from "@/lib/status-config"
import { useTeams } from "@/lib/use-teams"
import { useActionables } from "@/lib/use-actionables"
import { getVisibleTeamsForRole, isActionableVisible } from "@/lib/visibility"
import { ProgressBar, EvidencePopover, EvidenceFileList, SectionDivider, StatCell, StatDivider, EmptyState } from "@/components/shared/status-components"

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlatRow {
    item: ActionableItem
    docId: string
    docName: string
}

// ─── Main Chief Department Page ─────────────────────────────────────────────

function ChiefContent() {
    const router = useRouter()
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userTeam = getUserTeam(session)
    const userName = session?.user?.name || "Chief"
    const { teams, getDescendants } = useTeams()

    // Redirect non-chiefs away
    const isChief = role === "chief"
    React.useEffect(() => {
        if (role === "compliance_officer" || role === "admin") {
            router.replace("/dashboard")
        } else if (role === "team_member") {
            router.replace("/team-board")
        } else if (role === "team_reviewer") {
            router.replace("/team-review")
        } else if (role === "team_lead") {
            router.replace("/team-lead")
        }
    }, [role, router])

    const { allDocs, loading, load: loadAll } = useActionables({
        commentRole: "chief",
        commentAuthor: userName,
        autoLoad: false,
    })

    const [searchQuery, setSearchQuery] = React.useState("")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [docFilter, setDocFilter] = React.useState<string>("all")
    const [teamFilter, setTeamFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("status")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
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

    React.useEffect(() => { if (isChief) loadAll() }, [loadAll, isChief])

    // Determine visible teams based on chief's role and assigned team
    const visibleTeams = React.useMemo(
        () => getVisibleTeamsForRole(role as any, userTeam, teams, getDescendants),
        [role, userTeam, teams, getDescendants]
    )

    // Build flat rows — only published actionables within visible teams
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
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (docFilter !== "all" && docId !== docFilter) return false
            if (teamFilter !== "all" && getClassification(item) !== teamFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const classification = getClassification(item)
                const s = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.workstream)} ${classification} ${safeStr(item.actionable_id)}`.toLowerCase()
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
    }, [allRows, statusFilter, deadlineFilter, docFilter, teamFilter, searchQuery, sortBy, sortDir])

    // Split active / completed
    const activeRows = React.useMemo(() => filtered.filter(r => r.item.task_status !== "completed"), [filtered])
    const completedRows = React.useMemo(() => {
        const items = filtered.filter(r => r.item.task_status === "completed")
        return items.sort((a, b) => {
            const da = a.item.completion_date ? new Date(a.item.completion_date).getTime() : 0
            const db = b.item.completion_date ? new Date(b.item.completion_date).getTime() : 0
            return db - da
        })
    }, [filtered])

    // Stats
    const stats = React.useMemo(() => {
        const s = {
            total: allRows.length, completed: 0, inProgress: 0, teamReview: 0, review: 0,
            reworking: 0, assigned: 0,
            yetToDeadline: 0, delayed30: 0, delayed60: 0, delayed90: 0, bypassed: 0,
        }
        for (const e of allRows) {
            const st = e.item.task_status || "assigned"
            if (st === "completed") s.completed++
            else if (st === "in_progress") s.inProgress++
            else if (st === "team_review") s.teamReview++
            else if (st === "review") s.review++
            else if (st === "reworking") s.reworking++
            else s.assigned++
            const dc = deadlineCategory(e.item.deadline)
            if (dc === "yet") s.yetToDeadline++
            else if (dc === "d30") s.delayed30++
            else if (dc === "d60") s.delayed60++
            else if (dc === "d90") s.delayed90++
            if (e.item.bypass_tag) s.bypassed++
        }
        return s
    }, [allRows])

    // Grid columns: Team | Actionable | Status | Deadline | Time | Evidence | Published
    const gridCols = "minmax(80px,0.7fr) minmax(180px,3fr) 100px 100px 70px 80px 90px"

    if (!isChief) {
        return (
            <div className="flex h-screen bg-background items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Redirecting...
            </div>
        )
    }

    const renderHeader = () => (
        <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
        </div>
    )

    const renderRow = ({ item, docId, docName }: FlatRow) => {
        const rowKey = `${docId}-${item.id}`
        const taskStatus = (item.task_status || "assigned") as TaskStatus
        const statusCfg = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
        const isOverdue = item.deadline ? new Date(item.deadline).getTime() < Date.now() : false
        const isExpanded = expandedRows.has(rowKey)
        const multi = isMultiTeam(item)
        const classification = getClassification(item)
        const teamColors = WORKSTREAM_COLORS[classification] || DEFAULT_WORKSTREAM_COLORS
        const commentCount = (item.comments || []).length
        const files = item.evidence_files || []

        return (
            <div key={rowKey} className={cn("border-b border-border/10", taskStatus === "completed" && "opacity-60")}>
                {/* Main row */}
                <div
                    className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                    style={{ gridTemplateColumns: gridCols }}
                    onClick={() => toggleRow(rowKey)}
                >
                    {/* Team */}
                    <div className="py-1.5 px-1">
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", teamColors.bg, teamColors.text || "text-muted-foreground")}>
                            {classification}
                        </span>
                    </div>

                    {/* Actionable text */}
                    <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                        {isExpanded
                            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                        <span className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</span>
                        {multi && (
                            <span className={cn("shrink-0 px-1.5 py-0.5 rounded text-xs font-medium", getWorkstreamClass(MIXED_TEAM_CLASSIFICATION))} title={`Teams: ${item.assigned_teams!.join(", ")}`}>
                                {MIXED_TEAM_CLASSIFICATION}
                            </span>
                        )}
                        {item.bypass_tag && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-500">
                                <Flag className="h-2 w-2" /> Bypass
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
                        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", statusCfg.bg, statusCfg.text)}>
                            {statusCfg.label}
                        </span>
                    </div>

                    {/* Deadline date */}
                    <div className="py-1.5 px-1 text-center">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded border border-dashed flex items-center justify-center gap-1",
                            isOverdue ? "text-red-400 border-red-400/30" : "text-muted-foreground/70 border-muted-foreground/20"
                        )}>
                            <Calendar className="h-2.5 w-2.5" />
                            {formatDate(item.deadline)}
                        </span>
                    </div>

                    {/* Deadline time */}
                    <div className="py-1.5 px-1 text-center">
                        <span className="text-[10px] text-muted-foreground/60">
                            {formatTime(item.deadline)}
                        </span>
                    </div>

                    {/* Evidence */}
                    <div className="py-1.5 px-1 flex justify-center" onClick={e => e.stopPropagation()}>
                        <EvidencePopover files={files} taskStatus={taskStatus} />
                    </div>

                    {/* Published date */}
                    <div className="py-1.5 px-1 text-center">
                        <span className="text-[10px] text-muted-foreground/60">
                            {formatDate(item.published_at)}
                        </span>
                    </div>
                </div>

                {/* Expanded view — read-only details */}
                {isExpanded && (
                    <div className="border border-border/30 rounded-lg mx-3 my-2 px-6 py-4 space-y-3">
                        {/* Bypass tag banner */}
                        {item.bypass_tag && (
                            <div className="flex items-start gap-2.5 bg-orange-500/5 border border-orange-500/20 rounded-lg px-4 py-3">
                                <Flag className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Tagged as Incorrectly Assigned</p>
                                    {item.bypass_tagged_by && (
                                        <p className="text-xs text-muted-foreground/50 mt-1">Flagged by {item.bypass_tagged_by}{item.bypass_tagged_at ? ` on ${formatDate(item.bypass_tagged_at)}` : ""}</p>
                                    )}
                                    {item.bypass_approved_by && (
                                        <p className="text-xs text-muted-foreground/50">Bypass approved by {item.bypass_approved_by}{item.bypass_approved_at ? ` on ${formatDate(item.bypass_approved_at)}` : ""}</p>
                                    )}
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

                        {/* Delay Justification — read-only */}
                        {(isOverdue || item.is_delayed) && item.delay_justification_member_submitted && (
                            <div className={cn("rounded-lg border p-3 space-y-1.5",
                                item.delay_justification_lead_approved
                                    ? "border-emerald-500/20 bg-emerald-500/5"
                                    : "border-amber-500/30 bg-amber-500/5"
                            )}>
                                <div className="flex items-center gap-2">
                                    {item.delay_justification_lead_approved
                                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                        : <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                                    <p className={cn("text-xs font-semibold", item.delay_justification_lead_approved ? "text-emerald-400" : "text-amber-400")}>
                                        Delay Justification {item.delay_justification_lead_approved ? "— Fully Approved" : "— Pending Approval"}
                                    </p>
                                </div>
                                <div className="bg-muted/20 rounded p-2 text-xs">
                                    <span className="font-semibold text-foreground/60">Reason: </span>
                                    <span className="text-foreground/80">{item.delay_justification}</span>
                                    {item.delay_justification_updated_at && <span className="text-muted-foreground/40 ml-1">· {formatDate(item.delay_justification_updated_at)}</span>}
                                </div>
                                <div className="flex gap-3">
                                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", item.delay_justification_member_submitted ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/20 text-muted-foreground/50")}>
                                        Member: {item.delay_justification_member_submitted ? "Submitted" : "Pending"}
                                    </span>
                                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", item.delay_justification_reviewer_approved ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/20 text-muted-foreground/50")}>
                                        Reviewer: {item.delay_justification_reviewer_approved ? "Approved" : "Pending"}
                                    </span>
                                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", item.delay_justification_lead_approved ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/20 text-muted-foreground/50")}>
                                        Lead: {item.delay_justification_lead_approved ? "Approved" : "Pending"}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* 2-column: left=impl+evidence, right=comments */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-3">
                                <div>
                                    <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Implementation</p>
                                    <p className="text-xs text-foreground/80 whitespace-pre-wrap">{safeStr(item.implementation_notes) || <span className="italic text-muted-foreground/30">No implementation notes</span>}</p>
                                </div>
                                {/* Evidence Files */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <Paperclip className="h-3.5 w-3.5 text-primary/60" />
                                            <span className="text-xs font-semibold text-foreground/80">Evidence Files</span>
                                            {files.length > 0 && (
                                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{files.length}</span>
                                            )}
                                        </div>
                                    </div>
                                    {files.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-4 bg-background rounded-lg border border-dashed border-border/40">
                                            <Paperclip className="h-5 w-5 text-muted-foreground/20 mb-1" />
                                            <p className="text-xs text-muted-foreground/40">No evidence files uploaded yet</p>
                                        </div>
                                    ) : (
                                        <EvidenceFileList
                                            files={files}
                                            formatDate={formatDate}
                                            readOnly
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                                <CommentThread
                                    comments={item.comments || []}
                                    currentUser={userName}
                                    currentRole="chief"
                                />
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

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
                        <LayoutDashboard className="h-4 w-4 text-purple-500" />
                        Department Overview
                    </h1>
                    <span className="text-xs text-muted-foreground/50">Read-only department-wide view</span>
                </div>

                {/* ── Stats row ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-3 flex items-center gap-4 overflow-x-auto">
                    <div className="flex items-center gap-4">
                        <StatCell value={stats.total} label="Total" colorClass="text-foreground" />
                        <StatDivider />
                        <StatCell value={stats.completed} label="Completed" colorClass="text-emerald-400" />
                        <StatCell value={stats.inProgress} label="In Progress" colorClass="text-amber-400" />
                        <StatCell value={stats.teamReview} label="Team Review" colorClass="text-teal-400" />
                        <StatCell value={stats.review} label="CO Review" colorClass="text-blue-400" />
                        <StatCell value={stats.reworking} label="Reworking" colorClass="text-orange-400" />
                        <StatCell value={stats.assigned} label="Assigned" colorClass="text-slate-400" />
                        {stats.bypassed > 0 && <StatCell value={stats.bypassed} label="Bypassed" colorClass="text-orange-500" />}
                        <StatDivider />
                        <StatCell value={stats.yetToDeadline} label="Yet to DL" colorClass="text-emerald-500" />
                        <StatCell value={stats.delayed30} label="Delayed 30d" colorClass="text-amber-500" />
                        <StatCell value={stats.delayed60} label="Delayed 60d" colorClass="text-orange-500" />
                        <StatCell value={stats.delayed90} label="Delayed 90d" colorClass="text-red-500" />
                    </div>

                    <div className="flex-1" />

                    <div className="w-48">
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Completion Progress</p>
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
                            placeholder="Search department..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                        />
                    </div>

                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground">
                        <option value="all">All Status</option>
                        {ALL_TASK_STATUSES.map(s => (
                            <option key={s} value={s}>{TASK_STATUS_STYLES[s].label}</option>
                        ))}
                    </select>


                    <select value={deadlineFilter} onChange={e => setDeadlineFilter(e.target.value)} className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground">
                        <option value="all">All Deadlines</option>
                        <option value="yet">Yet to Deadline</option>
                        <option value="d30">Delayed 30d</option>
                        <option value="d60">Delayed 60d</option>
                        <option value="d90">Delayed 90d</option>
                    </select>

                    <select value={docFilter} onChange={e => setDocFilter(e.target.value)} className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground max-w-[160px]">
                        <option value="all">All Documents</option>
                        {docOptions.map(([id, name]) => (
                            <option key={id} value={id}>{name}</option>
                        ))}
                    </select>

                    <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground max-w-[160px]">
                        <option value="all">All Teams</option>
                        {teamOptions.map(t => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>

                    {(statusFilter !== "all" || deadlineFilter !== "all" || docFilter !== "all" || teamFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => {
                                setStatusFilter("all")
                                setDeadlineFilter("all")
                                setDocFilter("all")
                                setTeamFilter("all")
                                setSearchQuery("")
                            }}
                            className="px-2.5 py-1.5 text-xs rounded-md bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/40"
                        >
                            Clear Filters
                        </button>
                    )}

                    <div className="flex items-center gap-1 ml-auto">
                        <span className="text-xs text-muted-foreground/50">Sort:</span>
                        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground">
                            <option value="status">Status</option>
                            <option value="deadline">Deadline</option>
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

                {/* ── Table ── */}
                <div className="flex-1 overflow-auto">
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-xs">Loading department data...</span>
                        </div>
                    )}

                    {!loading && allRows.length === 0 && (
                        <EmptyState
                            icon={<LayoutDashboard className="h-8 w-8 text-muted-foreground" />}
                            title="No published actionables"
                            description="No published actionables exist yet across the department."
                            className="py-20"
                        />
                    )}

                    {/* ── Active section ── */}
                    {!loading && activeRows.length > 0 && (
                        <>
                            <SectionDivider label="Active" count={activeRows.length} icon={<AlertTriangle className="h-3.5 w-3.5" />} borderClass="border-b border-yellow-500/20" textClass="text-yellow-500" collapsed={activeCollapsed} onToggle={() => setActiveCollapsed(!activeCollapsed)} />
                            {!activeCollapsed && (
                                <div className="mb-1">
                                    {renderHeader()}
                                    {activeRows.map(renderRow)}
                                </div>
                            )}
                        </>
                    )}

                    {/* ── Completed section — matches Active with same content, read-only ── */}
                    {!loading && completedRows.length > 0 && (
                        <div className="mt-4">
                            <SectionDivider label="Completed" count={completedRows.length} icon={<CheckCircle2 className="h-3.5 w-3.5" />} borderClass="border-y border-border/20" textClass="text-muted-foreground" collapsed={completedCollapsed} onToggle={() => setCompletedCollapsed(!completedCollapsed)} />
                            {!completedCollapsed && (
                                <>
                                    {renderHeader()}
                                    {completedRows.map(renderRow)}
                                </>
                            )}
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
    )
}

// ─── Exported page with AuthGuard ────────────────────────────────────────────

export default function ChiefPage() {
    return (
        <AuthGuard>
            <ChiefContent />
        </AuthGuard>
    )
}
