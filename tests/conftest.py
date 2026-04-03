"""
Test configuration and fixtures for GOVINDA V2 memory system tests.
"""

import pytest
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, MagicMock
import sys
import os

# Add project root to Python path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from memory.memory_manager import MemoryManager
from memory.user_memory import UserMemoryManager
from memory.raptor_index import RaptorIndex
from memory.query_intelligence import QueryIntelligence
from memory.retrieval_feedback import RetrievalFeedback
from memory.r2r_fallback import R2RFallback
from memory.memory_diagnostics import MemoryContribution, MemoryHealthChecker


@pytest.fixture
def temp_db():
    """Create a temporary MongoDB-like database mock."""
    db = MagicMock()

    # Mock collections with proper MongoDB method support
    collections = {}

    def mock_collection(name):
        if name not in collections:
            collection = MagicMock()
            # Mock MongoDB collection methods
            collection.find_one = MagicMock(return_value=None)
            collection.find = MagicMock(
                return_value=MagicMock(
                    sort=MagicMock(
                        return_value=MagicMock(limit=MagicMock(return_value=[]))
                    )
                )
            )
            collection.count_documents = MagicMock(return_value=0)

            # Mock the replace_one method to handle arguments properly
            def mock_replace_one(filter, replacement, upsert=False):
                return Mock(acknowledged=True)

            collection.replace_one = mock_replace_one
            collection.update_one = MagicMock()
            collection.insert_one = MagicMock()
            collection.delete_one = MagicMock()
            collections[name] = collection
        return collections[name]

    db.__getitem__ = mock_collection
    return db


@pytest.fixture
def mock_embedding_client():
    """Mock embedding client that returns predictable vectors."""
    client = Mock()

    def mock_embed(text):
        # Generate deterministic embedding based on text hash
        import hashlib

        hash_val = int(hashlib.md5(text.encode()).hexdigest()[:8], 16)
        # Create a 384-dim vector with deterministic values
        return [float((hash_val + i) % 1000) / 1000.0 for i in range(384)]

    def mock_embed_batch(texts):
        return [mock_embed(text) for text in texts]

    client.embed = mock_embed
    client.embed_batch = mock_embed_batch
    return client


@pytest.fixture
def mock_llm_client():
    """Mock LLM client for testing."""
    client = Mock()

    def mock_chat(messages, max_tokens=None, reasoning_effort=None):
        # Return a simple response based on the last user message
        user_message = None
        for msg in messages:
            if msg.get("role") == "user":
                user_message = msg.get("content", "")

        if "summary" in user_message.lower():
            return "This is a summary of the provided content."
        elif "cluster" in user_message.lower():
            return "Cluster summary: This cluster contains related nodes."
        else:
            return "Mock LLM response for testing."

    client.chat = mock_chat
    return client


@pytest.fixture
def mock_document_tree():
    """Create a mock document tree for testing."""
    tree = Mock()
    tree.doc_id = "test_doc_123"
    tree.doc_name = "Test Document"
    tree.node_count = 50
    tree.total_pages = 25

    # Mock nodes
    nodes = {}
    for i in range(10):
        node_id = f"node_{i}"
        node = Mock()
        node.node_id = node_id
        node.title = f"Test Node {i}"
        node.summary = f"Summary of node {i}"
        node.description = f"Description of node {i}"
        node.text = f"Full text content for node {i}"
        node.topics = ["topic_a", "topic_b"]
        node.token_count = 500
        node.page_range_str = f"{i * 2 + 1}-{i * 2 + 2}"
        nodes[node_id] = node

    tree._node_index = nodes
    tree.get_node = lambda nid: nodes.get(nid)
    tree._all_nodes = lambda: list(nodes.values())

    return tree


@pytest.fixture
def memory_manager(temp_db, mock_embedding_client, mock_llm_client):
    """Create a MemoryManager instance for testing."""
    mm = MemoryManager()
    mm.initialize(
        db=temp_db, embedding_client=mock_embedding_client, llm_client=mock_llm_client
    )
    return mm


@pytest.fixture
def sample_query_record():
    """Create a sample query record for testing learning loops."""
    record = Mock()
    record.query_text = "What are the compliance requirements for KYC?"
    record.answer_text = "KYC compliance requires customer identification, verification, and ongoing monitoring."
    record.query_type = Mock()
    record.query_type.value = "compliance"
    record.key_terms = ["kyc", "compliance", "requirements"]
    record.total_time_seconds = 45.2
    record.verification_status = "verified"

    # Mock citations
    citations = []
    for i in range(3):
        citation = Mock()
        citation.node_id = f"node_{i}"
        citation.title = f"Citation {i}"
        citations.append(citation)
    record.citations = citations

    # Mock routing log
    routing_log = Mock()
    routing_log.locate_results = [
        {"node_id": "node_0", "score": 0.9},
        {"node_id": "node_1", "score": 0.8},
        {"node_id": "node_2", "score": 0.7},
        {"node_id": "node_3", "score": 0.6},  # Not cited
        {"node_id": "node_4", "score": 0.5},  # Not cited
    ]
    routing_log.read_results = [
        {"node_id": "node_0", "source": "direct"},
        {"node_id": "node_1", "source": "direct"},
        {"node_id": "node_2", "source": "reflection_gap_fill"},
    ]
    routing_log.total_nodes_located = 5
    record.routing_log = routing_log

    # Mock feedback
    feedback = Mock()
    feedback.rating = 4
    record.feedback = feedback

    return record


@pytest.fixture
def memory_contribution():
    """Create a MemoryContribution instance for testing."""
    return MemoryContribution(
        query_id="test_query_123",
        doc_id="test_doc_123",
        user_id="test_user",
        timestamp="2024-01-01T12:00:00Z",
        query_type="compliance",
        query_text_preview="What are the compliance requirements...",
    )


@pytest.fixture
def test_doc_id():
    """Standard test document ID."""
    return "test_doc_123"


@pytest.fixture
def test_user_id():
    """Standard test user ID."""
    return "test_user"


@pytest.fixture
def sample_queries():
    """Sample queries for testing query intelligence."""
    return [
        "What are the KYC requirements?",
        "Explain AML compliance procedures",
        "What is the process for customer due diligence?",
        "How to verify customer identity?",
        "What are the reporting requirements for suspicious transactions?",
    ]
