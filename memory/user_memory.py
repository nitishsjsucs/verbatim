"""
User Memory Manager for GOVINDA V2 — Loop 2: "Know Who's Asking"

MemoryOS-inspired per-user memory with 3 tiers:
- Short-term: Recent Q&A pairs (conversation window)
- Mid-term: Topic sessions with heat-based ranking
- Long-term: User profile + knowledge base

Self-contained implementation (no external dependency on MemoryOS package).
Only active when retrieval_mode='optimized' AND enable_user_memory=True.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np

from config.settings import get_settings

logger = logging.getLogger(__name__)


@dataclass
class MemoryEntry:
    """A single Q&A memory entry."""
    entry_id: str
    user_input: str
    agent_response: str
    timestamp: str
    keywords: list[str] = field(default_factory=list)
    doc_id: str = ""
    embedding: Optional[list[float]] = None


@dataclass
class MemorySession:
    """A mid-term session grouping related Q&A entries."""
    session_id: str
    summary: str
    keywords: list[str]
    entries: list[MemoryEntry]
    summary_embedding: Optional[list[float]] = None
    heat: float = 0.0
    visit_count: int = 0
    last_visit: str = ""
    created_at: str = ""

    def compute_heat(self) -> float:
        """Compute heat score based on visits and recency."""
        base = math.log1p(self.visit_count)
        recency = 0.5
        if self.last_visit:
            try:
                last = datetime.fromisoformat(self.last_visit)
                now = datetime.now(timezone.utc)
                hours_ago = max(0, (now - last).total_seconds() / 3600)
                recency = math.exp(-hours_ago / 24.0)  # 24-hour half-life
            except Exception:
                pass
        interaction = math.log1p(len(self.entries))
        self.heat = 0.4 * base + 0.3 * interaction + 0.3 * recency
        return self.heat


@dataclass
class UserProfile:
    """Long-term user profile derived from interaction patterns."""
    user_id: str
    expertise_areas: list[str] = field(default_factory=list)
    preferred_detail_level: str = "detailed"  # "brief", "detailed", "comprehensive"
    frequent_topics: dict = field(default_factory=dict)  # topic -> count
    query_type_distribution: dict = field(default_factory=dict)  # type -> count
    total_queries: int = 0
    avg_rating: float = 0.0
    rating_count: int = 0
    summary: str = ""
    last_updated: str = ""


class UserMemoryManager:
    """
    Per-user memory manager with 3-tier architecture.

    Short-term: Last N Q&A pairs (ring buffer)
    Mid-term: Topic sessions with heat ranking
    Long-term: User profile + knowledge

    Integration points:
    1. BEFORE retrieval: inject user context (bias toward user's topics)
    2. BEFORE synthesis: inject preferences (verbosity, format)
    3. AFTER each query: store Q&A for future context
    4. CONVERSATION CONTINUITY: prior Q&A enables follow-ups
    """

    def __init__(
        self,
        user_id: str,
        short_term_capacity: int = 10,
        mid_term_capacity: int = 200,
    ):
        self.user_id = user_id
        self._short_term: deque[MemoryEntry] = deque(maxlen=short_term_capacity)
        self._sessions: dict[str, MemorySession] = {}
        self._profile = UserProfile(user_id=user_id)
        self._knowledge: list[dict] = []  # fact dicts
        self._mid_term_capacity = mid_term_capacity
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Short-term memory
    # ------------------------------------------------------------------

    def add_interaction(
        self,
        query_text: str,
        answer_text: str,
        doc_id: str = "",
        key_terms: Optional[list[str]] = None,
        query_type: str = "",
        feedback_rating: Optional[int] = None,
    ) -> None:
        """Store a Q&A interaction in short-term memory and update profile."""
        entry = MemoryEntry(
            entry_id=f"mem_{int(time.time() * 1000)}",
            user_input=query_text,
            agent_response=answer_text[:500],  # Truncate for memory efficiency
            timestamp=datetime.now(timezone.utc).isoformat(),
            keywords=key_terms or [],
            doc_id=doc_id,
        )

        with self._lock:
            # If short-term is full, consolidate oldest to mid-term
            if len(self._short_term) >= self._short_term.maxlen:
                self._consolidate_to_midterm()

            self._short_term.append(entry)

            # Update profile stats
            self._profile.total_queries += 1
            if query_type:
                self._profile.query_type_distribution[query_type] = (
                    self._profile.query_type_distribution.get(query_type, 0) + 1
                )
            if key_terms:
                for term in key_terms:
                    self._profile.frequent_topics[term] = (
                        self._profile.frequent_topics.get(term, 0) + 1
                    )
            if feedback_rating is not None:
                total_rating = self._profile.avg_rating * self._profile.rating_count
                self._profile.rating_count += 1
                self._profile.avg_rating = (total_rating + feedback_rating) / self._profile.rating_count

            self._profile.last_updated = datetime.now(timezone.utc).isoformat()

    def get_short_term_context(self, last_n: int = 5) -> list[dict]:
        """Get the last N interactions for conversation context."""
        entries = list(self._short_term)[-last_n:]
        return [
            {
                "user_input": e.user_input,
                "agent_response": e.agent_response[:200],
                "keywords": e.keywords,
                "doc_id": e.doc_id,
            }
            for e in entries
        ]

    # ------------------------------------------------------------------
    # Mid-term consolidation
    # ------------------------------------------------------------------

    def _consolidate_to_midterm(self) -> None:
        """Move oldest short-term entries into a mid-term session."""
        if not self._short_term:
            return

        # Take the oldest entries that are about to be evicted
        entries_to_consolidate = []
        while len(self._short_term) > 0 and len(entries_to_consolidate) < 3:
            entries_to_consolidate.append(self._short_term.popleft())

        if not entries_to_consolidate:
            return

        # Try to find a matching existing session by keyword overlap
        entry_keywords = set()
        for e in entries_to_consolidate:
            entry_keywords.update(e.keywords)

        best_session = None
        best_overlap = 0

        for session in self._sessions.values():
            session_keywords = set(session.keywords)
            overlap = len(entry_keywords & session_keywords)
            if overlap > best_overlap and overlap >= 2:
                best_overlap = overlap
                best_session = session

        if best_session:
            # Merge into existing session
            best_session.entries.extend(entries_to_consolidate)
            best_session.keywords = list(
                set(best_session.keywords) | entry_keywords
            )
            best_session.visit_count += 1
            best_session.last_visit = datetime.now(timezone.utc).isoformat()
            best_session.compute_heat()
        else:
            # Create new session
            session_id = f"sess_{int(time.time() * 1000)}"
            session = MemorySession(
                session_id=session_id,
                summary=entries_to_consolidate[0].user_input[:100],
                keywords=list(entry_keywords),
                entries=entries_to_consolidate,
                visit_count=1,
                last_visit=datetime.now(timezone.utc).isoformat(),
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            session.compute_heat()
            self._sessions[session_id] = session

        # Evict coldest sessions if over capacity
        while len(self._sessions) > self._mid_term_capacity:
            coldest = min(self._sessions.values(), key=lambda s: s.heat)
            # Promote coldest to knowledge before evicting
            self._extract_knowledge_from_session(coldest)
            del self._sessions[coldest.session_id]

    def _extract_knowledge_from_session(self, session: MemorySession) -> None:
        """Extract durable facts from a session before eviction."""
        # Simple extraction: store the session's most frequent topics
        for keyword in session.keywords[:5]:
            self._knowledge.append({
                "fact": f"User frequently discusses: {keyword}",
                "source_session": session.session_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        # Cap knowledge
        if len(self._knowledge) > 100:
            self._knowledge = self._knowledge[-100:]

    # ------------------------------------------------------------------
    # Context retrieval (for injection into prompts)
    # ------------------------------------------------------------------

    def get_user_context(self, query_text: str = "", doc_id: str = "") -> dict:
        """
        Get comprehensive user context for prompt injection.

        Returns context structured for the Locator and Synthesizer.
        """
        # Recent interactions
        recent = self.get_short_term_context(last_n=5)

        # Filter to same doc_id if provided
        if doc_id:
            recent = [r for r in recent if r.get("doc_id", "") == doc_id or not r.get("doc_id")]

        # Top topics (sorted by frequency)
        top_topics = sorted(
            self._profile.frequent_topics.items(),
            key=lambda x: -x[1],
        )[:10]

        # Relevant sessions (by keyword overlap with query)
        relevant_sessions = []
        if query_text:
            query_words = set(query_text.lower().split())
            for session in self._sessions.values():
                session_words = set(w.lower() for w in session.keywords)
                overlap = len(query_words & session_words)
                if overlap > 0:
                    relevant_sessions.append({
                        "summary": session.summary,
                        "keywords": session.keywords[:5],
                        "heat": round(session.heat, 2),
                        "entry_count": len(session.entries),
                    })
            relevant_sessions.sort(key=lambda s: -s["heat"])
            relevant_sessions = relevant_sessions[:3]

        return {
            "user_id": self.user_id,
            "total_queries": self._profile.total_queries,
            "top_topics": [t[0] for t in top_topics],
            "preferred_detail_level": self._profile.preferred_detail_level,
            "recent_interactions": recent,
            "relevant_sessions": relevant_sessions,
            "expertise_areas": self._profile.expertise_areas,
            "profile_summary": self._profile.summary,
            "query_type_distribution": self._profile.query_type_distribution,
        }

    def format_context_for_prompt(self, query_text: str = "", doc_id: str = "") -> str:
        """Format user context as a text block for prompt injection."""
        ctx = self.get_user_context(query_text, doc_id)

        parts = []

        if ctx["total_queries"] > 0:
            parts.append(f"User has asked {ctx['total_queries']} questions previously.")

        if ctx["top_topics"]:
            parts.append(f"Frequent topics: {', '.join(ctx['top_topics'][:5])}")

        if ctx["recent_interactions"]:
            parts.append("Recent questions:")
            for r in ctx["recent_interactions"][-3:]:
                parts.append(f"  - \"{r['user_input'][:80]}\"")

        if ctx["relevant_sessions"]:
            parts.append("Related past sessions:")
            for s in ctx["relevant_sessions"]:
                parts.append(f"  - {s['summary'][:80]} (keywords: {', '.join(s['keywords'][:3])})")

        return "\n".join(parts) if parts else ""

    # ------------------------------------------------------------------
    # Profile management
    # ------------------------------------------------------------------

    def update_detail_preference(self, feedback_rating: int, answer_length: int) -> None:
        """Infer detail preference from feedback patterns."""
        # If user rates long answers high → prefers detailed
        # If user rates short answers high → prefers brief
        if feedback_rating >= 4:
            if answer_length > 2000:
                self._profile.preferred_detail_level = "comprehensive"
            elif answer_length > 800:
                self._profile.preferred_detail_level = "detailed"
            else:
                self._profile.preferred_detail_level = "brief"

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        """Serialize full memory state."""
        return {
            "_id": self.user_id,
            "user_id": self.user_id,
            "short_term": [
                {
                    "entry_id": e.entry_id,
                    "user_input": e.user_input,
                    "agent_response": e.agent_response,
                    "timestamp": e.timestamp,
                    "keywords": e.keywords,
                    "doc_id": e.doc_id,
                }
                for e in self._short_term
            ],
            "sessions": {
                sid: {
                    "session_id": s.session_id,
                    "summary": s.summary,
                    "keywords": s.keywords,
                    "entries": [
                        {
                            "entry_id": e.entry_id,
                            "user_input": e.user_input,
                            "agent_response": e.agent_response,
                            "timestamp": e.timestamp,
                            "keywords": e.keywords,
                            "doc_id": e.doc_id,
                        }
                        for e in s.entries
                    ],
                    "heat": s.heat,
                    "visit_count": s.visit_count,
                    "last_visit": s.last_visit,
                    "created_at": s.created_at,
                }
                for sid, s in self._sessions.items()
            },
            "profile": {
                "expertise_areas": self._profile.expertise_areas,
                "preferred_detail_level": self._profile.preferred_detail_level,
                "frequent_topics": self._profile.frequent_topics,
                "query_type_distribution": self._profile.query_type_distribution,
                "total_queries": self._profile.total_queries,
                "avg_rating": self._profile.avg_rating,
                "rating_count": self._profile.rating_count,
                "summary": self._profile.summary,
                "last_updated": self._profile.last_updated,
            },
            "knowledge": self._knowledge,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "UserMemoryManager":
        """Deserialize from MongoDB document."""
        mgr = cls(user_id=data.get("user_id", data.get("_id", "default")))

        # Restore short-term
        for e_data in data.get("short_term", []):
            entry = MemoryEntry(
                entry_id=e_data.get("entry_id", ""),
                user_input=e_data.get("user_input", ""),
                agent_response=e_data.get("agent_response", ""),
                timestamp=e_data.get("timestamp", ""),
                keywords=e_data.get("keywords", []),
                doc_id=e_data.get("doc_id", ""),
            )
            mgr._short_term.append(entry)

        # Restore sessions
        for sid, s_data in data.get("sessions", {}).items():
            entries = [
                MemoryEntry(
                    entry_id=e.get("entry_id", ""),
                    user_input=e.get("user_input", ""),
                    agent_response=e.get("agent_response", ""),
                    timestamp=e.get("timestamp", ""),
                    keywords=e.get("keywords", []),
                    doc_id=e.get("doc_id", ""),
                )
                for e in s_data.get("entries", [])
            ]
            session = MemorySession(
                session_id=s_data.get("session_id", sid),
                summary=s_data.get("summary", ""),
                keywords=s_data.get("keywords", []),
                entries=entries,
                heat=s_data.get("heat", 0.0),
                visit_count=s_data.get("visit_count", 0),
                last_visit=s_data.get("last_visit", ""),
                created_at=s_data.get("created_at", ""),
            )
            mgr._sessions[sid] = session

        # Restore profile
        p_data = data.get("profile", {})
        mgr._profile.expertise_areas = p_data.get("expertise_areas", [])
        mgr._profile.preferred_detail_level = p_data.get("preferred_detail_level", "detailed")
        mgr._profile.frequent_topics = p_data.get("frequent_topics", {})
        mgr._profile.query_type_distribution = p_data.get("query_type_distribution", {})
        mgr._profile.total_queries = p_data.get("total_queries", 0)
        mgr._profile.avg_rating = p_data.get("avg_rating", 0.0)
        mgr._profile.rating_count = p_data.get("rating_count", 0)
        mgr._profile.summary = p_data.get("summary", "")
        mgr._profile.last_updated = p_data.get("last_updated", "")

        # Restore knowledge
        mgr._knowledge = data.get("knowledge", [])

        return mgr

    def save(self, db: Any) -> None:
        """Persist to MongoDB."""
        doc = self.to_dict()
        db["user_memory"].replace_one(
            {"_id": self.user_id}, doc, upsert=True,
        )

    @classmethod
    def load(cls, user_id: str, db: Any) -> Optional["UserMemoryManager"]:
        """Load from MongoDB."""
        doc = db["user_memory"].find_one({"_id": user_id})
        if not doc:
            return None
        return cls.from_dict(doc)

    def get_stats(self) -> dict:
        """Return memory stats."""
        return {
            "user_id": self.user_id,
            "short_term_entries": len(self._short_term),
            "mid_term_sessions": len(self._sessions),
            "knowledge_entries": len(self._knowledge),
            "total_queries": self._profile.total_queries,
            "top_topics": sorted(
                self._profile.frequent_topics.items(), key=lambda x: -x[1]
            )[:5],
            "preferred_detail_level": self._profile.preferred_detail_level,
            "avg_rating": round(self._profile.avg_rating, 2),
        }
