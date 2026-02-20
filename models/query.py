"""
Query and Answer models for GOVINDA V2.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class QueryType(str, Enum):
    """Query classification types (BookRAG pattern)."""

    SINGLE_HOP = "single_hop"  # Answer in one section
    MULTI_HOP = "multi_hop"  # Answer spans multiple sections
    GLOBAL = "global"  # Requires aggregation across document
    DEFINITIONAL = "definitional"  # Asks about a definition/term


@dataclass
class Query:
    """A user query with classification metadata."""

    text: str
    query_type: QueryType = QueryType.SINGLE_HOP
    sub_queries: list[str] = field(default_factory=list)
    key_terms: list[str] = field(default_factory=list)


@dataclass
class LocatedNode:
    """A node selected during the Locate phase."""

    node_id: str
    title: str
    relevance_reason: str  # Why the LLM selected this node
    confidence: float = 1.0  # 0.0 - 1.0
    page_range: str = ""


@dataclass
class RetrievedSection:
    """A section of text retrieved during the Read phase."""

    node_id: str
    title: str
    text: str
    page_range: str
    source: str = "direct"  # "direct", "sibling", "parent", "cross_ref"
    token_count: int = 0


@dataclass
class Citation:
    """A citation linking answer text to source section."""

    citation_id: str  # e.g., "[1]"
    node_id: str
    title: str
    page_range: str
    excerpt: str = ""  # Key excerpt from the cited section


@dataclass
class InferredPoint:
    """A point logically inferred from definitions or rules in the source text.

    Each inferred point carries verbatim supporting definitions and a
    reasoning chain so the reader can independently evaluate the inference.
    """

    point: str  # The inferred conclusion
    supporting_definitions: list[str] = field(
        default_factory=list,
    )  # Verbatim definition(s) / rule text that ground the inference
    supporting_sections: list[str] = field(
        default_factory=list,
    )  # node_ids of source sections
    reasoning: str = ""  # "Definition X says Y, therefore Z"
    confidence: str = "medium"  # "high", "medium", "low"


@dataclass
class Answer:
    """A complete answer with citations and metadata."""

    text: str
    citations: list[Citation] = field(default_factory=list)
    inferred_points: list[InferredPoint] = field(default_factory=list)
    query_type: QueryType = QueryType.SINGLE_HOP

    # Retrieval metadata
    located_nodes: list[LocatedNode] = field(default_factory=list)
    retrieved_sections: list[RetrievedSection] = field(default_factory=list)

    # Verification
    verified: bool = False
    verification_status: str = ""  # "verified", "partially_verified", "unverified"
    verification_notes: str = ""

    # Routing audit
    routing_log: Optional[RoutingLog] = None

    # Performance metrics
    total_time_seconds: float = 0.0
    total_tokens: int = 0
    llm_calls: int = 0

    # Per-stage timing breakdown (stage_name -> seconds)
    stage_timings: dict[str, float] = field(default_factory=dict)


@dataclass
class RoutingLog:
    """Audit log for routing decisions (RDR2 pattern)."""

    query_text: str
    query_type: QueryType
    locate_results: list[dict] = field(default_factory=list)
    read_results: list[dict] = field(default_factory=list)
    cross_ref_follows: list[dict] = field(default_factory=list)
    total_nodes_located: int = 0
    total_sections_read: int = 0
    total_tokens_retrieved: int = 0

    # Per-substep timing breakdown (substep_name -> seconds)
    stage_timings: dict[str, float] = field(default_factory=dict)


@dataclass
class RetrievalResult:
    """Intermediate result from Phase 1 (retrieval), before synthesis."""

    query: Query
    sections: list[RetrievedSection]
    routing_log: RoutingLog
    tree: Any  # DocumentTree (avoid circular import)
    timings: dict[str, float] = field(default_factory=dict)
    llm_usage_snapshot: dict = field(default_factory=dict)
    start_time: float = 0.0  # pipeline start timestamp


@dataclass
class Feedback:
    """Officer feedback on a query answer."""

    text: str = ""
    rating: Optional[int] = None  # 1-5 scale
    timestamp: str = ""  # ISO format


@dataclass
class QueryRecord:
    """Complete audit record for a single query."""

    record_id: str
    query_text: str
    doc_id: str
    timestamp: str  # ISO format

    # Classification
    query_type: QueryType = QueryType.SINGLE_HOP
    sub_queries: list[str] = field(default_factory=list)
    key_terms: list[str] = field(default_factory=list)

    # Retrieval audit
    routing_log: Optional[RoutingLog] = None
    retrieved_sections: list[RetrievedSection] = field(default_factory=list)

    # Answer
    answer_text: str = ""
    citations: list[Citation] = field(default_factory=list)
    inferred_points: list[InferredPoint] = field(default_factory=list)
    verification_status: str = ""
    verification_notes: str = ""

    # Performance
    total_time_seconds: float = 0.0
    total_tokens: int = 0
    llm_calls: int = 0
    stage_timings: dict[str, float] = field(default_factory=dict)

    # Feedback (filled in later by officer)
    feedback: Optional[Feedback] = None

    # Settings snapshot
    verify_enabled: bool = True
    reflect_enabled: bool = False

    def to_dict(self) -> dict:
        """Serialize to a JSON-safe dict."""
        d = {
            "record_id": self.record_id,
            "query_text": self.query_text,
            "doc_id": self.doc_id,
            "timestamp": self.timestamp,
            "query_type": self.query_type.value,
            "sub_queries": self.sub_queries,
            "key_terms": self.key_terms,
            "answer_text": self.answer_text,
            "verification_status": self.verification_status,
            "verification_notes": self.verification_notes,
            "total_time_seconds": self.total_time_seconds,
            "total_tokens": self.total_tokens,
            "llm_calls": self.llm_calls,
            "stage_timings": self.stage_timings,
            "verify_enabled": self.verify_enabled,
            "reflect_enabled": self.reflect_enabled,
        }
        if self.routing_log:
            rl = self.routing_log
            d["routing_log"] = {
                "query_text": rl.query_text,
                "query_type": rl.query_type.value if rl.query_type else None,
                "locate_results": rl.locate_results,
                "read_results": rl.read_results,
                "cross_ref_follows": rl.cross_ref_follows,
                "total_nodes_located": rl.total_nodes_located,
                "total_sections_read": rl.total_sections_read,
                "total_tokens_retrieved": rl.total_tokens_retrieved,
                "stage_timings": rl.stage_timings,
            }
        d["retrieved_sections"] = [
            {
                "node_id": s.node_id,
                "title": s.title,
                "text": s.text,
                "page_range": s.page_range,
                "source": s.source,
                "token_count": s.token_count,
            }
            for s in self.retrieved_sections
        ]
        d["citations"] = [
            {
                "citation_id": c.citation_id,
                "node_id": c.node_id,
                "title": c.title,
                "page_range": c.page_range,
                "excerpt": c.excerpt,
            }
            for c in self.citations
        ]
        d["inferred_points"] = [
            {
                "point": ip.point,
                "supporting_definitions": ip.supporting_definitions,
                "supporting_sections": ip.supporting_sections,
                "reasoning": ip.reasoning,
                "confidence": ip.confidence,
            }
            for ip in self.inferred_points
        ]
        if self.feedback:
            d["feedback"] = {
                "text": self.feedback.text,
                "rating": self.feedback.rating,
                "timestamp": self.feedback.timestamp,
            }
        return d

    @classmethod
    def from_dict(cls, data: dict) -> QueryRecord:
        """Deserialize from a JSON dict."""
        rl_data = data.get("routing_log")
        routing_log = None
        if rl_data:
            routing_log = RoutingLog(
                query_text=rl_data.get("query_text", ""),
                query_type=QueryType(rl_data["query_type"]) if rl_data.get("query_type") else QueryType.SINGLE_HOP,
                locate_results=rl_data.get("locate_results", []),
                read_results=rl_data.get("read_results", []),
                cross_ref_follows=rl_data.get("cross_ref_follows", []),
                total_nodes_located=rl_data.get("total_nodes_located", 0),
                total_sections_read=rl_data.get("total_sections_read", 0),
                total_tokens_retrieved=rl_data.get("total_tokens_retrieved", 0),
                stage_timings=rl_data.get("stage_timings", {}),
            )
        sections = [
            RetrievedSection(**s) for s in data.get("retrieved_sections", [])
        ]
        citations = [Citation(**c) for c in data.get("citations", [])]
        inferred_points = [
            InferredPoint(**ip) for ip in data.get("inferred_points", [])
        ]
        fb_data = data.get("feedback")
        feedback = Feedback(**fb_data) if fb_data else None

        return cls(
            record_id=data["record_id"],
            query_text=data["query_text"],
            doc_id=data["doc_id"],
            timestamp=data["timestamp"],
            query_type=QueryType(data.get("query_type", "single_hop")),
            sub_queries=data.get("sub_queries", []),
            key_terms=data.get("key_terms", []),
            routing_log=routing_log,
            retrieved_sections=sections,
            answer_text=data.get("answer_text", ""),
            citations=citations,
            inferred_points=inferred_points,
            verification_status=data.get("verification_status", ""),
            verification_notes=data.get("verification_notes", ""),
            total_time_seconds=data.get("total_time_seconds", 0.0),
            total_tokens=data.get("total_tokens", 0),
            llm_calls=data.get("llm_calls", 0),
            stage_timings=data.get("stage_timings", {}),
            feedback=feedback,
            verify_enabled=data.get("verify_enabled", True),
            reflect_enabled=data.get("reflect_enabled", False),
        )
