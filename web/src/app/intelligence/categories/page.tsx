"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Tag, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
    createIntelCategory,
    deleteIntelCategory,
    listIntelCategories,
    updateIntelCategory,
} from "@/lib/intelligence-api";
import type { IntelCategory } from "@/lib/intelligence-types";

interface FormState {
    name: string;
    description: string;
}

const EMPTY: FormState = { name: "", description: "" };

export default function IntelligenceCategoriesPage() {
    const [categories, setCategories] = useState<IntelCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<FormState>(EMPTY);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<FormState>(EMPTY);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            setCategories(await listIntelCategories());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to load categories");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const onCreate = async () => {
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }
        setSaving(true);
        try {
            await createIntelCategory({
                name: form.name.trim(),
                description: form.description.trim(),
            });
            toast.success("Category created");
            setForm(EMPTY);
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Create failed");
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (c: IntelCategory) => {
        setEditingId(c.category_id);
        setEditForm({ name: c.name, description: c.description || "" });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditForm(EMPTY);
    };

    const saveEdit = async () => {
        if (!editingId) return;
        setSaving(true);
        try {
            await updateIntelCategory(editingId, {
                name: editForm.name.trim(),
                description: editForm.description.trim(),
            });
            toast.success("Category updated");
            cancelEdit();
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Update failed");
        } finally {
            setSaving(false);
        }
    };

    const onDelete = async (c: IntelCategory) => {
        if (!confirm(
            `Delete category "${c.name}"? Existing actionables tagged with this category will keep the label until they are re-extracted.`,
        )) return;
        try {
            await deleteIntelCategory(c.category_id);
            toast.success("Category deleted");
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed");
        }
    };

    return (
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
            <div>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                    <Tag className="h-5 w-5 text-primary" /> Categories Configuration
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                    Categories defined here are the only labels available to actionables.
                    The enricher classifies each actionable against these descriptions; if
                    none clearly fits, the actionable falls back to <em>Uncategorized</em>.
                    Re-extract a document to re-classify with your latest roster.
                </p>
            </div>

            <Card>
                <CardContent className="p-4 space-y-3">
                    <h2 className="text-sm font-semibold">Add a new category</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-[11px] text-muted-foreground">Name *</label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="e.g. KYC Compliance"
                                className="h-8 text-xs"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-[11px] text-muted-foreground">Description</label>
                            <Input
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder="What this category covers — used by the AI to classify actionables."
                                className="h-8 text-xs"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={onCreate} disabled={saving}>
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Add Category
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border border-border">
                <div className="grid grid-cols-[1fr_2fr_120px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/30">
                    <div>Name</div>
                    <div>Description</div>
                    <div className="text-right">Actions</div>
                </div>
                {loading ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading...
                    </div>
                ) : categories.length === 0 ? (
                    <div className="p-10 text-center text-xs text-muted-foreground">
                        No categories defined yet. Until you add at least one, all actionables
                        will be tagged <em>Uncategorized</em>.
                    </div>
                ) : (
                    categories.map((c) => {
                        const editing = editingId === c.category_id;
                        return (
                            <div
                                key={c.category_id}
                                className="grid grid-cols-[1fr_2fr_120px] gap-2 items-start px-4 py-3 text-xs border-b border-border last:border-0 hover:bg-muted/10"
                            >
                                {editing ? (
                                    <>
                                        <Input
                                            value={editForm.name}
                                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                            className="h-7 text-xs"
                                        />
                                        <Input
                                            value={editForm.description}
                                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
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
                                        <div className="font-medium">{c.name}</div>
                                        <div className="text-muted-foreground">
                                            {c.description || <span className="italic">—</span>}
                                        </div>
                                        <div className="flex items-center justify-end gap-1">
                                            <Button size="xs" variant="outline" onClick={() => startEdit(c)}>
                                                <Pencil className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                onClick={() => onDelete(c)}
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
