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
type ExtractJobResponse =
    | { status: "idle" }
    | {
          status: "running";
          stage?: string;
          stage_progress?: { current: number; total: number };
          actionables_so_far?: number;
          started_at?: string;
          heartbeat_at?: string;
      }
    | {
          status: "done";
          run?: IntelRunPayload | null;
          count?: number;
          started_at?: string;
          finished_at?: string;
      }
    | {
          status: "error";
          error: string;
          trace?: string;
          started_at?: string;
          finished_at?: string;
      };

async function parseJobOrThrow(res: Response, fallback: string): Promise<ExtractJobResponse> {
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
    return res.json() as Promise<ExtractJobResponse>;
}

/**
 * Kicks off the full AIS extraction pipeline and waits for it to complete
 * by polling the status endpoint every few seconds.
 *
 * The initial POST returns immediately (well under ngrok's ~5min connection
 * timeout), then we poll. This is the only way to run a >5min job through
 * ngrok's free tier without the browser reporting a CORS error when the
 * tunnel severs the connection.
 */
export async function extractIntelligence(
    docId: string,
    force = false,
): Promise<IntelRunPayload> {
    // 1. Start the job.
    const startRes = await intelFetch(
        `/documents/${encodeURIComponent(docId)}/extract?force=${force}`,
        { method: "POST" },
    );
    const started = await parseJobOrThrow(startRes, "Failed to start extraction");

    if (started.status === "done" && started.run) {
        return started.run;
    }
    if (started.status === "error") {
        throw new Error(started.error || "Extraction failed");
    }

    // 2. Poll the status endpoint until the job finishes or errors out.
    // No client-side timeout — extraction can take many hours on very large
    // PDFs with massive batch counts. The backend remains the source of truth;
    // the user can navigate away and the job continues in the background.
    // Tolerates transient network/proxy hiccups via consecutive-failure tracking.
    const pollIntervalMs = 5000;
    const MAX_CONSECUTIVE_FAILURES = 60; // ~5 minutes of continuous failures
    let consecutiveFailures = 0;
    while (true) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        let state: ExtractJobResponse;
        try {
            const res = await intelFetch(
                `/documents/${encodeURIComponent(docId)}/extract/status`,
            );
            state = await parseJobOrThrow(res, "Failed to poll extraction status");
            consecutiveFailures = 0; // reset on success
        } catch (err) {
            // Transient network hiccup — log and keep polling. Only abort if
            // we've had many consecutive failures (sustained backend outage).
            consecutiveFailures += 1;
            console.warn(
                `[intelligence] poll hiccup (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
                err,
            );
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                throw new Error(
                    "Lost connection to extraction backend. The job may still be running on the server — refresh to check status.",
                );
            }
            continue;
        }
        if (state.status === "done") {
            if (state.run) return state.run;
            // Defensive fetch in case the worker finished but didn't include
            // the run payload (e.g. backend restarted mid-job).
            const runRes = await intelFetch(`/documents/${encodeURIComponent(docId)}`);
            return parseOrThrow<IntelRunPayload>(runRes, "Failed to fetch run");
        }
        if (state.status === "error") {
            throw new Error(state.error || "Extraction failed");
        }
        // status === "running" | "idle" — keep polling.
    }
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
