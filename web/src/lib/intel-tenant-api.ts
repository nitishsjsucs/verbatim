/**
 * API client for the multi-tenant intelligence system (/intel/*).
 * All calls include the intel JWT token.
 */

import { intelAuthFetch } from "./intel-auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantDocument {
    doc_id: string;
    doc_name: string;
    pages: number;
    nodes: number;
    tags: string[];
    has_run: boolean;
}

export interface TenantActionablesResponse {
    doc_id: string;
    doc_name?: string;
    actionables: Record<string, unknown>[];
    notice_board: Record<string, unknown>[];
    stats?: Record<string, unknown>;
    created_at?: string;
}

export interface AdditionalEntry {
    entry_id: string;
    doc_id: string;
    title: string;
    date: string;
    description: string;
    notes: string;
    actionables: Record<string, unknown>[];
    created_at: string;
    created_by: string;
}

export interface ClientRequestItem {
    request_id: string;
    request_type: "document" | "team";
    client_id: string;
    client_username: string;
    status: "pending" | "approved" | "rejected" | "archived";
    file_name: string;
    request_notes: string;
    team_name: string;
    team_description: string;
    admin_notes: string;
    resolved_by: string;
    resolved_at: string;
    created_at: string;
}

export interface InstitutionTag {
    name: string;
    description: string;
}

export interface ClientAccountInfo {
    account_id: string;
    username: string;
    email: string;
    display_name: string;
    institution_type: string;
    institution_tags: string[];
    is_active: boolean;
    created_at: string;
    last_login: string;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
    if (!res.ok) {
        let msg = fallback;
        try {
            const body = await res.json();
            msg = body?.detail || msg;
        } catch { /* noop */ }
        throw new Error(msg);
    }
    return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Documents (tag-filtered)
// ---------------------------------------------------------------------------

export async function listTenantDocuments(): Promise<TenantDocument[]> {
    const res = await intelAuthFetch("/intel/documents");
    return parseOrThrow(res, "Failed to list documents");
}

export async function getDocumentActionables(docId: string): Promise<TenantActionablesResponse> {
    const res = await intelAuthFetch(`/intel/documents/${encodeURIComponent(docId)}/actionables`);
    return parseOrThrow(res, "Failed to fetch actionables");
}

// ---------------------------------------------------------------------------
// Document tags
// ---------------------------------------------------------------------------

export async function getDocTags(docId: string): Promise<string[]> {
    const res = await intelAuthFetch(`/intel/documents/${encodeURIComponent(docId)}/tags`);
    const data = await parseOrThrow<{ tags: string[] }>(res, "Failed to fetch tags");
    return data.tags;
}

export async function setDocTags(docId: string, tags: string[]): Promise<void> {
    await intelAuthFetch(`/intel/documents/${encodeURIComponent(docId)}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
    });
}

// ---------------------------------------------------------------------------
// Additionals
// ---------------------------------------------------------------------------

export async function listAdditionals(docId: string): Promise<AdditionalEntry[]> {
    const res = await intelAuthFetch(`/intel/documents/${encodeURIComponent(docId)}/additionals`);
    return parseOrThrow(res, "Failed to list additionals");
}

export async function createAdditional(
    docId: string,
    data: { title: string; date?: string; description?: string; notes?: string; actionables?: Record<string, unknown>[] },
): Promise<AdditionalEntry> {
    const res = await intelAuthFetch(`/intel/documents/${encodeURIComponent(docId)}/additionals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    return parseOrThrow(res, "Failed to create additional");
}

export async function updateAdditional(
    entryId: string,
    data: Partial<{ title: string; date: string; description: string; notes: string; actionables: Record<string, unknown>[] }>,
): Promise<AdditionalEntry> {
    const res = await intelAuthFetch(`/intel/additionals/${encodeURIComponent(entryId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    return parseOrThrow(res, "Failed to update additional");
}

export async function deleteAdditional(entryId: string): Promise<void> {
    await intelAuthFetch(`/intel/additionals/${encodeURIComponent(entryId)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Client Requests
// ---------------------------------------------------------------------------

export async function submitDocumentRequest(notes: string, file?: File): Promise<{ request_id: string }> {
    const fd = new FormData();
    fd.append("notes", notes);
    if (file) fd.append("file", file);
    const res = await intelAuthFetch("/intel/requests/document", { method: "POST", body: fd });
    return parseOrThrow(res, "Failed to submit document request");
}

export async function submitTeamRequest(teamName: string, description: string): Promise<{ request_id: string }> {
    const res = await intelAuthFetch("/intel/requests/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_name: teamName, description }),
    });
    return parseOrThrow(res, "Failed to submit team request");
}

export async function listMyRequests(): Promise<ClientRequestItem[]> {
    const res = await intelAuthFetch("/intel/requests/mine");
    return parseOrThrow(res, "Failed to list requests");
}

// Admin
export async function listAllRequests(status?: string, requestType?: string): Promise<ClientRequestItem[]> {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (requestType) params.set("request_type", requestType);
    const res = await intelAuthFetch(`/intel/requests?${params.toString()}`);
    return parseOrThrow(res, "Failed to list requests");
}

export async function resolveRequest(requestId: string, status: "approved" | "rejected" | "archived", notes?: string): Promise<void> {
    await intelAuthFetch(`/intel/requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes: notes || "" }),
    });
}

// ---------------------------------------------------------------------------
// Institution Tags Registry
// ---------------------------------------------------------------------------

export async function listInstitutionTags(): Promise<InstitutionTag[]> {
    const res = await intelAuthFetch("/intel/tags");
    return parseOrThrow(res, "Failed to list tags");
}

export async function createInstitutionTag(name: string, description?: string): Promise<void> {
    await intelAuthFetch("/intel/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || "" }),
    });
}

export async function deleteInstitutionTag(name: string): Promise<void> {
    await intelAuthFetch(`/intel/tags/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Client Management (admin)
// ---------------------------------------------------------------------------

export async function listClients(): Promise<ClientAccountInfo[]> {
    const res = await intelAuthFetch("/intel-auth/clients");
    return parseOrThrow(res, "Failed to list clients");
}

export async function getClient(accountId: string): Promise<ClientAccountInfo> {
    const res = await intelAuthFetch(`/intel-auth/clients/${encodeURIComponent(accountId)}`);
    return parseOrThrow(res, "Failed to get client");
}

export async function createClient(data: {
    username: string;
    password: string;
    display_name?: string;
    email?: string;
    institution_type?: string;
    institution_tags?: string[];
}): Promise<{ account_id: string }> {
    const res = await intelAuthFetch("/intel-auth/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    return parseOrThrow(res, "Failed to create client");
}

export async function updateClient(accountId: string, data: Partial<{
    display_name: string;
    email: string;
    institution_type: string;
    institution_tags: string[];
    is_active: boolean;
}>): Promise<void> {
    await intelAuthFetch(`/intel-auth/clients/${encodeURIComponent(accountId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
}

export async function setClientPassword(accountId: string, newPassword: string): Promise<void> {
    await intelAuthFetch(`/intel-auth/clients/${encodeURIComponent(accountId)}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: newPassword }),
    });
}

export async function deleteClient(accountId: string): Promise<void> {
    await intelAuthFetch(`/intel-auth/clients/${encodeURIComponent(accountId)}`, { method: "DELETE" });
}
