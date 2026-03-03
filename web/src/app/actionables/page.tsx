"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import dynamic from "next/dynamic"
import {
    fetchAllActionables,
    updateActionable,
    createManualActionable,
    deleteActionable as deleteActionableApi,
    API_BASE_URL,
} from "@/lib/api"
import {
    ActionableItem,
    ActionablesResult,
    ActionableModality,
    ActionableWorkstream,
    TeamWorkflow,
    getClassification,
    MIXED_TEAM_CLASSIFICATION,
    isMultiTeam,
} from "@/lib/types"
import {
    Shield,
    Check, X, Loader2, Plus, FileText, Search,
    ChevronDown, ChevronRight, Pencil,
    Trash2, Users, Save, Undo2, Calendar, Send,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { RoleRedirect } from "@/components/auth/role-redirect"
import {
    safeStr, normalizeRisk,
    RISK_STYLES, RISK_OPTIONS, WORKSTREAM_COLORS, DEFAULT_WORKSTREAM_COLORS, getWorkstreamClass,
} from "@/lib/status-config"
import { useTeams } from "@/lib/use-teams"
import { RiskIcon, EmptyState } from "@/components/shared/status-components"

const PdfViewer = dynamic(
    () => import("@/components/views/pdf-viewer").then(mod => mod.PdfViewer),
    { ssr: false }
)


// --- Types ---

interface DocActionables {
    doc_id: string
    doc_name: string
    actionables: ActionableItem[]
}

type ViewTab = "all" | "by-doc" | "by-team"

// --- Editable Field Component ---

function EditableField({ label, value: rawValue, onSave, type = "text", options }: {
    label: string
    value: unknown
    onSave: (val: string) => void
    type?: "text" | "textarea" | "select"
    options?: string[]
}) {
    const value = safeStr(rawValue)
    const [editing, setEditing] = React.useState(false)
    const [draft, setDraft] = React.useState(value)
    const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)

    React.useEffect(() => { setDraft(value) }, [value])
    React.useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

    const commit = () => {
        if (draft !== value) onSave(draft)
        setEditing(false)
    }

    if (!editing) {
        return (
            <div className="group/field">
                <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">{label}</p>
                <button
                    onClick={() => setEditing(true)}
                    className="text-xs text-foreground/80 hover:text-foreground w-full text-left flex items-center gap-1 min-h-[20px]"
                >
                    <span className={cn("flex-1", !value && "text-muted-foreground/40 italic")}>
                        {value || "Click to add..."}
                    </span>
                    <Pencil className="h-2.5 w-2.5 text-muted-foreground/30 opacity-0 group-hover/field:opacity-100 transition-opacity shrink-0" />
                </button>
            </div>
        )
    }

    if (type === "select" && options) {
        return (
            <div>
                <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">{label}</p>
                <select
                    ref={inputRef as React.RefObject<HTMLSelectElement>}
                    value={draft}
                    onChange={e => { setDraft(e.target.value); }}
                    onBlur={commit}
                    className="w-full bg-muted/40 text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground"
                >
                    {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            </div>
        )
    }

    if (type === "textarea") {
        return (
            <div>
                <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">{label}</p>
                <textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={e => { if (e.key === "Escape") { setDraft(value); setEditing(false) } }}
                    rows={3}
                    className="w-full bg-muted/40 text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground resize-none"
                />
            </div>
        )
    }

    return (
        <div>
            <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">{label}</p>
            <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter") commit()
                    if (e.key === "Escape") { setDraft(value); setEditing(false) }
                }}
                className="w-full bg-muted/40 text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground"
            />
        </div>
    )
}

// --- Actionable Card ---

// Helper: format YYYY-MM-DD to DD-MM-YYYY for display
function formatDateDMY(isoDate: string): string {
    if (!isoDate) return ""
    const parts = isoDate.split("T")[0].split("-")
    if (parts.length !== 3) return isoDate
    return `${parts[2]}-${parts[1]}-${parts[0]}`
}

function ActionableCard({ item, docId, docName, onUpdate, onDelete, onSourceClick, isSelected, onSelect, globalDeadline, globalDeadlineTime }: {
    item: ActionableItem
    docId: string
    docName: string
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    onDelete: (docId: string, itemId: string) => Promise<void>
    onSourceClick: (docId: string, pageNumber: number) => void
    isSelected: boolean
    onSelect: () => void
    globalDeadline: string
    globalDeadlineTime: string
}) {
    const { teamNames } = useTeams()
    const [expanded, setExpanded] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const autoGrow = React.useCallback((el: HTMLTextAreaElement | null) => {
        if (!el) return
        el.style.height = "auto"
        el.style.height = `${el.scrollHeight}px`
    }, [])

    // --- Draft state: all editable fields are local until Save ---
    const [draftImpl, setDraftImpl] = React.useState(safeStr(item.implementation_notes))
    const [draftEvidence, setDraftEvidence] = React.useState(safeStr(item.evidence_quote))
    const [draftRisk, setDraftRisk] = React.useState(normalizeRisk(item.modality))
    const [deadlineDate, setDeadlineDate] = React.useState(item.deadline ? item.deadline.split("T")[0] || "" : "")
    const [deadlineTime, setDeadlineTime] = React.useState(item.deadline ? item.deadline.split("T")[1] || "23:59" : "23:59")

    // Draft teams: local selection, only sent on Save
    const [draftTeams, setDraftTeams] = React.useState<string[]>(() => {
        return (item.assigned_teams?.length ?? 0) > 1 ? [...item.assigned_teams!] : [item.workstream]
    })

    // Per-team implementation drafts (for multi-team)
    const [draftTeamImpl, setDraftTeamImpl] = React.useState<Record<string, string>>(() => {
        const d: Record<string, string> = {}
        if (item.assigned_teams) {
            for (const team of item.assigned_teams) {
                d[team] = safeStr(item.team_workflows?.[team]?.implementation_notes || item.implementation_notes)
            }
        }
        return d
    })

    // Per-team deadline drafts
    const [teamDeadlineDrafts, setTeamDeadlineDrafts] = React.useState<Record<string, { date: string; time: string }>>(() => {
        const drafts: Record<string, { date: string; time: string }> = {}
        if (item.assigned_teams) {
            for (const team of item.assigned_teams) {
                const tw = item.team_workflows?.[team]
                drafts[team] = {
                    date: tw?.deadline ? tw.deadline.split("T")[0] || "" : "",
                    time: tw?.deadline ? tw.deadline.split("T")[1] || "23:59" : "23:59",
                }
            }
        }
        return drafts
    })

    // Sync drafts when item changes externally
    React.useEffect(() => {
        setDraftImpl(safeStr(item.implementation_notes))
        setDraftEvidence(safeStr(item.evidence_quote))
        setDraftRisk(normalizeRisk(item.modality))
        setDeadlineDate(item.deadline ? item.deadline.split("T")[0] || "" : "")
        setDeadlineTime(item.deadline ? item.deadline.split("T")[1] || "23:59" : "23:59")
        const teams = (item.assigned_teams?.length ?? 0) > 1 ? [...item.assigned_teams!] : [item.workstream]
        setDraftTeams(teams)
        const d: Record<string, string> = {}
        const dlDrafts: Record<string, { date: string; time: string }> = {}
        if (item.assigned_teams) {
            for (const team of item.assigned_teams) {
                d[team] = safeStr(item.team_workflows?.[team]?.implementation_notes || item.implementation_notes)
                const tw = item.team_workflows?.[team]
                dlDrafts[team] = {
                    date: tw?.deadline ? tw.deadline.split("T")[0] || "" : "",
                    time: tw?.deadline ? tw.deadline.split("T")[1] || "23:59" : "23:59",
                }
            }
        }
        setDraftTeamImpl(d)
        setTeamDeadlineDrafts(dlDrafts)
    }, [item])

    // Determine if any draft differs from saved
    const isDirty = React.useMemo(() => {
        if (draftImpl !== safeStr(item.implementation_notes)) return true
        if (draftEvidence !== safeStr(item.evidence_quote)) return true
        if (draftRisk !== normalizeRisk(item.modality)) return true
        const currentDl = deadlineDate ? `${deadlineDate}T${deadlineTime || "23:59"}` : ""
        if (currentDl !== (item.deadline || "")) return true
        // Check teams
        const savedTeams = (item.assigned_teams?.length ?? 0) > 1 ? [...item.assigned_teams!] : [item.workstream]
        if (draftTeams.length !== savedTeams.length || !draftTeams.every(t => savedTeams.includes(t))) return true
        // Check per-team impl for multi
        if (draftTeams.length > 1) {
            for (const team of draftTeams) {
                const saved = safeStr(item.team_workflows?.[team]?.implementation_notes || item.implementation_notes)
                if ((draftTeamImpl[team] || "") !== saved) return true
                const savedTw = item.team_workflows?.[team]
                const draft = teamDeadlineDrafts[team] || { date: "", time: "23:59" }
                const currentTeamDl = draft.date ? `${draft.date}T${draft.time || "23:59"}` : ""
                if (currentTeamDl !== (savedTw?.deadline || "")) return true
            }
        }
        return false
    }, [draftImpl, draftEvidence, draftRisk, deadlineDate, deadlineTime, draftTeams, draftTeamImpl, teamDeadlineDrafts, item])

    // --- Unified Save: sends all draft changes at once ---
    const handleSaveAll = async () => {
        setSaving(true)
        try {
            const updates: Record<string, unknown> = {}
            // Implementation & Evidence (shared/top-level)
            if (draftImpl !== safeStr(item.implementation_notes)) updates.implementation_notes = draftImpl
            if (draftEvidence !== safeStr(item.evidence_quote)) updates.evidence_quote = draftEvidence
            if (draftRisk !== normalizeRisk(item.modality)) updates.modality = draftRisk
            // Deadline
            const dl = deadlineDate ? `${deadlineDate}T${deadlineTime || "23:59"}` : ""
            if (dl !== (item.deadline || "")) updates.deadline = dl
            // Teams
            const savedTeams = (item.assigned_teams?.length ?? 0) > 1 ? [...item.assigned_teams!] : [item.workstream]
            const teamsChanged = draftTeams.length !== savedTeams.length || !draftTeams.every(t => savedTeams.includes(t))
            if (teamsChanged) {
                updates.workstream = draftTeams[0]
                updates.assigned_teams = draftTeams.length > 1 ? draftTeams : []
            }
            // Per-team workflows for multi-team
            if (draftTeams.length > 1) {
                const workflows = { ...(item.team_workflows || {}) }
                for (const team of draftTeams) {
                    const existing = workflows[team] || { task_status: "assigned" }
                    workflows[team] = {
                        ...existing,
                        implementation_notes: draftTeamImpl[team] || "",
                    }
                    const draft = teamDeadlineDrafts[team]
                    if (draft?.date) {
                        workflows[team] = { ...workflows[team], deadline: `${draft.date}T${draft.time || "23:59"}` }
                    }
                }
                // Remove workflows for deselected teams
                for (const key of Object.keys(workflows)) {
                    if (!draftTeams.includes(key)) delete workflows[key]
                }
                updates.team_workflows = workflows
            }
            await onUpdate(docId, item.id, updates)
            toast.success("Changes saved")
        } catch (err) {
            console.error("Failed to save:", err)
            toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
            setSaving(false)
        }
    }

    // Approve & Publish: resolves deadline, sets published_at + task_status, moves to tracker
    const handleApprove = async (e: React.MouseEvent) => {
        e.stopPropagation()
        let dl = deadlineDate ? `${deadlineDate}T${deadlineTime || "23:59"}` : (item.deadline || "")
        if (!dl && globalDeadline) {
            dl = `${globalDeadline}T${globalDeadlineTime || "23:59"}`
        }
        if (!dl) {
            toast.error("Set a deadline (or a global deadline) before approving")
            return
        }
        // Save any pending draft changes first, then approve
        const updates: Record<string, unknown> = {
            approval_status: "approved",
            published_at: new Date().toISOString(),
            deadline: dl,
            task_status: "assigned",
        }
        if (draftImpl !== safeStr(item.implementation_notes)) updates.implementation_notes = draftImpl
        if (draftEvidence !== safeStr(item.evidence_quote)) updates.evidence_quote = draftEvidence
        if (draftRisk !== normalizeRisk(item.modality)) updates.modality = draftRisk
        const teamsChanged = draftTeams.length !== ((item.assigned_teams?.length ?? 0) > 1 ? item.assigned_teams! : [item.workstream]).length
        if (teamsChanged) {
            updates.workstream = draftTeams[0]
            updates.assigned_teams = draftTeams.length > 1 ? draftTeams : []
        }
        await onUpdate(docId, item.id, updates)
        toast.success("Approved & sent to tracker")
    }

    const handleReject = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onUpdate(docId, item.id, { approval_status: "rejected" })
    }

    const handleRevert = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onUpdate(docId, item.id, { approval_status: "pending", published_at: "", task_status: "", deadline: "" })
    }

    const handleSourceClick = () => {
        const match = item.source_location?.match(/p\.?\s*(\d+)/)
        if (match) {
            onSourceClick(docId, parseInt(match[1], 10))
        }
    }

    // Determine if current draft is multi-team (local, not yet saved)
    const draftIsMulti = draftTeams.length > 1

    return (
        <div
            className={cn(
                "border rounded-lg overflow-hidden transition-all",
                isSelected ? "border-primary/30 ring-1 ring-primary/10" : "border-border/30",
                item.approval_status === "rejected" && "border-red-500/20 opacity-60",
            )}
        >
            {/* Header row: Team → Risk → Text → Buttons */}
            <div className="flex items-center gap-1.5 px-3 py-2 hover:bg-muted/20 transition-colors">
                <button onClick={() => { setExpanded(!expanded); onSelect() }} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}

                    {/* Risk icon — before team tag */}
                    <RiskIcon modality={item.modality} />

                    {/* Team tag - uses saved classification (not draft) */}
                    <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium shrink-0", getWorkstreamClass(getClassification(item)))}>
                        {getClassification(item)}
                    </span>

                    {/* Actionable text */}
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/90 leading-relaxed truncate">
                            {safeStr(item.action)}
                        </p>
                    </div>
                </button>

                {/* Right-side buttons */}
                <div className="flex items-center gap-1 shrink-0">
                    {item.approval_status === "pending" && (
                        <>
                            <button onClick={handleApprove} className="p-1 rounded hover:bg-emerald-400/10 text-muted-foreground/40 hover:text-emerald-400 transition-colors" title="Approve & send to tracker">
                                <Check className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={handleReject} className="p-1 rounded hover:bg-red-400/10 text-muted-foreground/40 hover:text-red-400 transition-colors" title="Reject">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}
                    {item.approval_status === "approved" && (
                        <button onClick={handleRevert} className="p-1 rounded hover:bg-amber-400/10 text-muted-foreground/40 hover:text-amber-400 transition-colors" title="Revert to pending">
                            <Undo2 className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {item.approval_status === "rejected" && (
                        <button onClick={handleRevert} className="p-1 rounded hover:bg-amber-400/10 text-muted-foreground/40 hover:text-amber-400 transition-colors" title="Revert to pending">
                            <Undo2 className="h-3.5 w-3.5" />
                        </button>
                    )}
                    <span className={cn(
                        "text-xs px-1.5 py-0.5 rounded font-medium ml-1",
                        item.approval_status === "approved" ? "text-emerald-400 bg-emerald-400/10" :
                        item.approval_status === "rejected" ? "text-red-400 bg-red-400/10" :
                        "text-yellow-400 bg-yellow-400/10"
                    )}>
                        {item.approval_status === "approved" ? "Approved" : item.approval_status === "rejected" ? "Rejected" : "Pending"}
                    </span>
                </div>
            </div>

            {/* Expanded details */}
            {expanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-border/20 pt-2.5">
                    {saving && (
                        <div className="flex items-center gap-1.5 text-xs text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                        </div>
                    )}

                    {item.approval_status === "approved" ? (
                        <>
                            {/* Evidence + source side by side at top */}
                            <div className="flex items-start gap-3">
                                <div className="flex-1">
                                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Evidence</p>
                                    <p className="text-xs text-foreground/80 italic">{safeStr(item.evidence_quote) || "—"}</p>
                                </div>
                                <button onClick={handleSourceClick} className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0 pt-3">
                                    <FileText className="h-3 w-3" />
                                    {item.source_location || "Source"}
                                </button>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Implementation</p>
                                <p className="text-xs text-foreground/80">{safeStr(item.implementation_notes) || "—"}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Team{(item.assigned_teams?.length ?? 0) > 1 ? "s" : ""}</p>
                                    <div className="flex flex-wrap gap-1">
                                        {((item.assigned_teams?.length ?? 0) > 1 ? item.assigned_teams! : [item.workstream]).map(t => (
                                            <span key={t} className={cn("inline-block px-2 py-0.5 rounded text-xs font-medium", getWorkstreamClass(t))}>{t}</span>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Risk Level</p>
                                    <span className={cn("inline-block px-2 py-0.5 rounded text-xs font-medium", RISK_STYLES[normalizeRisk(item.modality)]?.bg || "bg-muted/40", RISK_STYLES[normalizeRisk(item.modality)]?.text || "text-foreground")}>{normalizeRisk(item.modality)}</span>
                                </div>
                            </div>
                            {item.deadline && (
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Deadline</p>
                                    <span className="text-xs text-blue-400 font-mono">{formatDateDMY(item.deadline)}</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            {/* Evidence + source link side by side at top */}
                            <div className="flex items-start gap-3">
                                <div className="flex-1">
                                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Evidence</p>
                                    <textarea
                                        value={draftEvidence}
                                        onChange={e => {
                                            setDraftEvidence(e.target.value)
                                            autoGrow(e.target)
                                        }}
                                        ref={el => autoGrow(el)}
                                        rows={2}
                                        className="w-full bg-background text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground resize-none overflow-hidden"
                                        placeholder="Click to add evidence..."
                                        style={{ minHeight: '48px' }}
                                    />
                                </div>
                                <button onClick={handleSourceClick} className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0 pt-4">
                                    <FileText className="h-3 w-3" />
                                    {item.source_location || "Source"}
                                </button>
                            </div>

                            {/* Team multi-select */}
                            <div>
                                <p className="text-xs font-medium text-muted-foreground/60 mb-1 flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    Assign Teams
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {teamNames.map(team => {
                                        const isTeamSelected = draftTeams.includes(team)
                                        const teamColors = WORKSTREAM_COLORS[team] || DEFAULT_WORKSTREAM_COLORS
                                        return (
                                            <button
                                                key={team}
                                                onClick={() => {
                                                    setDraftTeams(prev => {
                                                        if (prev.includes(team)) {
                                                            if (prev.length <= 1) return prev
                                                            return prev.filter(t => t !== team)
                                                        }
                                                        const next = [team, ...prev]
                                                        // Initialize impl/deadline drafts for newly added team
                                                        if (!draftTeamImpl[team]) {
                                                            setDraftTeamImpl(p => ({ ...p, [team]: safeStr(item.implementation_notes) }))
                                                        }
                                                        if (!teamDeadlineDrafts[team]) {
                                                            setTeamDeadlineDrafts(p => ({ ...p, [team]: { date: "", time: "23:59" } }))
                                                        }
                                                        return next
                                                    })
                                                }}
                                                className={cn(
                                                    "text-xs px-2 py-1 rounded-md border transition-colors font-medium",
                                                    isTeamSelected
                                                        ? `${teamColors.bg} ${teamColors.text} border-current`
                                                        : "border-border/40 text-muted-foreground/60 hover:border-border hover:text-foreground/80"
                                                )}
                                            >
                                                {team}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Single-team: Consolidated group box */}
                            {!draftIsMulti && (() => {
                                const teamColors = WORKSTREAM_COLORS[draftTeams[0]] || DEFAULT_WORKSTREAM_COLORS
                                return (
                                <div className={cn("rounded-lg p-3 space-y-3 border-2", teamColors.text.replace('text-', 'border-'))}>
                                    <div className="flex items-center gap-2">
                                        <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", getWorkstreamClass(draftTeams[0]))}>
                                            {draftTeams[0]}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Implementation</p>
                                        <textarea
                                            value={draftImpl}
                                            onChange={e => {
                                                setDraftImpl(e.target.value)
                                                autoGrow(e.target)
                                            }}
                                            ref={autoGrow}
                                            rows={2}
                                            className="w-full bg-background text-xs rounded px-2 py-1 border border-border/60 focus:border-primary focus:outline-none text-foreground resize-none overflow-hidden"
                                            placeholder="Click to add implementation notes..."
                                            style={{ minHeight: '48px' }}
                                        />
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground/60 mb-1 flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            Deadline
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="date"
                                                value={deadlineDate}
                                                min={new Date().toISOString().split("T")[0]}
                                                onChange={e => setDeadlineDate(e.target.value)}
                                                className="flex-1 bg-background text-xs rounded-md px-2.5 py-1.5 border border-border/60 focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                            />
                                            <input
                                                type="time"
                                                value={deadlineTime}
                                                onChange={e => setDeadlineTime(e.target.value)}
                                                className="w-20 bg-background text-xs rounded-md px-2.5 py-1.5 border border-border/60 focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                            />
                                        </div>
                                        {deadlineDate && (
                                            <p className="text-xs text-muted-foreground/50 mt-1">
                                                {formatDateDMY(deadlineDate)}
                                            </p>
                                        )}
                                        {!deadlineDate && globalDeadline && (
                                            <p className="text-xs text-muted-foreground/40 mt-1">
                                                No individual deadline — will use global deadline ({formatDateDMY(globalDeadline)}) on approve
                                            </p>
                                        )}
                                    </div>
                                </div>
                                )
                            })()}

                            {/* Multi-team: Per-team group boxes (Implementation + Deadline only, no evidence) */}
                            {draftIsMulti && (
                                <div className="space-y-3">
                                    <p className="text-xs font-medium text-muted-foreground/60 flex items-center gap-1">
                                        <Users className="h-3 w-3" />
                                        Per-Team Implementation
                                    </p>
                                    {draftTeams.map(team => {
                                        const teamColors = WORKSTREAM_COLORS[team] || DEFAULT_WORKSTREAM_COLORS
                                        const draft = teamDeadlineDrafts[team] || { date: "", time: "23:59" }

                                        return (
                                            <div key={team} className={cn("rounded-lg p-3 space-y-2 border-2", teamColors.text.replace('text-', 'border-'))}>
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", teamColors.bg, teamColors.text)}>
                                                        {team}
                                                    </span>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Implementation</p>
                                                    <textarea
                                                        value={draftTeamImpl[team] || ""}
                                                        onChange={e => {
                                                            setDraftTeamImpl(prev => ({ ...prev, [team]: e.target.value }))
                                                            autoGrow(e.target)
                                                        }}
                                                        ref={autoGrow}
                                                        rows={2}
                                                        className="w-full bg-background text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground resize-none overflow-hidden"
                                                        placeholder="Click to add implementation notes..."
                                                        style={{ minHeight: '48px' }}
                                                    />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground/60 mb-1 flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" />
                                                        Deadline
                                                    </p>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="date"
                                                            value={draft.date}
                                                            min={new Date().toISOString().split("T")[0]}
                                                            onChange={e => setTeamDeadlineDrafts(prev => ({ ...prev, [team]: { ...draft, date: e.target.value } }))}
                                                            className="flex-1 bg-muted/40 text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                                        />
                                                        <input
                                                            type="time"
                                                            value={draft.time}
                                                            onChange={e => setTeamDeadlineDrafts(prev => ({ ...prev, [team]: { ...draft, time: e.target.value } }))}
                                                            className="w-20 bg-muted/40 text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                                        />
                                                    </div>
                                                    {draft.date && (
                                                        <p className="text-xs text-muted-foreground/50 mt-1">
                                                            {formatDateDMY(draft.date)}
                                                        </p>
                                                    )}
                                                    {!draft.date && globalDeadline && (
                                                        <p className="text-xs text-muted-foreground/40 mt-1">
                                                            Will use global deadline ({formatDateDMY(globalDeadline)}) on approve
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Risk Level */}
                            <div>
                                <p className="text-xs font-medium text-muted-foreground/60 mb-1">Risk Level</p>
                                <select
                                    value={draftRisk}
                                    onChange={e => setDraftRisk(e.target.value)}
                                    className={cn(
                                        "w-full text-xs rounded-md px-2.5 py-1.5 border border-dashed border-border hover:border-primary/50 focus:border-primary focus:outline-none cursor-pointer transition-colors font-medium",
                                        RISK_STYLES[draftRisk]?.bg || "bg-muted/40",
                                        RISK_STYLES[draftRisk]?.text || "text-foreground"
                                    )}
                                >
                                    {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>

                            {/* Unified Save button */}
                            <button
                                onClick={handleSaveAll}
                                disabled={!isDirty || saving}
                                className={cn(
                                    "w-full flex items-center justify-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium transition-colors",
                                    isDirty
                                        ? "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                                        : "bg-muted/40 text-muted-foreground/30 cursor-not-allowed"
                                )}
                            >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                {isDirty ? "Save Changes" : "No Changes"}
                            </button>
                        </>
                    )}

                    {/* Footer: source + actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-border/10">
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground/40">{docName}</span>
                        </div>
                        {item.approval_status !== "approved" && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => onDelete(docId, item.id)}
                                    className="p-1 rounded hover:bg-red-400/10 text-muted-foreground/30 hover:text-red-400 transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

// --- Create Actionable Form ---

function CreateActionableForm({ docId, docName, allDocs, onCreated, onCancel }: {
    docId: string
    docName: string
    allDocs: DocActionables[]
    onCreated: () => void
    onCancel: () => void
}) {
    const { teamNames } = useTeams()
    const [creating, setCreating] = React.useState(false)
    const [selectedDocId, setSelectedDocId] = React.useState(docId)
    const [docSearchQuery, setDocSearchQuery] = React.useState("")
    const [form, setForm] = React.useState({
        action: "",
        modality: "High Risk" as ActionableModality,
        workstream: "Other" as ActionableWorkstream,
        implementation_notes: "",
        evidence_quote: "",
    })

    const filteredDocs = React.useMemo(() => {
        if (!docSearchQuery.trim()) return allDocs
        const q = docSearchQuery.toLowerCase()
        return allDocs.filter(d => d.doc_name.toLowerCase().includes(q))
    }, [allDocs, docSearchQuery])

    const selectedDocName = allDocs.find(d => d.doc_id === selectedDocId)?.doc_name || docName

    const handleSubmit = async () => {
        if (!form.action) {
            toast.error("Actionable text is required")
            return
        }
        setCreating(true)
        try {
            await createManualActionable(selectedDocId, form)
            toast.success("Actionable created")
            onCreated()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create")
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="border border-primary/30 rounded-lg p-4 space-y-3 bg-primary/5">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5 text-primary" />
                    New Actionable
                </h3>
                <button onClick={onCancel} className="p-1 rounded hover:bg-muted text-muted-foreground">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Document selector with search */}
            <div>
                <label className="text-xs font-medium text-muted-foreground/60 block mb-0.5">Document *</label>
                <div className="relative mb-1">
                    <Search className="absolute left-2 top-[7px] h-3 w-3 text-muted-foreground/50" />
                    <input
                        value={docSearchQuery}
                        onChange={e => setDocSearchQuery(e.target.value)}
                        placeholder="Search documents..."
                        className="w-full bg-background text-xs rounded px-2 py-1.5 pl-6 border border-border focus:border-primary focus:outline-none"
                    />
                </div>
                <select
                    value={selectedDocId}
                    onChange={e => setSelectedDocId(e.target.value)}
                    className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground"
                >
                    {filteredDocs.map(d => (
                        <option key={d.doc_id} value={d.doc_id}>{d.doc_name}</option>
                    ))}
                </select>
            </div>

            <div>
                <label className="text-xs font-medium text-muted-foreground/60 block mb-0.5">Actionable *</label>
                <input value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} placeholder="Describe the actionable..." className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-medium text-muted-foreground/60 block mb-0.5">Risk Level</label>
                    <select value={form.modality} onChange={e => setForm(f => ({ ...f, modality: e.target.value as ActionableModality }))} className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground">
                        {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-medium text-muted-foreground/60 block mb-0.5">Team</label>
                    <select value={form.workstream} onChange={e => setForm(f => ({ ...f, workstream: e.target.value as ActionableWorkstream }))} className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground">
                        {teamNames.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>
            </div>

            <div>
                <label className="text-xs font-medium text-muted-foreground/60 block mb-0.5">Implementation Details</label>
                <textarea value={form.implementation_notes} onChange={e => setForm(f => ({ ...f, implementation_notes: e.target.value }))} rows={3} className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none resize-none" />
            </div>

            <div>
                <label className="text-xs font-medium text-muted-foreground/60 block mb-0.5">Evidence</label>
                <textarea value={form.evidence_quote} onChange={e => setForm(f => ({ ...f, evidence_quote: e.target.value }))} rows={2} className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none resize-none" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
                <Button size="sm" onClick={handleSubmit} disabled={creating} className="h-7 text-xs gap-1.5">
                    {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Create
                </Button>
            </div>
        </div>
    )
}

// --- Main Page ---

export default function ActionablesPage() {
    const { teamNames } = useTeams()
    const [allDocs, setAllDocs] = React.useState<DocActionables[]>([])
    const [loading, setLoading] = React.useState(true)
    const [viewTab, setViewTab] = React.useState<ViewTab>("all")

    // Global deadline (header bar) — defaults to 1 month from now
    const [globalDeadline, setGlobalDeadline] = React.useState(() => {
        const d = new Date(); d.setMonth(d.getMonth() + 1)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    })
    const [globalDeadlineTime, setGlobalDeadlineTime] = React.useState("23:59")
    const [globalDeadlineSaved, setGlobalDeadlineSaved] = React.useState(false)

    // Load persisted global deadline from localStorage (overrides default)
    React.useEffect(() => {
        try {
            const saved = localStorage.getItem("actionables_global_deadline")
            if (saved) {
                const { date, time } = JSON.parse(saved)
                if (date) setGlobalDeadline(date)
                if (time) setGlobalDeadlineTime(time)
            }
        } catch { /* ignore */ }
    }, [])

    const handleSaveGlobalDeadline = () => {
        if (!globalDeadline) { toast.error("Set a date first"); return }
        const today = new Date().toISOString().split("T")[0]
        if (globalDeadline < today) { toast.error("Deadline cannot be in the past"); return }
        localStorage.setItem("actionables_global_deadline", JSON.stringify({ date: globalDeadline, time: globalDeadlineTime }))
        setGlobalDeadlineSaved(true)
        toast.success("Global deadline saved")
        setTimeout(() => setGlobalDeadlineSaved(false), 2000)
    }

    const todayStr = React.useMemo(() => new Date().toISOString().split("T")[0], [])

    // Filters
    const [docFilter, setDocFilter] = React.useState<string>("all")
    const [riskFilter, setRiskFilter] = React.useState<string>("all")
    const [searchQuery, setSearchQuery] = React.useState("")

    // PDF state
    const [pdfDocId, setPdfDocId] = React.useState<string | null>(null)
    const [pdfDocName, setPdfDocName] = React.useState<string>("")
    const [pdfJumpPage, setPdfJumpPage] = React.useState<number | undefined>(undefined)
    const [pdfJumpKey, setPdfJumpKey] = React.useState(0)

    // Selection
    const [selectedItemKey, setSelectedItemKey] = React.useState<string | null>(null)

    // Create form
    const [showCreateForm, setShowCreateForm] = React.useState(false)

    // Resizable splitter
    const [actionSplit, setActionSplit] = React.useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("doc_split_actionables")
            if (saved) return Math.max(15, Math.min(85, Number(saved)))
        }
        return 55
    })
    const actionContainerRef = React.useRef<HTMLDivElement>(null)
    const actionDraggingRef = React.useRef(false)

    const handleSplitMouseDown = React.useCallback(() => {
        actionDraggingRef.current = true
        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
    }, [])

    React.useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!actionDraggingRef.current || !actionContainerRef.current) return
            const rect = actionContainerRef.current.getBoundingClientRect()
            const pct = ((e.clientX - rect.left) / rect.width) * 100
            const clamped = Math.max(15, Math.min(85, pct))
            setActionSplit(clamped)
            localStorage.setItem("doc_split_actionables", String(Math.round(clamped)))
        }
        const onUp = () => {
            if (actionDraggingRef.current) {
                actionDraggingRef.current = false
                document.body.style.cursor = ""
                document.body.style.userSelect = ""
            }
        }
        window.addEventListener("mousemove", onMove)
        window.addEventListener("mouseup", onUp)
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
    }, [])

    // Collapsed teams for by-team view - initialize all teams as collapsed
    const [collapsedTeams, setCollapsedTeams] = React.useState<Set<string>>(() => {
        const allTeams = new Set<string>()
        teamNames.forEach(team => {
            allTeams.add(team)
            allTeams.add(`approved-${team}`)
        })
        allTeams.add(MIXED_TEAM_CLASSIFICATION)
        allTeams.add(`approved-${MIXED_TEAM_CLASSIFICATION}`)
        return allTeams
    })

    const loadAll = React.useCallback(async () => {
        try {
            setLoading(true)
            const results = await fetchAllActionables()
            const docs: DocActionables[] = results
                .filter((r: ActionablesResult) => r.actionables && r.actionables.length > 0)
                .map((r: ActionablesResult) => ({
                    doc_id: r.doc_id,
                    doc_name: r.doc_name || r.doc_id,
                    actionables: r.actionables,
                }))
            setAllDocs(docs)

            if (!pdfDocId && docs.length > 0) {
                setPdfDocId(docs[0].doc_id)
                setPdfDocName(docs[0].doc_name)
            }
        } catch {
            toast.error("Failed to load actionables")
        } finally {
            setLoading(false)
        }
    }, [pdfDocId])

    React.useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleUpdate = React.useCallback(async (docId: string, itemId: string, updates: Record<string, unknown>) => {
        try {
            const updated = await updateActionable(docId, itemId, updates)
            // Merge: original item ← optimistic updates ← API response (authoritative)
            setAllDocs(prev => prev.map(d => {
                if (d.doc_id !== docId) return d
                return {
                    ...d,
                    actionables: d.actionables.map(a => a.id === itemId ? { ...a, ...updates, ...updated } as ActionableItem : a),
                }
            }))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed")
        }
    }, [])

    const handleDelete = React.useCallback(async (docId: string, itemId: string) => {
        try {
            await deleteActionableApi(docId, itemId)
            setAllDocs(prev => prev.map(d => {
                if (d.doc_id !== docId) return d
                return { ...d, actionables: d.actionables.filter(a => a.id !== itemId) }
            }))
            toast.success("Deleted")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed")
        }
    }, [])

    const handleSourceClick = React.useCallback((docId: string, pageNumber: number) => {
        if (pdfDocId !== docId) {
            setPdfDocId(docId)
            const doc = allDocs.find(d => d.doc_id === docId)
            setPdfDocName(doc?.doc_name || docId)
        }
        setPdfJumpPage(pageNumber - 1)
        setPdfJumpKey(k => k + 1)
    }, [pdfDocId, allDocs])

    // Flatten all actionables with doc info (exclude published items — they live in tracker now)
    const allItems = React.useMemo(() => {
        const items: { item: ActionableItem; docId: string; docName: string }[] = []
        for (const doc of allDocs) {
            for (const item of doc.actionables) {
                if (item.published_at) continue // published items belong to tracker, not actionables
                items.push({ item, docId: doc.doc_id, docName: doc.doc_name })
            }
        }
        return items
    }, [allDocs])

    // Filter based on current tab (all / by-team only)
    const filtered = React.useMemo(() => {
        return allItems.filter(({ item, docId }) => {
            if (docFilter !== "all" && docId !== docFilter) return false
            if (riskFilter !== "all" && normalizeRisk(item.modality) !== riskFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                // Include classification in search so "Mixed Team" is searchable
                const classification = getClassification(item)
                const searchable = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.evidence_quote)} ${safeStr(item.workstream)} ${classification}`.toLowerCase()
                if (!searchable.includes(q)) return false
            }
            return true
        })
        // Keep actionables in creation order - no sorting by risk
    }, [allItems, docFilter, riskFilter, searchQuery])

    // Group by team/classification for the "by-team" view
    // Multi-team items are grouped under "Mixed Team" (system-generated classification)
    const byTeam = React.useMemo(() => {
        const teams: Record<string, { item: ActionableItem; docId: string; docName: string }[]> = {}
        for (const entry of filtered) {
            // Use getClassification to determine grouping - multi-team items go to "Mixed Team"
            const classification = getClassification(entry.item)
            if (!teams[classification]) teams[classification] = []
            teams[classification].push(entry)
        }
        return teams
    }, [filtered])

    // Ordered team keys: Mixed Team first (if exists), then regular teams
    const orderedTeamKeys = React.useMemo(() => {
        const keys = Object.keys(byTeam)
        const mixedIndex = keys.indexOf(MIXED_TEAM_CLASSIFICATION)
        if (mixedIndex > -1) {
            // Move Mixed Team to the front
            keys.splice(mixedIndex, 1)
            return [MIXED_TEAM_CLASSIFICATION, ...teamNames.filter(ws => keys.includes(ws)), ...keys.filter(k => !teamNames.includes(k) && k !== MIXED_TEAM_CLASSIFICATION)]
        }
        return [...teamNames.filter(ws => keys.includes(ws)), ...keys.filter(k => !teamNames.includes(k))]
    }, [byTeam, teamNames])

    // Stats (published count comes from allDocs since allItems excludes published)
    const stats = React.useMemo(() => {
        const total = allItems.length
        const approved = allItems.filter(e => e.item.approval_status === "approved").length
        const rejected = allItems.filter(e => e.item.approval_status === "rejected").length
        const pending = total - approved - rejected
        let published = 0
        for (const doc of allDocs) {
            for (const item of doc.actionables) {
                if (item.published_at) published++
            }
        }
        return { total, approved, rejected, pending, published }
    }, [allItems, allDocs])

    const pdfUrl = pdfDocId ? `${API_BASE_URL}/documents/${pdfDocId}/raw` : null

    // Handlers for bulk actions — approve & publish directly to tracker
    const handleApproveAll = React.useCallback(async (items: { item: ActionableItem; docId: string }[]) => {
        const pending = items.filter(e => e.item.approval_status === "pending")
        if (pending.length === 0) { toast.info("No pending items to approve"); return }
        const globalDl = globalDeadline ? `${globalDeadline}T${globalDeadlineTime || "23:59"}` : ""
        // Check if any item lacks both individual and global deadline
        const noDeadline = pending.filter(({ item }) => !item.deadline && !globalDl)
        if (noDeadline.length > 0) {
            toast.error("Set a global deadline first — some items have no individual deadline")
            return
        }
        await Promise.all(pending.map(({ item, docId }) => {
            const dl = item.deadline || globalDl
            return handleUpdate(docId, item.id, {
                approval_status: "approved",
                published_at: new Date().toISOString(),
                deadline: dl,
                task_status: "assigned",
            })
        }))
        toast.success(`Approved & sent ${pending.length} actionables to tracker`)
    }, [handleUpdate, globalDeadline, globalDeadlineTime])

    const toggleTeam = (team: string) => {
        setCollapsedTeams(prev => {
            const next = new Set(prev)
            if (next.has(team)) next.delete(team); else next.add(team)
            return next
        })
    }

    // Group by document
    const byDocument = React.useMemo(() => {
        const docs: Record<string, { docName: string; entries: { item: ActionableItem; docId: string; docName: string }[] }> = {}
        for (const entry of filtered) {
            if (!docs[entry.docId]) docs[entry.docId] = { docName: entry.docName, entries: [] }
            docs[entry.docId].entries.push(entry)
        }
        return docs
    }, [filtered])

    // Initialize all docs and teams as collapsed by default
    const [collapsedDocs, setCollapsedDocs] = React.useState<Set<string>>(() => {
        const allDocIds = new Set<string>()
        for (const doc of allDocs) {
            allDocIds.add(doc.doc_id)
            allDocIds.add(`approved-${doc.doc_id}`)
        }
        return allDocIds
    })
    const toggleDoc = (docId: string) => {
        setCollapsedDocs(prev => {
            const next = new Set(prev)
            if (next.has(docId)) next.delete(docId); else next.add(docId)
            return next
        })
    }

    // Pending vs Approved splits
    const [approvedCollapsed, setApprovedCollapsed] = React.useState(true)

    const pendingItems = React.useMemo(() => filtered.filter(e => e.item.approval_status !== "approved"), [filtered])
    const approvedItems = React.useMemo(() => {
        const items = filtered.filter(e => e.item.approval_status === "approved")
        // Sort by approval date descending so recently approved appear at top
        return items.sort((a, b) => {
            const aDate = (a.item as any).approved_at || a.item.published_at || ""
            const bDate = (b.item as any).approved_at || b.item.published_at || ""
            return bDate.localeCompare(aDate)
        })
    }, [filtered])

    return (
        <RoleRedirect>
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
                            <Shield className="h-4 w-4 text-primary" />
                            Actionables
                        </h1>
                        <div className="flex items-center gap-1 ml-2">
                            <button
                                onClick={() => setViewTab("all")}
                                className={cn(
                                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                                    viewTab === "all" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setViewTab("by-doc")}
                                className={cn(
                                    "px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1",
                                    viewTab === "by-doc" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <FileText className="h-3 w-3" />
                                By Document
                            </button>
                            <button
                                onClick={() => setViewTab("by-team")}
                                className={cn(
                                    "px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1",
                                    viewTab === "by-team" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Users className="h-3 w-3" />
                                By Team
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                            <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">{stats.total} total</span>
                            <span className="px-2 py-0.5 rounded bg-yellow-400/10 text-yellow-400 font-mono">{stats.pending} pending</span>
                            <span className="px-2 py-0.5 rounded bg-blue-400/10 text-blue-400 font-mono">{stats.published} in tracker</span>
                        </div>
                    </div>
                </div>

                {/* Body: split pane */}
                <div ref={actionContainerRef} className="flex-1 flex min-h-0">
                    {/* Left: Actionables list */}
                    <div style={{ width: `${actionSplit}%` }} className="min-w-0 border-r border-border flex flex-col min-h-0 shrink-0">
                        {/* Filters bar */}
                        <div className="shrink-0 border-b border-border/40 px-4 py-2.5 flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-2 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                                <input
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Search actionables..."
                                    className="w-full bg-muted/30 text-xs rounded-md pl-7 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                />
                            </div>
                            <select
                                value={docFilter}
                                onChange={e => setDocFilter(e.target.value)}
                                className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground max-w-[140px]"
                            >
                                <option value="all">All documents</option>
                                {allDocs.map(d => (
                                    <option key={d.doc_id} value={d.doc_id}>{d.doc_name}</option>
                                ))}
                            </select>
                            <select
                                value={riskFilter}
                                onChange={e => setRiskFilter(e.target.value)}
                                className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                            >
                                <option value="all">All risk</option>
                                {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {/* Approve All button */}
                            {viewTab === "all" && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 gap-1 px-2 text-xs text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                                    onClick={() => handleApproveAll(filtered)}
                                >
                                    <Check className="h-3 w-3" />
                                    Approve All
                                </Button>
                            )}
                        </div>

                        {/* Global Deadline bar - full width layout */}
                        <div className="shrink-0 border-b border-border/40 px-4 py-3">
                            <div className="flex items-center gap-2 mb-2">
                                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-xs font-semibold text-foreground">Set Global Deadline</span>
                                <span className="text-xs text-muted-foreground/50">
                                    Applies to items without individual deadlines
                                </span>
                            </div>
                            <div className="flex items-center gap-3 w-full">
                                <input
                                    type="date"
                                    value={globalDeadline}
                                    min={todayStr}
                                    onChange={e => setGlobalDeadline(e.target.value)}
                                    className="flex-1 bg-muted/30 text-xs rounded-md px-3 py-2 border border-border/40 focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                />
                                <input
                                    type="time"
                                    value={globalDeadlineTime}
                                    onChange={e => setGlobalDeadlineTime(e.target.value)}
                                    className="w-28 bg-muted/30 text-xs rounded-md px-3 py-2 border border-border/40 focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                />
                                <button
                                    onClick={handleSaveGlobalDeadline}
                                    disabled={!globalDeadline}
                                    className={cn(
                                        "flex items-center gap-1.5 text-xs px-4 py-2 rounded-md font-medium transition-colors shrink-0",
                                        globalDeadlineSaved
                                            ? "bg-emerald-500/15 text-emerald-500"
                                            : globalDeadline
                                                ? "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                                                : "bg-muted/40 text-muted-foreground/30 cursor-not-allowed"
                                    )}
                                >
                                    <Save className="h-3.5 w-3.5" />
                                    {globalDeadlineSaved ? "Saved" : "Save"}
                                </button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 px-3 text-xs"
                                    onClick={() => setShowCreateForm(true)}
                                    disabled={allDocs.length === 0}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add
                                </Button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {loading && (
                                <div className="flex items-center justify-center py-20 text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                    <span className="text-xs">Loading actionables...</span>
                                </div>
                            )}

                            {!loading && allDocs.length === 0 && (
                                <EmptyState
                                    icon={<Shield className="h-8 w-8 text-muted-foreground" />}
                                    title="No actionables yet"
                                    description="Extract actionables from a document first, or add them manually."
                                    className="py-20"
                                />
                            )}

                            {showCreateForm && allDocs.length > 0 && (
                                <CreateActionableForm
                                    docId={docFilter !== "all" ? docFilter : allDocs[0].doc_id}
                                    docName={docFilter !== "all" ? (allDocs.find(d => d.doc_id === docFilter)?.doc_name || "") : allDocs[0].doc_name}
                                    allDocs={allDocs}
                                    onCreated={() => { setShowCreateForm(false); loadAll() }}
                                    onCancel={() => setShowCreateForm(false)}
                                />
                            )}

                            {/* ========== ALL THREE TABS wrapped in Pending / Approved sections ========== */}
                            {!loading && (viewTab === "all" || viewTab === "by-doc" || viewTab === "by-team") && (
                                <>
                                    {/* ---- Pending entries (no collapsible pill) ---- */}
                                    {pendingItems.length > 0 && (
                                        <div className="space-y-2">
                                            {viewTab === "all" && pendingItems.map(({ item, docId, docName }) => (
                                                <ActionableCard
                                                    key={`${docId}-${item.id}`}
                                                    item={item}
                                                    docId={docId}
                                                    docName={docName}
                                                    onUpdate={handleUpdate}
                                                    onDelete={handleDelete}
                                                    onSourceClick={handleSourceClick}
                                                    isSelected={selectedItemKey === `${docId}-${item.id}`}
                                                    onSelect={() => {
                                                        setSelectedItemKey(`${docId}-${item.id}`)
                                                        if (pdfDocId !== docId) { setPdfDocId(docId); setPdfDocName(docName) }
                                                    }}
                                                    globalDeadline={globalDeadline}
                                                    globalDeadlineTime={globalDeadlineTime}
                                                />
                                            ))}

                                            {viewTab === "by-doc" && Object.entries(byDocument).map(([docId, { docName, entries }]) => {
                                                const pendingEntries = entries.filter(e => e.item.approval_status !== "approved")
                                                if (pendingEntries.length === 0) return null
                                                const isCollapsed = collapsedDocs.has(docId)
                                                return (
                                                    <div key={docId} className="border border-border/30 rounded-lg">
                                                        <div className="px-3 py-1.5 bg-muted/40 border-b border-border/30 text-xs font-semibold text-muted-foreground flex items-center gap-2 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => toggleDoc(docId)}>
                                                            {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                                            <FileText className="h-3 w-3" /> {docName}
                                                            <span className="ml-auto text-xs text-muted-foreground/60">{pendingEntries.length} pending</span>
                                                        </div>
                                                        {!isCollapsed && (
                                                        <div className="p-2 space-y-2">
                                                            {pendingEntries.map(({ item }) => (
                                                                <ActionableCard
                                                                    key={`${docId}-${item.id}`}
                                                                    item={item}
                                                                    docId={docId}
                                                                    docName={docName}
                                                                    onUpdate={handleUpdate}
                                                                    onDelete={handleDelete}
                                                                    onSourceClick={handleSourceClick}
                                                                    isSelected={selectedItemKey === `${docId}-${item.id}`}
                                                                    onSelect={() => {
                                                                        setSelectedItemKey(`${docId}-${item.id}`)
                                                                        if (pdfDocId !== docId) { setPdfDocId(docId); setPdfDocName(docName) }
                                                                    }}
                                                                    globalDeadline={globalDeadline}
                                                                    globalDeadlineTime={globalDeadlineTime}
                                                                />
                                                            ))}
                                                        </div>
                                                        )}
                                                    </div>
                                                )
                                            })}

                                            {viewTab === "by-team" && Object.entries(byTeam).map(([team, entries]) => {
                                                const pendingEntries = entries.filter(e => e.item.approval_status !== "approved")
                                                if (pendingEntries.length === 0) return null
                                                const isCollapsed = collapsedTeams.has(team)
                                                return (
                                                    <div key={team} className="border border-border/30 rounded-lg">
                                                        <div className="px-3 py-1.5 bg-muted/40 border-b border-border/30 text-xs font-semibold flex items-center gap-2 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => toggleTeam(team)}>
                                                            {isCollapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                                                            <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", getWorkstreamClass(team))}>{team}</span>
                                                            <span className="ml-auto text-xs text-muted-foreground/60">{pendingEntries.length} pending</span>
                                                        </div>
                                                        {!isCollapsed && (
                                                        <div className="p-2 space-y-2">
                                                            {pendingEntries.map(({ item, docId, docName }) => (
                                                                <ActionableCard
                                                                    key={`${docId}-${item.id}`}
                                                                    item={item}
                                                                    docId={docId}
                                                                    docName={docName}
                                                                    onUpdate={handleUpdate}
                                                                    onDelete={handleDelete}
                                                                    onSourceClick={handleSourceClick}
                                                                    isSelected={selectedItemKey === `${docId}-${item.id}`}
                                                                    onSelect={() => {
                                                                        setSelectedItemKey(`${docId}-${item.id}`)
                                                                        if (pdfDocId !== docId) { setPdfDocId(docId); setPdfDocName(docName) }
                                                                    }}
                                                                    globalDeadline={globalDeadline}
                                                                    globalDeadlineTime={globalDeadlineTime}
                                                                />
                                                            ))}
                                                        </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}

                                    {/* ---- APPROVED section ---- */}
                                    {approvedItems.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setApprovedCollapsed(!approvedCollapsed)}>
                                                {approvedCollapsed
                                                    ? <ChevronRight className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                                    : <ChevronDown className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                                }
                                                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Approved ({approvedItems.length})</p>
                                                <div className="h-px bg-emerald-400/20 flex-1" />
                                            </div>
                                            {!approvedCollapsed && (
                                                <div className="space-y-2">
                                                    {/* All tab — approved */}
                                                    {viewTab === "all" && approvedItems.map(({ item, docId, docName }) => (
                                                        <ActionableCard
                                                            key={`${docId}-${item.id}`}
                                                            item={item}
                                                            docId={docId}
                                                            docName={docName}
                                                            onUpdate={handleUpdate}
                                                            onDelete={handleDelete}
                                                            onSourceClick={handleSourceClick}
                                                            isSelected={selectedItemKey === `${docId}-${item.id}`}
                                                            onSelect={() => {
                                                                setSelectedItemKey(`${docId}-${item.id}`)
                                                                if (pdfDocId !== docId) { setPdfDocId(docId); setPdfDocName(docName) }
                                                            }}
                                                            globalDeadline={globalDeadline}
                                                            globalDeadlineTime={globalDeadlineTime}
                                                        />
                                                    ))}

                                                    {/* By Document tab — approved */}
                                                    {viewTab === "by-doc" && Object.entries(byDocument).map(([docId, { docName, entries }]) => {
                                                        const approvedEntries = entries.filter(e => e.item.approval_status === "approved")
                                                        if (approvedEntries.length === 0) return null
                                                        const isCollapsed = collapsedDocs.has(`approved-${docId}`)
                                                        return (
                                                            <div key={docId} className="space-y-1.5">
                                                                <div className="flex items-center gap-2 pt-2 pb-1 cursor-pointer" onClick={() => toggleDoc(`approved-${docId}`)}>
                                                                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                                                    <FileText className="h-3.5 w-3.5 text-emerald-500/60 shrink-0" />
                                                                    <span className="text-xs font-semibold text-foreground/70 truncate">{docName}</span>
                                                                    <span className="text-xs text-muted-foreground/40 font-mono">{approvedEntries.length}</span>
                                                                    <div className="h-px bg-border/30 flex-1" />
                                                                </div>
                                                                {!isCollapsed && approvedEntries.map(({ item, docId: dId, docName: dName }) => (
                                                                    <ActionableCard key={`${dId}-${item.id}`} item={item} docId={dId} docName={dName} onUpdate={handleUpdate} onDelete={handleDelete} onSourceClick={handleSourceClick} isSelected={selectedItemKey === `${dId}-${item.id}`} onSelect={() => { setSelectedItemKey(`${dId}-${item.id}`); if (pdfDocId !== dId) { setPdfDocId(dId); setPdfDocName(dName) } }} globalDeadline={globalDeadline} globalDeadlineTime={globalDeadlineTime} />
                                                                ))}
                                                            </div>
                                                        )
                                                    })}

                                                    {/* By Team tab — approved (using orderedTeamKeys for proper ordering) */}
                                                    {viewTab === "by-team" && orderedTeamKeys.map(team => {
                                                        const entries = byTeam[team] || []
                                                        const approvedEntries = entries.filter(e => e.item.approval_status === "approved")
                                                        if (approvedEntries.length === 0) return null
                                                        const isCollapsed = collapsedTeams.has(`approved-${team}`)
                                                        return (
                                                            <div key={team} className="space-y-1.5">
                                                                <div className="flex items-center gap-2 pt-2 pb-1 cursor-pointer" onClick={() => toggleTeam(`approved-${team}`)}>
                                                                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                                                    <span className={cn("px-2 py-0.5 rounded text-xs font-semibold opacity-70", getWorkstreamClass(team))}>{team}</span>
                                                                    <span className="text-xs text-muted-foreground/40 font-mono">{approvedEntries.length}</span>
                                                                    <div className="h-px bg-border/30 flex-1" />
                                                                </div>
                                                                {!isCollapsed && approvedEntries.map(({ item, docId, docName }) => (
                                                                    <ActionableCard key={`${docId}-${item.id}`} item={item} docId={docId} docName={docName} onUpdate={handleUpdate} onDelete={handleDelete} onSourceClick={handleSourceClick} isSelected={selectedItemKey === `${docId}-${item.id}`} onSelect={() => { setSelectedItemKey(`${docId}-${item.id}`); if (pdfDocId !== docId) { setPdfDocId(docId); setPdfDocName(docName) } }} globalDeadline={globalDeadline} globalDeadlineTime={globalDeadlineTime} />
                                                                ))}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            {!loading && filtered.length === 0 && allDocs.length > 0 && (
                                <div className="text-center text-xs text-muted-foreground/60 py-12">
                                    No actionables match the current filters
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Drag Handle */}
                    <div
                        onMouseDown={handleSplitMouseDown}
                        className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors relative group"
                    >
                        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
                    </div>

                    {/* Right: PDF viewer */}
                    <div className="flex-1 min-w-0 flex flex-col min-h-0">
                        {pdfUrl && (
                            <div className="h-11 border-b border-border flex items-center px-4 justify-between shrink-0 bg-background">
                                <div className="flex items-center gap-2 min-w-0">
                                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    <span className="text-xs font-medium text-foreground truncate">
                                        {pdfDocName || pdfDocId}
                                    </span>
                                </div>
                                {allDocs.length > 1 && (
                                    <select
                                        value={pdfDocId || ""}
                                        onChange={e => {
                                            setPdfDocId(e.target.value)
                                            const doc = allDocs.find(d => d.doc_id === e.target.value)
                                            setPdfDocName(doc?.doc_name || e.target.value)
                                        }}
                                        className="bg-muted/30 text-xs rounded px-2 py-1 border border-border/40 focus:border-border focus:outline-none text-foreground max-w-[180px]"
                                    >
                                        {allDocs.map(d => (
                                            <option key={d.doc_id} value={d.doc_id}>{d.doc_name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        )}
                        <div className="flex-1 min-h-0 overflow-hidden">
                            {pdfUrl ? (
                                <PdfViewer fileUrl={pdfUrl} jumpToPage={pdfJumpPage} jumpKey={pdfJumpKey} className="h-full w-full" />
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
                                    No document selected
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
        </RoleRedirect>
    )
}
