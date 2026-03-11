
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

/**
 * Workstream / team name. Now a plain string — teams are dynamic (database-driven).
 * The old union type is removed; any string is accepted.
 */
export type ActionableWorkstream = string;

export type TaskStatus = "assigned" | "in_progress" | "team_review" | "review" | "completed" | "reworking" | "reviewer_rejected" | "awaiting_justification" | "pending_all_teams" | "tagged_incorrectly" | "bypass_approved";

// Per-team workflow state for multi-team actionables
// Each team has its own implementation, evidence, status, and approval flow
export interface EvidenceFile {
    name: string;
    url: string;
    uploaded_at: string;
    stored_name?: string;
}

export interface TeamWorkflow {
    task_status: TaskStatus;
    implementation_notes?: string;  // Per-team implementation text
    evidence_quote?: string;        // Per-team evidence description
    submitted_at?: string;
    team_reviewer_name?: string;
    team_reviewer_approved_at?: string;
    team_reviewer_rejected_at?: string;
    reviewer_comments?: string;
    rejection_reason?: string;
    is_delayed?: boolean;
    delay_detected_at?: string;
    justification?: string;
    justification_by?: string;
    justification_at?: string;
    justification_status?: string;
    delay_justification?: string;
    delay_justification_member_submitted?: boolean;
    delay_justification_reviewer_approved?: boolean;
    delay_justification_lead_approved?: boolean;
    delay_justification_updated_by?: string;
    delay_justification_updated_at?: string;
    evidence_files?: EvidenceFile[];
    comments?: ActionableComment[];
    completion_date?: string;
    deadline?: string;  // Per-team deadline for mixed group projects
}

export interface RiskSubDropdown {
    label: string;
    score: number;
}

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
    // Publish fields (set when compliance officer approves from Actionables page)
    published_at?: string;
    deadline?: string;           // ISO datetime for deadline
    // Task lifecycle fields (populated after approval)
    task_status?: TaskStatus;
    completion_date?: string;    // ISO datetime when task is completed
    reviewer_comments?: string;  // Comments from compliance officer on rejection/rework
    rejection_reason?: string;   // Reason provided when CO or team reviewer rejects a task
    evidence_files?: EvidenceFile[];
    comments?: ActionableComment[];  // Thread of comments between team & compliance officer
    // Team reviewer audit fields
    submitted_at?: string;           // ISO datetime when team member submitted for review
    team_reviewer_name?: string;     // Name of team reviewer who acted
    team_reviewer_approved_at?: string;  // ISO datetime when team reviewer approved
    team_reviewer_rejected_at?: string;  // ISO datetime when team reviewer rejected
    // Delay monitoring & Team Lead fields
    is_delayed?: boolean;                // True if deadline passed and task not completed
    delay_detected_at?: string;          // ISO datetime when delay was detected
    justification?: string;        // Team Lead's justification for the delay (legacy)
    justification_by?: string;     // Name of team lead who justified (legacy)
    justification_at?: string;     // ISO datetime of justification (legacy)
    justification_status?: "pending_review" | "reviewed";  // CO must review before final (legacy)
    // NEW: 4-stage delay justification workflow (Member → Reviewer → Lead → CO)
    justification_member_text?: string;        // Stage 1: Member submits justification
    justification_member_by?: string;          // Stage 1: Member name
    justification_member_at?: string;          // Stage 1: ISO timestamp
    justification_reviewer_approved?: boolean; // Stage 2: Reviewer approval status
    justification_reviewer_comment?: string;   // Stage 2: Reviewer comment
    justification_reviewer_by?: string;        // Stage 2: Reviewer name
    justification_reviewer_at?: string;        // Stage 2: ISO timestamp
    justification_lead_approved?: boolean;     // Stage 3: Lead approval status
    justification_lead_comment?: string;       // Stage 3: Lead comment
    justification_lead_by?: string;            // Stage 3: Lead name
    justification_lead_at?: string;            // Stage 3: ISO timestamp
    justification_co_approved?: boolean;       // Stage 4: CO approval status
    justification_co_comment?: string;         // Stage 4: CO comment
    justification_co_by?: string;              // Stage 4: CO name
    justification_co_at?: string;              // Stage 4: ISO timestamp
    // NEW: Shared delay justification workflow (Member → Reviewer → Lead)
    delay_justification?: string;                      // Single shared text field
    delay_justification_member_submitted?: boolean;    // Member has entered justification
    delay_justification_reviewer_approved?: boolean;   // Reviewer approved the justification
    delay_justification_lead_approved?: boolean;       // Lead approved the justification
    delay_justification_updated_by?: string;           // Last person who edited the text
    delay_justification_updated_at?: string;           // ISO timestamp of last edit
    audit_trail?: AuditTrailEntry[];           // Full audit trail
    // NEW: Role-specific mandatory comments (separate from chat thread)
    member_comment?: string;           // Mandatory comment from member before submission
    reviewer_comment?: string;         // Mandatory comment from reviewer before approval
    lead_comment?: string;             // Mandatory comment from lead (if applicable)
    co_comment?: string;               // Mandatory comment from CO before final approval
    // Multi-team assignment
    assigned_teams?: string[];             // Teams assigned to this actionable
    team_workflows?: Record<string, TeamWorkflow>;  // Per-team workflow state
    // Document metadata (inherited from parent document)
    regulation_issue_date?: string;   // ISO date — regulation issued date
    circular_effective_date?: string;  // ISO date — circular effective date
    regulator?: string;               // Regulator name
    // Source document reference (hydrated when fetched from tracker/approved-by-team)
    doc_id?: string;                  // ID of the document this actionable was extracted from
    doc_name?: string;                // Title/name of the source document
    // Unique actionable display ID
    actionable_id?: string;           // e.g. "ACT-20260304-001"
    // Creation timestamp
    created_at?: string;              // ISO timestamp when this actionable was first created
    // Risk assessment dropdowns (legacy flat fields — kept for backward compat)
    impact?: string;
    tranche3?: string;                // Yes / No
    control?: string;
    likelihood?: string;
    residual_risk?: string;
    inherent_risk?: string;
    // Structured risk scoring (new framework)
    // Likelihood: 3 independent dropdowns → overall = MAX of 3 scores
    likelihood_business_volume?: RiskSubDropdown;
    likelihood_products_processes?: RiskSubDropdown;
    likelihood_compliance_violations?: RiskSubDropdown;
    likelihood_score?: number;         // MAX(bv, pp, cv)
    // Impact: single dropdown → overall = score²
    impact_dropdown?: RiskSubDropdown;
    impact_score?: number;             // (selected score)²
    // Control: 2 dropdowns → overall = average
    control_monitoring?: RiskSubDropdown;
    control_effectiveness?: RiskSubDropdown;
    control_score?: number;            // (mon + eff) / 2
    // Derived scores
    inherent_risk_score?: number;      // likelihood × impact
    inherent_risk_label?: string;
    residual_risk_score?: number;      // inherent × control
    residual_risk_label?: string;
    residual_risk_interpretation?: string; // "Satisfactory (Low)" / "Improvement Needed (Medium)" / "Weak (High)"
    // Spec-compliant overall score aliases
    overall_likelihood_score?: number; // MAX(L1, L2, L3)
    overall_impact_score?: number;     // (impact_dropdown.score)²
    overall_control_score?: number;    // (monitoring + effectiveness) / 2
    // Legacy impact sub-fields (backward compat with existing data)
    impact_sub1?: RiskSubDropdown;
    impact_sub2?: RiskSubDropdown;
    impact_sub3?: RiskSubDropdown;
    theme?: string;                   // Configurable theme category
    // Tagged Incorrectly bypass flow
    bypass_tag?: boolean;             // True if tagged as incorrectly assigned
    bypass_tagged_at?: string;
    bypass_tagged_by?: string;
    bypass_approved_by?: string;
    bypass_approved_at?: string;
    bypass_disapproved_by?: string;   // CO who disapproved
    bypass_disapproved_at?: string;
    bypass_disapproval_reason?: string; // Reason for CO disapproval
    bypass_reviewer_rejected_by?: string;  // Reviewer who rejected the bypass
    bypass_reviewer_rejected_at?: string;
    bypass_reviewer_rejection_reason?: string; // Reason for reviewer rejection
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
    role: "compliance_officer" | "team_member" | "team_reviewer" | "team_lead" | "chief";
    text: string;
    timestamp: string;  // ISO datetime
}

export interface AuditTrailEntry {
    event: string;
    actor: string;
    role: string;
    timestamp: string;  // ISO datetime
    details: string;
}

export interface ActionablesResult {
    status?: string;                    // "not_extracted" if not yet run
    doc_id: string;
    doc_name: string;
    regulation_issue_date?: string;     // ISO date — document-level
    circular_effective_date?: string;   // ISO date — document-level
    regulator?: string;                 // Regulator — document-level
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

// ─── Dynamic Team Entity ───

export interface Team {
    name: string;
    is_system: boolean;
    colors: { bg: string; text: string; header: string };
    summary: string;
    created_at: string;
    order: number;
    // Hierarchy fields
    parent_name: string | null;
    depth: number;
    path: string[];       // Ancestor names from root to immediate parent
    is_leaf: boolean;     // True if team has no children
    children?: Team[];    // Populated only in tree responses
}

// ─── Team hierarchy helpers ───

/** Flatten a tree of teams into a flat array (depth-first). */
export function flattenTeamTree(tree: Team[]): Team[] {
    const result: Team[] = [];
    function walk(nodes: Team[]) {
        for (const node of nodes) {
            result.push(node);
            if (node.children?.length) walk(node.children);
        }
    }
    walk(tree);
    return result;
}

/** Build a nested tree from a flat list of teams. */
export function buildTeamTree(teams: Team[]): Team[] {
    const byName: Record<string, Team & { children: Team[] }> = {};
    for (const t of teams) {
        byName[t.name] = { ...t, children: [] };
    }
    const roots: Team[] = [];
    for (const t of teams) {
        const node = byName[t.name];
        if (t.parent_name && byName[t.parent_name]) {
            byName[t.parent_name].children.push(node);
        } else {
            roots.push(node);
        }
    }
    return roots;
}

/** Get all descendant team names from a flat list. */
export function getDescendantNames(teams: Team[], teamName: string): string[] {
    const result: string[] = [];
    function collect(parentName: string) {
        for (const t of teams) {
            if (t.parent_name === parentName) {
                result.push(t.name);
                collect(t.name);
            }
        }
    }
    collect(teamName);
    return result;
}

/** Get team names visible to a user assigned to a given team (self + all descendants). */
export function getVisibleTeamNames(teams: Team[], userTeam: string): string[] {
    return [userTeam, ...getDescendantNames(teams, userTeam)];
}

/** Get the full breadcrumb path for a team: root > ... > parent > self */
export function getTeamBreadcrumb(team: Team): string {
    return [...(team.path || []), team.name].join(" › ");
}

// ─── Multi-team helpers ───

/** The system-generated classification for multi-team actionables */
export const MIXED_TEAM_CLASSIFICATION = "Mixed Team" as const;

/** Returns true if the item is assigned to more than one team */
export function isMultiTeam(item: ActionableItem): boolean {
    return (item.assigned_teams?.length ?? 0) > 1;
}

/**
 * Computes the classification for an actionable based on team count.
 * - If team_count > 1 → "Mixed Team"
 * - Otherwise → the single assigned team (workstream)
 * This is a computed/derived value, not stored in DB.
 */
export function getClassification(item: ActionableItem): string {
    if (isMultiTeam(item)) {
        return MIXED_TEAM_CLASSIFICATION;
    }
    return item.workstream || "Other";
}

/**
 * Derives the parent status from all child team workflows.
 * Parent moves to "completed" ONLY when ALL child team implementations are completed.
 * Returns the most restrictive status across all teams.
 */
export function deriveParentStatus(item: ActionableItem): TaskStatus {
    if (!isMultiTeam(item) || !item.team_workflows) {
        return item.task_status || "assigned";
    }
    
    const teams = item.assigned_teams || [];
    const statuses = teams.map(team => item.team_workflows?.[team]?.task_status || "assigned");
    
    // If all completed, parent is completed
    if (statuses.every(s => s === "completed")) return "completed";
    
    // If any is awaiting justification
    if (statuses.some(s => s === "awaiting_justification")) return "awaiting_justification";
    
    // If any is in review states, show that
    if (statuses.some(s => s === "review")) return "review";
    if (statuses.some(s => s === "team_review")) return "team_review";
    
    // If any is reworking/rejected
    if (statuses.some(s => s === "reworking" || s === "reviewer_rejected")) return "reworking";
    
    // If any is in progress
    if (statuses.some(s => s === "in_progress")) return "in_progress";
    
    // If all assigned
    if (statuses.every(s => s === "assigned")) return "assigned";
    
    // Default fallback
    return "pending_all_teams" as TaskStatus;
}

/**
 * For multi-team items, project the team-specific workflow onto the
 * top-level fields so existing rendering code works unchanged.
 * Single-team items are returned as-is.
 */
export function getTeamView(item: ActionableItem, team: string): ActionableItem {
    if (!isMultiTeam(item)) return item;
    const tw = item.team_workflows?.[team];
    if (!tw) return item;
    return {
        ...item,
        task_status: tw.task_status,
        submitted_at: tw.submitted_at || undefined,
        team_reviewer_name: tw.team_reviewer_name || undefined,
        team_reviewer_approved_at: tw.team_reviewer_approved_at || undefined,
        team_reviewer_rejected_at: tw.team_reviewer_rejected_at || undefined,
        reviewer_comments: tw.reviewer_comments || undefined,
        rejection_reason: tw.rejection_reason || undefined,
        is_delayed: tw.is_delayed,
        delay_detected_at: tw.delay_detected_at || undefined,
        justification: tw.justification || undefined,
        justification_by: tw.justification_by || undefined,
        justification_at: tw.justification_at || undefined,
        justification_status: tw.justification_status as ActionableItem["justification_status"],
        evidence_files: tw.evidence_files,
        comments: tw.comments,
        completion_date: tw.completion_date || undefined,
        deadline: tw.deadline || item.deadline,
        implementation_notes: tw.implementation_notes ?? item.implementation_notes,
        evidence_quote: tw.evidence_quote ?? item.evidence_quote,
    };
}
