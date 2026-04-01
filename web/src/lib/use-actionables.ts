"use client"

import * as React from "react"
import { fetchAllActionables, updateActionable } from "./api"
import type { ActionableItem, ActionablesResult, ActionableComment } from "./types"
import { toast } from "sonner"

// ─── Shared doc-level shape used by most pages ─────────────────────────────

export interface DocActionables {
    doc_id: string
    doc_name: string
    actionables: ActionableItem[]
}

// ─── Options ────────────────────────────────────────────────────────────────

interface UseActionablesOptions {
    /** If provided, `handleUpdate` will pass this as `forTeam` to the API. */
    forTeam?: string
    /** Role string written into new comments (e.g. "compliance_officer"). */
    commentRole?: ActionableComment["role"]
    /** Display name written into new comments. */
    commentAuthor?: string
    /** If false, `load` is not called automatically on mount. Default: true. */
    autoLoad?: boolean
    /** Caller role passed to the backend so role-gated fields are not stripped. */
    callerRole?: string
}

/**
 * Shared hook encapsulating the fetch → state → update → comment cycle
 * used by dashboard, actionables, team-review, team-lead, and reports pages.
 *
 * Returns doc-level state (`allDocs`) plus convenience handlers.
 */
export function useActionables(opts: UseActionablesOptions = {}) {
    const { forTeam, commentRole = "team_member", commentAuthor = "", autoLoad = true, callerRole } = opts

    const [allDocs, setAllDocs] = React.useState<DocActionables[]>([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    // ── Load ────────────────────────────────────────────────────────────────

    const load = React.useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const results = await fetchAllActionables()
            const docs: DocActionables[] = results
                .filter((r: ActionablesResult) => r.actionables && r.actionables.length > 0)
                .map((r: ActionablesResult) => ({
                    doc_id: r.doc_id,
                    doc_name: r.doc_name || r.doc_id,
                    actionables: r.actionables,
                }))
            setAllDocs(docs)
        } catch {
            const msg = "Failed to load actionables"
            setError(msg)
            toast.error(msg)
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        if (autoLoad) load()
    }, [autoLoad, load])

    // ── Update a single item ────────────────────────────────────────────────

    const handleUpdate = React.useCallback(
        async (docId: string, itemId: string, updates: Record<string, unknown>, teamOverride?: string): Promise<void> => {
            try {
                const team = teamOverride ?? forTeam
                const updated = await updateActionable(docId, itemId, updates, team || undefined, callerRole || undefined)
                setAllDocs(prev =>
                    prev.map(d => {
                        if (d.doc_id !== docId) return d
                        return {
                            ...d,
                            actionables: d.actionables.map(a =>
                                a.id === itemId ? { ...a, ...updated } : a,
                            ),
                        }
                    }),
                )
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "Update failed")
                throw err
            }
        },
        [forTeam, callerRole],
    )

    // ── Add a comment ───────────────────────────────────────────────────────

    const handleAddComment = React.useCallback(
        async (docId: string, item: ActionableItem, text: string, teamOverride?: string) => {
            const newComment: ActionableComment = {
                id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                author: commentAuthor,
                role: commentRole,
                text,
                timestamp: new Date().toISOString(),
            }
            const existing = item.comments || []
            await handleUpdate(docId, item.id, { comments: [...existing, newComment] }, teamOverride)
        },
        [commentAuthor, commentRole, handleUpdate],
    )

    // ── Flat item list (convenience) ────────────────────────────────────────

    const allItems = React.useMemo(
        () =>
            allDocs.flatMap(d =>
                d.actionables.map(a => ({ item: a, docId: d.doc_id, docName: d.doc_name })),
            ),
        [allDocs],
    )

    return {
        allDocs,
        setAllDocs,
        allItems,
        loading,
        error,
        load,
        handleUpdate,
        handleAddComment,
    }
}
