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
    getClassification,
    MIXED_TEAM_CLASSIFICATION,
    isMultiTeam,
    ActionableWorkstream,
    TeamWorkflow,
} from "@/lib/types"
import {
    Send, Loader2, Search,
    ChevronDown, ChevronRight, Undo2,
    Calendar, Save, Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { RoleRedirect } from "@/components/auth/role-redirect"
import {
    safeStr, normalizeRisk,
    RISK_STYLES, WORKSTREAM_COLORS, getWorkstreamClass,
} from "@/lib/status-config"
import { useTeams } from "@/lib/use-teams"
import { RiskIcon } from "@/components/shared/status-components"

// --- Types ---

interface FlatItem {
    item: ActionableItem
    docId: string
    docName: string
}

// --- Per-Team Publish Blocks (for multi-team actionables) ---

function PerTeamPublishBlocks({ item, docId, onUpdate, commonDeadline, commonDeadlineTime }: {
    item: ActionableItem
    docId: string
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    commonDeadline: string
    commonDeadlineTime: string
}) {
    const teams = item.assigned_teams || [item.workstream]
    
    // Calculate global deadline (MAX of all team deadlines)
    const globalDeadline = React.useMemo(() => {
        const deadlines = teams
            .map(team => item.team_workflows?.[team]?.deadline)
            .filter(Boolean) as string[]
        if (deadlines.length === 0) return item.deadline || ""
        return deadlines.reduce((max, dl) => dl > max ? dl : max, deadlines[0])
    }, [teams, item.team_workflows, item.deadline])

    return (
        <div className="space-y-3">
            {/* Global deadline display */}
            {globalDeadline && (
                <div className="flex items-center gap-2 px-2 py-1.5 bg-blue-500/10 rounded-md">
                    <Calendar className="h-3 w-3 text-blue-400" />
                    <span className="text-[10px] text-blue-400 font-medium">Global Deadline:</span>
                    <span className="text-[10px] text-blue-400 font-mono">{globalDeadline.split("T")[0]}</span>
                    <span className="text-[9px] text-muted-foreground/50 ml-auto">(MAX of team deadlines)</span>
                </div>
            )}

            {/* Per-team blocks */}
            {teams.map(team => {
                const tw = item.team_workflows?.[team]
                const teamColors = WORKSTREAM_COLORS[team] || WORKSTREAM_COLORS.Other
                return (
                    <PerTeamBlock
                        key={team}
                        team={team}
                        teamColors={teamColors}
                        tw={tw}
                        item={item}
                        docId={docId}
                        onUpdate={onUpdate}
                        commonDeadline={commonDeadline}
                        commonDeadlineTime={commonDeadlineTime}
                    />
                )
            })}
        </div>
    )
}

// --- Per-Team Block Component ---

function PerTeamBlock({ team, teamColors, tw, item, docId, onUpdate, commonDeadline, commonDeadlineTime }: {
    team: string
    teamColors: { bg: string; text: string; header: string }
    tw: TeamWorkflow | undefined
    item: ActionableItem
    docId: string
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    commonDeadline: string
    commonDeadlineTime: string
}) {
    const [deadlineDate, setDeadlineDate] = React.useState(tw?.deadline ? tw.deadline.split("T")[0] || "" : "")
    const [deadlineTime, setDeadlineTime] = React.useState(tw?.deadline ? tw.deadline.split("T")[1] || "23:59" : "23:59")
    const [saving, setSaving] = React.useState(false)

    const currentDl = deadlineDate ? `${deadlineDate}T${deadlineTime || "23:59"}` : ""
    const savedDl = tw?.deadline || ""
    const deadlineDirty = currentDl !== savedDl

    const handleSaveTeamDeadline = async () => {
        if (!deadlineDate) return
        setSaving(true)
        try {
            const workflows = { ...(item.team_workflows || {}) }
            workflows[team] = { ...(workflows[team] || { task_status: "assigned" }), deadline: currentDl }
            await onUpdate(docId, item.id, { team_workflows: workflows })
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className={cn("border rounded-lg p-3 space-y-2", teamColors.bg)}>
            <div className="flex items-center gap-2">
                <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", teamColors.bg, teamColors.text)}>
                    {team}
                </span>
                {tw?.deadline && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400 font-mono ml-auto">
                        {tw.deadline.split("T")[0]}
                    </span>
                )}
            </div>
            
            {/* Implementation */}
            <div>
                <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">Implementation</p>
                <p className="text-xs text-foreground/80">{safeStr(tw?.implementation_notes || item.implementation_notes)}</p>
            </div>
            
            {/* Evidence */}
            <div>
                <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">Evidence</p>
                <p className="text-xs text-foreground/80 italic">{safeStr(tw?.evidence_quote || item.evidence_quote)}</p>
            </div>
            
            {/* Deadline */}
            <div>
                <p className="text-[10px] font-medium text-muted-foreground/60 mb-1">Deadline for {team}</p>
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={deadlineDate}
                        min={new Date().toISOString().split("T")[0]}
                        onChange={e => setDeadlineDate(e.target.value)}
                        className="flex-1 bg-muted/40 text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                    />
                    <input
                        type="time"
                        value={deadlineTime}
                        onChange={e => setDeadlineTime(e.target.value)}
                        className="w-24 bg-muted/40 text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                    />
                    <button
                        onClick={handleSaveTeamDeadline}
                        disabled={!deadlineDirty || saving || !deadlineDate}
                        className={cn(
                            "flex items-center gap-1 text-[10px] px-2 py-1.5 rounded-md font-medium transition-colors",
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
                        Will use common deadline ({commonDeadline}) on publish
                    </p>
                )}
            </div>
        </div>
    )
}

// --- Publish Card ---

function PublishCard({ entry, onUpdate, onPublish, commonDeadline, commonDeadlineTime }: {
    entry: FlatItem
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    onPublish: (docId: string, itemId: string, deadline: string, assignedTeams?: string[]) => Promise<void>
    commonDeadline: string
    commonDeadlineTime: string
}) {
    const { item, docId, docName } = entry
    const [expanded, setExpanded] = React.useState(false)
    const [deadlineDate, setDeadlineDate] = React.useState(item.deadline ? item.deadline.split("T")[0] || "" : "")
    const [deadlineTime, setDeadlineTime] = React.useState(item.deadline ? item.deadline.split("T")[1] || "23:59" : "23:59")
    const [saving, setSaving] = React.useState(false)
    // Pre-populate extra teams from already-assigned teams (set in Actionables section)
    const [extraTeams, setExtraTeams] = React.useState<string[]>(() => {
        if (item.assigned_teams && item.assigned_teams.length > 1) {
            return item.assigned_teams.filter(t => t !== item.workstream)
        }
        return []
    })

    const { teamNames: _availTeams } = useTeams()
    const availableTeams = _availTeams.filter(t => t !== item.workstream && t !== "Other")
    const toggleExtraTeam = (team: string) => {
        setExtraTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team])
    }

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
        const assignedTeams = extraTeams.length > 0 ? [item.workstream, ...extraTeams] : undefined
        await onPublish(docId, item.id, dl, assignedTeams)
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
                    {/* Use getClassification for consistent tag - shows "Mixed Team Projects" for multi-team */}
                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0", getWorkstreamClass(getClassification(item)))}>
                        {getClassification(item)}
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
                    {/* Single-team: Show single implementation/evidence block */}
                    {!isMultiTeam(item) && (
                        <>
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
                                        min={new Date().toISOString().split("T")[0]}
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
                        </>
                    )}

                    {/* Multi-team: Show per-team implementation blocks */}
                    {isMultiTeam(item) && (
                        <PerTeamPublishBlocks 
                            item={item} 
                            docId={docId} 
                            onUpdate={onUpdate}
                            commonDeadline={commonDeadline}
                            commonDeadlineTime={commonDeadlineTime}
                        />
                    )}

                    {/* Multi-team assignment - only show for single-team items */}
                    {!isMultiTeam(item) && (
                    <div>
                        <p className="text-[10px] font-medium text-muted-foreground/60 mb-1 flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            Assign to Additional Teams
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {availableTeams.map(team => {
                                const teamColors = WORKSTREAM_COLORS[team] || WORKSTREAM_COLORS.Other
                                return (
                                    <button
                                        key={team}
                                        onClick={() => toggleExtraTeam(team)}
                                        className={cn(
                                            "text-[10px] px-2 py-1 rounded-md border transition-colors font-medium",
                                            extraTeams.includes(team)
                                                ? `${teamColors.bg} ${teamColors.text} border-current`
                                                : "border-border/40 text-muted-foreground/60 hover:border-border hover:text-foreground/80"
                                        )}
                                    >
                                        {team}
                                    </button>
                                )
                            })}
                        </div>
                        {extraTeams.length > 0 && (
                            <p className="text-[9px] text-amber-400 mt-1">
                                Classification: {MIXED_TEAM_CLASSIFICATION} — Each team will have separate implementation
                            </p>
                        )}
                    </div>
                    )}
                    <div className="text-[10px] text-muted-foreground/40">{docName}</div>
                </div>
            )}
        </div>
    )
}

// --- Main Page ---

export default function PublishPage() {
    const { teamNames: dynTeamNames } = useTeams()
    const [allDocs, setAllDocs] = React.useState<{ doc_id: string; doc_name: string; actionables: ActionableItem[] }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [commonDeadline, setCommonDeadline] = React.useState("")
    const [commonDeadlineTime, setCommonDeadlineTime] = React.useState("23:59")
    const [commonDeadlineSaved, setCommonDeadlineSaved] = React.useState(false)
    const [collapsedTeams, setCollapsedTeams] = React.useState<Set<string>>(new Set())

    // Load persisted common deadline from localStorage
    React.useEffect(() => {
        try {
            const saved = localStorage.getItem("publish_common_deadline")
            if (saved) {
                const { date, time } = JSON.parse(saved)
                if (date) setCommonDeadline(date)
                if (time) setCommonDeadlineTime(time)
            }
        } catch { /* ignore */ }
    }, [])

    const handleSaveCommonDeadline = () => {
        if (!commonDeadline) { toast.error("Set a date first"); return }
        const today = new Date().toISOString().split("T")[0]
        if (commonDeadline < today) { toast.error("Deadline cannot be in the past"); return }
        localStorage.setItem("publish_common_deadline", JSON.stringify({ date: commonDeadline, time: commonDeadlineTime }))
        setCommonDeadlineSaved(true)
        toast.success("Common deadline saved")
        setTimeout(() => setCommonDeadlineSaved(false), 2000)
    }

    const todayStr = React.useMemo(() => new Date().toISOString().split("T")[0], [])

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

    const handlePublish = React.useCallback(async (docId: string, itemId: string, deadline: string, assignedTeams?: string[]) => {
        const publishUpdates: Record<string, unknown> = {
            published_at: new Date().toISOString(),
            deadline,
            task_status: "assigned",
        }
        if (assignedTeams && assignedTeams.length > 1) {
            publishUpdates.assigned_teams = assignedTeams
        }
        try {
            const updated = await updateActionable(docId, itemId, publishUpdates)
            // Merge: original ← optimistic publish fields ← API response
            setAllDocs(prev => prev.map(d => {
                if (d.doc_id !== docId) return d
                return { ...d, actionables: d.actionables.map(a => a.id === itemId ? { ...a, ...publishUpdates, ...updated } as ActionableItem : a) }
            }))
            toast.success(assignedTeams && assignedTeams.length > 1 ? `Published to ${assignedTeams.length} teams` : "Published to tracker")
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
        const ro: Record<string, number> = { "High Risk": 0, "Medium Risk": 1, "Low Risk": 2 }
        let queue = allItems.filter(({ item }) => item.approval_status === "approved" && !item.published_at)
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            queue = queue.filter(({ item }) => {
                // Include classification in search so "Mixed Team Projects" is searchable
                const classification = getClassification(item)
                return `${safeStr(item.action)} ${safeStr(item.workstream)} ${safeStr(item.implementation_notes)} ${classification}`.toLowerCase().includes(q)
            })
        }
        return queue.sort((a, b) => (ro[normalizeRisk(a.item.modality)] ?? 1) - (ro[normalizeRisk(b.item.modality)] ?? 1))
    }, [allItems, searchQuery])

    // Group by team/classification (multi-team items go to "Mixed Team Projects")
    const byTeam = React.useMemo(() => {
        const teams: Record<string, FlatItem[]> = {}
        for (const entry of publishQueue) {
            // Use getClassification to determine grouping - multi-team items go to "Mixed Team Projects"
            const classification = getClassification(entry.item)
            if (!teams[classification]) teams[classification] = []
            teams[classification].push(entry)
        }
        return teams
    }, [publishQueue])

    // Ordered team keys: Mixed Team Projects first (if exists), then regular teams
    const orderedTeamKeys = React.useMemo(() => {
        const keys = Object.keys(byTeam)
        const mixedIndex = keys.indexOf(MIXED_TEAM_CLASSIFICATION)
        if (mixedIndex > -1) {
            keys.splice(mixedIndex, 1)
            return [MIXED_TEAM_CLASSIFICATION, ...dynTeamNames.filter(ws => keys.includes(ws)), ...keys.filter(k => !dynTeamNames.includes(k) && k !== MIXED_TEAM_CLASSIFICATION)]
        }
        return [...dynTeamNames.filter(ws => keys.includes(ws)), ...keys.filter(k => !dynTeamNames.includes(k))]
    }, [byTeam, dynTeamNames])

    const toggleTeam = (team: string) => {
        setCollapsedTeams(prev => {
            const next = new Set(prev)
            if (next.has(team)) next.delete(team); else next.add(team)
            return next
        })
    }

    const handlePublishAllTeam = React.useCallback(async (items: FlatItem[]) => {
        if (items.length === 0) { toast.info("No items to publish"); return }
        const globalDl = commonDeadline ? `${commonDeadline}T${commonDeadlineTime || "23:59"}` : ""
        // Check if any item lacks both individual and global deadline
        const noDeadline = items.filter(({ item }) => !item.deadline && !globalDl)
        if (noDeadline.length > 0) {
            toast.error("Set a common deadline first — some items have no individual deadline")
            return
        }
        await Promise.all(items.map(({ item, docId }) => {
            const dl = item.deadline || globalDl
            return handlePublish(docId, item.id, dl)
        }))
        toast.success(`Published ${items.length} items`)
    }, [commonDeadline, commonDeadlineTime, handlePublish])

    // Stats: published vs not-yet-published
    const publishStats = React.useMemo(() => {
        const approved = allItems.filter(({ item }) => item.approval_status === "approved")
        const published = approved.filter(({ item }) => !!item.published_at)
        const notPublished = approved.filter(({ item }) => !item.published_at)
        return { published: published.length, notPublished: notPublished.length, total: approved.length }
    }, [allItems])

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
                        <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">{publishStats.published + publishStats.notPublished} total</span>
                        <span className="px-2 py-0.5 rounded bg-emerald-400/10 text-emerald-400 font-mono">{publishStats.published} published</span>
                        <span className="px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 font-mono">{publishStats.notPublished} not published</span>
                    </div>
                </div>

                {/* Single-row controls: Search left, Calendar/Time/Save/Publish right + inline alert */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2.5 space-y-2">
                    <div className="flex items-center gap-3">
                        {/* Search — left */}
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search items..."
                                className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                            />
                        </div>
                        {/* Calendar + Time + Save + Publish — right */}
                        <div className="flex items-center gap-2 shrink-0">
                            <input
                                type="date"
                                value={commonDeadline}
                                min={todayStr}
                                onChange={e => setCommonDeadline(e.target.value)}
                                className="w-36 bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                            />
                            <input
                                type="time"
                                value={commonDeadlineTime}
                                onChange={e => setCommonDeadlineTime(e.target.value)}
                                className="w-36 bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                            />
                            <button
                                onClick={handleSaveCommonDeadline}
                                disabled={!commonDeadline}
                                className={cn(
                                    "flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-md font-medium transition-colors shrink-0",
                                    commonDeadlineSaved
                                        ? "bg-emerald-500/15 text-emerald-500"
                                        : commonDeadline
                                            ? "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                                            : "bg-muted/40 text-muted-foreground/30 cursor-not-allowed"
                                )}
                            >
                                <Save className="h-3 w-3" />
                                {commonDeadlineSaved ? "Saved" : "Save"}
                            </button>
                            <button
                                onClick={handlePublishAll}
                                disabled={publishQueue.length === 0}
                                className={cn(
                                    "flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-md font-medium transition-colors shrink-0",
                                    publishQueue.length > 0
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                                        : "bg-muted/40 text-muted-foreground/30 cursor-not-allowed"
                                )}
                            >
                                <Send className="h-3 w-3" />
                                Publish All ({publishQueue.length})
                            </button>
                        </div>
                    </div>
                    {/* Unified inline alert */}
                    <div className="text-[10px] text-muted-foreground/60 flex items-center gap-2">
                        <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                        Set a common deadline and publish approved actionables to the tracker. Items without individual deadlines will use the common deadline.
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading...</span>
                        </div>
                    )}

                    {/* Empty state */}
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

                    {!loading && publishQueue.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Total ({publishQueue.length})</p>
                            {orderedTeamKeys.map(team => {
                                const entries = byTeam[team] || []
                                if (entries.length === 0) return null
                                const isCollapsed = collapsedTeams.has(team)
                                return (
                                    <div key={team} className="space-y-1.5">
                                        <div className="flex items-center gap-2 pt-1 pb-1 cursor-pointer" onClick={() => toggleTeam(team)}>
                                            {isCollapsed
                                                ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                            }
                                            <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", getWorkstreamClass(team))}>
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
                    )}
                </div>
            </main>
        </div>
        </RoleRedirect>
    )
}
