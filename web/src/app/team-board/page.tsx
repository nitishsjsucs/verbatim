"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { AuthGuard, getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { useSession } from "@/lib/auth-client"
import {
    fetchAllActionables,
    updateActionable,
    uploadEvidence,
    deleteEvidence,
} from "@/lib/api"
import { ActionableItem, ActionablesResult, TaskStatus, ActionableComment, RiskSubDropdown, getTeamView, isMultiTeam, getClassification, MIXED_TEAM_CLASSIFICATION } from "@/lib/types"
import { CommentThread } from "@/components/shared/comment-thread"
import {
    ChevronDown, ChevronRight, Loader2, Search,
    FileText, Paperclip, Calendar, CheckCircle2,
    ArrowRight, RotateCcw, Trash2,
    MessageSquare, ExternalLink, Download, Upload, Undo2,
    SortAsc, SortDesc,
    LayoutDashboard, AlertTriangle, XCircle, Users, Flag,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
    safeStr, formatDateShort as formatDate, formatTime, deadlineCategory,
    TASK_STATUS_STYLES, ALL_TASK_STATUSES, STATUS_SORT_ORDER,
    WORKSTREAM_COLORS, getWorkstreamClass, RESIDUAL_RISK_INTERPRETATION_STYLES,
} from "@/lib/status-config"
import { useTeams } from "@/lib/use-teams"
import { DropdownOption, useDropdownConfig } from "@/lib/use-dropdown-config"
import { ProgressBar, EvidencePopover, EvidenceFileList, SectionDivider, StatCell, StatDivider, EmptyState } from "@/components/shared/status-components"

// ─── Task Row (expandable with evidence + comments) ─────────────────────────

const TaskRow = React.memo(function TaskRow({ entry, gridCols, onUpdate, onUpload, onStatusTransition, onRevert, onTagIncorrect, userName }: {
    entry: { item: ActionableItem; docId: string; docName: string }
    gridCols: string
    onUpdate: (docId: string, itemId: string, updates: Record<string, unknown>) => Promise<void>
    onUpload: (docId: string, itemId: string, file: File) => void
    onStatusTransition: (docId: string, item: ActionableItem) => void
    onRevert: (docId: string, item: ActionableItem) => void
    onTagIncorrect: (docId: string, item: ActionableItem) => void
    userName: string
}) {
    const { item, docId, docName } = entry
    const [expanded, setExpanded] = React.useState(false)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const { getOptions, getLabel } = useDropdownConfig()

    // Fallback dropdown options for risk assessment
    const FALLBACK_RISK_OPTIONS: Record<string, DropdownOption[]> = React.useMemo(() => ({
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
    }), [])

    const getSafeOptions = React.useCallback((key: string): DropdownOption[] => {
        const opts = getOptions(key)
        return opts.length ? opts : (FALLBACK_RISK_OPTIONS[key] || [])
    }, [getOptions, FALLBACK_RISK_OPTIONS])

    const pickSubDropdown = React.useCallback((configKey: string, selectedLabel: string): RiskSubDropdown => {
        const opt = getSafeOptions(configKey).find(o => o.label === selectedLabel)
        return opt ? { label: opt.label, score: opt.value } : ({} as RiskSubDropdown)
    }, [getSafeOptions])

    // Handler to save a single risk sub-dropdown and recompute scores
    const handleRiskFieldChange = React.useCallback(async (field: string, value: RiskSubDropdown) => {
        const updated = { ...item, [field]: value }
        const safeScore = (d: RiskSubDropdown | undefined) => (d && typeof d.score === "number" ? d.score : 0)
        const likScore = Math.max(safeScore(updated.likelihood_business_volume), safeScore(updated.likelihood_products_processes), safeScore(updated.likelihood_compliance_violations))
        const impScore = safeScore(updated.impact_dropdown) ** 2
        const monS = safeScore(updated.control_monitoring)
        const effS = safeScore(updated.control_effectiveness)
        const ctrlScore = (monS || effS) ? (monS + effS) / 2 : 0
        const inherent = likScore * impScore
        const allFilled = !!(updated.likelihood_business_volume?.label && updated.likelihood_products_processes?.label && updated.likelihood_compliance_violations?.label && updated.impact_dropdown?.label && updated.control_monitoring?.label && updated.control_effectiveness?.label)
        const residual = allFilled ? inherent + ctrlScore : 0
        const classify = (s: number) => s <= 0 ? "" : s <= 3 ? "Low" : s <= 9 ? "Medium" : "High"
        const interp = !allFilled ? "" : residual < 13 ? "Satisfactory (Low)" : residual < 28 ? "Improvement Needed (Medium)" : "Weak (High)"
        await onUpdate(docId, item.id, {
            [field]: value,
            likelihood_score: likScore,
            control_score: ctrlScore,
            overall_likelihood_score: Math.round(likScore),
            overall_impact_score: Math.round(impScore),
            overall_control_score: ctrlScore,
            inherent_risk_score: inherent,
            inherent_risk_label: classify(inherent),
            residual_risk_score: residual,
            residual_risk_label: allFilled ? classify(residual) : "",
            residual_risk_interpretation: interp,
        })
    }, [item, docId, onUpdate])

    const taskStatus = (item.task_status || "assigned") as TaskStatus
    const statusCfg = TASK_STATUS_STYLES[taskStatus] || TASK_STATUS_STYLES.assigned
    const isOverdue = item.deadline ? new Date(item.deadline).getTime() < Date.now() : false
    const canAdvance = taskStatus === "assigned" || taskStatus === "in_progress" || taskStatus === "reworking" || taskStatus === "reviewer_rejected"
    const isCompleted = taskStatus === "completed"
    const isUnderTeamReview = taskStatus === "team_review"
    const isUnderReview = taskStatus === "review"
    const isTaggedIncorrectly = taskStatus === "tagged_incorrectly" || taskStatus === "bypass_approved"
    const isReadOnly = isCompleted || isUnderTeamReview || isUnderReview || isTaggedIncorrectly
    const files = item.evidence_files || []

    // Check if revert is allowed (within 10 minutes of submission)
    // Use a tick state to force re-render when the 10-min window expires
    const [, setRevertTick] = React.useState(0)
    const canRevert = React.useMemo(() => {
        if (taskStatus !== "team_review") return false
        const submittedAt = (item as any).submitted_at
        if (submittedAt) {
            const elapsed = Date.now() - new Date(submittedAt).getTime()
            return elapsed < 10 * 60 * 1000 // 10 minutes
        }
        return true // If no timestamp, allow revert
    }, [taskStatus, item])

    // Auto-disable revert after 10 minutes by scheduling a re-render
    React.useEffect(() => {
        if (taskStatus !== "team_review") return
        const submittedAt = (item as any).submitted_at
        if (!submittedAt) return
        const elapsed = Date.now() - new Date(submittedAt).getTime()
        const remaining = 10 * 60 * 1000 - elapsed
        if (remaining <= 0) return // Already expired
        const timer = setTimeout(() => setRevertTick(t => t + 1), remaining + 100)
        return () => clearTimeout(timer)
    }, [taskStatus, item])

    const handleAddComment = async (text: string) => {
        // Auto-transition from assigned to in_progress on comment
        const updates: Record<string, unknown> = {}
        if (taskStatus === "assigned") {
            updates.task_status = "in_progress"
        }
        const newComment: ActionableComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            author: userName,
            role: "team_member",
            text,
            timestamp: new Date().toISOString(),
        }
        const existing = item.comments || []
        updates.comments = [...existing, newComment]
        await onUpdate(docId, item.id, updates)
        if (taskStatus === "assigned") {
            toast.success("Task auto-started (In Progress)")
        }
    }

    const handleUploadClick = () => {
        inputRef.current?.click()
    }

    const handleFileSelected = async (file: File) => {
        // Auto-transition from assigned to in_progress on upload
        if (taskStatus === "assigned") {
            await onUpdate(docId, item.id, { task_status: "in_progress" })
            toast.success("Task auto-started (In Progress)")
        }
        onUpload(docId, item.id, file)
    }

    const handleDeleteFile = async (idx: number) => {
        const file = files[idx]
        if (!file) return
        const updated = [...files]
        updated.splice(idx, 1)
        try {
            await onUpdate(docId, item.id, { evidence_files: updated })
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update task")
            return
        }

        const storedName = file.stored_name || file.url?.split("/").pop()
        if (storedName) {
            try {
                await deleteEvidence(storedName)
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "File removed from task but failed to delete from storage")
                return
            }
        }

        toast.success("File removed")
    }

    const commentCount = (item.comments || []).length

    return (
        <div className={cn("border-b border-border/10", isCompleted && "opacity-60")}>
            {/* Main row — columns match dashboard: Risk | Actionable | Status | Deadline | Time | Evidence | Published | Action */}
            <div
                className="grid gap-0 items-center hover:bg-muted/10 transition-colors px-3 cursor-pointer"
                style={{ gridTemplateColumns: gridCols }}
                onClick={() => setExpanded(!expanded)}
            >
                {/* Actionable text */}
                <div className="py-1.5 px-2 min-w-0 flex items-center gap-1.5">
                    {expanded
                        ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                        : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                    <span className="text-xs text-foreground/90 truncate">{safeStr(item.action)}</span>
                    {item.actionable_id && (
                        <span className="shrink-0 text-[9px] font-mono text-muted-foreground/40 bg-muted/30 px-1 py-0.5 rounded border border-border/20">{item.actionable_id}</span>
                    )}
                    {isMultiTeam(item) && (
                        <span className={cn("shrink-0 px-1.5 py-0.5 rounded text-xs font-medium", getWorkstreamClass(MIXED_TEAM_CLASSIFICATION))} title={`Teams: ${item.assigned_teams!.join(", ")}`}>
                            {MIXED_TEAM_CLASSIFICATION}
                        </span>
                    )}
                    {commentCount > 0 && (
                        <span className="shrink-0 flex items-center gap-0.5 text-xs text-primary/60">
                            <MessageSquare className="h-2.5 w-2.5" />{commentCount}
                        </span>
                    )}
                </div>

                {/* Status */}
                <div className="py-1.5 px-1 text-center">
                    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", statusCfg.bg, statusCfg.text)}>
                        {statusCfg.label}
                    </span>
                </div>

                {/* Deadline date */}
                <div className="py-1.5 px-1 text-center">
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border border-dashed flex items-center justify-center gap-1",
                        isOverdue ? "text-red-400 border-red-400/30" : "text-muted-foreground/70 border-muted-foreground/20"
                    )}>
                        <Calendar className="h-2.5 w-2.5" />
                        {formatDate(item.deadline)}
                    </span>
                </div>

                {/* Deadline time */}
                <div className="py-1.5 px-1 text-center">
                    <span className="text-[10px] text-muted-foreground/60">
                        {formatTime(item.deadline)}
                    </span>
                </div>

                {/* Evidence */}
                <div className="py-1.5 px-1 flex justify-center" onClick={e => e.stopPropagation()}>
                    <EvidencePopover files={files} taskStatus={taskStatus} />
                </div>

                {/* Published date */}
                <div className="py-1.5 px-1 text-center">
                    <span className="text-[10px] text-muted-foreground/60">
                        {formatDate(item.published_at)}
                    </span>
                </div>

                {/* Action */}
                <div className="py-1.5 px-1 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                    {canAdvance && (
                        <button
                            onClick={() => onStatusTransition(docId, item)}
                            className={cn(
                                "inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded transition-colors font-medium",
                                taskStatus === "assigned"
                                    ? "bg-slate-500/15 text-slate-400 hover:bg-slate-500/25"
                                    : "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                            )}
                        >
                            {taskStatus === "assigned" && <><ArrowRight className="h-2.5 w-2.5" /> Start</>}
                            {taskStatus === "in_progress" && <><CheckCircle2 className="h-2.5 w-2.5" /> Submit</>}
                            {taskStatus === "reworking" && <><RotateCcw className="h-2.5 w-2.5" /> Resubmit</>}
                            {taskStatus === "reviewer_rejected" && <><RotateCcw className="h-2.5 w-2.5" /> Rework</>}
                        </button>
                    )}
                    {isUnderTeamReview && (
                        <div className="flex items-center justify-center gap-1">
                            {canRevert && (
                                <button
                                    onClick={() => onRevert(docId, item)}
                                    className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 transition-colors font-medium"
                                    title="Revert to In Progress (available for 10 min after submission)"
                                >
                                    <Undo2 className="h-2.5 w-2.5" /> Revert
                                </button>
                            )}
                        </div>
                    )}
                    {isUnderReview && (
                        <span className="text-[10px] text-blue-400">CO Review</span>
                    )}
                    {isCompleted && (
                        <span className="text-[10px] text-emerald-400">Done</span>
                    )}
                    {/* Tagged Incorrectly button — available when not completed, not currently flagged/under bypass review */}
                    {!isCompleted && !isTaggedIncorrectly && !item.bypass_tag && (
                        <button
                            onClick={() => onTagIncorrect(docId, item)}
                            className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded text-muted-foreground/40 hover:bg-orange-500/10 hover:text-orange-500 transition-colors"
                            title="Flag as incorrectly assigned to your team"
                        >
                            <Flag className="h-2.5 w-2.5" />
                        </button>
                    )}
                    {isTaggedIncorrectly && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium" title="Awaiting reviewer/CO decision">
                            <Flag className="h-2.5 w-2.5" /> Awaiting Review
                        </span>
                    )}
                    {item.bypass_tag && !isTaggedIncorrectly && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium" title="Flagged as incorrectly assigned">
                            <Flag className="h-2.5 w-2.5" /> Flagged
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded: 2-column layout */}
            {expanded && (
                <div className="border border-border/30 rounded-lg mx-3 my-2 px-6 py-4 space-y-3">
                    {/* Bypass tag banner — item is currently flagged and under review */}
                    {(item.bypass_tag || isTaggedIncorrectly) && (
                        <div className="flex items-start gap-2.5 bg-orange-500/5 border border-orange-500/20 rounded-lg px-4 py-3">
                            <Flag className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Tagged as Incorrectly Assigned</p>
                                <p className="text-xs text-foreground/80">
                                    {taskStatus === "bypass_approved"
                                        ? "Your flag was approved by the Team Reviewer and is now with the Compliance Officer for final decision."
                                        : "This task has been flagged as incorrectly assigned to your team. The Team Reviewer will review this flag."}
                                </p>
                                {item.bypass_tagged_by && (
                                    <p className="text-xs text-muted-foreground/50 mt-1">Flagged by {item.bypass_tagged_by}{item.bypass_tagged_at ? ` on ${formatDate(item.bypass_tagged_at)}` : ""}</p>
                                )}
                                {item.bypass_approved_by && (
                                    <p className="text-xs text-muted-foreground/50">Approved by reviewer: {item.bypass_approved_by}{item.bypass_approved_at ? ` on ${formatDate(item.bypass_approved_at)}` : ""}</p>
                                )}
                            </div>
                        </div>
                    )}
                    {/* CO disapproval banner — CO rejected the wrongly-tagged request */}
                    {item.bypass_disapproval_reason && (
                        <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-0.5">Wrongly Tagged Request Disapproved by Compliance Officer</p>
                                <p className="text-xs text-foreground/80">{item.bypass_disapproval_reason}</p>
                                {item.bypass_disapproved_by && (
                                    <p className="text-xs text-muted-foreground/50 mt-1">By {item.bypass_disapproved_by}{item.bypass_disapproved_at ? ` on ${formatDate(item.bypass_disapproved_at)}` : ""}</p>
                                )}
                            </div>
                        </div>
                    )}
                    {/* Reviewer bypass rejection banner — reviewer rejected the wrongly-tagged request */}
                    {item.bypass_reviewer_rejection_reason && (
                        <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
                            <XCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-0.5">Wrongly Tagged Request Rejected by Reviewer</p>
                                <p className="text-xs text-foreground/80">{item.bypass_reviewer_rejection_reason}</p>
                                {item.bypass_reviewer_rejected_by && (
                                    <p className="text-xs text-muted-foreground/50 mt-1">By {item.bypass_reviewer_rejected_by}{item.bypass_reviewer_rejected_at ? ` on ${formatDate(item.bypass_reviewer_rejected_at)}` : ""}</p>
                                )}
                            </div>
                        </div>
                    )}
                    {/* Rejection reason banner */}
                    {taskStatus === "reworking" && item.rejection_reason && (
                        <div className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                            <div className="shrink-0 mt-0.5">
                                <XCircle className="h-4 w-4 text-red-400" />
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-0.5">Rejection Reason</p>
                                <p className="text-xs text-foreground/80">{item.rejection_reason}</p>
                            </div>
                        </div>
                    )}

                    {/* Circular Source Information */}
                    <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5 mb-4">
                        <p className="text-xs font-semibold text-foreground/70">Circular Source Information</p>
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

                    {/* Risk Assessment — Theme/Tranche/Impact read-only, Likelihood+Control editable by member */}
                    <div className="space-y-2.5 rounded-lg border border-border/30 p-3 bg-muted/5">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground/70">Risk Assessment</p>
                            <span className="text-[10px] text-muted-foreground/40 italic">Likelihood &amp; Control editable · Theme, Tranche, Impact set by Compliance</span>
                        </div>

                        {/* Row 1: Theme + Tranche3 + Impact (read-only from CO) */}
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Theme</p>
                                <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.theme || <span className="text-muted-foreground/40 italic">—</span>}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Tranche 3</p>
                                <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.tranche3 || <span className="text-muted-foreground/40 italic">—</span>}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Impact</p>
                                <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.impact_dropdown?.label || <span className="text-muted-foreground/40 italic">—</span>}</p>
                            </div>
                        </div>

                        {/* Row 2: Likelihood (3 dropdowns) — member editable */}
                        <div className="rounded-md border border-border/20 p-2 bg-muted/10">
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wider">Likelihood Assessment</p>
                                <span className="text-[10px] font-mono text-blue-400/60">Overall: {item.likelihood_score ?? "—"} (MAX of 3)</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_business_volume") || "Business Volumes"}</p>
                                    {!isReadOnly ? (
                                        <select value={item.likelihood_business_volume?.label || ""} onChange={e => handleRiskFieldChange("likelihood_business_volume", pickSubDropdown("likelihood_business_volume", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("likelihood_business_volume").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.likelihood_business_volume?.label || "—"}</p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_products_processes") || "Products & Processes"}</p>
                                    {!isReadOnly ? (
                                        <select value={item.likelihood_products_processes?.label || ""} onChange={e => handleRiskFieldChange("likelihood_products_processes", pickSubDropdown("likelihood_products_processes", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("likelihood_products_processes").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.likelihood_products_processes?.label || "—"}</p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("likelihood_compliance_violations") || "Compliance Violations"}</p>
                                    {!isReadOnly ? (
                                        <select value={item.likelihood_compliance_violations?.label || ""} onChange={e => handleRiskFieldChange("likelihood_compliance_violations", pickSubDropdown("likelihood_compliance_violations", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-blue-400/30 focus:border-blue-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("likelihood_compliance_violations").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.likelihood_compliance_violations?.label || "—"}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Row 3: Control (2 dropdowns) — member editable */}
                        <div className="rounded-md border border-border/20 p-2 bg-muted/10">
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[10px] font-semibold text-teal-400/80 uppercase tracking-wider">Control Assessment</p>
                                <span className="text-[10px] font-mono text-teal-400/60">Overall: {item.control_score != null ? item.control_score.toFixed(1) : "—"} (avg)</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("control_monitoring") || "Monitoring Mechanism"}</p>
                                    {!isReadOnly ? (
                                        <select value={item.control_monitoring?.label || ""} onChange={e => handleRiskFieldChange("control_monitoring", pickSubDropdown("control_monitoring", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-teal-400/30 focus:border-teal-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("control_monitoring").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.control_monitoring?.label || "—"}</p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground/40 mb-0.5">{getLabel("control_effectiveness") || "Control Effectiveness"}</p>
                                    {!isReadOnly ? (
                                        <select value={item.control_effectiveness?.label || ""} onChange={e => handleRiskFieldChange("control_effectiveness", pickSubDropdown("control_effectiveness", e.target.value))} className="w-full bg-muted/30 text-xs rounded px-2 py-1 border border-teal-400/30 focus:border-teal-400 focus:outline-none text-foreground">
                                            <option value="">— Select —</option>
                                            {getSafeOptions("control_effectiveness").map(opt => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                                        </select>
                                    ) : (
                                        <p className="text-xs text-foreground/80 bg-muted/20 rounded px-2 py-1 border border-border/20 min-h-[28px]">{item.control_effectiveness?.label || "—"}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 2-column: left=impl+evidence+files, right=comments */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-3">
                            <div>
                                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Implementation</p>
                                <p className="text-xs text-foreground/80 whitespace-pre-wrap">{safeStr(item.implementation_notes) || <span className="italic text-muted-foreground/30">No implementation notes</span>}</p>
                            </div>
                            {/* Evidence files */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Paperclip className="h-3.5 w-3.5 text-primary/60" />
                                        <span className="text-xs font-semibold text-foreground/80">Evidence Files</span>
                                        {files.length > 0 && (
                                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{files.length}</span>
                                        )}
                                    </div>
                                    {!isReadOnly && (
                                        <button
                                            onClick={handleUploadClick}
                                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
                                        >
                                            <Upload className="h-3 w-3" /> Upload File
                                        </button>
                                    )}
                                    <input ref={inputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = "" }} />
                                </div>

                                {files.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-4 bg-background rounded-lg border border-dashed border-border/40">
                                        <Paperclip className="h-5 w-5 text-muted-foreground/20 mb-1" />
                                        <p className="text-xs text-muted-foreground/40">No evidence files uploaded yet</p>
                                        {!isReadOnly && (
                                            <button
                                                onClick={handleUploadClick}
                                                className="text-xs text-primary hover:underline mt-1"
                                            >
                                                Click to upload
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <EvidenceFileList
                                        files={files}
                                        formatDate={formatDate}
                                        onDelete={!isReadOnly ? handleDeleteFile : undefined}
                                        readOnly={isReadOnly}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Right column: comments */}
                        <div className="border border-border/30 rounded-lg bg-muted/5 p-3">
                            {!isCompleted && (
                                <CommentThread
                                    comments={item.comments || []}
                                    currentUser={userName}
                                    currentRole="team_member"
                                    onAddComment={!isReadOnly ? handleAddComment : undefined}
                                />
                            )}
                            {isCompleted && (item.comments || []).length > 0 && (
                                <CommentThread
                                    comments={item.comments || []}
                                    currentUser={userName}
                                    currentRole="team_member"
                                />
                            )}
                        </div>
                    </div>

                    {/* Source info */}
                    <div className="text-xs text-muted-foreground/30 pt-2 border-t border-border/10">
                        Source: {docName}
                    </div>
                </div>
            )}
        </div>
    )
})

// ─── Main Component ──────────────────────────────────────────────────────────

function TeamBoardContent() {
    const router = useRouter()
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userTeam = getUserTeam(session)
    const isComplianceOfficer = role === "compliance_officer" || role === "admin"
    const userName = session?.user?.name || "Team Member"
    const { getVisibleTeams } = useTeams()

    // Get all teams visible to this user (their team + all descendants)
    const visibleTeams = React.useMemo(
        () => userTeam ? getVisibleTeams(userTeam) : [],
        [userTeam, getVisibleTeams]
    )

    // Redirect compliance officers away from team board
    React.useEffect(() => {
        if (isComplianceOfficer) {
            router.replace("/dashboard")
        }
    }, [isComplianceOfficer, router])

    const [allItems, setAllItems] = React.useState<{ item: ActionableItem; docId: string; docName: string }[]>([])
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [deadlineFilter, setDeadlineFilter] = React.useState<string>("all")
    const [sortBy, setSortBy] = React.useState<string>("deadline")
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())

    const loadData = React.useCallback(async () => {
        try {
            setLoading(true)
            const results = await fetchAllActionables()
            const items: { item: ActionableItem; docId: string; docName: string }[] = []
            const visSet = new Set(visibleTeams)
            for (const r of results) {
                if (!r.actionables) continue
                for (const a of r.actionables) {
                    if (!a.published_at) continue
                    // Include if workstream or any assigned_team is in visible teams
                    const matchesTeam = visSet.has(a.workstream) ||
                        (a.assigned_teams && a.assigned_teams.some(t => visSet.has(t)))
                    if (matchesTeam) {
                        items.push({ item: a, docId: r.doc_id, docName: r.doc_name || r.doc_id })
                    }
                }
            }
            setAllItems(items)
        } catch {
            toast.error("Failed to load tasks")
        } finally {
            setLoading(false)
        }
    }, [visibleTeams])

    React.useEffect(() => { if (!isComplianceOfficer) loadData() }, [loadData, isComplianceOfficer])

    // Project multi-team items to show team-specific status/evidence/comments
    const viewItems = React.useMemo(() => {
        if (!userTeam) return allItems
        return allItems.map(e => ({ ...e, item: getTeamView(e.item, userTeam) }))
    }, [allItems, userTeam])

    const handleUpdate = React.useCallback(async (docId: string, itemId: string, updates: Record<string, unknown>) => {
        try {
            // Always pass team context — backend ignores for single-team items
            const updated = await updateActionable(docId, itemId, updates, userTeam || undefined)
            setAllItems(prev => prev.map(e => e.item.id === itemId ? { ...e, item: { ...e.item, ...updated } } : e))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed")
        }
    }, [userTeam])

    const handleEvidenceUpload = React.useCallback(async (docId: string, itemId: string, file: File) => {
        try {
            const result = await uploadEvidence(file)
            const entry = { name: file.name, url: result.url, uploaded_at: new Date().toISOString(), stored_name: result.stored_name }
            // Use viewItems to get team-projected evidence for multi-team items
            const item = viewItems.find(e => e.item.id === itemId)
            const existing = item?.item.evidence_files || []
            await handleUpdate(docId, itemId, { evidence_files: [...existing, entry] })
            toast.success(`Evidence "${file.name}" uploaded`)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Upload failed")
        }
    }, [viewItems, handleUpdate])

    const handleStatusTransition = React.useCallback(async (docId: string, item: ActionableItem) => {
        const currentStatus = item.task_status || "assigned"
        let nextStatus: TaskStatus | null = null
        const extraUpdates: Record<string, unknown> = {}

        if (currentStatus === "assigned") nextStatus = "in_progress"
        else if (currentStatus === "in_progress") {
            // Member submission: validate all 5 likelihood/control fields are filled
            const missing: string[] = []
            if (!item.likelihood_business_volume?.label) missing.push("Business Volume")
            if (!item.likelihood_products_processes?.label) missing.push("Products & Processes")
            if (!item.likelihood_compliance_violations?.label) missing.push("Compliance Violations")
            if (!item.control_monitoring?.label) missing.push("Monitoring Mechanism")
            if (!item.control_effectiveness?.label) missing.push("Control Effectiveness")
            if (missing.length > 0) {
                toast.error(`Cannot submit — please fill: ${missing.join(", ")}`)
                return
            }
            nextStatus = "team_review"
            extraUpdates.submitted_at = new Date().toISOString()
        }
        else if (currentStatus === "reworking") {
            // Resubmission: same validation
            const missing: string[] = []
            if (!item.likelihood_business_volume?.label) missing.push("Business Volume")
            if (!item.likelihood_products_processes?.label) missing.push("Products & Processes")
            if (!item.likelihood_compliance_violations?.label) missing.push("Compliance Violations")
            if (!item.control_monitoring?.label) missing.push("Monitoring Mechanism")
            if (!item.control_effectiveness?.label) missing.push("Control Effectiveness")
            if (missing.length > 0) {
                toast.error(`Cannot resubmit — please fill: ${missing.join(", ")}`)
                return
            }
            nextStatus = "team_review"
            extraUpdates.submitted_at = new Date().toISOString()
        }
        else if (currentStatus === "reviewer_rejected") {
            nextStatus = "in_progress"
        }

        if (nextStatus) {
            await handleUpdate(docId, item.id, { task_status: nextStatus, ...extraUpdates })
            toast.success(`Task moved to ${TASK_STATUS_STYLES[nextStatus].label}`)
        }
    }, [handleUpdate])

    const handleRevert = React.useCallback(async (docId: string, item: ActionableItem) => {
        await handleUpdate(docId, item.id, { task_status: "in_progress", submitted_at: "" })
        toast.success("Task reverted to In Progress")
    }, [handleUpdate])

    const handleTagIncorrect = React.useCallback(async (docId: string, item: ActionableItem) => {
        await handleUpdate(docId, item.id, {
            task_status: "tagged_incorrectly",
            bypass_tag: true,
            bypass_tagged_at: new Date().toISOString(),
            bypass_tagged_by: userName,
            // Clear any previous disapproval/rejection notes from prior cycles
            bypass_disapproved_by: "",
            bypass_disapproved_at: "",
            bypass_disapproval_reason: "",
            bypass_reviewer_rejected_by: "",
            bypass_reviewer_rejected_at: "",
            bypass_reviewer_rejection_reason: "",
            bypass_approved_by: "",
            bypass_approved_at: "",
        })
        toast.success("Task flagged as incorrectly assigned — Team Reviewer will review")
    }, [handleUpdate, userName])

    // Stats (team-scoped from viewItems which has team-projected statuses)
    const stats = React.useMemo(() => {
        const s = { total: viewItems.length, completed: 0, inProgress: 0, teamReview: 0, review: 0, reworking: 0, reviewerRejected: 0, assigned: 0, highRisk: 0, midRisk: 0, lowRisk: 0, yetToDeadline: 0, delayed30: 0, delayed60: 0, delayed90: 0 }
        for (const e of viewItems) {
            const st = e.item.task_status || "assigned"
            if (st === "completed") s.completed++
            else if (st === "in_progress") s.inProgress++
            else if (st === "team_review") s.teamReview++
            else if (st === "review") s.review++
            else if (st === "reworking") s.reworking++
            else if (st === "reviewer_rejected") s.reviewerRejected++
            else s.assigned++
            const dc = deadlineCategory(e.item.deadline)
            if (dc === "yet") s.yetToDeadline++
            else if (dc === "d30") s.delayed30++
            else if (dc === "d60") s.delayed60++
            else if (dc === "d90") s.delayed90++
        }
        return s
    }, [viewItems])

    // Filter + Sort
    const filtered = React.useMemo(() => {
        let result = viewItems.filter(({ item }) => {
            if (statusFilter !== "all" && (item.task_status || "assigned") !== statusFilter) return false
            if (deadlineFilter !== "all" && deadlineCategory(item.deadline) !== deadlineFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${safeStr(item.action)} ${safeStr(item.implementation_notes)} ${safeStr(item.workstream)}`.toLowerCase()
                if (!s.includes(q)) return false
            }
            return true
        })
        // Sort
        result = [...result].sort((a, b) => {
            let cmp = 0
            if (sortBy === "status") {
                cmp = (STATUS_SORT_ORDER[a.item.task_status || "assigned"] || 3) - (STATUS_SORT_ORDER[b.item.task_status || "assigned"] || 3)
            } else if (sortBy === "deadline") {
                const da = a.item.deadline ? new Date(a.item.deadline).getTime() : Infinity
                const db = b.item.deadline ? new Date(b.item.deadline).getTime() : Infinity
                cmp = da - db
            } else if (sortBy === "published") {
                const pa = a.item.published_at ? new Date(a.item.published_at).getTime() : 0
                const pb = b.item.published_at ? new Date(b.item.published_at).getTime() : 0
                cmp = pb - pa
            }
            return sortDir === "desc" ? -cmp : cmp
        })
        return result
    }, [viewItems, statusFilter, deadlineFilter, searchQuery, sortBy, sortDir])

    // Group: Active (not completed) and Completed
    const activeItems = React.useMemo(() => filtered.filter(e => e.item.task_status !== "completed"), [filtered])
    const completedItems = React.useMemo(() => {
        const items = filtered.filter(e => e.item.task_status === "completed")
        return items.sort((a, b) => {
            const da = a.item.completion_date ? new Date(a.item.completion_date).getTime() : 0
            const db = b.item.completion_date ? new Date(b.item.completion_date).getTime() : 0
            return db - da
        })
    }, [filtered])

    const toggleGroup = (g: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(g)) next.delete(g); else next.add(g)
            return next
        })
    }

    const [activeCollapsed, setActiveCollapsed] = React.useState(true)
    const [completedCollapsed, setCompletedCollapsed] = React.useState(true)
    const [expandedRow, setExpandedRow] = React.useState<string | null>(null)

    if (isComplianceOfficer) {
        return (
            <div className="flex h-screen bg-background items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Redirecting...
            </div>
        )
    }

    // Grid columns: Actionable | Status | Deadline | Time | Evidence | Published | Action
    const gridCols = "minmax(180px,3fr) 100px 100px 70px 80px 90px 90px"

    const renderHeader = () => (
        <div className="grid gap-0 border-b border-border/20 bg-muted/20 px-3" style={{ gridTemplateColumns: gridCols }}>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2">Actionable</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Status</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-2 text-center">Deadline</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Time</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Evidence</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Published</div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider py-2 px-1 text-center">Actions</div>
        </div>
    )

    const renderTaskRow = (entry: { item: ActionableItem; docId: string; docName: string }) => (
        <TaskRow
            key={`${entry.docId}-${entry.item.id}`}
            entry={entry}
            gridCols={gridCols}
            onUpdate={handleUpdate}
            onUpload={handleEvidenceUpload}
            onStatusTransition={handleStatusTransition}
            onRevert={handleRevert}
            onTagIncorrect={handleTagIncorrect}
            userName={userName}
        />
    )

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── Top bar — matches dashboard ── */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
                        <LayoutDashboard className="h-4 w-4 text-primary" />
                        {`My Tasks - ${userTeam || "Team"}`}
                    </h1>
                </div>

                {/* ── Stats row — identical to dashboard ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-3 flex items-center gap-4 overflow-x-auto">
                    <div className="flex items-center gap-4">
                        <StatCell value={stats.total} label="Total" colorClass="text-foreground" />
                        <StatDivider />
                        <StatCell value={stats.completed} label="Completed" colorClass="text-emerald-400" />
                        <StatCell value={stats.inProgress} label="In Progress" colorClass="text-amber-400" />
                        <StatCell value={stats.teamReview} label="Team Review" colorClass="text-teal-400" />
                        <StatCell value={stats.review} label="CO Review" colorClass="text-blue-400" />
                        <StatCell value={stats.reworking} label="Reworking" colorClass="text-orange-400" />
                        <StatCell value={stats.assigned} label="Assigned" colorClass="text-slate-400" />
                        <StatDivider />
                        <StatCell value={stats.yetToDeadline} label="Yet to DL" colorClass="text-emerald-500" />
                        <StatCell value={stats.delayed30} label="Delayed 30d" colorClass="text-amber-500" />
                        <StatCell value={stats.delayed60} label="Delayed 60d" colorClass="text-orange-500" />
                        <StatCell value={stats.delayed90} label="Delayed 90d" colorClass="text-red-500" />
                    </div>

                    <div className="flex-1" />

                    <div className="w-48">
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Overall Progress</p>
                        <ProgressBar completed={stats.completed} total={stats.total} />
                    </div>
                </div>

                {/* ── Filters — identical to dashboard ── */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search tracker..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Status</option>
                        {ALL_TASK_STATUSES.map(s => (
                            <option key={s} value={s}>{TASK_STATUS_STYLES[s].label}</option>
                        ))}
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

                    {(statusFilter !== "all" || deadlineFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => {
                                setStatusFilter("all")
                                setDeadlineFilter("all")
                                setSearchQuery("")
                            }}
                            className="px-2.5 py-1.5 text-xs rounded-md bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/40 focus:border-border"
                        >
                            Clear Filters
                        </button>
                    )}

                    <div className="flex items-center gap-1 ml-auto">
                        <span className="text-xs text-muted-foreground/50">Sort:</span>
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
                            <span className="text-xs">Loading tracker...</span>
                        </div>
                    )}

                    {!loading && viewItems.length === 0 && (
                        <EmptyState
                            icon={<LayoutDashboard className="h-8 w-8 text-muted-foreground" />}
                            title="No published actionables to track"
                            description="No published tasks for your team yet. Contact the compliance officer."
                            className="py-20"
                        />
                    )}

                    {/* ── Active section header — matches dashboard ── */}
                    {!loading && activeItems.length > 0 && (
                        <>
                            <SectionDivider label="Active" count={activeItems.length} icon={<AlertTriangle className="h-3.5 w-3.5" />} borderClass="border-b border-yellow-500/20" textClass="text-yellow-500" collapsed={activeCollapsed} onToggle={() => setActiveCollapsed(!activeCollapsed)} />

                            {!activeCollapsed && (
                                <div className="mb-1">
                                    {/* Column headers */}
                                    {renderHeader()}
                                    {/* Rows */}
                                    {activeItems.map(renderTaskRow)}
                                </div>
                            )}
                        </>
                    )}

                    {/* ── Completed section — matches dashboard ── */}
                    {!loading && completedItems.length > 0 && (
                        <div className="mt-4">
                            <SectionDivider label="Completed" count={completedItems.length} icon={<CheckCircle2 className="h-3.5 w-3.5" />} borderClass="border-y border-border/20" textClass="text-muted-foreground" collapsed={completedCollapsed} onToggle={() => setCompletedCollapsed(!completedCollapsed)} />

                            {!completedCollapsed && (
                                <>
                                    {renderHeader()}
                                    {completedItems.map(renderTaskRow)}
                                </>
                            )}
                        </div>
                    )}

                    {!loading && filtered.length === 0 && viewItems.length > 0 && (
                        <div className="text-center text-xs text-muted-foreground/60 py-12">
                            No actionables match the current filters
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
