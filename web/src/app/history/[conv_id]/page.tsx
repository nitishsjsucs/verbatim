"use client"

import * as React from "react"
import {
    ArrowLeft, User, Bot, FileText, Loader2, AlertTriangle,
    ShieldCheck, ShieldAlert, ShieldQuestion, Clock, Brain,
    Search, ChevronDown, ChevronRight, Library,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Sidebar } from "@/components/layout/sidebar"
import { fetchConversation } from "@/lib/api"
import { Conversation, ConversationMessage, Citation } from "@/lib/types"
import Link from "next/link"
import { Markdown } from "@/components/ui/markdown"
import dynamic from "next/dynamic"
import type { PdfViewerHandle } from "@/components/views/pdf-viewer"

const PdfViewer = dynamic(
    () => import("@/components/views/pdf-viewer").then(mod => mod.PdfViewer),
    {
        ssr: false,
        loading: () => (
            <div className="flex items-center justify-center h-full w-full text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-sm">Loading PDF viewer...</span>
            </div>
        ),
    }
)

// --- Helper components ---

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

function CollapsibleSection({ title, icon, children, badge }: {
    title: string; icon: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode
}) {
    const [open, setOpen] = React.useState(false)
    return (
        <div className="border border-border/30 rounded-lg overflow-hidden mt-2">
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

function MessageBubble({ msg, onCitationClick }: { msg: ConversationMessage; onCitationClick?: (page: number) => void }) {
    const isUser = msg.role === "user"
    const date = msg.timestamp ? new Date(msg.timestamp) : null

    return (
        <div className={cn("flex gap-4 group", isUser ? "flex-row-reverse" : "")}>
            {/* Avatar */}
            <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-1 border",
                isUser ? "bg-primary border-primary" : "bg-background border-border"
            )}>
                {isUser
                    ? <User className="h-4 w-4 text-primary-foreground" />
                    : <Bot className="h-4 w-4 text-foreground" />
                }
            </div>

            <div className={cn("flex flex-col gap-1.5 max-w-[85%] min-w-0", isUser ? "items-end" : "items-start")}>
                {/* Timestamp */}
                {date && (
                    <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                )}

                {/* Badges for assistant */}
                {!isUser && msg.query_type && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                            {msg.query_type}
                        </span>
                        {msg.verification_status && <VerificationBadge status={msg.verification_status} />}
                        {msg.total_time_seconds !== undefined && msg.total_time_seconds > 0 && (
                            <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {msg.total_time_seconds.toFixed(1)}s
                            </span>
                        )}
                    </div>
                )}

                {/* Bubble */}
                <div className={cn(
                    "px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                    isUser
                        ? "bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap"
                        : "bg-muted/30 border border-border/40 text-foreground rounded-tl-sm"
                )}>
                    {isUser ? msg.content : <Markdown content={msg.content} />}
                </div>

                {/* Citations */}
                {!isUser && msg.citations && msg.citations.length > 0 && (
                    <div className="w-full space-y-2 mt-1">
                        <div className="flex items-center gap-2">
                            <div className="h-px bg-border w-4" />
                            <span className="text-[10px] font-medium uppercase text-muted-foreground/60 tracking-wider">Sources</span>
                            <div className="h-px bg-border flex-1" />
                        </div>
                        <div className="grid gap-1.5">
                            {(msg.citations as Citation[]).map((cite) => {
                                const pageMatch = cite.page_range.match(/p\.?\s*(\d+)/)
                                const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : null
                                return (
                                <div
                                    key={cite.citation_id}
                                    className={cn(
                                        "bg-background/50 border border-border/40 rounded-lg p-2.5 transition-colors",
                                        pageNum && onCitationClick ? "cursor-pointer hover:border-primary/40 hover:bg-primary/5" : ""
                                    )}
                                    onClick={() => pageNum && onCitationClick?.(pageNum)}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <FileText className="h-3 w-3 text-blue-400 shrink-0" />
                                            <span className="text-xs font-medium truncate">{cite.title}</span>
                                        </div>
                                        <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                                            {cite.page_range}
                                        </span>
                                    </div>
                                    {cite.excerpt && (
                                        <p className="text-xs text-muted-foreground/70 line-clamp-2 border-l-2 border-primary/10 pl-3">
                                            {cite.excerpt}
                                        </p>
                                    )}
                                </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Expandable sections */}
                {!isUser && msg.record_id && (
                    <div className="w-full">
                        {msg.inferred_points && msg.inferred_points.length > 0 && (
                            <CollapsibleSection
                                title="Inferred Points"
                                icon={<Brain className="h-3 w-3" />}
                                badge={<span className="text-[10px] text-muted-foreground/50">{msg.inferred_points.length}</span>}
                            >
                                <div className="space-y-2">
                                    {msg.inferred_points.map((ip, i) => (
                                        <div key={i} className="text-xs">
                                            <p className="font-medium text-foreground/90">{ip.point}</p>
                                            {ip.reasoning && <p className="text-muted-foreground/60 italic mt-0.5">{ip.reasoning}</p>}
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleSection>
                        )}
                        {msg.retrieved_sections && msg.retrieved_sections.length > 0 && (
                            <CollapsibleSection
                                title="Retrieved Sections"
                                icon={<Search className="h-3 w-3" />}
                                badge={<span className="text-[10px] text-muted-foreground/50">{msg.retrieved_sections.length}</span>}
                            >
                                <div className="space-y-2">
                                    {msg.retrieved_sections.map((s, i) => (
                                        <div key={i} className="text-xs border border-border/20 rounded p-2">
                                            <p className="font-medium text-foreground/80">{s.title}</p>
                                            <p className="text-muted-foreground/50 font-mono text-[10px]">{s.page_range}</p>
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleSection>
                        )}
                        {msg.verification_notes && (
                            <CollapsibleSection
                                title="Verification Details"
                                icon={<ShieldCheck className="h-3 w-3" />}
                            >
                                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{msg.verification_notes}</p>
                            </CollapsibleSection>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

// --- Main page ---

export default function ConversationDetailPage({ params }: { params: Promise<{ conv_id: string }> }) {
    const { conv_id } = React.use(params)
    const [conv, setConv] = React.useState<Conversation | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const bottomRef = React.useRef<HTMLDivElement>(null)
    const pdfRef = React.useRef<PdfViewerHandle>(null)

    React.useEffect(() => {
        setLoading(true)
        fetchConversation(conv_id)
            .then(setConv)
            .catch(() => setError("Failed to load conversation"))
            .finally(() => setLoading(false))
    }, [conv_id])

    // Scroll chat to bottom once loaded
    React.useEffect(() => {
        if (!loading && conv && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: "smooth" })
        }
    }, [loading, conv])

    const isResearch = conv?.type === "research"

    // PDF URL — only for document conversations
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001"
    const pdfUrl = (!isResearch && conv?.doc_id)
        ? `${API_BASE}/documents/${conv.doc_id}/raw`
        : null

    const handleCitationClick = React.useCallback((pageNumber: number) => {
        if (pdfRef.current && pageNumber >= 1) {
            pdfRef.current.jumpToPage(pageNumber - 1)
        }
    }, [])

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <div className="h-14 border-b border-border/40 flex items-center gap-4 px-6 shrink-0 bg-background/80 backdrop-blur-md">
                    <Link
                        href="/history"
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        History
                    </Link>
                    <span className="text-muted-foreground/30">/</span>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        {isResearch
                            ? <Library className="h-4 w-4 text-primary shrink-0" />
                            : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        }
                        <h1 className="text-sm font-semibold truncate">
                            {conv?.title || conv?.doc_name || "Conversation"}
                        </h1>
                        {conv && (
                            <span className="text-[10px] text-muted-foreground/40 shrink-0">
                                {conv.message_count} messages
                            </span>
                        )}
                    </div>
                    {conv?.doc_name && (
                        <span className="text-[11px] text-muted-foreground/50 shrink-0 hidden sm:block">
                            {conv.doc_name}
                        </span>
                    )}
                </div>

                {/* Split pane body */}
                <div className="flex-1 flex min-h-0">

                    {/* Left: Chat */}
                    <div className={cn(
                        "flex flex-col min-h-0 overflow-y-auto",
                        pdfUrl ? "w-[60%] border-r border-border/40" : "flex-1"
                    )}>
                        <div className="space-y-8 px-5 py-8 max-w-2xl mx-auto w-full">
                            {loading && (
                                <div className="flex items-center justify-center py-20 text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                    <span className="text-sm">Loading conversation...</span>
                                </div>
                            )}

                            {error && (
                                <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 rounded-lg px-4 py-3">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    {error}
                                </div>
                            )}

                            {!loading && conv && conv.messages.length === 0 && (
                                <div className="text-center py-20 text-muted-foreground/40 text-sm">
                                    No messages in this conversation.
                                </div>
                            )}

                            {!loading && conv && conv.messages.map((msg) => (
                                <MessageBubble
                                    key={msg.id}
                                    msg={msg}
                                    onCitationClick={handleCitationClick}
                                />
                            ))}

                            <div ref={bottomRef} />
                        </div>
                    </div>

                    {/* Right: PDF viewer */}
                    {pdfUrl && (
                        <div className="flex-1 min-h-0 bg-muted/10">
                            <PdfViewer
                                ref={pdfRef}
                                fileUrl={pdfUrl}
                                className="h-full w-full"
                            />
                        </div>
                    )}

                    {/* Research conversations: no PDF, just full-width chat */}
                    {isResearch && !pdfUrl && (
                        <div className="flex-1" />
                    )}
                </div>
            </main>
        </div>
    )
}
