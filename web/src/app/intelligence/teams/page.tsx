"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Users as UsersIcon, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
    createIntelTeam,
    deleteIntelTeam,
    listIntelTeams,
    updateIntelTeam,
} from "@/lib/intelligence-api";
import type { IntelTeam } from "@/lib/intelligence-types";

interface FormState {
    name: string;
    function: string;
    department: string;
}

const EMPTY: FormState = { name: "", function: "", department: "" };

export default function IntelligenceTeamsPage() {
    const [teams, setTeams] = useState<IntelTeam[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<FormState>(EMPTY);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<FormState>(EMPTY);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            setTeams(await listIntelTeams());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to load teams");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const onCreate = async () => {
        if (!form.name.trim() || !form.function.trim()) {
            toast.error("Name and function are required");
            return;
        }
        setSaving(true);
        try {
            await createIntelTeam({
                name: form.name.trim(),
                function: form.function.trim(),
                department: form.department.trim() || null,
            });
            toast.success("Team created");
            setForm(EMPTY);
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Create failed");
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (t: IntelTeam) => {
        setEditingId(t.team_id);
        setEditForm({
            name: t.name,
            function: t.function,
            department: t.department || "",
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditForm(EMPTY);
    };

    const saveEdit = async () => {
        if (!editingId) return;
        setSaving(true);
        try {
            await updateIntelTeam(editingId, {
                name: editForm.name.trim(),
                function: editForm.function.trim(),
                department: editForm.department.trim() || null,
            });
            toast.success("Team updated");
            cancelEdit();
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Update failed");
        } finally {
            setSaving(false);
        }
    };

    const onDelete = async (team: IntelTeam) => {
        if (!confirm(`Delete team "${team.name}"? Actionables assigned only to this team will become unassigned.`)) {
            return;
        }
        try {
            await deleteIntelTeam(team.team_id);
            toast.success("Team deleted");
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed");
        }
    };

    return (
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
            <div>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                    <UsersIcon className="h-5 w-5 text-primary" /> Teams Configuration
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                    Teams defined here drive the semantic team-assignment engine. Each actionable
                    is matched to the most relevant team(s) based on their function description.
                </p>
            </div>

            <Card>
                <CardContent className="p-4 space-y-3">
                    <h2 className="text-sm font-semibold">Add a new team</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-[11px] text-muted-foreground">Name *</label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="e.g. KYC Operations"
                                className="h-8 text-xs"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] text-muted-foreground">Function *</label>
                            <Input
                                value={form.function}
                                onChange={(e) => setForm({ ...form, function: e.target.value })}
                                placeholder="What this team owns..."
                                className="h-8 text-xs"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] text-muted-foreground">Department</label>
                            <Input
                                value={form.department}
                                onChange={(e) => setForm({ ...form, department: e.target.value })}
                                placeholder="Optional"
                                className="h-8 text-xs"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={onCreate} disabled={saving}>
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Add Team
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border border-border">
                <div className="grid grid-cols-[1fr_2fr_1fr_120px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/30">
                    <div>Name</div>
                    <div>Function</div>
                    <div>Department</div>
                    <div className="text-right">Actions</div>
                </div>
                {loading ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading...
                    </div>
                ) : teams.length === 0 ? (
                    <div className="p-10 text-center text-xs text-muted-foreground">
                        No teams defined yet. Actionables will be marked “Unassigned” until at
                        least one team is added.
                    </div>
                ) : (
                    teams.map((t) => {
                        const editing = editingId === t.team_id;
                        return (
                            <div
                                key={t.team_id}
                                className="grid grid-cols-[1fr_2fr_1fr_120px] gap-2 items-start px-4 py-3 text-xs border-b border-border last:border-0 hover:bg-muted/10"
                            >
                                {editing ? (
                                    <>
                                        <Input
                                            value={editForm.name}
                                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                            className="h-7 text-xs"
                                        />
                                        <Input
                                            value={editForm.function}
                                            onChange={(e) => setEditForm({ ...editForm, function: e.target.value })}
                                            className="h-7 text-xs"
                                        />
                                        <Input
                                            value={editForm.department}
                                            onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                                            className="h-7 text-xs"
                                        />
                                        <div className="flex items-center justify-end gap-1">
                                            <Button size="xs" onClick={saveEdit} disabled={saving}>
                                                <Save className="h-3 w-3" /> Save
                                            </Button>
                                            <Button size="xs" variant="ghost" onClick={cancelEdit}>
                                                <X className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="font-medium">{t.name}</div>
                                        <div className="text-muted-foreground">{t.function}</div>
                                        <div className="text-muted-foreground">
                                            {t.department || <span className="italic">—</span>}
                                        </div>
                                        <div className="flex items-center justify-end gap-1">
                                            <Button size="xs" variant="outline" onClick={() => startEdit(t)}>
                                                <Pencil className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                onClick={() => onDelete(t)}
                                                className="text-red-600 hover:text-red-700"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
