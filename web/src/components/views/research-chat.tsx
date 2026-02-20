"use client"

import * as React from "react"
import {
    Send, User, Bot, FileText, Loader2, Sparkles, BookOpen,
    ChevronDown, ChevronRight, ShieldCheck, ShieldAlert, ShieldQuestion,
    Clock, Zap, Brain, Search, BarChart3, X, Library, Plus,
    MessageSquare, Trash2, PanelLeftClose, PanelLeftOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import {
    runCorpusQuery, fetchConversation, fetchConversationsByDoc,
    deleteConversation,
} from "@/lib/api"
import {
    CorpusCitation, CorpusQueryResponse, CorpusRetrievedSection,
    InferredPoint, ConversationMeta,
} from "@/lib/types"
import { FeedbackPanel } from "./feedback-panel"
import { Markdown } from "@/components/ui/markdown"

// --- Types ---

interface ResearchMessage {
    id: string
    role: "user" | "assistant"
    content: string
    citations?: CorpusCitation[]
    recordId?: string
    verificationStatus?: string
    verificationNotes?: string
    inferredPoints?: InferredPoint[]
    queryType?: string
    subQueries?: string[]
    keyTerms?: string[]
    retrievedSections?: CorpusRetrievedSection[]
    selectedDocuments?: Record<string, unknown>[]
    perDocRoutingLogs?: Record<string, unknown>
    stageTimings?: Record<string, number>
    totalTimeSeconds?: number
    totalTokens?: number
    llmCalls?: number
}

interface ResearchChatProps {
    className?: string
    onCitationClick?: (docId: string, pageNumber: number) => void
}

// --- Helper sub-components ---

function CollapsibleSection({ title, icon, children, defaultOpen = false, badge }: {
    title: string; icon: React.ReactNode; children: React.ReactNode
    defaultOpen?: boolean; badge?: React.ReactNode
}) {
    const [open, setOpen] = React.useState(defaultOpen)
    return (
        <div className="border border-border/30 rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {icon}
                <span>{title}</span>
                {badge && <span className="ml-auto">{badge}</span>}
            </button>
            {open && <div className="px-3 pb-3 pt-1">{children}</div>}
        </div>
    )
}

function VerificationBadge({ status }: { status: string }) {
    const config = {
        verified: { icon: ShieldCheck, color: "text-green-400 bg-green-400/10", label: "Verified" },
        partially_verified: { icon: ShieldQuestion, color: "text-amber-400 bg-amber-400/10", label: "Partially Verified" },
        unverified: { icon: ShieldAlert, color: "text-red-400 bg-red-400/10", label: "Unverified" },
    }[status] || { icon: ShieldQuestion, color: "text-muted-foreground bg-muted", label: status || "Unknown" }
    const Icon = config.icon
    return (
        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium", config.color)}>
            <Icon className="h-3 w-3" />
            {config.label}
        </span>
    )
}

function StageTimingBar({ name, seconds, maxSeconds }: { name: string; seconds: number; maxSeconds: number }) {
    const pct = maxSeconds > 0 ? Math.min((seconds / maxSeconds) * 100, 100) : 0
    return (
        <div className="flex items-center gap-2 text-[11px]">
            <span className="w-28 text-muted-foreground truncate">{name}</span>
            <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-10 text-right font-mono text-muted-foreground">{seconds.toFixed(1)}s</span>
        </div>
    )
}

function ConfidenceIndicator({ confidence }: { confidence: string }) {
    const color = confidence === "high" ? "bg-green-400" : confidence === "medium" ? "bg-amber-400" : "bg-red-400"
    return <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
}

// --- Conversation sidebar (research-specific) ---

function ResearchConversationList({
    conversations,
    activeConvId,
    onSelect,
    onNew,
    onDelete,
    collapsed,
    onToggle,
}: {
    conversations: ConversationMeta[]
    activeConvId: string | null
    onSelect: (convId: string) => void
    onNew: () => void
    onDelete: (convId: string) => void
    collapsed: boolean
    onToggle: () => void
}) {
    const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)

    if (collapsed) {
        return (
            <div className="w-10 border-r border-border/30 flex flex-col items-center py-3 gap-2 shrink-0">
                <button onClick={onToggle} className="p-1.5 text-muted-foreground/60 hover:text-foreground rounded-md hover:bg-muted/30 transition-colors" title="Show conversations">
                    <PanelLeftOpen className="h-4 w-4" />
                </button>
                <button onClick={onNew} className="p-1.5 text-muted-foreground/60 hover:text-primary rounded-md hover:bg-primary/10 transition-colors" title="New chat">
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        )
    }

    return (
        <div className="w-56 border-r border-border/30 flex flex-col shrink-0 bg-muted/5">
            <div className="p-3 border-b border-border/20 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Research Chats</span>
                <div className="flex items-center gap-1">
                    <button onClick={onNew} className="p-1 text-muted-foreground/60 hover:text-primary rounded-md hover:bg-primary/10 transition-colors" title="New chat">
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={onToggle} className="p-1 text-muted-foreground/60 hover:text-foreground rounded-md hover:bg-muted/30 transition-colors" title="Hide">
                        <PanelLeftClose className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
                {conversations.length === 0 && (
                    <div className="px-3 py-8 text-center">
                        <MessageSquare className="h-5 w-5 mx-auto text-muted-foreground/30 mb-2" />
                        <p className="text-[10px] text-muted-foreground/40">No research chats yet</p>
                    </div>
                )}
                {conversations.map((conv) => (
                    <div
                        key={conv.conv_id}
                        className={cn(
                            "group px-2 py-1.5 mx-1 rounded-md cursor-pointer transition-colors flex items-start gap-2",
                            conv.conv_id === activeConvId
                                ? "bg-primary/10 text-foreground"
                                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                        )}
                        onClick={() => onSelect(conv.conv_id)}
                    >
                        <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium truncate">{conv.title || conv.last_message_preview || "New research"}</p>
                            <p className="text-[9px] text-muted-foreground/50 mt-0.5">{conv.message_count} msgs</p>
                        </div>
                        {confirmDeleteId === conv.conv_id ? (
                            <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => { onDelete(conv.conv_id); setConfirmDeleteId(null) }} className="text-[9px] text-red-400 hover:text-red-300 px-1 py-0.5 rounded bg-red-400/10">Del</button>
                                <button onClick={() => setConfirmDeleteId(null)} className="text-[9px] text-muted-foreground px-1 py-0.5">No</button>
                            </div>
                        ) : (
                            <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(conv.conv_id) }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-muted-foreground/30 hover:text-red-400 shrink-0"
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

// --- Main component ---

export function ResearchChat({ className, onCitationClick }: ResearchChatProps) {
    const [messages, setMessages] = React.useState<ResearchMessage[]>([])
    const [input, setInput] = React.useState("")
    const [loading, setLoading] = React.useState(false)
    const [loadingHistory, setLoadingHistory] = React.useState(true)
    const [verify, setVerify] = React.useState(true)
    const scrollAreaRef = React.useRef<HTMLDivElement>(null)
    const bottomRef = React.useRef<HTMLDivElement>(null)

    // Multi-conversation state
    const [conversations, setConversations] = React.useState<ConversationMeta[]>([])
    const [activeConvId, setActiveConvId] = React.useState<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)

    // Helper: map backend ConversationMessage to local ResearchMessage
    const mapToMessage = React.useCallback((m: Record<string, unknown>): ResearchMessage => ({
        id: (m.id as string) || Date.now().toString(),
        role: (m.role as "user" | "assistant") || "user",
        content: (m.content as string) || "",
        recordId: (m.record_id as string) || undefined,
        citations: m.citations as CorpusCitation[] | undefined,
        inferredPoints: m.inferred_points as InferredPoint[] | undefined,
        verificationStatus: m.verification_status as string | undefined,
        verificationNotes: m.verification_notes as string | undefined,
        queryType: m.query_type as string | undefined,
        subQueries: m.sub_queries as string[] | undefined,
        keyTerms: m.key_terms as string[] | undefined,
        retrievedSections: m.retrieved_sections as CorpusRetrievedSection[] | undefined,
        // selectedDocuments and perDocRoutingLogs come from QueryRecord too
        selectedDocuments: m.selected_documents as Record<string, unknown>[] | undefined,
        perDocRoutingLogs: m.per_doc_routing_logs as Record<string, unknown> | undefined,
        stageTimings: m.stage_timings as Record<string, number> | undefined,
        totalTimeSeconds: m.total_time_seconds as number | undefined,
        totalTokens: m.total_tokens as number | undefined,
        llmCalls: m.llm_calls as number | undefined,
    }), [])

    // Load conversation list for research on mount
    React.useEffect(() => {
        let cancelled = false
        setLoadingHistory(true)

        fetchConversationsByDoc("research")
            .then(async (convList) => {
                if (cancelled) return
                setConversations(convList)

                if (convList.length > 0) {
                    const mostRecent = convList[0]
                    setActiveConvId(mostRecent.conv_id)
                    try {
                        const conv = await fetchConversation(mostRecent.conv_id)
                        if (cancelled) return
                        if (conv.messages && conv.messages.length > 0) {
                            setMessages(conv.messages.map((m) => mapToMessage(m as unknown as Record<string, unknown>)))
                        }
                    } catch { /* ignore */ }
                }
            })
            .catch(() => { /* no conversations yet */ })
            .finally(() => {
                if (!cancelled) setLoadingHistory(false)
            })

        return () => { cancelled = true }
    }, [mapToMessage])

    // Switch conversation
    const handleSelectConversation = React.useCallback(async (convId: string) => {
        if (convId === activeConvId) return
        setActiveConvId(convId)
        setMessages([])
        setLoadingHistory(true)

        try {
            const conv = await fetchConversation(convId)
            if (conv.messages && conv.messages.length > 0) {
                setMessages(conv.messages.map((m) => mapToMessage(m as unknown as Record<string, unknown>)))
            }
        } catch { /* ignore */ } finally {
            setLoadingHistory(false)
        }
    }, [activeConvId, mapToMessage])

    const handleNewChat = React.useCallback(() => {
        setActiveConvId(null)
        setMessages([])
    }, [])

    const handleDeleteConversation = React.useCallback(async (convId: string) => {
        try {
            await deleteConversation(convId)
            setConversations((prev) => prev.filter((c) => c.conv_id !== convId))
            if (convId === activeConvId) {
                setActiveConvId(null)
                setMessages([])
            }
        } catch { /* ignore */ }
    }, [activeConvId])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || loading) return

        const userMsg: ResearchMessage = {
            id: Date.now().toString(),
            role: "user",
            content: input,
        }

        setMessages(prev => [...prev, userMsg])
        setInput("")
        setLoading(true)

        try {
            const res: CorpusQueryResponse = await runCorpusQuery({
                query: userMsg.content,
                verify,
                conv_id: activeConvId || undefined,
            })

            const botMsg: ResearchMessage = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: res.answer,
                citations: res.citations,
                recordId: res.record_id,
                verificationStatus: res.verification_status,
                verificationNotes: res.verification_notes,
                inferredPoints: res.inferred_points,
                queryType: res.query_type,
                subQueries: res.sub_queries,
                keyTerms: res.key_terms,
                retrievedSections: res.retrieved_sections,
                selectedDocuments: res.selected_documents,
                perDocRoutingLogs: res.per_doc_routing_logs,
                stageTimings: res.stage_timings,
                totalTimeSeconds: res.total_time_seconds,
                totalTokens: res.total_tokens,
                llmCalls: res.llm_calls,
            }
            setMessages(prev => [...prev, botMsg])

            if (!activeConvId && res.conv_id) {
                setActiveConvId(res.conv_id)
            }
            fetchConversationsByDoc("research").then(setConversations).catch(() => {})
        } catch (err) {
            console.error(err)
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "Sorry, I encountered an error answering your question. Please try again.",
            }])
        } finally {
            setLoading(false)
        }
    }

    const scrollToBottom = React.useCallback(() => {
        requestAnimationFrame(() => {
            if (scrollAreaRef.current) {
                scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
            }
        })
    }, [])

    React.useEffect(() => {
        scrollToBottom()
    }, [messages, loading, scrollToBottom])

    return (
        <div className={cn("flex h-full bg-background relative", className)}>
            {/* Conversation sidebar */}
            <ResearchConversationList
                conversations={conversations}
                activeConvId={activeConvId}
                onSelect={handleSelectConversation}
                onNew={handleNewChat}
                onDelete={handleDeleteConversation}
                collapsed={sidebarCollapsed}
                onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
            />

            {/* Main chat area */}
            <div className="flex flex-col flex-1 min-w-0">
            {/* Header */}
            <div className="h-14 border-b border-border/40 flex items-center px-6 sticky top-0 bg-background/80 backdrop-blur-md z-10 justify-between">
                <div className="flex items-center gap-2">
                    <Library className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">Cross-Document Research</h2>
                    {activeConvId && (
                        <span className="text-[10px] text-muted-foreground/50 font-mono ml-2">
                            {conversations.find(c => c.conv_id === activeConvId)?.title?.slice(0, 40) || ""}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleNewChat}
                        className="gap-1.5 text-xs text-muted-foreground hover:text-primary"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        New Chat
                    </Button>
                    <div className="text-xs text-muted-foreground/60 flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-green-500/50 animate-pulse" />
                        All Documents
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4" ref={scrollAreaRef}>
                <div className="space-y-8 max-w-3xl mx-auto py-8">
                    {loadingHistory && (
                        <div className="flex items-center justify-center h-[30vh] text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading chat history...</span>
                        </div>
                    )}

                    {!loadingHistory && messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-[50vh] text-center opacity-40">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
                                <Library className="h-8 w-8 text-foreground" />
                            </div>
                            <h3 className="text-lg font-medium mb-2">Cross-Document Research</h3>
                            <p className="text-sm text-balance max-w-md">
                                Ask questions that span multiple documents. I&apos;ll automatically select the relevant
                                documents, retrieve from each, and synthesize a comprehensive answer with per-document citations.
                            </p>
                        </div>
                    )}

                    {messages.map((msg) => (
                        <div key={msg.id} className={cn("flex gap-5 group", msg.role === "user" ? "flex-row-reverse" : "")}>
                            <Avatar className={cn(
                                "h-8 w-8 mt-1 border shadow-sm shrink-0",
                                msg.role === "assistant" ? "bg-background border-border" : "bg-primary border-primary"
                            )}>
                                <AvatarFallback className={msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}>
                                    {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                </AvatarFallback>
                            </Avatar>

                            <div className={cn("flex flex-col gap-2 max-w-[85%] min-w-0", msg.role === "user" ? "items-end" : "items-start")}>
                                {/* Header badges */}
                                {msg.role === "assistant" && msg.queryType && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400">
                                            Cross-Doc
                                        </span>
                                        {msg.verificationStatus && <VerificationBadge status={msg.verificationStatus} />}
                                        {msg.selectedDocuments && msg.selectedDocuments.length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                                                <FileText className="h-3 w-3" />
                                                {msg.selectedDocuments.length} docs
                                            </span>
                                        )}
                                        {msg.totalTimeSeconds !== undefined && msg.totalTimeSeconds > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                                                <Clock className="h-3 w-3" />
                                                {msg.totalTimeSeconds.toFixed(1)}s
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Answer text */}
                                <div className={cn(
                                    "px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                                    msg.role === "user"
                                        ? "bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap"
                                        : "bg-muted/30 border border-border/40 text-foreground rounded-tl-sm"
                                )}>
                                    {msg.role === "assistant" ? <Markdown content={msg.content} /> : msg.content}
                                </div>

                                {/* Citations with document attribution */}
                                {msg.citations && msg.citations.length > 0 && (
                                    <div className="mt-3 w-full space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="h-px bg-border w-4" />
                                            <span className="text-[10px] font-medium uppercase text-muted-foreground/70 tracking-wider">Sources</span>
                                            <div className="h-px bg-border flex-1" />
                                        </div>
                                        <div className="grid gap-2">
                                            {msg.citations.map((cite) => (
                                                <Card
                                                    key={cite.citation_id}
                                                    className="bg-background/50 border-border/40 hover:border-border/80 hover:shadow-sm transition-all cursor-pointer group/card overflow-hidden"
                                                    onClick={() => {
                                                        if (onCitationClick && cite.doc_id) {
                                                            const match = cite.page_range.match(/p\.?\s*(\d+)/)
                                                            if (match) {
                                                                onCitationClick(cite.doc_id, parseInt(match[1], 10))
                                                            }
                                                        }
                                                    }}
                                                >
                                                    <CardContent className="p-3">
                                                        <div className="flex items-start justify-between gap-3 mb-1.5">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <div className="h-5 w-5 rounded bg-blue-500/10 flex items-center justify-center shrink-0">
                                                                    <FileText className="h-3 w-3 text-blue-500" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <span className="text-xs font-medium truncate text-foreground/90 block">{cite.title}</span>
                                                                    {cite.doc_name && (
                                                                        <span className="text-[10px] text-muted-foreground/60 truncate block">
                                                                            {cite.doc_name}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">
                                                                {cite.page_range}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground line-clamp-2 pl-7 border-l-2 border-primary/10 group-hover/card:border-primary/30 transition-colors">
                                                            {cite.excerpt}
                                                        </p>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Expandable sections for assistant messages */}
                                {msg.role === "assistant" && msg.recordId && (
                                    <div className="w-full space-y-2 mt-2">

                                        {/* Selected Documents */}
                                        {msg.selectedDocuments && msg.selectedDocuments.length > 0 && (
                                            <CollapsibleSection
                                                title="Selected Documents"
                                                icon={<FileText className="h-3 w-3" />}
                                                badge={<span className="text-[10px] text-muted-foreground/60">{msg.selectedDocuments.length}</span>}
                                            >
                                                <div className="space-y-2">
                                                    {msg.selectedDocuments.map((doc, i) => {
                                                        const d = doc as Record<string, unknown>
                                                        const conf = typeof d.confidence === "number" ? Math.round((d.confidence as number) * 100) : null
                                                        return (
                                                            <div key={i} className="border border-border/20 rounded-md p-2 text-xs">
                                                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                                                    <span className="font-medium text-foreground/80 truncate">{d.doc_name as string || d.doc_id as string}</span>
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        {conf !== null && (
                                                                            <span className={cn("font-mono text-[10px]", conf >= 70 ? "text-green-400" : conf >= 40 ? "text-amber-400" : "text-red-400")}>
                                                                                {conf}%
                                                                            </span>
                                                                        )}
                                                                        {typeof d.role === "string" && d.role && (
                                                                            <span className="text-[10px] px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground">{d.role}</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                {typeof d.relevance_reason === "string" && d.relevance_reason && (
                                                                    <p className="text-muted-foreground/70 text-[11px]">{d.relevance_reason}</p>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </CollapsibleSection>
                                        )}

                                        {/* Inferred Points */}
                                        {msg.inferredPoints && msg.inferredPoints.length > 0 && (
                                            <CollapsibleSection
                                                title="Inferred Points"
                                                icon={<Brain className="h-3 w-3" />}
                                                badge={<span className="text-[10px] text-muted-foreground/60">{msg.inferredPoints.length}</span>}
                                            >
                                                <div className="space-y-3">
                                                    {msg.inferredPoints.map((ip, i) => (
                                                        <div key={i} className="text-xs space-y-1">
                                                            <div className="flex items-start gap-2">
                                                                <ConfidenceIndicator confidence={ip.confidence} />
                                                                <span className="text-foreground/90 font-medium">{ip.point}</span>
                                                            </div>
                                                            {ip.reasoning && (
                                                                <p className="text-muted-foreground/70 pl-4 italic">{ip.reasoning}</p>
                                                            )}
                                                            {ip.supporting_definitions.length > 0 && (
                                                                <div className="pl-4 space-y-0.5">
                                                                    {ip.supporting_definitions.map((def, j) => (
                                                                        <p key={j} className="text-[10px] text-muted-foreground/50 border-l-2 border-primary/10 pl-2">{def}</p>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </CollapsibleSection>
                                        )}

                                        {/* Verification */}
                                        {msg.verificationNotes && (
                                            <CollapsibleSection
                                                title="Verification Details"
                                                icon={<ShieldCheck className="h-3 w-3" />}
                                            >
                                                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{msg.verificationNotes}</p>
                                            </CollapsibleSection>
                                        )}

                                        {/* Retrieved Sections (grouped by doc) */}
                                        {msg.retrievedSections && msg.retrievedSections.length > 0 && (
                                            <CollapsibleSection
                                                title="Retrieved Sections"
                                                icon={<Search className="h-3 w-3" />}
                                                badge={<span className="text-[10px] text-muted-foreground/60">{msg.retrievedSections.length}</span>}
                                            >
                                                <div className="space-y-2">
                                                    {msg.retrievedSections.map((section, i) => (
                                                        <div key={i} className="border border-border/20 rounded-md p-2 text-xs">
                                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                                <span className="font-medium text-foreground/80 truncate">{section.title}</span>
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <span className="text-[10px] text-muted-foreground/50 font-mono">{section.page_range}</span>
                                                                    <span className="text-[10px] px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground">{section.source}</span>
                                                                </div>
                                                            </div>
                                                            {section.doc_name && (
                                                                <p className="text-[10px] text-muted-foreground/50 mb-1">{section.doc_name}</p>
                                                            )}
                                                            <p className="text-muted-foreground/70 line-clamp-2">{section.text.slice(0, 300)}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </CollapsibleSection>
                                        )}

                                        {/* Pipeline Stats */}
                                        {(msg.totalTokens !== undefined && msg.totalTokens > 0) && (
                                            <CollapsibleSection
                                                title="Pipeline Stats"
                                                icon={<BarChart3 className="h-3 w-3" />}
                                            >
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="bg-muted/30 rounded-md p-2">
                                                            <p className="text-[10px] text-muted-foreground">Response Time</p>
                                                            <p className="text-sm font-medium font-mono">{msg.totalTimeSeconds?.toFixed(1)}s</p>
                                                        </div>
                                                        <div className="bg-muted/30 rounded-md p-2">
                                                            <p className="text-[10px] text-muted-foreground">Total Tokens</p>
                                                            <p className="text-sm font-medium font-mono">{msg.totalTokens?.toLocaleString()}</p>
                                                        </div>
                                                        <div className="bg-muted/30 rounded-md p-2">
                                                            <p className="text-[10px] text-muted-foreground">LLM Calls</p>
                                                            <p className="text-sm font-medium font-mono">{msg.llmCalls}</p>
                                                        </div>
                                                        <div className="bg-muted/30 rounded-md p-2">
                                                            <p className="text-[10px] text-muted-foreground">Docs Searched</p>
                                                            <p className="text-sm font-medium font-mono">{msg.selectedDocuments?.length || 0}</p>
                                                        </div>
                                                    </div>
                                                    {msg.stageTimings && Object.keys(msg.stageTimings).length > 0 && (
                                                        <div className="space-y-1.5">
                                                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Stage Timings</p>
                                                            {(() => {
                                                                const entries = Object.entries(msg.stageTimings)
                                                                const maxVal = Math.max(...entries.map(([, v]) => v), 0.1)
                                                                return entries.map(([name, secs]) => (
                                                                    <StageTimingBar key={name} name={name} seconds={secs} maxSeconds={maxVal} />
                                                                ))
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            </CollapsibleSection>
                                        )}

                                        {/* Feedback */}
                                        <FeedbackPanel recordId={msg.recordId} />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}

                    {loading && (
                        <div className="flex gap-5 animate-pulse">
                            <Avatar className="h-8 w-8 mt-1 border border-border bg-background">
                                <AvatarFallback className="bg-background">
                                    <Bot className="h-4 w-4" />
                                </AvatarFallback>
                            </Avatar>
                            <div className="space-y-2.5 w-full max-w-md">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs text-muted-foreground">Searching across all documents...</span>
                                </div>
                                <div className="h-4 bg-muted/50 rounded w-3/4" />
                                <div className="h-4 bg-muted/50 rounded w-1/2" />
                            </div>
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border/40 bg-background/80 backdrop-blur-md sticky bottom-0">
                <div className="max-w-3xl mx-auto">
                    <div className="flex items-center gap-4 mb-2 px-1">
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={verify}
                                onChange={(e) => setVerify(e.target.checked)}
                                className="rounded border-border h-3 w-3 accent-primary"
                            />
                            <ShieldCheck className="h-3 w-3" />
                            Verify
                        </label>
                    </div>
                    <div className="relative group">
                        <form onSubmit={handleSubmit} className="relative">
                            <Input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Ask a question across all documents..."
                                className="pr-12 py-6 bg-muted/30 border-muted-foreground/20 focus-visible:bg-background focus-visible:border-primary/30 focus-visible:ring-0 transition-all text-sm shadow-sm"
                                disabled={loading}
                            />
                            <Button
                                type="submit"
                                size="icon"
                                disabled={!input.trim() || loading}
                                className={cn(
                                    "absolute right-1.5 top-1.5 h-9 w-9 transition-all",
                                    input.trim()
                                        ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                                        : "bg-transparent text-muted-foreground hover:bg-muted"
                                )}
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                        </form>
                        <div className="flex justify-center mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-500">
                            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1.5">
                                <Sparkles className="h-3 w-3" />
                                Cross-document AI research &middot; Check citations
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            </div>
        </div>
    )
}
