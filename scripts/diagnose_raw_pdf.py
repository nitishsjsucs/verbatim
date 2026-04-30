"""
Diagnostic: why does /documents/{doc_id}/raw 404?

Usage:
    python scripts/diagnose_raw_pdf.py doc_207204bf2a9b
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models.document import generate_doc_id  # noqa: E402
from tree.tree_store import TreeStore  # noqa: E402
from utils.mongo import get_db, get_fs  # noqa: E402
from utils.settings import get_settings  # noqa: E402


def main(doc_id: str) -> None:
    print(f"=== Diagnosing doc_id={doc_id} ===\n")

    store = TreeStore()
    tree = store.load(doc_id)
    if not tree:
        print(f"[tree] NOT FOUND in tree store for {doc_id}")
        return
    print(f"[tree] doc_name = {tree.doc_name!r}")
    print(f"[tree] total_pages = {tree.total_pages}")
    print(f"[tree] hash(doc_name) -> {generate_doc_id(tree.doc_name)}")
    print()

    fs = get_fs()
    db = get_db()

    print("[gridfs] lookup by metadata.doc_id ...")
    hit = fs.find_one({"metadata.doc_id": doc_id})
    print(f"  -> {'HIT ' + str(hit._id) if hit else 'miss'}")

    print(f"[gridfs] lookup by filename == doc_name ({tree.doc_name!r}) ...")
    hit = fs.find_one({"filename": tree.doc_name})
    print(f"  -> {'HIT ' + str(hit._id) if hit else 'miss'}")

    print("[gridfs] listing ALL GridFS files (filename, size, metadata):")
    rows = []
    for gf in fs.find():
        rows.append(
            {
                "filename": getattr(gf, "filename", None),
                "length": getattr(gf, "length", None),
                "metadata": getattr(gf, "metadata", None),
                "hash": generate_doc_id(getattr(gf, "filename", "") or ""),
            }
        )
    if not rows:
        print("  -> GridFS is EMPTY")
    for r in rows:
        marker = "  <-- MATCHES doc_id" if r["hash"] == doc_id else ""
        print(
            f"  - {r['filename']!r:70s} "
            f"size={r['length']:>10} "
            f"hash={r['hash']} "
            f"metadata={r['metadata']}"
            f"{marker}"
        )
    print()

    settings = get_settings()
    pdfs_dir = settings.storage.trees_dir.parent / "pdfs"
    print(f"[disk] pdfs_dir = {pdfs_dir}")
    print(f"[disk] exists = {pdfs_dir.exists()}")
    if pdfs_dir.exists():
        for p in pdfs_dir.iterdir():
            if p.is_file():
                h = generate_doc_id(p.name)
                marker = "  <-- MATCHES doc_id" if h == doc_id else ""
                print(f"  - {p.name!r} size={p.stat().st_size} hash={h}{marker}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/diagnose_raw_pdf.py <doc_id>")
        sys.exit(1)
    main(sys.argv[1])
