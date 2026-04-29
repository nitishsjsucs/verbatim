/**
 * Client for the Actionable Intelligence System backend (`/intelligence/*`).
 *
 * Reuses the same `API_BASE_URL` and header policy as the existing `api.ts`,
 * but keeps a separate file so the feature is isolated and can be removed
 * without touching existing product code.
 */

import { API_BASE_URL } from "./api";
import type {
    EnrichedActionable,
    ImportMode,
    ImportResult,
    IntelCategory,
    IntelDashboardPayload,
    IntelDocumentMeta,
    IntelRunPayload,
    IntelTeam,
} from "./intelligence-types";

function intelFetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${API_BASE_URL}/intelligence${path}`, {
        ...options,
        headers: {
            "ngrok-skip-browser-warning": "1",
            ...(options.headers || {}),
        },
    });
}

async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
    if (!res.ok) {
        let msg = fallback;
        try {
            const body = await res.json();
            msg = body?.detail || msg;
        } catch {
            /* noop */
        }
        throw new Error(msg);
    }
    return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export async function listIntelDocuments(): Promise<IntelDocumentMeta[]> {
    const res = await intelFetch("/documents");
    return parseOrThrow(res, "Failed to list documents");
}

export async function ingestIntelDocument(
    file: File,
    force = false,
): Promise<{ doc_id: string; doc_name: string }> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await intelFetch(`/ingest?force=${force}`, { method: "POST", body: fd });
    return parseOrThrow(res, "Ingest failed");
}

// ---------------------------------------------------------------------------
// Runs (per-doc intelligence)
// ---------------------------------------------------------------------------
export async function extractIntelligence(
    docId: string,
    force = false,
): Promise<IntelRunPayload> {
    const res = await intelFetch(`/documents/${encodeURIComponent(docId)}/extract?force=${force}`, {
        method: "POST",
    });
    return parseOrThrow(res, "Extraction failed");
}

export async function getIntelRun(docId: string): Promise<IntelRunPayload> {
    const res = await intelFetch(`/documents/${encodeURIComponent(docId)}`);
    return parseOrThrow(res, "No intelligence run found");
}

export async function reassignIntelTeams(docId: string): Promise<IntelRunPayload> {
    const res = await intelFetch(`/documents/${encodeURIComponent(docId)}/reassign`, {
        method: "POST",
    });
    return parseOrThrow(res, "Reassignment failed");
}

export async function patchIntelActionable(
    docId: string,
    itemId: string,
    patch: Partial<EnrichedActionable>,
): Promise<EnrichedActionable> {
    const res = await intelFetch(
        `/documents/${encodeURIComponent(docId)}/actionables/${encodeURIComponent(itemId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
        },
    );
    return parseOrThrow(res, "Update failed");
}

export async function deleteIntelRun(docId: string): Promise<void> {
    const res = await intelFetch(`/documents/${encodeURIComponent(docId)}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete failed");
}

/**
 * Wipe ALL extracted actionables across every document. Documents, document
 * metadata, teams, and categories are NOT touched. Used by the reset button
 * to provide a clean slate before re-running extraction.
 */
export async function resetAllIntelActionables(): Promise<{ ok: boolean; deleted_runs: number }> {
    const res = await intelFetch("/admin/reset-actionables", { method: "POST" });
    return parseOrThrow(res, "Reset failed");
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
export async function listIntelTeams(): Promise<IntelTeam[]> {
    const res = await intelFetch("/teams");
    return parseOrThrow(res, "Failed to list teams");
}

export async function createIntelTeam(input: {
    name: string;
    function: string;
    department?: string | null;
}): Promise<IntelTeam> {
    const res = await intelFetch("/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    return parseOrThrow(res, "Create team failed");
}

export async function updateIntelTeam(
    teamId: string,
    patch: Partial<Pick<IntelTeam, "name" | "function" | "department">>,
): Promise<IntelTeam> {
    const res = await intelFetch(`/teams/${encodeURIComponent(teamId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    return parseOrThrow(res, "Update team failed");
}

export async function deleteIntelTeam(teamId: string): Promise<void> {
    const res = await intelFetch(`/teams/${encodeURIComponent(teamId)}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete team failed");
}

// ---------------------------------------------------------------------------
// Categories (user-defined classification roster)
// ---------------------------------------------------------------------------
export async function listIntelCategories(): Promise<IntelCategory[]> {
    const res = await intelFetch("/categories");
    return parseOrThrow(res, "Failed to list categories");
}

export async function createIntelCategory(input: {
    name: string;
    description?: string;
}): Promise<IntelCategory> {
    const res = await intelFetch("/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name, description: input.description || "" }),
    });
    return parseOrThrow(res, "Create category failed");
}

export async function updateIntelCategory(
    categoryId: string,
    patch: Partial<Pick<IntelCategory, "name" | "description">>,
): Promise<IntelCategory> {
    const res = await intelFetch(`/categories/${encodeURIComponent(categoryId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    return parseOrThrow(res, "Update category failed");
}

export async function deleteIntelCategory(categoryId: string): Promise<void> {
    const res = await intelFetch(`/categories/${encodeURIComponent(categoryId)}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete category failed");
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export async function getIntelDashboard(): Promise<IntelDashboardPayload> {
    const res = await intelFetch("/dashboard");
    return parseOrThrow(res, "Failed to load dashboard");
}

// ---------------------------------------------------------------------------
// Bulk import helpers
// ---------------------------------------------------------------------------
export async function importIntelTeams(
    file: File,
    mode: ImportMode = "upsert",
): Promise<ImportResult> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await intelFetch(`/teams/import?mode=${mode}`, { method: "POST", body: fd });
    return parseOrThrow(res, "Teams import failed");
}

export async function importIntelCategories(
    file: File,
    mode: ImportMode = "upsert",
): Promise<ImportResult> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await intelFetch(`/categories/import?mode=${mode}`, { method: "POST", body: fd });
    return parseOrThrow(res, "Categories import failed");
}

export async function importIntelActionables(
    docId: string,
    file: File,
    mode: ImportMode = "upsert",
): Promise<ImportResult> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await intelFetch(
        `/documents/${encodeURIComponent(docId)}/actionables/import?mode=${mode}`,
        { method: "POST", body: fd },
    );
    return parseOrThrow(res, "Actionables import failed");
}

// ---------------------------------------------------------------------------
// Shared CSV / download utilities (used by multiple pages)
// ---------------------------------------------------------------------------
export function csvEscapeValue(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join("; ") : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export function buildCsv(headers: string[], rows: string[][]): string {
    const header = headers.map(csvEscapeValue).join(",");
    const body = rows.map((r) => r.map(csvEscapeValue).join(",")).join("\n");
    return "\uFEFF" + header + "\n" + body;
}

export function triggerCsvDownload(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
