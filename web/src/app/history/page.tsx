"use client"

import * as React from "react"
import {
    MessageSquare, BookOpen, Trash2, Download, Database,
    Loader2, AlertTriangle, Clock, FileText, Library, History,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sidebar } from "@/components/layout/sidebar"
import { RoleRedirect } from "@/components/auth/role-redirect"
import {
    fetchConversations,
    deleteConversation,
    deleteAllConversations,
    fetchStorageStats,
    exportTrainingData,
} from "@/lib/api"
import { ConversationMeta, StorageStats } from "@/lib/types"
import Link from "next/link"

// --- Storage bar ---

function StorageBar({ stats }: { stats: StorageStats | null }) {
    if (!stats) return null
    const pct = stats.usage_percent
    const barColor = pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-primary"

    return (
        <div className="bg-muted/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    Storage Usage
                </div>
                <span className="text-sm font-mono text-muted-foreground">
                    {stats.total_mb.toFixed(1)} / {stats.limit_mb} MB
                </span>
            </div>
            <div className="w-full h-2.5 bg-muted/50 rounded-full overflow-hidden">
                <div
                    className={cn("h-full rounded-full transition-all", barColor)}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
                <span>{pct.toFixed(1)}% used</span>
                <div className="flex gap-3">
                    {Object.entries(stats.collections).map(([name, col]) => (
                        col.size_mb > 0.01 && (
                            <span key={name}>
                                {name}: {col.size_mb.toFixed(1)}MB ({col.docs})
                            </span>
                        )
                    ))}
                </div>
            </div>
        </div>
    )
}

// --- Conversation card ---

function ConversationCard({
    conv,
    onDelete,
}: {
    conv: ConversationMeta
    onDelete: (convId: string) => void
}) {
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const isResearch = conv.type === "research"

    const href = `/history/${conv.conv_id}`
    const docHref = isResearch ? "/research" : `/documents/${conv.doc_id}`
    const continueHref = isResearch
        ? `/research?continue=${conv.conv_id}`
        : `/documents/${conv.doc_id}?tab=chat&continue=${conv.conv_id}`
    const updatedDate = conv.updated_at ? new Date(conv.updated_at) : null

    return (
        <div className="group flex items-start gap-3 px-4 py-3 rounded-md border border-border bg-card hover:bg-accent/40 transition-colors">
            {/* Icon */}
            <div className="mt-0.5 flex-shrink-0">
                {isResearch
                    ? <Library className="h-4 w-4 text-foreground" />
                    : <FileText className="h-4 w-4 text-muted-foreground" />
                }
            </div>

            {/* Body */}
            <Link href={href} className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-[13px] font-medium text-foreground truncate">
                        {conv.title || conv.doc_name || conv.doc_id}
                    </h3>
                    <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
                        isResearch
                            ? "bg-muted text-foreground"
                            : "bg-muted text-muted-foreground"
                    )}>
                        {isResearch ? "Research" : "Doc"}
                    </span>
                </div>

                {conv.last_message_preview && (
                    <p className="text-[12px] text-muted-foreground truncate mb-1.5">
                        {conv.last_message_preview
                            .replace(/#{1,6}\s+/g, '')
                            .replace(/\*\*(.+?)\*\*/g, '$1')
                            .replace(/\*(.+?)\*/g, '$1')
                            .replace(/`(.+?)`/g, '$1')
                            .replace(/\[(.+?)\]\(.+?\)/g, '$1')
                            .replace(/^[-*+]\s+/gm, '')
                            .replace(/\n+/g, ' ')
                            .trim()}
                    </p>
                )}

                <div className="flex items-center gap-3 text-[11px] text-muted-foreground/50">
                    <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {conv.message_count}
                    </span>
                    {updatedDate && (
                        <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {`${String(updatedDate.getDate()).padStart(2, "0")} ${updatedDate.toLocaleDateString("en-US", { month: "short" })} ${updatedDate.getFullYear()}`} {updatedDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                        </span>
                    )}
                </div>
            </Link>

            {/* Actions */}
            <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link
                    href={continueHref}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] text-primary hover:text-primary/80 px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 transition-colors font-medium"
                    title="Continue this conversation"
                >
                    Continue →
                </Link>
                {confirmDelete ? (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => { onDelete(conv.conv_id); setConfirmDelete(false) }}
                            className="text-[11px] text-destructive hover:text-destructive px-2 py-1 rounded bg-destructive/10"
                        >
                            Delete
                        </button>
                        <button
                            onClick={() => setConfirmDelete(false)}
                            className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="text-muted-foreground/40 hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors"
                        title="Delete conversation"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        </div>
    )
}

// --- Main page ---

export default function HistoryPage() {
    const [conversations, setConversations] = React.useState<ConversationMeta[]>([])
    const [stats, setStats] = React.useState<StorageStats | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [exporting, setExporting] = React.useState(false)
    const [confirmClearAll, setConfirmClearAll] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    const loadData = React.useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const [convs, storageStats] = await Promise.all([
                fetchConversations(),
                fetchStorageStats(),
            ])
            setConversations(convs)
            setStats(storageStats)
        } catch {
            setError("Failed to load data")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        loadData()
    }, [loadData])

    const handleDelete = async (convId: string) => {
        try {
            await deleteConversation(convId)
            setConversations(prev => prev.filter(c => c.conv_id !== convId))
            // Refresh stats
            fetchStorageStats().then(setStats).catch(() => {})
        } catch {
            setError("Failed to delete conversation")
        }
    }

    const handleClearAll = async () => {
        try {
            await deleteAllConversations()
            setConversations([])
            setConfirmClearAll(false)
            fetchStorageStats().then(setStats).catch(() => {})
        } catch {
            setError("Failed to clear conversations")
        }
    }

    const handleExport = async () => {
        try {
            setExporting(true)
            await exportTrainingData()
        } catch {
            setError("Failed to export training data")
        } finally {
            setExporting(false)
        }
    }

    return (
        <RoleRedirect>
        <div className="flex h-screen bg-background">
            <Sidebar />

            <main className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="h-11 border-b border-border flex items-center justify-between px-6 shrink-0 bg-background">
                    <div className="flex items-center gap-3">
                        <h1 className="text-sm font-semibold flex items-center gap-2">
                            <History className="h-4 w-4 text-primary" />
                            Chat History
                        </h1>
                        <span className="text-[11px] text-muted-foreground/50 font-medium">
                            {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExport}
                            disabled={exporting}
                            className="gap-2 text-xs"
                        >
                            {exporting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            Export Training Data
                        </Button>

                        {conversations.length > 0 && (
                            confirmClearAll ? (
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={handleClearAll}
                                        className="gap-1 text-xs"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Confirm Delete All
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setConfirmClearAll(false)}
                                        className="text-xs"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmClearAll(true)}
                                    className="gap-1 text-xs text-muted-foreground hover:text-red-400"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Clear All
                                </Button>
                            )
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-5">
                        {/* Storage stats */}
                        <StorageBar stats={stats} />

                        {/* Error */}
                        {error && (
                            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 rounded-lg px-4 py-3">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        {/* Loading */}
                        {loading && (
                            <div className="flex items-center justify-center py-20 text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                <span className="text-sm">Loading conversations...</span>
                            </div>
                        )}

                        {/* Empty state */}
                        {!loading && conversations.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
                                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
                                    <MessageSquare className="h-8 w-8 text-foreground" />
                                </div>
                                <h3 className="font-semibold mb-2">No conversations yet</h3>
                                <p className="text-sm text-balance max-w-md">
                                    Start chatting with a document or use the Research page. Your conversations
                                    will appear here automatically.
                                </p>
                            </div>
                        )}

                        {/* Conversation list */}
                        {!loading && conversations.length > 0 && (
                            <div className="space-y-3">
                                {conversations.map(conv => (
                                    <ConversationCard
                                        key={conv.conv_id}
                                        conv={conv}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
        </RoleRedirect>
    )
}
