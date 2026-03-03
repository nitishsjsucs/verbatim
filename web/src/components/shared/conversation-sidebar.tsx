"use client"

/**
 * Shared conversation sidebar used by both ChatInterface (document Q&A)
 * and ResearchChat (corpus-wide research). The only per-consumer difference
 * is the header title, empty-state copy, and fallback conversation name.
 */

import * as React from "react"
import {
    Plus, MessageSquare, Trash2, PanelLeftClose, PanelLeftOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ConversationMeta } from "@/lib/types"

interface ConversationSidebarProps {
    title: string
    emptyText?: string
    fallbackName?: string
    conversations: ConversationMeta[]
    activeConvId: string | null
    onSelect: (convId: string) => void
    onNew: () => void
    onDelete: (convId: string) => void
    collapsed: boolean
    onToggle: () => void
}

export function ConversationSidebar({
    title,
    emptyText = "No conversations yet",
    fallbackName = "New conversation",
    conversations,
    activeConvId,
    onSelect,
    onNew,
    onDelete,
    collapsed,
    onToggle,
}: ConversationSidebarProps) {
    const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)

    if (collapsed) {
        return (
            <div className="w-10 border-r border-border flex flex-col items-center shrink-0">
                <div className="h-11 flex items-center justify-center w-full border-b border-border">
                    <button
                        onClick={onToggle}
                        className="p-1.5 text-xs text-muted-foreground/60 hover:text-foreground rounded-md hover:bg-muted/30 transition-colors"
                        title="Show conversations"
                    >
                        <PanelLeftOpen className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex flex-col items-center gap-2 py-2">
                    <button
                        onClick={onNew}
                        className="p-1.5 text-xs text-muted-foreground/60 hover:text-primary rounded-md hover:bg-primary/10 transition-colors"
                        title="New chat"
                    >
                        <Plus className="h-4 w-4" />
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="w-56 border-r border-border flex flex-col shrink-0 bg-sidebar">
            {/* Header */}
            <div className="h-11 border-b border-border flex items-center px-3 justify-between shrink-0">
                <span className="text-xs font-medium text-foreground">{title}</span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={onNew}
                        className="p-1 text-xs text-muted-foreground/60 hover:text-primary rounded-md hover:bg-primary/10 transition-colors"
                        title="New chat"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={onToggle}
                        className="p-1 text-xs text-muted-foreground/60 hover:text-foreground rounded-md hover:bg-muted/30 transition-colors"
                        title="Hide conversations"
                    >
                        <PanelLeftClose className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-1">
                {conversations.length === 0 && (
                    <div className="px-3 py-8 text-center">
                        <MessageSquare className="h-5 w-5 mx-auto text-xs text-muted-foreground/30 mb-2" />
                        <p className="text-xs text-muted-foreground/40">{emptyText}</p>
                    </div>
                )}
                {conversations.map((conv) => (
                    <div
                        key={conv.conv_id}
                        className={cn(
                            "group px-2 py-1.5 mx-1 rounded-md cursor-pointer transition-colors flex items-start gap-2",
                            conv.conv_id === activeConvId
                                ? "bg-primary/10 text-foreground"
                                : "text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                        )}
                        onClick={() => onSelect(conv.conv_id)}
                    >
                        <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">
                                {conv.title || conv.last_message_preview || fallbackName}
                            </p>
                            <p className="text-xs text-muted-foreground/50 mt-0.5">
                                {conv.message_count} msgs
                            </p>
                        </div>
                        {/* Delete button */}
                        {confirmDeleteId === conv.conv_id ? (
                            <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={() => { onDelete(conv.conv_id); setConfirmDeleteId(null) }}
                                    className="text-xs text-red-400 hover:text-red-300 px-1 py-0.5 rounded bg-red-400/10"
                                >
                                    Del
                                </button>
                                <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="text-xs text-muted-foreground px-1 py-0.5"
                                >
                                    No
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(conv.conv_id) }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-xs text-muted-foreground/30 hover:text-red-400 shrink-0"
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
