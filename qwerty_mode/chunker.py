"""
PDF chunker for qwerty_mode.

Reuses govinda's existing PyMuPDF-based PDFParser (no Reducto). Produces
fixed-size token windows with page metadata so citations can jump back
to the exact PDF page in the viewer.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from ingestion.pdf_parser import PDFParser
from utils.text_utils import estimate_tokens

from qwerty_mode.config import get_qwerty_config


@dataclass
class QwertyChunk:
    chunk_id: str  # "<file_id>-<seq>"
    file_id: str
    seq: int
    text: str
    page_start: int
    page_end: int
    token_count: int
    metadata: dict = field(default_factory=dict)


def _split_text_to_token_windows(
    text: str, page_number: int, max_tokens: int, overlap_tokens: int,
) -> list[tuple[str, int, int, int]]:
    """
    Split a single-page text into windows of ~max_tokens.

    Returns tuples of (window_text, page_start, page_end, token_count).
    Page start/end are equal here since we split per-page; the caller
    merges across page boundaries when sequential windows are too small.
    """
    if not text.strip():
        return []

    # Token-aware split via word boundaries (cheap heuristic; we don't need
    # exact tokenization for retrieval quality).
    words = text.split()
    if not words:
        return []

    avg_tokens_per_word = max(estimate_tokens(text) / max(len(words), 1), 0.3)
    words_per_window = max(int(max_tokens / avg_tokens_per_word), 50)
    overlap_words = max(int(overlap_tokens / avg_tokens_per_word), 0)

    windows: list[tuple[str, int, int, int]] = []
    i = 0
    while i < len(words):
        end = min(i + words_per_window, len(words))
        window_words = words[i:end]
        window_text = " ".join(window_words).strip()
        if window_text:
            windows.append((
                window_text,
                page_number,
                page_number,
                estimate_tokens(window_text),
            ))
        if end >= len(words):
            break
        i = end - overlap_words if overlap_words > 0 else end
    return windows


def chunk_pdf(file_id: str, pdf_path: str | Path) -> list[QwertyChunk]:
    """
    Parse a PDF with govinda's PDFParser and emit ~600-token windows.
    """
    cfg = get_qwerty_config()
    parser = PDFParser()
    pages = parser.parse(pdf_path)

    chunks: list[QwertyChunk] = []
    seq = 0
    for page in pages:
        windows = _split_text_to_token_windows(
            text=page.text,
            page_number=page.page_number,
            max_tokens=cfg.chunk_size_tokens,
            overlap_tokens=cfg.chunk_overlap_tokens,
        )
        for window_text, page_start, page_end, tok_count in windows:
            chunk_id = f"{file_id}-{seq:04d}"
            chunks.append(
                QwertyChunk(
                    chunk_id=chunk_id,
                    file_id=file_id,
                    seq=seq,
                    text=window_text,
                    page_start=page_start,
                    page_end=page_end,
                    token_count=tok_count,
                )
            )
            seq += 1
    return chunks


def generate_file_id(filename: str, content: bytes) -> str:
    """Stable per-file id keyed by filename + content hash."""
    h = hashlib.sha256()
    h.update(filename.encode("utf-8"))
    h.update(b"::")
    h.update(content)
    return f"qf_{h.hexdigest()[:16]}"
