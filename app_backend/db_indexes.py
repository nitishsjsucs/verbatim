"""Database index definitions for all MongoDB collections.

Run once at startup or via `python -m app_backend.db_indexes` to ensure
indexes exist. create_index() is idempotent — safe to call repeatedly.

Phase 6 of the Architecture Optimization Plan.
"""
import logging
from pymongo import ASCENDING, DESCENDING

logger = logging.getLogger("backend")


def ensure_indexes(db) -> dict[str, list[str]]:
    """Create all application indexes. Returns {collection: [index_names]}."""
    created: dict[str, list[str]] = {}

    def _idx(col_name: str, keys, **kwargs):
        col = db[col_name]
        name = col.create_index(keys, **kwargs)
        created.setdefault(col_name, []).append(name)

    # ── teams ──
    _idx("teams", [("name", ASCENDING)], unique=True)
    _idx("teams", [("parent_name", ASCENDING)])
    _idx("teams", [("is_system", ASCENDING)])
    _idx("teams", [("path", ASCENDING)])
    _idx("teams", [("order", ASCENDING)])

    # ── actionables (legacy nested-doc format) ──
    _idx("actionables", [("doc_id", ASCENDING)], unique=True)

    # ── actionables_flat (Phase 2 — one doc per actionable) ──
    _idx("actionables_flat", [("actionable_id", ASCENDING)], unique=True, sparse=True)
    _idx("actionables_flat", [("doc_id", ASCENDING)])
    _idx("actionables_flat", [("workstream", ASCENDING)])
    _idx("actionables_flat", [("task_status", ASCENDING)])
    _idx("actionables_flat", [("is_delayed", ASCENDING)])
    _idx("actionables_flat", [("workstream", ASCENDING), ("task_status", ASCENDING)])

    # ── team_chats ──
    _idx("team_chats", [("team", ASCENDING), ("channel", ASCENDING)], unique=True)

    # ── global_chats ──
    _idx("global_chats", [("channel", ASCENDING)], unique=True)

    # ── chat_read_cursors ──
    _idx("chat_read_cursors", [("role", ASCENDING), ("team", ASCENDING)], unique=True)

    # ── chat_channel_names ──
    _idx("chat_channel_names", [("channel", ASCENDING)], unique=True)

    # ── dropdown_configs ── (_id is already indexed by MongoDB)

    # ── residual_risk_matrix ── (small collection, no extra indexes needed)

    # ── runtime_config ──
    _idx("runtime_config", [("key", ASCENDING)], unique=True)

    # ── counters ──
    _idx("counters", [("_id", ASCENDING)])  # already indexed, but explicit

    # ── queries ──
    _idx("queries", [("doc_id", ASCENDING)])
    _idx("queries", [("timestamp", DESCENDING)])

    # ── conversations ──
    _idx("conversations", [("doc_id", ASCENDING)])
    _idx("conversations", [("conversation_id", ASCENDING)], unique=True, sparse=True)

    # ── trees ──
    _idx("trees", [("doc_id", ASCENDING)], unique=True)

    # ── corpus ──
    _idx("corpus", [("corpus_id", ASCENDING)], unique=True, sparse=True)

    # ── benchmarks ──
    _idx("benchmarks", [("created_at", DESCENDING)])

    total = sum(len(v) for v in created.values())
    logger.info("Ensured %d indexes across %d collections", total, len(created))
    return created


if __name__ == "__main__":
    import sys
    from pathlib import Path

    # Allow running as standalone script
    PROJECT_ROOT = Path(__file__).resolve().parent.parent
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

    from utils.mongo import get_db
    logging.basicConfig(level=logging.INFO)
    db = get_db()
    result = ensure_indexes(db)
    for col, names in result.items():
        print(f"  {col}: {', '.join(names)}")
