"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { AuthGuard, getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { useSession } from "@/lib/auth-client"
import {
    fetchAllActionables,
    updateActionable,
} from "@/lib/api"
import { ActionableItem, ActionablesResult, TaskStatus } from "@/lib/types"
import {
    ChevronDown, ChevronRight, Loader2, Search,
    FileText, Paperclip, Calendar, CheckCircle2,
    ArrowRight, RotateCcw,
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

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; bg: string; text: string }> = {
    assigned:    { label: "Assigned",    bg: "bg-slate-500",   text: "text-white" },
    in_progress: { label: "In Progress", bg: "bg-amber-500",   text: "text-white" },
    review:      { label: "Under Review", bg: "bg-blue-500",   text: "text-white" },
    completed:   { label: "Completed",   bg: "bg-emerald-500", text: "text-white" },
    reworking:   { label: "Reworking",   bg: "bg-orange-500",  text: "text-white" },
}

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

// ─── Risk Icon ───────────────────────────────────────────────────────────────

function RiskIcon({ modality }: { modality: string }) {
    const cfg = RISK_STYLES[modality] || RISK_STYLES["Medium Risk"]
    return (
        <span className={cn("inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-bold shrink-0", cfg.bg, cfg.text)} title={modality}>
            !
        </span>
    )
}

// ─── Files cell ──────────────────────────────────────────────────────────────

function FilesCell({ files, onUpload }: {
    files: { name: string; url: string; uploaded_at: string }[]
    onUpload: (file: File) => void
}) {
    const inputRef = React.useRef<HTMLInputElement>(null)
    return (
        <div className="flex items-center gap-1 h-full px-1">
            {files.length > 0 ? (
                <span className="text-[10px] text-foreground/70 font-mono">{files.length} file{files.length > 1 ? "s" : ""}</span>
            ) : (
                <span className="text-[10px] text-muted-foreground/30 italic">empty</span>
            )}
            <button
                onClick={() => inputRef.current?.click()}
                className="p-0.5 rounded hover:bg-muted/30 text-muted-foreground/40 hover:text-foreground transition-colors"
                title="Upload evidence"
            >
                <Paperclip className="h-3 w-3" />
            </button>
            <input ref={inputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = "" }} />
        </div>
    )
}

// ─── Status summary bar ──────────────────────────────────────────────────────

function StatusSummaryBar({ items }: { items: { item: ActionableItem }[] }) {
    const counts: Record<string, number> = {}
    for (const { item } of items) {
        const s = item.task_status || "assigned"
        counts[s] = (counts[s] || 0) + 1
    }
    const total = items.length || 1
    return (
        <div className="flex h-2 rounded-full overflow-hidden bg-muted/30 w-48">
            {(["in_progress", "review", "completed", "reworking", "assigned"] as TaskStatus[]).map(s => {
                const pct = ((counts[s] || 0) / total) * 100
                if (pct === 0) return null
                return <div key={s} className={cn(TASK_STATUS_CONFIG[s].bg, "transition-all")} style={{ width: `${pct}%` }} />
            })}
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

    // Redirect compliance officers away from team board
    React.useEffect(() => {
        if (isComplianceOfficer) {
            router.replace("/dashboard")
        }
    }, [isComplianceOfficer, router])

    const [allItems, setAllItems] = React.useState<{ item: ActionableItem; docId: string; docName: string }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())

    const loadData = React.useCallback(async () => {
        try {
            setLoading(true)
            // Team member sees only published actionables for their team
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
        const entry = { name: file.name, url: URL.createObjectURL(file), uploaded_at: new Date().toISOString() }
        const item = allItems.find(e => e.item.id === itemId)
        const existing = item?.item.evidence_files || []
        await handleUpdate(docId, itemId, { evidence_files: [...existing, entry] })
        toast.success(`Evidence "${file.name}" uploaded`)
    }, [allItems, handleUpdate])

    // Status transition handler for team members
    const handleStatusTransition = React.useCallback(async (docId: string, item: ActionableItem) => {
        const currentStatus = item.task_status || "assigned"
        let nextStatus: TaskStatus | null = null

        // Team member allowed transitions:
        // assigned → in_progress
        // in_progress → review (submit for review)
        // reworking → review (re-submit after rework)
        if (currentStatus === "assigned") nextStatus = "in_progress"
        else if (currentStatus === "in_progress") nextStatus = "review"
        else if (currentStatus === "reworking") nextStatus = "review"

        if (nextStatus) {
            await handleUpdate(docId, item.id, { task_status: nextStatus })
            toast.success(`Task moved to ${TASK_STATUS_CONFIG[nextStatus].label}`)
        }
    }, [handleUpdate])

    // Filter
    const filtered = React.useMemo(() => {
        if (!searchQuery) return allItems
        const q = searchQuery.toLowerCase()
        return allItems.filter(({ item }) =>
            `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.workstream)}`.toLowerCase().includes(q)
        )
    }, [allItems, searchQuery])

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

    // Grid columns: Risk | Actionable | Status | Deadline | Evidence | Action
    const gridCols = "36px minmax(200px,3fr) 110px 100px 80px 90px"

    const renderHeader = () => (
        <div className="grid border-b border-border/30 bg-muted/10 sticky top-0 z-10" style={{ gridTemplateColumns: gridCols }}>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Risk</div>
            <div className="py-2 px-2 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Task</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Status</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Deadline</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Evidence</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Action</div>
        </div>
    )

    const renderRow = ({ item, docId, docName }: { item: ActionableItem; docId: string; docName: string }) => {
        const taskStatus = item.task_status || "assigned"
        const statusCfg = TASK_STATUS_CONFIG[taskStatus] || TASK_STATUS_CONFIG.assigned
        const isOverdue = item.deadline ? new Date(item.deadline).getTime() < Date.now() : false
        const canAdvance = taskStatus === "assigned" || taskStatus === "in_progress" || taskStatus === "reworking"

        return (
            <div
                key={`${docId}-${item.id}`}
                className={cn(
                    "grid border-b border-border/10 items-center hover:bg-muted/5 transition-colors",
                    taskStatus === "completed" && "opacity-60"
                )}
                style={{ gridTemplateColumns: gridCols }}
            >
                {/* Risk icon */}
                <div className="py-2 flex justify-center">
                    <RiskIcon modality={item.modality} />
                </div>

                {/* Task text (read-only) */}
                <div className="py-2 px-2 min-w-0">
                    <p className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</p>
                    {item.implementation_notes && (
                        <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5">{safeStr(item.implementation_notes)}</p>
                    )}
                </div>

                {/* Status badge */}
                <div className="py-2 px-1 text-center">
                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium", statusCfg.bg, statusCfg.text)}>
                        {statusCfg.label}
                    </span>
                </div>

                {/* Deadline (read-only) */}
                <div className="py-2 px-1 text-center">
                    <span className={cn("text-[10px] flex items-center justify-center gap-1", isOverdue ? "text-red-400" : "text-muted-foreground/60")}>
                        <Calendar className="h-2.5 w-2.5" />
                        {formatDate(item.deadline)}
                    </span>
                </div>

                {/* Evidence */}
                <div className="py-2 px-1">
                    <FilesCell
                        files={item.evidence_files || []}
                        onUpload={f => handleEvidenceUpload(docId, item.id, f)}
                    />
                </div>

                {/* Action button */}
                <div className="py-2 px-1 text-center">
                    {canAdvance && (
                        <button
                            onClick={() => handleStatusTransition(docId, item)}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-medium"
                            title={
                                taskStatus === "assigned" ? "Start working" :
                                taskStatus === "in_progress" ? "Submit for review" :
                                "Re-submit for review"
                            }
                        >
                            {taskStatus === "assigned" && <><ArrowRight className="h-2.5 w-2.5" /> Start</>}
                            {taskStatus === "in_progress" && <><CheckCircle2 className="h-2.5 w-2.5" /> Submit</>}
                            {taskStatus === "reworking" && <><RotateCcw className="h-2.5 w-2.5" /> Resubmit</>}
                        </button>
                    )}
                    {taskStatus === "review" && (
                        <span className="text-[10px] text-blue-400 italic">Awaiting review</span>
                    )}
                    {taskStatus === "completed" && (
                        <span className="text-[10px] text-emerald-400 flex items-center justify-center gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Done
                        </span>
                    )}
                </div>
            </div>
        )
    }

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

                {/* ── Toolbar ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search tasks..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-transparent focus:border-border focus:outline-none"
                        />
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
                                <span className="text-sm font-semibold text-violet-400">Active</span>
                                <span className="text-[10px] text-muted-foreground/50 font-mono">{activeItems.length} Tasks</span>
                            </button>

                            {!collapsedGroups.has("active") && (
                                <>
                                    {renderHeader()}
                                    {activeItems.map(renderRow)}
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
                                    {completedItems.map(renderRow)}
                                </>
                            )}
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
