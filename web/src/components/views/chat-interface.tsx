"use client"

import * as React from "react"
import {
    Send, User, Bot, FileText, Loader2, Sparkles, BookOpen,
    ShieldCheck,
    Clock, Zap, Brain, Search, Route, BarChart3, CheckCircle2, XCircle,
    Plus, MessageSquare,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import {
    runQuery, fetchConversation, fetchConversationsByDoc, deleteConversation,
} from "@/lib/api"
import {
    Citation, QueryResponse, InferredPoint, RetrievedSection, RoutingLog,
    QueryType, ConversationMeta,
} from "@/lib/types"
import { FeedbackPanel } from "./feedback-panel"
import { Markdown } from "@/components/ui/markdown"
import { CollapsibleSection, VerificationBadge, ConfidenceIndicator, StageTimingBar, CitationCard, QueryBadge, EmptyState } from "@/components/shared/status-components"
import { ConversationSidebar } from "@/components/shared/conversation-sidebar"

interface ChatInterfaceProps {
    docId: string
    onCitationClick?: (pageNumber: number) => void
    continueConvId?: string | null
}

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    citations?: Citation[]
    recordId?: string
    verificationStatus?: string
    verificationNotes?: string
    inferredPoints?: InferredPoint[]
    queryType?: QueryType
    subQueries?: string[]
    keyTerms?: string[]
    retrievedSections?: RetrievedSection[]
    routingLog?: RoutingLog | null
    stageTimings?: Record<string, number>
    totalTimeSeconds?: number
    totalTokens?: number
    llmCalls?: number
}

// --- Helper sub-components ---

const QUERY_TYPE_LABELS: Record<string, string> = {
    single_hop: "Single-Hop",
    multi_hop: "Multi-Hop",
    global: "Global",
    definitional: "Definitional",
}


// --- Main component ---

export function ChatInterface({ docId, onCitationClick, continueConvId }: ChatInterfaceProps) {
    const [messages, setMessages] = React.useState<Message[]>([])
    const [input, setInput] = React.useState("")
    const [loading, setLoading] = React.useState(false)
    const [loadingHistory, setLoadingHistory] = React.useState(true)
    const [verify, setVerify] = React.useState(true)
    const [reflect, setReflect] = React.useState(false)
    const scrollAreaRef = React.useRef<HTMLDivElement>(null)
    const bottomRef = React.useRef<HTMLDivElement>(null)

    // Multi-conversation state
    const [conversations, setConversations] = React.useState<ConversationMeta[]>([])
    const [activeConvId, setActiveConvId] = React.useState<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)

    // Helper: map backend ConversationMessage to local Message type
    const mapToMessage = React.useCallback((m: {
        id?: string; role: string; content: string; record_id?: string;
        citations?: Citation[]; inferred_points?: InferredPoint[];
        verification_status?: string; verification_notes?: string;
        query_type?: string; sub_queries?: string[]; key_terms?: string[];
        retrieved_sections?: RetrievedSection[]; routing_log?: RoutingLog | null;
        stage_timings?: Record<string, number>; total_time_seconds?: number;
        total_tokens?: number; llm_calls?: number;
    }): Message => ({
        id: m.id || Date.now().toString(),
        role: m.role as "user" | "assistant",
        content: m.content,
        recordId: m.record_id || undefined,
        citations: m.citations,
        inferredPoints: m.inferred_points,
        verificationStatus: m.verification_status,
        verificationNotes: m.verification_notes,
        queryType: m.query_type as QueryType | undefined,
        subQueries: m.sub_queries,
        keyTerms: m.key_terms,
        retrievedSections: m.retrieved_sections,
        routingLog: m.routing_log,
        stageTimings: m.stage_timings,
        totalTimeSeconds: m.total_time_seconds,
        totalTokens: m.total_tokens,
        llmCalls: m.llm_calls,
    }), [])

    // Load conversation list for this document on mount
    React.useEffect(() => {
        let cancelled = false
        setLoadingHistory(true)

        fetchConversationsByDoc(docId)
            .then(async (convList) => {
                if (cancelled) return
                setConversations(convList)

                // If continueConvId is provided, open that conversation; otherwise open most recent
                const targetConvId = continueConvId && convList.some(c => c.conv_id === continueConvId)
                    ? continueConvId
                    : convList.length > 0 ? convList[0].conv_id : null

                if (targetConvId) {
                    setActiveConvId(targetConvId)
                    try {
                        const conv = await fetchConversation(targetConvId)
                        if (cancelled) return
                        if (conv.messages && conv.messages.length > 0) {
                            setMessages(conv.messages.map(mapToMessage))
                        }
                    } catch {
                        // Failed to load conversation
                    }
                }
            })
            .catch(() => { /* no conversations yet */ })
            .finally(() => {
                if (!cancelled) setLoadingHistory(false)
            })

        return () => { cancelled = true }
    }, [docId, mapToMessage, continueConvId])

    // Switch conversation
    const handleSelectConversation = React.useCallback(async (convId: string) => {
        if (convId === activeConvId) return
        setActiveConvId(convId)
        setMessages([])
        setLoadingHistory(true)

        try {
            const conv = await fetchConversation(convId)
            if (conv.messages && conv.messages.length > 0) {
                setMessages(conv.messages.map(mapToMessage))
            }
        } catch {
            // Failed to load
        } finally {
            setLoadingHistory(false)
        }
    }, [activeConvId, mapToMessage])

    // New chat
    const handleNewChat = React.useCallback(() => {
        setActiveConvId(null)
        setMessages([])
    }, [])

    // Delete conversation
    const handleDeleteConversation = React.useCallback(async (convId: string) => {
        try {
            await deleteConversation(convId)
            setConversations((prev) => prev.filter((c) => c.conv_id !== convId))
            if (convId === activeConvId) {
                setActiveConvId(null)
                setMessages([])
            }
        } catch {
            // Ignore
        }
    }, [activeConvId])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || loading) return

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input
        }

        setMessages(prev => [...prev, userMsg])
        setInput("")
        setLoading(true)

        try {
            const res: QueryResponse = await runQuery({
                query: userMsg.content,
                doc_id: docId,
                verify,
                reflect,
                conv_id: activeConvId || undefined,
            })

            const botMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
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
                routingLog: res.routing_log,
                stageTimings: res.stage_timings,
                totalTimeSeconds: res.total_time_seconds,
                totalTokens: res.total_tokens,
                llmCalls: res.llm_calls,
            }
            setMessages(prev => [...prev, botMsg])

            // If this was a new conversation, update active conv_id
            if (!activeConvId && res.conv_id) {
                setActiveConvId(res.conv_id)
            }
            // Refresh the conversation list
            fetchConversationsByDoc(docId)
                .then(setConversations)
                .catch(() => {})
        } catch (err) {
            console.error(err)
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: "Sorry, I encountered an error answering your question. Please try again."
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
        <div className="flex h-full bg-background relative">
            {/* Conversation sidebar */}
            <ConversationSidebar
                title="Conversations"
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
                <div className="h-11 border-b border-border flex items-center px-4 shrink-0 bg-background justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        <h2 className="text-sm-minus font-medium text-foreground">Q&A</h2>
                        {/* {activeConvId && (
                            <span className="text-xs-plus text-muted-foreground/50 truncate max-w-[200px]">
                                {conversations.find(c => c.conv_id === activeConvId)?.title?.slice(0, 40) || ""}
                            </span>
                        )} */}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleNewChat}
                            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            New
                        </Button>
                        <div className="text-xs-plus text-muted-foreground/40 flex items-center gap-1.5 pr-1">
                            <div className="h-1.5 w-1.5 rounded-full bg-green-500/60" />
                            Active
                        </div>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4" ref={scrollAreaRef}>
                    <div className="space-y-6 max-w-3xl mx-auto py-6">
                        {loadingHistory && (
                            <div className="flex items-center justify-center h-[30vh] text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                <span className="text-sm">Loading chat history...</span>
                            </div>
                        )}

                        {!loadingHistory && messages.length === 0 && (
                            <EmptyState
                                icon={<BookOpen className="h-8 w-8 text-foreground" />}
                                title="Ask questions about this document"
                                description="Try asking about specific clauses, definitions, or summaries. I'll trace headers and follow cross-references to find the answer."
                                className="h-[50vh] opacity-40"
                            />
                        )}

                        {messages.map((msg) => (
                            <div key={msg.id} className={cn("flex gap-5 group", msg.role === 'user' ? "flex-row-reverse" : "")}>
                                <Avatar className={cn(
                                    "h-7 w-7 mt-1 border shrink-0",
                                    msg.role === 'assistant' ? "bg-sidebar border-border" : "bg-primary border-primary"
                                )}>
                                    <AvatarFallback className={msg.role === 'user' ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}>
                                        {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                    </AvatarFallback>
                                </Avatar>

                                <div className={cn("flex flex-col gap-2 max-w-[85%] min-w-0", msg.role === 'user' ? "items-end" : "items-start")}>
                                    {/* Header badges for assistant */}
                                    {msg.role === 'assistant' && msg.queryType && (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <QueryBadge label={QUERY_TYPE_LABELS[msg.queryType] || msg.queryType} />
                                            {msg.verificationStatus && <VerificationBadge status={msg.verificationStatus} />}
                                            {msg.totalTimeSeconds !== undefined && msg.totalTimeSeconds > 0 && (
                                                <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground/60">
                                                    <Clock className="h-3 w-3" />
                                                    {msg.totalTimeSeconds.toFixed(1)}s
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Answer text */}
                                    <div className={cn(
                                        "px-4 py-3 rounded-lg text-sm-minus leading-relaxed",
                                        msg.role === 'user'
                                            ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                                            : "bg-card border border-border text-foreground"
                                    )}>
                                        {msg.role === 'assistant' ? (
                                            <Markdown content={msg.content} />
                                        ) : (
                                            msg.content
                                        )}
                                    </div>

                                    {/* Citations */}
                                    {msg.citations && msg.citations.length > 0 && (
                                        <div className="mt-3 w-full space-y-3">
                                            <div className="flex items-center gap-2">
                                                <div className="h-px bg-border w-4" />
                                                <span className="text-2xs font-medium uppercase text-muted-foreground/70 tracking-wider">Sources</span>
                                                <div className="h-px bg-border flex-1" />
                                            </div>
                                            <div className="grid gap-2">
                                                {msg.citations.map((cite) => (
                                                    <CitationCard
                                                        key={cite.citation_id}
                                                        title={cite.title}
                                                        pageRange={cite.page_range}
                                                        excerpt={cite.excerpt}
                                                        onClick={onCitationClick ? () => {
                                                            const match = cite.page_range?.match(/p\.?\s*(\d+)/)
                                                            const page = match ? parseInt(match[1], 10) : 1
                                                            onCitationClick(page)
                                                        } : undefined}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Expandable detail sections for assistant messages */}
                                    {msg.role === 'assistant' && msg.recordId && (
                                        <div className="w-full space-y-2 mt-2">

                                            {/* Inferred Points */}
                                            {msg.inferredPoints && msg.inferredPoints.length > 0 && (
                                                <CollapsibleSection
                                                    title="Inferred Points"
                                                    icon={<Brain className="h-3 w-3" />}
                                                    badge={<span className="text-2xs text-muted-foreground/60">{msg.inferredPoints.length}</span>}
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
                                                                            <p key={j} className="text-2xs text-muted-foreground/50 border-l-2 border-primary/10 pl-2">{def}</p>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </CollapsibleSection>
                                            )}

                                            {/* Verification Details */}
                                            {msg.verificationNotes && (
                                                <CollapsibleSection
                                                    title="Verification Details"
                                                    icon={<ShieldCheck className="h-3 w-3" />}
                                                >
                                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{msg.verificationNotes}</p>
                                                </CollapsibleSection>
                                            )}

                                            {/* Retrieved Sections */}
                                            {msg.retrievedSections && msg.retrievedSections.length > 0 && (
                                                <CollapsibleSection
                                                    title="Retrieved Sections"
                                                    icon={<Search className="h-3 w-3" />}
                                                    badge={<span className="text-2xs text-muted-foreground/60">{msg.retrievedSections.length}</span>}
                                                >
                                                    <div className="space-y-2">
                                                        {msg.retrievedSections
                                                            .sort((a, b) => {
                                                                if (!msg.routingLog?.locate_results) return 0
                                                                const confMap: Record<string, number> = {}
                                                                for (const r of msg.routingLog.locate_results) {
                                                                    const nid = (r as Record<string, unknown>).node_id as string
                                                                    const conf = (r as Record<string, unknown>).confidence as number
                                                                    if (nid && typeof conf === "number") confMap[nid] = conf
                                                                }
                                                                return (confMap[b.node_id] ?? 0) - (confMap[a.node_id] ?? 0)
                                                            })
                                                            .map((section, i) => {
                                                                let confidence: number | null = null
                                                                if (msg.routingLog?.locate_results) {
                                                                    for (const r of msg.routingLog.locate_results) {
                                                                        const rec = r as Record<string, unknown>
                                                                        if (rec.node_id === section.node_id && typeof rec.confidence === "number") {
                                                                            confidence = rec.confidence as number
                                                                        }
                                                                    }
                                                                }
                                                                const confPct = confidence !== null ? Math.round(confidence * 100) : null
                                                                const confColor = confPct !== null
                                                                    ? confPct >= 70 ? "text-green-400" : confPct >= 40 ? "text-amber-400" : "text-red-400"
                                                                    : ""
                                                                return (
                                                                    <div key={i} className="border border-border/20 rounded-md p-2 text-xs">
                                                                        <div className="flex items-center justify-between gap-2 mb-1">
                                                                            <span className="font-medium text-foreground/80 truncate">{section.title}</span>
                                                                            <div className="flex items-center gap-2 shrink-0">
                                                                                {confPct !== null && (
                                                                                    <span className={cn("font-mono text-2xs", confColor)}>{confPct}%</span>
                                                                                )}
                                                                                <span className="text-2xs text-muted-foreground/50 font-mono">{section.page_range}</span>
                                                                                <span className="text-2xs px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground">{section.source}</span>
                                                                            </div>
                                                                        </div>
                                                                        <p className="text-muted-foreground/70 line-clamp-2">{section.text.slice(0, 300)}</p>
                                                                    </div>
                                                                )
                                                            })}
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
                                                                <p className="text-2xs text-muted-foreground">Response Time</p>
                                                                <p className="text-sm font-medium font-mono">{msg.totalTimeSeconds?.toFixed(1)}s</p>
                                                            </div>
                                                            <div className="bg-muted/30 rounded-md p-2">
                                                                <p className="text-2xs text-muted-foreground">Total Tokens</p>
                                                                <p className="text-sm font-medium font-mono">{msg.totalTokens?.toLocaleString()}</p>
                                                            </div>
                                                            <div className="bg-muted/30 rounded-md p-2">
                                                                <p className="text-2xs text-muted-foreground">LLM Calls</p>
                                                                <p className="text-sm font-medium font-mono">{msg.llmCalls}</p>
                                                            </div>
                                                            <div className="bg-muted/30 rounded-md p-2">
                                                                <p className="text-2xs text-muted-foreground">Sections Read</p>
                                                                <p className="text-sm font-medium font-mono">{msg.retrievedSections?.length || 0}</p>
                                                            </div>
                                                        </div>
                                                        {msg.stageTimings && Object.keys(msg.stageTimings).length > 0 && (
                                                            <div className="space-y-1.5">
                                                                <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Stage Timings</p>
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

                                            {/* Routing Log */}
                                            {msg.routingLog && (
                                                <CollapsibleSection
                                                    title="Routing Log"
                                                    icon={<Route className="h-3 w-3" />}
                                                >
                                                    <div className="space-y-3 text-xs">
                                                        {msg.subQueries && msg.subQueries.length > 0 && (
                                                            <div>
                                                                <p className="text-2xs font-medium text-muted-foreground mb-1">Sub-queries</p>
                                                                <div className="space-y-0.5">
                                                                    {msg.subQueries.map((sq, i) => (
                                                                        <p key={i} className="text-muted-foreground/70 pl-2 border-l-2 border-primary/10">{sq}</p>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {msg.keyTerms && msg.keyTerms.length > 0 && (
                                                            <div>
                                                                <p className="text-2xs font-medium text-muted-foreground mb-1">Key Terms</p>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {msg.keyTerms.map((term, i) => (
                                                                        <span key={i} className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-2xs">{term}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {msg.routingLog.locate_results.length > 0 && (
                                                            <div>
                                                                <p className="text-2xs font-medium text-muted-foreground mb-1">
                                                                    Located Nodes ({msg.routingLog.total_nodes_located})
                                                                </p>
                                                                <div className="space-y-1">
                                                                    {msg.routingLog.locate_results.map((r, i) => {
                                                                        const rec = r as Record<string, unknown>
                                                                        const conf = typeof rec.confidence === "number" ? Math.round((rec.confidence as number) * 100) : null
                                                                        return (
                                                                            <div key={i} className="flex items-center gap-2 text-muted-foreground/70">
                                                                                <span className="font-mono text-2xs text-muted-foreground/50">{rec.node_id as string}</span>
                                                                                <span className="truncate flex-1">{rec.title as string || rec.relevance_reason as string || ""}</span>
                                                                                {conf !== null && <span className="font-mono text-2xs">{conf}%</span>}
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {msg.routingLog.cross_ref_follows.length > 0 && (
                                                            <div>
                                                                <p className="text-2xs font-medium text-muted-foreground mb-1">Cross-Reference Follows</p>
                                                                <div className="space-y-1">
                                                                    {msg.routingLog.cross_ref_follows.map((cr, i) => {
                                                                        const rec = cr as Record<string, unknown>
                                                                        return (
                                                                            <div key={i} className="flex items-center gap-1.5 text-muted-foreground/70">
                                                                                {rec.resolved ? <CheckCircle2 className="h-3 w-3 text-green-400" /> : <XCircle className="h-3 w-3 text-red-400" />}
                                                                                <span className="font-mono text-2xs">{rec.source_node_id as string}</span>
                                                                                <span className="text-muted-foreground/40">→</span>
                                                                                <span>{rec.target_identifier as string}</span>
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="flex gap-4 text-2xs text-muted-foreground/50 pt-1 border-t border-border/20">
                                                            <span>{msg.routingLog.total_nodes_located} nodes located</span>
                                                            <span>{msg.routingLog.total_sections_read} sections read</span>
                                                            <span>{msg.routingLog.total_tokens_retrieved.toLocaleString()} tokens retrieved</span>
                                                        </div>
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
                                <Avatar className="h-7 w-7 mt-1 border border-border bg-sidebar">
                                    <AvatarFallback className="bg-sidebar">
                                        <Bot className="h-3.5 w-3.5" />
                                    </AvatarFallback>
                                </Avatar>
                                <div className="space-y-2.5 w-full max-w-md">
                                    <div className="h-4 bg-muted/50 rounded w-3/4" />
                                    <div className="h-4 bg-muted/50 rounded w-1/2" />
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>
                </div>

                {/* Input */}
                <div className="border-t border-border bg-background px-4 py-3">
                    <div className="max-w-3xl mx-auto">
                        <form onSubmit={handleSubmit} className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-2 focus-within:border-primary/50 transition-colors">
                            <Input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Ask a question about this document…"
                                className="flex-1 border-0 bg-transparent p-0 h-auto text-sm-minus focus-visible:ring-0 shadow-none placeholder:text-muted-foreground/40"
                                disabled={loading}
                            />
                            {/* Options */}
                            <div className="flex items-center gap-2 border-l border-border pl-2 shrink-0">
                                <label className="flex items-center gap-1 text-xs-plus text-muted-foreground cursor-pointer select-none" title="Verify answer against source">
                                    <input
                                        type="checkbox"
                                        checked={verify}
                                        onChange={(e) => setVerify(e.target.checked)}
                                        className="h-3 w-3 accent-primary"
                                    />
                                    <ShieldCheck className="h-3 w-3" />
                                </label>
                                <label className="flex items-center gap-1 text-xs-plus text-muted-foreground cursor-pointer select-none" title="Enable reflection">
                                    <input
                                        type="checkbox"
                                        checked={reflect}
                                        onChange={(e) => setReflect(e.target.checked)}
                                        className="h-3 w-3 accent-primary"
                                    />
                                    <Zap className="h-3 w-3" />
                                </label>
                            </div>
                            <Button
                                type="submit"
                                size="icon"
                                disabled={!input.trim() || loading}
                                className={cn(
                                    "h-7 w-7 shrink-0 transition-all",
                                    input.trim()
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                        : "bg-muted text-muted-foreground/40"
                                )}
                            >
                                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            </Button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    )
}
