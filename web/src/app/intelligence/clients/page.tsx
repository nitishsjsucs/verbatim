"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    Plus,
    Users,
    Loader2,
    ToggleLeft,
    ToggleRight,
    Trash2,
    Key,
    Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isIntelAuthenticated, isIntelAdmin } from "@/lib/intel-auth";
import {
    listClients,
    createClient,
    updateClient,
    deleteClient,
    setClientPassword,
    listInstitutionTags,
    createInstitutionTag,
    deleteInstitutionTag,
    type ClientAccountInfo,
    type InstitutionTag,
} from "@/lib/intel-tenant-api";

export default function ClientsManagementPage() {
    const router = useRouter();
    const [clients, setClients] = React.useState<ClientAccountInfo[]>([]);
    const [tags, setTags] = React.useState<InstitutionTag[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [showCreate, setShowCreate] = React.useState(false);

    // Auth check
    React.useEffect(() => {
        if (!isIntelAuthenticated() || !isIntelAdmin()) {
            router.replace("/intelligence/login");
        }
    }, [router]);

    const refresh = React.useCallback(async () => {
        try {
            const [c, t] = await Promise.all([listClients(), listInstitutionTags()]);
            setClients(c);
            setTags(t);
        } catch (err) {
            toast.error("Failed to load clients");
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => { refresh(); }, [refresh]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <h1 className="text-sm font-semibold">Client Management</h1>
                    <span className="text-xs text-muted-foreground">({clients.length} clients)</span>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                    <Plus className="h-3.5 w-3.5" />
                    Create Client
                </button>
            </div>

            {showCreate && (
                <CreateClientForm
                    tags={tags}
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); refresh(); }}
                />
            )}

            {/* Tag Management Section */}
            <TagManagementSection tags={tags} onRefresh={refresh} />

            <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b border-border">
                        <tr>
                            <th className="text-left px-3 py-2 font-medium">Username</th>
                            <th className="text-left px-3 py-2 font-medium">Display Name</th>
                            <th className="text-left px-3 py-2 font-medium">Tags</th>
                            <th className="text-left px-3 py-2 font-medium">Status</th>
                            <th className="text-left px-3 py-2 font-medium">Last Login</th>
                            <th className="text-right px-3 py-2 font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {clients.map((c) => (
                            <ClientRow
                                key={c.account_id}
                                client={c}
                                onRefresh={refresh}
                            />
                        ))}
                        {clients.length === 0 && (
                            <tr>
                                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                                    No clients yet. Create one to get started.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Tag Management Section
// ---------------------------------------------------------------------------

function TagManagementSection({ tags, onRefresh }: { tags: InstitutionTag[]; onRefresh: () => void }) {
    const [newTagName, setNewTagName] = React.useState("");
    const [newTagDesc, setNewTagDesc] = React.useState("");
    const [creating, setCreating] = React.useState(false);

    const handleCreate = async () => {
        if (!newTagName.trim()) {
            toast.error("Tag name is required");
            return;
        }
        setCreating(true);
        try {
            await createInstitutionTag(newTagName.trim(), newTagDesc.trim());
            toast.success(`Tag "${newTagName}" created`);
            setNewTagName("");
            setNewTagDesc("");
            onRefresh();
        } catch {
            toast.error("Failed to create tag");
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (tagName: string) => {
        if (!confirm(`Delete tag "${tagName}"? This will not affect existing assignments.`)) return;
        try {
            await deleteInstitutionTag(tagName);
            toast.success(`Tag "${tagName}" deleted`);
            onRefresh();
        } catch {
            toast.error("Failed to delete tag");
        }
    };

    return (
        <div className="border border-border rounded-lg p-4 bg-muted/10 space-y-3">
            <h2 className="text-xs font-semibold flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Institution Tags ({tags.length})
            </h2>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Tag name (e.g., banking)"
                    className="flex-1 bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none"
                />
                <input
                    type="text"
                    value={newTagDesc}
                    onChange={(e) => setNewTagDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="flex-1 bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none"
                />
                <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                    {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Add
                </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                    <div key={t.name} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/30">
                        <Tag className="h-2.5 w-2.5" />
                        <span>{t.name}</span>
                        {t.description && <span className="text-[10px] text-muted-foreground">({t.description})</span>}
                        <button
                            onClick={() => handleDelete(t.name)}
                            className="ml-1 hover:text-red-500"
                        >
                            <Trash2 className="h-2.5 w-2.5" />
                        </button>
                    </div>
                ))}
                {tags.length === 0 && (
                    <span className="text-xs text-muted-foreground">No tags yet. Create one to get started.</span>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Create Client Form
// ---------------------------------------------------------------------------

function CreateClientForm({
    tags,
    onClose,
    onCreated,
}: {
    tags: InstitutionTag[];
    onClose: () => void;
    onCreated: () => void;
}) {
    const [username, setUsername] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [displayName, setDisplayName] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
    const [loading, setLoading] = React.useState(false);

    const toggleTag = (tag: string) => {
        setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await createClient({
                username,
                password,
                display_name: displayName || username,
                email,
                institution_tags: selectedTags,
            });
            toast.success(`Client "${username}" created`);
            onCreated();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Create failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="border border-border rounded-lg p-4 bg-muted/20 space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold">New Client Account</h2>
                <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs text-muted-foreground block mb-1">Username *</label>
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        minLength={2}
                        className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground block mb-1">Password *</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                        className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground block mb-1">Display Name</label>
                    <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground block mb-1">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none"
                    />
                </div>
                <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Institution Tags</label>
                    <div className="flex flex-wrap gap-1.5">
                        {tags.map((t) => (
                            <button
                                type="button"
                                key={t.name}
                                onClick={() => toggleTag(t.name)}
                                className={cn(
                                    "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors",
                                    selectedTags.includes(t.name)
                                        ? "bg-primary/10 text-primary border-primary/30"
                                        : "text-muted-foreground border-border hover:border-primary/30",
                                )}
                            >
                                <Tag className="h-2.5 w-2.5" />
                                {t.name}
                            </button>
                        ))}
                        {tags.length === 0 && (
                            <span className="text-xs text-muted-foreground">No tags defined yet.</span>
                        )}
                    </div>
                </div>
                <div className="col-span-2 flex justify-end">
                    <button
                        type="submit"
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                        Create
                    </button>
                </div>
            </form>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Client Row
// ---------------------------------------------------------------------------

function ClientRow({ client, onRefresh }: { client: ClientAccountInfo; onRefresh: () => void }) {
    const [resettingPw, setResettingPw] = React.useState(false);
    const [newPw, setNewPw] = React.useState("");

    const toggleActive = async () => {
        try {
            await updateClient(client.account_id, { is_active: !client.is_active });
            toast.success(`Client ${client.is_active ? "deactivated" : "activated"}`);
            onRefresh();
        } catch {
            toast.error("Toggle failed");
        }
    };

    const handleDelete = async () => {
        if (!confirm(`Delete client "${client.username}" permanently?`)) return;
        try {
            await deleteClient(client.account_id);
            toast.success("Client deleted");
            onRefresh();
        } catch {
            toast.error("Delete failed");
        }
    };

    const handleResetPw = async () => {
        if (!newPw || newPw.length < 6) {
            toast.error("Password must be at least 6 characters");
            return;
        }
        try {
            await setClientPassword(client.account_id, newPw);
            toast.success("Password reset");
            setResettingPw(false);
            setNewPw("");
        } catch {
            toast.error("Reset failed");
        }
    };

    return (
        <>
            <tr className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{client.username}</td>
                <td className="px-3 py-2">{client.display_name}</td>
                <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                        {client.institution_tags.map((t) => (
                            <span key={t} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                                <Tag className="h-2 w-2" />
                                {t}
                            </span>
                        ))}
                    </div>
                </td>
                <td className="px-3 py-2">
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", client.is_active ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500")}>
                        {client.is_active ? "Active" : "Inactive"}
                    </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                    {client.last_login ? new Date(client.last_login).toLocaleDateString() : "Never"}
                </td>
                <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                        <button onClick={toggleActive} title={client.is_active ? "Deactivate" : "Activate"} className="p-1 rounded hover:bg-muted">
                            {client.is_active ? <ToggleRight className="h-3.5 w-3.5 text-green-600" /> : <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                        </button>
                        <button onClick={() => setResettingPw(!resettingPw)} title="Reset password" className="p-1 rounded hover:bg-muted">
                            <Key className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button onClick={handleDelete} title="Delete" className="p-1 rounded hover:bg-muted">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                    </div>
                </td>
            </tr>
            {resettingPw && (
                <tr className="border-b border-border/50 bg-muted/10">
                    <td colSpan={6} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                            <input
                                type="password"
                                value={newPw}
                                onChange={(e) => setNewPw(e.target.value)}
                                placeholder="New password (min 6 chars)"
                                className="flex-1 max-w-xs bg-background text-xs rounded-md px-2.5 py-1.5 border border-border focus:border-primary focus:outline-none"
                            />
                            <button onClick={handleResetPw} className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded">Set</button>
                            <button onClick={() => { setResettingPw(false); setNewPw(""); }} className="text-xs text-muted-foreground">Cancel</button>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
