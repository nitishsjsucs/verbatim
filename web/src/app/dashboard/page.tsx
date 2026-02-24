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
    ActionableModality,
    ActionableWorkstream,
} from "@/lib/types"
import {
    LayoutDashboard, ChevronDown, ChevronRight,
    Loader2, Search, Filter, MoreHorizontal,
    CheckCircle2, XCircle, Clock, AlertTriangle,
    Users, FileText, Eye, EyeOff,
    ArrowUpDown, GripVertical, Plus,
    CircleDot, Circle, CheckCheck,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ───────────────────────────────────────────────────────────────

const MODALITY_OPTIONS: ActionableModality[] = ["Mandatory", "Prohibited", "Permitted", "Recommended"]
const WORKSTREAM_OPTIONS: ActionableWorkstream[] = [
    "Policy", "Technology", "Operations", "Training",
    "Reporting", "Customer Communication", "Governance", "Legal", "Other",
]

/** Safely convert any value to a renderable string */
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
    Operations:               { bg: "bg-amber-500/10",  text: "text-amber-400",  header: "bg-amber-500" },
    Training:                 { bg: "bg-pink-500/10",   text: "text-pink-400",   header: "bg-pink-500" },
    Reporting:                { bg: "bg-emerald-500/10", text: "text-emerald-400", header: "bg-emerald-500" },
    "Customer Communication": { bg: "bg-sky-500/10",    text: "text-sky-400",    header: "bg-sky-500" },
    Governance:               { bg: "bg-indigo-500/10", text: "text-indigo-400", header: "bg-indigo-500" },
    Legal:                    { bg: "bg-rose-500/10",   text: "text-rose-400",   header: "bg-rose-500" },
    Other:                    { bg: "bg-zinc-500/10",   text: "text-zinc-400",   header: "bg-zinc-500" },
}

const APPROVAL_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
    pending:  { bg: "bg-amber-500/15",  text: "text-amber-400",  icon: <Clock className="h-3 w-3" />,        label: "Pending" },
    approved: { bg: "bg-emerald-500/15", text: "text-emerald-400", icon: <CheckCircle2 className="h-3 w-3" />, label: "Approved" },
    rejected: { bg: "bg-red-500/15",    text: "text-red-400",    icon: <XCircle className="h-3 w-3" />,      label: "Rejected" },
}

const MODALITY_STYLES: Record<string, { bg: string; text: string }> = {
    Mandatory:   { bg: "bg-red-500/15",    text: "text-red-400" },
    Prohibited:  { bg: "bg-orange-500/15", text: "text-orange-400" },
    Permitted:   { bg: "bg-green-500/15",  text: "text-green-400" },
    Recommended: { bg: "bg-blue-500/15",   text: "text-blue-400" },
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlatRow {
    item: ActionableItem
    docId: string
    docName: string
}

type SortKey = "actor" | "modality" | "approval_status" | "deadline_or_frequency"
type SortDir = "asc" | "desc"

// ─── Inline editable cell ────────────────────────────────────────────────────

function InlineCell({ value, onSave, className }: {
    value: string
    onSave: (v: string) => void
    className?: string
}) {
    const [editing, setEditing] = React.useState(false)
    const [draft, setDraft] = React.useState(value)
    const ref = React.useRef<HTMLInputElement>(null)

    React.useEffect(() => { setDraft(value) }, [value])
    React.useEffect(() => { if (editing) ref.current?.focus() }, [editing])

    const commit = () => {
        if (draft !== value) onSave(draft)
        setEditing(false)
    }

    if (editing) {
        return (
            <input
                ref={ref}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter") commit()
                    if (e.key === "Escape") { setDraft(value); setEditing(false) }
                }}
                className={cn(
                    "bg-muted/40 text-xs rounded px-1.5 py-0.5 border border-primary/50 focus:outline-none w-full",
                    className
                )}
            />
        )
    }

    return (
        <button
            onClick={() => setEditing(true)}
            className={cn(
                "text-xs text-left truncate w-full px-1.5 py-0.5 rounded hover:bg-muted/30 transition-colors min-h-[22px]",
                !value && "text-muted-foreground/30 italic",
                className
            )}
        >
            {value || "—"}
        </button>
    )
}

// ─── Status dropdown cell ────────────────────────────────────────────────────

function StatusCell({ value, onSave }: {
    value: string
    onSave: (v: string) => void
}) {
    const [open, setOpen] = React.useState(false)
    const style = APPROVAL_STYLES[value] || APPROVAL_STYLES.pending
    const wrapperRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        if (open) document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [open])

    return (
        <div ref={wrapperRef} className="relative">
            <button
                onClick={() => setOpen(!open)}
                className={cn(
                    "inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium w-full justify-center transition-colors",
                    style.bg, style.text
                )}
            >
                {style.icon}
                {style.label}
            </button>
            {open && (
                <div className="absolute z-50 top-full mt-1 left-0 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[120px]">
                    {Object.entries(APPROVAL_STYLES).map(([key, s]) => (
                        <button
                            key={key}
                            onClick={() => { onSave(key); setOpen(false) }}
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/50 transition-colors",
                                value === key && "bg-muted/30"
                            )}
                        >
                            <span className={s.text}>{s.icon}</span>
                            <span className="text-foreground">{s.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── Modality cell ───────────────────────────────────────────────────────────

function ModalityCell({ value, onSave }: {
    value: string
    onSave: (v: string) => void
}) {
    const [open, setOpen] = React.useState(false)
    const style = MODALITY_STYLES[value] || MODALITY_STYLES.Mandatory
    const wrapperRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        if (open) document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [open])

    return (
        <div ref={wrapperRef} className="relative">
            <button
                onClick={() => setOpen(!open)}
                className={cn(
                    "inline-flex items-center px-2 py-1 rounded text-[11px] font-medium w-full justify-center transition-colors",
                    style.bg, style.text
                )}
            >
                {value}
            </button>
            {open && (
                <div className="absolute z-50 top-full mt-1 left-0 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[110px]">
                    {MODALITY_OPTIONS.map(opt => {
                        const s = MODALITY_STYLES[opt] || MODALITY_STYLES.Mandatory
                        return (
                            <button
                                key={opt}
                                onClick={() => { onSave(opt); setOpen(false) }}
                                className={cn(
                                    "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/50 transition-colors",
                                    value === opt && "bg-muted/30"
                                )}
                            >
                                <span className={cn("h-2 w-2 rounded-full", s.bg)} />
                                <span className="text-foreground">{opt}</span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ─── Progress bar component ──────────────────────────────────────────────────

function ProgressBar({ approved, rejected, total }: { approved: number; rejected: number; total: number }) {
    if (total === 0) return <span className="text-[10px] text-muted-foreground/40">—</span>
    const approvedPct = (approved / total) * 100
    const rejectedPct = (rejected / total) * 100
    const pendingPct = 100 - approvedPct - rejectedPct

    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden flex">
                {approvedPct > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${approvedPct}%` }} />}
                {rejectedPct > 0 && <div className="bg-red-500 transition-all" style={{ width: `${rejectedPct}%` }} />}
                {pendingPct > 0 && <div className="bg-amber-500/30 transition-all" style={{ width: `${pendingPct}%` }} />}
            </div>
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {approved}/{total}
            </span>
        </div>
    )
}

// ─── Main Dashboard Page ─────────────────────────────────────────────────────

export default function DashboardPage() {
    const [allDocs, setAllDocs] = React.useState<{ doc_id: string; doc_name: string; actionables: ActionableItem[] }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [approvalFilter, setApprovalFilter] = React.useState<string>("all")
    const [modalityFilter, setModalityFilter] = React.useState<string>("all")
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())
    const [sortKey, setSortKey] = React.useState<SortKey>("actor")
    const [sortDir, setSortDir] = React.useState<SortDir>("asc")
    const [selectedRows, setSelectedRows] = React.useState<Set<string>>(new Set())

    // Column visibility
    const [visibleCols, setVisibleCols] = React.useState({
        actor: true,
        action: true,
        object: true,
        modality: true,
        status: true,
        deadline: true,
        document: true,
        source: true,
    })
    const [showColMenu, setShowColMenu] = React.useState(false)
    const colMenuRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setShowColMenu(false)
        }
        if (showColMenu) document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [showColMenu])

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

    // Flatten all
    const allRows: FlatRow[] = React.useMemo(() => {
        const rows: FlatRow[] = []
        for (const doc of allDocs) {
            for (const item of doc.actionables) {
                rows.push({ item, docId: doc.doc_id, docName: doc.doc_name })
            }
        }
        return rows
    }, [allDocs])

    // Filter
    const filtered = React.useMemo(() => {
        return allRows.filter(({ item }) => {
            if (approvalFilter !== "all" && item.approval_status !== approvalFilter) return false
            if (modalityFilter !== "all" && item.modality !== modalityFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${safeStr(item.actor)} ${safeStr(item.action)} ${safeStr(item.object)} ${safeStr(item.evidence_quote)}`.toLowerCase()
                if (!s.includes(q)) return false
            }
            return true
        })
    }, [allRows, approvalFilter, modalityFilter, searchQuery])

    // Group by workstream
    const grouped = React.useMemo(() => {
        const groups: Record<string, FlatRow[]> = {}
        for (const row of filtered) {
            const ws = safeStr(row.item.workstream) || "Other"
            if (!groups[ws]) groups[ws] = []
            groups[ws].push(row)
        }
        // Sort within each group
        for (const key in groups) {
            groups[key].sort((a, b) => {
                const aVal = safeStr((a.item as unknown as Record<string, unknown>)[sortKey])
                const bVal = safeStr((b.item as unknown as Record<string, unknown>)[sortKey])
                return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
            })
        }
        return groups
    }, [filtered, sortKey, sortDir])

    // Sort groups by workstream order
    const sortedGroupKeys = React.useMemo(() => {
        return [...WORKSTREAM_OPTIONS, "Other"].filter(ws => grouped[ws] && grouped[ws].length > 0)
    }, [grouped])

    // Stats
    const stats = React.useMemo(() => {
        const total = allRows.length
        const approved = allRows.filter(r => r.item.approval_status === "approved").length
        const rejected = allRows.filter(r => r.item.approval_status === "rejected").length
        const pending = total - approved - rejected
        const mandatory = allRows.filter(r => r.item.modality === "Mandatory").length
        const needsReview = allRows.filter(r => r.item.needs_legal_review).length
        return { total, approved, rejected, pending, mandatory, needsReview }
    }, [allRows])

    const toggleGroup = (ws: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(ws)) next.delete(ws)
            else next.add(ws)
            return next
        })
    }

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
        else { setSortKey(key); setSortDir("asc") }
    }

    const toggleRow = (key: string) => {
        setSelectedRows(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const toggleAllInGroup = (ws: string) => {
        const groupRows = grouped[ws] || []
        const keys = groupRows.map(r => `${r.docId}-${r.item.id}`)
        const allSelected = keys.every(k => selectedRows.has(k))
        setSelectedRows(prev => {
            const next = new Set(prev)
            keys.forEach(k => allSelected ? next.delete(k) : next.add(k))
            return next
        })
    }

    const batchApprove = async () => {
        const toApprove = allRows.filter(r => selectedRows.has(`${r.docId}-${r.item.id}`) && r.item.approval_status !== "approved")
        for (const r of toApprove) {
            await handleUpdate(r.docId, r.item.id, { approval_status: "approved" })
        }
        setSelectedRows(new Set())
        toast.success(`${toApprove.length} actionable(s) approved`)
    }

    const batchReject = async () => {
        const toReject = allRows.filter(r => selectedRows.has(`${r.docId}-${r.item.id}`) && r.item.approval_status !== "rejected")
        for (const r of toReject) {
            await handleUpdate(r.docId, r.item.id, { approval_status: "rejected" })
        }
        setSelectedRows(new Set())
        toast.success(`${toReject.length} actionable(s) rejected`)
    }

    // ─── Column header helper ────────────────────────────────────────────

    const ColHeader = ({ label, sortable, sortKeyVal, className }: {
        label: string; sortable?: boolean; sortKeyVal?: SortKey; className?: string
    }) => (
        <div className={cn("text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 select-none", className)}>
            {sortable && sortKeyVal ? (
                <button onClick={() => toggleSort(sortKeyVal)} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    {label}
                    <ArrowUpDown className={cn("h-2.5 w-2.5", sortKey === sortKeyVal ? "text-primary" : "text-muted-foreground/30")} />
                </button>
            ) : label}
        </div>
    )

    // ─── Render ──────────────────────────────────────────────────────────

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <div className="flex items-center gap-3">
                        <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <LayoutDashboard className="h-4 w-4 text-primary" />
                            Implementation Tracker
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedRows.size > 0 && (
                            <div className="flex items-center gap-1.5 mr-2">
                                <span className="text-[10px] text-muted-foreground font-mono">{selectedRows.size} selected</span>
                                <button onClick={batchApprove} className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium">
                                    Approve All
                                </button>
                                <button onClick={batchReject} className="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium">
                                    Reject All
                                </button>
                            </div>
                        )}
                    </div>
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
                            <p className="text-lg font-bold text-emerald-400">{stats.approved}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Approved</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-amber-400">{stats.pending}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Pending</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-red-400">{stats.rejected}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Rejected</p>
                        </div>
                        <div className="h-8 w-px bg-border/40" />
                        <div className="text-center">
                            <p className="text-lg font-bold text-red-300">{stats.mandatory}</p>
                            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Mandatory</p>
                        </div>
                        {stats.needsReview > 0 && (
                            <div className="text-center">
                                <p className="text-lg font-bold text-amber-300">{stats.needsReview}</p>
                                <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5" /> Legal</p>
                            </div>
                        )}
                    </div>

                    <div className="flex-1" />

                    {/* Overall progress */}
                    <div className="w-48">
                        <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-1">Overall Progress</p>
                        <ProgressBar approved={stats.approved} rejected={stats.rejected} total={stats.total} />
                    </div>
                </div>

                {/* ── Filters ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search actionables..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-transparent focus:border-border focus:outline-none"
                        />
                    </div>

                    <select
                        value={approvalFilter}
                        onChange={e => setApprovalFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Status</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                    </select>

                    <select
                        value={modalityFilter}
                        onChange={e => setModalityFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Types</option>
                        {MODALITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>

                    {/* Column visibility */}
                    <div ref={colMenuRef} className="relative">
                        <button
                            onClick={() => setShowColMenu(!showColMenu)}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/30 transition-colors"
                        >
                            <Eye className="h-3 w-3" />
                            Columns
                        </button>
                        {showColMenu && (
                            <div className="absolute z-50 top-full mt-1 right-0 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[150px]">
                                {Object.entries(visibleCols).map(([key, visible]) => (
                                    <label key={key} className="flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/50 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={visible}
                                            onChange={() => setVisibleCols(v => ({ ...v, [key]: !v[key as keyof typeof v] }))}
                                            className="rounded border-border h-3 w-3 accent-primary"
                                        />
                                        <span className="capitalize text-foreground">{key}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Board table ── */}
                <div className="flex-1 overflow-auto">
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading dashboard...</span>
                        </div>
                    )}

                    {!loading && allRows.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                                <LayoutDashboard className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-sm font-medium mb-1">No actionables to track</h3>
                            <p className="text-xs text-muted-foreground/60 max-w-sm">
                                Extract actionables from documents first, then they will appear here grouped by team.
                            </p>
                        </div>
                    )}

                    {!loading && sortedGroupKeys.map(ws => {
                        const rows = grouped[ws] || []
                        const isCollapsed = collapsedGroups.has(ws)
                        const wsColors = WORKSTREAM_COLORS[ws] || WORKSTREAM_COLORS.Other
                        const groupApproved = rows.filter(r => r.item.approval_status === "approved").length
                        const groupRejected = rows.filter(r => r.item.approval_status === "rejected").length
                        const groupKeys = rows.map(r => `${r.docId}-${r.item.id}`)
                        const allGroupSelected = groupKeys.length > 0 && groupKeys.every(k => selectedRows.has(k))

                        return (
                            <div key={ws} className="mb-1">
                                {/* ── Group header (Monday.com style) ── */}
                                <div className="flex items-center gap-2 px-3 py-1.5 sticky top-0 z-10 bg-background border-b border-border/20">
                                    <input
                                        type="checkbox"
                                        checked={allGroupSelected}
                                        onChange={() => toggleAllInGroup(ws)}
                                        className="rounded border-border h-3 w-3 accent-primary shrink-0"
                                    />
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
                                        <ProgressBar approved={groupApproved} rejected={groupRejected} total={rows.length} />
                                    </div>
                                </div>

                                {/* ── Column headers ── */}
                                {!isCollapsed && (
                                    <div className={cn(
                                        "grid gap-0 border-b border-border/20 bg-muted/20",
                                        "px-3"
                                    )} style={{
                                        gridTemplateColumns: `28px ${visibleCols.actor ? "minmax(100px,1fr)" : ""} ${visibleCols.action ? "minmax(140px,2fr)" : ""} ${visibleCols.object ? "minmax(100px,1fr)" : ""} ${visibleCols.modality ? "90px" : ""} ${visibleCols.status ? "100px" : ""} ${visibleCols.deadline ? "100px" : ""} ${visibleCols.document ? "120px" : ""} ${visibleCols.source ? "80px" : ""}`.replace(/\s+/g, " ").trim()
                                    }}>
                                        <div className="py-2" /> {/* checkbox col */}
                                        {visibleCols.actor && <ColHeader label="Actor" sortable sortKeyVal="actor" />}
                                        {visibleCols.action && <ColHeader label="Action" />}
                                        {visibleCols.object && <ColHeader label="Object" />}
                                        {visibleCols.modality && <ColHeader label="Type" sortable sortKeyVal="modality" />}
                                        {visibleCols.status && <ColHeader label="Status" sortable sortKeyVal="approval_status" />}
                                        {visibleCols.deadline && <ColHeader label="Deadline" sortable sortKeyVal="deadline_or_frequency" />}
                                        {visibleCols.document && <ColHeader label="Document" />}
                                        {visibleCols.source && <ColHeader label="Source" />}
                                    </div>
                                )}

                                {/* ── Rows ── */}
                                {!isCollapsed && rows.map(({ item, docId, docName }) => {
                                    const rowKey = `${docId}-${item.id}`
                                    const isSelected = selectedRows.has(rowKey)

                                    return (
                                        <div
                                            key={rowKey}
                                            className={cn(
                                                "grid gap-0 border-b border-border/10 items-center hover:bg-muted/10 transition-colors px-3 group/row",
                                                isSelected && "bg-primary/5",
                                                item.approval_status === "rejected" && "opacity-50"
                                            )}
                                            style={{
                                                gridTemplateColumns: `28px ${visibleCols.actor ? "minmax(100px,1fr)" : ""} ${visibleCols.action ? "minmax(140px,2fr)" : ""} ${visibleCols.object ? "minmax(100px,1fr)" : ""} ${visibleCols.modality ? "90px" : ""} ${visibleCols.status ? "100px" : ""} ${visibleCols.deadline ? "100px" : ""} ${visibleCols.document ? "120px" : ""} ${visibleCols.source ? "80px" : ""}`.replace(/\s+/g, " ").trim()
                                            }}
                                        >
                                            <div className="flex items-center justify-center py-1.5">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleRow(rowKey)}
                                                    className="rounded border-border h-3 w-3 accent-primary"
                                                />
                                            </div>

                                            {visibleCols.actor && (
                                                <div className="py-1.5 px-1 min-w-0">
                                                    <InlineCell
                                                        value={safeStr(item.actor)}
                                                        onSave={v => handleUpdate(docId, item.id, { actor: v })}
                                                        className="font-medium"
                                                    />
                                                </div>
                                            )}

                                            {visibleCols.action && (
                                                <div className="py-1.5 px-1 min-w-0">
                                                    <InlineCell
                                                        value={safeStr(item.action)}
                                                        onSave={v => handleUpdate(docId, item.id, { action: v })}
                                                    />
                                                </div>
                                            )}

                                            {visibleCols.object && (
                                                <div className="py-1.5 px-1 min-w-0">
                                                    <InlineCell
                                                        value={safeStr(item.object)}
                                                        onSave={v => handleUpdate(docId, item.id, { object: v })}
                                                    />
                                                </div>
                                            )}

                                            {visibleCols.modality && (
                                                <div className="py-1.5 px-1">
                                                    <ModalityCell
                                                        value={safeStr(item.modality)}
                                                        onSave={v => handleUpdate(docId, item.id, { modality: v })}
                                                    />
                                                </div>
                                            )}

                                            {visibleCols.status && (
                                                <div className="py-1.5 px-1">
                                                    <StatusCell
                                                        value={item.approval_status || "pending"}
                                                        onSave={v => handleUpdate(docId, item.id, { approval_status: v })}
                                                    />
                                                </div>
                                            )}

                                            {visibleCols.deadline && (
                                                <div className="py-1.5 px-1 min-w-0">
                                                    <InlineCell
                                                        value={safeStr(item.deadline_or_frequency)}
                                                        onSave={v => handleUpdate(docId, item.id, { deadline_or_frequency: v })}
                                                    />
                                                </div>
                                            )}

                                            {visibleCols.document && (
                                                <div className="py-1.5 px-1 min-w-0">
                                                    <span className="text-[10px] text-muted-foreground/60 truncate block px-1.5" title={docName}>
                                                        <FileText className="h-2.5 w-2.5 inline mr-1 opacity-40" />
                                                        {docName}
                                                    </span>
                                                </div>
                                            )}

                                            {visibleCols.source && (
                                                <div className="py-1.5 px-1 min-w-0">
                                                    <span className="text-[10px] text-primary/70 truncate block px-1.5" title={safeStr(item.source_location)}>
                                                        {safeStr(item.source_location) || "—"}
                                                    </span>
                                                </div>
                                            )}
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
    )
}
