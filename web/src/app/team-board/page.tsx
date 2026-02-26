"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { AuthGuard, getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { useSession } from "@/lib/auth-client"
import {
    fetchAllActionables,
    updateActionable,
    uploadEvidence,
} from "@/lib/api"
import { ActionableItem, ActionablesResult, TaskStatus, ActionableComment } from "@/lib/types"
import { CommentThread } from "@/components/shared/comment-thread"
import {
    ChevronDown, ChevronRight, Loader2, Search,
    FileText, Paperclip, Calendar, CheckCircle2,
    ArrowRight, RotateCcw, Trash2, Save,
    MessageSquare, ExternalLink, Download, Upload, Undo2,
    ArrowUpDown, SortAsc, SortDesc,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ───────────────────────────────────────────────────────────────

function safeStr(v: unknown): string {
    if (v === null || v === undefined) return ""
    if (typeof v === "string") return v
    if (typeof v === "number" || typeof v === "boolean") return String(v)
    try { return JSON.stringify(v) } catch { return String(v) }
}

function normalizeRisk(modality: string): string {
    const map: Record<string, string> = {
        "Mandatory": "High Risk", "Prohibited": "High Risk",
        "Recommended": "Medium Risk", "Permitted": "Low Risk",
    }
    return map[modality] || (RISK_STYLES[modality] ? modality : "Medium Risk")
}

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; bg: string; text: string }> = {
    assigned:    { label: "Assigned",    bg: "bg-slate-500",   text: "text-white" },
    in_progress: { label: "In Progress", bg: "bg-amber-500",   text: "text-white" },
    review:      { label: "Under Review", bg: "bg-blue-500",   text: "text-white" },
    completed:   { label: "Completed",   bg: "bg-emerald-500", text: "text-white" },
    reworking:   { label: "Reworking",   bg: "bg-orange-500",  text: "text-white" },
}

const STATUS_SORT_ORDER: Record<string, number> = {
    review: 0, reworking: 1, in_progress: 2, assigned: 3, completed: 4,
}

const ALL_TASK_STATUSES: TaskStatus[] = ["assigned", "in_progress", "review", "completed", "reworking"]
const RISK_OPTIONS = ["High Risk", "Medium Risk", "Low Risk"]

const RISK_STYLES: Record<string, { bg: string; text: string }> = {
    "High Risk":   { bg: "bg-red-500/15",    text: "text-red-500" },
    "Medium Risk": { bg: "bg-yellow-500/15",  text: "text-yellow-500" },
    "Low Risk":    { bg: "bg-emerald-500/15", text: "text-emerald-500" },
}

function formatDate(iso: string | undefined): string {
    if (!iso) return "—"
    try {
        return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    } catch { return iso }
}

function deadlineCategory(deadline: string | undefined): string {
    if (!deadline) return "none"
    const dl = new Date(deadline).getTime()
    const now = Date.now()
    if (dl >= now) return "yet"
    const days = (now - dl) / (1000 * 60 * 60 * 24)
    if (days <= 30) return "d30"
    if (days <= 60) return "d60"
    return "d90"
}

// ─── Risk Icon ───────────────────────────────────────────────────────────────

function RiskIcon({ modality }: { modality: string }) {
    const risk = normalizeRisk(modality)
    const cfg = RISK_STYLES[risk] || RISK_STYLES["Medium Risk"]
    return (
        <span className={cn("inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-bold shrink-0", cfg.bg, cfg.text)} title={risk}>
            !
        </span>
    )
}

// ─── Task Row (expandable with evidence + comments) ─────────────────────────

function TaskRow({ entry, gridCols, onUpdate, onUpload, onStatusTransition, onRevert, userName }: {
    entry: { item: ActionableItem; docId: string; docName: string }
    gridCols: string
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    onUpload: (docId: string, itemId: string, file: File) => void
    onStatusTransition: (docId: string, item: ActionableItem) => void
    onRevert: (docId: string, item: ActionableItem) => void
    userName: string
}) {
    const { item, docId, docName } = entry
    const [expanded, setExpanded] = React.useState(false)
    const inputRef = React.useRef<HTMLInputElement>(null)

    const taskStatus = (item.task_status || "assigned") as TaskStatus
    const statusCfg = TASK_STATUS_CONFIG[taskStatus] || TASK_STATUS_CONFIG.assigned
    const isOverdue = item.deadline ? new Date(item.deadline).getTime() < Date.now() : false
    const canAdvance = taskStatus === "assigned" || taskStatus === "in_progress" || taskStatus === "reworking"
    const isCompleted = taskStatus === "completed"
    const isUnderReview = taskStatus === "review"
    const isReadOnly = isCompleted || isUnderReview
    const files = item.evidence_files || []

    // Check if revert is allowed (within 10 minutes of submission)
    const canRevert = React.useMemo(() => {
        if (taskStatus !== "review") return false
        // Find most recent status change — approximate via last comment or use submitted_at if available
        const submittedAt = (item as any).submitted_at
        if (submittedAt) {
            const elapsed = Date.now() - new Date(submittedAt).getTime()
            return elapsed < 10 * 60 * 1000 // 10 minutes
        }
        return true // If no timestamp, allow revert
    }, [taskStatus, item])

    const handleAddComment = async (text: string) => {
        // Auto-transition from assigned to in_progress on comment
        const updates: Record<string, unknown> = {}
        if (taskStatus === "assigned") {
            updates.task_status = "in_progress"
        }
        const newComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_member",
            text,
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        updates.comments = [...existing, newComment]
        await onUpdate(docId, item.id, updates)
        if (taskStatus === "assigned") {
            toast.success("Task auto-started (In Progress)")
        }
    }

    const handleUploadClick = () => {
        inputRef.current?.click()
    }

    const handleFileSelected = async (file: File) => {
        // Auto-transition from assigned to in_progress on upload
        if (taskStatus === "assigned") {
            await onUpdate(docId, item.id, { task_status: "in_progress" })
            toast.success("Task auto-started (In Progress)")
        }
        onUpload(docId, item.id, file)
    }

    const handleDeleteFile = async (idx: number) => {
        const updated = [...files]
        updated.splice(idx, 1)
        await onUpdate(docId, item.id, { evidence_files: updated })
        toast.success("File removed")
    }

    return (
        <div className={cn("border-b border-border/10", isCompleted && "opacity-60")}>
            {/* Main row — columns: Task | Risk | Status | Deadline | Evidence | Action */}
            <div
                className="grid items-center hover:bg-muted/5 transition-colors cursor-pointer"
                style={{ gridTemplateColumns: gridCols }}
                onClick={() => setExpanded(!expanded)}
            >
                <div className="py-2 px-2 min-w-0 flex items-center gap-1.5">
                    {expanded
                        ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                        : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                    <div className="min-w-0">
                        <p className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</p>
                        {item.implementation_notes && (
                            <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5">{safeStr(item.implementation_notes)}</p>
                        )}
                    </div>
                </div>
                <div className="py-2 flex justify-center">
                    <RiskIcon modality={item.modality} />
                </div>
                <div className="py-2 px-1 text-center">
                    <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-medium", statusCfg.bg, statusCfg.text)}>
                        {statusCfg.label}
                    </span>
                </div>
                <div className="py-2 px-1 text-center">
                    <span className={cn("text-[10px] flex items-center justify-center gap-1", isOverdue ? "text-red-400" : "text-muted-foreground/60")}>
                        <Calendar className="h-2.5 w-2.5" />
                        {formatDate(item.deadline)}
                    </span>
                </div>
                <div className="py-2 px-1 text-center">
                    <span className="text-[10px] text-foreground/70 font-mono">
                        {files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""}` : <span className="text-muted-foreground/30 italic">none</span>}
                    </span>
                </div>
                <div className="py-2 px-1 text-center" onClick={e => e.stopPropagation()}>
                    {canAdvance && (
                        <button
                            onClick={() => onStatusTransition(docId, item)}
                            className="inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-medium"
                        >
                            {taskStatus === "assigned" && <><ArrowRight className="h-2.5 w-2.5" /> Start</>}
                            {taskStatus === "in_progress" && <><CheckCircle2 className="h-2.5 w-2.5" /> Submit</>}
                            {taskStatus === "reworking" && <><RotateCcw className="h-2.5 w-2.5" /> Resubmit</>}
                        </button>
                    )}
                    {isUnderReview && (
                        <div className="flex items-center justify-center gap-1">
                            <span className="text-[10px] text-blue-400 italic">Awaiting review</span>
                            {canRevert && (
                                <button
                                    onClick={() => onRevert(docId, item)}
                                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 transition-colors font-medium"
                                    title="Revert to In Progress (available for 10 min after submission)"
                                >
                                    <Undo2 className="h-2.5 w-2.5" /> Revert
                                </button>
                            )}
                        </div>
                    )}
                    {isCompleted && (
                        <span className="text-[10px] text-emerald-400 flex items-center justify-center gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Done
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded: Evidence & Comments */}
            {expanded && (
                <div className="bg-muted/5 border-t border-border/10 px-6 py-4 space-y-5">
                    {/* Evidence files section */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Paperclip className="h-3.5 w-3.5 text-primary/60" />
                                <span className="text-xs font-semibold text-foreground/80">Evidence Files</span>
                                {files.length > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{files.length}</span>
                                )}
                            </div>
                            {!isReadOnly && (
                                <button
                                    onClick={handleUploadClick}
                                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
                                >
                                    <Upload className="h-3 w-3" /> Upload File
                                </button>
                            )}
                            <input ref={inputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = "" }} />
                        </div>

                        {files.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-6 bg-background rounded-lg border border-dashed border-border/40">
                                <Paperclip className="h-6 w-6 text-muted-foreground/20 mb-2" />
                                <p className="text-xs text-muted-foreground/40">No evidence files uploaded yet</p>
                                {!isReadOnly && (
                                    <button
                                        onClick={handleUploadClick}
                                        className="text-[11px] text-primary hover:underline mt-1"
                                    >
                                        Click to upload
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {files.map((file, idx) => {
                                    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001"
                                    const fileUrl = file.url?.startsWith("/") ? `${apiBase}${file.url}` : file.url
                                    return (
                                        <div key={idx} className="flex items-center gap-3 bg-background rounded-lg px-4 py-3 border border-border/30 group/file hover:border-border/60 transition-colors">
                                            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                                                <FileText className="h-4 w-4 text-primary/70" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-foreground/90 truncate">{file.name}</p>
                                                <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                                                    Uploaded {formatDate(file.uploaded_at)}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {fileUrl && (
                                                    <>
                                                        <a
                                                            href={fileUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors"
                                                            title="Open in new tab"
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </a>
                                                        <a
                                                            href={fileUrl}
                                                            download={file.name}
                                                            className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors"
                                                            title="Download"
                                                        >
                                                            <Download className="h-3.5 w-3.5" />
                                                        </a>
                                                    </>
                                                )}
                                                {!isReadOnly && (
                                                    <button
                                                        onClick={() => handleDeleteFile(idx)}
                                                        className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-500 transition-colors"
                                                        title="Remove file"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Comment thread */}
                    {!isCompleted && (
                        <CommentThread
                            comments={item.comments || []}
                            currentUser={userName}
                            currentRole="team_member"
                            onAddComment={!isReadOnly ? handleAddComment : undefined}
                        />
                    )}
                    {isCompleted && (item.comments || []).length > 0 && (
                        <CommentThread
                            comments={item.comments || []}
                            currentUser={userName}
                            currentRole="team_member"
                        />
                    )}

                    {/* Source info */}
                    <div className="text-[10px] text-muted-foreground/30 pt-2 border-t border-border/10">
                        Source: {docName}
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Status summary bar with labels ─────────────────────────────────────────

function StatusSummaryBar({ items }: { items: { item: ActionableItem }[] }) {
    const counts: Record<string, number> = {}
    for (const { item } of items) {
        const s = item.task_status || "assigned"
        counts[s] = (counts[s] || 0) + 1
    }
    const total = items.length || 1
    const segments: { key: TaskStatus; pct: number }[] = (["in_progress", "review", "completed", "reworking", "assigned"] as TaskStatus[])
        .map(s => ({ key: s, pct: ((counts[s] || 0) / total) * 100 }))
        .filter(s => s.pct > 0)
    return (
        <div className="space-y-1">
            <div className="flex h-2 rounded-full overflow-hidden bg-muted/30">
                {segments.map(s => (
                    <div key={s.key} className={cn(TASK_STATUS_CONFIG[s.key].bg, "transition-all")} style={{ width: `${s.pct}%` }} />
                ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
                {segments.map(s => (
                    <span key={s.key} className="text-[9px] text-muted-foreground/60 flex items-center gap-1">
                        <span className={cn("h-1.5 w-1.5 rounded-full", TASK_STATUS_CONFIG[s.key].bg)} />
                        {TASK_STATUS_CONFIG[s.key].label} {counts[s.key]}
                    </span>
                ))}
            </div>
        </div>
    )
}

// ─── Main Component ──────────────────────────────────────────────────────────

function TeamBoardContent() {
    const router = useRouter()
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userTeam = getUserTeam(session)
    const isComplianceOfficer = role === "compliance_officer" || role === "admin"
    const userName = session?.user?.name || "Team Member"

    // Redirect compliance officers away from team board
    React.useEffect(() => {
        if (isComplianceOfficer) {
            router.replace("/dashboard")
        }
    }, [isComplianceOfficer, router])

    const [allItems, setAllItems] = React.useState<{ item: ActionableItem; docId: string; docName: string }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [riskFilter, setRiskFilter] = React.useState<string>("all")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("status")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())

    const loadData = React.useCallback(async () => {
        try {
            setLoading(true)
            const results = await fetchAllActionables()
            const items: { item: ActionableItem; docId: string; docName: string }[] = []
            for (const r of results) {
                if (!r.actionables) continue
                for (const a of r.actionables) {
                    if (a.published_at && a.workstream === userTeam) {
                        items.push({ item: a, docId: r.doc_id, docName: r.doc_name || r.doc_id })
                    }
                }
            }
            setAllItems(items)
        } catch {
            toast.error("Failed to load tasks")
        } finally {
            setLoading(false)
        }
    }, [userTeam])

    React.useEffect(() => { if (!isComplianceOfficer) loadData() }, [loadData, isComplianceOfficer])

    const handleUpdate = React.useCallback(async (docId: string, itemId: string, updates: Record<string, unknown>) => {
        try {
            const updated = await updateActionable(docId, itemId, updates)
            setAllItems(prev => prev.map(e => e.item.id === itemId ? { ...e, item: { ...e.item, ...updated } } : e))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed")
        }
    }, [])

    const handleEvidenceUpload = React.useCallback(async (docId: string, itemId: string, file: File) => {
        try {
            const result = await uploadEvidence(file)
            const entry = { name: file.name, url: result.url, uploaded_at: new Date().toISOString() }
            const item = allItems.find(e => e.item.id === itemId)
            const existing = item?.item.evidence_files || []
            await handleUpdate(docId, itemId, { evidence_files: [...existing, entry] })
            toast.success(`Evidence "${file.name}" uploaded`)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Upload failed")
        }
    }, [allItems, handleUpdate])

    const handleStatusTransition = React.useCallback(async (docId: string, item: ActionableItem) => {
        const currentStatus = item.task_status || "assigned"
        let nextStatus: TaskStatus | null = null
        const extraUpdates: Record<string, unknown> = {}

        if (currentStatus === "assigned") nextStatus = "in_progress"
        else if (currentStatus === "in_progress") {
            nextStatus = "review"
            extraUpdates.submitted_at = new Date().toISOString()
        }
        else if (currentStatus === "reworking") {
            nextStatus = "review"
            extraUpdates.submitted_at = new Date().toISOString()
        }

        if (nextStatus) {
            await handleUpdate(docId, item.id, { task_status: nextStatus, ...extraUpdates })
            toast.success(`Task moved to ${TASK_STATUS_CONFIG[nextStatus].label}`)
        }
    }, [handleUpdate])

    const handleRevert = React.useCallback(async (docId: string, item: ActionableItem) => {
        await handleUpdate(docId, item.id, { task_status: "in_progress", submitted_at: "" })
        toast.success("Task reverted to In Progress")
    }, [handleUpdate])

    // Stats (team-scoped from allItems which is already team-filtered)
    const stats = React.useMemo(() => {
        const total = allItems.length
        const completed = allItems.filter(e => e.item.task_status === "completed").length
        const inProgress = allItems.filter(e => e.item.task_status === "in_progress").length
        const review = allItems.filter(e => e.item.task_status === "review").length
        const reworking = allItems.filter(e => e.item.task_status === "reworking").length
        const assigned = allItems.filter(e => !e.item.task_status || e.item.task_status === "assigned").length
        const highRisk = allItems.filter(e => normalizeRisk(e.item.modality) === "High Risk").length
        const midRisk = allItems.filter(e => normalizeRisk(e.item.modality) === "Medium Risk").length
        const lowRisk = allItems.filter(e => normalizeRisk(e.item.modality) === "Low Risk").length
        const yetToDeadline = allItems.filter(e => deadlineCategory(e.item.deadline) === "yet").length
        const delayed30 = allItems.filter(e => deadlineCategory(e.item.deadline) === "d30").length
        const delayed60 = allItems.filter(e => deadlineCategory(e.item.deadline) === "d60").length
        const delayed90 = allItems.filter(e => deadlineCategory(e.item.deadline) === "d90").length
        return { total, completed, inProgress, review, reworking, assigned, highRisk, midRisk, lowRisk, yetToDeadline, delayed30, delayed60, delayed90 }
    }, [allItems])

    // Filter + Sort
    const filtered = React.useMemo(() => {
        let result = allItems.filter(({ item }) => {
            if (statusFilter !== "all" && (item.task_status || "assigned") !== statusFilter) return false
            if (riskFilter !== "all" && normalizeRisk(item.modality) !== riskFilter) return false
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.workstream)}`.toLowerCase()
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
    }, [allItems, statusFilter, riskFilter, deadlineFilter, searchQuery, sortBy, sortDir])

    // Group: Active (not completed) and Completed
    const activeItems = React.useMemo(() => filtered.filter(e => e.item.task_status !== "completed"), [filtered])
    const completedItems = React.useMemo(() => filtered.filter(e => e.item.task_status === "completed"), [filtered])

    const toggleGroup = (g: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(g)) next.delete(g); else next.add(g)
            return next
        })
    }

    if (isComplianceOfficer) {
        return (
            <div className="flex h-screen bg-background items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Redirecting...
            </div>
        )
    }

    // Grid columns: Task | Risk | Status | Deadline | Evidence | Action
    const gridCols = "minmax(200px,3fr) 36px 110px 100px 80px 110px"

    const renderHeader = () => (
        <div className="grid border-b border-border/30 bg-muted/10 sticky top-0 z-10" style={{ gridTemplateColumns: gridCols }}>
            <div className="py-2 px-2 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Task</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Risk</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Status</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Deadline</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Evidence</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Action</div>
        </div>
    )

    const renderTaskRow = (entry: { item: ActionableItem; docId: string; docName: string }) => (
        <TaskRow
            key={`${entry.docId}-${entry.item.id}`}
            entry={entry}
            gridCols={gridCols}
            onUpdate={handleUpdate}
            onUpload={handleEvidenceUpload}
            onStatusTransition={handleStatusTransition}
            onRevert={handleRevert}
            userName={userName}
        />
    )

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-sm font-semibold text-foreground">
                        My Tasks — {userTeam || "Team"}
                    </h1>
                </div>

                {/* ── Stats row ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-3 flex items-center gap-4 overflow-x-auto">
                    <div className="flex items-center gap-4">
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
                            <p className="text-lg font-bold text-blue-400">{stats.review}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Under Review</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-orange-400">{stats.reworking}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Reworking</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-slate-400">{stats.assigned}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Assigned</p>
                        </div>
                        <div className="h-8 w-px bg-border/40" />
                        <div className="text-center">
                            <p className="text-lg font-bold text-emerald-500">{stats.yetToDeadline}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Yet to DL</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-amber-500">{stats.delayed30}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Delayed 30d</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-orange-500">{stats.delayed60}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Delayed 60d</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-red-500">{stats.delayed90}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Delayed 90d</p>
                        </div>
                    </div>
                </div>

                {/* ── Toolbar with filters and sorting ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search tasks..."
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
                            <option key={s} value={s}>{TASK_STATUS_CONFIG[s].label}</option>
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
                    <select
                        value={deadlineFilter}
                        onChange={e => setDeadlineFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Deadlines</option>
                        <option value="yet">Yet to Deadline</option>
                        <option value="d30">Delayed 30d</option>
                        <option value="d60">Delayed 60d</option>
                        <option value="d90">Delayed 90d</option>
                    </select>
                    <div className="flex items-center gap-1 ml-auto">
                        <span className="text-[10px] text-muted-foreground/50">Sort:</span>
                        <select
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value)}
                            className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
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

                {/* ── Board content ── */}
                <div className="flex-1 overflow-auto">
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading tasks...</span>
                        </div>
                    )}

                    {!loading && allItems.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                                <FileText className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-sm font-medium mb-1">No tasks yet</h3>
                            <p className="text-xs text-muted-foreground/60 max-w-sm">
                                No published tasks for your team yet. Contact the compliance officer.
                            </p>
                        </div>
                    )}

                    {!loading && activeItems.length > 0 && (
                        <div className="mb-2">
                            <button
                                onClick={() => toggleGroup("active")}
                                className="flex items-center gap-2 px-4 py-2 w-full hover:bg-muted/5 transition-colors"
                            >
                                {collapsedGroups.has("active")
                                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                }
                                <span className="text-sm font-semibold text-amber-400">Active</span>
                                <span className="text-[10px] text-muted-foreground/50 font-mono">{activeItems.length} Tasks</span>
                            </button>

                            {!collapsedGroups.has("active") && (
                                <>
                                    {renderHeader()}
                                    {activeItems.map(renderTaskRow)}
                                    <div className="px-5 py-2 border-b border-border/20">
                                        <StatusSummaryBar items={activeItems} />
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {!loading && completedItems.length > 0 && (
                        <div className="mb-2">
                            <button
                                onClick={() => toggleGroup("completed")}
                                className="flex items-center gap-2 px-4 py-2 w-full hover:bg-muted/5 transition-colors"
                            >
                                {collapsedGroups.has("completed")
                                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                }
                                <span className="text-sm font-semibold text-emerald-400">Completed</span>
                                <span className="text-[10px] text-muted-foreground/50 font-mono">{completedItems.length} Tasks</span>
                            </button>

                            {!collapsedGroups.has("completed") && (
                                <>
                                    {renderHeader()}
                                    {completedItems.map(renderTaskRow)}
                                </>
                            )}
                        </div>
                    )}

                    {!loading && filtered.length === 0 && allItems.length > 0 && (
                        <div className="text-center text-sm text-muted-foreground/60 py-12">
                            No tasks match the current filters
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}

// ─── Exported page with AuthGuard ────────────────────────────────────────────

export default function TeamBoardPage() {
    return (
        <AuthGuard>
            <TeamBoardContent />
        </AuthGuard>
    )
}
