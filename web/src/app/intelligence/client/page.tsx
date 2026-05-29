"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    FileText,
    Loader2,
    LogOut,
    Send,
    Users as UsersIcon,
    Tag,
    Eye,
    ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isIntelAuthenticated, isIntelClient, getIntelUser, intelLogout } from "@/lib/intel-auth";
import {
    listTenantDocuments,
    listMyRequests,
    submitDocumentRequest,
    submitTeamRequest,
    type TenantDocument,
    type ClientRequestItem,
} from "@/lib/intel-tenant-api";

type Tab = "workspace" | "services" | "profile";

export default function ClientDashboard() {
    const router = useRouter();
    const [tab, setTab] = React.useState<Tab>("workspace");
    const user = getIntelUser();

    React.useEffect(() => {
        if (!isIntelAuthenticated() || !isIntelClient()) {
            router.replace("/intelligence/login");
        }
    }, [router]);

    if (!user) return null;

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* Header */}
            <header className="h-12 border-b border-border flex items-center justify-between px-6 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{user.display_name}</span>
                    <div className="flex gap-1">
                        {user.institution_tags.map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                                {t}
                            </span>
                        ))}
                    </div>
                </div>
                <nav className="flex items-center gap-1">
                    {(["workspace", "services", "profile"] as Tab[]).map((t) => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize",
                                tab === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent",
                            )}
                        >
                            {t}
                        </button>
                    ))}
                    <button
                        onClick={() => { intelLogout(); router.replace("/intelligence/login"); }}
                        className="ml-2 p-1.5 rounded hover:bg-muted"
                        title="Sign out"
                    >
                        <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                </nav>
            </header>

            {/* Content */}
            <main className="flex-1 overflow-y-auto p-6">
                {tab === "workspace" && <WorkspaceTab />}
                {tab === "services" && <ServicesTab />}
                {tab === "profile" && <ProfileTab />}
            </main>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Workspace Tab — view documents (read-only)
// ---------------------------------------------------------------------------

function WorkspaceTab() {
    const router = useRouter();
    const [docs, setDocs] = React.useState<TenantDocument[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        listTenantDocuments()
            .then(setDocs)
            .catch(() => toast.error("Failed to load documents"))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return <div className="flex justify-center py-12"><Loader2 className="h-4 w-4 animate-spin" /></div>;
    }

    return (
        <div className="space-y-4 max-w-4xl">
            <h2 className="text-xs font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Your Documents
            </h2>
            {docs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">
                    No documents available for your institution tags.
                </p>
            ) : (
                <div className="grid gap-2">
                    {docs.map((d) => (
                        <button
                            key={d.doc_id}
                            onClick={() => router.push(`/intelligence/client/${d.doc_id}`)}
                            className="flex items-center justify-between border border-border rounded-lg px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <FileText className="h-4 w-4 text-primary/70" />
                                <div>
                                    <p className="text-xs font-medium">{d.doc_name}</p>
                                    <p className="text-[10px] text-muted-foreground">{d.pages} pages &middot; {d.nodes} nodes</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1">
                                    {d.tags.map((t) => (
                                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                            {t}
                                        </span>
                                    ))}
                                </div>
                                {d.has_run && <Eye className="h-3 w-3 text-green-500" />}
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Services Tab — request documents/teams
// ---------------------------------------------------------------------------

function ServicesTab() {
    const [requests, setRequests] = React.useState<ClientRequestItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [showDocForm, setShowDocForm] = React.useState(false);
    const [showTeamForm, setShowTeamForm] = React.useState(false);

    const refresh = React.useCallback(() => {
        listMyRequests()
            .then(setRequests)
            .catch(() => toast.error("Failed to load requests"))
            .finally(() => setLoading(false));
    }, []);

    React.useEffect(() => { refresh(); }, [refresh]);

    return (
        <div className="space-y-6 max-w-3xl">
            <h2 className="text-xs font-semibold flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" /> Services
            </h2>

            <div className="flex gap-2">
                <button
                    onClick={() => setShowDocForm(!showDocForm)}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
                >
                    <FileText className="h-3 w-3" /> Request Document
                </button>
                <button
                    onClick={() => setShowTeamForm(!showTeamForm)}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
                >
                    <UsersIcon className="h-3 w-3" /> Request Team
                </button>
            </div>

            {showDocForm && <DocRequestForm onDone={() => { setShowDocForm(false); refresh(); }} />}
            {showTeamForm && <TeamRequestForm onDone={() => { setShowTeamForm(false); refresh(); }} />}

            {/* Request history */}
            <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">Your Requests</h3>
                {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : requests.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No requests yet.</p>
                ) : (
                    <div className="space-y-1.5">
                        {requests.map((r) => (
                            <div key={r.request_id} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
                                <div className="flex items-center gap-2">
                                    {r.request_type === "document" ? <FileText className="h-3 w-3" /> : <UsersIcon className="h-3 w-3" />}
                                    <span className="text-xs">
                                        {r.request_type === "document" ? (r.file_name || "Document request") : r.team_name}
                                    </span>
                                </div>
                                <span className={cn(
                                    "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                    r.status === "pending" && "bg-yellow-500/10 text-yellow-600",
                                    r.status === "approved" && "bg-green-500/10 text-green-600",
                                    r.status === "rejected" && "bg-red-500/10 text-red-500",
                                    r.status === "archived" && "bg-muted text-muted-foreground",
                                )}>
                                    {r.status}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function DocRequestForm({ onDone }: { onDone: () => void }) {
    const [notes, setNotes] = React.useState("");
    const [file, setFile] = React.useState<File | null>(null);
    const [loading, setLoading] = React.useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await submitDocumentRequest(notes, file || undefined);
            toast.success("Document request submitted");
            onDone();
        } catch {
            toast.error("Failed to submit request");
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="border border-border rounded-lg p-3 space-y-2 bg-muted/10">
            <label className="text-xs text-muted-foreground block">Notes</label>
            <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none resize-none h-16"
                placeholder="Describe what document you need..."
            />
            <label className="text-xs text-muted-foreground block">Attach file (optional)</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs" />
            <div className="flex justify-end">
                <button type="submit" disabled={loading} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md disabled:opacity-50">
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Submit"}
                </button>
            </div>
        </form>
    );
}

function TeamRequestForm({ onDone }: { onDone: () => void }) {
    const [teamName, setTeamName] = React.useState("");
    const [desc, setDesc] = React.useState("");
    const [loading, setLoading] = React.useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!teamName) return;
        setLoading(true);
        try {
            await submitTeamRequest(teamName, desc);
            toast.success("Team request submitted");
            onDone();
        } catch {
            toast.error("Failed to submit request");
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="border border-border rounded-lg p-3 space-y-2 bg-muted/10">
            <label className="text-xs text-muted-foreground block">Team Name *</label>
            <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
                className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none"
            />
            <label className="text-xs text-muted-foreground block">Description</label>
            <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none resize-none h-16"
            />
            <div className="flex justify-end">
                <button type="submit" disabled={loading} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md disabled:opacity-50">
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Submit"}
                </button>
            </div>
        </form>
    );
}

// ---------------------------------------------------------------------------
// Profile Tab
// ---------------------------------------------------------------------------

function ProfileTab() {
    const user = getIntelUser();
    if (!user) return null;
    return (
        <div className="max-w-md space-y-4">
            <h2 className="text-xs font-semibold">Profile</h2>
            <div className="border border-border rounded-lg p-4 space-y-3">
                <Row label="Username" value={user.username} />
                <Row label="Display Name" value={user.display_name} />
                <Row label="Role" value={user.role} />
                <Row label="Account ID" value={user.account_id} />
                <div>
                    <span className="text-[10px] text-muted-foreground block mb-1">Institution Tags</span>
                    <div className="flex flex-wrap gap-1">
                        {user.institution_tags.map((t) => (
                            <span key={t} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                                <Tag className="h-2 w-2" />{t}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span className="text-[10px] text-muted-foreground block">{label}</span>
            <span className="text-xs font-medium">{value}</span>
        </div>
    );
}
