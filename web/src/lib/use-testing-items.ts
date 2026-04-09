import * as React from "react"
import { toast } from "sonner"
import type { TestingItem } from "./types"
import {
    fetchTestingItems,
    updateTestingItem,
    assignTestingItem,
    forwardToMaker,
    submitMakerDecision,
    checkerConfirmDeadline,
    checkerRejectDeadline,
    submitTesterVerdict,
    addTestingComment,
} from "./testing-api"
import {
    notifyTestingAssigned,
    notifyTestingForwardedToMaker,
    notifyTestingMakerOpen,
    notifyTestingMakerClosed,
    notifyTestingCheckerConfirmed,
    notifyTestingCheckerRejected,
    notifyTestingPassed,
    notifyTestingRejected,
} from "./notifications-helper"

interface UseTestingItemsOptions {
    section?: string
    status?: string
    autoLoad?: boolean
}

export function useTestingItems(opts: UseTestingItemsOptions = {}) {
    const { section, status, autoLoad = true } = opts
    const [items, setItems] = React.useState<TestingItem[]>([])
    const [loading, setLoading] = React.useState(false)

    const load = React.useCallback(async () => {
        try {
            setLoading(true)
            const result = await fetchTestingItems(section, status)
            setItems(result.items)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to load testing items")
        } finally {
            setLoading(false)
        }
    }, [section, status])

    React.useEffect(() => {
        if (autoLoad) load()
    }, [load, autoLoad])

    const handleUpdate = React.useCallback(async (itemId: string, updates: Record<string, unknown>) => {
        try {
            const updated = await updateTestingItem(itemId, updates)
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Update failed")
            throw err
        }
    }, [])

    const handleAssign = React.useCallback(async (
        itemId: string, testerId: string, testerName: string, deadline: string, assignedBy: string
    ) => {
        try {
            const updated = await assignTestingItem(itemId, {
                tester_id: testerId, tester_name: testerName,
                testing_deadline: deadline, assigned_by: assignedBy,
            })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success(`Assigned to ${testerName}`)
            const item = items.find(i => i.id === itemId)
            notifyTestingAssigned(item?.source_actionable_text || itemId, testerId, deadline).catch(() => {})
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Assignment failed")
            throw err
        }
    }, [items])

    const handleForwardToMaker = React.useCallback(async (
        itemId: string, makerId: string, makerName: string, forwardedBy: string
    ) => {
        try {
            const updated = await forwardToMaker(itemId, {
                maker_id: makerId, maker_name: makerName, forwarded_by: forwardedBy,
            })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success(`Forwarded to maker ${makerName}`)
            const item = items.find(i => i.id === itemId)
            notifyTestingForwardedToMaker(item?.source_actionable_text || itemId, makerId, forwardedBy).catch(() => {})
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Forward failed")
            throw err
        }
    }, [items])

    const handleMakerDecision = React.useCallback(async (
        itemId: string, decision: "open" | "close", actor: string, makerDeadline?: string
    ) => {
        try {
            const updated = await submitMakerDecision(itemId, {
                decision, maker_deadline: makerDeadline, actor,
            })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success(`Item marked as ${decision.toUpperCase()}`)
            const item = items.find(i => i.id === itemId)
            const title = item?.source_actionable_text || itemId
            if (decision === "open") {
                notifyTestingMakerOpen(title, actor).catch(() => {})
            } else {
                notifyTestingMakerClosed(title, item?.assigned_tester_id || "", actor).catch(() => {})
            }
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Decision failed")
            throw err
        }
    }, [items])

    const handleCheckerConfirm = React.useCallback(async (itemId: string, checkerName: string) => {
        try {
            const updated = await checkerConfirmDeadline(itemId, { checker_name: checkerName })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success("Deadline confirmed — item is now active")
            const item = items.find(i => i.id === itemId)
            notifyTestingCheckerConfirmed(
                item?.source_actionable_text || itemId,
                item?.assigned_tester_id || "",
                item?.assigned_maker_id || "",
                checkerName
            ).catch(() => {})
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Confirmation failed")
            throw err
        }
    }, [items])

    const handleCheckerReject = React.useCallback(async (itemId: string, checkerName: string, reason?: string) => {
        try {
            const updated = await checkerRejectDeadline(itemId, { checker_name: checkerName, reason })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success("Deadline rejected — item sent back to maker")
            const item = items.find(i => i.id === itemId)
            notifyTestingCheckerRejected(
                item?.source_actionable_text || itemId,
                item?.assigned_maker_id || "",
                checkerName,
                reason || "No reason provided"
            ).catch(() => {})
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Rejection failed")
            throw err
        }
    }, [items])

    const handleTesterVerdict = React.useCallback(async (
        itemId: string, verdict: "pass" | "reject", testerName: string, reason?: string
    ) => {
        try {
            const updated = await submitTesterVerdict(itemId, {
                verdict, reason, tester_name: testerName,
            })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success(verdict === "pass" ? "Item PASSED" : "Item REJECTED — sent back to maker")
            const item = items.find(i => i.id === itemId)
            const title = item?.source_actionable_text || itemId
            if (verdict === "pass") {
                notifyTestingPassed(title, testerName, item?.assigned_maker_id || "").catch(() => {})
            } else {
                notifyTestingRejected(title, item?.assigned_maker_id || "", testerName, reason || "No reason provided").catch(() => {})
            }
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Verdict failed")
            throw err
        }
    }, [items])

    const handleAddComment = React.useCallback(async (
        itemId: string, author: string, role: string, text: string
    ) => {
        try {
            const result = await addTestingComment(itemId, { author, role, text })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...result.item } : i))
            return result.comment
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Comment failed")
            throw err
        }
    }, [])

    return {
        items, setItems, loading, load,
        handleUpdate, handleAssign, handleForwardToMaker,
        handleMakerDecision, handleCheckerConfirm, handleCheckerReject, handleTesterVerdict,
        handleAddComment,
    }
}
