"""
Ingestion pipeline for qwerty_mode.

Flow (mirrors qwerty's lib/discovery/pipeline):
1. Persist the original PDF to Cloudflare R2.
2. Parse with govinda's PDFParser (no Reducto).
3. Chunk into ~600-token windows with page metadata.
4. Embed all chunks via OpenAI text-embedding-3-small.
5. Upsert vectors to Cloudflare Vectorize (metadata: file_id, chunkId,
   pageStart, pageEnd, filename).
6. Persist file + chunk records to Convex via HTTP actions.

Idempotent on file_id: re-ingesting the same content overwrites cleanly.
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path

from qwerty_mode import chunker, convex_client, embeddings, r2, vectorize
from qwerty_mode.config import assert_qwerty_ready

logger = logging.getLogger(__name__)


@dataclass
class IngestResult:
    file_id: str
    filename: str
    r2_key: str
    page_count: int
    chunk_count: int
    size_bytes: int


def ingest_pdf(filename: str, content: bytes) -> IngestResult:
    """End-to-end ingestion of a single PDF."""
    assert_qwerty_ready()

    file_id = chunker.generate_file_id(filename, content)
    r2_key = f"qwerty/{file_id}/{filename}"
    logger.info("[QWERTY][ingest] start file_id=%s filename=%s", file_id, filename)

    # 1. R2 upload
    r2.upload_pdf(r2_key, content)

    # 2-3. Parse + chunk
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        chunks = chunker.chunk_pdf(file_id, tmp_path)
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass

    if not chunks:
        raise RuntimeError(f"No text extracted from {filename}")

    page_count = max(c.page_end for c in chunks)
    logger.info(
        "[QWERTY][ingest] parsed file_id=%s pages=%d chunks=%d",
        file_id, page_count, len(chunks),
    )

    # 4. Embed
    texts = [c.text for c in chunks]
    vectors = embeddings.embed_chunks(texts)

    # 5. Vectorize upsert
    vectorize.ensure_index()
    vectorize.upsert(
        {
            "id": chunk.chunk_id,
            "values": vec,
            "metadata": {
                "file_id": file_id,
                "filename": filename,
                "chunk_id": chunk.chunk_id,
                "seq": chunk.seq,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
            },
        }
        for chunk, vec in zip(chunks, vectors)
    )

    # 6. Convex persistence
    convex_client.insert_chunks(
        file_id,
        [
            {
                "chunkId": c.chunk_id,
                "seq": c.seq,
                "text": c.text,
                "pageStart": c.page_start,
                "pageEnd": c.page_end,
                "tokenCount": c.token_count,
            }
            for c in chunks
        ],
    )
    convex_client.insert_file(
        file_id=file_id,
        filename=filename,
        r2_key=r2_key,
        page_count=page_count,
        chunk_count=len(chunks),
        size_bytes=len(content),
    )

    logger.info("[QWERTY][ingest] done file_id=%s", file_id)
    return IngestResult(
        file_id=file_id,
        filename=filename,
        r2_key=r2_key,
        page_count=page_count,
        chunk_count=len(chunks),
        size_bytes=len(content),
    )
