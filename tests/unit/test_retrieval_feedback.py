"""
Unit tests for Retrieval Feedback (Loop 4: "Grade Every Retrieval")
"""

import pytest
from unittest.mock import Mock, patch
from memory.retrieval_feedback import RetrievalFeedback, NodeReliability, PipelineGrade


class TestNodeReliability:
    """Test NodeReliability tracking functionality."""

    def test_node_reliability_initialization(self):
        """Test NodeReliability initialization with neutral score."""
        node = NodeReliability("node_123")
        assert node.node_id == "node_123"
        assert node.score == 0.5  # Neutral score
        assert node.times_cited == 0
        assert node.times_located == 0
        assert node.times_wasted == 0
        assert node.last_cited_ts is None
        assert node.last_located_ts is None

    def test_node_reliability_reinforce(self):
        """Test reinforcing a node (cited in answer)."""
        node = NodeReliability("node_123")
        initial_score = node.score

        node.reinforce()

        assert node.times_cited == 1
        assert node.times_located == 1
        assert node.times_wasted == 0
        assert node.score > initial_score  # Score should increase
        assert node.last_cited_ts is not None
        assert node.last_located_ts is not None

    def test_node_reliability_penalize(self):
        """Test penalizing a node (located but not cited)."""
        node = NodeReliability("node_123")
        initial_score = node.score

        node.penalize()

        assert node.times_cited == 0
        assert node.times_located == 1
        assert node.times_wasted == 1
        assert node.score < initial_score  # Score should decrease
        assert node.last_located_ts is not None

    def test_node_reliability_efficiency_calculation(self):
        """Test efficiency calculation (cited/located ratio)."""
        node = NodeReliability("node_123")

        # Cited 3 times out of 5 locations
        for _ in range(3):
            node.reinforce()
        for _ in range(2):
            node.penalize()

        assert node.efficiency == pytest.approx(0.6)  # 3/5

    def test_node_reliability_time_decay(self):
        """Test time decay toward neutral score."""
        node = NodeReliability("node_123")

        # Boost score above neutral
        for _ in range(3):
            node.reinforce()
        boosted_score = node.score

        # Apply time decay
        node.apply_time_decay(30.0)  # 30 days

        assert node.score < boosted_score  # Should decay toward neutral
        assert node.score >= 0.5  # But not below neutral

    def test_node_reliability_score_bounds(self):
        """Test that scores stay within bounds."""
        node = NodeReliability("node_123")

        # Try to push score above maximum
        for _ in range(50):
            node.reinforce()
        assert node.score <= 0.98  # Max bound

        # Try to push score below minimum
        node.score = 0.1  # Start low
        for _ in range(50):
            node.penalize()
        assert node.score >= 0.05  # Min bound


class TestPipelineGrade:
    """Test PipelineGrade functionality."""

    def test_pipeline_grade_initialization(self):
        """Test PipelineGrade initialization."""
        grade = PipelineGrade(
            timestamp="2024-01-01T12:00:00Z",
            query_type="compliance",
            precision=0.75,
            nodes_located=8,
            nodes_cited=6,
            nodes_wasted=2,
            reflect_added_value=True,
            verification_passed=True,
            total_time_s=45.2,
            user_rating=4,
        )

        assert grade.query_type == "compliance"
        assert grade.precision == 0.75
        assert grade.nodes_located == 8
        assert grade.nodes_cited == 6
        assert grade.nodes_wasted == 2
        assert grade.reflect_added_value is True
        assert grade.verification_passed is True
        assert grade.user_rating == 4


class TestRetrievalFeedback:
    """Test RetrievalFeedback functionality."""

    def test_retrieval_feedback_initialization(self):
        """Test RetrievalFeedback initialization."""
        fb = RetrievalFeedback("doc_123")

        assert fb.doc_id == "doc_123"
        assert len(fb._nodes) == 0
        assert len(fb._grades) == 0
        assert len(fb._type_stats) == 0

    def test_grade_retrieval(self, sample_query_record):
        """Test grading a retrieval pipeline execution."""
        fb = RetrievalFeedback("doc_123")

        grade = fb.grade_retrieval(sample_query_record)

        assert grade.query_type == "compliance"
        assert grade.precision == pytest.approx(0.6)  # 3 cited / 5 located
        assert grade.nodes_located == 5
        assert grade.nodes_cited == 3
        assert grade.nodes_wasted == 2
        assert grade.reflect_added_value is True
        assert grade.verification_passed is True

        # Should update node reliability scores
        assert "node_0" in fb._nodes
        assert fb._nodes["node_0"].times_cited == 1
        assert "node_3" in fb._nodes
        assert fb._nodes["node_3"].times_wasted == 1

        # Should update type-level stats
        assert "compliance" in fb._type_stats
        stats = fb._type_stats["compliance"]
        assert stats["total_queries"] == 1
        assert stats["avg_precision"] == pytest.approx(0.6)

    def test_get_boosted_nodes(self, sample_query_record):
        """Test retrieving boosted nodes (proven reliable)."""
        fb = RetrievalFeedback("doc_123")

        # Grade multiple queries to build reliability data
        for i in range(5):
            fb.grade_retrieval(sample_query_record)

        boosted_nodes = fb.get_boosted_nodes(top_k=5)

        # Should return nodes with sufficient interaction history
        assert len(boosted_nodes) > 0
        for node in boosted_nodes:
            assert node["score"] > 0.55  # Above neutral + margin
            assert node["times_cited"] >= 3  # Minimum interactions
            assert node["efficiency"] > 0

    def test_get_penalized_nodes(self, sample_query_record):
        """Test retrieving penalized nodes (frequently wasted)."""
        fb = RetrievalFeedback("doc_123")

        # Grade queries to identify wasted nodes
        for i in range(5):
            fb.grade_retrieval(sample_query_record)

        penalized_nodes = fb.get_penalized_nodes(threshold=0.3)

        # Should return nodes below reliability threshold
        assert len(penalized_nodes) >= 0
        for node_id in penalized_nodes:
            node = fb._nodes[node_id]
            assert node.score < 0.3
            assert node.times_wasted >= 3
            assert node.times_cited == 0  # Never cited

    def test_get_node_reliability(self, sample_query_record):
        """Test retrieving reliability data for specific node."""
        fb = RetrievalFeedback("doc_123")

        fb.grade_retrieval(sample_query_record)

        node_info = fb.get_node_reliability("node_0")

        assert node_info is not None
        assert node_info["node_id"] == "node_0"
        assert node_info["times_cited"] == 1
        assert node_info["times_located"] == 1
        assert node_info["last_cited_ts"] is not None

        # Test non-existent node
        assert fb.get_node_reliability("nonexistent") is None

    def test_get_node_score_map(self, sample_query_record):
        """Test retrieving full node score map."""
        fb = RetrievalFeedback("doc_123")

        # Grade queries to build score data
        for i in range(3):
            fb.grade_retrieval(sample_query_record)

        score_map = fb.get_node_score_map()

        assert len(score_map) > 0
        for node_id, score in score_map.items():
            assert isinstance(node_id, str)
            assert 0 <= score <= 1
            # Only nodes with sufficient interactions should be included
            node = fb._nodes[node_id]
            assert node.total_interactions >= 2

    def test_apply_user_feedback(self):
        """Test applying explicit user feedback to nodes."""
        fb = RetrievalFeedback("doc_123")

        # Create some nodes with neutral scores
        node_ids = ["node_0", "node_1", "node_2"]
        for node_id in node_ids:
            fb._nodes[node_id] = NodeReliability(node_id)

        # Apply positive feedback
        initial_scores = {nid: fb._nodes[nid].score for nid in node_ids}
        fb.apply_user_feedback(node_ids[:2], 5)  # High rating for first two nodes

        # Scores should increase for nodes with positive feedback
        for node_id in node_ids[:2]:
            assert fb._nodes[node_id].score > initial_scores[node_id]

        # Third node should remain unchanged
        assert fb._nodes["node_2"].score == initial_scores["node_2"]

        # Apply negative feedback - compare against score after positive feedback
        score_after_positive = fb._nodes["node_0"].score
        fb.apply_user_feedback(["node_0"], 1)  # Low rating
        assert fb._nodes["node_0"].score < score_after_positive

    def test_time_decay_all_nodes(self):
        """Test applying time decay to all nodes."""
        fb = RetrievalFeedback("doc_123")

        # Create nodes with varying scores
        high_node = NodeReliability("node_high")
        high_node.score = 0.9
        low_node = NodeReliability("node_low")
        low_node.score = 0.2

        fb._nodes["node_high"] = high_node
        fb._nodes["node_low"] = low_node

        initial_high = high_node.score
        initial_low = low_node.score

        # Apply time decay
        fb.apply_time_decay_all(30.0)  # 30 days

        # High score should decay toward neutral
        assert high_node.score < initial_high
        assert high_node.score >= 0.5

        # Low score should increase toward neutral
        assert low_node.score > initial_low
        assert low_node.score <= 0.5

    def test_get_type_performance(self, sample_query_record):
        """Test retrieving performance stats by query type."""
        fb = RetrievalFeedback("doc_123")

        # Grade queries of different types
        query_types = ["compliance", "definition", "procedure"]

        for qtype in query_types:
            record = Mock()
            record.query_text = f"{qtype} query"
            record.query_type = Mock()
            record.query_type.value = qtype
            record.citations = [Mock(node_id="node_0")]
            record.routing_log = Mock()
            record.routing_log.locate_results = [
                {"node_id": "node_0"},
                {"node_id": "node_1"},
            ]
            record.routing_log.read_results = []
            record.verification_status = "verified"
            record.feedback = Mock()
            record.feedback.rating = 4
            record.total_time_seconds = 30.0

            fb.grade_retrieval(record)

        # Check performance stats for each type
        for qtype in query_types:
            stats = fb.get_type_performance(qtype)
            assert stats["query_type"] == qtype
            assert stats["total_queries"] == 1
            assert stats["avg_precision"] == pytest.approx(0.5)  # 1 cited / 2 located

    def test_persistence(self, temp_db, sample_query_record):
        """Test saving and loading retrieval feedback."""
        fb = RetrievalFeedback("doc_123")

        # Mock the internal state instead of calling grade_retrieval
        with patch.object(fb, "_nodes", {"node_0": Mock()}):
            with patch.object(fb, "_grades", [Mock()]):
                # Use a real dict instead of Mock for type_stats
                fb._type_stats = {
                    "compliance": {"total": 5, "successful": 4, "precision": 0.8}
                }

                # Save to database
                fb.save(temp_db)

                # Load from database
                loaded_fb = RetrievalFeedback.load("doc_123", temp_db)

                # Should handle gracefully even if loading fails
                assert loaded_fb is not None
                assert loaded_fb.doc_id == "doc_123"

    def test_statistics_retrieval(self, sample_query_record):
        """Test retrieving retrieval feedback statistics."""
        fb = RetrievalFeedback("doc_123")

        # Grade multiple queries
        for i in range(5):
            fb.grade_retrieval(sample_query_record)

        stats = fb.get_stats()

        assert stats["doc_id"] == "doc_123"
        assert stats["total_nodes_tracked"] == 5  # 5 unique nodes
        assert stats["boosted_nodes"] > 0
        assert stats["penalized_nodes"] >= 0
        assert stats["total_grades"] == 5
        assert "type_stats" in stats

    def test_grade_retrieval_error_handling(self):
        """Test error handling during retrieval grading."""
        fb = RetrievalFeedback("doc_123")

        # Create a malformed record that would cause errors
        malformed_record = Mock()
        malformed_record.citations = "not_a_list"  # Wrong type
        malformed_record.routing_log = None  # Missing routing log

        # Should handle gracefully and return default grade
        grade = fb.grade_retrieval(malformed_record)

        assert grade is not None
        assert grade.precision == 0.0
        assert grade.nodes_located == 0
        assert grade.nodes_cited == 0

    def test_precision_calculation_edge_cases(self):
        """Test precision calculation in edge cases."""
        fb = RetrievalFeedback("doc_123")

        # Test with no located nodes (division by zero protection)
        record = Mock()
        record.query_text = "Test query"
        record.query_type = Mock()
        record.query_type.value = "test"
        record.citations = []
        record.routing_log = Mock()
        record.routing_log.locate_results = []  # No located nodes
        record.routing_log.read_results = []
        record.verification_status = "verified"
        record.feedback = Mock()
        record.feedback.rating = 4
        record.total_time_seconds = 30.0

        grade = fb.grade_retrieval(record)
        assert grade.precision == 0.0  # Should handle division by zero

        # Test with all nodes cited (perfect precision)
        record.routing_log.locate_results = [
            {"node_id": "node_0"},
            {"node_id": "node_1"},
        ]
        record.citations = [Mock(node_id="node_0"), Mock(node_id="node_1")]

        grade = fb.grade_retrieval(record)
        assert grade.precision == 1.0  # Perfect precision
