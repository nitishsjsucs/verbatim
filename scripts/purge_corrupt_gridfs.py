"""
Purge corrupt GridFS entries for a doc_id and optionally re-ingest.

Usage:
    python scripts/purge_corrupt_gridfs.py doc_207204bf2a9b
    python scripts/purge_corrupt_gridfs.py doc_207204bf2a9b --ingest path\\to\\original.pdf
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models.document import generate_doc_id  # noqa: E402
from tree.tree_store import TreeStore  # noqa: E402
from utils.mongo import get_fs  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("doc_id")
    ap.add_argument(
        "--ingest",
        type=Path,
        default=None,
        help="After purging, re-run the full ingestion pipeline on this PDF "
             "(rebuilds tree, wipes existing actionables).",
    )
    ap.add_argument(
        "--replace-pdf",
        type=Path,
        default=None,
        help="After purging, upload this PDF to GridFS under the existing "
             "doc_id WITHOUT re-running ingestion. Preserves the tree and "
             "any actionables/extractions you've already produced. Use this "
             "when the tree is fine and only the PDF bytes got corrupted.",
    )
    ap.add_argument(
        "--url",
        default=None,
        help="After purging, download the PDF from this URL and upload it to "
             "GridFS WITHOUT re-running ingestion. Preserves the tree and "
             "any actionables/extractions you've already produced.",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be deleted without deleting.",
    )
    args = ap.parse_args()

    store = TreeStore()
    tree = store.load(args.doc_id)
    if not tree:
        print(f"Tree not found for {args.doc_id}")
        sys.exit(1)
    print(f"Tree doc_name: {tree.doc_name!r}")

    fs = get_fs()

    candidates = []
    seen = set()
    for gf in fs.find({"metadata.doc_id": args.doc_id}):
        if gf._id in seen:
            continue
        seen.add(gf._id)
        candidates.append(("metadata.doc_id", gf))
    for gf in fs.find({"filename": tree.doc_name}):
        if gf._id in seen:
            continue
        seen.add(gf._id)
        candidates.append(("filename=doc_name", gf))
    for gf in fs.find():
        if gf._id in seen:
            continue
        name = getattr(gf, "filename", None)
        if not name or generate_doc_id(name) != args.doc_id:
            continue
        seen.add(gf._id)
        candidates.append(("hash-scan", gf))

    if not candidates:
        print("No GridFS candidates for this doc_id.")
    else:
        print(f"Found {len(candidates)} candidate(s):")

    to_delete = []
    for via, gf in candidates:
        name = getattr(gf, "filename", "?")
        print(f"  _id={gf._id} filename={name!r} via={via} length={gf.length}")
        try:
            data = gf.read()
            print(f"    -> reads OK ({len(data)} bytes) - KEEPING")
        except Exception as e:
            print(f"    -> CORRUPT: {e}")
            to_delete.append(gf._id)

    if not to_delete:
        print("No corrupt entries to purge.")
    else:
        print(f"\nWill delete {len(to_delete)} corrupt entry(s): {to_delete}")
        if args.dry_run:
            print("(dry-run, not deleting)")
        else:
            for _id in to_delete:
                fs.delete(_id)
                print(f"  deleted {_id}")

    if args.replace_pdf and not args.dry_run:
        pdf_path = args.replace_pdf.resolve()
        if not pdf_path.exists():
            print(f"\n[replace-pdf] file does not exist: {pdf_path}")
            sys.exit(2)
        print(
            f"\n[replace-pdf] uploading {pdf_path} to GridFS "
            f"(filename={tree.doc_name!r}, metadata.doc_id={args.doc_id}) ..."
        )
        with open(pdf_path, "rb") as f:
            new_id = fs.put(
                f,
                filename=tree.doc_name,
                metadata={"doc_id": args.doc_id},
            )
        # Verify the upload reads cleanly.
        verify = fs.get(new_id)
        data = verify.read()
        print(
            f"[replace-pdf] done. _id={new_id} "
            f"length={len(data)} bytes. Tree + actionables untouched."
        )

    if args.url and not args.dry_run:
        import io
        import urllib.request

        print(f"\n[url] downloading {args.url} ...")
        try:
            import requests as _requests
            _session = _requests.Session()
            _session.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "application/pdf,application/octet-stream,*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx",
            })
            _resp = _session.get(args.url, timeout=60, allow_redirects=True)
            _resp.raise_for_status()
            pdf_bytes = _resp.content
        except ImportError:
            req = urllib.request.Request(
                args.url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Accept": "application/pdf,application/octet-stream,*/*",
                    "Referer": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx",
                },
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                pdf_bytes = resp.read()
        print(f"[url] downloaded {len(pdf_bytes)} bytes")
        if pdf_bytes[:4] != b"%PDF":
            print(f"[url] ERROR: response does not look like a PDF (first bytes: {pdf_bytes[:16]!r}). Aborting.")
            sys.exit(3)
        print(
            f"[url] uploading to GridFS "
            f"(filename={tree.doc_name!r}, metadata.doc_id={args.doc_id}) ..."
        )
        new_id = fs.put(
            io.BytesIO(pdf_bytes),
            filename=tree.doc_name,
            metadata={"doc_id": args.doc_id},
        )
        verify = fs.get(new_id)
        data = verify.read()
        print(
            f"[url] done. _id={new_id} "
            f"length={len(data)} bytes. Tree + actionables untouched."
        )

    if args.ingest and not args.dry_run:
        pdf_path = args.ingest.resolve()
        if not pdf_path.exists():
            print(f"\n[ingest] file does not exist: {pdf_path}")
            sys.exit(2)
        print(f"\n[ingest] re-ingesting {pdf_path} ...")
        from ingestion.pipeline import IngestionPipeline

        pipeline = IngestionPipeline()
        new_tree = pipeline.ingest(pdf_path, force=True)
        print(
            f"[ingest] done. doc_id={new_tree.doc_id} doc_name={new_tree.doc_name!r}"
        )
        if new_tree.doc_id != args.doc_id:
            print(
                "[ingest] NOTE: new doc_id differs from old. "
                "The tree for the old doc_id still exists with its old name. "
                "Use the rename endpoint if you want to merge them."
            )


if __name__ == "__main__":
    main()
