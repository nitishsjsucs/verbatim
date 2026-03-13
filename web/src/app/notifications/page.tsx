"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { useSession } from "@/lib/auth-client"
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, clearAllNotifications, acceptDelegationRequest, rejectDelegationRequest, type Notification } from "@/lib/api"
import { Bell, CheckCheck, Loader2, ExternalLink, Check, X, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/status-config"
import Link from "next/link"
import { toast } from "sonner"

const NOTIF_TYPE_STYLES: Record<string, { bg: string; text: string }> = {
    delegation_request:  { bg: "bg-amber-500/15", text: "text-amber-400" },
    delegation_accepted: { bg: "bg-emerald-500/15", text: "text-emerald-400" },
    delegation_rejected: { bg: "bg-rose-500/15", text: "text-rose-400" },
    publish:             { bg: "bg-blue-500/15", text: "text-blue-400" },
    approval:            { bg: "bg-emerald-500/15", text: "text-emerald-400" },
    rejection:           { bg: "bg-rose-500/15", text: "text-rose-400" },
    rework:              { bg: "bg-orange-500/15", text: "text-orange-400" },
    info:                { bg: "bg-zinc-500/15", text: "text-zinc-400" },
}

export default function NotificationsPage() {
    const { data: session } = useSession()
    const userId = (session?.user as Record<string, unknown>)?.id as string | undefined
    const [notifications, setNotifications] = React.useState<Notification[]>([])
    const [loading, setLoading] = React.useState(true)
    const [processingId, setProcessingId] = React.useState<string | null>(null)

    const load = React.useCallback(async () => {
        if (!userId) return
        try {
            setLoading(true)
            const data = await fetchNotifications(userId, 100)
            setNotifications(data.notifications)
        } catch {
            // ignore
        } finally {
            setLoading(false)
        }
    }, [userId])

    React.useEffect(() => { load() }, [load])

    const handleMarkRead = async (id: string) => {
        await markNotificationRead(id)
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    }

    const handleMarkAllRead = async () => {
        if (!userId) return
        await markAllNotificationsRead(userId)
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    }

    const handleClearAll = async () => {
        if (!userId) return
        if (!confirm("Clear all notifications? This cannot be undone.")) return
        try {
            // Permanently delete all notifications for this user from the database
            await clearAllNotifications(userId)
            setNotifications([])
            toast.success("All notifications cleared")
        } catch (err) {
            toast.error("Failed to clear notifications")
        }
    }

    const handleApproveDelegation = async (notif: Notification) => {
        if (!notif.delegation_request_id) return
        setProcessingId(notif.id)
        try {
            // Accept delegation request (backend handles ownership transfer)
            await acceptDelegationRequest(notif.delegation_request_id)
            
            // Mark notification as read and remove from list
            await markNotificationRead(notif.id)
            setNotifications(prev => prev.filter(n => n.id !== notif.id))
            toast.success("Delegation approved — actionable transferred to you")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to approve delegation")
        } finally {
            setProcessingId(null)
        }
    }

    const handleRejectDelegation = async (notif: Notification) => {
        if (!notif.delegation_request_id) return
        setProcessingId(notif.id)
        try {
            // Reject delegation request
            await rejectDelegationRequest(notif.delegation_request_id)
            
            // Mark notification as read
            await markNotificationRead(notif.id)
            setNotifications(prev => prev.filter(n => n.id !== notif.id))
            toast.success("Delegation rejected — actionable remains with sender")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to reject delegation")
        } finally {
            setProcessingId(null)
        }
    }

    const unreadCount = notifications.filter(n => !n.is_read).length

    return (
        <div className="flex h-screen bg-background">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-border/40">
                    <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-muted-foreground" />
                        <h1 className="text-sm font-semibold">Notifications</h1>
                        {unreadCount > 0 && (
                            <span className="bg-red-500/15 text-red-400 text-xs px-1.5 py-0.5 rounded-full font-medium">
                                {unreadCount} unread
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {unreadCount > 0 && (
                            <button
                                onClick={handleMarkAllRead}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <CheckCheck className="h-3.5 w-3.5" />
                                Mark all read
                            </button>
                        )}
                        {notifications.length > 0 && (
                            <button
                                onClick={handleClearAll}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-colors"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                Clear all
                            </button>
                        )}
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                            <Bell className="h-8 w-8 mb-2 opacity-30" />
                            <p className="text-xs">No notifications yet</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/30">
                            {notifications.map(n => {
                                const style = NOTIF_TYPE_STYLES[n.type] || NOTIF_TYPE_STYLES.info
                                const isDelegationRequest = n.type === "delegation_request"
                                return (
                                    <div
                                        key={n.id}
                                        className={cn(
                                            "px-6 py-3 flex items-start gap-3 transition-colors",
                                            !isDelegationRequest && "cursor-pointer hover:bg-muted/30",
                                            !n.is_read && "bg-muted/20"
                                        )}
                                        onClick={() => !n.is_read && !isDelegationRequest && handleMarkRead(n.id)}
                                    >
                                        <div className={cn("mt-0.5 h-2 w-2 rounded-full flex-shrink-0", n.is_read ? "bg-transparent" : "bg-blue-500")} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", style.bg, style.text)}>
                                                    {n.type.replace(/_/g, " ")}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
                                            </div>
                                            <p className="text-xs text-foreground">{n.message}</p>
                                            {isDelegationRequest ? (
                                                <div className="flex items-center gap-2 mt-2">
                                                    <button
                                                        onClick={() => handleApproveDelegation(n)}
                                                        disabled={processingId === n.id}
                                                        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors font-medium"
                                                    >
                                                        {processingId === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                                        Approve
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectDelegation(n)}
                                                        disabled={processingId === n.id}
                                                        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 disabled:opacity-50 transition-colors font-medium"
                                                    >
                                                        {processingId === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                                        Decline
                                                    </button>
                                                </div>
                                            ) : (
                                                n.actionable_id && (
                                                    <Link
                                                        href="/dashboard"
                                                        className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:underline mt-1"
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                        View in Tracker
                                                    </Link>
                                                )
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
