"use client"

import * as React from "react"
import {
    X, FileText, Hash, BookOpen, Link2, Table2, Tag, ChevronRight, ChevronDown, Maximize2
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { TreeNode } from "@/lib/types"
import { Markdown } from "@/components/ui/markdown"

interface NodeDetailPanelProps {
    node: TreeNode
    onClose: () => void
}

export function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
    const [summaryOpen, setSummaryOpen] = React.useState(false)

    return (
        <>
            <div className="flex flex-col h-full border-t border-border/40 bg-sidebar/80 overflow-hidden">
                {/* Header — fixed at top, does not scroll */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0 bg-sidebar/80">
                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold truncate text-sidebar-foreground" title={node.title}>
                            {node.title || `Untitled ${node.node_type}`}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono text-muted-foreground/60">{node.node_id}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary capitalize">{node.node_type}</span>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Content — scrollable, header stays fixed above */}
                <div className="flex-1 overflow-y-auto">
                    <div className="p-4 space-y-4">
                        {/* 1. Description FIRST */}
                        {node.description && (
                            <DetailSection title="Description" icon={<FileText className="h-3.5 w-3.5" />}>
                                <Markdown content={node.description} className="text-sm text-muted-foreground" />
                            </DetailSection>
                        )}

                        {/* 2. Summary SECOND — clickable to expand in dialog */}
                        {node.summary && (
                            <DetailSection title="Summary" icon={<BookOpen className="h-3.5 w-3.5" />}>
                                <button
                                    onClick={() => setSummaryOpen(true)}
                                    className="w-full text-left group cursor-pointer"
                                >
                                    <div className="line-clamp-4 group-hover:text-foreground transition-colors">
                                        <Markdown content={node.summary} className="text-sm text-muted-foreground" />
                                    </div>
                                    <span className="inline-flex items-center gap-1 text-xs text-primary/70 mt-1 group-hover:text-primary transition-colors">
                                        <Maximize2 className="h-3 w-3" />
                                        Click to read full summary
                                    </span>
                                </button>
                            </DetailSection>
                        )}

                        {/* 3. Topics — collapsible */}
                        {node.topics && node.topics.length > 0 && (
                            <CollapsibleSection title={`Topics (${node.topics.length})`} icon={<Tag className="h-3.5 w-3.5" />}>
                                <div className="flex flex-wrap gap-1.5">
                                    {node.topics.map((topic, i) => (
                                        <span key={i} className="px-2 py-0.5 text-xs rounded-md bg-primary/10 text-primary">
                                            {topic}
                                        </span>
                                    ))}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* 4. Children */}
                        {node.children && node.children.length > 0 && (
                            <CollapsibleSection title={`Children (${node.children.length})`} icon={<Hash className="h-3.5 w-3.5" />}>
                                <div className="space-y-1">
                                    {node.children.map((child) => (
                                        <div key={child.node_id} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                                            <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                                            <span className="truncate">{child.title}</span>
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* 5. Tables */}
                        {node.tables && node.tables.length > 0 && (
                            <CollapsibleSection title={`Tables (${node.tables.length})`} icon={<Table2 className="h-3.5 w-3.5" />}>
                                <div className="space-y-2">
                                    {node.tables.map((table) => (
                                        <div key={table.table_id} className="border border-border/20 rounded-md p-2">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-medium text-foreground/80">{table.caption || table.table_id}</span>
                                                <span className="text-[10px] text-muted-foreground/50">{table.num_rows}&times;{table.num_cols}</span>
                                            </div>
                                            {table.markdown && (
                                                <pre className="text-xs text-muted-foreground/70 whitespace-pre-wrap font-mono overflow-x-auto max-h-40 overflow-y-auto">
                                                    {table.markdown}
                                                </pre>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* 6. Cross-references — collapsible */}
                        {node.cross_references && node.cross_references.length > 0 && (
                            <CollapsibleSection title={`Cross-References (${node.cross_references.length})`} icon={<Link2 className="h-3.5 w-3.5" />}>
                                <div className="space-y-1">
                                    {node.cross_references.map((cr, i) => (
                                        <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                                            <span className={cn("h-1.5 w-1.5 rounded-full", cr.resolved ? "bg-green-400" : "bg-red-400")} />
                                            <span className="truncate">{cr.target_identifier}</span>
                                            {cr.target_node_id && (
                                                <span className="font-mono text-[10px] text-muted-foreground/50">&rarr; {cr.target_node_id}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* 7. Full text (truncated) — collapsible */}
                        {node.text && (
                            <CollapsibleSection title="Full Text" icon={<FileText className="h-3.5 w-3.5" />}>
                                <pre className="text-xs text-muted-foreground/70 whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-y-auto">
                                    {node.text.length > 5000 ? node.text.slice(0, 5000) + "\n\n... [truncated]" : node.text}
                                </pre>
                            </CollapsibleSection>
                        )}
                    </div>
                </div>
            </div>

            {/* Summary Dialog */}
            {summaryOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setSummaryOpen(false)}
                >
                    <div
                        className="bg-background border border-border rounded-xl shadow-2xl max-w-2xl w-[90vw] max-h-[80vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Dialog Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
                            <div className="min-w-0 flex-1">
                                <h2 className="font-semibold text-foreground truncate">
                                    {node.title}
                                </h2>
                                <p className="text-xs text-muted-foreground mt-0.5">Summary</p>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSummaryOpen(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Dialog Content */}
                        <div className="flex-1 overflow-y-auto px-6 py-5">
                            <Markdown content={node.summary} className="text-sm text-foreground/90 [&_p]:leading-7" />
                        </div>

                        {/* Dialog Footer */}
                        <div className="px-6 py-3 border-t border-border/40 flex justify-end">
                            <Button variant="outline" size="sm" onClick={() => setSummaryOpen(false)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

function DetailSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div>
            <div className="flex items-center gap-1.5 mb-2">
                <span className="text-muted-foreground/50">{icon}</span>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{title}</h4>
            </div>
            {children}
        </div>
    )
}

function CollapsibleSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    const [open, setOpen] = React.useState(false)
    return (
        <div>
            <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 w-full text-left group">
                {open ? <ChevronDown className="h-3 w-3 text-muted-foreground/50" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                <span className="text-muted-foreground/50">{icon}</span>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">{title}</h4>
            </button>
            {open && <div className="mt-2 ml-5">{children}</div>}
        </div>
    )
}
