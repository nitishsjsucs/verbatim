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
    setDocumentLikelihood,
    updateDocumentMetadata,
} from "@/lib/api"
import {
    ActionableItem,
    ActionablesResult,
    ActionableModality,
    ActionableWorkstream,
    TeamWorkflow,
    Team,
    RiskSubDropdown,
} from "@/lib/types"
import { useSession } from "@/lib/auth-client"
import { getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import {
    Shield,
    Check, X, Loader2, Plus, FileText, Search,
    ChevronDown, ChevronRight, Pencil,
    Trash2, Users, Save, Undo2, Calendar, Send,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatNumber } from "@/lib/format-number"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { RoleRedirect } from "@/components/auth/role-redirect"
import {
    safeStr,
    WORKSTREAM_COLORS, DEFAULT_WORKSTREAM_COLORS, getWorkstreamClass,
    RESIDUAL_RISK_INTERPRETATION_STYLES, THEME_OPTIONS,
} from "@/lib/status-config"
import { useTeams } from "@/lib/use-teams"
import { DropdownOption, useDropdownConfig } from "@/lib/use-dropdown-config"
import { HierarchicalTeamMultiSelect, HierarchicalTeamSelect } from "@/components/shared/hierarchical-team-selector"
import { EmptyState } from "@/components/shared/status-components"
import { notifyPublished } from "@/lib/notifications-helper"

const PdfViewer = dynamic(
    () => import("@/components/views/pdf-viewer").then(mod => mod.PdfViewer),
    { ssr: false }
)

const FALLBACK_DROPDOWN_OPTIONS: Record<string, DropdownOption[]> = {
    tranche3: [
        { label: "No", value: 0 },
        { label: "Yes", value: 1 },
    ],
    impact_dropdown: [
        { label: "No Significant Impact on occurrence of regulatory breach", value: 1 },
        { label: "Material Impact", value: 2 },
        { label: "Very High Regulatory or Reputational Impact", value: 3 },
    ],
    likelihood_business_volume: [
        { label: "Moderate Increase — Up to 15%", value: 1 },
        { label: "Substantial Increase — Between 15% and 30%", value: 2 },
        { label: "Very High Increase — More than 30%", value: 3 },
    ],
    likelihood_products_processes: [
        { label: "Products/processes rolled out during the year — Less than 4", value: 1 },
        { label: "Products/processes rolled out during the year — Between 4 and 7", value: 2 },
        { label: "Many products rolled out during the year — More than 7", value: 3 },
    ],
    likelihood_compliance_violations: [
        { label: "No violation", value: 1 },
        { label: "1 violation", value: 2 },
        { label: "Greater than 1", value: 3 },
    ],
    control_monitoring: [
        { label: "Automated", value: 1 },
        { label: "Maker-Checker", value: 2 },
        { label: "No Checker / No Control", value: 3 },
    ],
    control_effectiveness: [
        { label: "Well Controlled / Meets Requirements", value: 1 },
        { label: "Improvement Needed", value: 2 },
        { label: "Significant Improvement Needed", value: 3 },
    ],
}

// --- Types ---

interface DocActionables {
    doc_id: string
    doc_name: string
    actionables: ActionableItem[]
    document_likelihood_score?: number
    document_likelihood_breakdown?: {
        business_volume?: RiskSubDropdown
        products_processes?: RiskSubDropdown
        compliance_violations?: RiskSubDropdown
    }
    document_likelihood_updated_at?: string
    document_likelihood_updated_by?: string
    global_likelihood_owner_team?: string
}

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

function ActionableCard({ item, docId, docName, onUpdate, onDelete, onSourceClick, isSelected, onSelect, isChecked, onCheck, docDefaultDeadline, docDefaultDeadlineTime, docDefaultTheme, docDefaultNewProduct, docDefaultLiveDate, callerRole, callerAccountId, callerTeam, docLikelihoodScore }: {
    item: ActionableItem
    docId: string
    docName: string
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    onDelete: (docId: string, itemId: string) => Promise<void>
    onSourceClick: (docId: string, pageNumber: number) => void
    isSelected: boolean
    onSelect: () => void
    isChecked: boolean
    onCheck: () => void
    docDefaultDeadline: string
    docDefaultDeadlineTime: string
    docDefaultTheme: string
    docDefaultNewProduct: string
    docDefaultLiveDate: string
    callerRole: string
    callerAccountId: string
    callerTeam: string
    docLikelihoodScore?: number
}) {
    const isComplianceOfficer = callerRole === "compliance_officer"
    // Likelihood is editable only by the team assigned to this actionable (or any team if unassigned)
    const assignedTeams = item.assigned_teams ?? []
    const canEditLikelihood = !isComplianceOfficer && (assignedTeams.length === 0 || assignedTeams.includes(callerTeam))
    const { teamNames, leafTeamNames } = useTeams()
    const { getOptions, getLabel } = useDropdownConfig()
    const [expanded, setExpanded] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [draftAction, setDraftAction] = React.useState(safeStr(item.action))
    const [draftTranche3, setDraftTranche3] = React.useState(safeStr(item.tranche3) || "No")
    const [draftNewProduct, setDraftNewProduct] = React.useState(safeStr(item.new_product) || docDefaultNewProduct || "No")
    const [draftProductLiveDate, setDraftProductLiveDate] = React.useState(safeStr(item.product_live_date) || docDefaultLiveDate)
    const [draftTheme, setDraftTheme] = React.useState(safeStr(item.theme) || docDefaultTheme)
    // Structured risk sub-dropdowns — each stores {label, score} or empty {}
    const emptyRSD = {} as RiskSubDropdown
    const [draftLikeBV, setDraftLikeBV] = React.useState<RiskSubDropdown>(item.likelihood_business_volume || emptyRSD)
    const [draftLikePP, setDraftLikePP] = React.useState<RiskSubDropdown>(item.likelihood_products_processes || emptyRSD)
    const [draftLikeCV, setDraftLikeCV] = React.useState<RiskSubDropdown>(item.likelihood_compliance_violations || emptyRSD)
    const [draftImpactDD, setDraftImpactDD] = React.useState<RiskSubDropdown>(item.impact_dropdown || emptyRSD)
    const [draftCtrlMon, setDraftCtrlMon] = React.useState<RiskSubDropdown>(item.control_monitoring || emptyRSD)
    const [draftCtrlEff, setDraftCtrlEff] = React.useState<RiskSubDropdown>(item.control_effectiveness || emptyRSD)
    const getSafeOptions = React.useCallback((key: string): DropdownOption[] => {
        const opts = getOptions(key)
        return opts.length ? opts : (FALLBACK_DROPDOWN_OPTIONS[key] || [])
    }, [getOptions])

    // Helper: select a sub-dropdown from config options
    const pickSubDropdown = (configKey: string, selectedLabel: string): RiskSubDropdown => {
        const opt = getSafeOptions(configKey).find(o => o.label === selectedLabel)
        return opt ? { label: opt.label, score: opt.value } : ({} as RiskSubDropdown)
    }
    // Computed scores (reactive, new formulas)
    const safeScore = (d: RiskSubDropdown | undefined) => (d && typeof d.score === "number" ? d.score : 0)
    // OVERALL LIKELIHOOD = MAX of 3 sub-dropdown scores
    const likelihoodScore = Math.max(safeScore(draftLikeBV), safeScore(draftLikePP), safeScore(draftLikeCV))
    // OVERALL IMPACT = (selected impact score)²
    const rawImpact = safeScore(draftImpactDD)
    const impactScore = rawImpact ** 2
    // INHERENT RISK = likelihood × impact
    const inherentRiskScore = likelihoodScore * impactScore
    // OVERALL CONTROL = MAX (worst-case) of 2 sub-dropdown scores
    // For multi-team items, control is stored per-team in team_workflows — aggregate MAX across all teams
    const monScore = safeScore(draftCtrlMon)
    const effScore = safeScore(draftCtrlEff)
    const controlScore = (() => {
        const teams = item.assigned_teams ?? []
        if (teams.length > 1 && item.team_workflows && Object.keys(item.team_workflows).length > 0) {
            const scores: number[] = []
            for (const tw of Object.values(item.team_workflows)) {
                if (!tw || typeof tw !== "object") continue
                const tMon = safeScore((tw as { control_monitoring?: RiskSubDropdown }).control_monitoring)
                const tEff = safeScore((tw as { control_effectiveness?: RiskSubDropdown }).control_effectiveness)
                if (tMon || tEff) scores.push(Math.max(tMon, tEff))
            }
            if (scores.length > 0) return Math.max(...scores)
            // Fall back to pre-computed top-level value
            if (item.control_score && item.control_score > 0) return item.control_score
        }
        return (monScore || effScore) ? Math.max(monScore, effScore) : 0
    })()
    // All 6 risk parameters must be filled for residual to calculate
    const allRiskFilled = !!(draftLikeBV?.label && draftLikePP?.label && draftLikeCV?.label && draftImpactDD?.label && draftCtrlMon?.label && draftCtrlEff?.label)
    // RESIDUAL RISK = inherent risk × control score (only when all params filled)
    const residualRiskScore = allRiskFilled ? inherentRiskScore * controlScore : 0
    const classifyRisk = (score: number) => score <= 0 ? "" : score <= 3 ? "Low" : score <= 9 ? "Medium" : "High"
    const classifyInherentRisk = (score: number) => score <= 0 ? "" : score <= 3 ? "Low" : score <= 6 ? "Medium" : "High"
    const impactLabel = React.useMemo(() => {
        const label = getLabel("impact_dropdown")
        return label.toLowerCase() === "impact_dropdown" ? "Impact Assessment" : label
    }, [getLabel])
    const inherentRiskLabel = classifyInherentRisk(inherentRiskScore)
    const residualRiskLabel = allRiskFilled ? classifyRisk(residualRiskScore) : ""
    const residualRiskInterpretation = !allRiskFilled ? "" : residualRiskScore < 13 ? "Satisfactory (Low)" : residualRiskScore < 28 ? "Improvement Needed (Medium)" : "Weak (High)"
    const autoGrow = React.useCallback((el: HTMLTextAreaElement | null) => {
        if (!el) return
        el.style.height = "auto"
        el.style.height = `${el.scrollHeight}px`
    }, [])

    // --- Draft state: all editable fields are local until Save ---
    const [draftImpl, setDraftImpl] = React.useState(safeStr(item.implementation_notes))
    const [draftEvidence, setDraftEvidence] = React.useState(safeStr(item.evidence_quote))
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
        setDraftAction(safeStr(item.action))
        setDraftImpl(safeStr(item.implementation_notes))
        setDraftEvidence(safeStr(item.evidence_quote))
        setDraftTranche3(safeStr(item.tranche3) || "No")
        setDraftNewProduct(safeStr(item.new_product) || docDefaultNewProduct || "No")
        setDraftProductLiveDate(safeStr(item.product_live_date) || docDefaultLiveDate)
        setDraftTheme(safeStr(item.theme) || docDefaultTheme)
        // Structured risk sub-dropdowns
        setDraftLikeBV(item.likelihood_business_volume || emptyRSD)
        setDraftLikePP(item.likelihood_products_processes || emptyRSD)
        setDraftLikeCV(item.likelihood_compliance_violations || emptyRSD)
        setDraftImpactDD(item.impact_dropdown || emptyRSD)
        setDraftCtrlMon(item.control_monitoring || emptyRSD)
        setDraftCtrlEff(item.control_effectiveness || emptyRSD)
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
    }, [item, docDefaultTheme])

    // Determine if any draft differs from saved
    const subDiffers = (a: RiskSubDropdown | undefined, b: RiskSubDropdown | undefined) => {
        const la = a?.label || "", lb = b?.label || ""
        return la !== lb
    }
    const resolvedTheme = draftTheme || docDefaultTheme || ""

    const isDirty = React.useMemo(() => {
        if (draftAction !== safeStr(item.action)) return true
        if (draftImpl !== safeStr(item.implementation_notes)) return true
        if (draftEvidence !== safeStr(item.evidence_quote)) return true
        if (draftTranche3 !== safeStr(item.tranche3)) return true
        if (draftNewProduct !== (safeStr(item.new_product) || "No")) return true
        if (draftProductLiveDate !== safeStr(item.product_live_date)) return true
        if (resolvedTheme !== safeStr(item.theme)) return true
        // Structured risk sub-dropdowns
        if (subDiffers(draftLikeBV, item.likelihood_business_volume)) return true
        if (subDiffers(draftLikePP, item.likelihood_products_processes)) return true
        if (subDiffers(draftLikeCV, item.likelihood_compliance_violations)) return true
        if (subDiffers(draftImpactDD, item.impact_dropdown)) return true
        if (subDiffers(draftCtrlMon, item.control_monitoring)) return true
        if (subDiffers(draftCtrlEff, item.control_effectiveness)) return true
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
    }, [draftAction, draftImpl, draftEvidence, draftTranche3, draftNewProduct, draftProductLiveDate, draftTheme, draftLikeBV, draftLikePP, draftLikeCV, draftImpactDD, draftCtrlMon, draftCtrlEff, deadlineDate, deadlineTime, draftTeams, draftTeamImpl, teamDeadlineDrafts, item])

    // --- Unified Save: sends all draft changes at once ---
    const handleSaveAll = async () => {
        setSaving(true)
        try {
            const updates: Record<string, unknown> = {}
            // Action text (editable heading)
            if (draftAction !== safeStr(item.action)) updates.action = draftAction
            // Implementation & Evidence (shared/top-level)
            if (draftImpl !== safeStr(item.implementation_notes)) updates.implementation_notes = draftImpl
            if (draftEvidence !== safeStr(item.evidence_quote)) updates.evidence_quote = draftEvidence
            // Risk assessment — structured sub-dropdowns
            if (draftTranche3 !== safeStr(item.tranche3)) updates.tranche3 = draftTranche3
            if (draftNewProduct !== (safeStr(item.new_product) || "No")) updates.new_product = draftNewProduct
            if (draftProductLiveDate !== safeStr(item.product_live_date)) updates.product_live_date = draftProductLiveDate
            // Auto-calculate 6-month expiry whenever new_product or live date changes
            if (draftNewProduct !== (safeStr(item.new_product) || "No") || draftProductLiveDate !== safeStr(item.product_live_date)) {
                if (draftNewProduct === "Yes" && draftProductLiveDate) {
                    const expD = new Date(draftProductLiveDate); expD.setMonth(expD.getMonth() + 6)
                    updates.new_product_expiry = expD.toISOString().split("T")[0]
                } else {
                    updates.new_product_expiry = ""
                }
            }
            if (resolvedTheme !== safeStr(item.theme)) updates.theme = resolvedTheme
            // CO only sets impact_dropdown; members set likelihood + control
            if (isComplianceOfficer) {
                if (subDiffers(draftImpactDD, item.impact_dropdown)) {
                    updates.impact_dropdown = draftImpactDD
                    updates.overall_impact_score = impactScore
                }
            } else {
                // Skip per-actionable likelihood when document-level likelihood is set
                if (!(docLikelihoodScore && docLikelihoodScore > 0)) {
                    if (subDiffers(draftLikeBV, item.likelihood_business_volume)) updates.likelihood_business_volume = draftLikeBV
                    if (subDiffers(draftLikePP, item.likelihood_products_processes)) updates.likelihood_products_processes = draftLikePP
                    if (subDiffers(draftLikeCV, item.likelihood_compliance_violations)) updates.likelihood_compliance_violations = draftLikeCV
                }
                if (subDiffers(draftImpactDD, item.impact_dropdown)) updates.impact_dropdown = draftImpactDD
                if (subDiffers(draftCtrlMon, item.control_monitoring)) updates.control_monitoring = draftCtrlMon
                if (subDiffers(draftCtrlEff, item.control_effectiveness)) updates.control_effectiveness = draftCtrlEff
                // Send computed scores
                updates.likelihood_score = likelihoodScore
                updates.control_score = controlScore
                updates.inherent_risk_score = inherentRiskScore
                updates.inherent_risk_label = inherentRiskLabel
                updates.residual_risk_score = residualRiskScore
                updates.residual_risk_label = residualRiskLabel
                updates.residual_risk_interpretation = residualRiskInterpretation
                updates.overall_likelihood_score = Math.round(likelihoodScore)
                updates.overall_impact_score = Math.round(impactScore)
                updates.overall_control_score = controlScore
            }
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

    // Publish: resolves deadline, sets published_at + task_status, moves to tracker
    const handlePublish = async (e: React.MouseEvent) => {
        e.stopPropagation()
        // Validate required fields before publish (CO publishes to tracker)
        // Note: likelihood/control fields are filled by member during submission, not by CO
        const missing: string[] = []
        if (!resolvedTheme) missing.push("Theme")
        if (!draftTranche3) missing.push("Tranche 3")
        if (!draftImpactDD?.label) missing.push("Impact")
        if (draftTeams.length === 0 || (draftTeams.length === 1 && !draftTeams[0])) missing.push("At least one Team")
        
        // Check implementation evidence for all assigned teams
        const teamsToCheck = draftTeams.length > 0 ? draftTeams : [item.workstream]
        for (const team of teamsToCheck) {
            const teamImpl = draftTeamImpl[team] || safeStr(item.team_workflows?.[team]?.implementation_notes || item.implementation_notes)
            if (!teamImpl) missing.push(`Implementation Evidence for ${team}`)
        }
        
        if (missing.length > 0) {
            toast.error(`Cannot publish — please fill: ${missing.join(", ")}`)
            return
        }
        // Validate: if New Product = Yes, must have Live Date
        if (draftNewProduct === "Yes" && !draftProductLiveDate) {
            toast.error("Product Live Date is required when New Product is 'Yes'")
            return
        }
        let dl = deadlineDate ? `${deadlineDate}T${deadlineTime || "23:59"}` : (item.deadline || "")
        if (!dl && docDefaultDeadline) {
            dl = `${docDefaultDeadline}T${docDefaultDeadlineTime || "23:59"}`
        }
        if (!dl) {
            toast.error("Set a deadline (or a document default deadline) before publishing")
            return
        }
        // Save any pending draft changes first, then publish
        const now = new Date().toISOString()
        const updates: Record<string, unknown> = {
            approval_status: "approved",
            published_at: now,
            deadline: dl,
            task_status: "assigned",
            published_by_account_id: callerAccountId,
        }
        // Preserve original first publish timestamp (never overwrite)
        if (!item.first_published_at) updates.first_published_at = now
        if (draftImpl !== safeStr(item.implementation_notes)) updates.implementation_notes = draftImpl
        if (draftEvidence !== safeStr(item.evidence_quote)) updates.evidence_quote = draftEvidence
        const teamsChanged = draftTeams.length !== ((item.assigned_teams?.length ?? 0) > 1 ? item.assigned_teams! : [item.workstream]).length
        if (teamsChanged) {
            updates.workstream = draftTeams[0]
            updates.assigned_teams = draftTeams.length > 1 ? draftTeams : []
        }
        await onUpdate(docId, item.id, updates)
        toast.success("Published & sent to tracker")
        const team = draftTeams[0] || item.workstream || "Technology"
        notifyPublished(item.action || "Actionable", team, docId, item.actionable_id || item.id)
    }

    const handleReject = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onUpdate(docId, item.id, { approval_status: "rejected" })
        toast.success("Rejected")
    }

    const handleRevert = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await onUpdate(docId, item.id, { approval_status: "pending", published_at: "", task_status: "", deadline: "" })
        toast.success("Reverted to pending")
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
            {/* Header row: Checkbox → Team → Risk → Text → Buttons */}
            <div className="flex items-center gap-1.5 px-3 py-2 hover:bg-muted/20 transition-colors">
                {/* Multi-select checkbox for bulk publish */}
                {item.approval_status === "pending" && (
                    <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={onCheck}
                        onClick={e => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0 cursor-pointer"
                    />
                )}
                <button onClick={() => { setExpanded(!expanded); onSelect() }} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}

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
                            <button onClick={handlePublish} className="p-1 rounded hover:bg-emerald-400/10 text-muted-foreground/40 hover:text-emerald-400 transition-colors" title="Publish & send to tracker">
                                <Send className="h-3.5 w-3.5" />
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
                    {(item.approval_status === "approved" || item.approval_status === "rejected") && (
                        <span className={cn(
                            "text-xs px-1.5 py-0.5 rounded font-medium ml-1",
                            item.approval_status === "approved" ? "text-emerald-400 bg-emerald-400/10" :
                            "text-red-400 bg-red-400/10"
                        )}>
                            {item.approval_status === "approved" ? "Published" : "Rejected"}
                        </span>
                    )}
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
                                            <span key={t} className={cn("inline-block px-2 py-0.5 rounded text-[10px] font-medium", getWorkstreamClass(t))}>{t}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            {item.deadline && (
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Deadline</p>
                                    <span className="text-xs text-blue-400 font-mono">{formatDateDMY(item.deadline)}</span>
                                </div>
                            )}
                            {/* Compliance Parameters — read-only for all roles in completed view */}
                            <div className="rounded-md border border-border/20 p-2 bg-muted/5">
                                <div className="flex items-center justify-between mb-1.5">
                                    <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Compliance Parameters</p>
                                </div>
                                <div className="grid grid-cols-3 gap-2 mb-2">
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Impact</p>
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.impact_dropdown?.label || <span className="text-muted-foreground/40 italic">—</span>}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">New Product</p>
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.new_product === "Yes" ? <span className="text-cyan-400 font-medium">Yes</span> : (item.new_product || <span className="text-muted-foreground/40 italic">—</span>)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.theme || <span className="text-muted-foreground/40 italic">—</span>}</p>
                                    </div>
                                </div>
                                {/* Tranche 3 — editable by CAG only */}
                                {isComplianceOfficer ? (
                                    <div className="space-y-2">
                                        <div>
                                            <p className="text-[10px] font-medium text-cyan-400/60 mb-0.5">Tranche 3 <span className="text-cyan-400/40 italic">(Editable by CAG)</span></p>
                                            <input
                                                type="text"
                                                value={draftTranche3 ?? safeStr(item.tranche3)}
                                                onChange={e => setDraftTranche3(e.target.value)}
                                                className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-cyan-400/30 focus:border-cyan-400 focus:outline-none text-foreground"
                                                placeholder="Enter Tranche 3…"
                                            />
                                        </div>
                                        {/* Product Live Date — editable by CAG only when new_product = Yes */}
                                        {item.new_product === "Yes" && (
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1">
                                                    <p className="text-[10px] font-medium text-cyan-400/60 mb-0.5">Product Live Date <span className="text-cyan-400/40 italic">(Editable by CAG)</span></p>
                                                    <input
                                                        type="date"
                                                        value={draftProductLiveDate}
                                                        onChange={e => setDraftProductLiveDate(e.target.value)}
                                                        className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-cyan-400/30 focus:border-cyan-400 focus:outline-none text-foreground"
                                                    />
                                                </div>
                                                {draftProductLiveDate && (() => {
                                                    const expD = new Date(draftProductLiveDate); expD.setMonth(expD.getMonth() + 6)
                                                    const expiryStr = expD.toISOString().split("T")[0]
                                                    const diffMs = expD.getTime() - Date.now()
                                                    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
                                                    return (
                                                        <div className="shrink-0 text-right">
                                                            <p className="text-[10px] text-muted-foreground/50 mb-0.5">6-Month Expiry</p>
                                                            <p className="text-[10px] font-mono text-cyan-400">{formatDateDMY(expiryStr)}</p>
                                                            <p className={cn("text-[9px] font-semibold", diffDays < 0 ? "text-red-400" : diffDays <= 30 ? "text-amber-400" : "text-cyan-400/60")}>
                                                                {diffDays < 0 ? `${Math.abs(diffDays)}d overdue` : diffDays === 0 ? "Today" : `${diffDays}d remaining`}
                                                            </p>
                                                        </div>
                                                    )
                                                })()}
                                            </div>
                                        )}
                                        {((draftTranche3 != null && draftTranche3 !== safeStr(item.tranche3)) || draftProductLiveDate !== safeStr(item.product_live_date)) && (
                                            <button
                                                onClick={async () => {
                                                    setSaving(true)
                                                    try {
                                                        const updates: Record<string, unknown> = {}
                                                        if (draftTranche3 != null && draftTranche3 !== safeStr(item.tranche3)) updates.tranche3 = draftTranche3
                                                        if (draftProductLiveDate !== safeStr(item.product_live_date)) {
                                                            updates.product_live_date = draftProductLiveDate
                                                            if (item.new_product === "Yes" && draftProductLiveDate) {
                                                                const expD = new Date(draftProductLiveDate); expD.setMonth(expD.getMonth() + 6)
                                                                updates.new_product_expiry = expD.toISOString().split("T")[0]
                                                            } else {
                                                                updates.new_product_expiry = ""
                                                            }
                                                        }
                                                        await onUpdate(docId, item.id, updates)
                                                        toast.success("Compliance parameters updated")
                                                    } catch (err) { toast.error(err instanceof Error ? err.message : "Update failed") }
                                                    finally { setSaving(false) }
                                                }}
                                                disabled={saving}
                                                className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 font-medium transition-colors"
                                            >
                                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                                Save Changes
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Tranche 3</p>
                                            <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.tranche3 || <span className="text-muted-foreground/40 italic">—</span>}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Product Live Date</p>
                                            <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.new_product === "Yes" && item.product_live_date ? <span className="text-cyan-400 font-mono">{item.product_live_date}</span> : <span className="text-muted-foreground/40 italic">—</span>}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {/* Circular Source Information */}
                            <div className="space-y-2 rounded-lg border border-border/30 p-3 bg-muted/5">
                                <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="col-span-2">
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable ID</p>
                                        <p className="text-xs text-foreground/80 font-mono bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular ID</p>
                                        <p className="text-xs text-foreground/80 font-mono">{item.circular_id || docId || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Title</p>
                                        <p className="text-xs text-foreground/80">{item.circular_title || docName || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Issued Date</p>
                                        <p className="text-xs text-foreground/80 font-mono">{item.regulation_issue_date ? formatDateDMY(item.regulation_issue_date) : "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Effective Date</p>
                                        <p className="text-xs text-foreground/80 font-mono">{item.circular_effective_date ? formatDateDMY(item.circular_effective_date) : "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Regulator</p>
                                        <p className="text-xs text-foreground/80">{item.regulator || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable Created</p>
                                        <p className="text-xs text-foreground/80 font-mono">{item.created_at ? formatDateDMY(item.created_at) : "—"}</p>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Editable actionable heading/title */}
                            <div>
                                <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Actionable Text</p>
                                <textarea
                                    value={draftAction}
                                    onChange={e => {
                                        setDraftAction(e.target.value)
                                        autoGrow(e.target)
                                    }}
                                    ref={el => autoGrow(el)}
                                    rows={2}
                                    className="w-full bg-background text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground resize-none overflow-hidden"
                                    placeholder="Click to edit actionable text..."
                                    style={{ minHeight: '36px' }}
                                />
                            </div>

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

                            {/* Team multi-select (hierarchical) */}
                            <div>
                                <p className="text-xs font-medium text-muted-foreground/60 mb-1 flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    Assign Teams
                                </p>
                                <HierarchicalTeamMultiSelect
                                    selected={draftTeams}
                                    onChange={setDraftTeams}
                                    onTeamAdded={(team) => {
                                        if (!draftTeamImpl[team]) {
                                            setDraftTeamImpl(p => ({ ...p, [team]: safeStr(item.implementation_notes) }))
                                        }
                                        if (!teamDeadlineDrafts[team]) {
                                            setTeamDeadlineDrafts(p => ({ ...p, [team]: { date: "", time: "23:59" } }))
                                        }
                                    }}
                                />
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
                                        <button
                                            onClick={() => setDraftTeams(prev => prev.filter(t => t !== draftTeams[0]))}
                                            className="ml-auto p-0.5 rounded hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400 transition-colors"
                                            title="Remove team assignment"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
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
                                        {!deadlineDate && docDefaultDeadline && (
                                            <p className="text-xs text-muted-foreground/40 mt-1">
                                                No individual deadline — will use document default ({formatDateDMY(docDefaultDeadline)}) on publish
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
                                            <div key={team} className={cn("rounded-lg p-3 space-y-2 border", teamColors.text.replace('text-', 'border-'), teamColors.bg.replace('bg-', 'bg-') + '/5')}>
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", teamColors.bg, teamColors.text)}>
                                                        {team}
                                                    </span>
                                                    <button
                                                        onClick={() => setDraftTeams(prev => prev.filter(t => t !== team))}
                                                        className="ml-auto p-0.5 rounded hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400 transition-colors"
                                                        title="Remove team assignment"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
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
                                                <div className={cn("rounded-lg p-2.5 border", teamColors.text.replace('text-', 'border-'), teamColors.bg.replace('bg-', 'bg-') + '/10')}>
                                                    <p className="text-xs font-medium text-muted-foreground/60 mb-2 flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" />
                                                        Deadline
                                                    </p>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="date"
                                                            value={draft.date}
                                                            min={new Date().toISOString().split("T")[0]}
                                                            onChange={e => setTeamDeadlineDrafts(prev => ({ ...prev, [team]: { ...draft, date: e.target.value } }))}
                                                            className="flex-1 bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                                        />
                                                        <input
                                                            type="time"
                                                            value={draft.time}
                                                            onChange={e => setTeamDeadlineDrafts(prev => ({ ...prev, [team]: { ...draft, time: e.target.value } }))}
                                                            className="w-20 bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                                        />
                                                    </div>
                                                    {draft.date && (
                                                        <p className="text-xs text-muted-foreground/50 mt-1.5">
                                                            {formatDateDMY(draft.date)}
                                                        </p>
                                                    )}
                                                    {!draft.date && docDefaultDeadline && (
                                                        <p className="text-xs text-muted-foreground/40 mt-1.5">
                                                            Will use document default ({formatDateDMY(docDefaultDeadline)}) on publish
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Circular Source Information */}
                            <div className="space-y-2 rounded-lg border border-border/30 p-3 bg-muted/5">
                                <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="col-span-2">
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable ID</p>
                                        <p className="text-xs text-foreground/80 font-mono bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular ID</p>
                                        <p className="text-xs text-foreground/80 font-mono">{item.circular_id || docId || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Title</p>
                                        <p className="text-xs text-foreground/80">{item.circular_title || docName || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Issued Date</p>
                                        <p className="text-xs text-foreground/80 font-mono">{item.regulation_issue_date ? formatDateDMY(item.regulation_issue_date) : "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Effective Date</p>
                                        <p className="text-xs text-foreground/80 font-mono">{item.circular_effective_date ? formatDateDMY(item.circular_effective_date) : "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Regulator</p>
                                        <p className="text-xs text-foreground/80">{item.regulator || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable Created</p>
                                        <p className="text-xs text-foreground/80 font-mono">{item.created_at ? formatDateDMY(item.created_at) : "—"}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Risk Assessment Framework */}
                            <div className="space-y-3 rounded-lg border border-border/30 p-3 bg-muted/5">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold text-foreground/70">Risk Assessment</p>
                                    <div className="flex items-center gap-2">
                                        {isComplianceOfficer && <span className="text-[10px] text-muted-foreground/40 italic">Impact editable · Likelihood &amp; Control read-only</span>}
                                        {!isComplianceOfficer && <span className="text-[10px] text-muted-foreground/40 italic">Likelihood &amp; Control editable · Impact read-only</span>}
                                    </div>
                                </div>

                                {/* Theme / Tranche3 — both roles can edit */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                        <select
                                            value={draftTheme}
                                            onChange={e => setDraftTheme(e.target.value)}
                                            className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-border/40 focus:border-primary focus:outline-none text-foreground"
                                        >
                                            <option value="">— Select Theme —</option>
                                            {THEME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">{getLabel("tranche3") || "Tranche 3"}</p>
                                        <select value={draftTranche3} onChange={e => setDraftTranche3(e.target.value)} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-border/40 focus:border-primary focus:outline-none text-foreground">
                                            {getSafeOptions("tranche3").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* New Product — CO editable, Member read-only (like Impact) */}
                                <div className="rounded-md border border-border/20 p-2 bg-muted/10">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <p className="text-[10px] font-semibold text-cyan-400/80 uppercase tracking-wider">New Product</p>
                                        {!isComplianceOfficer && <span className="text-[10px] text-muted-foreground/40 italic">Set by CAG</span>}
                                    </div>
                                    {isComplianceOfficer ? (
                                        <div className="space-y-2">
                                            <select
                                                value={draftNewProduct}
                                                onChange={e => {
                                                    setDraftNewProduct(e.target.value)
                                                    if (e.target.value === "No") {
                                                        setDraftProductLiveDate("")
                                                    } else if (e.target.value === "Yes" && !draftProductLiveDate) {
                                                        setDraftProductLiveDate(new Date().toISOString().split("T")[0])
                                                    }
                                                }}
                                                className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-cyan-400/30 focus:border-cyan-400 focus:outline-none text-foreground"
                                            >
                                                <option value="No">No</option>
                                                <option value="Yes">Yes</option>
                                            </select>
                                            {draftNewProduct === "Yes" && (
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1">
                                                        <p className="text-[10px] text-muted-foreground/50 mb-0.5">Product Live Date</p>
                                                        <input
                                                            type="date"
                                                            value={draftProductLiveDate}
                                                            onChange={e => setDraftProductLiveDate(e.target.value)}
                                                            className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-cyan-400/30 focus:border-cyan-400 focus:outline-none text-foreground"
                                                        />
                                                    </div>
                                                    {draftProductLiveDate && (() => {
                                                        const expD = new Date(draftProductLiveDate); expD.setMonth(expD.getMonth() + 6)
                                                        const expiryStr = expD.toISOString().split("T")[0]
                                                        const diffMs = expD.getTime() - Date.now()
                                                        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
                                                        return (
                                                            <div className="shrink-0 text-right">
                                                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">6-Month Expiry</p>
                                                                <p className="text-[10px] font-mono text-cyan-400">{formatDateDMY(expiryStr)}</p>
                                                                <p className={cn("text-[9px] font-semibold", diffDays < 0 ? "text-red-400" : diffDays <= 30 ? "text-amber-400" : "text-cyan-400/60")}>
                                                                    {diffDays < 0 ? `${Math.abs(diffDays)}d overdue` : diffDays === 0 ? "Today" : `${diffDays}d remaining`}
                                                                </p>
                                                            </div>
                                                        )
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            <div className="text-xs bg-muted/20 rounded px-2 py-1.5 border border-border/20 text-foreground/70 min-h-[28px]">
                                                {draftNewProduct === "Yes" ? (
                                                    <span className="text-cyan-400 font-medium">Yes</span>
                                                ) : (
                                                    <span>{item.new_product || <span className="text-muted-foreground/40 italic">Will be set by CAG</span>}</span>
                                                )}
                                            </div>
                                            {(item.new_product === "Yes" || draftNewProduct === "Yes") && item.product_live_date && (
                                                <div className="flex items-center gap-2 text-[10px]">
                                                    <span className="text-muted-foreground/50">Live Date:</span>
                                                    <span className="text-cyan-400 font-mono">{formatDateDMY(item.product_live_date)}</span>
                                                    {(() => {
                                                        const expD = new Date(item.product_live_date); expD.setMonth(expD.getMonth() + 6)
                                                        return <span className="text-cyan-400/60 font-mono">→ Exp: {formatDateDMY(expD.toISOString().split("T")[0])}</span>
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Impact Assessment — CO editable, Member read-only */}
                                <div className="rounded-md border border-border/20 p-2 bg-muted/10">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <p className="text-[10px] font-semibold text-pink-400/80 uppercase tracking-wider">Impact Assessment</p>
                                        {!isComplianceOfficer && <span className="text-[10px] text-muted-foreground/40 italic">Set by Compliance</span>}
                                        {isComplianceOfficer && <span className="text-[10px] font-mono text-pink-400/60">Score: {rawImpact} → Squared: {impactScore}</span>}
                                    </div>
                                    {isComplianceOfficer ? (
                                        <select
                                            value={draftImpactDD?.label || ""}
                                            onChange={e => setDraftImpactDD(pickSubDropdown("impact_dropdown", e.target.value))}
                                            className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-pink-400/30 focus:border-pink-400 focus:outline-none text-foreground"
                                        >
                                            <option value="">— Select Impact —</option>
                                            {getSafeOptions("impact_dropdown").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <div className="text-xs bg-muted/20 rounded px-2 py-1.5 border border-border/20 text-foreground/70 min-h-[28px]">
                                            {item.impact_dropdown?.label || <span className="text-muted-foreground/40 italic">Will be filled by Compliance</span>}
                                        </div>
                                    )}
                                </div>

                                {/* Likelihood — editable only by the assigned team (or CO sees read-only) */}
                                {!isComplianceOfficer && (
                                    <div className="rounded-md border border-border/20 p-2 bg-muted/10">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <p className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wider">Likelihood Assessment</p>
                                            {(docLikelihoodScore && docLikelihoodScore > 0) ? (
                                                <span className="text-[10px] text-blue-400/60 italic">Set at document level (Score: {docLikelihoodScore})</span>
                                            ) : !canEditLikelihood ? (
                                                <span className="text-[10px] text-muted-foreground/40 italic">Read-only — only {assignedTeams.join(", ") || "assigned team"} can edit</span>
                                            ) : (
                                                <span className="text-[10px] font-mono text-blue-400/60">Overall: {likelihoodScore} (MAX of 3)</span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div>
                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_business_volume") || "Business Volumes"}</p>
                                                <select value={draftLikeBV?.label || ""} onChange={e => setDraftLikeBV(pickSubDropdown("likelihood_business_volume", e.target.value))} disabled={!canEditLikelihood || !!(docLikelihoodScore && docLikelihoodScore > 0)} className={cn("w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground", (!canEditLikelihood || (docLikelihoodScore && docLikelihoodScore > 0)) && "opacity-60 cursor-not-allowed")}>
                                                    <option value="">— Select volume change —</option>
                                                    {getSafeOptions("likelihood_business_volume").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_products_processes") || "Products & Processes"}</p>
                                                <select value={draftLikePP?.label || ""} onChange={e => setDraftLikePP(pickSubDropdown("likelihood_products_processes", e.target.value))} disabled={!canEditLikelihood || !!(docLikelihoodScore && docLikelihoodScore > 0)} className={cn("w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground", (!canEditLikelihood || (docLikelihoodScore && docLikelihoodScore > 0)) && "opacity-60 cursor-not-allowed")}>
                                                    <option value="">— Select rollouts —</option>
                                                    {getSafeOptions("likelihood_products_processes").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_compliance_violations") || "Compliance Violations"}</p>
                                                <select value={draftLikeCV?.label || ""} onChange={e => setDraftLikeCV(pickSubDropdown("likelihood_compliance_violations", e.target.value))} disabled={!canEditLikelihood || !!(docLikelihoodScore && docLikelihoodScore > 0)} className={cn("w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground", (!canEditLikelihood || (docLikelihoodScore && docLikelihoodScore > 0)) && "opacity-60 cursor-not-allowed")}>
                                                    <option value="">— Select violation history —</option>
                                                    {getSafeOptions("likelihood_compliance_violations").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Control Assessment — Member editable, hidden for Compliance */}
                                {!isComplianceOfficer && (
                                    <div className="rounded-md border border-border/20 p-2 bg-muted/10">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <p className="text-[10px] font-semibold text-teal-400/80 uppercase tracking-wider">Control Assessment</p>
                                            <span className="text-[10px] font-mono text-teal-400/60">Overall: {controlScore.toFixed(1)} (max)</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("control_monitoring") || "Monitoring Mechanism"}</p>
                                                <select value={draftCtrlMon?.label || ""} onChange={e => setDraftCtrlMon(pickSubDropdown("control_monitoring", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-teal-400/30 focus:border-teal-400 focus:outline-none text-foreground">
                                                    <option value="">— Select monitoring type —</option>
                                                    {getSafeOptions("control_monitoring").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("control_effectiveness") || "Control Effectiveness"}</p>
                                                <select value={draftCtrlEff?.label || ""} onChange={e => setDraftCtrlEff(pickSubDropdown("control_effectiveness", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-teal-400/30 focus:border-teal-400 focus:outline-none text-foreground">
                                                    <option value="">— Select effectiveness —</option>
                                                    {getSafeOptions("control_effectiveness").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Risk Summary — hidden for Compliance */}
                                {!isComplianceOfficer && (
                                    <div className="rounded-md border border-border/20 p-2 bg-background/40">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Risk Summary</p>
                                            <span className="text-[10px] text-muted-foreground/40">Auto-calculated</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                            <div className="rounded-md border border-border/30 bg-background/60 p-2">
                                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Likelihood</p>
                                                <p className="text-sm font-semibold tabular-nums text-blue-400">{likelihoodScore > 0 ? likelihoodScore : "—"}</p>
                                            </div>
                                            <div className="rounded-md border border-border/30 bg-background/60 p-2">
                                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Impact</p>
                                                <p className="text-sm font-semibold tabular-nums text-pink-400">{impactScore > 0 ? impactScore : "—"}</p>
                                            </div>
                                            <div className="rounded-md border border-border/30 bg-background/60 p-2">
                                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Inherent Risk Score</p>
                                                <p className="text-sm font-semibold tabular-nums text-orange-400">{inherentRiskScore > 0 ? inherentRiskScore.toFixed(0) : "—"}</p>
                                                {inherentRiskLabel && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{inherentRiskLabel}</p>}
                                            </div>
                                            <div className="rounded-md border border-border/30 bg-background/60 p-2">
                                                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Control Score</p>
                                                <p className="text-sm font-semibold tabular-nums text-teal-400">{controlScore > 0 ? controlScore.toFixed(1) : "—"}</p>
                                            </div>
                                        </div>
                                        <div className="rounded-md border border-border/30 bg-background/60 p-2">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Residual Risk Score</p>
                                                    <p className="text-sm font-semibold tabular-nums text-foreground">{residualRiskScore > 0 ? residualRiskScore.toFixed(1) : "—"}</p>
                                                </div>
                                                {residualRiskInterpretation && (
                                                    <span className={cn(
                                                        "text-xs font-medium px-2 py-0.5 rounded-full",
                                                        RESIDUAL_RISK_INTERPRETATION_STYLES[residualRiskInterpretation]?.bg ?? "bg-muted/30",
                                                        RESIDUAL_RISK_INTERPRETATION_STYLES[residualRiskInterpretation]?.text ?? "text-foreground"
                                                    )}>
                                                        {residualRiskInterpretation}
                                                    </span>
                                                )}
                                                {!residualRiskInterpretation && <span className="text-xs text-muted-foreground/30">—</span>}
                                            </div>
                                        </div>
                                    </div>
                                )}
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
// Mirrors the expanded pending ActionableCard UI exactly.

function CreateActionableForm({ docId, docName, allDocs, onCreated, onCancel }: {
    docId: string
    docName: string
    allDocs: DocActionables[]
    onCreated: () => void
    onCancel: () => void
}) {
    const autoGrow = React.useCallback((el: HTMLTextAreaElement | null) => {
        if (!el) return
        el.style.height = "auto"
        el.style.height = `${el.scrollHeight}px`
    }, [])

    const [creating, setCreating] = React.useState(false)
    const [selectedDocId, setSelectedDocId] = React.useState(docId)
    const [docSearchQuery, setDocSearchQuery] = React.useState("")
    const [showDocMenu, setShowDocMenu] = React.useState(false)

    // Core fields
    const [draftAction, setDraftAction] = React.useState("")
    const [draftEvidence, setDraftEvidence] = React.useState("")

    // Team assignment — uses same HierarchicalTeamMultiSelect as ActionableCard
    const [draftTeams, setDraftTeams] = React.useState<string[]>([])
    const draftIsMulti = draftTeams.length > 1

    // Per-team implementation (mirrors ActionableCard draftTeamImpl / draftImpl)
    const [draftImpl, setDraftImpl] = React.useState("")
    const [draftTeamImpl, setDraftTeamImpl] = React.useState<Record<string, string>>({})
    const [teamDeadlineDrafts, setTeamDeadlineDrafts] = React.useState<Record<string, { date: string; time: string }>>({})
    const [deadlineDate, setDeadlineDate] = React.useState("")
    const [deadlineTime, setDeadlineTime] = React.useState("23:59")


    // Circular metadata — auto-populated from selected document's first actionable
    const selectedDoc = allDocs.find(d => d.doc_id === selectedDocId)
    const selectedDocNameActual = selectedDoc?.doc_name || docName
    const circMeta = React.useMemo(() => {
        const first = selectedDoc?.actionables[0]
        return {
            circular_id: (selectedDoc as unknown as { circular_id?: string })?.circular_id || first?.circular_id || "",
            circular_title: (selectedDoc as unknown as { circular_title?: string })?.circular_title || first?.circular_title || "",
            regulation_issue_date: first?.regulation_issue_date || "",
            circular_effective_date: first?.circular_effective_date || "",
            regulator: first?.regulator || "",
        }
    }, [selectedDoc])

    const filteredDocs = React.useMemo(() => {
        if (!docSearchQuery.trim()) return allDocs
        const q = docSearchQuery.toLowerCase()
        return allDocs.filter(d => d.doc_name.toLowerCase().includes(q))
    }, [allDocs, docSearchQuery])

    // Validation
    const teamsForImpl = draftTeams
    const allTeamImplFilled = teamsForImpl.length > 0 && (
        draftIsMulti
            ? teamsForImpl.every(t => (draftTeamImpl[t] || "").trim().length > 0)
            : draftImpl.trim().length > 0
    )
    const isValid = (
        selectedDocId.trim().length > 0 &&
        draftAction.trim().length > 0 &&
        draftTeams.length > 0 &&
        allTeamImplFilled
    )

    const handleSubmit = async () => {
        if (!isValid) {
            const missing: string[] = []
            if (!draftAction.trim()) missing.push("Actionable text")
            if (draftTeams.length === 0) missing.push("at least one team")
            if (!allTeamImplFilled) missing.push("implementation for all teams")
            toast.error(`Missing: ${missing.join(", ")}`)
            return
        }

        const teamWorkflows: Record<string, { implementation_notes: string; deadline?: string }> = {}
        if (draftIsMulti) {
            for (const team of draftTeams) {
                const dl = teamDeadlineDrafts[team]
                teamWorkflows[team] = {
                    implementation_notes: draftTeamImpl[team] || "",
                    ...(dl?.date ? { deadline: `${dl.date}T${dl.time || "23:59"}` } : {}),
                }
            }
        }

        const payload: Record<string, unknown> = {
            action: draftAction.trim(),
            evidence_quote: draftEvidence.trim(),
            workstream: draftTeams[0],
            assigned_teams: draftIsMulti ? draftTeams : [],
            implementation_notes: draftIsMulti ? "" : draftImpl.trim(),
            ...(draftIsMulti ? { team_workflows: teamWorkflows } : {}),
            ...(!draftIsMulti && deadlineDate ? { deadline: `${deadlineDate}T${deadlineTime || "23:59"}` } : {}),
            regulation_issue_date: circMeta.regulation_issue_date,
            circular_effective_date: circMeta.circular_effective_date,
            regulator: circMeta.regulator,
            circular_id: circMeta.circular_id,
            circular_title: circMeta.circular_title,
        }

        setCreating(true)
        try {
            await createManualActionable(selectedDocId, payload)
            toast.success("Actionable created")
            onCreated()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create")
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="border border-primary/30 rounded-lg overflow-hidden bg-background">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border-b border-primary/20">
                <h3 className="text-xs font-semibold flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5 text-primary" />
                    New Actionable
                </h3>
                <button onClick={onCancel} className="p-1 rounded hover:bg-muted text-muted-foreground">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="px-3 pb-3 space-y-3 pt-2.5">

                {/* Document selector */}
                <div>
                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Document *</p>
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowDocMenu(prev => !prev)}
                            className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground text-left flex items-center gap-1.5"
                        >
                            <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate flex-1">{selectedDocNameActual}</span>
                            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                        </button>
                        {showDocMenu && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => { setShowDocMenu(false); setDocSearchQuery("") }} />
                                <div className="absolute left-0 top-full mt-1 z-50 bg-background border border-border rounded-md shadow-lg min-w-full max-h-[200px] flex flex-col">
                                    <div className="p-1.5 border-b border-border/40">
                                        <div className="relative">
                                            <Search className="absolute left-2 top-[6px] h-3 w-3 text-muted-foreground/50" />
                                            <input autoFocus value={docSearchQuery} onChange={e => setDocSearchQuery(e.target.value)} placeholder="Search documents..." className="w-full bg-muted/30 text-xs rounded px-2 py-1 pl-6 border border-border/40 focus:border-primary focus:outline-none" />
                                        </div>
                                    </div>
                                    <div className="overflow-y-auto flex-1 py-1">
                                        {filteredDocs.map(d => (
                                            <button key={d.doc_id} className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2", selectedDocId === d.doc_id && "bg-primary/10 text-primary")} onClick={() => { setSelectedDocId(d.doc_id); setShowDocMenu(false); setDocSearchQuery("") }}>
                                                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                                                <span className="truncate">{d.doc_name}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Actionable text — identical to ActionableCard */}
                <div>
                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Actionable Text *</p>
                    <textarea
                        value={draftAction}
                        onChange={e => { setDraftAction(e.target.value); autoGrow(e.target) }}
                        ref={el => autoGrow(el)}
                        rows={2}
                        className="w-full bg-background text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground resize-none overflow-hidden"
                        placeholder="Enter actionable text..."
                        style={{ minHeight: '36px' }}
                    />
                </div>

                {/* Evidence — identical to ActionableCard */}
                <div>
                    <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Evidence</p>
                    <textarea
                        value={draftEvidence}
                        onChange={e => { setDraftEvidence(e.target.value); autoGrow(e.target) }}
                        ref={el => autoGrow(el)}
                        rows={2}
                        className="w-full bg-background text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground resize-none overflow-hidden"
                        placeholder="Add evidence quote..."
                        style={{ minHeight: '48px' }}
                    />
                </div>

                {/* Team multi-select — identical to ActionableCard */}
                <div>
                    <p className="text-xs font-medium text-muted-foreground/60 mb-1 flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        Assign Teams *
                    </p>
                    <HierarchicalTeamMultiSelect
                        selected={draftTeams}
                        onChange={setDraftTeams}
                        onTeamAdded={(team) => {
                            if (!draftTeamImpl[team]) {
                                setDraftTeamImpl(p => ({ ...p, [team]: "" }))
                            }
                            if (!teamDeadlineDrafts[team]) {
                                setTeamDeadlineDrafts(p => ({ ...p, [team]: { date: "", time: "23:59" } }))
                            }
                        }}
                    />
                </div>

                {/* Single-team: Consolidated group box — identical to ActionableCard */}
                {draftTeams.length === 1 && (() => {
                    const teamColors = WORKSTREAM_COLORS[draftTeams[0]] || DEFAULT_WORKSTREAM_COLORS
                    return (
                        <div className={cn("rounded-lg p-3 space-y-3 border-2", teamColors.text.replace('text-', 'border-'))}>
                            <div className="flex items-center gap-2">
                                <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", getWorkstreamClass(draftTeams[0]))}>
                                    {draftTeams[0]}
                                </span>
                                <button
                                    onClick={() => setDraftTeams(prev => prev.filter(t => t !== draftTeams[0]))}
                                    className="ml-auto p-0.5 rounded hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400 transition-colors"
                                    title="Remove team assignment"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Implementation *</p>
                                <textarea
                                    value={draftImpl}
                                    onChange={e => { setDraftImpl(e.target.value); autoGrow(e.target) }}
                                    ref={autoGrow}
                                    rows={2}
                                    className="w-full bg-background text-xs rounded px-2 py-1 border border-border/60 focus:border-primary focus:outline-none text-foreground resize-none overflow-hidden"
                                    placeholder="Enter implementation notes..."
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
                                {deadlineDate && <p className="text-xs text-muted-foreground/50 mt-1">{formatDateDMY(deadlineDate)}</p>}
                            </div>
                        </div>
                    )
                })()}

                {/* Multi-team: Per-team group boxes — identical to ActionableCard */}
                {draftIsMulti && (
                    <div className="space-y-3">
                        <p className="text-xs font-medium text-muted-foreground/60 flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            Per-Team Implementation *
                        </p>
                        {draftTeams.map(team => {
                            const teamColors = WORKSTREAM_COLORS[team] || DEFAULT_WORKSTREAM_COLORS
                            const draft = teamDeadlineDrafts[team] || { date: "", time: "23:59" }
                            return (
                                <div key={team} className={cn("rounded-lg p-3 space-y-2 border", teamColors.text.replace('text-', 'border-'), teamColors.bg.replace('bg-', 'bg-') + '/5')}>
                                    <div className="flex items-center gap-2">
                                        <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", teamColors.bg, teamColors.text)}>
                                            {team}
                                        </span>
                                        <button
                                            onClick={() => setDraftTeams(prev => prev.filter(t => t !== team))}
                                            className="ml-auto p-0.5 rounded hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400 transition-colors"
                                            title="Remove team assignment"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Implementation *</p>
                                        <textarea
                                            value={draftTeamImpl[team] || ""}
                                            onChange={e => { setDraftTeamImpl(prev => ({ ...prev, [team]: e.target.value })); autoGrow(e.target) }}
                                            ref={autoGrow}
                                            rows={2}
                                            className="w-full bg-background text-xs rounded px-2 py-1 border border-border focus:border-primary focus:outline-none text-foreground resize-none overflow-hidden"
                                            placeholder="Enter implementation notes..."
                                            style={{ minHeight: '48px' }}
                                        />
                                    </div>
                                    <div className={cn("rounded-lg p-2.5 border", teamColors.text.replace('text-', 'border-'), teamColors.bg.replace('bg-', 'bg-') + '/10')}>
                                        <p className="text-xs font-medium text-muted-foreground/60 mb-2 flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            Deadline
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="date"
                                                value={draft.date}
                                                min={new Date().toISOString().split("T")[0]}
                                                onChange={e => setTeamDeadlineDrafts(prev => ({ ...prev, [team]: { ...draft, date: e.target.value } }))}
                                                className="flex-1 bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                            />
                                            <input
                                                type="time"
                                                value={draft.time}
                                                onChange={e => setTeamDeadlineDrafts(prev => ({ ...prev, [team]: { ...draft, time: e.target.value } }))}
                                                className="w-20 bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                                            />
                                        </div>
                                        {draft.date && <p className="text-xs text-muted-foreground/50 mt-1.5">{formatDateDMY(draft.date)}</p>}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* Circular Source Information — same layout as ActionableCard, auto-populated */}
                <div className="space-y-2 rounded-lg border border-border/30 p-3 bg-muted/5">
                    <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable ID</p>
                            <p className="text-xs text-foreground/50 font-mono bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block italic">Auto-generated on create</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular ID</p>
                            <p className="text-xs text-foreground/80 font-mono">{circMeta.circular_id || selectedDocId || "—"}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Title</p>
                            <p className="text-xs text-foreground/80">{circMeta.circular_title || selectedDocNameActual || "—"}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Issued Date</p>
                            <p className="text-xs text-foreground/80 font-mono">{circMeta.regulation_issue_date ? formatDateDMY(circMeta.regulation_issue_date) : "—"}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Effective Date</p>
                            <p className="text-xs text-foreground/80 font-mono">{circMeta.circular_effective_date ? formatDateDMY(circMeta.circular_effective_date) : "—"}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Regulator</p>
                            <p className="text-xs text-foreground/80">{circMeta.regulator || "—"}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable Created</p>
                            <p className="text-xs text-foreground/50 font-mono italic">Auto-generated on create</p>
                        </div>
                    </div>
                </div>

                {/* Validation hint */}
                {!isValid && (
                    <div className="text-[10px] text-muted-foreground/50 space-y-0.5">
                        {!draftAction.trim() && <p className="text-red-400/60">· Actionable text required</p>}
                        {draftTeams.length === 0 && <p className="text-red-400/60">· Assign at least one team</p>}
                        {draftTeams.length > 0 && !allTeamImplFilled && <p className="text-red-400/60">· Implementation required for all teams</p>}
                    </div>
                )}

                {/* Create button — disabled until all required fields filled */}
                <button
                    onClick={handleSubmit}
                    disabled={!isValid || creating}
                    className={cn(
                        "w-full flex items-center justify-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium transition-colors",
                        isValid && !creating
                            ? "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                            : "bg-muted/40 text-muted-foreground/30 cursor-not-allowed"
                    )}
                >
                    {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {creating ? "Creating..." : isValid ? "Create Actionable" : "Fill required fields to create"}
                </button>
            </div>
        </div>
    )
}

// --- Main Page ---

export default function ActionablesPage() {
    const { data: session } = useSession()
    const callerRole = getUserRole(session) || "compliance_officer"
    const callerAccountId = (session?.user as Record<string, unknown>)?.id as string || ""
    const callerTeam = getUserTeam(session)
    const [allDocs, setAllDocs] = React.useState<DocActionables[]>([])
    const [loading, setLoading] = React.useState(true)
    
    // Document-level theme defaults (frontend-only, persisted in localStorage per user)
    const [docThemeDefaults, setDocThemeDefaults] = React.useState<Record<string, string>>({})

    // Per-document deadline defaults (frontend-only, persisted in localStorage per user)
    const [docDeadlineDefaults, setDocDeadlineDefaults] = React.useState<Record<string, { date: string; time: string }>>({})

    // Per-document New Product and Live Date defaults (persisted in localStorage per user)
    const [docNewProductDefaults, setDocNewProductDefaults] = React.useState<Record<string, string>>({})
    const [docLiveDateDefaults, setDocLiveDateDefaults] = React.useState<Record<string, string>>({})

    const deadlinesStorageKey = React.useMemo(() => (
        callerAccountId ? `actionables_doc_deadlines_${callerAccountId}` : "actionables_doc_deadlines"
    ), [callerAccountId])
    const themesStorageKey = React.useMemo(() => (
        callerAccountId ? `actionables_doc_themes_${callerAccountId}` : "actionables_doc_themes"
    ), [callerAccountId])
    const docNewProductStorageKey = React.useMemo(() => (
        callerAccountId ? `actionables_doc_new_product_${callerAccountId}` : "actionables_doc_new_product"
    ), [callerAccountId])
    const docLiveDateStorageKey = React.useMemo(() => (
        callerAccountId ? `actionables_doc_live_date_${callerAccountId}` : "actionables_doc_live_date"
    ), [callerAccountId])

    // Load persisted per-document defaults from localStorage whenever user changes
    React.useEffect(() => {
        try {
            const savedDeadlines = localStorage.getItem(deadlinesStorageKey) ?? localStorage.getItem("actionables_doc_deadlines")
            setDocDeadlineDefaults(savedDeadlines ? JSON.parse(savedDeadlines) : {})
            const savedThemes = localStorage.getItem(themesStorageKey) ?? localStorage.getItem("actionables_doc_themes")
            setDocThemeDefaults(savedThemes ? JSON.parse(savedThemes) : {})
            const savedNewProduct = localStorage.getItem(docNewProductStorageKey) ?? localStorage.getItem("actionables_doc_new_product")
            setDocNewProductDefaults(savedNewProduct ? JSON.parse(savedNewProduct) : {})
            const savedLiveDate = localStorage.getItem(docLiveDateStorageKey) ?? localStorage.getItem("actionables_doc_live_date")
            setDocLiveDateDefaults(savedLiveDate ? JSON.parse(savedLiveDate) : {})
        } catch {
            setDocDeadlineDefaults({})
            setDocThemeDefaults({})
            setDocNewProductDefaults({})
            setDocLiveDateDefaults({})
        }
    }, [deadlinesStorageKey, themesStorageKey, docNewProductStorageKey, docLiveDateStorageKey])

    // Save per-document deadlines to localStorage whenever they change
    const updateDocDeadline = React.useCallback((docId: string, date: string, time: string) => {
        setDocDeadlineDefaults(prev => {
            const next = { ...prev, [docId]: { date, time } }
            try {
                localStorage.setItem(deadlinesStorageKey, JSON.stringify(next))
            } catch { /* ignore */ }
            return next
        })
    }, [deadlinesStorageKey])

    // Save per-document theme defaults to localStorage (per user)
    const updateDocTheme = React.useCallback((docId: string, theme: string) => {
        setDocThemeDefaults(prev => {
            const next = { ...prev, [docId]: theme }
            try {
                localStorage.setItem(themesStorageKey, JSON.stringify(next))
            } catch { /* ignore */ }
            return next
        })
    }, [themesStorageKey])

    // Save per-document New Product and Live Date defaults to localStorage
    const updateDocNewProduct = React.useCallback((docId: string, newProduct: string) => {
        setDocNewProductDefaults(prev => {
            const next = { ...prev, [docId]: newProduct }
            try {
                localStorage.setItem(docNewProductStorageKey, JSON.stringify(next))
            } catch { /* ignore */ }
            return next
        })
    }, [docNewProductStorageKey])

    const updateDocLiveDate = React.useCallback((docId: string, liveDate: string) => {
        setDocLiveDateDefaults(prev => {
            const next = { ...prev, [docId]: liveDate }
            try {
                localStorage.setItem(docLiveDateStorageKey, JSON.stringify(next))
            } catch { /* ignore */ }
            return next
        })
    }, [docLiveDateStorageKey])

    // Track which documents have unsaved global changes (theme, deadline, new product, live date)
    const [docGlobalDirty, setDocGlobalDirty] = React.useState<Set<string>>(new Set())
    const markDocDirty = React.useCallback((docId: string) => {
        setDocGlobalDirty(prev => { const next = new Set(prev); next.add(docId); return next })
    }, [])
    const [docGlobalSaving, setDocGlobalSaving] = React.useState<Set<string>>(new Set())

    // Helper: compute 6-month expiry from a live date
    const computeSixMonthExpiry = React.useCallback((liveDate: string): string => {
        if (!liveDate) return ""
        const d = new Date(liveDate)
        d.setMonth(d.getMonth() + 6)
        return d.toISOString().split("T")[0]
    }, [])

    // Filters
    const [docFilter, setDocFilter] = React.useState<string>("all")
    const [showDocFilterMenu, setShowDocFilterMenu] = React.useState(false)
    const [docFilterSearch, setDocFilterSearch] = React.useState("")
    const [searchQuery, setSearchQuery] = React.useState("")

    // Document-level likelihood state
    const isLikelihoodSetter = !["compliance_officer"].includes(callerRole) || callerRole === "admin"
    const { getOptions: getLikOpts } = useDropdownConfig()
    const [docLikSaving, setDocLikSaving] = React.useState<Set<string>>(new Set())
    const [docLikDrafts, setDocLikDrafts] = React.useState<Record<string, { bv: RiskSubDropdown; pp: RiskSubDropdown; cv: RiskSubDropdown }>>({})
    const getDocLikDraft = React.useCallback((docId: string, doc: DocActionables) => {
        if (docLikDrafts[docId]) return docLikDrafts[docId]
        return {
            bv: doc.document_likelihood_breakdown?.business_volume || {} as RiskSubDropdown,
            pp: doc.document_likelihood_breakdown?.products_processes || {} as RiskSubDropdown,
            cv: doc.document_likelihood_breakdown?.compliance_violations || {} as RiskSubDropdown,
        }
    }, [docLikDrafts])
    const setDocLikDraft = React.useCallback((docId: string, field: "bv" | "pp" | "cv", val: RiskSubDropdown) => {
        setDocLikDrafts(prev => {
            const current = prev[docId] || { bv: {} as RiskSubDropdown, pp: {} as RiskSubDropdown, cv: {} as RiskSubDropdown }
            return { ...prev, [docId]: { ...current, [field]: val } }
        })
    }, [])
    const handleSaveDocLikelihood = React.useCallback(async (docId: string) => {
        const docData = allDocs.find(d => d.doc_id === docId)
        const draft = getDocLikDraft(docId, docData || { doc_id: docId, doc_name: "", actionables: [] })
        setDocLikSaving(prev => { const n = new Set(prev); n.add(docId); return n })
        try {
            await setDocumentLikelihood(docId, {
                breakdown: { business_volume: draft.bv, products_processes: draft.pp, compliance_violations: draft.cv },
                caller_role: callerRole,
                caller_team: "",
                caller_name: (session?.user as Record<string, unknown>)?.name as string || "",
                auto_propagate: true,
            })
            toast.success("Document likelihood saved & propagated")
            await loadAllRef.current?.()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save document likelihood")
        } finally {
            setDocLikSaving(prev => { const n = new Set(prev); n.delete(docId); return n })
        }
    }, [docLikDrafts, callerRole, session, allDocs, getDocLikDraft])
    const loadAllRef = React.useRef<(() => Promise<void>) | null>(null)

    // Per-document likelihood owner team state
    const [docOwnerTeamDrafts, setDocOwnerTeamDrafts] = React.useState<Record<string, string>>({})
    const [docOwnerTeamSaving, setDocOwnerTeamSaving] = React.useState<Set<string>>(new Set())
    const getDocOwnerTeam = React.useCallback((docId: string): string => {
        if (docOwnerTeamDrafts[docId] !== undefined) return docOwnerTeamDrafts[docId]
        const doc = allDocs.find(d => d.doc_id === docId)
        return doc?.global_likelihood_owner_team || ""
    }, [docOwnerTeamDrafts, allDocs])
    const getDocTeams = React.useCallback((docId: string): string[] => {
        const doc = allDocs.find(d => d.doc_id === docId)
        if (!doc) return []
        const teams = new Set<string>()
        for (const a of doc.actionables) {
            if (a.workstream) teams.add(a.workstream)
            if (a.assigned_teams) a.assigned_teams.forEach(t => teams.add(t))
        }
        return Array.from(teams).sort()
    }, [allDocs])
    const handleSaveOwnerTeam = React.useCallback(async (docId: string) => {
        const ownerTeam = docOwnerTeamDrafts[docId] ?? ""
        setDocOwnerTeamSaving(prev => { const n = new Set(prev); n.add(docId); return n })
        try {
            await updateDocumentMetadata(docId, { global_likelihood_owner_team: ownerTeam })
            toast.success(ownerTeam ? `Likelihood owner set to "${ownerTeam}"` : "Likelihood owner cleared")
            await loadAllRef.current?.()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to set owner team")
        } finally {
            setDocOwnerTeamSaving(prev => { const n = new Set(prev); n.delete(docId); return n })
        }
    }, [docOwnerTeamDrafts, callerRole])

    // PDF state
    const [pdfDocId, setPdfDocId] = React.useState<string | null>(null)
    const [pdfDocName, setPdfDocName] = React.useState<string>("")
    const [pdfJumpPage, setPdfJumpPage] = React.useState<number | undefined>(undefined)
    const [pdfJumpKey, setPdfJumpKey] = React.useState(0)

    // Selection (PDF navigation)
    const [selectedItemKey, setSelectedItemKey] = React.useState<string | null>(null)

    // Multi-select for bulk publish (pending items)
    const [checkedItems, setCheckedItems] = React.useState<Set<string>>(new Set())
    const toggleChecked = React.useCallback((key: string) => {
        setCheckedItems(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key); else next.add(key)
            return next
        })
    }, [])

    // Multi-select for bulk revert (rejected items)
    const [rejCheckedItems, setRejCheckedItems] = React.useState<Set<string>>(new Set())
    const toggleRejChecked = React.useCallback((key: string) => {
        setRejCheckedItems(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key); else next.add(key)
            return next
        })
    }, [])

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
                    document_likelihood_score: r.document_likelihood_score,
                    document_likelihood_breakdown: r.document_likelihood_breakdown,
                    document_likelihood_updated_at: r.document_likelihood_updated_at,
                    document_likelihood_updated_by: r.document_likelihood_updated_by,
                    global_likelihood_owner_team: r.global_likelihood_owner_team,
                }))
            setAllDocs(docs)

            setDocDeadlineDefaults(prev => {
                const next = { ...prev }
                const today = new Date()
                const oneMonthLater = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate())
                const dateStr = oneMonthLater.toISOString().split('T')[0]
                for (const doc of docs) {
                    if (!next[doc.doc_id]) {
                        next[doc.doc_id] = { date: dateStr, time: "23:59" }
                    }
                }
                try {
                    localStorage.setItem("actionables_doc_deadlines", JSON.stringify(next))
                } catch { /* ignore */ }
                return next
            })

            if (!pdfDocId && docs.length > 0) {
                setPdfDocId(docs[0].doc_id)
                setPdfDocName(docs[0].doc_name)
            }
        } catch (err) {
            console.error("Failed to load actionables:", err)
            toast.error(err instanceof Error ? err.message : "Failed to load actionables")
        } finally {
            setLoading(false)
        }
    }, [pdfDocId])

    React.useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps
    React.useEffect(() => { loadAllRef.current = loadAll }, [loadAll])

    const handleUpdate = React.useCallback(async (docId: string, itemId: string, updates: Record<string, unknown>) => {
        try {
            const updated = await updateActionable(docId, itemId, updates, undefined, callerRole)
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
    }, [callerRole])

    // Save document-level defaults to ALL pending actionables in that document
    const handleSaveDocDefaults = React.useCallback(async (docId: string) => {
        const doc = allDocs.find(d => d.doc_id === docId)
        if (!doc) return
        setDocGlobalSaving(prev => { const next = new Set(prev); next.add(docId); return next })
        try {
            const theme = docThemeDefaults[docId] || ""
            const newProduct = docNewProductDefaults[docId] || "No"
            const liveDate = docLiveDateDefaults[docId] || ""
            const docDl = docDeadlineDefaults[docId]
            const deadline = docDl?.date ? `${docDl.date}T${docDl.time || "23:59"}` : ""
            const expiry = (newProduct === "Yes" && liveDate) ? computeSixMonthExpiry(liveDate) : ""

            const pendingInDoc = doc.actionables.filter(a => !a.published_at && a.approval_status !== "rejected")
            for (const item of pendingInDoc) {
                const updates: Record<string, unknown> = {}
                if (theme) updates.theme = theme
                updates.new_product = newProduct
                if (liveDate) updates.product_live_date = liveDate
                if (expiry) updates.new_product_expiry = expiry
                if (deadline) updates.deadline = deadline
                await handleUpdate(docId, item.id, updates)
            }
            setDocGlobalDirty(prev => { const next = new Set(prev); next.delete(docId); return next })
            toast.success(`Applied defaults to ${pendingInDoc.length} actionables in "${doc.doc_name}"`)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save document defaults")
        } finally {
            setDocGlobalSaving(prev => { const next = new Set(prev); next.delete(docId); return next })
        }
    }, [allDocs, docThemeDefaults, docNewProductDefaults, docLiveDateDefaults, docDeadlineDefaults, computeSixMonthExpiry, handleUpdate])

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

    // Filter based on document and search query
    const filtered = React.useMemo(() => {
        return allItems.filter(({ item, docId }) => {
            if (docFilter !== "all" && docId !== docFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const searchable = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.evidence_quote)} ${safeStr(item.workstream)} ${safeStr(item.actionable_id)}`.toLowerCase()
                if (!searchable.includes(q)) return false
            }
            return true
        })
        // Keep actionables in creation order - no sorting by risk
    }, [allItems, docFilter, searchQuery])

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

    // Handlers for bulk actions — publish directly to tracker
    const handlePublishAll = React.useCallback(async (items: { item: ActionableItem; docId: string }[]) => {
        const pending = items.filter(e => e.item.approval_status === "pending")
        if (pending.length === 0) { toast.info("No pending items to publish"); return }
        // Validate required fields (theme, tranche3, impact, implementation evidence) on every pending item
        // Note: likelihood/control fields are filled by member during submission, not by CO
        const incomplete = pending.filter(({ item }) => {
            if (!item.theme || !item.tranche3 || !item.impact_dropdown?.label) return true
            // Must have at least one team
            const teamsToCheck = (item.assigned_teams && item.assigned_teams.length > 0) ? item.assigned_teams : [item.workstream]
            if (!teamsToCheck[0]) return true
            for (const team of teamsToCheck) {
                const teamImpl = item.team_workflows?.[team]?.implementation_notes || item.implementation_notes
                if (!teamImpl) return true
            }
            return false
        })
        if (incomplete.length > 0) {
            const ids = incomplete.map(({ item }) => item.actionable_id || item.id).slice(0, 5).join(", ")
            toast.error(`Cannot bulk publish — ${incomplete.length} item(s) missing required fields (e.g. ${ids})`)
            return
        }
        // Check if any item lacks both individual and document-level deadline
        const noDeadline = pending.filter(({ item, docId }) => {
            const docDefault = docDeadlineDefaults[docId]
            return !item.deadline && !docDefault?.date
        })
        if (noDeadline.length > 0) {
            const missingDocs = [...new Set(noDeadline.map(e => e.docId))]
            toast.error(`Set document default deadlines first — ${missingDocs.length} document(s) have actionables without deadlines`)
            return
        }
        for (const { item, docId } of pending) {
            const docDefault = docDeadlineDefaults[docId]
            const dl = item.deadline || (docDefault?.date ? `${docDefault.date}T${docDefault.time || "23:59"}` : "")
            const now = new Date().toISOString()
            const pubUpdates: Record<string, unknown> = {
                approval_status: "approved",
                published_at: now,
                deadline: dl,
                task_status: "assigned",
                published_by_account_id: callerAccountId,
            }
            // Preserve original first publish timestamp (never overwrite)
            if (!item.first_published_at) pubUpdates.first_published_at = now
            // Process sequentially to prevent document-level race conditions when saving
            await handleUpdate(docId, item.id, pubUpdates)
            // Fire-and-forget notification for each published item
            const team = item.workstream || "Technology"
            notifyPublished(item.action || "Actionable", team, docId, item.actionable_id || item.id)
        }
        toast.success(`Published ${pending.length} actionables to tracker`)
    }, [handleUpdate, docDeadlineDefaults, callerAccountId])

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

    // Pending / Rejected / Approved splits
    const [pendingCollapsed, setPendingCollapsed] = React.useState(false)
    const [approvedCollapsed, setApprovedCollapsed] = React.useState(true)
    const [rejectedCollapsed, setRejectedCollapsed] = React.useState(false)

    const pendingItems = React.useMemo(() => filtered.filter(e => e.item.approval_status === "pending"), [filtered])
    const rejectedItems = React.useMemo(() => filtered.filter(e => e.item.approval_status === "rejected"), [filtered])
    const approvedItems = React.useMemo(() => {
        const items = filtered.filter(e => e.item.approval_status === "approved")
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
                        <h1 className="flex items-center gap-2 text-sm font-semibold">
                            <Shield className="h-4 w-4 text-primary" />
                            Actionables
                        </h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                            <span className="px-2 py-0.5 rounded bg-yellow-400/10 text-yellow-400 font-mono">{formatNumber(stats.pending)} pending</span>
                            <span className="px-2 py-0.5 rounded bg-blue-400/10 text-blue-400 font-mono">{formatNumber(stats.published)} in tracker</span>
                            <span className="px-2 py-0.5 rounded bg-red-400/10 text-red-400 font-mono">{formatNumber(stats.rejected)} rejected</span>
                            <span className="px-2 py-0.5 rounded bg-purple-400/10 text-purple-400 font-mono">{formatNumber(stats.total)} total</span>
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
                            {/* Searchable document filter */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowDocFilterMenu(prev => !prev)}
                                    className="bg-muted/30 text-[10px] rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground max-w-[180px] flex items-center gap-1 truncate"
                                >
                                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="truncate">{docFilter === "all" ? "All documents" : (allDocs.find(d => d.doc_id === docFilter)?.doc_name || "All")}</span>
                                    <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 ml-auto" />
                                </button>
                                {showDocFilterMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => { setShowDocFilterMenu(false); setDocFilterSearch("") }} />
                                        <div className="absolute left-0 top-full mt-1 z-50 bg-background border border-border rounded-md shadow-lg min-w-[240px] max-h-[280px] flex flex-col">
                                            <div className="p-1.5 border-b border-border/40">
                                                <div className="relative">
                                                    <Search className="absolute left-2 top-[6px] h-3 w-3 text-muted-foreground/50" />
                                                    <input
                                                        value={docFilterSearch}
                                                        onChange={e => setDocFilterSearch(e.target.value)}
                                                        placeholder="Search documents..."
                                                        className="w-full bg-muted/30 text-xs rounded px-2 py-1 pl-6 border border-border/40 focus:border-primary focus:outline-none"
                                                        autoFocus
                                                    />
                                                </div>
                                            </div>
                                            <div className="overflow-y-auto flex-1 py-1">
                                                <button
                                                    className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2", docFilter === "all" && "bg-primary/10 text-primary")}
                                                    onClick={() => { setDocFilter("all"); setShowDocFilterMenu(false); setDocFilterSearch("") }}
                                                >
                                                    All documents
                                                </button>
                                                {allDocs
                                                    .filter(d => !docFilterSearch.trim() || d.doc_name.toLowerCase().includes(docFilterSearch.toLowerCase()))
                                                    .map(d => (
                                                    <button
                                                        key={d.doc_id}
                                                        className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 truncate", docFilter === d.doc_id && "bg-primary/10 text-primary")}
                                                        onClick={() => { setDocFilter(d.doc_id); setShowDocFilterMenu(false); setDocFilterSearch("") }}
                                                    >
                                                        <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                                                        <span className="truncate">{d.doc_name}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1.5 px-2.5 text-xs"
                                onClick={() => setShowCreateForm(true)}
                                disabled={allDocs.length === 0}
                            >
                                <Plus className="h-3.5 w-3.5" />
                                Add
                            </Button>
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

                            {/* ========== BY-DOCUMENT VIEW: Unpublished / Active / Rejected sections ========== */}
                            {!loading && (
                                <>
                                    {/* ---- UNPUBLISHED section ---- */}
                                    {pendingItems.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 sticky top-0 z-10 bg-background py-1">
                                                <button className="flex items-center gap-2" onClick={() => setPendingCollapsed(!pendingCollapsed)}>
                                                    {pendingCollapsed
                                                        ? <ChevronRight className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                                                        : <ChevronDown className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                                                    }
                                                    <p className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wider">Unpublished ({pendingItems.length})</p>
                                                </button>
                                                {checkedItems.size > 0 && (
                                                    <>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-6 gap-1 px-2 text-xs text-primary border-primary/30 hover:bg-primary/10"
                                                            onClick={() => {
                                                                const selected = pendingItems.filter(e => checkedItems.has(`${e.docId}-${e.item.id}`))
                                                                handlePublishAll(selected)
                                                                setCheckedItems(new Set())
                                                            }}
                                                        >
                                                            <Send className="h-3 w-3" />
                                                            Publish Selected ({checkedItems.size})
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-6 gap-1 px-2 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                                                            onClick={async () => {
                                                                const selected = pendingItems.filter(e => checkedItems.has(`${e.docId}-${e.item.id}`))
                                                                for (const { item, docId } of selected) {
                                                                    await handleUpdate(docId, item.id, { approval_status: "rejected" })
                                                                }
                                                                toast.success(`Rejected ${selected.length} actionables`)
                                                                setCheckedItems(new Set())
                                                            }}
                                                        >
                                                            <X className="h-3 w-3" />
                                                            Reject Selected ({checkedItems.size})
                                                        </Button>
                                                    </>
                                                )}
                                                <div className="h-px bg-yellow-400/20 flex-1" />
                                            </div>
                                            {!pendingCollapsed && (
                                        <div className="space-y-2">
                                            {Object.entries(byDocument).map(([docId, { docName, entries }]) => {
                                                const pendingEntries = entries.filter(e => e.item.approval_status === "pending")
                                                if (pendingEntries.length === 0) return null
                                                const isCollapsed = collapsedDocs.has(docId)
                                                const docKeys = pendingEntries.map(e => `${docId}-${e.item.id}`)
                                                const allDocChecked = docKeys.length > 0 && docKeys.every(k => checkedItems.has(k))
                                                const docData = allDocs.find(d => d.doc_id === docId)
                                                const docLikScore = docData?.document_likelihood_score || 0
                                                const likDraft = getDocLikDraft(docId, docData || { doc_id: docId, doc_name: docName, actionables: [] })
                                                const bvScore = typeof likDraft.bv?.score === "number" ? likDraft.bv.score : 0
                                                const ppScore = typeof likDraft.pp?.score === "number" ? likDraft.pp.score : 0
                                                const cvScore = typeof likDraft.cv?.score === "number" ? likDraft.cv.score : 0
                                                const draftDocLikScore = Math.max(bvScore, ppScore, cvScore)
                                                const getLikOptions = (key: string) => { const o = getLikOpts(key); return o.length ? o : (FALLBACK_DROPDOWN_OPTIONS[key] || []) }
                                                const pickLikSD = (key: string, label: string): RiskSubDropdown => { const o = getLikOptions(key).find(x => x.label === label); return o ? { label: o.label, score: o.value } : ({} as RiskSubDropdown) }
                                                return (
                                                    <div key={docId} className="border border-border/30 rounded-lg">
                                                        <div className="px-3 py-1.5 bg-muted/40 border-b border-border/30 text-[10px] font-semibold text-muted-foreground flex items-center gap-2 hover:bg-muted/50 transition-colors">
                                                            <input
                                                                type="checkbox"
                                                                checked={allDocChecked}
                                                                onChange={() => {
                                                                    setCheckedItems(prev => {
                                                                        const next = new Set(prev)
                                                                        if (allDocChecked) { docKeys.forEach(k => next.delete(k)) }
                                                                        else { docKeys.forEach(k => next.add(k)) }
                                                                        return next
                                                                    })
                                                                }}
                                                                onClick={e => e.stopPropagation()}
                                                                className="h-3 w-3 rounded border-border accent-primary shrink-0 cursor-pointer"
                                                                title="Select all in this document"
                                                            />
                                                            <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => toggleDoc(docId)}>
                                                                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                                                <FileText className="h-3 w-3" /> {docName}
                                                                <span className="ml-auto text-[10px] text-muted-foreground/60">{pendingEntries.length} pending</span>
                                                            </button>
                                                            <div className="flex items-center gap-1.5 ml-2" onClick={e => e.stopPropagation()}>
                                                                <span className="text-[9px] text-muted-foreground/50">Deadline:</span>
                                                                <input
                                                                    type="date"
                                                                    value={docDeadlineDefaults[docId]?.date || ""}
                                                                    onChange={e => { updateDocDeadline(docId, e.target.value, docDeadlineDefaults[docId]?.time || "23:59"); markDocDirty(docId) }}
                                                                    className="w-[100px] bg-background text-[10px] rounded px-1.5 py-0.5 border border-border/40 focus:border-primary focus:outline-none"
                                                                />
                                                                <input
                                                                    type="time"
                                                                    value={docDeadlineDefaults[docId]?.time || "23:59"}
                                                                    onChange={e => { updateDocDeadline(docId, docDeadlineDefaults[docId]?.date || "", e.target.value); markDocDirty(docId) }}
                                                                    className="w-[65px] bg-background text-[10px] rounded px-1.5 py-0.5 border border-border/40 focus:border-primary focus:outline-none"
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-1.5 ml-2" onClick={e => e.stopPropagation()}>
                                                                <span className="text-[9px] text-muted-foreground/50">Theme:</span>
                                                                <select
                                                                    value={docThemeDefaults[docId] || ""}
                                                                    onChange={e => { updateDocTheme(docId, e.target.value); markDocDirty(docId) }}
                                                                    className="w-[120px] bg-background text-[10px] rounded px-1.5 py-0.5 border border-border/40 focus:border-primary focus:outline-none"
                                                                >
                                                                    <option value="">No default</option>
                                                                    {THEME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                                                </select>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 ml-2" onClick={e => e.stopPropagation()}>
                                                                <span className="text-[9px] text-muted-foreground/50">New Product:</span>
                                                                <select
                                                                    value={docNewProductDefaults[docId] || "No"}
                                                                    onChange={e => { updateDocNewProduct(docId, e.target.value); if (e.target.value === "No") updateDocLiveDate(docId, ""); markDocDirty(docId) }}
                                                                    className="w-[80px] bg-background text-[10px] rounded px-1.5 py-0.5 border border-border/40 focus:border-primary focus:outline-none"
                                                                >
                                                                    <option value="Yes">Yes</option>
                                                                    <option value="No">No</option>
                                                                </select>
                                                            </div>
                                                            {(docNewProductDefaults[docId] || "No") === "Yes" && (
                                                                <div className="flex items-center gap-1.5 ml-2" onClick={e => e.stopPropagation()}>
                                                                    <span className="text-[9px] text-muted-foreground/50">Live Date:</span>
                                                                    <input
                                                                        type="date"
                                                                        value={docLiveDateDefaults[docId] || ""}
                                                                        onChange={e => { updateDocLiveDate(docId, e.target.value); markDocDirty(docId) }}
                                                                        className="w-[100px] bg-background text-[10px] rounded px-1.5 py-0.5 border border-border/40 focus:border-primary focus:outline-none"
                                                                    />
                                                                    {docLiveDateDefaults[docId] && (
                                                                        <span className="text-[9px] text-cyan-400/70 font-mono" title="6-month new product expiry">
                                                                            Exp: {formatDateDMY(computeSixMonthExpiry(docLiveDateDefaults[docId]))}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}
                                                            <div className="flex items-center gap-1.5 ml-2" onClick={e => e.stopPropagation()}>
                                                                <span className="text-[9px] text-muted-foreground/50">Likelihood Owner:</span>
                                                                <select
                                                                    value={getDocOwnerTeam(docId)}
                                                                    onChange={e => {
                                                                        setDocOwnerTeamDrafts(prev => ({ ...prev, [docId]: e.target.value }))
                                                                    }}
                                                                    className="w-[140px] bg-background text-[10px] rounded px-1.5 py-0.5 border border-amber-400/30 focus:border-amber-400 focus:outline-none"
                                                                >
                                                                    <option value="">Any team</option>
                                                                    {getDocTeams(docId).map(t => <option key={t} value={t}>{t}</option>)}
                                                                </select>
                                                                {docOwnerTeamDrafts[docId] !== undefined && docOwnerTeamDrafts[docId] !== (allDocs.find(d => d.doc_id === docId)?.global_likelihood_owner_team || "") && (
                                                                    <button
                                                                        onClick={() => handleSaveOwnerTeam(docId)}
                                                                        disabled={docOwnerTeamSaving.has(docId)}
                                                                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-400/30 transition-colors disabled:opacity-50"
                                                                    >
                                                                        {docOwnerTeamSaving.has(docId) ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
                                                                        Set
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {docGlobalDirty.has(docId) && (
                                                                <button
                                                                    onClick={e => { e.stopPropagation(); handleSaveDocDefaults(docId) }}
                                                                    disabled={docGlobalSaving.has(docId)}
                                                                    className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 border border-emerald-500/30 transition-colors disabled:opacity-50"
                                                                    title="Save defaults to all pending actionables in this document"
                                                                >
                                                                    {docGlobalSaving.has(docId) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                                                    Save to All
                                                                </button>
                                                            )}
                                                        </div>
                                                        {!isCollapsed && (
                                                        <div>
                                                            {isLikelihoodSetter && (
                                                                <div className="px-3 py-2 border-b border-blue-400/20 bg-blue-950/10 flex items-center gap-2 flex-wrap">
                                                                    <span className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider shrink-0">Doc Likelihood:</span>
                                                                    {docLikScore > 0 && <span className="text-[9px] font-mono text-blue-400/70 shrink-0">Current: {docLikScore}</span>}
                                                                    <select value={likDraft.bv?.label || ""} onChange={e => setDocLikDraft(docId, "bv", pickLikSD("likelihood_business_volume", e.target.value))} className="bg-background text-[10px] rounded px-1.5 py-0.5 border border-blue-400/30 focus:border-blue-400 focus:outline-none">
                                                                        <option value="">— Business Vol —</option>
                                                                        {getLikOptions("likelihood_business_volume").map(o => <option key={o.value} value={o.label}>{o.label}</option>)}
                                                                    </select>
                                                                    <select value={likDraft.pp?.label || ""} onChange={e => setDocLikDraft(docId, "pp", pickLikSD("likelihood_products_processes", e.target.value))} className="bg-background text-[10px] rounded px-1.5 py-0.5 border border-blue-400/30 focus:border-blue-400 focus:outline-none">
                                                                        <option value="">— Products —</option>
                                                                        {getLikOptions("likelihood_products_processes").map(o => <option key={o.value} value={o.label}>{o.label}</option>)}
                                                                    </select>
                                                                    <select value={likDraft.cv?.label || ""} onChange={e => setDocLikDraft(docId, "cv", pickLikSD("likelihood_compliance_violations", e.target.value))} className="bg-background text-[10px] rounded px-1.5 py-0.5 border border-blue-400/30 focus:border-blue-400 focus:outline-none">
                                                                        <option value="">— Violations —</option>
                                                                        {getLikOptions("likelihood_compliance_violations").map(o => <option key={o.value} value={o.label}>{o.label}</option>)}
                                                                    </select>
                                                                    {draftDocLikScore > 0 && <span className="text-[9px] font-mono text-blue-300/70">→ Score: {draftDocLikScore}</span>}
                                                                    <button
                                                                        onClick={() => handleSaveDocLikelihood(docId)}
                                                                        disabled={docLikSaving.has(docId) || draftDocLikScore === 0}
                                                                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-400/30 transition-colors disabled:opacity-50"
                                                                    >
                                                                        {docLikSaving.has(docId) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                                                        Set for All
                                                                    </button>
                                                                    {docData?.document_likelihood_updated_by && (
                                                                        <span className="text-[9px] text-muted-foreground/40 italic">Last set by {docData.document_likelihood_updated_by}</span>
                                                                    )}
                                                                </div>
                                                            )}
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
                                                                    isChecked={checkedItems.has(`${docId}-${item.id}`)}
                                                                    onCheck={() => toggleChecked(`${docId}-${item.id}`)}
                                                                    docDefaultDeadline={docDeadlineDefaults[docId]?.date || ""}
                                                                    docDefaultDeadlineTime={docDeadlineDefaults[docId]?.time || "23:59"}
                                                                    docDefaultTheme={docThemeDefaults[docId] || ""}
                                                                    docDefaultNewProduct={docNewProductDefaults[docId] || ""}
                                                                    docDefaultLiveDate={docLiveDateDefaults[docId] || ""}
                                                                    callerRole={callerRole}
                                                                    callerAccountId={callerAccountId}
                                                                    callerTeam={callerTeam}
                                                                    docLikelihoodScore={docLikScore}
                                                                />
                                                            ))}
                                                        </div>
                                                        </div>
                                                        )}
                                                    </div>
                                                )
                                            })}

                                        </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ---- REJECTED section ---- */}
                                    {rejectedItems.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 sticky top-0 z-10 bg-background py-1">
                                                <button className="flex items-center gap-2" onClick={() => setRejectedCollapsed(!rejectedCollapsed)}>
                                                    {rejectedCollapsed
                                                        ? <ChevronRight className="h-3.5 w-3.5 text-red-400 shrink-0" />
                                                        : <ChevronDown className="h-3.5 w-3.5 text-red-400 shrink-0" />
                                                    }
                                                    <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">Rejected ({rejectedItems.length})</p>
                                                </button>
                                                {rejCheckedItems.size > 0 && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-6 gap-1 px-2 text-xs text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                                                        onClick={async () => {
                                                            const keys = Array.from(rejCheckedItems)
                                                            const toRepublish = rejectedItems.filter(e => keys.includes(`${e.docId}-${e.item.id}`))
                                                            for (const { item, docId } of toRepublish) {
                                                                await handleUpdate(docId, item.id, { approval_status: "pending", published_at: "", task_status: "", deadline: "" })
                                                            }
                                                            toast.success(`Republished ${toRepublish.length} actionable${toRepublish.length > 1 ? "s" : ""} to unpublished`)
                                                            setRejCheckedItems(new Set())
                                                        }}
                                                    >
                                                        <Send className="h-3 w-3" />
                                                        Republish Selected ({rejCheckedItems.size})
                                                    </Button>
                                                )}
                                                <div className="h-px bg-red-400/20 flex-1" />
                                            </div>
                                            {!rejectedCollapsed && (
                                                <div className="space-y-2">
                                                    {Object.entries(byDocument).map(([docId, { docName, entries }]) => {
                                                        const rejEntries = entries.filter(e => e.item.approval_status === "rejected")
                                                        if (rejEntries.length === 0) return null
                                                        const isCollapsed = collapsedDocs.has(`rejected-${docId}`)
                                                        const rejDocKeys = rejEntries.map(e => `${docId}-${e.item.id}`)
                                                        const allRejDocChecked = rejDocKeys.length > 0 && rejDocKeys.every(k => rejCheckedItems.has(k))
                                                        return (
                                                            <div key={docId} className="border border-red-400/15 rounded-lg">
                                                                <div className="px-3 py-1.5 bg-red-400/5 border-b border-red-400/15 text-[10px] font-semibold text-muted-foreground flex items-center gap-2 hover:bg-red-400/10 transition-colors">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={allRejDocChecked}
                                                                        onChange={() => {
                                                                            setRejCheckedItems(prev => {
                                                                                const next = new Set(prev)
                                                                                if (allRejDocChecked) { rejDocKeys.forEach(k => next.delete(k)) }
                                                                                else { rejDocKeys.forEach(k => next.add(k)) }
                                                                                return next
                                                                            })
                                                                        }}
                                                                        onClick={e => e.stopPropagation()}
                                                                        className="h-3 w-3 rounded border-border accent-primary shrink-0 cursor-pointer"
                                                                        title="Select all rejected in this document"
                                                                    />
                                                                    <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => toggleDoc(`rejected-${docId}`)}>
                                                                        {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                                                        <FileText className="h-3 w-3 text-red-400/60" /> {docName}
                                                                        <span className="ml-auto text-[10px] text-muted-foreground/60">{rejEntries.length} rejected</span>
                                                                    </button>
                                                                </div>
                                                                {!isCollapsed && (
                                                                    <div className="p-2 space-y-2">
                                                                        {rejEntries.map(({ item, docId: dId, docName: dName }) => (
                                                                            <ActionableCard key={`${dId}-${item.id}`} item={item} docId={dId} docName={dName} onUpdate={handleUpdate} onDelete={handleDelete} onSourceClick={handleSourceClick} isSelected={selectedItemKey === `${dId}-${item.id}`} onSelect={() => { setSelectedItemKey(`${dId}-${item.id}`); if (pdfDocId !== dId) { setPdfDocId(dId); setPdfDocName(dName) } }} isChecked={rejCheckedItems.has(`${dId}-${item.id}`)} onCheck={() => toggleRejChecked(`${dId}-${item.id}`)} docDefaultDeadline={docDeadlineDefaults[dId]?.date || ""} docDefaultDeadlineTime={docDeadlineDefaults[dId]?.time || "23:59"} docDefaultTheme={docThemeDefaults[dId] || ""} docDefaultNewProduct={docNewProductDefaults[dId] || ""} docDefaultLiveDate={docLiveDateDefaults[dId] || ""} callerRole={callerRole} callerAccountId={callerAccountId} callerTeam={callerTeam} docLikelihoodScore={allDocs.find(d => d.doc_id === dId)?.document_likelihood_score} />
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )
                                                    })}

                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ---- PUBLISHED section ---- */}
                                    {approvedItems.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setApprovedCollapsed(!approvedCollapsed)}>
                                                {approvedCollapsed
                                                    ? <ChevronRight className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                                    : <ChevronDown className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                                }
                                                <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Published ({approvedItems.length})</p>
                                                <div className="h-px bg-emerald-400/20 flex-1" />
                                            </div>
                                            {!approvedCollapsed && (
                                                <div className="space-y-2">
                                                    {Object.entries(byDocument).map(([docId, { docName, entries }]) => {
                                                        const approvedEntries = entries.filter(e => e.item.approval_status === "approved")
                                                        if (approvedEntries.length === 0) return null
                                                        const isCollapsed = collapsedDocs.has(`approved-${docId}`)
                                                        return (
                                                            <div key={docId} className="space-y-1.5">
                                                                <div className="flex items-center gap-2 pt-2 pb-1 cursor-pointer" onClick={() => toggleDoc(`approved-${docId}`)}>
                                                                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                                                    <FileText className="h-3.5 w-3.5 text-emerald-500/60 shrink-0" />
                                                                    <span className="text-[10px] font-semibold text-foreground/70 truncate">{docName}</span>
                                                                    <span className="text-[10px] text-muted-foreground/40 font-mono">{approvedEntries.length}</span>
                                                                    <div className="h-px bg-border/30 flex-1" />
                                                                </div>
                                                                {!isCollapsed && approvedEntries.map(({ item, docId: dId, docName: dName }) => (
                                                                    <ActionableCard key={`${dId}-${item.id}`} item={item} docId={dId} docName={dName} onUpdate={handleUpdate} onDelete={handleDelete} onSourceClick={handleSourceClick} isSelected={selectedItemKey === `${dId}-${item.id}`} onSelect={() => { setSelectedItemKey(`${dId}-${item.id}`); if (pdfDocId !== dId) { setPdfDocId(dId); setPdfDocName(dName) } }} isChecked={false} onCheck={() => {}} docDefaultDeadline={docDeadlineDefaults[dId]?.date || ""} docDefaultDeadlineTime={docDeadlineDefaults[dId]?.time || "23:59"} docDefaultTheme={docThemeDefaults[dId] || ""} docDefaultNewProduct={docNewProductDefaults[dId] || ""} docDefaultLiveDate={docLiveDateDefaults[dId] || ""} callerRole={callerRole} callerAccountId={callerAccountId} callerTeam={callerTeam} docLikelihoodScore={allDocs.find(d => d.doc_id === dId)?.document_likelihood_score} />
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
                                    <span className="text-[10px] font-medium text-foreground truncate">
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
