"""Shared singleton accessors for the Govinda V2 backend.

Routers and services import these getters instead of reaching into main.py.
The actual singleton instances are set by main._init_singletons() at startup.
"""
import logging

logger = logging.getLogger("backend")

# ---------------------------------------------------------------------------
# Singleton holders — populated by main._init_singletons()
# ---------------------------------------------------------------------------
_tree_store = None
_qa_engine = None
_ingestion_pipeline = None
_query_store = None
_corpus_store = None
_corpus_qa_engine = None
_actionable_store = None
_actionable_extractor = None
_conversation_store = None
_benchmark_store = None


def get_tree_store():
    return _tree_store


def get_qa_engine():
    return _qa_engine


def get_ingestion_pipeline():
    return _ingestion_pipeline


def get_query_store():
    return _query_store


def get_corpus_store():
    return _corpus_store


def get_corpus_qa_engine():
    return _corpus_qa_engine


def get_actionable_store():
    return _actionable_store


def get_actionable_extractor():
    return _actionable_extractor


def get_conversation_store():
    return _conversation_store


def get_benchmark_store():
    return _benchmark_store
