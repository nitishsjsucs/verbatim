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
} from "@/lib/types"
import {
    Send, Loader2, Search,
    ChevronDown, ChevronRight, Undo2,
    Calendar, Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { RoleRedirect } from "@/components/auth/role-redirect"

// --- Constants ---

const RISK_CONFIG: Record<string, { color: string; bg: string }> = {
    "High Risk":   { color: "text-red-500",    bg: "bg-red-500/15" },
    "Medium Risk": { color: "text-yellow-500",  bg: "bg-yellow-500/15" },
    "Low Risk":    { color: "text-emerald-500", bg: "bg-emerald-500/15" },
}

const WORKSTREAM_COLORS: Record<string, string> = {
    Policy: "bg-purple-400/15 text-purple-400",
    Technology: "bg-cyan-400/15 text-cyan-400",
    Operations: "bg-blue-400/15 text-blue-400",
    Training: "bg-pink-400/15 text-pink-400",
    Reporting: "bg-indigo-400/15 text-indigo-400",
    "Customer Communication": "bg-sky-400/15 text-sky-400",
    Governance: "bg-violet-400/15 text-violet-400",
    Legal: "bg-fuchsia-400/15 text-fuchsia-400",
    Other: "bg-muted text-muted-foreground",
}

function safeStr(v: unknown): string {
    if (v === null || v === undefined) return ""
    if (typeof v === "string") return v
    if (typeof v === "number" || typeof v === "boolean") return String(v)
    try { return JSON.stringify(v) } catch { return String(v) }
}

function normalizeRisk(modality: string): string {
    const map: Record<string, string> = {
        "Mandatory": "High Risk",
        "Prohibited": "High Risk",
        "Recommended": "Medium Risk",
        "Permitted": "Low Risk",
    }
    return map[modality] || (RISK_CONFIG[modality] ? modality : "Medium Risk")
}

function RiskIcon({ modality }: { modality: string }) {
    const risk = normalizeRisk(modality)
    const cfg = RISK_CONFIG[risk] || RISK_CONFIG["Medium Risk"]
    return (
        <span className={cn("inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-bold shrink-0", cfg.bg, cfg.color)} title={risk}>!</span>
    )
}

// --- Types ---

interface FlatItem {
    item: ActionableItem
    docId: string
    docName: string
}

// --- Publish Card ---

function PublishCard({ entry, onUpdate, onPublish, commonDeadline, commonDeadlineTime }: {
    entry: FlatItem
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    onPublish: (docId: string, itemId: string, deadline: string) => Promise<void>
    commonDeadline: string
    commonDeadlineTime: string
}) {
    const { item, docId, docName } = entry
    const [expanded, setExpanded] = React.useState(false)
    const [deadlineDate, setDeadlineDate] = React.useState(item.deadline ? item.deadline.split("T")[0] || "" : "")
    const [deadlineTime, setDeadlineTime] = React.useState(item.deadline ? item.deadline.split("T")[1] || "23:59" : "23:59")
    const [saving, setSaving] = React.useState(false)

    // Track if local deadline differs from saved item deadline
    const currentDl = deadlineDate ? `${deadlineDate}T${deadlineTime || "23:59"}` : ""
    const savedDl = item.deadline || ""
    const deadlineDirty = currentDl !== savedDl

    const handleSaveDeadline = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!deadlineDate) { toast.error("Set a date first"); return }
        setSaving(true)
        try {
            await onUpdate(docId, item.id, { deadline: currentDl })
            toast.success("Deadline saved")
        } finally {
            setSaving(false)
        }
    }

    const handlePublish = async (e: React.MouseEvent) => {
        e.stopPropagation()
        // Use item deadline, or local unsaved deadline, or common deadline as fallback
        let dl = currentDl
        if (!dl && commonDeadline) {
            dl = `${commonDeadline}T${commonDeadlineTime || "23:59"}`
        }
        if (!dl) {
            toast.error("Set a deadline (or a common deadline) before publishing")
            return
        }
        await onPublish(docId, item.id, dl)
    }

    const handleRevert = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onUpdate(docId, item.id, { approval_status: "pending", published_at: "", deadline: "", task_status: "" })
    }

    return (
        <div className="border border-border/30 rounded-lg overflow-hidden transition-all">
            <div className="flex items-center gap-1.5 px-3 py-2 hover:bg-muted/20 transition-colors">
                <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0", WORKSTREAM_COLORS[item.workstream] || WORKSTREAM_COLORS.Other)}>
                        {item.workstream}
                    </span>
                    <RiskIcon modality={item.modality} />
                    <p className="text-xs text-foreground/90 leading-relaxed truncate flex-1 min-w-0">{safeStr(item.action)}</p>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                    {/* Show saved deadline as badge if set */}
                    {item.deadline && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400 font-mono">
                            {item.deadline.split("T")[0]}
                        </span>
                    )}
                    <button onClick={handleRevert} className="p-1 rounded hover:bg-amber-400/10 text-muted-foreground/40 hover:text-amber-400 transition-colors" title="Send back to pending">
                        <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={handlePublish} className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-medium" title="Publish to tracker">
                        <Send className="h-3 w-3" />
                        Publish
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-border/20 pt-2.5">
                    {item.implementation_notes && (
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">Implementation</p>
                            <p className="text-xs text-foreground/80">{safeStr(item.implementation_notes)}</p>
                        </div>
                    )}
                    {item.evidence_quote && (
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">Evidence</p>
                            <p className="text-xs text-foreground/80 italic">{safeStr(item.evidence_quote)}</p>
                        </div>
                    )}
                    <div>
                        <p className="text-[10px] font-medium text-muted-foreground/60 mb-1">Deadline</p>
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={deadlineDate}
                                onChange={e => setDeadlineDate(e.target.value)}
                                className="flex-1 bg-muted/40 text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                            />
                            <input
                                type="time"
                                value={deadlineTime}
                                onChange={e => setDeadlineTime(e.target.value)}
                                className="w-28 bg-muted/40 text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                            />
                            <button
                                onClick={handleSaveDeadline}
                                disabled={!deadlineDirty || saving || !deadlineDate}
                                className={cn(
                                    "flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-md font-medium transition-colors",
                                    deadlineDirty && deadlineDate
                                        ? "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                                        : "bg-muted/40 text-muted-foreground/30 cursor-not-allowed"
                                )}
                            >
                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                Save
                            </button>
                        </div>
                        {!deadlineDate && commonDeadline && (
                            <p className="text-[9px] text-muted-foreground/40 mt-1">
                                No individual deadline — will use common deadline ({commonDeadline}) on publish
                            </p>
                        )}
                    </div>
                    <div className="text-[10px] text-muted-foreground/40">{docName}</div>
                </div>
            )}
        </div>
    )
}

// --- Main Page ---

export default function PublishPage() {
    const [allDocs, setAllDocs] = React.useState<{ doc_id: string; doc_name: string; actionables: ActionableItem[] }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [commonDeadline, setCommonDeadline] = React.useState("")
    const [commonDeadlineTime, setCommonDeadlineTime] = React.useState("23:59")
    const [collapsedTeams, setCollapsedTeams] = React.useState<Set<string>>(new Set())

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

    React.useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleUpdate = React.useCallback(async (docId: string, itemId: string, updates: Record<string, unknown>) => {
        try {
            const updated = await updateActionable(docId, itemId, updates)
            // Merge: original ← optimistic updates ← API response (authoritative)
            setAllDocs(prev => prev.map(d => {
                if (d.doc_id !== docId) return d
                return { ...d, actionables: d.actionables.map(a => a.id === itemId ? { ...a, ...updates, ...updated } as ActionableItem : a) }
            }))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed")
        }
    }, [])

    const handlePublish = React.useCallback(async (docId: string, itemId: string, deadline: string) => {
        const publishUpdates = {
            published_at: new Date().toISOString(),
            deadline,
            task_status: "assigned",
        }
        try {
            const updated = await updateActionable(docId, itemId, publishUpdates)
            // Merge: original ← optimistic publish fields ← API response
            setAllDocs(prev => prev.map(d => {
                if (d.doc_id !== docId) return d
                return { ...d, actionables: d.actionables.map(a => a.id === itemId ? { ...a, ...publishUpdates, ...updated } as ActionableItem : a) }
            }))
            toast.success("Published to tracker")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Publish failed")
        }
    }, [])

    // Flatten all items
    const allItems = React.useMemo(() => {
        const items: FlatItem[] = []
        for (const doc of allDocs) {
            for (const item of doc.actionables) {
                items.push({ item, docId: doc.doc_id, docName: doc.doc_name })
            }
        }
        return items
    }, [allDocs])

    // Publish queue: approved but NOT yet published
    const publishQueue = React.useMemo(() => {
        let queue = allItems.filter(({ item }) => item.approval_status === "approved" && !item.published_at)
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            queue = queue.filter(({ item }) =>
                `${safeStr(item.action)} ${safeStr(item.workstream)} ${safeStr(item.implementation_notes)}`.toLowerCase().includes(q)
            )
        }
        return queue
    }, [allItems, searchQuery])

    // Group by team
    const byTeam = React.useMemo(() => {
        const teams: Record<string, FlatItem[]> = {}
        for (const entry of publishQueue) {
            const ws = entry.item.workstream || "Other"
            if (!teams[ws]) teams[ws] = []
            teams[ws].push(entry)
        }
        return teams
    }, [publishQueue])

    const toggleTeam = (team: string) => {
        setCollapsedTeams(prev => {
            const next = new Set(prev)
            if (next.has(team)) next.delete(team); else next.add(team)
            return next
        })
    }

    const handlePublishAllTeam = React.useCallback(async (items: FlatItem[]) => {
        if (items.length === 0) { toast.info("No items to publish"); return }
        const dl = commonDeadline ? `${commonDeadline}T${commonDeadlineTime || "23:59"}` : ""
        if (!dl) { toast.error("Set a common deadline first"); return }
        for (const { item, docId } of items) {
            await handlePublish(docId, item.id, dl)
        }
        toast.success(`Published ${items.length} items`)
    }, [commonDeadline, commonDeadlineTime, handlePublish])

    const handlePublishAll = React.useCallback(async () => {
        await handlePublishAllTeam(publishQueue)
    }, [publishQueue, handlePublishAllTeam])

    return (
        <RoleRedirect>
        <div className="flex h-screen bg-background">
            <Sidebar />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Send className="h-4 w-4 text-primary" />
                        Publish to Tracker
                    </h1>
                    <div className="flex items-center gap-2 text-[10px]">
                        <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">{publishQueue.length} ready</span>
                    </div>
                </div>

                {/* Common deadline + publish all */}
                <div className="shrink-0 border-b border-border/40 px-5 py-3 space-y-3">
                    <div className="text-[10px] text-muted-foreground/60 bg-blue-500/5 border border-blue-500/10 rounded px-3 py-2 flex items-center gap-2">
                        <Calendar className="h-3 w-3 text-blue-400 shrink-0" />
                        Set deadlines and publish approved actionables to the tracker. Published items will be assigned to teams.
                    </div>

                    <div className="flex items-center gap-3 bg-muted/20 rounded-lg p-3">
                        <div className="flex-1">
                            <p className="text-[10px] font-medium text-muted-foreground mb-1.5">Common Deadline (applies to Publish All)</p>
                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={commonDeadline}
                                    onChange={e => setCommonDeadline(e.target.value)}
                                    className="flex-1 bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                />
                                <input
                                    type="time"
                                    value={commonDeadlineTime}
                                    onChange={e => setCommonDeadlineTime(e.target.value)}
                                    className="w-28 bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                />
                            </div>
                        </div>
                        <Button
                            size="sm"
                            className="h-8 gap-1.5 px-3 text-[12px]"
                            onClick={handlePublishAll}
                            disabled={publishQueue.length === 0}
                        >
                            <Send className="h-3 w-3" />
                            Publish All ({publishQueue.length})
                        </Button>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search items..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-transparent focus:border-border focus:outline-none"
                        />
                    </div>
                </div>

                {/* Content: grouped by team */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading...</span>
                        </div>
                    )}

                    {!loading && publishQueue.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                                <Send className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-sm font-medium mb-1">No items to publish</h3>
                            <p className="text-xs text-muted-foreground/60 max-w-sm">
                                Approve actionables first from the Actionables section. Approved items will appear here for publishing.
                            </p>
                        </div>
                    )}

                    {!loading && Object.entries(byTeam).map(([team, entries]) => {
                        const isCollapsed = collapsedTeams.has(team)
                        return (
                            <div key={team} className="space-y-1.5">
                                <div className="flex items-center gap-2 pt-1 pb-1 cursor-pointer" onClick={() => toggleTeam(team)}>
                                    {isCollapsed
                                        ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    }
                                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", WORKSTREAM_COLORS[team] || WORKSTREAM_COLORS.Other)}>
                                        {team}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/40 font-mono">{entries.length}</span>
                                    <div className="h-px bg-border/30 flex-1" />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1 px-2 text-[10px] text-primary hover:bg-primary/10"
                                        onClick={(e) => { e.stopPropagation(); handlePublishAllTeam(entries) }}
                                    >
                                        <Send className="h-2.5 w-2.5" />
                                        Publish All
                                    </Button>
                                </div>
                                {!isCollapsed && entries.map((entry) => (
                                    <PublishCard
                                        key={`${entry.docId}-${entry.item.id}`}
                                        entry={entry}
                                        onUpdate={handleUpdate}
                                        onPublish={handlePublish}
                                        commonDeadline={commonDeadline}
                                        commonDeadlineTime={commonDeadlineTime}
                                    />
                                ))}
                            </div>
                        )
                    })}
                </div>
            </main>
        </div>
        </RoleRedirect>
    )
}
