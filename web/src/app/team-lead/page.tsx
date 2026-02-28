"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import {
    fetchAllActionables,
    fetchDelayedActionables,
    submitJustification,
    updateActionable,
} from "@/lib/api"
import {
    ActionableItem,
    ActionablesResult,
    ActionableWorkstream,
    ActionableComment,
    TaskStatus,
    getTeamView,
    isMultiTeam,
} from "@/lib/types"
import { CommentThread } from "@/components/shared/comment-thread"
import { TeamChatPanel } from "@/components/shared/team-chat-panel"
import { useSession } from "@/lib/auth-client"
import { getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { AuthGuard } from "@/components/auth/auth-guard"
import { useRouter } from "next/navigation"
import {
    ChevronDown, ChevronRight,
    Loader2, Search, AlertTriangle,
    Paperclip, Calendar, ExternalLink,
    Download, FileText, X, CheckCircle2,
    MessageSquare, SortAsc, SortDesc,
    Eye, Clock, Shield, Send, Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ───────────────────────────────────────────────────────────────

const RISK_OPTIONS = ["High Risk", "Medium Risk", "Low Risk"]

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
    return map[modality] || "Medium Risk"
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
    assigned:           { bg: "bg-slate-500/15",   text: "text-slate-400",   label: "Assigned" },
    in_progress:        { bg: "bg-amber-500/15",   text: "text-amber-400",   label: "In Progress" },
    team_review:        { bg: "bg-teal-500/15",    text: "text-teal-400",    label: "Team Review" },
    review:             { bg: "bg-blue-500/15",    text: "text-blue-400",    label: "Under Review" },
    completed:          { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Completed" },
    reworking:          { bg: "bg-orange-500/15",  text: "text-orange-400",  label: "Reworking" },
    reviewer_rejected:  { bg: "bg-rose-500/15",    text: "text-rose-400",    label: "Rejected by Reviewer" },
    awaiting_justification: { bg: "bg-yellow-600/15", text: "text-yellow-500", label: "Awaiting Justification" },
    pending_all_teams: { bg: "bg-violet-500/15", text: "text-violet-400", label: "Pending All Teams" },
}

const STATUS_SORT_ORDER: Record<string, number> = {
    awaiting_justification: 0, team_review: 1, reviewer_rejected: 2, review: 3, reworking: 4, in_progress: 5, assigned: 6, pending_all_teams: 6, completed: 7,
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlatRow {
    item: ActionableItem
    docId: string
    docName: string
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

// ─── Evidence Popover (read-only) ────────────────────────────────────────────

function EvidencePopover({ files, taskStatus }: { files: { name: string; url: string; uploaded_at: string }[]; taskStatus?: string }) {
    const [open, setOpen] = React.useState(false)
    const popoverRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [open])

    if (files.length === 0) {
        return <span className="text-[10px] text-muted-foreground/30 italic">empty</span>
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "/api/backend"

    return (
        <div className="relative" ref={popoverRef}>
            <button
                onClick={() => setOpen(!open)}
                className="text-[10px] text-foreground/70 flex items-center justify-center gap-1 hover:text-primary transition-colors rounded px-1.5 py-0.5 hover:bg-primary/10"
            >
                <Paperclip className="h-2.5 w-2.5" />{files.length}
            </button>

            {open && (
                <div className="absolute z-50 top-full mt-1 right-0 w-72 bg-background border border-border rounded-lg shadow-xl p-3 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-foreground/80">Evidence Files</span>
                        <button onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-muted/30 text-muted-foreground/40">
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                    {files.map((file, idx) => {
                        const fileUrl = file.url?.startsWith("/") ? `${apiBase}${file.url}` : file.url
                        return (
                            <div key={idx} className="flex items-center gap-2.5 bg-muted/20 rounded-md px-3 py-2.5 border border-border/20">
                                <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                                    <FileText className="h-3.5 w-3.5 text-primary/70" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-medium text-foreground/90 truncate">{file.name}</p>
                                    <p className="text-[9px] text-muted-foreground/40">
                                        {file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                                    </p>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                    {fileUrl && (
                                        <>
                                            <a
                                                href={fileUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-1 rounded hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors"
                                                title="Open"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                            <a
                                                href={fileUrl}
                                                download={file.name}
                                                className="p-1 rounded hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors"
                                                title="Download"
                                            >
                                                <Download className="h-3 w-3" />
                                            </a>
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ─── Main Team Lead Content ──────────────────────────────────────────────────

function TeamLeadContent() {
    const router = useRouter()
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userTeam = getUserTeam(session)
    const userName = session?.user?.name || "Team Lead"

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

    const [allDocs, setAllDocs] = React.useState<{ doc_id: string; doc_name: string; actionables: ActionableItem[] }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [riskFilter, setRiskFilter] = React.useState<string>("all")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("risk")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
    const [expandedRow, setExpandedRow] = React.useState<string | null>(null)
    const [activeCollapsed, setActiveCollapsed] = React.useState(false)
    const [completedCollapsed, setCompletedCollapsed] = React.useState(true)
    const [delayedCollapsed, setDelayedCollapsed] = React.useState(false)
    // Tab: "overview" shows all items, "delayed" shows only delayed items
    const [tab, setTab] = React.useState<"overview" | "delayed">("delayed")
    const [chatOpen, setChatOpen] = React.useState(false)

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
        try {
            const updated = await updateActionable(docId, itemId, { comments: [...existing, newComment] }, userTeam || undefined)
            setAllDocs(prev => prev.map(d => {
                if (d.doc_id !== docId) return d
                return { ...d, actionables: d.actionables.map(a => a.id === itemId ? { ...a, ...updated } : a) }
            }))
        } catch {
            toast.error("Failed to add comment")
        }
    }, [userName, allDocs, userTeam])

    // Build flat rows — only published items for the lead's team
    const allRows: FlatRow[] = React.useMemo(() => {
        const rows: FlatRow[] = []
        for (const doc of allDocs) {
            for (const item of doc.actionables) {
                if (item.published_at) {
                    // If lead has a team assigned, filter by it (incl. multi-team); otherwise show all
                    if (!userTeam || item.workstream === userTeam || (item.assigned_teams && item.assigned_teams.includes(userTeam))) {
                        rows.push({ item, docId: doc.doc_id, docName: doc.doc_name })
                    }
                }
            }
        }
        return rows
    }, [allDocs, userTeam])

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
            if (riskFilter !== "all" && normalizeRisk(item.modality) !== riskFilter) return false
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (statusFilter !== "all" && item.task_status !== statusFilter) return false
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
    }, [tabRows, riskFilter, deadlineFilter, statusFilter, searchQuery, sortBy, sortDir])

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

    const gridCols = "minmax(80px,0.7fr) 36px minmax(180px,3fr) 100px 100px 70px 80px 90px 80px"

    if (!isTeamLead) return null

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Eye className="h-4 w-4 text-indigo-500" />
                        Team Oversight — {userTeam || "All Teams"}
                    </h1>
                    <span className="text-[10px] text-muted-foreground/50 italic">Read-only oversight view</span>
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
                            <p className={cn("text-[15px] font-bold", stats.delayed > 0 ? "text-red-400" : "text-muted-foreground/40")}>{stats.delayed}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Delayed</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-indigo-400">{stats.justified}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Justified</p>
                        </div>
                        <div className="h-8 w-px bg-border/40" />
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-teal-400">{stats.inReview}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">In Review</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-emerald-400">{stats.completed}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Completed</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-amber-400">{stats.inProgress}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">In Progress</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[15px] font-bold text-orange-400">{stats.reworking}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Reworking</p>
                        </div>
                    </div>

                    <div className="flex-1" />

                    <div className="w-48">
                        <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-1">Completion</p>
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
                        value={riskFilter}
                        onChange={e => setRiskFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Risk</option>
                        {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>

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

                    {(riskFilter !== "all" || deadlineFilter !== "all" || statusFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => {
                                setRiskFilter("all")
                                setDeadlineFilter("all")
                                setStatusFilter("all")
                                setSearchQuery("")
                            }}
                            className="px-2.5 py-1.5 text-xs rounded-md bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/40"
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
                            <span className="text-sm">Loading team data...</span>
                        </div>
                    )}

                    {!loading && filtered.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                                <Eye className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-sm font-medium mb-1">
                                {tab === "delayed" ? "No delayed actionables" : "No published actionables"}
                            </h3>
                            <p className="text-xs text-muted-foreground/60 max-w-sm">
                                {tab === "delayed"
                                    ? "All tasks for your team are on schedule."
                                    : "No published tasks for your team yet."
                                }
                            </p>
                        </div>
                    )}

                    {/* ── Delayed section (always first if items exist) ── */}
                    {!loading && tab === "overview" && delayedRows.length > 0 && (
                        <>
                            <div className="px-3 py-2 bg-background border-b border-red-500/20 cursor-pointer sticky top-0 z-20" onClick={() => setDelayedCollapsed(!delayedCollapsed)}>
                                <span className="text-xs font-semibold text-red-500 flex items-center gap-2">
                                    {delayedCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    <Clock className="h-3.5 w-3.5" />
                                    Delayed ({delayedRows.length})
                                </span>
                            </div>

                            {!delayedCollapsed && (
                                <>
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1">Risk</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Delay</div>
                                    </div>
                                    {delayedRows.map(({ item, docId }) => (
                                        <OversightRow
                                            key={`delayed-${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            userTeam={userTeam || ""}
                                            onJustify={handleJustify}
                                            onAddComment={handleAddComment}
                                        />
                                    ))}
                                </>
                            )}
                        </>
                    )}

                    {/* ── Active section ── */}
                    {!loading && activeRows.length > 0 && (
                        <>
                            <div className="px-3 py-2 bg-background border-b border-indigo-500/20 cursor-pointer sticky top-0 z-20" onClick={() => setActiveCollapsed(!activeCollapsed)}>
                                <span className="text-xs font-semibold text-indigo-500 flex items-center gap-2">
                                    {activeCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Active ({activeRows.length})
                                </span>
                            </div>

                            {!activeCollapsed && (
                                <>
                                    <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Team</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1">Risk</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                        <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Delay</div>
                                    </div>
                                    {activeRows.map(({ item, docId }) => (
                                        <OversightRow
                                            key={`active-${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            userTeam={userTeam || ""}
                                            onJustify={handleJustify}
                                            onAddComment={handleAddComment}
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
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1">Risk</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
                                <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Delay</div>
                            </div>
                            {filtered.map(({ item, docId }) => (
                                <OversightRow
                                    key={`delayed-tab-${docId}-${item.id}`}
                                    item={item}
                                    docId={docId}
                                    expandedRow={expandedRow}
                                    setExpandedRow={setExpandedRow}
                                    userName={userName}
                                    userTeam={userTeam || ""}
                                    onJustify={handleJustify}
                                    onAddComment={handleAddComment}
                                />
                            ))}
                        </>
                    )}

                    {/* ── Completed section ── */}
                    {!loading && tab === "overview" && completedRows.length > 0 && (
                        <div className="mt-4">
                            <div className="px-3 py-2 bg-background border-y border-emerald-500/20 cursor-pointer sticky top-0 z-20" onClick={() => setCompletedCollapsed(!completedCollapsed)}>
                                <span className="text-xs font-semibold text-emerald-500 flex items-center gap-2">
                                    {completedCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Completed ({completedRows.length})
                                </span>
                            </div>

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
                                        <div className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider py-1.5 px-1 text-center">Delay</div>
                                    </div>
                                    {completedRows.map(({ item, docId }) => (
                                        <OversightRow
                                            key={`completed-${docId}-${item.id}`}
                                            item={item}
                                            docId={docId}
                                            expandedRow={expandedRow}
                                            setExpandedRow={setExpandedRow}
                                            userName={userName}
                                            userTeam={userTeam || ""}
                                            onJustify={handleJustify}
                                            onAddComment={handleAddComment}
                                        />
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </main>

            {userTeam && (
                <button
                    onClick={() => setChatOpen(!chatOpen)}
                    className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors flex items-center justify-center"
                    title="Team Chat"
                >
                    <MessageSquare className="h-5 w-5" />
                </button>
            )}
            {userTeam && (
                <TeamChatPanel
                    team={userTeam}
                    userName={userName}
                    userRole={role || "team_lead"}
                    open={chatOpen}
                    onClose={() => setChatOpen(false)}
                />
            )}
        </div>
    )

    // ── Handler: submit justification ──
    async function handleJustify(docId: string, itemId: string, justification: string) {
        try {
            await submitJustification(docId, itemId, justification, userName, userTeam || undefined)
            toast.success("Justification submitted")
            await loadAll()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to submit justification")
        }
    }
}

// ─── Oversight Row (read-only + delay management) ────────────────────────────

function OversightRow({
    item,
    docId,
    expandedRow,
    setExpandedRow,
    userName,
    userTeam,
    onJustify,
    onAddComment,
}: {
    item: ActionableItem
    docId: string
    expandedRow: string | null
    setExpandedRow: (v: string | null) => void
    userName: string
    userTeam: string
    onJustify: (docId: string, itemId: string, justification: string) => Promise<void>
    onAddComment: (docId: string, itemId: string, text: string) => Promise<void>
}) {
    const rowKey = `${docId}-${item.id}`
    const taskStatus = (item.task_status || "assigned") as TaskStatus
    const statusStyle = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
    const isExpanded = expandedRow === rowKey
    const commentCount = (item.comments || []).length
    const isDelayed = item.is_delayed || (item.deadline && new Date(item.deadline).getTime() < Date.now() && taskStatus !== "completed")
    const hasJustification = !!item.justification
    const isAwaitingJustification = taskStatus === "awaiting_justification"

    const [showJustifyInput, setShowJustifyInput] = React.useState(false)
    const [justifyText, setJustifyText] = React.useState("")


    const gridCols = "minmax(80px,0.7fr) 36px minmax(180px,3fr) 100px 100px 70px 80px 90px 80px"

    return (
        <div className={cn("border-b border-border/10", taskStatus === "completed" && "opacity-70", isDelayed && "bg-red-500/[0.03]")}>
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

                {/* Actionable text */}
                <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                    {isExpanded
                        ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                        : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                    <span className={cn("text-xs text-foreground/90 truncate", taskStatus === "completed" && "line-through decoration-emerald-500/40")}>
                        {safeStr(item.action)}
                    </span>
                    {(item.assigned_teams?.length ?? 0) > 1 && (
                        <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-violet-400 bg-violet-400/10 px-1 py-0.5 rounded" title={`Multi-team: ${item.assigned_teams!.join(", ")}`}>
                            <Users className="h-2.5 w-2.5" />{item.assigned_teams!.length}
                        </span>
                    )}
                    {commentCount > 0 && (
                        <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-primary/60">
                            <MessageSquare className="h-2.5 w-2.5" />{commentCount}
                        </span>
                    )}
                    {isDelayed && (
                        <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-red-400">
                            <Clock className="h-2.5 w-2.5" />
                        </span>
                    )}
                </div>

                {/* Status */}
                <div className="py-1.5 px-1 text-center">
                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
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
                    {isAwaitingJustification && !hasJustification && (
                        <button
                            onClick={() => setShowJustifyInput(true)}
                            className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 transition-colors font-semibold animate-pulse"
                            title="BLOCKED — Submit justification to release to Compliance"
                        >
                            ⚠ Justify Now
                        </button>
                    )}
                    {!isAwaitingJustification && isDelayed && hasJustification && item.justification_status === "reviewed" && (
                        <span className="text-[9px] text-indigo-400 italic font-medium" title={`Justified: ${item.justification}`}>Justified</span>
                    )}
                    {!isAwaitingJustification && isDelayed && hasJustification && item.justification_status !== "reviewed" && (
                        <span className="text-[9px] text-amber-400 italic font-medium" title={`Pending CO Review: ${item.justification}`}>Pending Review</span>
                    )}
                    {!isAwaitingJustification && isDelayed && !hasJustification && (
                        <button
                            onClick={() => setShowJustifyInput(true)}
                            className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium"
                            title="Submit justification"
                        >
                            Justify
                        </button>
                    )}
                    {!isDelayed && !isAwaitingJustification && (
                        <span className="text-[9px] text-muted-foreground/30">—</span>
                    )}
                </div>
            </div>

            {/* Justify input */}
            {showJustifyInput && (
                <div className="bg-red-500/5 border-t border-red-500/20 px-6 py-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <input
                        value={justifyText}
                        onChange={e => setJustifyText(e.target.value)}
                        placeholder="Reason for delay..."
                        className="flex-1 bg-background text-xs rounded-md px-3 py-1.5 border border-red-500/30 focus:border-red-500 focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === "Enter" && justifyText.trim()) {
                                onJustify(docId, item.id, justifyText.trim())
                                setShowJustifyInput(false)
                                setJustifyText("")
                            }
                            if (e.key === "Escape") {
                                setShowJustifyInput(false)
                                setJustifyText("")
                            }
                        }}
                    />
                    <button
                        onClick={() => {
                            if (justifyText.trim()) {
                                onJustify(docId, item.id, justifyText.trim())
                                setShowJustifyInput(false)
                                setJustifyText("")
                            }
                        }}
                        disabled={!justifyText.trim()}
                        className="text-[10px] px-2.5 py-1.5 rounded bg-indigo-500/15 text-indigo-500 hover:bg-indigo-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Submit Justification
                    </button>
                    <button
                        onClick={() => { setShowJustifyInput(false); setJustifyText("") }}
                        className="text-[10px] px-2 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {/* Expanded: comments and detail info */}
            {isExpanded && (
                <div className="bg-muted/5 border-t border-border/10 px-6 py-4">
                    {/* Detail info */}
                    <div className="mb-4 space-y-1.5">
                        {item.implementation_notes && (
                            <div>
                                <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Implementation Notes</span>
                                <p className="text-[11px] text-foreground/70 mt-0.5">{safeStr(item.implementation_notes)}</p>
                            </div>
                        )}
                        {item.assigned_to && (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Assigned To</span>
                                <span className="text-[11px] text-foreground/70">{item.assigned_to}</span>
                            </div>
                        )}
                        {hasJustification && (
                            <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-md p-2.5 mt-2">
                                <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">Justification</span>
                                <p className="text-[11px] text-foreground/70 mt-0.5">{item.justification}</p>
                                {item.justification_by && (
                                    <p className="text-[9px] text-muted-foreground/40 mt-1">— {item.justification_by} {item.justification_at ? `on ${formatDate(item.justification_at)}` : ""}</p>
                                )}
                            </div>
                        )}
                    </div>

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
