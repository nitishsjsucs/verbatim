"use client"

import * as React from "react"
import { ActionableItem, ActionableComment, TeamWorkflow, RiskSubDropdown } from "@/lib/types"
import { DropdownOption, useDropdownConfig } from "@/lib/use-dropdown-config"
import { toast } from "sonner"
import { CommentThread } from "@/components/shared/comment-thread"
import {
    AlertTriangle, CheckCircle2, XCircle, Flag, RotateCcw, Paperclip, Save, Loader2, Pencil
} from "lucide-react"
import { cn } from "@/lib/utils"
import { safeStr, formatDate, RESIDUAL_RISK_INTERPRETATION_STYLES } from "@/lib/status-config"
import { EvidenceFileList } from "@/components/shared/status-components"

interface ActionableExpansionProps {
    // Parent actionable item (contains document metadata and risk assessment)
    item: ActionableItem
    docId: string
    docName: string
    
    // Team-specific workflow data (optional - for multi-team child rows)
    teamWorkflow?: TeamWorkflow
    teamName?: string
    
    // Current user info
    userName: string
    userRole: "compliance_officer" | "team_member" | "team_reviewer" | "team_lead" | "chief"
    
    // Status and state
    taskStatus: string
    bgClassName?: string
    readOnly?: boolean
    
    // Handlers
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>, team?: string) => Promise<void>
    onAddComment: (text: string) => Promise<void>
    onBypassApprove?: (docId: string, item: ActionableItem) => Promise<void>
    onBypassDisapprove?: (docId: string, item: ActionableItem, reason: string, userName: string) => Promise<void>
    
    // Formatters
    formatDate: (date: string | undefined) => string
}

function BypassBannerCOInline({
    item,
    docId,
    taskStatus,
    userName,
    formatDate,
    onBypassApprove,
    onBypassDisapprove,
}: {
    item: ActionableItem
    docId: string
    taskStatus: string
    userName: string
    formatDate: (d: string | undefined) => string
    onBypassApprove?: (docId: string, item: ActionableItem) => Promise<void>
    onBypassDisapprove?: (docId: string, item: ActionableItem, reason: string, userName: string) => Promise<void>
}) {
    const [disapproveReason, setDisapproveReason] = React.useState("")
    const [showDisapproveInput, setShowDisapproveInput] = React.useState(false)

    return (
        <div className="flex items-start gap-2.5 bg-orange-500/5 border border-orange-500/20 rounded-lg px-4 py-3">
            <Flag className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
            <div className="flex-1">
                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Wrongly Tagged Flag — Awaiting Your Decision</p>
                <p className="text-xs text-foreground/80">
                    {taskStatus === "bypass_approved"
                        ? "The Team Reviewer approved this wrongly-tagged flag. Approve to return this item to Actionables (clearing all submissions), or Disapprove to return it to the team member."
                        : "This item has been flagged as incorrectly assigned."}
                </p>
                {item.bypass_tagged_by && (
                    <p className="text-xs text-muted-foreground/50 mt-1">Flagged by {item.bypass_tagged_by}{item.bypass_tagged_at ? ` on ${formatDate(item.bypass_tagged_at)}` : ""}</p>
                )}
                {item.bypass_approved_by && (
                    <p className="text-xs text-muted-foreground/50">Reviewer approved: {item.bypass_approved_by}{item.bypass_approved_at ? ` on ${formatDate(item.bypass_approved_at)}` : ""}</p>
                )}
                {taskStatus === "bypass_approved" && !showDisapproveInput && (
                    <div className="mt-2 flex gap-2">
                        <button
                            onClick={() => onBypassApprove?.(docId, item)}
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium"
                        >
                            <CheckCircle2 className="h-3 w-3" /> Approve — Return to Actionables
                        </button>
                        <button
                            onClick={() => setShowDisapproveInput(true)}
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                        >
                            <XCircle className="h-3 w-3" /> Disapprove — Return to Member
                        </button>
                    </div>
                )}
                {showDisapproveInput && (
                    <div className="mt-2 flex items-center gap-2">
                        <input
                            value={disapproveReason}
                            onChange={e => setDisapproveReason(e.target.value)}
                            placeholder="Reason for disapproving..."
                            className="flex-1 bg-background text-xs rounded-md px-3 py-1.5 border border-red-500/30 focus:border-red-500 focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                            autoFocus
                            onKeyDown={e => {
                                if (e.key === "Enter" && disapproveReason.trim()) {
                                    onBypassDisapprove?.(docId, item, disapproveReason.trim(), userName)
                                    setShowDisapproveInput(false)
                                    setDisapproveReason("")
                                }
                                if (e.key === "Escape") { setShowDisapproveInput(false); setDisapproveReason("") }
                            }}
                        />
                        <button
                            onClick={() => {
                                if (disapproveReason.trim()) {
                                    onBypassDisapprove?.(docId, item, disapproveReason.trim(), userName)
                                    setShowDisapproveInput(false)
                                    setDisapproveReason("")
                                }
                            }}
                            disabled={!disapproveReason.trim()}
                            className="text-xs px-2.5 py-1.5 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Confirm
                        </button>
                        <button
                            onClick={() => { setShowDisapproveInput(false); setDisapproveReason("") }}
                            className="text-xs px-2 py-1.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

export function ActionableExpansion({
    item,
    docId,
    docName,
    teamWorkflow,
    teamName,
    userName,
    userRole,
    taskStatus,
    bgClassName,
    readOnly = false,
    onUpdate,
    onAddComment,
    onBypassApprove,
    onBypassDisapprove,
    formatDate,
}: ActionableExpansionProps) {
    // Dropdown config for editable risk fields
    const { getOptions } = useDropdownConfig()
    const impactOptions = getOptions("impact_dropdown")
    const fallbackImpactLabel = item.impact_dropdown?.label || impactOptions[0]?.label || ""
    const fallbackTranche3 = item.tranche3 || "No"
    const fallbackNewProduct = item.new_product || "No"

    // ── Active section: editable theme / tranche3 / impact / new_product ──
    const [draftTheme, setDraftTheme] = React.useState(item.theme || "")
    const [draftTranche3, setDraftTranche3] = React.useState(fallbackTranche3)
    const [draftNewProduct, setDraftNewProduct] = React.useState(fallbackNewProduct)
    const [draftImpactLabel, setDraftImpactLabel] = React.useState(fallbackImpactLabel)
    const [savingFields, setSavingFields] = React.useState(false)

    React.useEffect(() => {
        setDraftTheme(item.theme || "")
        setDraftTranche3(item.tranche3 || "No")
        setDraftNewProduct(item.new_product || "No")
        setDraftImpactLabel(item.impact_dropdown?.label || impactOptions[0]?.label || "")
    }, [item.id, item.theme, item.tranche3, item.new_product, item.impact_dropdown?.label, impactOptions])

    const activeFieldsDirty = draftTheme !== (item.theme || "") ||
        draftTranche3 !== (item.tranche3 || "No") ||
        draftNewProduct !== (item.new_product || "No") ||
        draftImpactLabel !== (item.impact_dropdown?.label || impactOptions[0]?.label || "")

    const handleSaveActiveFields = React.useCallback(async () => {
        setSavingFields(true)
        try {
            const updates: Record<string, unknown> = {}
            if (draftTheme !== (item.theme || "")) updates.theme = draftTheme
            if (draftTranche3 !== (item.tranche3 || "No")) updates.tranche3 = draftTranche3
            if (draftNewProduct !== (item.new_product || "No")) updates.new_product = draftNewProduct
            if (draftImpactLabel !== (item.impact_dropdown?.label || impactOptions[0]?.label || "")) {
                const opt = impactOptions.find(o => o.label === draftImpactLabel)
                if (opt) {
                    updates.impact_dropdown = { label: opt.label, score: opt.value }
                    updates.overall_impact_score = opt.value ** 2
                }
            }
            if (Object.keys(updates).length > 0) {
                await onUpdate(docId, item.id, updates, teamName)
                toast.success("Fields saved")
            }
        } catch { /* parent handles */ } finally { setSavingFields(false) }
    }, [draftTheme, draftTranche3, draftNewProduct, draftImpactLabel, impactOptions, item, docId, onUpdate, teamName])

    // ── Completed section: edit mode for tranche3 + new_product only ──
    const [completedEditMode, setCompletedEditMode] = React.useState(false)
    const [completedTranche3, setCompletedTranche3] = React.useState(item.tranche3 || "No")
    const [completedNewProduct, setCompletedNewProduct] = React.useState(item.new_product || "No")
    const [savingCompleted, setSavingCompleted] = React.useState(false)

    React.useEffect(() => {
        setCompletedTranche3(item.tranche3 || "No")
        setCompletedNewProduct(item.new_product || "No")
    }, [item.id, item.tranche3, item.new_product])

    const handleSaveCompletedFields = React.useCallback(async () => {
        setSavingCompleted(true)
        try {
            const updates: Record<string, unknown> = {}
            if (completedTranche3 !== (item.tranche3 || "No")) updates.tranche3 = completedTranche3
            if (completedNewProduct !== (item.new_product || "No")) updates.new_product = completedNewProduct
            if (Object.keys(updates).length > 0) {
                await onUpdate(docId, item.id, updates, teamName)
                toast.success("Updated successfully")
            }
            setCompletedEditMode(false)
        } catch { /* parent handles */ } finally { setSavingCompleted(false) }
    }, [completedTranche3, completedNewProduct, item, docId, onUpdate, teamName])

    // CO comment draft state
    const [draftCoComment, setDraftCoComment] = React.useState(item.co_comment || "")
    const [savingComment, setSavingComment] = React.useState(false)
    const isCoCommentDirty = draftCoComment !== (item.co_comment || "")

    React.useEffect(() => {
        setDraftCoComment(item.co_comment || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id])

    const handleSaveCoComment = React.useCallback(async () => {
        setSavingComment(true)
        try {
            await onUpdate(docId, item.id, { co_comment: draftCoComment }, teamName)
        } catch {
            /* toast handled by parent */
        } finally {
            setSavingComment(false)
        }
    }, [draftCoComment, onUpdate, docId, item.id, teamName])
    // Recompute risk scores client-side using new formula so CO tracker always shows correct values
    const safeRiskScore = (d: { score?: number } | null | undefined) => (d && typeof d.score === "number" ? d.score : 0)
    const computedLikScore = Math.max(safeRiskScore(item.likelihood_business_volume), safeRiskScore(item.likelihood_products_processes), safeRiskScore(item.likelihood_compliance_violations))
    const computedImpScore = safeRiskScore(item.impact_dropdown) ** 2
    const computedMonS = safeRiskScore(item.control_monitoring)
    const computedEffS = safeRiskScore(item.control_effectiveness)
    const computedCtrlScore = (computedMonS || computedEffS) ? (computedMonS + computedEffS) / 2 : 0
    const computedInherent = computedLikScore * computedImpScore
    const allRiskFilled = !!(item.likelihood_business_volume?.label && item.likelihood_products_processes?.label && item.likelihood_compliance_violations?.label && item.impact_dropdown?.label && item.control_monitoring?.label && item.control_effectiveness?.label)
    const computedResidual = allRiskFilled ? computedInherent * computedCtrlScore : 0
    const classifyRisk = (s: number) => s <= 0 ? "" : s <= 3 ? "Low" : s <= 9 ? "Medium" : "High"
    const computedResidualLabel = allRiskFilled ? classifyRisk(computedResidual) : ""
    const computedResidualInterp = !allRiskFilled ? "" : computedResidual < 13 ? "Satisfactory (Low)" : computedResidual < 28 ? "Improvement Needed (Medium)" : "Weak (High)"

    // Use team workflow data if available, otherwise use parent item data
    const tw = teamWorkflow
    // Legacy justification fields (kept for backward compat with old data)
    const justification = tw?.justification || item.justification
    const justificationStatus = tw?.justification_status || item.justification_status
    const justificationBy = tw?.justification_by || item.justification_by
    const justificationAt = tw?.justification_at || item.justification_at
    const rejectionReason = tw?.rejection_reason || item.rejection_reason
    const implementationNotes = tw?.implementation_notes || item.implementation_notes
    const evidenceQuote = tw?.evidence_quote || item.evidence_quote
    const evidenceFiles = tw?.evidence_files || item.evidence_files || []
    const comments = tw?.comments || item.comments || []

    return (
        <div className={cn("border-t border-border/10 px-6 py-4 space-y-3", bgClassName)}>
            {/* Banners: justification + rejection */}
            {justification && justificationStatus === "pending_review" && (
                <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-0.5">Justification — Pending Your Review</p>
                        <p className="text-xs text-foreground/80 mb-1">{justification}</p>
                        <p className="text-xs text-muted-foreground/50 mb-2">Submitted by {justificationBy}{justificationAt ? ` on ${formatDate(justificationAt)}` : ""}</p>
                        <button
                            onClick={() => onUpdate(docId, item.id, { justification_status: "reviewed" }, teamName)}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-colors font-medium"
                        >
                            <CheckCircle2 className="h-2.5 w-2.5" /> Acknowledge Justification
                        </button>
                    </div>
                </div>
            )}
            {justification && justificationStatus === "reviewed" && (
                <div className="flex items-start gap-2.5 bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-4 py-3">
                    <CheckCircle2 className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-0.5">Justification — Reviewed</p>
                        <p className="text-xs text-foreground/80">{justification}</p>
                        <p className="text-xs text-muted-foreground/50 mt-1">By {justificationBy}</p>
                    </div>
                </div>
            )}
            {taskStatus === "reworking" && rejectionReason && (
                <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                    <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-0.5">Rejection Reason</p>
                        <p className="text-xs text-foreground/80">{rejectionReason}</p>
                    </div>
                </div>
            )}
            
            {/* Bypass tag banner (only for single-team items, when item is awaiting CO decision) */}
            {!teamName && (item.bypass_tag || taskStatus === "bypass_approved") && userRole === "compliance_officer" && !readOnly && (
                <BypassBannerCOInline
                    item={item}
                    docId={docId}
                    taskStatus={taskStatus}
                    userName={userName}
                    formatDate={formatDate}
                    onBypassApprove={onBypassApprove}
                    onBypassDisapprove={onBypassDisapprove}
                />
            )}
            
            {/* Approve/Reject buttons for items under review */}
            {taskStatus === "review" && !readOnly && (
                <div className="flex items-center gap-3 mb-3">
                    <button
                        onClick={() => {
                            if (teamName) {
                                // Multi-team child row - approve this specific team
                                onUpdate(docId, item.id, { task_status: "completed", completion_date: new Date().toISOString() }, teamName)
                            } else {
                                // Single-team item - approve the whole item
                                onUpdate(docId, item.id, { task_status: "completed", completion_date: new Date().toISOString() })
                            }
                        }}
                        className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium"
                    >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve & Complete
                    </button>
                    <button
                        onClick={() => {
                            // Rejection is handled by parent component via state
                            // This is just a placeholder - actual implementation in parent
                        }}
                        className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                    >
                        <XCircle className="h-3.5 w-3.5" /> Reject for Rework
                    </button>
                </div>
            )}

            {/* 2-column: left=impl+evidence+metadata, right=comments (full height) */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                    {/* For compliance_officer: Actionable ID at top */}
                    {userRole === "compliance_officer" && item.actionable_id && (
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Actionable ID</p>
                            <p className="text-xs font-mono text-foreground/80 bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id}</p>
                        </div>
                    )}
                    
                    {/* Implementation and Evidence - always at top for non-compliance roles */}
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Implementation</p>
                        <p className="text-xs text-foreground/80 whitespace-pre-wrap">{safeStr(implementationNotes) || <span className="italic text-muted-foreground/30">No implementation notes</span>}</p>
                    </div>
                    {userRole === "compliance_officer" && (
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Evidence</p>
                        <p className="text-xs text-foreground/80 whitespace-pre-wrap italic">{safeStr(evidenceQuote) || <span className="text-muted-foreground/30">No evidence</span>}</p>
                    </div>
                    )}

                    {/* Evidence Files - for non-compliance roles, show here before metadata */}
                    {userRole !== "compliance_officer" && evidenceFiles && evidenceFiles.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Paperclip className="h-3.5 w-3.5 text-primary/60" />
                                <span className="text-xs font-semibold text-foreground/80">Evidence Files</span>
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{evidenceFiles.length}</span>
                            </div>
                            <EvidenceFileList
                                files={evidenceFiles}
                                formatDate={formatDate}
                                readOnly
                            />
                        </div>
                    )}

                    {/* For compliance_officer: Circular Source Info before Risk Assessment */}
                    {userRole === "compliance_officer" && (
                        <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="col-span-2">
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable ID</p>
                                    <p className="text-xs text-foreground/80 font-mono bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular ID</p>
                                    <p className="text-xs text-foreground/80 font-mono">{docId || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Title</p>
                                    <p className="text-xs text-foreground/80">{docName || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Issued Date</p>
                                    <p className="text-xs text-foreground/80 font-mono">{item.regulation_issue_date ? formatDate(item.regulation_issue_date) : "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Effective Date</p>
                                    <p className="text-xs text-foreground/80 font-mono">{item.circular_effective_date ? formatDate(item.circular_effective_date) : "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Regulator</p>
                                    <p className="text-xs text-foreground/80">{item.regulator || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable Created</p>
                                    <p className="text-xs text-foreground/80 font-mono">{item.created_at ? formatDate(item.created_at) : "—"}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Risk Assessment Framework — CO only */}
                    {userRole === "compliance_officer" && (
                    <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground/70">Risk Assessment</p>
                        </div>

                        {/* Row 1: Theme + Tranche3 + Impact + New Product — editable for active, read-only for completed */}
                        {!readOnly ? (
                        <>
                        <div className="grid grid-cols-4 gap-2">
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                <input value={draftTheme} onChange={e => setDraftTheme(e.target.value)} className="w-full bg-muted/20 text-xs rounded px-2 py-1 border border-border/30 focus:border-primary focus:outline-none text-foreground" placeholder="Theme" />
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Tranche 3</p>
                                <select value={draftTranche3} onChange={e => setDraftTranche3(e.target.value)} className="w-full bg-muted/20 text-xs rounded px-2 py-1 border border-border/30 focus:border-primary focus:outline-none text-foreground">
                                    <option value="">—</option>
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                </select>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Impact</p>
                                <select value={draftImpactLabel} onChange={e => setDraftImpactLabel(e.target.value)} className="w-full bg-muted/20 text-xs rounded px-2 py-1 border border-border/30 focus:border-primary focus:outline-none text-foreground">
                                    <option value="">—</option>
                                    {impactOptions.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">New Product</p>
                                <select value={draftNewProduct} onChange={e => setDraftNewProduct(e.target.value)} className="w-full bg-muted/20 text-xs rounded px-2 py-1 border border-border/30 focus:border-primary focus:outline-none text-foreground">
                                    <option value="">—</option>
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                </select>
                            </div>
                        </div>
                        {activeFieldsDirty && (
                            <div className="flex justify-end">
                                <button onClick={handleSaveActiveFields} disabled={savingFields} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary/25 font-semibold transition-colors disabled:opacity-50">
                                    {savingFields ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                    {savingFields ? "Saving\u2026" : "Save Fields"}
                                </button>
                            </div>
                        )}
                        </>
                        ) : (
                        <>
                        <div className="grid grid-cols-4 gap-2">
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                <p className="text-xs text-foreground/80">{item.theme || "—"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Tranche 3</p>
                                {completedEditMode ? (
                                    <select value={completedTranche3} onChange={e => setCompletedTranche3(e.target.value)} className="w-full bg-muted/20 text-xs rounded px-2 py-1 border border-primary/40 focus:border-primary focus:outline-none text-foreground">
                                        <option value="">—</option>
                                        <option value="Yes">Yes</option>
                                        <option value="No">No</option>
                                    </select>
                                ) : (
                                    <p className="text-xs text-foreground/80">{item.tranche3 || "—"}</p>
                                )}
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Impact</p>
                                <p className="text-xs text-foreground/80">{item.impact_dropdown?.label || "—"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">New Product</p>
                                {completedEditMode ? (
                                    <select value={completedNewProduct} onChange={e => setCompletedNewProduct(e.target.value)} className="w-full bg-muted/20 text-xs rounded px-2 py-1 border border-primary/40 focus:border-primary focus:outline-none text-foreground">
                                        <option value="">—</option>
                                        <option value="Yes">Yes</option>
                                        <option value="No">No</option>
                                    </select>
                                ) : (
                                    <p className="text-xs text-foreground/80">{item.new_product || "—"}</p>
                                )}
                            </div>
                        </div>
                        {userRole === "compliance_officer" && (
                            <div className="flex justify-end gap-2">
                                {completedEditMode ? (
                                    <>
                                        <button onClick={() => { setCompletedEditMode(false); setCompletedTranche3(item.tranche3 || ""); setCompletedNewProduct(item.new_product || "") }} className="text-xs px-2.5 py-1 rounded-md bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                                        <button onClick={handleSaveCompletedFields} disabled={savingCompleted} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary/25 font-semibold transition-colors disabled:opacity-50">
                                            {savingCompleted ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                            {savingCompleted ? "Saving\u2026" : "Submit"}
                                        </button>
                                    </>
                                ) : (
                                    <button onClick={() => { setCompletedEditMode(true); setCompletedTranche3(item.tranche3 || ""); setCompletedNewProduct(item.new_product || "") }} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-muted/20 text-muted-foreground hover:text-foreground transition-colors">
                                        <Pencil className="h-3 w-3" /> Edit
                                    </button>
                                )}
                            </div>
                        )}
                        </>
                        )}

                        {/* Row 2: Likelihood */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wider">Likelihood</p>
                                <span className="text-[10px] font-mono text-blue-400/60">
                                    Score: {item.likelihood_score != null ? item.likelihood_score : "—"} (MAX of 3)
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">Business Volume</p>
                                    <p className="text-xs text-foreground/80">{item.likelihood_business_volume?.label || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">Products & Processes</p>
                                    <p className="text-xs text-foreground/80">{item.likelihood_products_processes?.label || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">Compliance Violations</p>
                                    <p className="text-xs text-foreground/80">{item.likelihood_compliance_violations?.label || "—"}</p>
                                </div>
                            </div>
                        </div>

                        {/* Row 3: Control */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] font-semibold text-teal-400/80 uppercase tracking-wider">Control</p>
                                <span className="text-[10px] font-mono text-teal-400/60">
                                    Score: {item.control_score != null ? item.control_score.toFixed(1) : "—"} (avg)
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">Monitoring Mechanism</p>
                                    <p className="text-xs text-foreground/80">{item.control_monitoring?.label || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">Control Effectiveness</p>
                                    <p className="text-xs text-foreground/80">{item.control_effectiveness?.label || "—"}</p>
                                </div>
                            </div>
                        </div>

                        {/* Risk Summary — computed client-side with new formula */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Risk Summary</p>
                                <span className="text-[10px] text-muted-foreground/40">Auto-calculated</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Likelihood</p>
                                    <p className="text-sm font-semibold tabular-nums text-blue-400">
                                        {computedLikScore > 0 ? computedLikScore : <span className="text-muted-foreground/40 text-xs">—</span>}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Impact</p>
                                    <p className="text-sm font-semibold tabular-nums text-pink-400">
                                        {computedImpScore > 0 ? computedImpScore : <span className="text-muted-foreground/40 text-xs">—</span>}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Inherent Risk Score</p>
                                    <p className="text-sm font-semibold tabular-nums text-orange-400">
                                        {computedInherent > 0 ? computedInherent.toFixed(0) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                    </p>
                                    {computedInherent > 0 && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{classifyRisk(computedInherent)}</p>}
                                </div>
                                <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Control Score</p>
                                    <p className="text-sm font-semibold tabular-nums text-teal-400">
                                        {computedCtrlScore > 0 ? computedCtrlScore.toFixed(1) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                    </p>
                                </div>
                            </div>
                            <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] text-muted-foreground/50 mb-0.5">Residual Risk Score</p>
                                        <p className="text-sm font-semibold tabular-nums text-foreground">
                                            {allRiskFilled && computedResidual > 0 ? computedResidual.toFixed(1) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                        </p>
                                    </div>
                                    {computedResidualInterp ? (() => {
                                        const style = RESIDUAL_RISK_INTERPRETATION_STYLES[computedResidualInterp]
                                        return (
                                            <span className={cn(
                                                "text-xs font-medium px-2 py-0.5 rounded-full",
                                                style?.bg ?? "bg-muted/30",
                                                style?.text ?? "text-foreground"
                                            )}>
                                                {computedResidualInterp}
                                            </span>
                                        )
                                    })() : (
                                        <span className="text-xs text-muted-foreground/30">—</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    )}

                    {/* For non-compliance roles: Circular Source Info after Risk Assessment */}
                    {userRole !== "compliance_officer" && (
                        <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="col-span-2">
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable ID</p>
                                    <p className="text-xs text-foreground/80 font-mono bg-muted/30 px-2 py-1 rounded border border-border/20 inline-block">{item.actionable_id || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular ID</p>
                                    <p className="text-xs text-foreground/80 font-mono">{docId || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Title</p>
                                    <p className="text-xs text-foreground/80">{docName || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Issued Date</p>
                                    <p className="text-xs text-foreground/80 font-mono">{item.regulation_issue_date ? formatDate(item.regulation_issue_date) : "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Circular Effective Date</p>
                                    <p className="text-xs text-foreground/80 font-mono">{item.circular_effective_date ? formatDate(item.circular_effective_date) : "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Regulator</p>
                                    <p className="text-xs text-foreground/80">{item.regulator || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Actionable Created</p>
                                    <p className="text-xs text-foreground/80 font-mono">{item.created_at ? formatDate(item.created_at) : "—"}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Evidence Files - for compliance_officer, show at bottom */}
                    {userRole === "compliance_officer" && evidenceFiles && evidenceFiles.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Paperclip className="h-3.5 w-3.5 text-primary/60" />
                                <span className="text-xs font-semibold text-foreground/80">Evidence Files</span>
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{evidenceFiles.length}</span>
                            </div>
                            <EvidenceFileList
                                files={evidenceFiles}
                                formatDate={formatDate}
                                readOnly
                            />
                        </div>
                    )}
                </div>
                <div className="space-y-3">
                    {/* Delay Justification — read-only display with approval chain */}
                    {item.delay_justification_member_submitted && (
                        <div className={cn("rounded-lg border p-3 space-y-1.5",
                            item.delay_justification_lead_approved
                                ? "border-emerald-500/20 bg-emerald-500/5"
                                : "border-amber-500/30 bg-amber-500/5"
                        )}>
                            <div className="flex items-center gap-2">
                                {item.delay_justification_lead_approved
                                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                    : <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                                <p className={cn("text-xs font-semibold uppercase tracking-wider", item.delay_justification_lead_approved ? "text-emerald-400" : "text-amber-400")}>
                                    Delay Justification {item.delay_justification_lead_approved ? "— Fully Approved" : "— Pending"}
                                </p>
                            </div>
                            <div className="bg-muted/20 rounded p-2 text-xs">
                                <span className="font-semibold text-foreground/60">Reason: </span>
                                <span className="text-foreground/80">{item.delay_justification}</span>
                                {item.delay_justification_updated_at && <span className="text-muted-foreground/40 ml-1">· {formatDate(item.delay_justification_updated_at)}</span>}
                                {item.delay_justification_updated_by && <span className="text-muted-foreground/40 ml-1">by {item.delay_justification_updated_by}</span>}
                            </div>
                            <div className="flex gap-3">
                                <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", item.delay_justification_member_submitted ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/20 text-muted-foreground/50")}>
                                    Maker: Submitted
                                </span>
                                <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", item.delay_justification_reviewer_approved ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/20 text-muted-foreground/50")}>
                                    Checker: {item.delay_justification_reviewer_approved ? "Approved" : "Pending"}
                                </span>
                                <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", item.delay_justification_lead_approved ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/20 text-muted-foreground/50")}>
                                    Team Head: {item.delay_justification_lead_approved ? "Approved" : "Pending"}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Role-specific comments display (read-only, for CO to see all) */}
                    {userRole === "compliance_officer" && (item.member_comment || item.reviewer_comment || item.lead_comment) && (
                        <div className="rounded-lg border border-border/30 bg-muted/5 p-3 space-y-2">
                            <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">Team Comments</p>
                            {item.member_comment && (
                                <div>
                                    <p className="text-[10px] font-semibold text-foreground/50">Member</p>
                                    <p className="text-xs text-foreground/80">{item.member_comment}</p>
                                </div>
                            )}
                            {item.reviewer_comment && (
                                <div>
                                    <p className="text-[10px] font-semibold text-foreground/50">Reviewer</p>
                                    <p className="text-xs text-foreground/80">{item.reviewer_comment}</p>
                                </div>
                            )}
                            {item.lead_comment && (
                                <div>
                                    <p className="text-[10px] font-semibold text-foreground/50">Lead</p>
                                    <p className="text-xs text-foreground/80">{item.lead_comment}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* CO comment — read-only display in completed section */}
                    {userRole === "compliance_officer" && readOnly && item.co_comment && (
                        <div className="rounded-lg border border-border/30 bg-muted/5 p-3 space-y-1">
                            <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">CO Comment</p>
                            <p className="text-xs text-foreground/80 whitespace-pre-wrap">{item.co_comment}</p>
                        </div>
                    )}

                    {/* CO mandatory comment box — only during review and not read-only */}
                    {userRole === "compliance_officer" && taskStatus === "review" && !readOnly && (
                        <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-semibold text-foreground/70">CO Comment</p>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-semibold">Required before approval</span>
                                </div>
                                {isCoCommentDirty && (
                                    <button
                                        onClick={handleSaveCoComment}
                                        disabled={savingComment}
                                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary/25 font-semibold transition-colors disabled:opacity-50"
                                    >
                                        {savingComment ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                        {savingComment ? "Saving\u2026" : "Save"}
                                    </button>
                                )}
                            </div>
                            <textarea
                                value={draftCoComment}
                                onChange={e => setDraftCoComment(e.target.value)}
                                rows={4}
                                placeholder="Provide your compliance review observations, approval rationale, or rejection reason. This is mandatory before approving or rejecting."
                                className="w-full bg-muted/20 text-xs rounded px-2 py-1.5 border border-border/30 focus:border-primary focus:outline-none text-foreground resize-none"
                            />
                            {item.co_comment && (
                                <p className="text-[10px] text-muted-foreground/40 mt-1">Previously saved: <span className="text-foreground/60">{item.co_comment}</span></p>
                            )}
                        </div>
                    )}

                    {/* Chat thread */}
                    <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                        {userRole === "compliance_officer" && (
                            <p className="text-xs font-semibold text-foreground/50 mb-2">Discussion Thread</p>
                        )}
                        <CommentThread
                            comments={comments}
                            currentUser={userName}
                            currentRole={userRole}
                            onAddComment={taskStatus !== "completed" ? onAddComment : undefined}
                            readOnly={taskStatus === "completed"}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
