import {
    DocumentMeta,
    DocumentDetail,
    IngestResponse,
    QueryRequest,
    QueryResponse,
    FeedbackRequest,
    AppConfig,
    RetrievalMode,
    OptimizationFeatures,
    Corpus,
    CorpusQueryRequest,
    CorpusQueryResponse,
    ActionablesResult,
    ActionableItem,
    Conversation,
    ConversationMeta,
    StorageStats,
    AuditTrailEntry,
    Team,
} from './types';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api/backend";

/** Resolve an evidence file URL — handles relative paths by prepending API base. */
export function getEvidenceFileUrl(fileUrl: string | undefined): string {
    if (!fileUrl) return "";
    return fileUrl.startsWith("/") ? `${API_BASE_URL}${fileUrl}` : fileUrl;
}

function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            'ngrok-skip-browser-warning': '1',
            ...(options.headers || {}),
        },
    });
}

export async function fetchDocuments(): Promise<DocumentMeta[]> {
    const res = await apiFetch('/documents');
    if (!res.ok) throw new Error('Failed to fetch documents');
    return res.json();
}

export async function fetchDocument(id: string): Promise<DocumentDetail> {
    const res = await apiFetch(`/documents/${id}`);
    if (!res.ok) throw new Error('Failed to fetch document');
    return res.json();
}

export async function ingestDocument(file: File, force: boolean = false): Promise<IngestResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await apiFetch(`/ingest?force=${force}`, {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Ingestion failed');
    }
    return res.json();
}

export async function deleteEvidence(filename: string): Promise<void> {
    const encoded = encodeURIComponent(filename);
    const res = await apiFetch(`/evidence/files/${encoded}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        let error: { detail?: string } | undefined;
        try {
            error = await res.json();
        } catch {
            /* noop */
        }
        throw new Error(error?.detail || 'Failed to delete evidence');
    }
}

export async function runQuery(req: QueryRequest): Promise<QueryResponse> {
    const res = await apiFetch(`/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Query failed');
    }
    return res.json();
}

export async function submitFeedback(recordId: string, feedback: FeedbackRequest): Promise<void> {
    const res = await apiFetch(`/query/${recordId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedback),
    });
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to submit feedback');
    }
}

export async function fetchConfig(): Promise<AppConfig> {
    const res = await apiFetch(`/config`);
    if (!res.ok) throw new Error('Failed to fetch config');
    return res.json();
}

// ---------------------------------------------------------------------------
// Optimization Toggle API
// ---------------------------------------------------------------------------

export async function setRetrievalMode(mode: RetrievalMode): Promise<{ retrieval_mode: RetrievalMode }> {
    const res = await apiFetch(`/config/retrieval-mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
    });
    if (!res.ok) throw new Error('Failed to set retrieval mode');
    return res.json();
}

export async function setOptimizationFeatures(
    features: Partial<OptimizationFeatures>,
): Promise<{ updated: Partial<OptimizationFeatures>; retrieval_mode: RetrievalMode }> {
    const res = await apiFetch(`/config/optimization-features`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(features),
    });
    if (!res.ok) throw new Error('Failed to update optimization features');
    return res.json();
}

export async function fetchOptimizationStats(): Promise<Record<string, unknown>> {
    const res = await apiFetch(`/optimization/stats`);
    if (!res.ok) throw new Error('Failed to fetch optimization stats');
    return res.json();
}

// ---------------------------------------------------------------------------
// Corpus (Cross-Document) API
// ---------------------------------------------------------------------------

export async function fetchCorpus(): Promise<Corpus> {
    const res = await apiFetch(`/corpus`);
    if (!res.ok) throw new Error('Failed to fetch corpus');
    return res.json();
}

export async function runCorpusQuery(req: CorpusQueryRequest): Promise<CorpusQueryResponse> {
    const res = await apiFetch(`/corpus/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Corpus query failed');
    }
    return res.json();
}

// ---------------------------------------------------------------------------
// Actionables API
// ---------------------------------------------------------------------------

export async function fetchActionables(docId: string): Promise<ActionablesResult> {
    const res = await apiFetch(`/documents/${docId}/actionables`);
    if (!res.ok) throw new Error('Failed to fetch actionables');
    return res.json();
}

/**
 * SSE progress event from the extraction endpoint.
 */
export interface ExtractionProgressEvent {
    event: string;
    // prefilter_done
    candidate_count?: number;
    total_nodes?: number;
    // batches_planned
    total_batches?: number;
    // batch_start / batch_done
    batch?: number;
    sections?: string[];
    batch_actionables?: number;
    cumulative_actionables?: number;
    // validation_start
    total_actionables?: number;
    // validation_done
    validated?: number;
    flagged?: number;
    // complete
    result?: ActionablesResult;
    // error
    message?: string;
}

/**
 * Extract actionables via SSE streaming.
 * Calls `onProgress` for each event, returns the final ActionablesResult.
 */
export async function extractActionablesStreaming(
    docId: string,
    force: boolean = false,
    onProgress?: (event: ExtractionProgressEvent) => void,
): Promise<ActionablesResult> {
    const res = await apiFetch(
        `/documents/${docId}/extract-actionables?force=${force}`,
        { method: 'POST' },
    );

    if (!res.ok) {
        // Non-SSE error (e.g. 404)
        let detail = 'Actionable extraction failed';
        try {
            const err = await res.json();
            detail = err.detail || detail;
        } catch { /* ignore parse error */ }
        throw new Error(detail);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: ActionablesResult | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines: each event is "data: {...}\n\n"
        const parts = buffer.split('\n\n');
        // Keep the last (possibly incomplete) part in the buffer
        buffer = parts.pop() || '';

        for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6); // Remove "data: " prefix
            let parsed: ExtractionProgressEvent;
            try {
                parsed = JSON.parse(jsonStr);
            } catch {
                console.warn('Failed to parse SSE event:', jsonStr);
                continue;
            }
            if (parsed.event === 'complete' && parsed.result) {
                finalResult = parsed.result;
            }
            if (parsed.event === 'error') {
                throw new Error(parsed.message || 'Extraction failed');
            }
            onProgress?.(parsed);
        }
    }

    if (!finalResult) {
        throw new Error('Extraction stream ended without a complete result');
    }

    return finalResult;
}

/**
 * Legacy non-streaming extract (kept for backward compat, but calls streaming internally).
 */
export async function extractActionables(docId: string, force: boolean = false): Promise<ActionablesResult> {
    return extractActionablesStreaming(docId, force);
}

// ---------------------------------------------------------------------------
// Actionables CRUD API (standalone page)
// ---------------------------------------------------------------------------

export async function fetchAllActionables(): Promise<ActionablesResult[]> {
    const res = await apiFetch('/actionables');
    if (!res.ok) throw new Error('Failed to fetch all actionables');
    return res.json();
}

export async function updateActionable(
    docId: string,
    itemId: string,
    updates: Record<string, unknown>,
    forTeam?: string,
    callerRole?: string,
): Promise<ActionableItem> {
    const qs = new URLSearchParams();
    if (forTeam) qs.set('for_team', forTeam);
    if (callerRole) qs.set('caller_role', callerRole);
    const qstr = qs.toString();
    const url = `/documents/${docId}/actionables/${itemId}${qstr ? `?${qstr}` : ''}`;
    try {
        const res = await apiFetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}: ${res.statusText}` }));
            throw new Error(err.detail || 'Failed to update actionable');
        }
        return res.json();
    } catch (err) {
        console.error(`updateActionable failed for ${url}:`, err);
        throw err;
    }
}

export async function createManualActionable(
    docId: string,
    data: Record<string, unknown>,
): Promise<ActionableItem> {
    const res = await apiFetch(`/documents/${docId}/actionables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to create actionable');
    }
    return res.json();
}

export function getCsvTemplateUrl(docId: string): string {
    return `${API_BASE_URL}/documents/${docId}/actionables/csv-template`;
}

export async function bulkCreateActionables(
    docId: string,
    items: Record<string, unknown>[],
): Promise<{ created: number; items: ActionableItem[] }> {
    const res = await apiFetch(`/documents/${docId}/actionables/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to bulk create actionables');
    }
    return res.json();
}

export async function deleteActionable(docId: string, itemId: string): Promise<void> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to delete actionable');
    }
}

export async function uploadEvidence(file: File): Promise<{ filename: string; stored_name: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/evidence/upload`, {
        method: 'POST',
        headers: { 'ngrok-skip-browser-warning': '1' },
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to upload evidence');
    }
    return res.json();
}

export async function fetchApprovedByTeam(): Promise<Record<string, ActionableItem[]>> {
    const res = await apiFetch('/actionables/approved-by-team');
    if (!res.ok) throw new Error('Failed to fetch approved actionables');
    return res.json();
}

// ---------------------------------------------------------------------------
// Conversation API
// ---------------------------------------------------------------------------

export async function fetchConversations(): Promise<ConversationMeta[]> {
    const res = await apiFetch(`/conversations`);
    if (!res.ok) throw new Error('Failed to fetch conversations');
    return res.json();
}

export async function fetchConversationsByDoc(docId: string): Promise<ConversationMeta[]> {
    const res = await apiFetch(`/conversations/by-doc/${docId}`);
    if (!res.ok) throw new Error('Failed to fetch conversations for document');
    return res.json();
}

export async function fetchConversation(convId: string): Promise<Conversation> {
    const res = await apiFetch(`/conversations/${convId}`);
    if (!res.ok) throw new Error('Failed to fetch conversation');
    return res.json();
}

export async function createConversation(
    docId: string,
    docName: string = '',
    convType: string = 'document',
    title: string = '',
): Promise<Conversation> {
    const params = new URLSearchParams({ doc_id: docId, doc_name: docName, conv_type: convType, title });
    const res = await apiFetch(`/conversations?${params}`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    return res.json();
}

export async function deleteConversation(convId: string): Promise<void> {
    const res = await apiFetch(`/conversations/${convId}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to delete conversation');
    }
}

export async function deleteAllConversations(): Promise<{ count: number }> {
    const res = await apiFetch(`/conversations`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete conversations');
    return res.json();
}

// ---------------------------------------------------------------------------
// Storage Stats API
// ---------------------------------------------------------------------------

export async function fetchStorageStats(): Promise<StorageStats> {
    const res = await apiFetch(`/storage/stats`);
    if (!res.ok) throw new Error('Failed to fetch storage stats');
    return res.json();
}

// ---------------------------------------------------------------------------
// Delay Monitoring & Team Lead API
// ---------------------------------------------------------------------------

export async function checkDelays(): Promise<{ checked_at: string; newly_delayed: number }> {
    const res = await apiFetch('/actionables/check-delays', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to check delays');
    return res.json();
}

export async function fetchDelayedActionables(team?: string): Promise<ActionableItem[]> {
    const params = team ? `?team=${encodeURIComponent(team)}` : '';
    const res = await apiFetch(`/actionables/delayed${params}`);
    if (!res.ok) throw new Error('Failed to fetch delayed actionables');
    return res.json();
}

export async function submitJustification(
    docId: string,
    itemId: string,
    justification: string,
    justifierName: string,
    forTeam?: string,
): Promise<ActionableItem> {
    const teamQuery = forTeam ? `?for_team=${encodeURIComponent(forTeam)}` : '';
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}/justification${teamQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justification, justifier_name: justifierName }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to submit justification');
    }
    return res.json();
}

export async function fetchAuditTrail(
    docId: string,
    itemId: string,
): Promise<{ item_id: string; doc_id: string; audit_trail: AuditTrailEntry[] }> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}/audit-trail`);
    if (!res.ok) throw new Error('Failed to fetch audit trail');
    return res.json();
}

// ---------------------------------------------------------------------------
// Training Data Export API
// ---------------------------------------------------------------------------

export async function exportTrainingData(): Promise<void> {
    const res = await apiFetch(`/export/training-data`);
    if (!res.ok) throw new Error('Failed to export training data');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // Extract filename from Content-Disposition header or generate one
    const disposition = res.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch?.[1] || `govinda_training_data_${new Date().toISOString().slice(0, 10)}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Team Chat API
// ---------------------------------------------------------------------------

export interface TeamChatMessage {
    id: string;
    author: string;
    role: string;
    text: string;
    timestamp: string;
}

export async function fetchTeamChatMessages(
    team: string,
    channel: 'internal' | 'compliance',
): Promise<{ team: string; channel: string; messages: TeamChatMessage[] }> {
    const res = await apiFetch(`/team-chat/${encodeURIComponent(team)}/${channel}`);
    if (!res.ok) throw new Error('Failed to fetch team chat');
    return res.json();
}

export async function postTeamChatMessage(
    team: string,
    channel: 'internal' | 'compliance',
    author: string,
    role: string,
    text: string,
): Promise<TeamChatMessage> {
    const res = await apiFetch(`/team-chat/${encodeURIComponent(team)}/${channel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, role, text }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to post message');
    }
    return res.json();
}

// ---------------------------------------------------------------------------
// Global Chat API (standalone module – separate from team-chat & actionables)
// ---------------------------------------------------------------------------

export interface ChatChannel {
    channel: string;
    label: string;
    type: 'team_internal' | 'team_compliance' | 'compliance_internal';
    unread: number;
    has_custom_name?: boolean;
}

export interface ChatMessage {
    id: string;
    author: string;
    role: string;
    team: string;
    text: string;
    timestamp: string;
}

export async function fetchChatChannels(
    role: string,
    team: string,
): Promise<{ channels: ChatChannel[] }> {
    const params = new URLSearchParams({ role, team });
    const res = await apiFetch(`/chat/channels?${params}`);
    if (!res.ok) throw new Error('Failed to fetch chat channels');
    return res.json();
}

export async function fetchChatMessages(
    channel: string,
    role: string,
    team: string,
): Promise<{ channel: string; messages: ChatMessage[] }> {
    const params = new URLSearchParams({ role, team });
    const res = await apiFetch(`/chat/messages/${encodeURIComponent(channel)}?${params}`);
    if (!res.ok) throw new Error('Failed to fetch chat messages');
    return res.json();
}

export async function postChatMessage(
    channel: string,
    author: string,
    role: string,
    team: string,
    text: string,
): Promise<ChatMessage> {
    const res = await apiFetch(`/chat/messages/${encodeURIComponent(channel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, role, team, text }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to post message');
    }
    return res.json();
}

export async function markChatRead(
    channel: string,
    role: string,
    team: string,
): Promise<void> {
    const params = new URLSearchParams({ role, team });
    await apiFetch(`/chat/mark-read/${encodeURIComponent(channel)}?${params}`, {
        method: 'POST',
    });
}

export async function fetchChatUnreadTotal(
    role: string,
    team: string,
): Promise<{ unread: number }> {
    const params = new URLSearchParams({ role, team });
    const res = await apiFetch(`/chat/unread-total?${params}`);
    if (!res.ok) return { unread: 0 };
    return res.json();
}

export async function renameChatChannel(
    channel: string,
    customName: string,
    role: string,
    team: string,
): Promise<void> {
    const params = new URLSearchParams({ role, team });
    const res = await apiFetch(`/chat/rename/${encodeURIComponent(channel)}?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_name: customName }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to rename channel' }));
        throw new Error(err.detail || 'Failed to rename channel');
    }
}

// ---------------------------------------------------------------------------
// Admin Dashboard API
// ---------------------------------------------------------------------------

export async function adminLogin(username: string, password: string): Promise<{ authenticated: boolean; token: string; username: string }> {
    const res = await apiFetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Invalid credentials' }));
        throw new Error(err.detail || 'Invalid credentials');
    }
    return res.json();
}

export async function fetchAdminOverview(): Promise<Record<string, unknown>> {
    const res = await apiFetch('/admin/overview');
    if (!res.ok) throw new Error('Failed to fetch admin overview');
    return res.json();
}

export async function fetchAdminQueries(params: {
    skip?: number;
    limit?: number;
    doc_id?: string;
    sort_by?: string;
    sort_order?: number;
} = {}): Promise<{ total: number; skip: number; limit: number; records: Record<string, unknown>[] }> {
    const searchParams = new URLSearchParams();
    if (params.skip !== undefined) searchParams.set('skip', String(params.skip));
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.doc_id) searchParams.set('doc_id', params.doc_id);
    if (params.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params.sort_order !== undefined) searchParams.set('sort_order', String(params.sort_order));
    const res = await apiFetch(`/admin/queries?${searchParams}`);
    if (!res.ok) throw new Error('Failed to fetch admin queries');
    return res.json();
}

export async function fetchAdminQueryFull(recordId: string): Promise<Record<string, unknown>> {
    const res = await apiFetch(`/admin/query/${recordId}/full`);
    if (!res.ok) throw new Error('Failed to fetch query details');
    return res.json();
}

export async function fetchAdminBenchmarks(lastN: number = 100): Promise<Record<string, unknown>> {
    const res = await apiFetch(`/admin/benchmarks?last_n=${lastN}`);
    if (!res.ok) throw new Error('Failed to fetch benchmarks');
    return res.json();
}

export async function fetchAdminMemoryDetailed(): Promise<Record<string, unknown>> {
    const res = await apiFetch('/admin/memory/detailed');
    if (!res.ok) throw new Error('Failed to fetch memory details');
    return res.json();
}

export async function fetchAdminSystemLogs(lines: number = 200): Promise<{ total_lines: number; entries: string[] }> {
    const res = await apiFetch(`/admin/system/logs?lines=${lines}`);
    if (!res.ok) throw new Error('Failed to fetch system logs');
    return res.json();
}

export async function fetchAdminRuntimeConfig(): Promise<Record<string, unknown>> {
    const res = await apiFetch('/admin/runtime-config');
    if (!res.ok) throw new Error('Failed to fetch runtime config');
    return res.json();
}

// ---------------------------------------------------------------------------
// Dynamic Teams API
// ---------------------------------------------------------------------------

export async function fetchTeams(): Promise<Team[]> {
    const res = await apiFetch('/teams');
    if (!res.ok) throw new Error('Failed to fetch teams');
    const data = await res.json();
    return data.teams || [];
}

export async function createTeam(name: string, color?: string, summary?: string, parent_name?: string | null): Promise<Team> {
    const res = await apiFetch('/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: color || undefined, summary: summary || "", parent_name: parent_name || null }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to create team');
    }
    return res.json();
}

export async function fetchTeamTree(): Promise<Team[]> {
    const res = await apiFetch('/teams/tree');
    if (!res.ok) throw new Error('Failed to fetch team tree');
    const data = await res.json();
    return data.tree || [];
}

export async function fetchTeamDescendants(teamName: string): Promise<string[]> {
    const res = await apiFetch(`/teams/${encodeURIComponent(teamName)}/descendants`);
    if (!res.ok) throw new Error('Failed to fetch team descendants');
    const data = await res.json();
    return data.descendants || [];
}

// LLM Benchmark API
// ---------------------------------------------------------------------------

export async function fetchLLMBenchmarkModels(): Promise<{
    models: Array<{ id: string; provider: string; label: string }>;
    benchmark_models: Array<{ id: string; label: string; tier: string; speed: string; reasoning: string }>;
    stages: Array<{ id: string; label: string; default_model: string }>;
    test_questions: Array<{ id: string; query: string; expected_type: string; complexity: string }>;
    pricing: Record<string, { input: number; output: number }>;
}> {
    const res = await apiFetch('/admin/llm-benchmark/models');
    if (!res.ok) throw new Error('Failed to fetch benchmark models');
    return res.json();
}

export async function runLLMBenchmark(params: {
    stages?: string[];
    models?: string[];
    question_ids?: string[];
}): Promise<Record<string, unknown>> {
    const res = await apiFetch('/admin/llm-benchmark/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            stages: params.stages || [],
            models: params.models || [],
            question_ids: params.question_ids || [],
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Benchmark failed' }));
        throw new Error(err.detail || 'Benchmark run failed');
    }
    return res.json();
}

export async function updateTeam(teamName: string, updates: { name?: string; color?: string; summary?: string }): Promise<Team> {
    const res = await apiFetch(`/teams/${encodeURIComponent(teamName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to update team');
    }
    return res.json();
}

export async function deleteTeam(teamName: string): Promise<void> {
    const res = await apiFetch(`/teams/${encodeURIComponent(teamName)}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to delete team');
    }
}

export async function seedDefaultTeams(): Promise<{ seeded: string[]; total_teams: number }> {
    const res = await apiFetch('/teams/seed-defaults', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to seed default teams');
    return res.json();
}

export async function runTournamentBattle(params: {
    stage: string;
    question_id: string;
    models?: string[];
}): Promise<Record<string, unknown>> {
    const res = await apiFetch('/admin/llm-benchmark/tournament-battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            stage: params.stage,
            question_id: params.question_id,
            models: params.models || [],
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Tournament battle failed' }));
        throw new Error(err.detail || 'Tournament battle failed');
    }
    return res.json();
}

export async function fetchLLMBenchmarkResults(limit: number = 20): Promise<{ runs: Array<Record<string, unknown>> }> {
    const res = await apiFetch(`/admin/llm-benchmark/results?limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch benchmark results');
    return res.json();
}

export async function fetchLLMBenchmarkLatest(): Promise<Record<string, unknown>> {
    const res = await apiFetch('/admin/llm-benchmark/latest');
    if (!res.ok) throw new Error('Failed to fetch latest benchmark');
    return res.json();
}

// ---------------------------------------------------------------------------
// User Management API (Next.js API route — /api/users)
// ---------------------------------------------------------------------------

export interface AppUser {
    id?: string;
    name: string;
    email: string;
    role: string;
    team: string;
    start_date?: string;
    createdAt?: string;
}

export async function fetchUsers(): Promise<AppUser[]> {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Failed to fetch users');
    const data = await res.json();
    return data.users || [];
}

export async function createUser(body: { name: string; role: string; team: string; start_date?: string }): Promise<{ user: AppUser; generated_email: string; default_password: string }> {
    const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create user');
    }
    return res.json();
}

export async function updateUser(body: { email: string; name?: string; role?: string; team?: string; start_date?: string }): Promise<{ user: AppUser }> {
    const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update user');
    }
    return res.json();
}

export async function deleteUser(email: string): Promise<void> {
    const res = await fetch(`/api/users?email=${encodeURIComponent(email)}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete user');
    }
}

// Memory Health API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Regulator & Document Metadata API
// ---------------------------------------------------------------------------

export async function fetchRegulators(): Promise<string[]> {
    const res = await apiFetch('/regulators');
    if (!res.ok) throw new Error('Failed to fetch regulators');
    const data = await res.json();
    return data.regulators || [];
}

export async function updateDocumentMetadata(
    docId: string,
    metadata: { regulation_issue_date?: string; circular_effective_date?: string; regulator?: string; global_theme?: string; global_likelihood_owner_team?: string },
): Promise<Record<string, unknown>> {
    const res = await apiFetch(`/documents/${docId}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to update document metadata');
    }
    return res.json();
}

// ---------------------------------------------------------------------------
// Tagged Incorrectly — Bypass Flow API
// ---------------------------------------------------------------------------

export async function tagIncorrectly(
    docId: string,
    itemId: string,
    taggedBy: string,
): Promise<ActionableItem> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}/bypass-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagged_by: taggedBy }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to tag as incorrectly assigned');
    }
    return res.json();
}

export async function approveBypass(
    docId: string,
    itemId: string,
    approvedBy: string,
): Promise<ActionableItem> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}/bypass-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: approvedBy }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to approve bypass');
    }
    return res.json();
}

export async function resetTeam(
    docId: string,
    itemId: string,
    resetBy: string,
    newTeam?: string,
): Promise<ActionableItem> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}/reset-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_by: resetBy, new_team: newTeam || '' }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to reset team');
    }
    return res.json();
}

// ---------------------------------------------------------------------------
// Memory Health API
// ---------------------------------------------------------------------------

export async function fetchMemoryHealth(): Promise<Record<string, unknown>> {
    const res = await apiFetch('/admin/memory/health');
    if (!res.ok) throw new Error('Failed to fetch memory health');
    return res.json();
}

export async function fetchMemoryDiagnostics(docId?: string): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (docId) params.set('doc_id', docId);
    const res = await apiFetch(`/admin/memory/diagnostics?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch memory diagnostics');
    return res.json();
}

export async function fetchMemoryTrends(docId?: string, lastN = 50): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (docId) params.set('doc_id', docId);
    params.set('last_n', String(lastN));
    const res = await apiFetch(`/admin/memory/diagnostics/trends?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch memory trends');
    return res.json();
}

export async function fetchMemoryRecentContributions(docId?: string, limit = 20): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (docId) params.set('doc_id', docId);
    params.set('limit', String(limit));
    const res = await apiFetch(`/admin/memory/diagnostics/recent?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch recent contributions');
    return res.json();
}

// ─── Residual Risk Interpretation Matrix ──────────────────────────────────────

export interface RiskMatrixEntry {
    id: string;
    label: string;
    min_score: number;
    max_score: number;
}

export async function fetchRiskMatrix(): Promise<RiskMatrixEntry[]> {
    const res = await apiFetch('/risk-matrix');
    if (!res.ok) throw new Error('Failed to fetch risk matrix');
    const data = await res.json();
    return data.entries ?? [];
}

export async function createRiskMatrixEntry(entry: Omit<RiskMatrixEntry, 'id'>): Promise<RiskMatrixEntry> {
    const res = await apiFetch('/risk-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error('Failed to create risk matrix entry');
    return res.json();
}

export async function updateRiskMatrixEntry(id: string, updates: Partial<RiskMatrixEntry>): Promise<RiskMatrixEntry> {
    const res = await apiFetch(`/risk-matrix/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update risk matrix entry');
    return res.json();
}

export async function deleteRiskMatrixEntry(id: string): Promise<void> {
    const res = await apiFetch(`/risk-matrix/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete risk matrix entry');
}

// ─── Admin: Risk Fields Migration ─────────────────────────────────────────────

export async function migrateRiskFields(): Promise<{ status: string; total_actionables: number; migrated: number; message: string }> {
    const res = await apiFetch('/admin/migrate-risk-fields', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to migrate risk fields');
    return res.json();
}

// ─── Document-Level Likelihood API ───────────────────────────────────────────

export async function getDocumentLikelihood(docId: string): Promise<Record<string, unknown>> {
    const res = await apiFetch(`/documents/${docId}/likelihood`);
    if (!res.ok) throw new Error('Failed to fetch document likelihood');
    return res.json();
}

export async function setDocumentLikelihood(
    docId: string,
    body: {
        breakdown: Record<string, { label: string; score: number }>;
        caller_role: string;
        caller_team: string;
        caller_name: string;
        auto_propagate?: boolean;
    },
): Promise<Record<string, unknown>> {
    const res = await apiFetch(`/documents/${docId}/likelihood`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to set document likelihood' }));
        throw new Error(err.detail || 'Failed to set document likelihood');
    }
    return res.json();
}

export async function propagateDocumentLikelihood(
    docId: string,
    body?: { caller_role?: string; caller_team?: string },
): Promise<Record<string, unknown>> {
    const res = await apiFetch(`/documents/${docId}/likelihood/propagate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to propagate likelihood' }));
        throw new Error(err.detail || 'Failed to propagate likelihood');
    }
    return res.json();
}

export async function setDocumentLikelihoodOwnerTeam(
    docId: string,
    ownerTeam: string,
    callerRole: string,
): Promise<Record<string, unknown>> {
    const res = await apiFetch(`/documents/${docId}/likelihood/owner-team`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_team: ownerTeam, caller_role: callerRole }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to set owner team' }));
        throw new Error(err.detail || 'Failed to set owner team');
    }
    return res.json();
}

// ─── Risk Engine Config API ──────────────────────────────────────────────────

export async function fetchRiskEngineConfig(): Promise<Record<string, unknown>> {
    const res = await apiFetch('/risk-engine-config');
    if (!res.ok) throw new Error('Failed to fetch risk engine config');
    return res.json();
}

export async function updateRiskEngineConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await apiFetch('/risk-engine-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error('Failed to update risk engine config');
    return res.json();
}

// ─── Risk Parameter Selections API ───────────────────────────────────────────

export async function fetchRiskParameterSelections(): Promise<Record<string, unknown>> {
    const res = await apiFetch('/risk-parameter-selections');
    if (!res.ok) throw new Error('Failed to fetch risk parameter selections');
    return res.json();
}

export async function updateRiskParameterSelections(selections: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await apiFetch('/risk-parameter-selections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selections),
    });
    if (!res.ok) throw new Error('Failed to update risk parameter selections');
    return res.json();
}

// ─── Notifications API ──────────────────────────────────────────────────────

export async function fetchNotifications(userId: string, limit = 50): Promise<{ notifications: Notification[] }> {
    const res = await apiFetch(`/notifications?user_id=${encodeURIComponent(userId)}&limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch notifications');
    return res.json();
}

export async function createNotification(data: { user_id: string; actionable_id?: string; doc_id?: string; type: string; message: string }): Promise<Notification> {
    const res = await apiFetch('/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create notification');
    return res.json();
}

export async function markNotificationRead(notificationId: string): Promise<void> {
    await apiFetch(`/notifications/${notificationId}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
    await apiFetch('/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
    });
}

export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
    const res = await apiFetch(`/notifications/unread-count?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) return 0;
    const data = await res.json();
    return data.unread ?? 0;
}

export async function clearAllNotifications(userId: string): Promise<{ deleted: number }> {
    const res = await apiFetch(`/notifications/clear?user_id=${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear notifications');
    return res.json();
}

// ─── Delegation Stats API ────────────────────────────────────────────────────

export interface DelegationStats {
    sent: { total: number; accepted: number; rejected: number; pending: number };
    received: { total: number; accepted: number; rejected: number; pending: number };
}

export async function fetchDelegationStats(accountId: string): Promise<DelegationStats> {
    const res = await apiFetch(`/delegation-stats?account_id=${encodeURIComponent(accountId)}`);
    if (!res.ok) throw new Error('Failed to fetch delegation stats');
    return res.json();
}

// ─── Delegation API ─────────────────────────────────────────────────────────

export interface DelegationRequest {
    id: string;
    actionable_id: string;
    doc_id: string;
    from_account_id: string;
    to_account_id: string;
    from_name: string;
    to_name: string;
    status: "pending" | "accepted" | "rejected";
    created_at: string;
    resolved_at: string;
}

export async function fetchDelegationRequests(accountId: string, direction: "incoming" | "outgoing" | "all" = "incoming"): Promise<{ requests: DelegationRequest[] }> {
    const res = await apiFetch(`/delegation-requests?account_id=${encodeURIComponent(accountId)}&direction=${direction}`);
    if (!res.ok) throw new Error('Failed to fetch delegation requests');
    return res.json();
}

export async function createDelegationRequest(data: {
    actionable_id: string;
    actionable_title?: string;
    doc_id: string;
    from_account_id: string;
    to_account_id: string;
    from_name: string;
    to_name: string;
}): Promise<DelegationRequest> {
    const res = await apiFetch('/delegation-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to create delegation request' }));
        throw new Error(err.detail || 'Failed to create delegation request');
    }
    return res.json();
}

export async function acceptDelegationRequest(requestId: string): Promise<void> {
    const res = await apiFetch(`/delegation-requests/${requestId}/accept`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to accept delegation');
}

export async function rejectDelegationRequest(requestId: string): Promise<void> {
    const res = await apiFetch(`/delegation-requests/${requestId}/reject`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reject delegation');
}

export async function revertDelegationRequest(requestId: string): Promise<void> {
    const res = await apiFetch(`/delegation-requests/${requestId}/revert`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to revert delegation' }));
        throw new Error(err.detail || 'Failed to revert delegation');
    }
}

export async function regenerateDelegationNotifications(accountId: string): Promise<{ regenerated: number }> {
    const res = await apiFetch(`/delegation-requests/regenerate-notifications?account_id=${accountId}`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to regenerate notifications');
    return res.json();
}

export async function cleanupActionableState(docId: string, actionableId: string): Promise<{ delegation_requests_deleted: number; notifications_deleted: number }> {
    const res = await apiFetch(`/actionables/${docId}/${actionableId}/cleanup-state`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to cleanup actionable state');
    return res.json();
}

// ─── Compliance Officers API ────────────────────────────────────────────────

export interface ComplianceOfficer {
    id: string;
    name: string;
    email: string;
}

export async function fetchComplianceOfficers(): Promise<{ officers: ComplianceOfficer[] }> {
    const res = await apiFetch('/compliance-officers');
    if (!res.ok) throw new Error('Failed to fetch compliance officers');
    return res.json();
}

// ─── Notification type ──────────────────────────────────────────────────────

export interface Notification {
    id: string;
    user_id: string;
    actionable_id?: string;
    doc_id?: string;
    delegation_request_id?: string;
    type: string;
    message: string;
    is_read: boolean;
    created_at: string;
}
