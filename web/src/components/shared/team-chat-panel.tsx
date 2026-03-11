"use client"

import * as React from "react"
import { MessageSquare, Send, Loader2, X, Users, Shield } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
    fetchTeamChatMessages,
    postTeamChatMessage,
    type TeamChatMessage,
} from "@/lib/api"
import { ROLE_BADGE } from "@/lib/status-config"

type ChatChannel = "internal" | "compliance"

function formatTimestamp(iso: string): string {
    try {
        const d = new Date(iso)
        return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    } catch {
        return iso
    }
}

interface TeamChatPanelProps {
    team: string
    userName: string
    userRole: string
    open: boolean
    onClose: () => void
}

export function TeamChatPanel({ team, userName, userRole, open, onClose }: TeamChatPanelProps) {
    const [channel, setChannel] = React.useState<ChatChannel>("internal")
    const [messages, setMessages] = React.useState<TeamChatMessage[]>([])
    const [loading, setLoading] = React.useState(true)
    const [text, setText] = React.useState("")
    const [sending, setSending] = React.useState(false)
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

    // Determine if CO — CO can only see/post to compliance channel
    const isCO = userRole === "compliance_officer" || userRole === "admin"

    // If CO, force compliance channel
    React.useEffect(() => {
        if (isCO) setChannel("compliance")
    }, [isCO])

    const loadMessages = React.useCallback(async () => {
        if (!team) return
        try {
            const result = await fetchTeamChatMessages(team, channel)
            setMessages(result.messages || [])
        } catch {
            // silently fail
        } finally {
            setLoading(false)
        }
    }, [team, channel])

    React.useEffect(() => {
        if (open && team) {
            setLoading(true)
            loadMessages()
            // Poll every 10 seconds
            pollRef.current = setInterval(loadMessages, 10000)
        }
        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [open, team, loadMessages])

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages])

    const handleSend = async () => {
        if (!text.trim() || sending) return
        setSending(true)
        try {
            await postTeamChatMessage(team, channel, userName, userRole, text.trim())
            setText("")
            await loadMessages()
        } catch {
            toast.error("Failed to send message")
        } finally {
            setSending(false)
        }
    }

    if (!open) return null

    return (
        <div className="fixed right-0 top-0 h-screen w-[340px] bg-background border-l border-border z-50 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-muted/10">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold text-foreground">Team Chat</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground font-medium">{team}</span>
                </div>
                <button onClick={onClose} className="p-1 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Channel tabs */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border/20">
                {!isCO && (
                    <button
                        onClick={() => setChannel("internal")}
                        className={cn(
                            "flex items-center gap-1 px-2.5 py-1 text-xs rounded font-medium transition-colors",
                            channel === "internal"
                                ? "bg-indigo-500/10 text-indigo-400"
                                : "text-muted-foreground/50 hover:text-foreground"
                        )}
                    >
                        <Users className="h-3 w-3" />
                        Internal
                    </button>
                )}
                <button
                    onClick={() => setChannel("compliance")}
                    className={cn(
                        "flex items-center gap-1 px-2.5 py-1 text-xs rounded font-medium transition-colors",
                        channel === "compliance"
                            ? "bg-pink-500/10 text-pink-400"
                            : "text-muted-foreground/50 hover:text-foreground"
                    )}
                >
                    <Shield className="h-3 w-3" />
                    Team ↔ Compliance
                </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                {loading && (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                )}
                {!loading && messages.length === 0 && (
                    <p className="text-xs text-muted-foreground/40 italic text-center py-8">
                        No messages yet. Start the conversation!
                    </p>
                )}
                {messages.map((msg, idx) => {
                    const isMe = msg.author === userName
                    const badge = ROLE_BADGE[msg.role] || { label: msg.role, className: "bg-muted/30 text-muted-foreground" }
                    return (
                        <div key={msg.id || idx} className={cn("flex flex-col gap-0.5", isMe && "items-end")}>
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-foreground/80">{msg.author}</span>
                                <span className={cn("text-xs px-1 py-0.5 rounded font-medium", badge.className)}>
                                    {badge.label}
                                </span>
                                <span className="text-xs text-muted-foreground/30">{formatTimestamp(msg.timestamp)}</span>
                            </div>
                            <div className={cn(
                                "max-w-[85%] px-3 py-1.5 rounded-lg text-xs",
                                isMe
                                    ? "bg-primary/10 text-foreground/90"
                                    : "bg-muted/10 text-foreground/80"
                            )}>
                                {msg.text}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Input */}
            <div className="border-t border-border/30 p-3 flex items-center gap-2">
                <input
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder={`Message ${channel === "internal" ? "team" : "team & compliance"}...`}
                    className="flex-1 bg-muted/10 text-xs rounded-md px-3 py-2 border border-border/30 focus:border-primary focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                    onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            handleSend()
                        }
                    }}
                />
                <button
                    onClick={handleSend}
                    disabled={!text.trim() || sending}
                    className="p-2 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Send className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    )
}
