"""Pydantic request/response models for the Govinda V2 API.

Extracted from main.py as part of Phase 4 — Backend Layered Architecture.
"""
from typing import List, Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Document Ingestion
# ---------------------------------------------------------------------------

class IngestResponse(BaseModel):
    doc_id: str
    doc_name: str
    doc_description: str = ""
    node_count: int
    total_pages: int
    time_seconds: float
    memory_indexes: dict = {}


# ---------------------------------------------------------------------------
# Query / QA
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    query: str
    doc_id: str
    verify: bool = True
    reflect: bool = False
    conv_id: Optional[str] = None  # If None, backend creates a new conversation


class CitationModel(BaseModel):
    citation_id: str
    node_id: str
    title: str
    page_range: str
    excerpt: str


class InferredPointModel(BaseModel):
    point: str
    supporting_definitions: List[str] = []
    supporting_sections: List[str] = []
    reasoning: str = ""
    confidence: str = "medium"


class RetrievedSectionModel(BaseModel):
    node_id: str
    title: str
    text: str
    page_range: str
    source: str = "direct"
    token_count: int = 0


class RoutingLogModel(BaseModel):
    query_text: str = ""
    query_type: str = ""
    locate_results: List[dict] = []
    read_results: List[dict] = []
    cross_ref_follows: List[dict] = []
    total_nodes_located: int = 0
    total_sections_read: int = 0
    total_tokens_retrieved: int = 0
    stage_timings: dict = {}


class QueryResponse(BaseModel):
    answer: str
    record_id: str
    conv_id: str = ""  # Conversation ID (new or existing)
    citations: List[CitationModel]
    verification_status: str
    verification_notes: str = ""
    inferred_points: List[InferredPointModel] = []
    query_type: str = "single_hop"
    sub_queries: List[str] = []
    key_terms: List[str] = []
    retrieved_sections: List[RetrievedSectionModel] = []
    routing_log: Optional[RoutingLogModel] = None
    stage_timings: dict = {}
    total_time_seconds: float = 0.0
    total_tokens: int = 0
    llm_calls: int = 0


class FeedbackRequest(BaseModel):
    text: str = ""
    rating: Optional[int] = None


# ---------------------------------------------------------------------------
# Cross-Document (Corpus) Query
# ---------------------------------------------------------------------------

class CorpusQueryRequest(BaseModel):
    query: str
    verify: bool = True
    conv_id: Optional[str] = None  # If None, backend creates a new conversation


class CorpusCitationModel(BaseModel):
    citation_id: str
    node_id: str
    doc_id: str = ""
    doc_name: str = ""
    title: str
    page_range: str
    excerpt: str


class CorpusQueryResponse(BaseModel):
    answer: str
    record_id: str
    conv_id: str = ""  # Conversation ID (new or existing)
    citations: List[CorpusCitationModel]
    verification_status: str
    verification_notes: str = ""
    inferred_points: List[InferredPointModel] = []
    query_type: str = "global"
    sub_queries: List[str] = []
    key_terms: List[str] = []
    retrieved_sections: List[RetrievedSectionModel] = []
    selected_documents: List[dict] = []
    per_doc_routing_logs: dict = {}
    stage_timings: dict = {}
    total_time_seconds: float = 0.0
    total_tokens: int = 0
    llm_calls: int = 0


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

class AdminLoginRequest(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# Actionable / Justification
# ---------------------------------------------------------------------------

class JustificationRequest(BaseModel):
    justification: str
    justifier_name: str


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class TeamChatMessageRequest(BaseModel):
    author: str
    role: str
    text: str


class GlobalChatPostRequest(BaseModel):
    author: str
    role: str
    team: str = ""
    text: str


class RenameChatChannelRequest(BaseModel):
    custom_name: str


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

class CreateTeamRequest(BaseModel):
    name: str
    color: Optional[str] = None  # Tailwind color key e.g. "cyan", "blue", "pink"
    summary: str = ""
    parent_name: Optional[str] = None  # None = root-level team


class UpdateTeamRequest(BaseModel):
    name: Optional[str] = None
    colors: Optional[dict] = None
    color: Optional[str] = None  # Tailwind color key shorthand
    order: Optional[int] = None
    summary: Optional[str] = None
    parent_name: Optional[str] = "__UNSET__"  # Sentinel: distinguish "not provided" from "set to null (root)"


# ---------------------------------------------------------------------------
# LLM Benchmark
# ---------------------------------------------------------------------------

class LLMBenchmarkRunRequest(BaseModel):
    stages: list[str] = []  # Empty = all stages
    models: list[str] = []  # Empty = default models
    question_ids: list[str] = []  # Empty = all questions


class TournamentBattleRequest(BaseModel):
    stage: str
    question_id: str
    models: list[str] = []  # Empty = all benchmark models


class ModelExperimentRequest(BaseModel):
    models: list[str] = []  # Empty = BENCHMARK_MODELS (gpt-5.2, gpt-5-mini, gpt-5-nano)
    question_ids: list[str] = []  # Empty = all TEST_QUESTIONS
    questions: list[dict] = []  # Custom questions [{id, query, expected_type, complexity}]
    quality_weight: float = 0.5
    cost_weight: float = 0.3
    latency_weight: float = 0.2
