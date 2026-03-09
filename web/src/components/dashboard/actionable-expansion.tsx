"use client"

import * as React from "react"
import { ActionableItem, ActionableComment, TeamWorkflow } from "@/lib/types"
import { CommentThread } from "@/components/shared/comment-thread"
import {
    AlertTriangle, CheckCircle2, XCircle, Flag, RotateCcw, Paperclip
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
    onUpdate,
    onAddComment,
    onBypassApprove,
    onBypassDisapprove,
    formatDate,
}: ActionableExpansionProps) {
    // Use team workflow data if available, otherwise use parent item data
    const tw = teamWorkflow
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
            {!teamName && (item.bypass_tag || taskStatus === "bypass_approved") && userRole === "compliance_officer" && (
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
            {taskStatus === "review" && (
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

                        {/* Row 1: Theme + Tranche3 + Impact */}
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                <p className="text-xs text-foreground/80">{item.theme || "—"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Tranche 3</p>
                                <p className="text-xs text-foreground/80">{item.tranche3 || "—"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Impact</p>
                                <p className="text-xs text-foreground/80">{item.impact_dropdown?.label || "—"}</p>
                            </div>
                        </div>

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

                        {/* Risk Summary */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Risk Summary</p>
                                <span className="text-[10px] text-muted-foreground/40">Auto-calculated</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Likelihood</p>
                                    <p className="text-sm font-semibold tabular-nums text-blue-400">
                                        {(item.overall_likelihood_score ?? item.likelihood_score ?? 0) > 0 ? (item.overall_likelihood_score ?? item.likelihood_score) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Impact</p>
                                    <p className="text-sm font-semibold tabular-nums text-pink-400">
                                        {(item.overall_impact_score ?? item.impact_score ?? 0) > 0 ? (item.overall_impact_score ?? item.impact_score) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Inherent Risk Score</p>
                                    <p className="text-sm font-semibold tabular-nums text-orange-400">
                                        {(item.inherent_risk_score ?? 0) > 0 ? item.inherent_risk_score!.toFixed(0) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                    </p>
                                    {item.inherent_risk_label && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{item.inherent_risk_label}</p>}
                                </div>
                                <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                    <p className="text-[10px] text-muted-foreground/50 mb-0.5">Overall Control Score</p>
                                    <p className="text-sm font-semibold tabular-nums text-teal-400">
                                        {(item.overall_control_score ?? item.control_score ?? 0) > 0 ? (item.overall_control_score ?? item.control_score)!.toFixed(1) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                    </p>
                                </div>
                            </div>
                            <div className="rounded-lg border border-border/40 bg-background/60 p-2">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] text-muted-foreground/50 mb-0.5">Residual Risk Score</p>
                                        <p className="text-sm font-semibold tabular-nums text-foreground">
                                            {(item.residual_risk_score ?? 0) > 0 ? item.residual_risk_score!.toFixed(1) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                        </p>
                                    </div>
                                    {(item.residual_risk_interpretation || item.residual_risk_label) && (() => {
                                        const interp = item.residual_risk_interpretation || item.residual_risk_label || ""
                                        const style = RESIDUAL_RISK_INTERPRETATION_STYLES[interp]
                                        return (
                                            <span className={cn(
                                                "text-xs font-medium px-2 py-0.5 rounded-full",
                                                style?.bg ?? "bg-muted/30",
                                                style?.text ?? "text-foreground"
                                            )}>
                                                {interp}
                                            </span>
                                        )
                                    })()}
                                    {!(item.residual_risk_interpretation || item.residual_risk_label) && (
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
                <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                    <CommentThread
                        comments={comments}
                        currentUser={userName}
                        currentRole={userRole}
                        onAddComment={onAddComment}
                    />
                </div>
            </div>
        </div>
    )
}
