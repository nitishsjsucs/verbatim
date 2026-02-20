"""
Text utilities for GOVINDA V2.

Token counting, text cleaning, and formatting helpers.
"""

from __future__ import annotations

import re
from typing import Optional


def estimate_tokens(text: str) -> int:
    """
    Fast token count estimation.

    Uses the ~4 chars per token heuristic for English text.
    Accurate enough for budget tracking without needing tiktoken.
    """
    if not text:
        return 0
    return max(1, len(text) // 4)


def clean_pdf_text(text: str) -> str:
    """
    Clean text extracted from PDF.

    Handles common PDF extraction artifacts:
    - Excessive whitespace
    - Hyphenated line breaks
    - Header/footer repetitions
    - Page number artifacts
    """
    if not text:
        return ""

    # Fix hyphenated line breaks (word-\nbreak -> wordbreak)
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)

    # Collapse multiple newlines to max 2
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Collapse multiple spaces to single (but preserve newlines)
    text = re.sub(r"[^\S\n]+", " ", text)

    # Remove isolated page numbers on their own line
    text = re.sub(r"\n\s*\d{1,3}\s*\n", "\n", text)

    # Strip leading/trailing whitespace per line
    lines = [line.strip() for line in text.split("\n")]
    text = "\n".join(lines)

    return text.strip()


def truncate_text(text: str, max_tokens: int, suffix: str = "...") -> str:
    """Truncate text to approximately max_tokens."""
    max_chars = max_tokens * 4
    if len(text) <= max_chars:
        return text
    return text[: max_chars - len(suffix)] + suffix


def format_page_range(start: int, end: int) -> str:
    """Format a page range for display."""
    if start == end:
        return f"p.{start}"
    return f"pp.{start}-{end}"
