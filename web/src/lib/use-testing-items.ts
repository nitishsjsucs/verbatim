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
    submitTesterVerdict,
    addTestingComment,
    pullActionablesToTesting,
} from "./testing-api"

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
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Assignment failed")
            throw err
        }
    }, [])

    const handleForwardToMaker = React.useCallback(async (
        itemId: string, makerId: string, makerName: string, forwardedBy: string
    ) => {
        try {
            const updated = await forwardToMaker(itemId, {
                maker_id: makerId, maker_name: makerName, forwarded_by: forwardedBy,
            })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success(`Forwarded to maker ${makerName}`)
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Forward failed")
            throw err
        }
    }, [])

    const handleMakerDecision = React.useCallback(async (
        itemId: string, decision: "open" | "close", actor: string, makerDeadline?: string
    ) => {
        try {
            const updated = await submitMakerDecision(itemId, {
                decision, maker_deadline: makerDeadline, actor,
            })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success(`Item marked as ${decision.toUpperCase()}`)
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Decision failed")
            throw err
        }
    }, [])

    const handleCheckerConfirm = React.useCallback(async (itemId: string, checkerName: string) => {
        try {
            const updated = await checkerConfirmDeadline(itemId, { checker_name: checkerName })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success("Deadline confirmed — item is now active")
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Confirmation failed")
            throw err
        }
    }, [])

    const handleTesterVerdict = React.useCallback(async (
        itemId: string, verdict: "pass" | "reject", testerName: string, reason?: string
    ) => {
        try {
            const updated = await submitTesterVerdict(itemId, {
                verdict, reason, tester_name: testerName,
            })
            setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
            toast.success(verdict === "pass" ? "Item PASSED" : "Item REJECTED — sent back to maker")
            return updated
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Verdict failed")
            throw err
        }
    }, [])

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

    const handlePullActionables = React.useCallback(async (actionableIds?: string[]) => {
        try {
            const result = await pullActionablesToTesting(actionableIds)
            if (result.pulled > 0) {
                setItems(prev => [...prev, ...result.items])
                toast.success(`Pulled ${result.pulled} actionable(s) into testing`)
            } else {
                toast.info("No new actionables to pull")
            }
            return result
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Pull failed")
            throw err
        }
    }, [])

    return {
        items, setItems, loading, load,
        handleUpdate, handleAssign, handleForwardToMaker,
        handleMakerDecision, handleCheckerConfirm, handleTesterVerdict,
        handleAddComment, handlePullActionables,
    }
}
