"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import dynamic from "next/dynamic"
import {
    fetchAllActionables,
    updateActionable,
    createManualActionable,
    deleteActionable as deleteActionableApi,
} from "@/lib/api"
import {
    ActionableItem,
    ActionablesResult,
    ActionableModality,
    ActionableWorkstream,
    getClassification,
    MIXED_TEAM_CLASSIFICATION,
    isMultiTeam,
} from "@/lib/types"
import {
    Shield,
    Check, X, Loader2, Plus, FileText, Search,
    ChevronDown, ChevronRight, Pencil,
    Trash2, Users, Save, Undo2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { RoleRedirect } from "@/components/auth/role-redirect"
import {
    safeStr, normalizeRisk,
    RISK_STYLES, RISK_OPTIONS, WORKSTREAM_COLORS, getWorkstreamClass,
} from "@/lib/status-config"
import { useTeams } from "@/lib/use-teams"
import { RiskIcon } from "@/components/shared/status-components"

const PdfViewer = dynamic(
    () => import("@/components/views/pdf-viewer").then(mod => mod.PdfViewer),
    { ssr: false }
)

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/backend"

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
                <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">{label}</p>
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
                <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">{label}</p>
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
                <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">{label}</p>
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
            <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">{label}</p>
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

function ActionableCard({ item, docId, docName, onUpdate, onDelete, onSourceClick, isSelected, onSelect }: {
    item: ActionableItem
    docId: string
    docName: string
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    onDelete: (docId: string, itemId: string) => Promise<void>
    onSourceClick: (docId: string, pageNumber: number) => void
    isSelected: boolean
    onSelect: () => void
}) {
    const { teamNames } = useTeams()
    const [expanded, setExpanded] = React.useState(false)
    const [saving, setSaving] = React.useState(false)

    const handleFieldSave = async (field: string, value: unknown) => {
        setSaving(true)
        try {
            await onUpdate(docId, item.id, { [field]: value })
        } finally {
            setSaving(false)
        }
    }

    const handleApprove = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onUpdate(docId, item.id, { approval_status: "approved" })
    }

    const handleReject = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onUpdate(docId, item.id, { approval_status: "rejected" })
    }

    const handleRevert = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onUpdate(docId, item.id, { approval_status: "pending", published_at: "" })
    }

    const handleSourceClick = () => {
        const match = item.source_location?.match(/p\.?\s*(\d+)/)
        if (match) {
            onSourceClick(docId, parseInt(match[1], 10))
        }
    }

    return (
        <div
            className={cn(
                "border rounded-lg overflow-hidden transition-all",
                isSelected ? "border-primary/50 ring-1 ring-primary/20" : "border-border/30",
                item.approval_status === "approved" && "border-emerald-500/20",
                item.approval_status === "rejected" && "border-red-500/20 opacity-60",
            )}
        >
            {/* Header row: Team → Risk → Text → Buttons */}
            <div className="flex items-center gap-1.5 px-3 py-2 hover:bg-muted/20 transition-colors">
                <button onClick={() => { setExpanded(!expanded); onSelect() }} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}

                    {/* Team tag - shows "Mixed Team Projects" when multiple teams selected (live switch) */}
                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0", getWorkstreamClass(getClassification(item)))}>
                        {getClassification(item)}
                    </span>

                    {/* Risk icon */}
                    <RiskIcon modality={item.modality} />

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
                            <button onClick={handleApprove} className="p-1 rounded hover:bg-emerald-400/10 text-muted-foreground/40 hover:text-emerald-400 transition-colors" title="Approve">
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
                        "text-[9px] px-1.5 py-0.5 rounded font-medium ml-1",
                        item.approval_status === "approved" ? "text-emerald-400 bg-emerald-400/10" :
                        item.approval_status === "rejected" ? "text-red-400 bg-red-400/10" :
                        "text-yellow-400 bg-yellow-400/10"
                    )}>
                        {item.approval_status === "approved" ? "Approved" : item.approval_status === "rejected" ? "Rejected" : "Pending"}
                    </span>
                </div>
            </div>

            {/* Expanded details: Implementation, Evidence, Team */}
            {expanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-border/20 pt-2.5">
                    {saving && (
                        <div className="flex items-center gap-1.5 text-[10px] text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                        </div>
                    )}

                    {item.approval_status === "approved" ? (
                        <>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">Implementation</p>
                                <p className="text-xs text-foreground/80">{safeStr(item.implementation_notes) || "—"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">Evidence</p>
                                <p className="text-xs text-foreground/80 italic">{safeStr(item.evidence_quote) || "—"}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">Team{(item.assigned_teams?.length ?? 0) > 1 ? "s" : ""}</p>
                                    <div className="flex flex-wrap gap-1">
                                        {((item.assigned_teams?.length ?? 0) > 1 ? item.assigned_teams! : [item.workstream]).map(t => (
                                            <span key={t} className={cn("inline-block px-2 py-0.5 rounded text-xs font-medium", getWorkstreamClass(t))}>{t}</span>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/60 mb-0.5">Risk Level</p>
                                    <span className={cn("inline-block px-2 py-0.5 rounded text-xs font-medium", RISK_STYLES[normalizeRisk(item.modality)]?.bg || "bg-muted/40", RISK_STYLES[normalizeRisk(item.modality)]?.text || "text-foreground")}>{normalizeRisk(item.modality)}</span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Single-team: Show single implementation/evidence block */}
                            {!isMultiTeam(item) && (
                                <>
                                    <EditableField label="Implementation" value={item.implementation_notes} onSave={v => handleFieldSave("implementation_notes", v)} type="textarea" />
                                    <EditableField label="Evidence" value={item.evidence_quote} onSave={v => handleFieldSave("evidence_quote", v)} type="textarea" />
                                </>
                            )}

                            {/* Multi-team: Show per-team implementation blocks */}
                            {isMultiTeam(item) && (
                                <div className="space-y-3">
                                    <p className="text-[10px] font-medium text-muted-foreground/60 flex items-center gap-1">
                                        <Users className="h-3 w-3" />
                                        Per-Team Implementation
                                    </p>
                                    {item.assigned_teams!.map(team => {
                                        const tw = item.team_workflows?.[team]
                                        const teamColors = WORKSTREAM_COLORS[team] || WORKSTREAM_COLORS.Other
                                        return (
                                            <div key={team} className={cn("border rounded-lg p-3 space-y-2", teamColors.bg)}>
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", teamColors.bg, teamColors.text)}>
                                                        {team}
                                                    </span>
                                                </div>
                                                <EditableField 
                                                    label="Implementation" 
                                                    value={tw?.implementation_notes || item.implementation_notes} 
                                                    onSave={async v => {
                                                        const workflows = { ...(item.team_workflows || {}) }
                                                        workflows[team] = { ...(workflows[team] || { task_status: "assigned" }), implementation_notes: v }
                                                        await onUpdate(docId, item.id, { team_workflows: workflows })
                                                    }} 
                                                    type="textarea" 
                                                />
                                                <EditableField 
                                                    label="Evidence" 
                                                    value={tw?.evidence_quote || item.evidence_quote} 
                                                    onSave={async v => {
                                                        const workflows = { ...(item.team_workflows || {}) }
                                                        workflows[team] = { ...(workflows[team] || { task_status: "assigned" }), evidence_quote: v }
                                                        await onUpdate(docId, item.id, { team_workflows: workflows })
                                                    }} 
                                                    type="textarea" 
                                                />
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Team multi-select */}
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/60 mb-1 flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    Assign Teams
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {teamNames.map(team => {
                                        const isSelected = team === item.workstream || (item.assigned_teams || []).includes(team)
                                        const teamColors = WORKSTREAM_COLORS[team] || WORKSTREAM_COLORS.Other
                                        return (
                                            <button
                                                key={team}
                                                onClick={async () => {
                                                    const current = (item.assigned_teams?.length ?? 0) > 1 ? [...item.assigned_teams!] : [item.workstream]
                                                    let next: string[]
                                                    if (current.includes(team)) {
                                                        // Don't allow deselecting the last team
                                                        if (current.length <= 1) return
                                                        next = current.filter(t => t !== team)
                                                    } else {
                                                        next = [...current, team]
                                                    }
                                                    // First team becomes workstream
                                                    const updates: Record<string, unknown> = { workstream: next[0] }
                                                    if (next.length > 1) {
                                                        updates.assigned_teams = next
                                                    } else {
                                                        updates.assigned_teams = []
                                                    }
                                                    setSaving(true)
                                                    try {
                                                        await onUpdate(docId, item.id, updates)
                                                    } finally {
                                                        setSaving(false)
                                                    }
                                                }}
                                                className={cn(
                                                    "text-[10px] px-2 py-1 rounded-md border transition-colors font-medium",
                                                    isSelected
                                                        ? `${teamColors.bg} ${teamColors.text} border-current`
                                                        : "border-border/40 text-muted-foreground/60 hover:border-border hover:text-foreground/80"
                                                )}
                                            >
                                                {team}
                                            </button>
                                        )
                                    })}
                                </div>
                                {isMultiTeam(item) && (
                                    <p className="text-[9px] text-amber-400 mt-1">
                                        Classification: {MIXED_TEAM_CLASSIFICATION} — Each team has separate implementation
                                    </p>
                                )}
                            </div>

                            {/* Risk Level */}
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/60 mb-1">Risk Level</p>
                                <select
                                    value={normalizeRisk(item.modality)}
                                    onChange={e => handleFieldSave("modality", e.target.value)}
                                    className={cn(
                                        "w-full text-xs rounded-md px-2.5 py-1.5 border border-dashed border-border hover:border-primary/50 focus:border-primary focus:outline-none cursor-pointer transition-colors font-medium",
                                        RISK_STYLES[normalizeRisk(item.modality)]?.bg || "bg-muted/40",
                                        RISK_STYLES[normalizeRisk(item.modality)]?.text || "text-foreground"
                                    )}
                                >
                                    {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                        </>
                    )}

                    {/* Footer: source + actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-border/10">
                        <div className="flex items-center gap-3">
                            <button onClick={handleSourceClick} className="text-[10px] text-primary hover:underline flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {item.source_location || "No source"}
                            </button>
                            <span className="text-[10px] text-muted-foreground/40">{docName}</span>
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
                <label className="text-[10px] font-medium text-muted-foreground/60 block mb-0.5">Document *</label>
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
                <label className="text-[10px] font-medium text-muted-foreground/60 block mb-0.5">Actionable *</label>
                <input value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} placeholder="Describe the actionable..." className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-[10px] font-medium text-muted-foreground/60 block mb-0.5">Risk Level</label>
                    <select value={form.modality} onChange={e => setForm(f => ({ ...f, modality: e.target.value as ActionableModality }))} className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground">
                        {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-[10px] font-medium text-muted-foreground/60 block mb-0.5">Team</label>
                    <select value={form.workstream} onChange={e => setForm(f => ({ ...f, workstream: e.target.value as ActionableWorkstream }))} className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground">
                        {teamNames.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>
            </div>

            <div>
                <label className="text-[10px] font-medium text-muted-foreground/60 block mb-0.5">Implementation Details</label>
                <textarea value={form.implementation_notes} onChange={e => setForm(f => ({ ...f, implementation_notes: e.target.value }))} rows={3} className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none resize-none" />
            </div>

            <div>
                <label className="text-[10px] font-medium text-muted-foreground/60 block mb-0.5">Evidence</label>
                <textarea value={form.evidence_quote} onChange={e => setForm(f => ({ ...f, evidence_quote: e.target.value }))} rows={2} className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none resize-none" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-[12px]">Cancel</Button>
                <Button size="sm" onClick={handleSubmit} disabled={creating} className="h-7 text-[12px] gap-1.5">
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

    // Collapsed teams for by-team view
    const [collapsedTeams, setCollapsedTeams] = React.useState<Set<string>>(new Set())

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
        const ro: Record<string, number> = { "High Risk": 0, "Medium Risk": 1, "Low Risk": 2 }
        return allItems.filter(({ item, docId }) => {
            if (docFilter !== "all" && docId !== docFilter) return false
            if (riskFilter !== "all" && normalizeRisk(item.modality) !== riskFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                // Include classification in search so "Mixed Team Projects" is searchable
                const classification = getClassification(item)
                const searchable = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.evidence_quote)} ${safeStr(item.workstream)} ${classification}`.toLowerCase()
                if (!searchable.includes(q)) return false
            }
            return true
        }).sort((a, b) => (ro[normalizeRisk(a.item.modality)] ?? 1) - (ro[normalizeRisk(b.item.modality)] ?? 1))
    }, [allItems, docFilter, riskFilter, searchQuery])

    // Group by team/classification for the "by-team" view
    // Multi-team items are grouped under "Mixed Team Projects" (system-generated classification)
    const byTeam = React.useMemo(() => {
        const teams: Record<string, { item: ActionableItem; docId: string; docName: string }[]> = {}
        for (const entry of filtered) {
            // Use getClassification to determine grouping - multi-team items go to "Mixed Team Projects"
            const classification = getClassification(entry.item)
            if (!teams[classification]) teams[classification] = []
            teams[classification].push(entry)
        }
        return teams
    }, [filtered])

    // Ordered team keys: Mixed Team Projects first (if exists), then regular teams
    const orderedTeamKeys = React.useMemo(() => {
        const keys = Object.keys(byTeam)
        const mixedIndex = keys.indexOf(MIXED_TEAM_CLASSIFICATION)
        if (mixedIndex > -1) {
            // Move Mixed Team Projects to the front
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

    const pdfUrl = pdfDocId ? `${API_BASE}/documents/${pdfDocId}/raw` : null

    // Handlers for bulk actions
    const handleApproveAll = React.useCallback(async (items: { item: ActionableItem; docId: string }[]) => {
        const pending = items.filter(e => e.item.approval_status === "pending")
        if (pending.length === 0) { toast.info("No pending items to approve"); return }
        await Promise.all(pending.map(({ item, docId }) => handleUpdate(docId, item.id, { approval_status: "approved" })))
        toast.success(`Approved ${pending.length} actionables`)
    }, [handleUpdate])

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

    const [collapsedDocs, setCollapsedDocs] = React.useState<Set<string>>(new Set())
    const toggleDoc = (docId: string) => {
        setCollapsedDocs(prev => {
            const next = new Set(prev)
            if (next.has(docId)) next.delete(docId); else next.add(docId)
            return next
        })
    }

    // Pending vs Approved splits
    const [pendingCollapsed, setPendingCollapsed] = React.useState(false)
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
                        <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Shield className="h-4 w-4 text-primary" />
                            Actionables
                        </h1>
                        <div className="flex items-center gap-1 ml-2">
                            <button
                                onClick={() => setViewTab("all")}
                                className={cn(
                                    "px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
                                    viewTab === "all" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setViewTab("by-doc")}
                                className={cn(
                                    "px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1",
                                    viewTab === "by-doc" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <FileText className="h-3 w-3" />
                                By Document
                            </button>
                            <button
                                onClick={() => setViewTab("by-team")}
                                className={cn(
                                    "px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1",
                                    viewTab === "by-team" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Users className="h-3 w-3" />
                                By Team
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-[10px]">
                            <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">{stats.total} total</span>
                            <span className="px-2 py-0.5 rounded bg-emerald-400/10 text-emerald-400 font-mono">{stats.approved} approved</span>
                            <span className="px-2 py-0.5 rounded bg-yellow-400/10 text-yellow-400 font-mono">{stats.pending} pending</span>
                            <span className="px-2 py-0.5 rounded bg-blue-400/10 text-blue-400 font-mono">{stats.published} published</span>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 px-2.5 text-[12px]"
                            onClick={() => setShowCreateForm(true)}
                            disabled={allDocs.length === 0}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add
                        </Button>
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
                                    className="h-7 gap-1 px-2 text-[11px] text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                                    onClick={() => handleApproveAll(filtered)}
                                >
                                    <Check className="h-3 w-3" />
                                    Approve All
                                </Button>
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {loading && (
                                <div className="flex items-center justify-center py-20 text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                    <span className="text-sm">Loading actionables...</span>
                                </div>
                            )}

                            {!loading && allDocs.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-20 text-center">
                                    <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                                        <Shield className="h-8 w-8 text-muted-foreground" />
                                    </div>
                                    <h3 className="text-sm font-medium mb-1">No actionables yet</h3>
                                    <p className="text-xs text-muted-foreground/60 max-w-sm">
                                        Extract actionables from a document first, or add them manually.
                                    </p>
                                </div>
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
                                    {/* ---- PENDING section ---- */}
                                    {pendingItems.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setPendingCollapsed(!pendingCollapsed)}>
                                                {pendingCollapsed
                                                    ? <ChevronRight className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                                                    : <ChevronDown className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                                                }
                                                <p className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wider">Pending ({pendingItems.length})</p>
                                                <div className="h-px bg-yellow-400/20 flex-1" />
                                            </div>
                                            {!pendingCollapsed && (
                                                <div className="space-y-2">
                                                    {/* All tab — pending */}
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
                                                        />
                                                    ))}

                                                    {/* By Document tab — pending */}
                                                    {viewTab === "by-doc" && Object.entries(byDocument).map(([docId, { docName, entries }]) => {
                                                        const pendingEntries = entries.filter(e => e.item.approval_status !== "approved")
                                                        if (pendingEntries.length === 0) return null
                                                        const isCollapsed = collapsedDocs.has(docId)
                                                        return (
                                                            <div key={docId} className="space-y-1.5">
                                                                <div className="flex items-center gap-2 pt-2 pb-1 cursor-pointer" onClick={() => toggleDoc(docId)}>
                                                                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                                                    <FileText className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                                                                    <span className="text-[11px] font-semibold text-foreground truncate">{docName}</span>
                                                                    <span className="text-[10px] text-muted-foreground/40 font-mono">{pendingEntries.length}</span>
                                                                    <div className="h-px bg-border/30 flex-1" />
                                                                    <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] text-emerald-500 hover:bg-emerald-500/10" onClick={(e) => { e.stopPropagation(); handleApproveAll(pendingEntries) }}>
                                                                        <Check className="h-2.5 w-2.5" /> Approve All
                                                                    </Button>
                                                                </div>
                                                                {!isCollapsed && pendingEntries.map(({ item, docId: dId, docName: dName }) => (
                                                                    <ActionableCard key={`${dId}-${item.id}`} item={item} docId={dId} docName={dName} onUpdate={handleUpdate} onDelete={handleDelete} onSourceClick={handleSourceClick} isSelected={selectedItemKey === `${dId}-${item.id}`} onSelect={() => { setSelectedItemKey(`${dId}-${item.id}`); if (pdfDocId !== dId) { setPdfDocId(dId); setPdfDocName(dName) } }} />
                                                                ))}
                                                            </div>
                                                        )
                                                    })}

                                                    {/* By Team tab — pending (using orderedTeamKeys for proper ordering) */}
                                                    {viewTab === "by-team" && orderedTeamKeys.map(team => {
                                                        const entries = byTeam[team] || []
                                                        const pendingEntries = entries.filter(e => e.item.approval_status !== "approved")
                                                        if (pendingEntries.length === 0) return null
                                                        const isCollapsed = collapsedTeams.has(team)
                                                        return (
                                                            <div key={team} className="space-y-1.5">
                                                                <div className="flex items-center gap-2 pt-2 pb-1 cursor-pointer" onClick={() => toggleTeam(team)}>
                                                                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                                                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", getWorkstreamClass(team))}>{team}</span>
                                                                    <span className="text-[10px] text-muted-foreground/40 font-mono">{pendingEntries.length}</span>
                                                                    <div className="h-px bg-border/30 flex-1" />
                                                                    <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] text-emerald-500 hover:bg-emerald-500/10" onClick={(e) => { e.stopPropagation(); handleApproveAll(pendingEntries) }}>
                                                                        <Check className="h-2.5 w-2.5" /> Approve All
                                                                    </Button>
                                                                </div>
                                                                {!isCollapsed && pendingEntries.map(({ item, docId, docName }) => (
                                                                    <ActionableCard key={`${docId}-${item.id}`} item={item} docId={docId} docName={docName} onUpdate={handleUpdate} onDelete={handleDelete} onSourceClick={handleSourceClick} isSelected={selectedItemKey === `${docId}-${item.id}`} onSelect={() => { setSelectedItemKey(`${docId}-${item.id}`); if (pdfDocId !== docId) { setPdfDocId(docId); setPdfDocName(docName) } }} />
                                                                ))}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
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
                                                <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Approved ({approvedItems.length})</p>
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
                                                                    <span className="text-[11px] font-semibold text-foreground/70 truncate">{docName}</span>
                                                                    <span className="text-[10px] text-muted-foreground/40 font-mono">{approvedEntries.length}</span>
                                                                    <div className="h-px bg-border/30 flex-1" />
                                                                </div>
                                                                {!isCollapsed && approvedEntries.map(({ item, docId: dId, docName: dName }) => (
                                                                    <ActionableCard key={`${dId}-${item.id}`} item={item} docId={dId} docName={dName} onUpdate={handleUpdate} onDelete={handleDelete} onSourceClick={handleSourceClick} isSelected={selectedItemKey === `${dId}-${item.id}`} onSelect={() => { setSelectedItemKey(`${dId}-${item.id}`); if (pdfDocId !== dId) { setPdfDocId(dId); setPdfDocName(dName) } }} />
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
                                                                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold opacity-70", getWorkstreamClass(team))}>{team}</span>
                                                                    <span className="text-[10px] text-muted-foreground/40 font-mono">{approvedEntries.length}</span>
                                                                    <div className="h-px bg-border/30 flex-1" />
                                                                </div>
                                                                {!isCollapsed && approvedEntries.map(({ item, docId, docName }) => (
                                                                    <ActionableCard key={`${docId}-${item.id}`} item={item} docId={docId} docName={docName} onUpdate={handleUpdate} onDelete={handleDelete} onSourceClick={handleSourceClick} isSelected={selectedItemKey === `${docId}-${item.id}`} onSelect={() => { setSelectedItemKey(`${docId}-${item.id}`); if (pdfDocId !== docId) { setPdfDocId(docId); setPdfDocName(docName) } }} />
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
                                <div className="text-center text-sm text-muted-foreground/60 py-12">
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
                                    <span className="text-[12px] font-medium text-foreground truncate">
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
                                        className="bg-muted/30 text-[11px] rounded px-2 py-1 border border-border/40 focus:border-border focus:outline-none text-foreground max-w-[180px]"
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
                                <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
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
