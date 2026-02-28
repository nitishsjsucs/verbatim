"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { AuthGuard, getUserRole, getUserTeam } from "@/components/auth/auth-guard"
import { useSession } from "@/lib/auth-client"
import {
    fetchChatChannels,
    fetchChatMessages,
    postChatMessage,
    markChatRead,
    renameChatChannel,
    ChatChannel,
    ChatMessage,
} from "@/lib/api"
import {
    MessageSquare,
    Send,
    Loader2,
    Users,
    Shield,
    Hash,
    ChevronRight,
    Pencil,
    Check,
    X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Role labels & colors ────────────────────────────────────────────────────

const ROLE_TAG: Record<string, { label: string; color: string }> = {
    team_member: { label: "Execution", color: "bg-amber-500/15 text-amber-500" },
    team_reviewer: { label: "Reviewer", color: "bg-teal-500/15 text-teal-500" },
    team_lead: { label: "Lead", color: "bg-indigo-500/15 text-indigo-500" },
    compliance_officer: { label: "Compliance", color: "bg-pink-500/15 text-pink-500" },
    admin: { label: "Admin", color: "bg-red-500/15 text-red-500" },
}

function roleTag(role: string) {
    const t = ROLE_TAG[role] || { label: role, color: "bg-muted text-muted-foreground" }
    return (
        <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider", t.color)}>
            {t.label}
        </span>
    )
}

// ─── Channel icon ────────────────────────────────────────────────────────────

function ChannelIcon({ type }: { type: string }) {
    if (type === "compliance_internal") return <Shield className="h-3.5 w-3.5 text-pink-500" />
    if (type === "team_internal") return <Users className="h-3.5 w-3.5 text-indigo-500" />
    return <Hash className="h-3.5 w-3.5 text-teal-500" />
}

// ─── Format timestamp ────────────────────────────────────────────────────────

function formatMsgTime(ts: string) {
    if (!ts) return ""
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()

    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    if (isToday) return time
    if (isYesterday) return `Yesterday ${time}`
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ` ${time}`
}

// ─── Chat Content ────────────────────────────────────────────────────────────

function ChatContent() {
    const { data: session } = useSession()
    const role = getUserRole(session)
    const team = getUserTeam(session)
    const userName = session?.user?.name || session?.user?.email || "Unknown"

    const [channels, setChannels] = React.useState<ChatChannel[]>([])
    const [activeChannel, setActiveChannel] = React.useState<string | null>(null)
    const [messages, setMessages] = React.useState<ChatMessage[]>([])
    const [loadingChannels, setLoadingChannels] = React.useState(true)
    const [loadingMessages, setLoadingMessages] = React.useState(false)
    const [messageText, setMessageText] = React.useState("")
    const [sending, setSending] = React.useState(false)
    const messagesEndRef = React.useRef<HTMLDivElement>(null)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

    // Load channels
    const loadChannels = React.useCallback(async () => {
        try {
            const result = await fetchChatChannels(role, team)
            setChannels(result.channels)
            // Auto-select first channel if none selected
            if (!activeChannel && result.channels.length > 0) {
                setActiveChannel(result.channels[0].channel)
            }
        } catch {
            // silent
        } finally {
            setLoadingChannels(false)
        }
    }, [role, team, activeChannel])

    React.useEffect(() => {
        loadChannels()
    }, [loadChannels])

    // Load messages when channel changes
    const loadMessages = React.useCallback(async () => {
        if (!activeChannel) return
        try {
            const result = await fetchChatMessages(activeChannel, role, team)
            setMessages(result.messages)
        } catch {
            // silent
        } finally {
            setLoadingMessages(false)
        }
    }, [activeChannel, role, team])

    React.useEffect(() => {
        if (!activeChannel) return
        setLoadingMessages(true)
        loadMessages()
        // Mark as read
        markChatRead(activeChannel, role, team).catch(() => {})
        // Update channel unread count locally
        setChannels(prev => prev.map(ch =>
            ch.channel === activeChannel ? { ...ch, unread: 0 } : ch
        ))
    }, [activeChannel, role, team, loadMessages])

    // Poll for new messages every 4 seconds
    React.useEffect(() => {
        if (!activeChannel) return
        pollRef.current = setInterval(() => {
            loadMessages()
            // Refresh channel list for unread badges
            fetchChatChannels(role, team)
                .then(r => setChannels(r.channels.map(ch =>
                    ch.channel === activeChannel ? { ...ch, unread: 0 } : ch
                )))
                .catch(() => {})
        }, 4000)
        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [activeChannel, loadMessages, role, team])

    // Auto-scroll to bottom when messages change
    React.useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    // Send message
    const handleSend = React.useCallback(async () => {
        if (!messageText.trim() || !activeChannel || sending) return
        setSending(true)
        try {
            const newMsg = await postChatMessage(activeChannel, userName, role, team, messageText.trim())
            setMessages(prev => [...prev, newMsg])
            setMessageText("")
            inputRef.current?.focus()
        } catch {
            // silent
        } finally {
            setSending(false)
        }
    }, [messageText, activeChannel, sending, userName, role, team])

    // Rename channel (team_lead only)
    const handleRename = React.useCallback(async (channel: string, newName: string) => {
        try {
            await renameChatChannel(channel, newName, role, team)
            toast.success("Channel renamed successfully")
            await loadChannels()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to rename channel")
        }
    }, [role, team, loadChannels])

    // Group channels by type for compliance view
    const isComplianceView = role === "compliance_officer" || role === "admin"
    const complianceInternalChannels = channels.filter(c => c.type === "compliance_internal")
    const teamComplianceChannels = channels.filter(c => c.type === "team_compliance")
    const teamInternalChannels = channels.filter(c => c.type === "team_internal")

    const activeChannelData = channels.find(c => c.channel === activeChannel)

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />
            <div className="flex-1 flex min-w-0">
                {/* ── Left: Channel list ── */}
                <div className="w-[260px] border-r border-border/40 flex flex-col bg-muted/5 shrink-0">
                    {/* Header */}
                    <div className="h-11 border-b border-border/40 flex items-center px-4 shrink-0">
                        <MessageSquare className="h-4 w-4 text-primary mr-2" />
                        <span className="text-sm font-semibold text-foreground">Chat</span>
                    </div>

                    {/* Channel list */}
                    <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
                        {loadingChannels && (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                        )}

                        {!loadingChannels && isComplianceView && (
                            <>
                                {/* Compliance Internal */}
                                {complianceInternalChannels.length > 0 && (
                                    <div className="mb-3">
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 px-2 mb-1">Internal</p>
                                        {complianceInternalChannels.map(ch => (
                                            <ChannelButton
                                                key={ch.channel}
                                                channel={ch}
                                                active={activeChannel === ch.channel}
                                                onClick={() => setActiveChannel(ch.channel)}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Team conversations */}
                                {teamComplianceChannels.length > 0 && (
                                    <div>
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 px-2 mb-1">Team Conversations</p>
                                        {teamComplianceChannels.map(ch => (
                                            <ChannelButton
                                                key={ch.channel}
                                                channel={ch}
                                                active={activeChannel === ch.channel}
                                                onClick={() => setActiveChannel(ch.channel)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {!loadingChannels && !isComplianceView && (
                            <>
                                {teamInternalChannels.map(ch => (
                                    <ChannelButton
                                        key={ch.channel}
                                        channel={ch}
                                        active={activeChannel === ch.channel}
                                        onClick={() => setActiveChannel(ch.channel)}
                                        canRename={role === "team_lead"}
                                        onRename={handleRename}
                                    />
                                ))}
                                {teamComplianceChannels.map(ch => (
                                    <ChannelButton
                                        key={ch.channel}
                                        channel={ch}
                                        active={activeChannel === ch.channel}
                                        onClick={() => setActiveChannel(ch.channel)}
                                        canRename={role === "team_lead"}
                                        onRename={handleRename}
                                    />
                                ))}
                            </>
                        )}
                    </div>
                </div>

                {/* ── Right: Message thread ── */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Channel header */}
                    <div className="h-11 border-b border-border/40 flex items-center px-5 shrink-0 gap-2">
                        {activeChannelData ? (
                            <>
                                <ChannelIcon type={activeChannelData.type} />
                                <span className="text-sm font-semibold text-foreground truncate">
                                    {activeChannelData.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground/40 ml-1">
                                    {activeChannelData.type === "compliance_internal"
                                        ? "Compliance officers only"
                                        : activeChannelData.type === "team_internal"
                                            ? "Team members only"
                                            : "Team ↔ Compliance"}
                                </span>
                            </>
                        ) : (
                            <span className="text-sm text-muted-foreground/50">Select a channel</span>
                        )}
                    </div>

                    {/* Messages area */}
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                        {loadingMessages && (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                        )}

                        {!loadingMessages && messages.length === 0 && activeChannel && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <MessageSquare className="h-8 w-8 text-muted-foreground/20 mb-3" />
                                <p className="text-sm text-muted-foreground/50">No messages yet</p>
                                <p className="text-[11px] text-muted-foreground/30 mt-1">Start the conversation</p>
                            </div>
                        )}

                        {!loadingMessages && !activeChannel && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <ChevronRight className="h-8 w-8 text-muted-foreground/20 mb-3" />
                                <p className="text-sm text-muted-foreground/50">Select a channel to begin</p>
                            </div>
                        )}

                        {!loadingMessages && messages.map((msg) => {
                            const isMe = msg.author === userName
                            return (
                                <div key={msg.id} className={cn("flex gap-2.5", isMe && "flex-row-reverse")}>
                                    {/* Avatar */}
                                    <div className={cn(
                                        "h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                                        isMe ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                                    )}>
                                        {(msg.author || "?")[0].toUpperCase()}
                                    </div>

                                    {/* Bubble */}
                                    <div className={cn("max-w-[65%] min-w-[120px]", isMe ? "items-end" : "items-start")}>
                                        <div className="flex items-center gap-1.5 mb-0.5" style={{ flexDirection: isMe ? "row-reverse" : "row" }}>
                                            <span className="text-[11px] font-semibold text-foreground/80 truncate max-w-[140px]">
                                                {isMe ? "You" : msg.author}
                                            </span>
                                            {roleTag(msg.role)}
                                        </div>
                                        <div className={cn(
                                            "rounded-lg px-3 py-2 text-[12px] leading-relaxed",
                                            isMe
                                                ? "bg-primary/10 text-foreground border border-primary/20"
                                                : "bg-muted/30 text-foreground border border-border/30"
                                        )}>
                                            {msg.text}
                                        </div>
                                        <p className={cn(
                                            "text-[9px] text-muted-foreground/30 mt-0.5",
                                            isMe ? "text-right" : "text-left"
                                        )}>
                                            {formatMsgTime(msg.timestamp)}
                                        </p>
                                    </div>
                                </div>
                            )
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input area */}
                    {activeChannel && (
                        <div className="shrink-0 border-t border-border/40 px-5 py-3">
                            <div className="flex items-center gap-2">
                                <input
                                    ref={inputRef}
                                    value={messageText}
                                    onChange={e => setMessageText(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault()
                                            handleSend()
                                        }
                                    }}
                                    placeholder="Type a message..."
                                    className="flex-1 bg-muted/20 text-sm rounded-lg px-4 py-2.5 border border-border/40 focus:border-primary/50 focus:outline-none text-foreground placeholder:text-muted-foreground/30"
                                    autoComplete="off"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!messageText.trim() || sending}
                                    className="h-10 w-10 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    {sending
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <Send className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── Channel Button ──────────────────────────────────────────────────────────

function ChannelButton({ channel, active, onClick, canRename, onRename }: {
    channel: ChatChannel
    active: boolean
    onClick: () => void
    canRename?: boolean
    onRename?: (channel: string, newName: string) => void
}) {
    const [isEditing, setIsEditing] = React.useState(false)
    const [editValue, setEditValue] = React.useState(channel.label)
    const inputRef = React.useRef<HTMLInputElement>(null)

    React.useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const handleRename = () => {
        if (editValue.trim() && editValue !== channel.label && onRename) {
            onRename(channel.channel, editValue.trim())
        }
        setIsEditing(false)
    }

    const handleCancel = () => {
        setEditValue(channel.label)
        setIsEditing(false)
    }

    if (isEditing) {
        return (
            <div className="w-full flex items-center gap-1.5 rounded-md px-2.5 py-2 bg-primary/10 border border-primary/20">
                <ChannelIcon type={channel.type} />
                <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename()
                        if (e.key === 'Escape') handleCancel()
                    }}
                    className="flex-1 bg-transparent border-none outline-none text-[12px] font-medium text-foreground"
                    onClick={(e) => e.stopPropagation()}
                />
                <button
                    onClick={(e) => { e.stopPropagation(); handleRename() }}
                    className="p-1 hover:bg-green-500/20 rounded"
                    title="Save"
                >
                    <Check className="h-3 w-3 text-green-500" />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); handleCancel() }}
                    className="p-1 hover:bg-red-500/20 rounded"
                    title="Cancel"
                >
                    <X className="h-3 w-3 text-red-500" />
                </button>
            </div>
        )
    }

    return (
        <button
            onClick={onClick}
            className={cn(
                "w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors group",
                active
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-muted/30 border border-transparent"
            )}
        >
            <ChannelIcon type={channel.type} />
            <span className={cn(
                "text-[12px] font-medium truncate flex-1",
                active ? "text-foreground" : "text-foreground/70 group-hover:text-foreground"
            )}>
                {channel.label}
            </span>
            {canRename && (
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        setIsEditing(true)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-primary/20 rounded transition-opacity"
                    title="Rename channel"
                >
                    <Pencil className="h-3 w-3 text-primary" />
                </button>
            )}
            {channel.unread > 0 && (
                <span className="bg-primary text-primary-foreground text-[9px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                    {channel.unread}
                </span>
            )}
        </button>
    )
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function ChatPage() {
    return (
        <AuthGuard>
            <ChatContent />
        </AuthGuard>
    )
}
