"use client"

import * as React from "react"
import type { TestingItem, TestingRole } from "@/lib/types"
import { useTestingItems } from "@/lib/use-testing-items"
import { uploadTestingEvidence, fetchTestingMakers } from "@/lib/testing-api"
import { toast } from "sonner"
import {
    ChevronDown, ChevronRight, Send, Clock, Calendar,
    AlertTriangle, CheckCircle2, Timer, User, Loader2,
    Paperclip, MessageSquare, Upload, XCircle, FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"

/* ───── Status styles ───── */
const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
    pending_assignment:  { label: "Pending",          color: "text-gray-400",    bg: "bg-gray-400/10" },
    assigned_to_tester:  { label: "Assigned",         color: "text-blue-400",    bg: "bg-blue-400/10" },
    tester_review:       { label: "Tester Review",    color: "text-indigo-400",  bg: "bg-indigo-400/10" },
    assigned_to_maker:   { label: "With Maker",       color: "text-purple-400",  bg: "bg-purple-400/10" },
    maker_open:          { label: "Open",             color: "text-amber-400",   bg: "bg-amber-400/10" },
    checker_review:      { label: "Checker Review",   color: "text-teal-400",    bg: "bg-teal-400/10" },
    active:              { label: "Active",           color: "text-cyan-400",    bg: "bg-cyan-400/10" },
    maker_closed:        { label: "Closed",           color: "text-emerald-400", bg: "bg-emerald-400/10" },
    tester_validation:   { label: "Validation",       color: "text-orange-400",  bg: "bg-orange-400/10" },
    passed:              { label: "Passed",           color: "text-green-400",   bg: "bg-green-400/10" },
    rejected_to_maker:   { label: "Rejected",         color: "text-red-400",     bg: "bg-red-400/10" },
    delayed:             { label: "Delayed",          color: "text-rose-400",    bg: "bg-rose-400/10" },
}

function StatusBadge({ status }: { status: string }) {
    const s = STATUS_STYLES[status] || STATUS_STYLES.pending_assignment
    return <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0", s.color, s.bg)}>{s.label}</span>
}

function formatDateDMY(iso: string): string {
    if (!iso) return ""
    const parts = iso.split("T")[0].split("-")
    if (parts.length !== 3) return iso
    return `${parts[2]}-${parts[1]}-${parts[0]}`
}

function DeadlineInfo({ deadline }: { deadline: string }) {
    if (!deadline) return null
    const now = new Date()
    const dl = new Date(deadline)
    const diffMs = dl.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />Overdue by {Math.abs(diffDays)}d</span>
    if (diffDays <= 7) return <span className="text-[10px] text-amber-400 font-semibold flex items-center gap-0.5"><Timer className="h-3 w-3" />{diffDays}d left</span>
    return <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Clock className="h-3 w-3" />{diffDays}d left</span>
}

/* ───── Card Props ───── */
interface TestingActionableCardProps {
    item: TestingItem
    isSelected: boolean
    onSelect: () => void
    isChecked: boolean
    onCheck: () => void
    onAssign?: (itemId: string) => void
    sectionColor?: string
    userRole?: string
    userName?: string
}

export function TestingActionableCard({
    item, isSelected, onSelect, isChecked, onCheck, onAssign, sectionColor = "text-teal-400",
    userRole = "", userName = "",
}: TestingActionableCardProps) {
    const [expanded, setExpanded] = React.useState(false)

    // Action hooks
    const {
        handleForwardToMaker, handleMakerDecision, handleCheckerConfirm,
        handleCheckerReject, handleTesterVerdict, handleAddComment, handleUpdate,
    } = useTestingItems({ autoLoad: false })

    // Local form state for expanded working surface
    const [commentText, setCommentText] = React.useState("")
    const [submitting, setSubmitting] = React.useState(false)
    const [makerDeadlineInput, setMakerDeadlineInput] = React.useState("")
    const [operationalDeadline, setOperationalDeadline] = React.useState("")
    const [testerInstructions, setTesterInstructions] = React.useState(item.tester_instructions || "")
    const [uploadingEvidence, setUploadingEvidence] = React.useState(false)
    const fileInputRef = React.useRef<HTMLInputElement>(null)

    // Maker selection for tester forward
    const [makers, setMakers] = React.useState<{ id: string; name: string; email: string; role: string }[]>([])
    const [selectedMakerId, setSelectedMakerId] = React.useState("")
    const [loadingMakers, setLoadingMakers] = React.useState(false)

    // Determine role context
    const isTestingHead = userRole === "testing_head"
    const isTester = userRole === "tester"
    const isMaker = userRole === "testing_maker"
    const isChecker = userRole === "testing_checker"

    // Load makers when tester needs to forward
    React.useEffect(() => {
        if (expanded && isTester && ["assigned_to_tester", "tester_review"].includes(item.status) && makers.length === 0) {
            setLoadingMakers(true)
            fetchTestingMakers()
                .then(r => setMakers(r.makers || []))
                .catch(() => {})
                .finally(() => setLoadingMakers(false))
        }
    }, [expanded, isTester, item.status, makers.length])

    // Comment handler
    const handleComment = async () => {
        if (!commentText.trim()) return
        setSubmitting(true)
        try {
            await handleAddComment(item.id, userName, userRole, commentText.trim())
            setCommentText("")
        } finally { setSubmitting(false) }
    }

    // Evidence upload handler
    const handleEvidenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setUploadingEvidence(true)
        try {
            const result = await uploadTestingEvidence(item.id, file)
            // Update the item with the new evidence file
            const newFiles = [...(item.testing_evidence_files || []), result]
            await handleUpdate(item.id, { testing_evidence_files: newFiles })
            toast.success(`Uploaded: ${file.name}`)
        } catch {
            toast.error("Evidence upload failed")
        } finally {
            setUploadingEvidence(false)
            if (fileInputRef.current) fileInputRef.current.value = ""
        }
    }

    // Forward to maker (tester role)
    const handleForward = async () => {
        if (!selectedMakerId) { toast.error("Select a maker first"); return }
        if (!operationalDeadline) { toast.error("Set an operational deadline for the maker"); return }
        const maker = makers.find(m => m.id === selectedMakerId)
        if (!maker) return
        setSubmitting(true)
        try {
            await handleForwardToMaker(item.id, maker.id, maker.name, userName)
            // Also set the operational deadline and instructions
            await handleUpdate(item.id, {
                maker_deadline: operationalDeadline,
                tester_instructions: testerInstructions,
            })
            toast.success(`Forwarded to ${maker.name}`)
        } finally { setSubmitting(false) }
    }

    // Maker open/close decision
    const handleMakerOpen = async () => {
        if (!makerDeadlineInput) { toast.error("Set a date for the open action"); return }
        setSubmitting(true)
        try {
            await handleMakerDecision(item.id, "open", userName, makerDeadlineInput)
        } finally { setSubmitting(false) }
    }

    const handleMakerClose = async () => {
        const files = item.testing_evidence_files || []
        const comments = item.testing_comments || []
        if (files.length === 0) { toast.error("Evidence upload is mandatory to close"); return }
        if (comments.length === 0 && !commentText.trim()) { toast.error("Comments are mandatory to close"); return }
        setSubmitting(true)
        try {
            // Add comment if provided inline
            if (commentText.trim()) {
                await handleAddComment(item.id, userName, userRole, commentText.trim())
                setCommentText("")
            }
            await handleMakerDecision(item.id, "close", userName)
        } finally { setSubmitting(false) }
    }

    // Checker approve / reject
    const handleCheckerApprove = async () => {
        setSubmitting(true)
        try { await handleCheckerConfirm(item.id, userName) } finally { setSubmitting(false) }
    }
    const handleCheckerRejectAction = async () => {
        setSubmitting(true)
        try { await handleCheckerReject(item.id, userName, commentText.trim() || undefined) } finally { setSubmitting(false) }
    }

    // Tester verdict
    const handlePass = async () => {
        setSubmitting(true)
        try { await handleTesterVerdict(item.id, "pass", userName) } finally { setSubmitting(false) }
    }
    const handleReject = async () => {
        setSubmitting(true)
        try { await handleTesterVerdict(item.id, "reject", userName, commentText.trim() || undefined) } finally { setSubmitting(false) }
    }

    return (
        <div
            className={cn(
                "border rounded-lg overflow-hidden transition-all",
                isSelected ? "border-primary/30 ring-1 ring-primary/10" : "border-border/30",
                item.status === "passed" && "border-green-500/20 opacity-70",
                item.is_testing_delayed && "border-rose-500/20",
            )}
        >
            {/* Header row */}
            <div className="flex items-center gap-1.5 px-3 py-2 hover:bg-muted/20 transition-colors">
                <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={onCheck}
                    onClick={e => e.stopPropagation()}
                    className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0 cursor-pointer"
                />
                <button onClick={() => { setExpanded(!expanded); onSelect() }} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    <StatusBadge status={item.status} />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/90 leading-relaxed truncate">{item.source_actionable_text || "—"}</p>
                    </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                    {item.source_workstream && <span className="text-[10px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/30">{item.source_workstream}</span>}
                    {item.testing_deadline && <DeadlineInfo deadline={item.testing_deadline} />}
                    {item.assigned_tester_name && (
                        <span className="text-[10px] text-blue-400 flex items-center gap-0.5 shrink-0"><User className="h-3 w-3" />{item.assigned_tester_name}</span>
                    )}
                    {item.status === "pending_assignment" && onAssign && (
                        <button onClick={(e) => { e.stopPropagation(); onAssign(item.id) }} className="p-1 rounded hover:bg-teal-400/10 text-muted-foreground/40 hover:text-teal-400 transition-colors" title="Assign tester">
                            <Send className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {item.status === "passed" && <span className="text-xs px-1.5 py-0.5 rounded font-medium text-green-400 bg-green-400/10">Passed</span>}
                </div>
            </div>

            {/* ── Expanded Working Surface ── */}
            {expanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-border/20 pt-2.5">
                    {/* Source info & ID */}
                    <div className="flex items-start gap-3">
                        <div className="flex-1">
                            <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Actionable Text</p>
                            <p className="text-xs text-foreground/80">{item.source_actionable_text || "—"}</p>
                        </div>
                        <div className="shrink-0 text-right"><p className="text-[10px] font-mono text-muted-foreground/50">{item.id}</p></div>
                    </div>

                    {/* Detail grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <div><span className="text-muted-foreground/60">Source Doc: </span><span className="text-foreground/80">{item.source_doc_name || "—"}</span></div>
                        <div><span className="text-muted-foreground/60">Theme: </span><span className="text-foreground/80">{item.source_theme || "—"}</span></div>
                        <div><span className="text-muted-foreground/60">Tranche 3: </span><span className="text-foreground/80">{item.source_tranche3 || "—"}</span></div>
                        <div><span className="text-muted-foreground/60">New Product: </span><span className={cn("text-foreground/80", item.source_new_product === "Yes" && "text-cyan-400 font-medium")}>{item.source_new_product || "—"}</span></div>
                        <div><span className="text-muted-foreground/60">Team: </span><span className="text-foreground/80">{item.source_workstream || "—"}</span></div>
                        <div><span className="text-muted-foreground/60">Section: </span><span className="text-foreground/80 capitalize">{item.testing_section || "—"}</span></div>
                    </div>

                    {/* Assignment info */}
                    {(item.assigned_tester_name || item.assigned_maker_name) && (
                        <div className="rounded-md border border-border/20 p-2 bg-muted/5">
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider mb-1.5">Assignment</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                {item.assigned_tester_name && <div><span className="text-muted-foreground/60">Tester: </span><span className="text-blue-400">{item.assigned_tester_name}</span></div>}
                                {item.assigned_maker_name && <div><span className="text-muted-foreground/60">Maker: </span><span className="text-purple-400">{item.assigned_maker_name}</span></div>}
                                {item.maker_decision && <div><span className="text-muted-foreground/60">Maker Decision: </span><span className="text-foreground/80 uppercase font-medium">{item.maker_decision}</span></div>}
                                {item.rework_count > 0 && <div><span className="text-muted-foreground/60">Rework Count: </span><span className="text-rose-400 font-medium">{item.rework_count}</span></div>}
                            </div>
                        </div>
                    )}

                    {/* ── Deadlines ── */}
                    <div className="rounded-md border border-border/20 p-2 bg-muted/5 space-y-1">
                        <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider mb-1">Deadlines</p>
                        {/* Final completion deadline (Testing Head → Tester) — visible to tester */}
                        {item.testing_deadline && (isTester || isTestingHead) && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />Final Completion Deadline: <span className="text-foreground/80 font-mono">{formatDateDMY(item.testing_deadline)}</span>
                                <DeadlineInfo deadline={item.testing_deadline} />
                            </div>
                        )}
                        {/* Operational deadline (Tester → Maker) — visible to maker */}
                        {item.maker_deadline && (isMaker || isTester || isChecker) && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />Operational Deadline (Maker): <span className="text-foreground/80 font-mono">{formatDateDMY(item.maker_deadline)}</span>
                                {item.maker_deadline_confirmed && <CheckCircle2 className="h-3 w-3 text-green-400 ml-1" />}
                                <DeadlineInfo deadline={item.maker_deadline} />
                            </div>
                        )}
                        {item.computed_deadline && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />New Product Deadline (live+6mo): <span className="text-foreground/80 font-mono">{formatDateDMY(item.computed_deadline)}</span>
                            </div>
                        )}
                        {item.source_product_live_date && item.testing_section === "product" && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />New Product Live Date: <span className="text-foreground/80 font-mono">{formatDateDMY(item.source_product_live_date)}</span>
                            </div>
                        )}
                    </div>

                    {/* ── Instructions (from tester to maker) ── */}
                    {item.tester_instructions && (
                        <div className="rounded-md border border-border/20 p-2 bg-muted/5">
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider mb-1">Tester Instructions</p>
                            <p className="text-xs text-foreground/80 whitespace-pre-wrap">{item.tester_instructions}</p>
                        </div>
                    )}

                    {/* ── Evidence Files ── */}
                    <div className="rounded-md border border-border/20 p-2 bg-muted/5">
                        <div className="flex items-center gap-2 mb-1.5">
                            <Paperclip className="h-3 w-3 text-muted-foreground" />
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Evidence Files</p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{(item.testing_evidence_files || []).length}</span>
                        </div>
                        {(item.testing_evidence_files || []).length > 0 ? (
                            <div className="space-y-1">
                                {item.testing_evidence_files.map((f, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs">
                                        <FileText className="h-3 w-3 text-muted-foreground" />
                                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{f.name}</a>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-[10px] text-muted-foreground/50 italic">No evidence uploaded yet</p>
                        )}
                        {/* Upload button — available for Maker and Tester */}
                        {(isMaker || isTester) && !["passed", "delayed"].includes(item.status) && (
                            <div className="mt-2">
                                <input ref={fileInputRef} type="file" className="hidden" onChange={handleEvidenceUpload} />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploadingEvidence}
                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
                                >
                                    {uploadingEvidence ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                    Upload Evidence
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Comments / Notes ── */}
                    <div className="rounded-md border border-border/20 p-2 bg-muted/5">
                        <div className="flex items-center gap-2 mb-1.5">
                            <MessageSquare className="h-3 w-3 text-muted-foreground" />
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Comments & Notes</p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{(item.testing_comments || []).length}</span>
                        </div>
                        {(item.testing_comments || []).length > 0 && (
                            <div className="space-y-1.5 mb-2 max-h-40 overflow-y-auto">
                                {item.testing_comments.map((c, i) => (
                                    <div key={i} className="text-xs border-l-2 border-border/30 pl-2">
                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                                            <span className="font-medium text-foreground/70">{c.author}</span>
                                            <span className="capitalize text-muted-foreground/40">{(c.role || "").replace("_", " ")}</span>
                                            {c.timestamp && <span className="ml-auto">{formatDateDMY(c.timestamp)}</span>}
                                        </div>
                                        <p className="text-foreground/80">{c.text}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Add comment — available for all roles when item is not passed */}
                        {item.status !== "passed" && (
                            <div className="flex items-center gap-1.5">
                                <input
                                    value={commentText}
                                    onChange={e => setCommentText(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter" && commentText.trim()) handleComment() }}
                                    placeholder="Add a comment..."
                                    className="flex-1 bg-background text-xs rounded px-2 py-1.5 border border-border/30 focus:border-border focus:outline-none"
                                />
                                <button
                                    onClick={handleComment}
                                    disabled={!commentText.trim() || submitting}
                                    className="text-[10px] px-2 py-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium disabled:opacity-40"
                                >
                                    {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send"}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Delay warning ── */}
                    {item.is_testing_delayed && (
                        <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-400/5 rounded px-2 py-1.5 border border-rose-400/20">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span className="font-semibold">This item is DELAYED</span>
                            {item.delay_detected_at && <span className="text-[10px] text-rose-400/60 ml-auto">since {formatDateDMY(item.delay_detected_at)}</span>}
                        </div>
                    )}

                    {/* ══════════ ROLE-SPECIFIC ACTION CONTROLS ══════════ */}

                    {/* Testing Head: Assign button (pending items) */}
                    {isTestingHead && item.status === "pending_assignment" && onAssign && (
                        <div className="flex items-center gap-2 pt-1 border-t border-border/10">
                            <button
                                onClick={() => onAssign(item.id)}
                                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 transition-colors font-medium"
                            >
                                <Send className="h-3 w-3" /> Assign Tester
                            </button>
                        </div>
                    )}

                    {/* Tester: Forward to maker with operational deadline + instructions */}
                    {isTester && ["assigned_to_tester", "tester_review"].includes(item.status) && (
                        <div className="space-y-2 pt-2 border-t border-border/10">
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Forward to Maker</p>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] text-muted-foreground mb-0.5 block">Select Maker</label>
                                    {loadingMakers ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : (
                                        <select
                                            value={selectedMakerId}
                                            onChange={e => setSelectedMakerId(e.target.value)}
                                            className="w-full bg-muted/30 text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                                        >
                                            <option value="">Select...</option>
                                            {makers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    )}
                                </div>
                                <div>
                                    <label className="text-[10px] text-muted-foreground mb-0.5 block">Operational Deadline (for Maker)</label>
                                    <input
                                        type="datetime-local"
                                        value={operationalDeadline}
                                        onChange={e => setOperationalDeadline(e.target.value)}
                                        className="w-full bg-muted/30 text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] text-muted-foreground mb-0.5 block">Instructions (optional)</label>
                                <textarea
                                    value={testerInstructions}
                                    onChange={e => setTesterInstructions(e.target.value)}
                                    rows={2}
                                    className="w-full bg-muted/30 text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none resize-none"
                                    placeholder="Working notes or instructions for the maker..."
                                />
                            </div>
                            <button
                                onClick={handleForward}
                                disabled={!selectedMakerId || !operationalDeadline || submitting}
                                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors font-medium disabled:opacity-40"
                            >
                                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                Forward to Maker
                            </button>
                        </div>
                    )}

                    {/* Maker: Open / Close decision */}
                    {isMaker && ["assigned_to_maker", "rejected_to_maker"].includes(item.status) && (
                        <div className="space-y-2 pt-2 border-t border-border/10">
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Maker Decision</p>
                            {/* Open action */}
                            <div className="space-y-1.5">
                                <div>
                                    <label className="text-[10px] text-muted-foreground mb-0.5 block">Open Date</label>
                                    <input
                                        type="datetime-local"
                                        value={makerDeadlineInput}
                                        onChange={e => setMakerDeadlineInput(e.target.value)}
                                        className="w-64 bg-muted/30 text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleMakerOpen}
                                        disabled={!makerDeadlineInput || submitting}
                                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors font-medium disabled:opacity-40"
                                    >
                                        {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                                        Keep Open
                                    </button>
                                    <button
                                        onClick={handleMakerClose}
                                        disabled={submitting}
                                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium disabled:opacity-40"
                                    >
                                        {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                        Close (requires evidence + comment)
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Checker: Approve / Reject open-date */}
                    {isChecker && item.status === "checker_review" && (
                        <div className="space-y-2 pt-2 border-t border-border/10">
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Open-Date Approval</p>
                            <p className="text-xs text-muted-foreground">
                                Maker proposed date: <span className="text-foreground/80 font-mono">{formatDateDMY(item.maker_deadline)}</span>
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleCheckerApprove}
                                    disabled={submitting}
                                    className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium disabled:opacity-40"
                                >
                                    {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                    Approve Date
                                </button>
                                <button
                                    onClick={handleCheckerRejectAction}
                                    disabled={submitting}
                                    className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium disabled:opacity-40"
                                >
                                    {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                    Reject Date
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Tester: Pass / Reject verdict (after maker close or active) */}
                    {isTester && ["maker_closed", "tester_validation"].includes(item.status) && (
                        <div className="space-y-2 pt-2 border-t border-border/10">
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">Tester Verdict</p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handlePass}
                                    disabled={submitting}
                                    className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors font-medium disabled:opacity-40"
                                >
                                    {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                    Pass
                                </button>
                                <button
                                    onClick={handleReject}
                                    disabled={submitting}
                                    className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium disabled:opacity-40"
                                >
                                    {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                    Reject (Rework)
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Cycle year for tranche3 */}
                    {item.testing_section === "tranche3" && item.testing_cycle_year > 0 && (
                        <div className="text-[10px] text-muted-foreground/50">Testing Cycle Year: <span className="font-mono">{item.testing_cycle_year}</span></div>
                    )}

                    {/* Timestamps footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/10 text-[10px] text-muted-foreground/40">
                        <span>Created: {formatDateDMY(item.created_at)}</span>
                        {item.passed_at && <span>Passed: {formatDateDMY(item.passed_at)}</span>}
                    </div>
                </div>
            )}
        </div>
    )
}
