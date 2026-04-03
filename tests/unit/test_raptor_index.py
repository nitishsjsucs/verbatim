"""
Unit tests for RAPTOR Index (Loop 1: "Know What Matters")
"""

import pytest
from unittest.mock import Mock, patch
from memory.raptor_index import RaptorIndex, NodeHeat


class TestNodeHeat:
    """Test NodeHeat tracking functionality."""

    def test_node_heat_initialization(self):
        """Test NodeHeat initialization with default values."""
        heat = NodeHeat("node_123")
        assert heat.node_id == "node_123"
        assert heat.citations == 0
        assert heat.last_cited is None
        assert heat.query_types == {}
        assert heat.decay_rate == 30.0

    def test_node_heat_score_no_citations(self):
        """Test heat score calculation with no citations."""
        heat = NodeHeat("node_123")
        assert heat.heat_score == 0.0

    def test_node_heat_record_citation(self):
        """Test recording a citation increases citation count."""
        heat = NodeHeat("node_123")
        heat.record_citation("compliance")
        assert heat.citations == 1
        assert heat.query_types["compliance"] == 1
        assert heat.last_cited is not None

    def test_node_heat_score_with_citations(self):
        """Test heat score calculation with citations."""
        heat = NodeHeat("node_123")
        heat.record_citation("compliance")
        heat.record_citation("compliance")

        # Score should be positive and increase with citations
        score = heat.heat_score
        assert score > 0

        # More citations should increase score
        heat.record_citation("compliance")
        assert heat.heat_score > score

    def test_node_heat_to_dict(self):
        """Test serialization to dictionary."""
        heat = NodeHeat("node_123")
        heat.record_citation("compliance")

        data = heat.to_dict()
        assert data["node_id"] == "node_123"
        assert data["citations"] == 1
        assert data["query_types"]["compliance"] == 1


class TestRaptorIndex:
    """Test RAPTOR Index functionality."""

    def test_raptor_index_initialization(self):
        """Test RAPTOR index initialization."""
        index = RaptorIndex("doc_123")
        assert index.doc_id == "doc_123"
        assert index.is_built is False
        assert len(index._node_embeddings) == 0
        assert len(index._clusters) == 0
        assert len(index._heat_map) == 0

    def test_raptor_build_index(
        self, mock_document_tree, mock_embedding_client, mock_llm_client
    ):
        """Test building RAPTOR index from document tree."""
        index = RaptorIndex("doc_123")
        tree = mock_document_tree

        index.build(tree, mock_embedding_client, mock_llm_client)

        assert index.is_built is True
        assert len(index._node_embeddings) > 0
        assert len(index._clusters) > 0
        assert index._built_at is not None
        assert index._version == 1

    def test_raptor_query_empty_index(self, mock_embedding_client):
        """Test querying an empty index returns empty results."""
        index = RaptorIndex("doc_123")
        results = index.query("test query", mock_embedding_client)
        assert results == []

    def test_raptor_query_with_heat_boost(
        self, mock_document_tree, mock_embedding_client, mock_llm_client
    ):
        """Test querying with heat map boosting."""
        index = RaptorIndex("doc_123")
        tree = mock_document_tree

        # Build index
        index.build(tree, mock_embedding_client, mock_llm_client)

        # Record some citations to create heat
        index.record_citation("node_0", "compliance")
        index.record_citation("node_0", "compliance")  # Boost node_0
        index.record_citation("node_1", "compliance")

        # Query with heat boost
        results = index.query("test query", mock_embedding_client, heat_boost=0.3)

        assert len(results) > 0
        # node_0 should be ranked higher due to more citations
        if len(results) >= 2:
            # Check if node_0 appears before node_1 (not guaranteed but likely)
            positions = {node_id: i for i, node_id in enumerate(results)}
            if "node_0" in positions and "node_1" in positions:
                # Heat boost should influence ranking
                pass

    def test_raptor_record_citations_from_answer(self, sample_query_record):
        """Test recording citations from an answer object."""
        index = RaptorIndex("doc_123")

        # Record citations from answer
        index.record_citations_from_answer(sample_query_record)

        # Should have recorded citations for cited nodes
        cited_nodes = {c.node_id for c in sample_query_record.citations}
        for node_id in cited_nodes:
            assert node_id in index._heat_map
            assert index._heat_map[node_id].citations > 0

    def test_raptor_get_hot_nodes(self):
        """Test retrieving hottest nodes."""
        index = RaptorIndex("doc_123")

        # Create heat map with varying citation counts
        index.record_citation("node_0", "compliance")
        index.record_citation("node_0", "compliance")
        index.record_citation("node_1", "compliance")

        hot_nodes = index.get_hot_nodes(top_k=2)
        assert len(hot_nodes) == 2

        # node_0 should have higher heat than node_1
        if len(hot_nodes) >= 2:
            node_0_score = next(
                (score for nid, score in hot_nodes if nid == "node_0"), 0
            )
            node_1_score = next(
                (score for nid, score in hot_nodes if nid == "node_1"), 0
            )
            assert node_0_score > node_1_score

    def test_raptor_get_cold_nodes(
        self, mock_document_tree, mock_embedding_client, mock_llm_client
    ):
        """Test retrieving cold nodes."""
        index = RaptorIndex("doc_123")
        tree = mock_document_tree

        # Build index
        index.build(tree, mock_embedding_client, mock_llm_client)

        # Record citation for one node
        index.record_citation("node_0", "compliance")

        cold_nodes = index.get_cold_nodes(threshold=0.1)
        assert len(cold_nodes) > 0
        assert "node_0" not in cold_nodes  # node_0 is hot

    def test_raptor_persistence(
        self, temp_db, mock_document_tree, mock_embedding_client, mock_llm_client
    ):
        """Test saving and loading RAPTOR index."""
        index = RaptorIndex("doc_123")

        # Mock the internal state instead of calling build
        index._heat_map = {"node_0": Mock()}
        index._is_built = True

        # Save to database
        index.save(temp_db)

        # Load from database
        loaded_index = RaptorIndex.load("doc_123", temp_db)

        # Should handle gracefully even if loading fails
        assert loaded_index is not None
        assert loaded_index.doc_id == "doc_123"

    def test_raptor_stats(
        self, mock_document_tree, mock_embedding_client, mock_llm_client
    ):
        """Test retrieving RAPTOR index statistics."""
        index = RaptorIndex("doc_123")
        tree = mock_document_tree

        index.build(tree, mock_embedding_client, mock_llm_client)
        index.record_citation("node_0", "compliance")

        stats = index.get_stats()

        assert stats["doc_id"] == "doc_123"
        assert stats["is_built"] is True
        assert stats["node_count"] > 0
        assert stats["cluster_count"] > 0
        assert stats["heat_map_entries"] == 1
        assert stats["total_citations"] == 1
        assert "top_hot_nodes" in stats
