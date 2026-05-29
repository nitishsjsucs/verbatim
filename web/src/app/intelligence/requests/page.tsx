"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    Archive,
    FileText,
    Users,
    Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isIntelAuthenticated, isIntelAdmin } from "@/lib/intel-auth";
import {
    listAllRequests,
    resolveRequest,
    type ClientRequestItem,
} from "@/lib/intel-tenant-api";

export default function RequestsManagementPage() {
    const router = useRouter();
    const [requests, setRequests] = React.useState<ClientRequestItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [filter, setFilter] = React.useState<"all" | "pending" | "approved" | "rejected">("pending");

    React.useEffect(() => {
        if (!isIntelAuthenticated() || !isIntelAdmin()) {
            router.replace("/intelligence/login");
        }
    }, [router]);

    const refresh = React.useCallback(async () => {
        try {
            const status = filter === "all" ? undefined : filter;
            const data = await listAllRequests(status);
            setRequests(data);
        } catch {
            toast.error("Failed to load requests");
        } finally {
            setLoading(false);
        }
    }, [filter]);

    React.useEffect(() => { refresh(); }, [refresh]);

    const handleResolve = async (id: string, status: "approved" | "rejected" | "archived") => {
        try {
            await resolveRequest(id, status);
            toast.success(`Request ${status}`);
            refresh();
        } catch {
            toast.error("Action failed");
        }
    };

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Inbox className="h-4 w-4 text-primary" />
                    <h1 className="text-sm font-semibold">Client Requests</h1>
                </div>
                <div className="flex gap-1">
                    {(["all", "pending", "approved", "rejected"] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => { setFilter(f); setLoading(true); }}
                            className={cn(
                                "text-xs px-2.5 py-1 rounded-md capitalize transition-colors",
                                filter === f ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : requests.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No requests found.</p>
            ) : (
                <div className="space-y-2">
                    {requests.map((r) => (
                        <div key={r.request_id} className="border border-border rounded-lg p-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {r.request_type === "document" ? (
                                    <FileText className="h-4 w-4 text-blue-500" />
                                ) : (
                                    <Users className="h-4 w-4 text-purple-500" />
                                )}
                                <div>
                                    <p className="text-xs font-medium">
                                        {r.request_type === "document"
                                            ? (r.file_name || "Document Request")
                                            : r.team_name}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                        From: {r.client_username} &middot; {new Date(r.created_at).toLocaleDateString()}
                                    </p>
                                    {r.request_notes && (
                                        <p className="text-[10px] text-muted-foreground mt-0.5 italic">&ldquo;{r.request_notes}&rdquo;</p>
                                    )}
                                    {r.team_description && (
                                        <p className="text-[10px] text-muted-foreground mt-0.5">{r.team_description}</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                    r.status === "pending" && "bg-yellow-500/10 text-yellow-600",
                                    r.status === "approved" && "bg-green-500/10 text-green-600",
                                    r.status === "rejected" && "bg-red-500/10 text-red-500",
                                    r.status === "archived" && "bg-muted text-muted-foreground",
                                )}>
                                    {r.status}
                                </span>
                                {r.status === "pending" && (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleResolve(r.request_id, "approved")}
                                            className="p-1 rounded hover:bg-green-500/10"
                                            title="Approve"
                                        >
                                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                        </button>
                                        <button
                                            onClick={() => handleResolve(r.request_id, "rejected")}
                                            className="p-1 rounded hover:bg-red-500/10"
                                            title="Reject"
                                        >
                                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                                        </button>
                                        <button
                                            onClick={() => handleResolve(r.request_id, "archived")}
                                            className="p-1 rounded hover:bg-muted"
                                            title="Archive"
                                        >
                                            <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
