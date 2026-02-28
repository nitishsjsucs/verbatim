
export interface DocumentMeta {
    id: string;
    name: string;
    pages: number;
    nodes: number;
    description?: string;
    ingested_at?: string;  // ISO datetime of when document was ingested
    has_actionables?: boolean;  // true if actionables already extracted
}

export interface IngestResponse {
    doc_id: string;
    doc_name: string;
    doc_description: string;
    node_count: number;
    total_pages: number;
    time_seconds: number;
}

export interface Citation {
    citation_id: string;
    node_id: string;
    title: string;
    page_range: string;
    excerpt: string;
}

export interface InferredPoint {
    point: string;
    supporting_definitions: string[];
    supporting_sections: string[];
    reasoning: string;
    confidence: "high" | "medium" | "low";
}

export interface RetrievedSection {
    node_id: string;
    title: string;
    text: string;
    page_range: string;
    source: string;
    token_count: number;
}

export interface RoutingLog {
    query_text: string;
    query_type: string;
    locate_results: Record<string, unknown>[];
    read_results: Record<string, unknown>[];
    cross_ref_follows: Record<string, unknown>[];
    total_nodes_located: number;
    total_sections_read: number;
    total_tokens_retrieved: number;
    stage_timings: Record<string, number>;
}

export type QueryType = "single_hop" | "multi_hop" | "global" | "definitional";

export interface QueryResponse {
    answer: string;
    record_id: string;
    conv_id: string;
    citations: Citation[];
    verification_status: string;
    verification_notes: string;
    inferred_points: InferredPoint[];
    query_type: QueryType;
    sub_queries: string[];
    key_terms: string[];
    retrieved_sections: RetrievedSection[];
    routing_log: RoutingLog | null;
    stage_timings: Record<string, number>;
    total_time_seconds: number;
    total_tokens: number;
    llm_calls: number;
}

export interface QueryRequest {
    query: string;
    doc_id: string;
    verify?: boolean;
    reflect?: boolean;
    conv_id?: string;
}

export interface FeedbackRequest {
    text: string;
    rating: number | null;
}

export type RetrievalMode = "legacy" | "optimized";

export interface OptimizationFeatures {
    enable_locator_cache: boolean;
    enable_embedding_prefilter: boolean;
    enable_query_cache: boolean;
    enable_verification_skip: boolean;
    enable_synthesis_prealloc: boolean;
    enable_reflection_tuning: boolean;
    enable_fast_synthesis: boolean;
}

export interface AppConfig {
    model: string;
    model_pro: string;
    max_located_nodes: number;
    retrieval_token_budget: number;
    max_cross_ref_depth: number;
    context_expansion_siblings: number;
    retrieval_mode: RetrievalMode;
    optimization_features: OptimizationFeatures;
}

export type NodeType =
    | "root"
    | "chapter"
    | "section"
    | "subsection"
    | "clause"
    | "subclause"
    | "paragraph"
    | "table"
    | "annexure"
    | "appendix"
    | "schedule"
    | "definition"
    | "proviso";

export interface CrossReference {
    source_node_id: string;
    target_identifier: string;
    target_node_id: string;
    resolved: boolean;
}

export interface TableBlock {
    table_id: string;
    page_number: number;
    caption: string;
    raw_text: string;
    markdown: string;
    num_rows: number;
    num_cols: number;
}

export interface TreeNode {
    node_id: string;
    title: string;
    node_type: NodeType;
    level: number;
    start_page: number;
    end_page: number;
    text: string;
    summary: string;
    description: string;
    topics: string[];
    token_count: number;
    parent_id: string;
    children: TreeNode[];
    cross_references: CrossReference[];
    tables: TableBlock[];
}

export interface DocumentDetail {
    doc_id: string;
    doc_name: string;
    doc_description: string;
    total_pages: number;
    structure: TreeNode[];
}

// ---------------------------------------------------------------------------
// Cross-Document (Corpus) Types
// ---------------------------------------------------------------------------

export type RelationType =
    | "references"
    | "supersedes"
    | "amends"
    | "supplements"
    | "implements"
    | "related_to";

export interface DocumentRelationship {
    source_doc_id: string;
    target_doc_id: string;
    relation_type: RelationType;
    description: string;
    evidence: string;
    confidence: number;
}

export interface CorpusDocument {
    doc_id: string;
    doc_name: string;
    doc_description: string;
    total_pages: number;
    node_count: number;
    top_topics: string[];
    key_entities: string[];
}

export interface Corpus {
    corpus_id: string;
    documents: CorpusDocument[];
    relationships: DocumentRelationship[];
    last_updated: string;
}

export interface CorpusCitation {
    citation_id: string;
    node_id: string;
    doc_id: string;
    doc_name: string;
    title: string;
    page_range: string;
    excerpt: string;
}

export interface CorpusRetrievedSection extends RetrievedSection {
    doc_id?: string;
    doc_name?: string;
}

export interface CorpusQueryRequest {
    query: string;
    verify?: boolean;
    conv_id?: string;
}

export interface CorpusQueryResponse {
    answer: string;
    record_id: string;
    conv_id: string;
    citations: CorpusCitation[];
    verification_status: string;
    verification_notes: string;
    inferred_points: InferredPoint[];
    query_type: string;
    sub_queries: string[];
    key_terms: string[];
    retrieved_sections: CorpusRetrievedSection[];
    selected_documents: Record<string, unknown>[];
    per_doc_routing_logs: Record<string, unknown>;
    stage_timings: Record<string, number>;
    total_time_seconds: number;
    total_tokens: number;
    llm_calls: number;
}

// ---------------------------------------------------------------------------
// Actionables Types
// ---------------------------------------------------------------------------

export type ActionableModality = "High Risk" | "Medium Risk" | "Low Risk";

export type ActionableWorkstream =
    | "Policy"
    | "Technology"
    | "Operations"
    | "Training"
    | "Reporting"
    | "Customer Communication"
    | "Governance"
    | "Legal"
    | "Other";

export type TaskStatus = "assigned" | "in_progress" | "team_review" | "review" | "completed" | "reworking";

export interface ActionableItem {
    id: string;
    modality: ActionableModality;
    action: string;
    implementation_notes: string;
    evidence_quote: string;
    source_location: string;
    source_node_id: string;
    workstream: ActionableWorkstream;
    approval_status: "pending" | "approved" | "rejected";
    is_manual: boolean;
    // Publish fields (set when compliance officer publishes from Publish tab)
    published_at?: string;
    deadline?: string;           // ISO datetime for deadline
    // Task lifecycle fields (populated after publish)
    task_status?: TaskStatus;
    completion_date?: string;    // ISO datetime when task is completed
    reviewer_comments?: string;  // Comments from compliance officer on rejection/rework
    evidence_files?: { name: string; url: string; uploaded_at: string }[];
    comments?: ActionableComment[];  // Thread of comments between team & compliance officer
    // Team reviewer audit fields
    submitted_at?: string;           // ISO datetime when team member submitted for review
    team_reviewer_name?: string;     // Name of team reviewer who acted
    team_reviewer_approved_at?: string;  // ISO datetime when team reviewer approved
    team_reviewer_rejected_at?: string;  // ISO datetime when team reviewer rejected
    // Legacy fields kept for backward compat with existing data
    actor?: string;
    object?: string;
    trigger_or_condition?: string;
    thresholds?: string;
    deadline_or_frequency?: string;
    effective_date?: string;
    reporting_or_notification_to?: string;
    needs_legal_review?: boolean;
    validation_status?: string;
    validation_notes?: string;
    priority?: "low" | "medium" | "high" | "critical";
    due_date?: string;
    notes?: string;
    assigned_to?: string;
}

export interface ActionableComment {
    id: string;
    author: string;
    role: "compliance_officer" | "team_member" | "team_reviewer";
    text: string;
    timestamp: string;  // ISO datetime
}

export interface ActionablesResult {
    status?: string;                    // "not_extracted" if not yet run
    doc_id: string;
    doc_name: string;
    actionables: ActionableItem[];
    total_extracted: number;
    total_validated: number;
    total_flagged: number;
    nodes_processed: number;
    nodes_with_actionables: number;
    extraction_time_seconds: number;
    llm_calls: number;
    total_tokens: number;
    extracted_at: string;
    by_modality: Record<string, number>;
    by_workstream: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Conversation Types
// ---------------------------------------------------------------------------

export interface ConversationMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    record_id?: string;
    timestamp: string;
    // Hydrated fields (populated from QueryRecord on load — assistant msgs only)
    // Citations may include doc_id/doc_name for research (corpus) conversations
    citations?: (Citation & { doc_id?: string; doc_name?: string })[];
    inferred_points?: InferredPoint[];
    verification_status?: string;
    verification_notes?: string;
    query_type?: QueryType | string;
    sub_queries?: string[];
    key_terms?: string[];
    retrieved_sections?: RetrievedSection[];
    routing_log?: RoutingLog | null;
    stage_timings?: Record<string, number>;
    total_time_seconds?: number;
    total_tokens?: number;
    llm_calls?: number;
}

export interface Conversation {
    conv_id: string;
    doc_id: string;
    doc_name: string;
    type: "document" | "research";
    title: string;
    messages: ConversationMessage[];
    created_at: string;
    updated_at: string;
    message_count: number;
}

export interface ConversationMeta {
    conv_id: string;
    doc_id: string;
    doc_name: string;
    type: "document" | "research";
    title: string;
    created_at: string;
    updated_at: string;
    message_count: number;
    last_message_preview: string;
}

// ---------------------------------------------------------------------------
// Storage Stats Types
// ---------------------------------------------------------------------------

export interface CollectionStats {
    docs: number;
    size_bytes: number;
    size_mb: number;
}

export interface StorageStats {
    collections: Record<string, CollectionStats>;
    total_bytes: number;
    total_mb: number;
    limit_mb: number;
    usage_percent: number;
}
