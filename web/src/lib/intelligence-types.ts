/**
 * Types for the Actionable Intelligence System (AIS).
 *
 * These mirror the Python dataclasses in `intelligence/models.py` on the
 * backend. They intentionally live in a separate file from `types.ts` so
 * the existing product's typing surface is not touched.
 */

export type IntelPriority = "High" | "Medium" | "Low";

export type IntelCategory =
    | "Compliance"
    | "Risk"
    | "Operations"
    | "IT / Systems"
    | "Reporting"
    | "Customer Impact"
    | "Other";

export type IntelTimelineBucket =
    | "Immediate"
    | "Short-term"
    | "Long-term"
    | "Not Specified";

export type IntelNoticeTag = "Informational" | "Contextual" | "Advisory";

export type IntelStatus = "Pending" | "In Progress" | "Completed";

export interface IntelTeam {
    team_id: string;
    name: string;
    function: string;
    department?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface EnrichedActionable {
    id: string;
    description: string;
    source: string;
    source_node_id?: string;
    original_text?: string;
    priority: IntelPriority;
    deadline: string; // "YYYY-MM-DD" | "Not Specified"
    deadline_phrase?: string;
    risk_score: number; // 1..5
    category: IntelCategory;
    timeline_bucket: IntelTimelineBucket;
    assigned_teams: string[]; // team_ids
    assigned_team_names: string[];
    status: IntelStatus;
    notes?: string;
}

export interface NoticeItem {
    id: string;
    text: string;
    source: string;
    source_node_id?: string;
    tag: IntelNoticeTag;
}

export interface IntelStats {
    total: number;
    high_priority: number;
    medium_priority: number;
    low_priority: number;
    unassigned: number;
    upcoming_deadlines: number;
    priority_counts: Record<string, number>;
    category_counts: Record<string, number>;
    risk_counts: Record<string, number>;
    timeline_counts: Record<string, number>;
    team_workload: Record<string, number>;
}

export interface IntelGroupings {
    by_category: Record<string, string[]>;
    by_department: Record<string, string[]>;
    by_timeline: Record<string, string[]>;
}

export interface IntelRunPayload {
    doc_id: string;
    doc_name: string;
    actionables: EnrichedActionable[];
    notice_board: NoticeItem[];
    team_snapshot: IntelTeam[];
    groupings: IntelGroupings;
    stats: IntelStats;
    created_at: string;
    updated_at: string;
}

export interface IntelDocumentMeta {
    id: string;
    name: string;
    pages: number;
    nodes: number;
    description?: string;
    ingested_at?: string;
    has_actionables?: boolean;
    has_intel_run?: boolean;
}

export interface IntelDashboardPayload {
    summary: {
        total_actionables: number;
        total_notices: number;
        documents: number;
        priority_counts: Record<string, number>;
        category_counts: Record<string, number>;
        risk_counts: Record<string, number>;
        team_workload: Record<string, number>;
        unassigned: number;
    };
    per_document: Array<{
        doc_id: string;
        doc_name: string;
        updated_at: string;
        stats: IntelStats;
    }>;
    team_roster_size: number;
}
