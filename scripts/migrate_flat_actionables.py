"""
Migration script: Populate the flat actionables collection from embedded data.

Reads every document in the 'actionables' collection (embedded model — one doc
per source document, each containing a nested list of ActionableItem dicts),
flattens each item into its own document, and upserts into 'actionables_flat'.

Safe to run multiple times (idempotent via upsert).

Usage:
    python -m scripts.migrate_flat_actionables [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

# Ensure project root is on sys.path
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.mongo import get_db
from app_backend.constants import Collection

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("migrate_flat")

# Fields inherited from the parent document and added to each flat item
PARENT_FIELDS = ("doc_name", "regulation_issue_date", "circular_effective_date", "regulator")


def flatten_one(parent: dict, item: dict) -> dict:
    """Convert an embedded actionable dict into a flat document.

    Adds doc_id, doc_name, and other parent-level metadata.
    """
    doc_id = parent.get("doc_id", parent.get("_id", ""))
    item_id = item.get("id", "")

    flat = {**item}
    flat["doc_id"] = str(doc_id)
    flat["item_id"] = item_id
    flat["doc_name"] = parent.get("doc_name", "")

    # Inherit parent-level metadata if not already set on the item
    for field in PARENT_FIELDS:
        if field != "doc_name" and not flat.get(field):
            flat[field] = parent.get(field, "")

    # Remove embedded-model artifacts
    flat.pop("_id", None)
    flat.pop("source_node_id", None)  # Not needed in flat model

    return flat


def migrate(dry_run: bool = False) -> dict:
    """Run the migration.

    Returns stats dict: {total_docs, total_items, upserted, skipped, errors}.
    """
    db = get_db()
    embedded_col = db[Collection.ACTIONABLES]
    flat_col = db[Collection.ACTIONABLES_FLAT]

    stats = {"total_docs": 0, "total_items": 0, "upserted": 0, "skipped": 0, "errors": 0}

    cursor = embedded_col.find({})
    batch: list[dict] = []
    BATCH_SIZE = 500

    for parent in cursor:
        stats["total_docs"] += 1
        doc_id = str(parent.get("doc_id", parent.get("_id", "")))
        items = parent.get("actionables", [])

        for item in items:
            stats["total_items"] += 1
            item_id = item.get("id", "")
            if not item_id:
                logger.warning("Skipping item with no id in doc %s", doc_id)
                stats["skipped"] += 1
                continue

            flat = flatten_one(parent, item)
            flat_id = f"{doc_id}__{item_id}"
            flat["_id"] = flat_id
            batch.append(flat)

            if len(batch) >= BATCH_SIZE:
                if not dry_run:
                    _flush_batch(flat_col, batch, stats)
                else:
                    stats["upserted"] += len(batch)
                batch = []

    # Flush remainder
    if batch:
        if not dry_run:
            _flush_batch(flat_col, batch, stats)
        else:
            stats["upserted"] += len(batch)

    return stats


def _flush_batch(col, batch: list[dict], stats: dict) -> None:
    """Upsert a batch of flat documents."""
    from pymongo import UpdateOne

    ops = []
    for doc in batch:
        flat_id = doc["_id"]
        ops.append(
            UpdateOne(
                {"_id": flat_id},
                {"$set": doc},
                upsert=True,
            )
        )
    try:
        result = col.bulk_write(ops, ordered=False)
        stats["upserted"] += result.upserted_count + result.modified_count
    except Exception as e:
        logger.error("Bulk write error: %s", e)
        stats["errors"] += len(batch)


def create_indexes() -> None:
    """Create all indexes on the flat collection."""
    from app_backend.repositories.actionable_repo import ActionableFlatRepo
    repo = ActionableFlatRepo()
    repo.ensure_indexes()
    logger.info("Indexes created successfully.")


def main():
    parser = argparse.ArgumentParser(description="Migrate embedded actionables to flat collection")
    parser.add_argument("--dry-run", action="store_true", help="Count items without writing")
    parser.add_argument("--create-indexes", action="store_true", help="Create indexes after migration")
    args = parser.parse_args()

    logger.info("Starting flat actionables migration%s...", " (DRY RUN)" if args.dry_run else "")
    t0 = time.time()

    stats = migrate(dry_run=args.dry_run)

    elapsed = time.time() - t0
    logger.info(
        "Migration complete in %.1fs: %d docs, %d items, %d upserted, %d skipped, %d errors",
        elapsed,
        stats["total_docs"],
        stats["total_items"],
        stats["upserted"],
        stats["skipped"],
        stats["errors"],
    )

    if args.create_indexes and not args.dry_run:
        create_indexes()


if __name__ == "__main__":
    main()
