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
    DelayChatMessage,
    AuditTrailEntry,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

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
): Promise<ActionableItem> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to update actionable');
    }
    return res.json();
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

export async function submitDelayJustification(
    docId: string,
    itemId: string,
    justification: string,
    justifierName: string,
): Promise<ActionableItem> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}/delay-justification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justification, justifier_name: justifierName }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to submit delay justification');
    }
    return res.json();
}

export async function postDelayChatMessage(
    docId: string,
    itemId: string,
    author: string,
    role: string,
    text: string,
    team?: string,
): Promise<DelayChatMessage> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}/delay-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, role, team: team || '', text }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to post delay chat message');
    }
    return res.json();
}

export async function fetchDelayChatMessages(
    docId: string,
    itemId: string,
): Promise<{ item_id: string; doc_id: string; messages: DelayChatMessage[] }> {
    const res = await apiFetch(`/documents/${docId}/actionables/${itemId}/delay-chat`);
    if (!res.ok) throw new Error('Failed to fetch delay chat');
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

