"use client";

/**
 * ImportCsvModal — shared bulk import dialog used by Teams, Categories, and Actionables.
 *
 * Flow:
 *   1. User clicks "Import CSV" → modal opens, shows mode selector.
 *   2. User selects a .csv file via the drag-drop / browse zone.
 *   3. User picks an import mode (Add Only / Upsert / Replace).
 *   4. If Replace: destructive confirmation sub-step.
 *   5. User clicks "Import" → caller's `onImport` is invoked.
 *   6. Result summary is displayed (added / updated / skipped / failed + detail lists).
 */

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileDown, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportMode, ImportResult } from "@/lib/intelligence-types";

export type { ImportMode, ImportResult };

interface Props {
    /** Section label shown in the modal title, e.g. "Teams" */
    section: string;
    /** Whether the modal is open */
    open: boolean;
    /** Called when the user dismisses the modal */
    onClose: () => void;
    /**
     * Called when the user confirms the import.
     * The implementor sends the file + mode to the backend and resolves with ImportResult.
     */
    onImport: (file: File, mode: ImportMode) => Promise<ImportResult>;
    /** Called when the user wants to download the template */
    onDownloadTemplate: () => void;
    /** Whether "Add Only" mode is disabled for this section (e.g. Actionables) */
    disableAddOnly?: boolean;
}

const MODE_INFO: Record<
    ImportMode,
    { label: string; description: string; destructive: boolean }
> = {
    add: {
        label: "Add Only",
        description:
            "Adds only new entries. Existing records (matched by name/ID) are left unchanged. Duplicates are skipped.",
        destructive: false,
    },
    upsert: {
        label: "Update Existing (Recommended)",
        description:
            "Updates existing records when a match is found, and creates new records for unmatched entries.",
        destructive: false,
    },
    replace: {
        label: "Replace All",
        description:
            "Deletes all existing records in this section and replaces them entirely with the uploaded CSV.",
        destructive: true,
    },
};

export function ImportCsvModal({
    section,
    open,
    onClose,
    onImport,
    onDownloadTemplate,
    disableAddOnly = false,
}: Props) {
    const [step, setStep] = useState<"select" | "replace-confirm" | "running" | "result">(
        "select",
    );
    const [mode, setMode] = useState<ImportMode>("upsert");
    const [file, setFile] = useState<File | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    if (!open) return null;

    const reset = () => {
        setStep("select");
        setMode("upsert");
        setFile(null);
        setResult(null);
        setError(null);
        setDragOver(false);
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    const handleFile = (f: File) => {
        if (!f.name.toLowerCase().endsWith(".csv")) {
            setError("Only .csv files are accepted.");
            return;
        }
        setError(null);
        setFile(f);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
        e.target.value = "";
    };

    const handleImport = async () => {
        if (!file) return;
        if (mode === "replace" && step !== "replace-confirm") {
            setStep("replace-confirm");
            return;
        }
        setStep("running");
        setError(null);
        try {
            const res = await onImport(file, mode);
            setResult(res);
            setStep("result");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Import failed");
            setStep("select");
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-xl mx-4">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <h2 className="text-sm font-semibold">
                        Import CSV — {section}
                    </h2>
                    <button
                        onClick={handleClose}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {/* ── STEP: select ──────────────────────────────────────── */}
                    {(step === "select" || step === "replace-confirm") && (
                        <>
                            {/* Template download */}
                            <div className="flex items-center justify-between rounded-md border border-dashed border-border bg-muted/20 px-4 py-2.5">
                                <p className="text-xs text-muted-foreground">
                                    New here? Download the template first.
                                </p>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs gap-1"
                                    onClick={onDownloadTemplate}
                                >
                                    <FileDown className="h-3.5 w-3.5" /> Template
                                </Button>
                            </div>

                            {/* File drop zone */}
                            <div
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop}
                                onClick={() => fileRef.current?.click()}
                                className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
                                    dragOver
                                        ? "border-primary bg-primary/5"
                                        : file
                                        ? "border-emerald-500 bg-emerald-500/5"
                                        : "border-border hover:border-muted-foreground/50"
                                }`}
                            >
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".csv"
                                    className="hidden"
                                    onChange={handleFileInput}
                                />
                                {file ? (
                                    <p className="text-xs font-medium text-emerald-600">
                                        ✓ {file.name}
                                    </p>
                                ) : (
                                    <>
                                        <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                                        <p className="text-xs text-muted-foreground">
                                            Drag &amp; drop a .csv file or{" "}
                                            <span className="text-primary underline">browse</span>
                                        </p>
                                    </>
                                )}
                            </div>

                            {/* Mode selector */}
                            <div className="space-y-2">
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                    Import Mode
                                </p>
                                {(Object.entries(MODE_INFO) as [ImportMode, (typeof MODE_INFO)[ImportMode]][]).map(
                                    ([key, info]) => {
                                        const disabled = key === "add" && disableAddOnly;
                                        return (
                                            <label
                                                key={key}
                                                className={`flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
                                                    disabled
                                                        ? "opacity-40 cursor-not-allowed border-border"
                                                        : mode === key
                                                        ? info.destructive
                                                            ? "border-red-500 bg-red-500/5"
                                                            : "border-primary bg-primary/5"
                                                        : "border-border hover:border-muted-foreground/40"
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="import-mode"
                                                    value={key}
                                                    checked={mode === key}
                                                    disabled={disabled}
                                                    onChange={() => setMode(key)}
                                                    className="mt-0.5 accent-primary"
                                                />
                                                <div>
                                                    <p className={`text-xs font-semibold ${info.destructive ? "text-red-600" : ""}`}>
                                                        {info.label}
                                                        {info.destructive && (
                                                            <span className="ml-2 text-[10px] font-normal bg-red-500/15 text-red-600 px-1.5 py-0.5 rounded">
                                                                DESTRUCTIVE
                                                            </span>
                                                        )}
                                                        {disabled && (
                                                            <span className="ml-2 text-[10px] font-normal bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                                                N/A for {section}
                                                            </span>
                                                        )}
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                                        {info.description}
                                                    </p>
                                                </div>
                                            </label>
                                        );
                                    },
                                )}
                            </div>

                            {/* Replace confirm sub-step */}
                            {step === "replace-confirm" && (
                                <div className="rounded-md border border-red-500/40 bg-red-500/5 px-4 py-3 space-y-1">
                                    <p className="text-xs font-semibold text-red-600 flex items-center gap-1.5">
                                        <AlertTriangle className="h-3.5 w-3.5" /> Destructive Action — Confirm
                                    </p>
                                    <p className="text-[11px] text-red-600/80">
                                        All existing {section.toLowerCase()} will be permanently deleted and
                                        replaced by the contents of your CSV. This cannot be undone.
                                    </p>
                                </div>
                            )}

                            {/* Inline error */}
                            {error && (
                                <p className="text-xs text-red-600 bg-red-500/5 border border-red-500/30 rounded px-3 py-2">
                                    {error}
                                </p>
                            )}

                            {/* Actions */}
                            <div className="flex justify-end gap-2 pt-1">
                                <Button size="sm" variant="ghost" onClick={handleClose}>
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    disabled={!file}
                                    onClick={handleImport}
                                    className={mode === "replace" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                                >
                                    {mode === "replace" && step !== "replace-confirm"
                                        ? "Continue →"
                                        : mode === "replace"
                                        ? "Yes, Replace All"
                                        : "Import"}
                                </Button>
                            </div>
                        </>
                    )}

                    {/* ── STEP: running ─────────────────────────────────────── */}
                    {step === "running" && (
                        <div className="flex flex-col items-center gap-3 py-8">
                            <Loader2 className="h-7 w-7 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Importing…</p>
                        </div>
                    )}

                    {/* ── STEP: result ──────────────────────────────────────── */}
                    {step === "result" && result && (
                        <>
                            {/* Summary counts */}
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { label: "Added", value: result.added, color: "text-emerald-600" },
                                    { label: "Updated", value: result.updated, color: "text-blue-600" },
                                    { label: "Skipped", value: result.skipped, color: "text-amber-600" },
                                    { label: "Failed", value: result.failed, color: "text-red-600" },
                                ].map((c) => (
                                    <div
                                        key={c.label}
                                        className="rounded-md border border-border bg-muted/20 px-3 py-2 text-center"
                                    >
                                        <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
                                        <p className="text-[10px] text-muted-foreground">{c.label}</p>
                                    </div>
                                ))}
                            </div>

                            {result.added + result.updated > 0 && (
                                <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Import completed successfully.
                                </div>
                            )}

                            {/* Detail lists */}
                            {result.skip_reasons && result.skip_reasons.length > 0 && (
                                <DetailList
                                    title="Skipped entries"
                                    color="amber"
                                    items={result.skip_reasons}
                                />
                            )}
                            {result.fail_reasons && result.fail_reasons.length > 0 && (
                                <DetailList
                                    title="Failed entries"
                                    color="red"
                                    items={result.fail_reasons}
                                />
                            )}
                            {result.unmatched_ids && result.unmatched_ids.length > 0 && (
                                <DetailList
                                    title="Unmatched IDs (not found in system)"
                                    color="amber"
                                    items={result.unmatched_ids}
                                />
                            )}

                            <div className="flex justify-end pt-1">
                                <Button size="sm" onClick={handleClose}>
                                    Done
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function DetailList({
    title,
    color,
    items,
}: {
    title: string;
    color: "amber" | "red";
    items: string[];
}) {
    const cls =
        color === "red"
            ? "border-red-500/30 bg-red-500/5 text-red-700"
            : "border-amber-500/30 bg-amber-500/5 text-amber-700";
    return (
        <div className={`rounded-md border px-3 py-2 ${cls}`}>
            <p className="text-[11px] font-semibold mb-1.5">{title}</p>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {items.map((item, i) => (
                    <li key={i} className="text-[11px]">
                        • {item}
                    </li>
                ))}
            </ul>
        </div>
    );
}
