"use client"

import * as React from "react"
import {
    ChevronDown, ChevronRight, FileText, ArrowRight,
    Link2, RefreshCw, Edit3, Layers, BookOpen, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchCorpus } from "@/lib/api"
import { Corpus, CorpusDocument, DocumentRelationship, RelationType } from "@/lib/types"
import { Markdown } from "@/components/ui/markdown"

const RELATION_LABELS: Record<RelationType, { label: string; color: string; icon: React.ReactNode }> = {
    references: { label: "References", color: "text-blue-400 bg-blue-400/10", icon: <Link2 className="h-3 w-3" /> },
    supersedes: { label: "Supersedes", color: "text-red-400 bg-red-400/10", icon: <RefreshCw className="h-3 w-3" /> },
    amends: { label: "Amends", color: "text-amber-400 bg-amber-400/10", icon: <Edit3 className="h-3 w-3" /> },
    supplements: { label: "Supplements", color: "text-green-400 bg-green-400/10", icon: <Layers className="h-3 w-3" /> },
    implements: { label: "Implements", color: "text-purple-400 bg-purple-400/10", icon: <BookOpen className="h-3 w-3" /> },
    related_to: { label: "Related To", color: "text-muted-foreground bg-muted", icon: <Link2 className="h-3 w-3" /> },
}

interface CorpusPanelProps {
    className?: string
    onDocumentClick?: (docId: string) => void
}

export function CorpusPanel({ className, onDocumentClick }: CorpusPanelProps) {
    const [corpus, setCorpus] = React.useState<Corpus | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [expandedDocs, setExpandedDocs] = React.useState<Set<string>>(new Set())

    React.useEffect(() => {
        loadCorpus()
    }, [])

    async function loadCorpus() {
        try {
            setLoading(true)
            setError(null)
            const data = await fetchCorpus()
            setCorpus(data)
        } catch {
            // Backend may not have corpus endpoints yet, or may be down
            setError("Could not load corpus. Restart the backend to enable cross-document features.")
            setCorpus({ corpus_id: "default", documents: [], relationships: [], last_updated: "" })
        } finally {
            setLoading(false)
        }
    }

    function toggleDoc(docId: string) {
        setExpandedDocs(prev => {
            const next = new Set(prev)
            if (next.has(docId)) next.delete(docId)
            else next.add(docId)
            return next
        })
    }

    function getRelationshipsForDoc(docId: string): DocumentRelationship[] {
        if (!corpus) return []
        return corpus.relationships.filter(
            r => r.source_doc_id === docId || r.target_doc_id === docId
        )
    }

    function getDocName(docId: string): string {
        if (!corpus) return docId
        const doc = corpus.documents.find(d => d.doc_id === docId)
        return doc?.doc_name || docId
    }

    if (loading) {
        return (
            <div className={cn("flex items-center justify-center h-full", className)}>
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!corpus || corpus.documents.length === 0) {
        return (
            <div className={cn("flex flex-col items-center justify-center h-full text-center p-4", className)}>
                <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                    <BookOpen className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No documents in corpus</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                    {error || "Ingest documents to build the corpus graph"}
                </p>
                {error && (
                    <button
                        onClick={loadCorpus}
                        className="mt-3 text-xs text-primary hover:underline"
                    >
                        Retry
                    </button>
                )}
            </div>
        )
    }

    return (
        <div className={cn("flex flex-col h-full", className)}>
            {/* Header */}
            <div className="h-10 border-b border-border/40 flex items-center px-4 shrink-0">
                <BookOpen className="h-3.5 w-3.5 text-muted-foreground mr-2" />
                <span className="text-xs font-medium text-muted-foreground">
                    Corpus: {corpus.documents.length} documents, {corpus.relationships.length} relationships
                </span>
            </div>

            {/* Document list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {corpus.documents.map(doc => {
                    const isExpanded = expandedDocs.has(doc.doc_id)
                    const rels = getRelationshipsForDoc(doc.doc_id)

                    return (
                        <div key={doc.doc_id} className="border border-border/30 rounded-lg overflow-hidden">
                            {/* Doc header */}
                            <button
                                onClick={() => toggleDoc(doc.doc_id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                            >
                                {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                                <span className="text-xs font-medium text-foreground/90 truncate flex-1">
                                    {doc.doc_name}
                                </span>
                                <span className="text-[10px] text-muted-foreground/50 shrink-0">
                                    {doc.total_pages}p / {doc.node_count}n
                                </span>
                                {rels.length > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full shrink-0">
                                        {rels.length}
                                    </span>
                                )}
                            </button>

                            {/* Expanded content */}
                            {isExpanded && (
                                <div className="px-3 pb-3 space-y-3 border-t border-border/20">
                                    {/* Description */}
                                    {doc.doc_description && (
                                        <div className="mt-2">
                                            <p className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">Description</p>
                                            <div className="text-xs text-muted-foreground/80 line-clamp-4">
                                                <Markdown content={doc.doc_description} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Topics */}
                                    {doc.top_topics.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">Topics</p>
                                            <div className="flex flex-wrap gap-1">
                                                {doc.top_topics.slice(0, 12).map((topic, i) => (
                                                    <span key={i} className="px-1.5 py-0.5 bg-muted/50 text-muted-foreground rounded text-[10px]">
                                                        {topic}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Relationships */}
                                    {rels.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Relationships</p>
                                            <div className="space-y-1.5">
                                                {rels.map((rel, i) => {
                                                    const isSource = rel.source_doc_id === doc.doc_id
                                                    const otherDocId = isSource ? rel.target_doc_id : rel.source_doc_id
                                                    const otherDocName = getDocName(otherDocId)
                                                    const relConfig = RELATION_LABELS[rel.relation_type] || RELATION_LABELS.related_to

                                                    return (
                                                        <div key={i} className="flex items-start gap-2 text-xs">
                                                            <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 mt-0.5", relConfig.color)}>
                                                                {relConfig.icon}
                                                                {relConfig.label}
                                                            </span>
                                                            <div className="flex items-center gap-1 min-w-0">
                                                                {isSource ? (
                                                                    <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                                                ) : (
                                                                    <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 rotate-180" />
                                                                )}
                                                                <button
                                                                    onClick={() => onDocumentClick?.(otherDocId)}
                                                                    className="text-foreground/70 hover:text-foreground truncate underline-offset-2 hover:underline transition-colors"
                                                                >
                                                                    {otherDocName}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Open document link */}
                                    <button
                                        onClick={() => onDocumentClick?.(doc.doc_id)}
                                        className="text-[11px] text-primary hover:text-primary/80 hover:underline transition-colors"
                                    >
                                        Open document →
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
