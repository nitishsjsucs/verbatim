/**
 * Client helpers for talking to govinda's qwerty_mode Python backend.
 *
 * Live data (files list, messages) is read directly from Convex via
 * react hooks. This file only handles ingest + query, which run on the
 * Python side.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/backend";

function qwertyFetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            "ngrok-skip-browser-warning": "1",
            ...(options.headers || {}),
        },
    });
}

export interface QwertyIngestResult {
    file_id: string;
    filename: string;
    r2_key: string;
    page_count: number;
    chunk_count: number;
    size_bytes: number;
}

export interface QwertyCitation {
    citation_id: string;
    chunk_id: string;
    file_id: string;
    filename: string;
    page_start: number;
    page_end: number;
    excerpt: string;
    score: number;
}

export interface QwertyAnswer {
    text: string;
    citations: QwertyCitation[];
    matches_considered: number;
}

export async function qwertyIngest(file: File): Promise<QwertyIngestResult> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await qwertyFetch("/qwerty/ingest", { method: "POST", body: fd });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ingest failed (${res.status})`);
    }
    return res.json();
}

export async function qwertyQuery(question: string, fileIds?: string[]): Promise<QwertyAnswer> {
    const res = await qwertyFetch("/qwerty/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, file_ids: fileIds }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Query failed (${res.status})`);
    }
    return res.json();
}

export async function qwertyFileUrl(fileId: string, filename: string): Promise<string> {
    const res = await qwertyFetch(
        `/qwerty/files/${fileId}/download?filename=${encodeURIComponent(filename)}`,
    );
    if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
}
