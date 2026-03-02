"use client"

import * as React from "react"
import { MessageSquare, Send, Loader2, Trash2, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ActionableComment } from "@/lib/types"
import { ROLE_BADGE } from "@/lib/status-config"

interface CommentThreadProps {
    comments: ActionableComment[]
    currentUser: string
    currentRole: "compliance_officer" | "team_member" | "team_reviewer" | "team_lead"
    onAddComment?: (text: string) => Promise<void>
    onClearChat?: () => Promise<void>
    readOnly?: boolean
}

function formatTimestamp(iso: string): string {
    if (!iso) return ""
    try {
        const d = new Date(iso)
        const now = new Date()
        const diffMs = now.getTime() - d.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        if (diffMins < 1) return "just now"
        if (diffMins < 60) return `${diffMins}m ago`
        const diffHours = Math.floor(diffMins / 60)
        if (diffHours < 24) return `${diffHours}h ago`
        const diffDays = Math.floor(diffHours / 24)
        if (diffDays < 7) return `${diffDays}d ago`
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    } catch {
        return iso
    }
}

export function CommentThread({ comments, currentUser, currentRole, onAddComment, onClearChat, readOnly }: CommentThreadProps) {
    const [draft, setDraft] = React.useState("")
    const [sending, setSending] = React.useState(false)
    const [showClearConfirm, setShowClearConfirm] = React.useState(false)
    const [clearing, setClearing] = React.useState(false)
    const scrollRef = React.useRef<HTMLDivElement>(null)

    // Auto-scroll to bottom when new comments arrive
    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [comments.length])

    const handleSend = async () => {
        const text = draft.trim()
        if (!text || sending) return
        setSending(true)
        try {
            await onAddComment?.(text)
            setDraft("")
        } finally {
            setSending(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const sorted = React.useMemo(() =>
        [...comments].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
        [comments]
    )

    return (
        <div className="flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="h-3.5 w-3.5 text-primary/60" />
                <span className="text-xs font-semibold text-foreground/80">Comments</span>
                {comments.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{comments.length}</span>
                )}
                {onClearChat && comments.length > 0 && !showClearConfirm && (
                    <button
                        onClick={() => setShowClearConfirm(true)}
                        className="ml-auto inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded text-muted-foreground/40 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                        title="Clear all comments"
                    >
                        <Trash2 className="h-2.5 w-2.5" /> Clear
                    </button>
                )}
            </div>

            {/* Clear chat confirmation */}
            {showClearConfirm && (
                <div className="flex items-center gap-2 mb-2 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                    <span className="text-[10px] text-red-500 font-medium">Clear all comments?</span>
                    <div className="flex items-center gap-1 ml-auto shrink-0">
                        <button
                            onClick={async () => {
                                setClearing(true)
                                try {
                                    await onClearChat?.()
                                } finally {
                                    setClearing(false)
                                    setShowClearConfirm(false)
                                }
                            }}
                            disabled={clearing}
                            className="text-[9px] px-2 py-1 rounded bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium transition-colors disabled:opacity-40"
                        >
                            {clearing ? "Clearing..." : "Confirm"}
                        </button>
                        <button
                            onClick={() => setShowClearConfirm(false)}
                            className="text-[9px] px-1.5 py-1 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Messages area */}
            <div
                ref={scrollRef}
                className={cn(
                    "space-y-2 overflow-y-auto pr-1",
                    comments.length > 4 ? "max-h-[200px]" : ""
                )}
            >
                {sorted.length === 0 && (
                    <p className="text-[10px] text-muted-foreground/30 italic py-3 text-center">
                        No comments yet. Start the conversation.
                    </p>
                )}
                {sorted.map((c) => {
                    const isMe = c.author === currentUser || c.role === currentRole
                    return (
                        <div
                            key={c.id}
                            className={cn(
                                "flex flex-col gap-0.5",
                                isMe ? "items-end" : "items-start"
                            )}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-medium text-foreground/60">{c.author}</span>
                                <span className={cn(
                                    "text-[8px] px-1 py-0 rounded font-medium",
                                    (ROLE_BADGE[c.role] || ROLE_BADGE.team_member).className
                                )}>
                                    {(ROLE_BADGE[c.role] || ROLE_BADGE.team_member).label}
                                </span>
                                <span className="text-[8px] text-muted-foreground/30">{formatTimestamp(c.timestamp)}</span>
                            </div>
                            <div className={cn(
                                "text-[11px] px-3 py-1.5 rounded-lg max-w-[85%] whitespace-pre-wrap break-words",
                                isMe
                                    ? "bg-primary/10 text-foreground/90 rounded-br-sm"
                                    : "bg-muted/30 text-foreground/80 rounded-bl-sm"
                            )}>
                                {c.text}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Input */}
            {onAddComment && !readOnly && <div className="flex items-end gap-2 mt-2 pt-2 border-t border-border/20">
                <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 bg-background text-xs rounded-lg px-3 py-2 border border-border/40 focus:border-primary focus:outline-none text-foreground placeholder:text-muted-foreground/30 resize-none min-h-[32px] max-h-[80px]"
                />
                <button
                    onClick={handleSend}
                    disabled={!draft.trim() || sending}
                    className={cn(
                        "shrink-0 p-2 rounded-lg transition-colors",
                        draft.trim() && !sending
                            ? "bg-primary/15 text-primary hover:bg-primary/25"
                            : "bg-muted/20 text-muted-foreground/20 cursor-not-allowed"
                    )}
                >
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
            </div>}
        </div>
    )
}
