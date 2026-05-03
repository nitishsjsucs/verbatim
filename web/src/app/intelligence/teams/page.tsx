"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Users as UsersIcon, Save, X, Download, Upload, FileDown } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ImportCsvModal } from "@/components/intelligence/import-csv-modal";
import {
    PipelineActionDialog,
    usePipelineAction,
} from "@/components/intelligence/pipeline-action-dialog";
import {
    buildCsv,
    createIntelTeam,
    deleteIntelTeam,
    importIntelTeams,
    listIntelTeams,
    triggerCsvDownload,
    updateIntelTeam,
} from "@/lib/intelligence-api";
import type { ImportMode, ImportResult, IntelTeam } from "@/lib/intelligence-types";

const TEAMS_TEMPLATE_HEADERS = ["name", "function", "department"];
const TEAMS_TEMPLATE_EXAMPLE = [
    ["KYC Operations", "Handles customer due-diligence and identity verification processes", "Operations"],
    ["Compliance Team", "Ensures adherence to regulatory guidelines and policy implementation", "Legal & Compliance"],
];

function downloadTeamsTemplate() {
    const csv = buildCsv(TEAMS_TEMPLATE_HEADERS, TEAMS_TEMPLATE_EXAMPLE);
    triggerCsvDownload(csv, "teams_import_template.csv");
}

function exportTeamsCsv(teams: IntelTeam[]) {
    const rows = teams.map((t) => [t.name, t.function, t.department || "", t.team_id, t.created_at || ""]);
    const csv = buildCsv(["name", "function", "department", "team_id", "created_at"], rows);
    triggerCsvDownload(csv, `teams_export_${new Date().toISOString().slice(0, 10)}.csv`);
}

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
    const [importModalOpen, setImportModalOpen] = useState(false);
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

    const [addDialogOpen, setAddDialogOpen] = useState(false);

    const broadcastTeamsChange = () => {
        window.dispatchEvent(new CustomEvent("intel-teams-changed"));
    };

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
            setAddDialogOpen(false);
            await refresh();
            broadcastTeamsChange();
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
            broadcastTeamsChange();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Update failed");
        } finally {
            setSaving(false);
        }
    };

    const handleImport = async (file: File, mode: ImportMode): Promise<ImportResult> => {
        const result = await importIntelTeams(file, mode);
        await refresh();
        return result;
    };

    const [pendingDelete, setPendingDelete] = useState<IntelTeam | null>(null);
    const deleteDialog = usePipelineAction({
        title: pendingDelete
            ? `Delete team "${pendingDelete.name}"?`
            : "Delete team?",
        description:
            "Actionables assigned only to this team will become unassigned. This cannot be undone.",
        confirmLabel: "Delete",
        stages: ["Removing team"],
    });

    const onDelete = async (team: IntelTeam) => {
        setPendingDelete(team);
        const result = await deleteDialog.request(
            () => deleteIntelTeam(team.team_id),
            { successMessage: () => "Team deleted." },
        );
        setPendingDelete(null);
        if (result !== null) {
            toast.success("Team deleted");
            await refresh();
            broadcastTeamsChange();
        }
    };

    return (
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
            <PipelineActionDialog {...deleteDialog} />
            <ImportCsvModal
                section="Teams"
                open={importModalOpen}
                onClose={() => setImportModalOpen(false)}
                onImport={handleImport}
                onDownloadTemplate={downloadTeamsTemplate}
            />
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        <UsersIcon className="h-5 w-5 text-primary" /> Teams Configuration
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1">
                        Teams defined here drive the semantic team-assignment engine. Each actionable
                        is matched to the most relevant team(s) based on their function description.
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={downloadTeamsTemplate}>
                        <FileDown className="h-3.5 w-3.5" /> Template
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setImportModalOpen(true)}
                    >
                        <Upload className="h-3.5 w-3.5" />
                        Import CSV
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => exportTeamsCsv(teams)}
                        disabled={teams.length === 0}
                    >
                        <Download className="h-3.5 w-3.5" /> Export CSV
                    </Button>
                </div>
            </div>

            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogTrigger asChild>
                    <Button size="sm">
                        <Plus className="h-3.5 w-3.5" /> Add New Team
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add a new team</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
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
                    <DialogFooter>
                        <Button size="sm" onClick={onCreate} disabled={saving}>
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Add Team
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
