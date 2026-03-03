"use client"

import * as React from "react"
import {
    Send, User, Bot, FileText, Loader2, Sparkles, BookOpen,
    ShieldCheck,
    Clock, Zap, Brain, Search, BarChart3, X, Library, Plus,
    MessageSquare,
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
import { CollapsibleSection, VerificationBadge, ConfidenceIndicator, StageTimingBar, CitationCard, QueryBadge, EmptyState } from "@/components/shared/status-components"
import { ConversationSidebar } from "@/components/shared/conversation-sidebar"

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
    stageTimings?: Record<string, unknown>
    totalTimeSeconds?: number
    totalTokens?: number
    llmCalls?: number
}

interface ResearchChatProps {
    className?: string
    onCitationClick?: (docId: string, pageNumber: number, docName?: string) => void
    continueConvId?: string | null
}


// --- Main component ---

export function ResearchChat({ className, onCitationClick, continueConvId }: ResearchChatProps) {
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
    }, [mapToMessage, continueConvId])

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
            <ConversationSidebar
                title="Research Chats"
                emptyText="No research chats yet"
                fallbackName="New research"
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
                    <Library className="h-3.5 w-3.5 text-primary" />
                    <h2 className="text-xs font-medium text-foreground">Research</h2>
                    {/* {activeConvId && (
                        <span className="text-xs text-muted-foreground/50 truncate max-w-[200px]">
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
                    <div className="text-xs text-muted-foreground/40 flex items-center gap-1.5 pr-1">
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
                            <span className="text-xs">Loading chat history...</span>
                        </div>
                    )}

                    {!loadingHistory && messages.length === 0 && (
                        <EmptyState
                            icon={<Library className="h-8 w-8 text-foreground" />}
                            title="Cross-Document Research"
                            description="Ask questions that span multiple documents. I'll automatically select the relevant documents, retrieve from each, and synthesize a comprehensive answer with per-document citations."
                            className="h-[50vh] opacity-40"
                        />
                    )}

                    {messages.map((msg) => (
                        <div key={msg.id} className={cn("flex gap-5 group", msg.role === "user" ? "flex-row-reverse" : "")}>
                            <Avatar className={cn(
                                "h-7 w-7 mt-1 border shrink-0",
                                msg.role === "assistant" ? "bg-sidebar border-border" : "bg-primary border-primary"
                            )}>
                                <AvatarFallback className={msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-sidebar text-foreground"}>
                                    {msg.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                                </AvatarFallback>
                            </Avatar>

                            <div className={cn("flex flex-col gap-2 max-w-[85%] min-w-0", msg.role === "user" ? "items-end" : "items-start")}>
                                {/* Header badges */}
                                {msg.role === "assistant" && msg.queryType && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <QueryBadge label="Cross-Doc" colorClass="bg-purple-500/10 text-purple-400" />
                                        {msg.verificationStatus && <VerificationBadge status={msg.verificationStatus} />}
                                        {msg.selectedDocuments && msg.selectedDocuments.length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
                                                <FileText className="h-3 w-3" />
                                                {msg.selectedDocuments.length} docs
                                            </span>
                                        )}
                                        {msg.totalTimeSeconds !== undefined && msg.totalTimeSeconds > 0 && (
                                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
                                                <Clock className="h-3 w-3" />
                                                {msg.totalTimeSeconds.toFixed(1)}s
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Answer text */}
                                <div className={cn(
                                    "px-4 py-3 rounded-lg text-xs leading-relaxed",
                                    msg.role === "user"
                                        ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                                        : "bg-card border border-border text-foreground"
                                )}>
                                    {msg.role === "assistant" ? <Markdown content={msg.content} /> : msg.content}
                                </div>

                                {/* Citations with document attribution */}
                                {msg.citations && msg.citations.length > 0 && (
                                    <div className="mt-3 w-full space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="h-px bg-border w-4" />
                                            <span className="text-xs font-medium uppercase text-muted-foreground/70 tracking-wider">Sources</span>
                                            <div className="h-px bg-border flex-1" />
                                        </div>
                                        <div className="grid gap-2">
                                            {msg.citations.map((cite) => {
                                                const handleClick = onCitationClick ? () => {
                                                    const match = cite.page_range?.match(/p\.?\s*(\d+)/)
                                                    const page = match ? parseInt(match[1], 10) : 1

                                                    let docId = cite.doc_id
                                                    let docName = cite.doc_name

                                                    // Fallback 1: look up from retrieved sections by node_id
                                                    if (!docId && msg.retrievedSections) {
                                                        const sec = msg.retrievedSections.find(s => s.node_id === cite.node_id)
                                                        if (sec?.doc_id) { docId = sec.doc_id; docName = docName || sec.doc_name || "" }
                                                    }

                                                    // Fallback 2: parse filename from citation_id "[filename | section, p.N]"
                                                    if (!docId && cite.citation_id && msg.retrievedSections) {
                                                        const cidMatch = cite.citation_id.match(/^\[(.+?)\s*\|/)
                                                        if (cidMatch) {
                                                            const fname = cidMatch[1].trim()
                                                            const sec = msg.retrievedSections.find(s =>
                                                                s.doc_name === fname || (s.doc_name && fname.includes(s.doc_name)) || (s.doc_name && s.doc_name.includes(fname))
                                                            )
                                                            if (sec?.doc_id) { docId = sec.doc_id; docName = docName || sec.doc_name || fname }
                                                        }
                                                    }

                                                    if (docId) {
                                                        onCitationClick(docId, page, docName)
                                                    } else {
                                                        const cidFallback = cite.citation_id?.match(/^\[(.+?)\s*\|/)
                                                        const fname = cidFallback ? cidFallback[1].trim() : ""
                                                        onCitationClick("", page, fname || docName)
                                                    }
                                                } : undefined
                                                return (
                                                    <CitationCard
                                                        key={cite.citation_id}
                                                        title={cite.title}
                                                        subtitle={cite.doc_name}
                                                        pageRange={cite.page_range}
                                                        excerpt={cite.excerpt}
                                                        onClick={handleClick}
                                                    />
                                                )
                                            })}
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
                                                badge={<span className="text-xs text-muted-foreground/60">{msg.selectedDocuments.length}</span>}
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
                                                                            <span className={cn("font-mono text-xs", conf >= 70 ? "text-green-400" : conf >= 40 ? "text-amber-400" : "text-red-400")}>
                                                                                {conf}%
                                                                            </span>
                                                                        )}
                                                                        {typeof d.role === "string" && d.role && (
                                                                            <span className="text-xs px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground">{d.role}</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                {typeof d.relevance_reason === "string" && d.relevance_reason && (
                                                                    <p className="text-muted-foreground/70 text-xs">{d.relevance_reason}</p>
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
                                                badge={<span className="text-xs text-muted-foreground/60">{msg.inferredPoints.length}</span>}
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
                                                                        <p key={j} className="text-xs text-muted-foreground/50 border-l-2 border-primary/10 pl-2">{def}</p>
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
                                                badge={<span className="text-xs text-muted-foreground/60">{msg.retrievedSections.length}</span>}
                                            >
                                                <div className="space-y-2">
                                                    {msg.retrievedSections.map((section, i) => (
                                                        <div key={i} className="border border-border/20 rounded-md p-2 text-xs">
                                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                                <span className="font-medium text-foreground/80 truncate">{section.title}</span>
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <span className="text-xs text-muted-foreground/50 font-mono">{section.page_range}</span>
                                                                    <span className="text-xs px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground">{section.source}</span>
                                                                </div>
                                                            </div>
                                                            {section.doc_name && (
                                                                <p className="text-xs text-muted-foreground/50 mb-1">{section.doc_name}</p>
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
                                                badge={
                                                    msg.stageTimings?._benchmark ? (
                                                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
                                                            optimized
                                                        </span>
                                                    ) : msg.stageTimings?._cache_hit ? (
                                                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
                                                            cache hit
                                                        </span>
                                                    ) : null
                                                }
                                            >
                                                <div className="space-y-3">
                                                    {/* Benchmark summary bar (only in optimized mode) */}
                                                    {Boolean(msg.stageTimings?._benchmark) && (() => {
                                                        const bm = msg.stageTimings!._benchmark as Record<string, number>
                                                        const cacheHits = Number(bm.cache_hits ?? 0)
                                                        const skipped = Number(bm.stages_skipped ?? 0)
                                                        const llmCalls = Number(bm.total_llm_calls ?? 0)
                                                        const totalTok = Number(bm.total_input_tokens ?? 0) + Number(bm.total_output_tokens ?? 0)
                                                        return (
                                                            <div className="flex items-center gap-2 text-xs text-amber-400/80 bg-amber-500/5 rounded-md px-2 py-1.5 border border-amber-500/10">
                                                                <Zap className="h-3 w-3 shrink-0" />
                                                                <span>
                                                                    {cacheHits > 0 && <>{cacheHits} cache hits &middot; </>}
                                                                    {skipped > 0 && <>{skipped} stages skipped &middot; </>}
                                                                    {llmCalls} LLM calls &middot; {totalTok.toLocaleString()} tokens
                                                                </span>
                                                            </div>
                                                        )
                                                    })()}
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="bg-muted/30 rounded-md p-2">
                                                            <p className="text-xs text-muted-foreground">Response Time</p>
                                                            <p className="text-xs font-medium font-mono">{msg.totalTimeSeconds?.toFixed(1)}s</p>
                                                        </div>
                                                        <div className="bg-muted/30 rounded-md p-2">
                                                            <p className="text-xs text-muted-foreground">Total Tokens</p>
                                                            <p className="text-xs font-medium font-mono">{msg.totalTokens?.toLocaleString()}</p>
                                                        </div>
                                                        <div className="bg-muted/30 rounded-md p-2">
                                                            <p className="text-xs text-muted-foreground">LLM Calls</p>
                                                            <p className="text-xs font-medium font-mono">{msg.llmCalls}</p>
                                                        </div>
                                                        <div className="bg-muted/30 rounded-md p-2">
                                                            <p className="text-xs text-muted-foreground">Docs Searched</p>
                                                            <p className="text-xs font-medium font-mono">{msg.selectedDocuments?.length || 0}</p>
                                                        </div>
                                                    </div>
                                                    {msg.stageTimings && Object.keys(msg.stageTimings).length > 0 && (
                                                        <div className="space-y-1.5">
                                                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Stage Timings</p>
                                                            {(() => {
                                                                const entries = Object.entries(msg.stageTimings)
                                                                    .filter(([k, v]) => typeof v === "number" && !k.startsWith("_"))
                                                                const maxVal = Math.max(...entries.map(([, v]) => v as number), 0.1)
                                                                return entries.map(([name, secs]) => (
                                                                    <StageTimingBar key={name} name={name} seconds={secs as number} maxSeconds={maxVal} />
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
                            <Avatar className="h-7 w-7 mt-1 border border-border bg-sidebar">
                                <AvatarFallback className="bg-sidebar">
                                    <Bot className="h-3.5 w-3.5" />
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
            <div className="border-t border-border bg-background px-4 py-3">
                <div className="max-w-3xl mx-auto">
                    <form onSubmit={handleSubmit} className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-2 focus-within:border-primary/50 transition-colors">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask a question across all documents…"
                            className="flex-1 border-0 bg-transparent p-0 h-auto text-xs focus-visible:ring-0 shadow-none placeholder:text-muted-foreground/40"
                            disabled={loading}
                        />
                        <div className="flex items-center gap-2 border-l border-border pl-2 shrink-0">
                            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none" title="Verify answer against sources">
                                <input
                                    type="checkbox"
                                    checked={verify}
                                    onChange={(e) => setVerify(e.target.checked)}
                                    className="h-3 w-3 accent-primary"
                                />
                                <ShieldCheck className="h-3 w-3" />
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
