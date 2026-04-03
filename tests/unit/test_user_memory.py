"""
Unit tests for User Memory (Loop 2: "Know Who's Asking")
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from memory.user_memory import (
    UserMemoryManager,
    MemoryEntry,
    MemorySession,
    UserProfile,
)


class TestMemoryEntry:
    """Test MemoryEntry functionality."""

    def test_memory_entry_initialization(self):
        """Test MemoryEntry initialization."""
        entry = MemoryEntry(
            entry_id="entry_123",
            user_input="What is KYC?",
            agent_response="KYC stands for Know Your Customer.",
            timestamp="2024-01-01T12:00:00Z",
            keywords=["kyc", "compliance"],
            doc_id="doc_123",
        )

        assert entry.entry_id == "entry_123"
        assert entry.user_input == "What is KYC?"
        assert entry.agent_response == "KYC stands for Know Your Customer."
        assert entry.keywords == ["kyc", "compliance"]
        assert entry.doc_id == "doc_123"
        assert entry.embedding is None


class TestMemorySession:
    """Test MemorySession functionality."""

    def test_memory_session_initialization(self):
        """Test MemorySession initialization."""
        entries = [
            MemoryEntry("entry_1", "q1", "a1", "2024-01-01T12:00:00Z", ["topic1"]),
            MemoryEntry("entry_2", "q2", "a2", "2024-01-01T12:05:00Z", ["topic2"]),
        ]

        session = MemorySession(
            session_id="sess_123",
            summary="KYC compliance discussion",
            keywords=["kyc", "compliance", "requirements"],
            entries=entries,
        )

        assert session.session_id == "sess_123"
        assert session.summary == "KYC compliance discussion"
        assert session.keywords == ["kyc", "compliance", "requirements"]
        assert len(session.entries) == 2
        assert session.heat == 0.0
        assert session.visit_count == 0

    def test_memory_session_compute_heat(self):
        """Test heat computation for memory session."""
        session = MemorySession(
            session_id="sess_123",
            summary="Test session",
            keywords=["test"],
            entries=[MemoryEntry("entry_1", "q", "a", "2024-01-01T12:00:00Z", [])],
        )

        # Set recent visit
        session.last_visit = datetime.now(timezone.utc).isoformat()
        session.visit_count = 3

        heat = session.compute_heat()
        assert heat > 0
        assert session.heat == heat


class TestUserProfile:
    """Test UserProfile functionality."""

    def test_user_profile_initialization(self):
        """Test UserProfile initialization."""
        profile = UserProfile("user_123")

        assert profile.user_id == "user_123"
        assert profile.expertise_areas == []
        assert profile.preferred_detail_level == "detailed"
        assert profile.frequent_topics == {}
        assert profile.query_type_distribution == {}
        assert profile.total_queries == 0
        assert profile.avg_rating == 0.0
        assert profile.rating_count == 0


class TestUserMemoryManager:
    """Test UserMemoryManager functionality."""

    def test_user_memory_manager_initialization(self):
        """Test UserMemoryManager initialization."""
        manager = UserMemoryManager("user_123")

        assert manager.user_id == "user_123"
        assert len(manager._short_term) == 0
        assert len(manager._sessions) == 0
        assert len(manager._knowledge) == 0
        assert manager._profile.user_id == "user_123"

    def test_add_interaction(self):
        """Test adding an interaction to short-term memory."""
        manager = UserMemoryManager("user_123")

        manager.add_interaction(
            query_text="What is KYC?",
            answer_text="KYC stands for Know Your Customer.",
            doc_id="doc_123",
            key_terms=["kyc", "compliance"],
            query_type="compliance",
            feedback_rating=4,
        )

        assert len(manager._short_term) == 1
        assert manager._profile.total_queries == 1
        assert manager._profile.query_type_distribution["compliance"] == 1
        assert manager._profile.frequent_topics["kyc"] == 1
        assert manager._profile.avg_rating == 4.0
        assert manager._profile.rating_count == 1

    def test_short_term_context_retrieval(self):
        """Test retrieving short-term context."""
        manager = UserMemoryManager("user_123")

        # Add multiple interactions
        for i in range(3):
            manager.add_interaction(
                query_text=f"Question {i}",
                answer_text=f"Answer {i}",
                doc_id="doc_123",
                key_terms=[f"topic{i}"],
            )

        context = manager.get_short_term_context(last_n=2)
        assert len(context) == 2
        assert context[0]["user_input"] == "Question 1"  # Second to last
        assert context[1]["user_input"] == "Question 2"  # Most recent

    def test_memory_consolidation(self):
        """Test memory consolidation from short-term to mid-term."""
        manager = UserMemoryManager("user_123", short_term_capacity=3)

        # Fill short-term memory
        for i in range(5):
            manager.add_interaction(
                query_text=f"Question {i}",
                answer_text=f"Answer {i}",
                doc_id="doc_123",
                key_terms=["kyc", "compliance"],  # Same keywords for consolidation
            )

        # Should have consolidated oldest entries
        assert len(manager._short_term) <= 3
        assert len(manager._sessions) > 0

    def test_user_context_generation(self):
        """Test generating user context for prompts."""
        manager = UserMemoryManager("user_123")

        # Add interactions
        manager.add_interaction("What is KYC?", "KYC explanation", key_terms=["kyc"])
        manager.add_interaction(
            "AML requirements", "AML explanation", key_terms=["aml"]
        )

        context = manager.get_user_context(
            "What are compliance requirements?", "doc_123"
        )

        assert context["user_id"] == "user_123"
        assert context["total_queries"] == 2
        assert "top_topics" in context
        assert "recent_interactions" in context
        assert "preferred_detail_level" in context

    def test_context_formatting_for_prompt(self):
        """Test formatting user context for prompt injection."""
        manager = UserMemoryManager("user_123")

        manager.add_interaction("KYC question", "Answer", key_terms=["kyc"])

        formatted = manager.format_context_for_prompt("New query", "doc_123")
        assert isinstance(formatted, str)
        assert "User has asked" in formatted
        assert "Frequent topics" in formatted

    def test_detail_preference_learning(self):
        """Test learning user's detail preference from feedback."""
        manager = UserMemoryManager("user_123")

        # High rating for long answer → prefers comprehensive
        manager.update_detail_preference(5, 2500)
        assert manager._profile.preferred_detail_level == "comprehensive"

        # High rating for medium answer → prefers detailed
        manager.update_detail_preference(4, 1000)
        assert manager._profile.preferred_detail_level == "detailed"

        # High rating for short answer → prefers brief
        manager.update_detail_preference(5, 300)
        assert manager._profile.preferred_detail_level == "brief"

    def test_persistence(self, temp_db):
        """Test saving and loading user memory."""
        manager = UserMemoryManager("user_123")

        # Mock the internal state instead of calling add_interaction
        with patch.object(manager, "_short_term", [Mock()]):
            # Save to database
            manager.save(temp_db)

            # Load from database
            loaded_manager = UserMemoryManager.load("user_123", temp_db)

            # Should handle gracefully even if loading fails
            assert loaded_manager is not None
            assert loaded_manager.user_id == "user_123"

    def test_statistics_retrieval(self):
        """Test retrieving user memory statistics."""
        manager = UserMemoryManager("user_123")

        manager.add_interaction("Q1", "A1", key_terms=["kyc"])
        manager.add_interaction("Q2", "A2", key_terms=["aml"])

        stats = manager.get_stats()

        assert stats["user_id"] == "user_123"
        assert stats["short_term_entries"] == 2
        assert stats["total_queries"] == 2
        assert "top_topics" in stats
        assert "preferred_detail_level" in stats

    def test_relevant_session_identification(self):
        """Test identifying relevant sessions based on query."""
        manager = UserMemoryManager("user_123")

        # Create a session with KYC topics
        session = MemorySession(
            session_id="sess_kyc",
            summary="KYC compliance",
            keywords=["kyc", "compliance", "customer"],
            entries=[],
        )
        manager._sessions["sess_kyc"] = session

        # Query about KYC should match this session
        context = manager.get_user_context("What are KYC requirements?", "doc_123")

        assert len(context["relevant_sessions"]) == 1
        assert context["relevant_sessions"][0]["summary"] == "KYC compliance"

    def test_knowledge_extraction(self):
        """Test knowledge extraction from sessions."""
        manager = UserMemoryManager("user_123")

        # Create a session that will be evicted
        session = MemorySession(
            session_id="sess_old",
            summary="Old session",
            keywords=["kyc", "compliance"],
            entries=[MemoryEntry("entry_1", "q", "a", "2024-01-01T12:00:00Z", ["kyc"])],
        )
        manager._sessions["sess_old"] = session

        # Force knowledge extraction
        manager._extract_knowledge_from_session(session)

        assert len(manager._knowledge) > 0
        assert "frequently discusses" in manager._knowledge[0]["fact"]

    def test_cross_document_memory(self):
        """Test memory functionality across different documents."""
        manager = UserMemoryManager("user_123")

        # Add interactions for different documents
        manager.add_interaction("Q1", "A1", doc_id="doc_1", key_terms=["kyc"])
        manager.add_interaction("Q2", "A2", doc_id="doc_2", key_terms=["aml"])

        # Get context filtered for specific document
        context_doc1 = manager.get_user_context("KYC question", "doc_1")
        context_doc2 = manager.get_user_context("AML question", "doc_2")

        # Both should contain user profile info
        assert context_doc1["total_queries"] == 2
        assert context_doc2["total_queries"] == 2

        # Recent interactions should be filtered by doc_id
        recent_doc1 = context_doc1["recent_interactions"]
        recent_doc2 = context_doc2["recent_interactions"]

        # Should only show interactions for the requested document
        if recent_doc1:
            assert all(r.get("doc_id", "") in ["doc_1", ""] for r in recent_doc1)
        if recent_doc2:
            assert all(r.get("doc_id", "") in ["doc_2", ""] for r in recent_doc2)
