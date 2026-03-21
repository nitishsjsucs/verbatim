"use client"

import * as React from "react"
import { fetchAllActionables, fetchActionablesPaginated, updateActionable } from "./api"
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
    /** Use pagination (default false for backward compat). */
    usePagination?: boolean
    /** Items per page when using pagination (default 50). */
    pageSize?: number
    /** Filter by team (optional, for paginated mode). */
    filterTeam?: string
    /** Filter by status (optional, for paginated mode). */
    filterStatus?: string
}

/**
 * Shared hook encapsulating the fetch → state → update → comment cycle
 * used by dashboard, actionables, team-review, team-lead, and reports pages.
 *
 * Returns doc-level state (`allDocs`) plus convenience handlers.
 * Supports both legacy (non-paginated) and paginated modes.
 */
export function useActionables(opts: UseActionablesOptions = {}) {
    const { 
        forTeam, 
        commentRole = "team_member", 
        commentAuthor = "", 
        autoLoad = true,
        usePagination = false,
        pageSize = 50,
        filterTeam = "",
        filterStatus = "",
    } = opts

    const [allDocs, setAllDocs] = React.useState<DocActionables[]>([])
    const [allItems, setAllItems] = React.useState<ActionableItem[]>([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    
    // Pagination state
    const [currentPage, setCurrentPage] = React.useState(1)
    const [totalPages, setTotalPages] = React.useState(0)
    const [totalItems, setTotalItems] = React.useState(0)
    const [hasMore, setHasMore] = React.useState(false)

    // ── Load (legacy mode) ────────────────────────────────────────────────────

    const load = React.useCallback(async () => {
        if (usePagination) {
            // Use paginated version
            return loadPage(1)
        }
        
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
    }, [usePagination])

    // ── Load page (paginated mode) ─────────────────────────────────────────

    const loadPage = React.useCallback(async (page: number) => {
        try {
            setLoading(true)
            setError(null)
            const result = await fetchActionablesPaginated(
                page,
                pageSize,
                filterTeam || undefined,
                filterStatus || undefined,
            )
            setCurrentPage(page)
            setTotalPages(result.pages)
            setTotalItems(result.total)
            setHasMore(page < result.pages)
            setAllItems(result.actionables)
        } catch {
            const msg = "Failed to load actionables page"
            setError(msg)
            toast.error(msg)
        } finally {
            setLoading(false)
        }
    }, [pageSize, filterTeam, filterStatus])

    // ── Load more (append to current items) ────────────────────────────────

    const loadMore = React.useCallback(async () => {
        if (!hasMore || loading) return
        const nextPage = currentPage + 1
        try {
            setLoading(true)
            const result = await fetchActionablesPaginated(
                nextPage,
                pageSize,
                filterTeam || undefined,
                filterStatus || undefined,
            )
            setCurrentPage(nextPage)
            setTotalPages(result.pages)
            setTotalItems(result.total)
            setHasMore(nextPage < result.pages)
            setAllItems(prev => [...prev, ...result.actionables])
        } catch {
            const msg = "Failed to load more actionables"
            setError(msg)
            toast.error(msg)
        } finally {
            setLoading(false)
        }
    }, [hasMore, currentPage, loading, pageSize, filterTeam, filterStatus])

    React.useEffect(() => {
        if (autoLoad) load()
    }, [autoLoad, load])

    // ── Update a single item ────────────────────────────────────────────────

    const handleUpdate = React.useCallback(
        async (docId: string, itemId: string, updates: Record<string, unknown>, teamOverride?: string): Promise<void> => {
            try {
                const team = teamOverride ?? forTeam
                const updated = await updateActionable(docId, itemId, updates, team || undefined)
                
                if (usePagination) {
                    // Update in allItems
                    setAllItems(prev =>
                        prev.map(a =>
                            a.id === itemId ? { ...a, ...updated } : a,
                        ),
                    )
                } else {
                    // Update in allDocs
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
                }
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "Update failed")
                throw err
            }
        },
        [forTeam, usePagination],
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

    const flatItems = React.useMemo(
        () =>
            usePagination
                ? allItems.map(a => ({ item: a, docId: a.doc_id || "", docName: a.doc_name || "" }))
                : allDocs.flatMap(d =>
                    d.actionables.map(a => ({ item: a, docId: d.doc_id, docName: d.doc_name })),
                ),
        [allDocs, allItems, usePagination],
    )

    return {
        // Legacy mode
        allDocs,
        setAllDocs,
        allItems: flatItems,
        
        // Paginated mode
        paginatedItems: allItems,
        currentPage,
        totalPages,
        totalItems,
        hasMore,
        loadPage,
        loadMore,
        
        // Common
        loading,
        error,
        load,
        handleUpdate,
        handleAddComment,
    }
}
