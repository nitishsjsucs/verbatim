"use client"

import * as React from "react"
import {
    ArrowLeft, User, Bot, FileText, Loader2, AlertTriangle,
    ShieldCheck, ShieldAlert, ShieldQuestion, Clock, Brain,
    Search, ChevronDown, ChevronRight, Library, MessageSquare,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { CitationCard, QueryBadge } from "@/components/shared/status-components"
import { Sidebar } from "@/components/layout/sidebar"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { fetchConversation, fetchDocuments, API_BASE_URL } from "@/lib/api"
import { Conversation, ConversationMessage } from "@/lib/types"
import Link from "next/link"
import { Markdown } from "@/components/ui/markdown"
import dynamic from "next/dynamic"

const PdfViewer = dynamic(
    () => import("@/components/views/pdf-viewer").then(mod => mod.PdfViewer),
    { ssr: false }
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
        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", config.color)}>
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

function MessageBubble({ msg, onCitationClick }: { msg: ConversationMessage; onCitationClick?: (docId: string | undefined, page: number, docName?: string) => void }) {
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
                    <span className="text-xs text-muted-foreground/40 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {`${String(date.getDate()).padStart(2, "0")} ${date.toLocaleDateString("en-US", { month: "short" })} ${date.getFullYear()}`} {date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </span>
                )}

                {/* Badges for assistant */}
                {!isUser && msg.query_type && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <QueryBadge label={msg.query_type} />
                        {msg.verification_status && <VerificationBadge status={msg.verification_status} />}
                        {msg.total_time_seconds !== undefined && msg.total_time_seconds > 0 && (
                            <span className="text-xs text-muted-foreground/50 flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {msg.total_time_seconds.toFixed(1)}s
                            </span>
                        )}
                    </div>
                )}

                {/* Bubble */}
                <div className={cn(
                    "px-4 py-3 rounded-2xl text-xs leading-relaxed shadow-sm",
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
                            <span className="text-xs font-medium uppercase text-muted-foreground/60 tracking-wider">Sources</span>
                            <div className="h-px bg-border flex-1" />
                        </div>
                        <div className="grid gap-1.5">
                            {msg.citations.map((cite) => {
                                const pageMatch = cite.page_range?.match(/p\.?\s*(\d+)/)
                                const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 1

                                // Get doc_id with fallbacks
                                let citeDocId = (cite as any).doc_id as string | undefined
                                let citeDocName = (cite as any).doc_name as string | undefined

                                // Fallback 1: look up from retrieved_sections by node_id
                                if (!citeDocId && msg.retrieved_sections) {
                                    const sec = (msg.retrieved_sections as any[]).find((s: any) => s.node_id === cite.node_id)
                                    if (sec?.doc_id) { citeDocId = sec.doc_id; citeDocName = citeDocName || sec.doc_name || "" }
                                }

                                // Fallback 2: parse filename from citation_id "[filename | section, p.N]"
                                if (!citeDocId && cite.citation_id && msg.retrieved_sections) {
                                    const cidMatch = cite.citation_id.match(/^\[(.+?)\s*\|/)
                                    if (cidMatch) {
                                        const fname = cidMatch[1].trim()
                                        const sec = (msg.retrieved_sections as any[]).find((s: any) =>
                                            s.doc_name === fname || (s.doc_name && fname.includes(s.doc_name)) || (s.doc_name && s.doc_name.includes(fname))
                                        )
                                        if (sec?.doc_id) { citeDocId = sec.doc_id; citeDocName = citeDocName || sec.doc_name || fname }
                                    }
                                }

                                const handleClick = onCitationClick ? () => {
                                    let finalDocId = citeDocId
                                    let finalDocName = citeDocName
                                    if (!finalDocId && cite.citation_id) {
                                        const cidFb = cite.citation_id.match(/^\[(.+?)\s*\|/)
                                        if (cidFb) { finalDocName = finalDocName || cidFb[1].trim() }
                                    }
                                    onCitationClick?.(finalDocId, pageNum, finalDocName)
                                } : undefined

                                return (
                                    <CitationCard
                                        key={cite.citation_id}
                                        title={cite.title}
                                        subtitle={citeDocName}
                                        pageRange={cite.page_range}
                                        excerpt={cite.excerpt}
                                        onClick={handleClick}
                                    />
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
                                badge={<span className="text-xs text-muted-foreground/50">{msg.inferred_points.length}</span>}
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
                                badge={<span className="text-xs text-muted-foreground/50">{msg.retrieved_sections.length}</span>}
                            >
                                <div className="space-y-2">
                                    {msg.retrieved_sections.map((s, i) => (
                                        <div key={i} className="text-xs border border-border/20 rounded p-2">
                                            <p className="font-medium text-foreground/80">{s.title}</p>
                                            <p className="text-muted-foreground/50 font-mono text-xs">{s.page_range}</p>
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


    // For document conversations, use the conversation's doc_id.
    // For research conversations, dynamically load based on citation doc_id.
    const [pdfDocId, setPdfDocId] = React.useState<string | null>(null)
    const [pdfJumpPage, setPdfJumpPage] = React.useState<number | undefined>(undefined)
    const [pdfJumpKey, setPdfJumpKey] = React.useState(0)

    // Resizable splitter
    const [historySplit, setHistorySplit] = React.useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("doc_split_history")
            if (saved) return Math.max(15, Math.min(85, Number(saved)))
        }
        return 60
    })
    const historyContainerRef = React.useRef<HTMLDivElement>(null)
    const historyDraggingRef = React.useRef(false)

    const handleSplitMouseDown = React.useCallback(() => {
        historyDraggingRef.current = true
        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
    }, [])

    React.useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!historyDraggingRef.current || !historyContainerRef.current) return
            const rect = historyContainerRef.current.getBoundingClientRect()
            const pct = ((e.clientX - rect.left) / rect.width) * 100
            const clamped = Math.max(15, Math.min(85, pct))
            setHistorySplit(clamped)
            localStorage.setItem("doc_split_history", String(Math.round(clamped)))
        }
        const onUp = () => {
            if (historyDraggingRef.current) {
                historyDraggingRef.current = false
                document.body.style.cursor = ""
                document.body.style.userSelect = ""
            }
        }
        window.addEventListener("mousemove", onMove)
        window.addEventListener("mouseup", onUp)
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
    }, [])

    // Cache document name → id map for resolving citations with missing doc_id
    const [docNameMap, setDocNameMap] = React.useState<Record<string, string>>({})
    React.useEffect(() => {
        if (isResearch) {
            fetchDocuments().then(docs => {
                const map: Record<string, string> = {}
                docs.forEach(d => { map[d.name] = d.id })
                setDocNameMap(map)
            }).catch(() => {})
        }
    }, [isResearch])

    // Set initial pdfDocId for document conversations
    React.useEffect(() => {
        if (!isResearch && conv?.doc_id) {
            setPdfDocId(conv.doc_id)
        }
    }, [isResearch, conv])

    // For research conversations, auto-open PDF from first citation doc_id
    React.useEffect(() => {
        if (!isResearch || !conv || pdfDocId) return
        // Try to find the first doc_id from citations in messages
        for (const msg of conv.messages) {
            if (msg.citations) {
                for (const cite of msg.citations) {
                    const cDocId = (cite as any).doc_id as string | undefined
                    if (cDocId) { setPdfDocId(cDocId); return }
                }
            }
            if (msg.retrieved_sections) {
                for (const sec of msg.retrieved_sections as any[]) {
                    if (sec.doc_id) { setPdfDocId(sec.doc_id); return }
                }
            }
        }
        // Fallback: use first document from the docNameMap
        const firstDocId = Object.values(docNameMap)[0]
        if (firstDocId) setPdfDocId(firstDocId)
    }, [isResearch, conv, pdfDocId, docNameMap])

    const pdfUrl = pdfDocId
        ? `${API_BASE_URL}/documents/${pdfDocId}/raw`
        : null

    const handleCitationClick = React.useCallback((docId: string | undefined, pageNumber: number, docName?: string) => {
        let targetDocId = docId || (conv?.doc_id !== "research" ? conv?.doc_id : undefined)
        // Resolve empty docId from docName using cached document list
        if (!targetDocId && docName && Object.keys(docNameMap).length > 0) {
            targetDocId = docNameMap[docName] || undefined
            if (!targetDocId) {
                for (const [name, id] of Object.entries(docNameMap)) {
                    if (name.includes(docName) || docName.includes(name)) {
                        targetDocId = id
                        break
                    }
                }
            }
        }
        if (!targetDocId) return

        setPdfDocId(targetDocId)
        setPdfJumpPage(pageNumber - 1)
        setPdfJumpKey(k => k + 1)
    }, [conv, isResearch, docNameMap])

    return (
        <RoleRedirect>
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <div className="h-14 border-b border-border/40 flex items-center gap-4 px-6 shrink-0 bg-background/80 backdrop-blur-md">
                    <Link
                        href="/history"
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        History
                    </Link>
                    <span className="text-xs text-muted-foreground/30">/</span>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        {isResearch
                            ? <Library className="h-4 w-4 text-primary shrink-0" />
                            : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        }
                        <h1 className="text-xs font-semibold truncate">
                            {conv?.title || conv?.doc_name || "Conversation"}
                        </h1>
                        {conv && (
                            <span className="text-xs text-muted-foreground/40 shrink-0">
                                {conv.message_count} messages
                            </span>
                        )}
                    </div>
                    {conv?.doc_name && (
                        <span className="text-xs text-muted-foreground/50 shrink-0 hidden sm:block">
                            {conv.doc_name}
                        </span>
                    )}
                    {conv && (() => {
                        const isRes = conv.type === "research"
                        const continueHref = isRes
                            ? `/research?continue=${conv.conv_id}`
                            : `/documents/${conv.doc_id}?tab=chat&continue=${conv.conv_id}`
                        return (
                            <Link
                                href={continueHref}
                                className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-2.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors font-medium shrink-0 ml-auto"
                            >
                                <MessageSquare className="h-3 w-3" />
                                Continue Conversation
                            </Link>
                        )
                    })()}
                </div>

                {/* Split pane body */}
                <div ref={historyContainerRef} className="flex-1 flex min-h-0">

                    {/* Left: Chat */}
                    <div className={cn(
                        "flex flex-col min-h-0 overflow-y-auto shrink-0",
                        pdfUrl ? "border-r border-border/40" : "flex-1"
                    )} style={pdfUrl ? { width: `${historySplit}%` } : undefined}>
                        <div className="space-y-8 px-5 py-8 max-w-2xl mx-auto w-full">
                            {loading && (
                                <div className="flex items-center justify-center py-20 text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                    <span className="text-xs">Loading conversation...</span>
                                </div>
                            )}

                            {error && (
                                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 rounded-lg px-4 py-3">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    {error}
                                </div>
                            )}

                            {!loading && conv && conv.messages.length === 0 && (
                                <div className="text-center py-20 text-muted-foreground/40 text-xs">
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

                    {/* Drag Handle */}
                    {pdfUrl && (
                        <div
                            onMouseDown={handleSplitMouseDown}
                            className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors relative group"
                        >
                            <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
                        </div>
                    )}

                    {/* Right: PDF viewer */}
                    {pdfUrl && (
                        <div className="flex-1 min-h-0 overflow-hidden">
                            <PdfViewer
                                fileUrl={pdfUrl}
                                jumpToPage={pdfJumpPage}
                                jumpKey={pdfJumpKey}
                                className="h-full w-full"
                            />
                        </div>
                    )}

                </div>
            </main>
        </div>
        </RoleRedirect>
    )
}
