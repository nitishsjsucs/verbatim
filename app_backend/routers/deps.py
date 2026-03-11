"""
Shared dependency accessors for routers.

Lazily imports singleton getters from main to avoid circular imports.
Each function is called at request time, not at import time.
"""


def get_tree_store():
    from app_backend.main import get_tree_store as _f
    return _f()


def get_actionable_store():
    from app_backend.main import get_actionable_store as _f
    return _f()


def get_actionable_extractor():
    from app_backend.main import get_actionable_extractor as _f
    return _f()


def get_qa_engine():
    from app_backend.main import get_qa_engine as _f
    return _f()


def get_query_store():
    from app_backend.main import get_query_store as _f
    return _f()


def get_corpus_store():
    from app_backend.main import get_corpus_store as _f
    return _f()


def get_corpus_qa_engine():
    from app_backend.main import get_corpus_qa_engine as _f
    return _f()


def get_ingestion_pipeline():
    from app_backend.main import get_ingestion_pipeline as _f
    return _f()


def get_conversation_store():
    from app_backend.main import get_conversation_store as _f
    return _f()


def get_benchmark_store():
    from app_backend.main import get_benchmark_store as _f
    return _f()


def get_retrieval_mode():
    from app_backend.main import get_retrieval_mode as _f
    return _f()


def get_runtime_config():
    from app_backend.main import _runtime_config
    return _runtime_config


def get_load_persisted_runtime_config():
    from app_backend.main import _load_persisted_runtime_config as _f
    return _f()


def generate_actionable_id():
    from app_backend.main import _generate_actionable_id as _f
    return _f()
