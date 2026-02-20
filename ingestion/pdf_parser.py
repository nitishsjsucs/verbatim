"""
PDF Parser for GOVINDA V2.

High-fidelity PDF extraction using PyMuPDF (fitz).
Extracts per-page text and tables, preserving document structure.

Key features:
- Page-by-page text extraction with layout preservation
- Table detection and structured extraction
- Text cleaning and artifact removal
- Page content statistics (char count, word count)
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

from models.document import (
    PageContent,
    TableBlock,
    TableCell,
    generate_doc_id,
)
from utils.text_utils import clean_pdf_text

logger = logging.getLogger(__name__)


class PDFParser:
    """
    Extract structured content from PDF documents.

    Returns a list of PageContent objects — one per physical page —
    with text and table blocks.
    """

    def __init__(self) -> None:
        pass

    def parse(self, pdf_path: str | Path) -> list[PageContent]:
        """
        Parse a PDF file and return page-by-page content.

        Args:
            pdf_path: Path to the PDF file.

        Returns:
            List of PageContent objects, one per page.
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        logger.info("Parsing PDF: %s", pdf_path.name)
        doc = fitz.open(str(pdf_path))
        pages: list[PageContent] = []

        for page_num in range(len(doc)):
            page = doc[page_num]
            physical_page = page_num + 1  # 1-indexed

            # Extract text with layout preservation
            text = self._extract_page_text(page)

            # Extract tables
            tables = self._extract_page_tables(page, physical_page)

            # Clean the text
            cleaned_text = clean_pdf_text(text)

            page_content = PageContent(
                page_number=physical_page,
                text=cleaned_text,
                tables=tables,
            )
            pages.append(page_content)

        doc.close()

        # Post-processing: remove repeated headers/footers
        pages = self._remove_repeated_headers_footers(pages)

        total_chars = sum(p.char_count for p in pages)
        total_words = sum(p.word_count for p in pages)
        table_count = sum(len(p.tables) for p in pages)

        logger.info(
            "Parsed %d pages: %d chars, %d words, %d tables",
            len(pages),
            total_chars,
            total_words,
            table_count,
        )

        return pages

    def _extract_page_text(self, page: fitz.Page) -> str:
        """
        Extract text from a single page.

        Uses 'text' mode which gives good paragraph-level output.
        Falls back to 'blocks' mode if text mode yields very little.
        """
        # Primary: standard text extraction
        text = page.get_text("text")

        # If text is suspiciously short, try blocks mode
        if len(text.strip()) < 50:
            blocks = page.get_text("blocks")
            if blocks:
                block_texts = []
                for block in sorted(blocks, key=lambda b: (b[1], b[0])):
                    if block[6] == 0:  # Text block (not image)
                        block_texts.append(block[4].strip())
                alt_text = "\n\n".join(block_texts)
                if len(alt_text.strip()) > len(text.strip()):
                    text = alt_text

        return text

    def _extract_page_tables(
        self, page: fitz.Page, page_number: int
    ) -> list[TableBlock]:
        """
        Extract tables from a single page using PyMuPDF's table finder.

        PyMuPDF 1.23+ has built-in table detection via page.find_tables().
        """
        tables: list[TableBlock] = []

        try:
            tab_finder = page.find_tables()
            if not tab_finder or not tab_finder.tables:
                return tables

            for idx, table in enumerate(tab_finder.tables):
                table_id = f"t_p{page_number}_{idx}"

                # Extract cell data
                cells: list[TableCell] = []
                extracted = table.extract()
                if not extracted:
                    continue

                num_rows = len(extracted)
                num_cols = max(len(row) for row in extracted) if extracted else 0

                for r_idx, row in enumerate(extracted):
                    for c_idx, cell_text in enumerate(row):
                        cell_val = str(cell_text).strip() if cell_text else ""
                        cells.append(
                            TableCell(
                                row=r_idx,
                                col=c_idx,
                                text=cell_val,
                                is_header=(r_idx == 0),
                            )
                        )

                # Build raw text representation
                raw_lines = []
                for row in extracted:
                    row_text = " | ".join(str(c).strip() if c else "" for c in row)
                    raw_lines.append(row_text)
                raw_text = "\n".join(raw_lines)

                table_block = TableBlock(
                    table_id=table_id,
                    page_number=page_number,
                    cells=cells,
                    num_rows=num_rows,
                    num_cols=num_cols,
                    raw_text=raw_text,
                )

                # Try to find caption (text just above the table)
                table_rect = table.bbox
                if table_rect:
                    caption = self._find_table_caption(page, table_rect)
                    if caption:
                        table_block.caption = caption

                tables.append(table_block)

        except Exception as e:
            logger.warning(
                "Table extraction failed on page %d: %s", page_number, str(e)
            )

        return tables

    def _find_table_caption(self, page: fitz.Page, table_rect: tuple) -> str:
        """
        Try to find a table caption by looking at text just above the table.

        Common patterns in RBI documents:
        - "Table X: ..."
        - "Table X - ..."
        - "Statement of ..."
        """
        try:
            # Look at a strip above the table (50 pixels high)
            x0, y0, x1, y1 = table_rect
            caption_rect = fitz.Rect(x0, max(0, y0 - 50), x1, y0)
            caption_text = page.get_text("text", clip=caption_rect).strip()

            if not caption_text:
                return ""

            # Check if it looks like a table caption
            caption_patterns = [
                r"^Table\s+\d+",
                r"^Statement\s+",
                r"^Annex(?:ure)?\s+",
                r"^Schedule\s+",
                r"^List\s+of\s+",
                r"^Format\s+",
            ]
            for pattern in caption_patterns:
                if re.match(pattern, caption_text, re.IGNORECASE):
                    # Take just the first line as caption
                    return caption_text.split("\n")[0].strip()

            return ""
        except Exception:
            return ""

    def _remove_repeated_headers_footers(
        self, pages: list[PageContent]
    ) -> list[PageContent]:
        """
        Detect and remove repeated headers/footers across pages.

        Strategy: If the first/last N characters of a page appear on
        many pages (>50%), they're likely headers/footers.
        """
        if len(pages) < 5:
            return pages

        # Detect repeated first lines (headers)
        first_lines: dict[str, int] = {}
        last_lines: dict[str, int] = {}

        for page in pages:
            lines = page.text.split("\n")
            lines = [l.strip() for l in lines if l.strip()]
            if lines:
                fl = lines[0]
                if len(fl) > 5:  # Skip very short lines
                    first_lines[fl] = first_lines.get(fl, 0) + 1
            if len(lines) > 1:
                ll = lines[-1]
                if len(ll) > 5:
                    last_lines[ll] = last_lines.get(ll, 0) + 1

        threshold = len(pages) * 0.5

        # Find headers/footers that appear on >50% of pages
        headers_to_remove = {
            line for line, count in first_lines.items() if count > threshold
        }
        footers_to_remove = {
            line for line, count in last_lines.items() if count > threshold
        }

        if not headers_to_remove and not footers_to_remove:
            return pages

        if headers_to_remove:
            logger.info("Removing %d repeated header(s)", len(headers_to_remove))
        if footers_to_remove:
            logger.info("Removing %d repeated footer(s)", len(footers_to_remove))

        cleaned_pages: list[PageContent] = []
        for page in pages:
            lines = page.text.split("\n")
            filtered = []
            for i, line in enumerate(lines):
                stripped = line.strip()
                if i == 0 and stripped in headers_to_remove:
                    continue
                if i == len(lines) - 1 and stripped in footers_to_remove:
                    continue
                filtered.append(line)

            new_text = "\n".join(filtered).strip()
            cleaned_pages.append(
                PageContent(
                    page_number=page.page_number,
                    text=new_text,
                    tables=page.tables,
                )
            )

        return cleaned_pages

    def get_document_info(self, pdf_path: str | Path) -> dict:
        """
        Get basic document metadata without full parsing.

        Returns:
            Dict with page_count, title, author, etc.
        """
        pdf_path = Path(pdf_path)
        doc = fitz.open(str(pdf_path))
        metadata = doc.metadata or {}
        info = {
            "filename": pdf_path.name,
            "doc_id": generate_doc_id(pdf_path.name),
            "page_count": len(doc),
            "title": metadata.get("title", ""),
            "author": metadata.get("author", ""),
            "subject": metadata.get("subject", ""),
            "creator": metadata.get("creator", ""),
            "file_size_mb": round(pdf_path.stat().st_size / (1024 * 1024), 2),
        }
        doc.close()
        return info
