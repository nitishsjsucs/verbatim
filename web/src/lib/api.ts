import {
    DocumentMeta,
    DocumentDetail,
    IngestResponse,
    QueryRequest,
    QueryResponse,
    FeedbackRequest,
    AppConfig,
    Corpus,
    CorpusQueryRequest,
    CorpusQueryResponse,
    ActionablesResult,
    Conversation,
    ConversationMeta,
    StorageStats,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

export async function fetchDocuments(): Promise<DocumentMeta[]> {
    const res = await fetch(`${API_BASE_URL}/documents`);
    if (!res.ok) throw new Error('Failed to fetch documents');
    return res.json();
}

export async function fetchDocument(id: string): Promise<DocumentDetail> {
    const res = await fetch(`${API_BASE_URL}/documents/${id}`);
    if (!res.ok) throw new Error('Failed to fetch document');
    return res.json();
}

export async function ingestDocument(file: File, force: boolean = false): Promise<IngestResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_BASE_URL}/ingest?force=${force}`, {
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
    const res = await fetch(`${API_BASE_URL}/query`, {
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
    const res = await fetch(`${API_BASE_URL}/query/${recordId}/feedback`, {
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
    const res = await fetch(`${API_BASE_URL}/config`);
    if (!res.ok) throw new Error('Failed to fetch config');
    return res.json();
}

// ---------------------------------------------------------------------------
// Corpus (Cross-Document) API
// ---------------------------------------------------------------------------

export async function fetchCorpus(): Promise<Corpus> {
    const res = await fetch(`${API_BASE_URL}/corpus`);
    if (!res.ok) throw new Error('Failed to fetch corpus');
    return res.json();
}

export async function runCorpusQuery(req: CorpusQueryRequest): Promise<CorpusQueryResponse> {
    const res = await fetch(`${API_BASE_URL}/corpus/query`, {
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
    const res = await fetch(`${API_BASE_URL}/documents/${docId}/actionables`);
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
    const res = await fetch(
        `${API_BASE_URL}/documents/${docId}/extract-actionables?force=${force}`,
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
// Conversation API
// ---------------------------------------------------------------------------

export async function fetchConversations(): Promise<ConversationMeta[]> {
    const res = await fetch(`${API_BASE_URL}/conversations`);
    if (!res.ok) throw new Error('Failed to fetch conversations');
    return res.json();
}

export async function fetchConversationsByDoc(docId: string): Promise<ConversationMeta[]> {
    const res = await fetch(`${API_BASE_URL}/conversations/by-doc/${docId}`);
    if (!res.ok) throw new Error('Failed to fetch conversations for document');
    return res.json();
}

export async function fetchConversation(convId: string): Promise<Conversation> {
    const res = await fetch(`${API_BASE_URL}/conversations/${convId}`);
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
    const res = await fetch(`${API_BASE_URL}/conversations?${params}`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    return res.json();
}

export async function deleteConversation(convId: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/conversations/${convId}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to delete conversation');
    }
}

export async function deleteAllConversations(): Promise<{ count: number }> {
    const res = await fetch(`${API_BASE_URL}/conversations`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete conversations');
    return res.json();
}

// ---------------------------------------------------------------------------
// Storage Stats API
// ---------------------------------------------------------------------------

export async function fetchStorageStats(): Promise<StorageStats> {
    const res = await fetch(`${API_BASE_URL}/storage/stats`);
    if (!res.ok) throw new Error('Failed to fetch storage stats');
    return res.json();
}

// ---------------------------------------------------------------------------
// Training Data Export API
// ---------------------------------------------------------------------------

export async function exportTrainingData(): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/export/training-data`);
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
