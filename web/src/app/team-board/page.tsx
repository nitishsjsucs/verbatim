"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { AuthGuard, getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { useSession } from "@/lib/auth-client"
import {
    fetchApprovedByTeam,
    updateActionable,
    fetchAllActionables,
} from "@/lib/api"
import { ActionableItem, ActionablesResult } from "@/lib/types"
import {
    ChevronDown, ChevronRight, Loader2, Search,
    Plus, MoreHorizontal, Upload, FileText,
    Users, AlertCircle, Paperclip,
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

type TaskStatus = "todo" | "working_on_it" | "stuck" | "done"
type Priority = "low" | "medium" | "high" | "critical"

const STATUS_CONFIG: Record<TaskStatus, { label: string; bg: string; text: string }> = {
    todo: { label: "", bg: "bg-transparent", text: "text-muted-foreground/40" },
    working_on_it: { label: "Working on it", bg: "bg-amber-500", text: "text-white" },
    done: { label: "Done", bg: "bg-emerald-500", text: "text-white" },
    stuck: { label: "Stuck", bg: "bg-red-500", text: "text-white" },
}

const PRIORITY_CONFIG: Record<Priority, { label: string; bg: string; text: string }> = {
    low: { label: "Low", bg: "bg-sky-500/20", text: "text-sky-400" },
    medium: { label: "Medium", bg: "bg-violet-500/20", text: "text-violet-400" },
    high: { label: "High", bg: "bg-orange-500/20", text: "text-orange-400" },
    critical: { label: "Critical", bg: "bg-red-500/20", text: "text-red-400" },
}

const ALL_STATUSES: TaskStatus[] = ["todo", "working_on_it", "stuck", "done"]
const ALL_PRIORITIES: Priority[] = ["low", "medium", "high", "critical"]

// ─── Dropdown cell ───────────────────────────────────────────────────────────

function DropdownCell<T extends string>({
    value,
    options,
    config,
    onSave,
    placeholder,
}: {
    value: T | undefined
    options: T[]
    config: Record<T, { label: string; bg: string; text: string }>
    onSave: (v: T) => void
    placeholder?: string
}) {
    const [open, setOpen] = React.useState(false)
    const ref = React.useRef<HTMLDivElement>(null)
    const current = value && config[value] ? config[value] : null

    React.useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        if (open) document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [open])

    return (
        <div ref={ref} className="relative h-full flex items-center">
            <button
                onClick={() => setOpen(!open)}
                className={cn(
                    "w-full h-[32px] flex items-center justify-center text-[11px] font-medium rounded-sm transition-colors",
                    current ? cn(current.bg, current.text) : "text-muted-foreground/30 hover:bg-muted/30"
                )}
            >
                {current?.label || placeholder || "—"}
            </button>
            {open && (
                <div className="absolute z-50 top-full mt-1 left-0 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[130px]">
                    {options.map(opt => {
                        const c = config[opt]
                        return (
                            <button
                                key={opt}
                                onClick={() => { onSave(opt); setOpen(false) }}
                                className={cn(
                                    "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/50 transition-colors",
                                    value === opt && "bg-muted/30"
                                )}
                            >
                                <span className={cn("h-2.5 w-6 rounded-sm", c.bg)} />
                                <span className="text-foreground">{c.label || "(none)"}</span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ─── Inline editable text cell ───────────────────────────────────────────────

function TextCell({ value, onSave, placeholder, className }: {
    value: string
    onSave: (v: string) => void
    placeholder?: string
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
                className={cn("bg-muted/40 text-xs rounded px-2 py-1 border border-primary/40 focus:outline-none w-full", className)}
            />
        )
    }

    return (
        <button
            onClick={() => setEditing(true)}
            className={cn(
                "text-xs text-left truncate w-full px-2 py-1 rounded hover:bg-muted/20 transition-colors",
                !value && "text-muted-foreground/30 italic",
                className
            )}
        >
            {value || placeholder || "—"}
        </button>
    )
}

// ─── Date cell ───────────────────────────────────────────────────────────────

function DateCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
    const inputRef = React.useRef<HTMLInputElement>(null)

    const formatted = React.useMemo(() => {
        if (!value) return ""
        try {
            const d = new Date(value)
            return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        } catch { return value }
    }, [value])

    const borderColor = React.useMemo(() => {
        if (!value) return ""
        try {
            const d = new Date(value)
            const now = new Date()
            const diff = d.getTime() - now.getTime()
            if (diff < 0) return "text-red-400"
            if (diff < 3 * 24 * 60 * 60 * 1000) return "text-amber-400"
            return "text-muted-foreground"
        } catch { return "" }
    }, [value])

    return (
        <div className="relative h-full flex items-center">
            <button
                onClick={() => inputRef.current?.showPicker()}
                className={cn("text-[11px] px-2 py-1 rounded hover:bg-muted/20 transition-colors w-full text-center", borderColor || "text-muted-foreground/30")}
            >
                {formatted || "—"}
            </button>
            <input
                ref={inputRef}
                type="date"
                value={value || ""}
                onChange={e => onSave(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
            />
        </div>
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
            {files.length > 0 && (
                <span className="text-[10px] text-muted-foreground font-mono">{files.length} file{files.length > 1 ? "s" : ""}</span>
            )}
            <button
                onClick={() => inputRef.current?.click()}
                className="p-0.5 rounded hover:bg-muted/30 text-muted-foreground/40 hover:text-foreground transition-colors"
                title="Upload evidence"
            >
                <Paperclip className="h-3 w-3" />
            </button>
            <input
                ref={inputRef}
                type="file"
                className="hidden"
                onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) onUpload(f)
                    e.target.value = ""
                }}
            />
        </div>
    )
}

// ─── Summary footer bar ──────────────────────────────────────────────────────

function StatusSummaryBar({ items }: { items: { item: ActionableItem }[] }) {
    const counts: Record<string, number> = {}
    for (const { item: it } of items) {
        const s = it.task_status || "todo"
        counts[s] = (counts[s] || 0) + 1
    }
    const total = items.length || 1

    return (
        <div className="flex h-2 rounded-full overflow-hidden bg-muted/30 w-48">
            {(["working_on_it", "done", "stuck", "todo"] as TaskStatus[]).map(s => {
                const pct = ((counts[s] || 0) / total) * 100
                if (pct === 0) return null
                return <div key={s} className={cn(STATUS_CONFIG[s].bg, "transition-all")} style={{ width: `${pct}%` }} />
            })}
        </div>
    )
}

// ─── Main Component ──────────────────────────────────────────────────────────

function TeamBoardContent() {
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userTeam = getUserTeam(session)
    const isComplianceOfficer = role === "compliance_officer" || role === "admin"

    const [allItems, setAllItems] = React.useState<{ item: ActionableItem; docId: string; docName: string }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())

    const loadData = React.useCallback(async () => {
        try {
            setLoading(true)
            if (isComplianceOfficer) {
                // Compliance officer sees all approved actionables across all teams
                const results = await fetchAllActionables()
                const items: { item: ActionableItem; docId: string; docName: string }[] = []
                for (const r of results) {
                    if (!r.actionables) continue
                    for (const a of r.actionables) {
                        if (a.approval_status === "approved") {
                            items.push({ item: a, docId: r.doc_id, docName: r.doc_name || r.doc_id })
                        }
                    }
                }
                setAllItems(items)
            } else {
                // Team member sees only their team's approved actionables
                const byTeam = await fetchApprovedByTeam()
                const teamItems = byTeam[userTeam] || []
                setAllItems(teamItems.map(a => ({ item: a, docId: "", docName: "" })))
            }
        } catch {
            toast.error("Failed to load tasks")
        } finally {
            setLoading(false)
        }
    }, [isComplianceOfficer, userTeam])

    React.useEffect(() => { loadData() }, [loadData])

    const handleUpdate = React.useCallback(async (docId: string, itemId: string, updates: Record<string, unknown>) => {
        try {
            const updated = await updateActionable(docId, itemId, updates)
            setAllItems(prev => prev.map(e => e.item.id === itemId ? { ...e, item: { ...e.item, ...updated } } : e))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed")
        }
    }, [])

    const handleEvidenceUpload = React.useCallback(async (docId: string, itemId: string, file: File) => {
        // For now, create a placeholder entry. In production you'd upload to GridFS/S3 first.
        const entry = { name: file.name, url: URL.createObjectURL(file), uploaded_at: new Date().toISOString() }
        const item = allItems.find(e => e.item.id === itemId)
        const existing = item?.item.evidence_files || []
        await handleUpdate(docId, itemId, { evidence_files: [...existing, entry] })
        toast.success(`Evidence "${file.name}" uploaded`)
    }, [allItems, handleUpdate])

    // Filter
    const filtered = React.useMemo(() => {
        if (!searchQuery) return allItems
        const q = searchQuery.toLowerCase()
        return allItems.filter(({ item }) =>
            `${safeStr(item.action)} ${safeStr(item.actor)} ${safeStr(item.object)} ${safeStr(item.notes)}`.toLowerCase().includes(q)
        )
    }, [allItems, searchQuery])

    // Group: To-Do (not done) and Completed (done)
    const todoItems = React.useMemo(() => filtered.filter(e => e.item.task_status !== "done"), [filtered])
    const completedItems = React.useMemo(() => filtered.filter(e => e.item.task_status === "done"), [filtered])

    const toggleGroup = (g: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(g)) next.delete(g); else next.add(g)
            return next
        })
    }

    // Column widths matching Monday.com layout
    const gridCols = "40px minmax(200px,3fr) 90px 110px 110px 100px 120px minmax(100px,1fr) 70px"

    const renderHeader = () => (
        <div
            className="grid border-b border-border/30 bg-muted/10 sticky top-0 z-10"
            style={{ gridTemplateColumns: gridCols }}
        >
            <div className="py-2 px-1" /> {/* checkbox */}
            <div className="py-2 px-2 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Task</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Owner</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center flex items-center justify-center gap-1">
                Status <AlertCircle className="h-2.5 w-2.5 text-muted-foreground/30" />
            </div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center flex items-center justify-center gap-1">
                Due date <AlertCircle className="h-2.5 w-2.5 text-muted-foreground/30" />
            </div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider text-center">Priority</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Notes</div>
            <div className="py-2 px-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Evidence</div>
            <div className="py-2 px-1" /> {/* files count */}
        </div>
    )

    const renderRow = ({ item, docId }: { item: ActionableItem; docId: string; docName: string }) => (
        <div
            key={`${docId}-${item.id}`}
            className="grid border-b border-border/10 items-center hover:bg-muted/5 transition-colors group/row"
            style={{ gridTemplateColumns: gridCols }}
        >
            {/* Checkbox */}
            <div className="flex items-center justify-center py-1.5">
                <input type="checkbox" className="rounded border-border h-3 w-3 accent-primary" />
            </div>

            {/* Task (action + object) */}
            <div className="py-1.5 px-2 min-w-0">
                <TextCell
                    value={`${safeStr(item.action)}${item.object ? " — " + safeStr(item.object) : ""}`}
                    onSave={v => handleUpdate(docId, item.id, { action: v })}
                    className="font-medium text-foreground"
                />
                <span className="text-[9px] text-muted-foreground/40 block px-2 truncate">
                    {safeStr(item.workstream)}
                </span>
            </div>

            {/* Owner */}
            <div className="py-1.5 px-1 text-center">
                <div className="flex items-center justify-center">
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground" title={safeStr(item.actor)}>
                        {safeStr(item.actor).slice(0, 2).toUpperCase() || "?"}
                    </div>
                </div>
            </div>

            {/* Status */}
            <div className="py-1.5 px-1">
                <DropdownCell
                    value={item.task_status || "todo"}
                    options={ALL_STATUSES}
                    config={STATUS_CONFIG}
                    onSave={v => handleUpdate(docId, item.id, { task_status: v })}
                />
            </div>

            {/* Due date */}
            <div className="py-1.5 px-1">
                <DateCell
                    value={item.due_date || ""}
                    onSave={v => handleUpdate(docId, item.id, { due_date: v })}
                />
            </div>

            {/* Priority */}
            <div className="py-1.5 px-1">
                <DropdownCell
                    value={item.priority || "medium"}
                    options={ALL_PRIORITIES}
                    config={PRIORITY_CONFIG}
                    onSave={v => handleUpdate(docId, item.id, { priority: v })}
                />
            </div>

            {/* Notes */}
            <div className="py-1.5 px-1 min-w-0">
                <TextCell
                    value={safeStr(item.notes)}
                    onSave={v => handleUpdate(docId, item.id, { notes: v })}
                    placeholder="Add notes..."
                />
            </div>

            {/* Evidence */}
            <div className="py-1.5 px-1 min-w-0">
                <FilesCell
                    files={item.evidence_files || []}
                    onUpload={f => handleEvidenceUpload(docId, item.id, f)}
                />
            </div>

            {/* Files count */}
            <div className="py-1.5 px-1 text-center">
                <span className="text-[10px] text-muted-foreground/40 font-mono">
                    {(item.evidence_files || []).length > 0 ? `${(item.evidence_files || []).length} files` : ""}
                </span>
            </div>
        </div>
    )

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <div className="flex items-center gap-3">
                        <h1 className="text-sm font-semibold text-foreground">
                            main table
                        </h1>
                        <span className="text-[10px] text-muted-foreground/40">Main table</span>
                    </div>
                </div>

                {/* ── Toolbar ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-transparent focus:border-border focus:outline-none"
                        />
                    </div>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/30 transition-colors">
                        <Users className="h-3 w-3" /> Person
                    </button>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/30 transition-colors">
                        Filter
                    </button>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/30 transition-colors">
                        Sort
                    </button>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted/30 transition-colors">
                        Group by
                    </button>
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
                                {isComplianceOfficer
                                    ? "Approve actionables to see them appear here as tasks."
                                    : "No approved tasks for your team yet. Contact the compliance officer."
                                }
                            </p>
                        </div>
                    )}

                    {!loading && todoItems.length > 0 && (
                        <div className="mb-2">
                            {/* Group header: To-Do */}
                            <button
                                onClick={() => toggleGroup("todo")}
                                className="flex items-center gap-2 px-4 py-2 w-full hover:bg-muted/5 transition-colors"
                            >
                                <span className="text-[10px] text-muted-foreground/40">...</span>
                                {collapsedGroups.has("todo")
                                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                }
                                <span className="text-sm font-semibold text-violet-400">To-Do</span>
                                <span className="text-[10px] text-muted-foreground/50 font-mono">{todoItems.length} Tasks</span>
                            </button>

                            {!collapsedGroups.has("todo") && (
                                <>
                                    {renderHeader()}
                                    {todoItems.map(renderRow)}
                                    {/* Add task row */}
                                    <div className="flex items-center gap-2 px-5 py-2 text-[11px] text-muted-foreground/40 hover:text-muted-foreground cursor-pointer hover:bg-muted/5 transition-colors border-b border-border/10">
                                        <Plus className="h-3 w-3" />
                                        <span>Add task</span>
                                    </div>
                                    {/* Summary footer */}
                                    <div className="px-5 py-2 border-b border-border/20">
                                        <StatusSummaryBar items={todoItems} />
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {!loading && completedItems.length > 0 && (
                        <div className="mb-2">
                            {/* Group header: Completed */}
                            <button
                                onClick={() => toggleGroup("completed")}
                                className="flex items-center gap-2 px-4 py-2 w-full hover:bg-muted/5 transition-colors"
                            >
                                <span className="text-[10px] text-muted-foreground/40">...</span>
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
                                    {/* Add task row */}
                                    <div className="flex items-center gap-2 px-5 py-2 text-[11px] text-muted-foreground/40 hover:text-muted-foreground cursor-pointer hover:bg-muted/5 transition-colors border-b border-border/10">
                                        <Plus className="h-3 w-3" />
                                        <span>Add task</span>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Add new group */}
                    {!loading && allItems.length > 0 && (
                        <div className="px-4 py-3">
                            <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                                <Plus className="h-3 w-3" />
                                Add new group
                            </button>
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
