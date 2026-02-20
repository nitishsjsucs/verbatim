"""
Structure Detector for GOVINDA V2.

Detects the hierarchical structure of a document using a 3-mode fallback
strategy (inspired by PageIndex):

Mode 1: TOC with page numbers — extract from explicit Table of Contents
Mode 2: TOC without page numbers — extract structure, locate in text
Mode 3: No TOC — LLM infers structure from raw text

Falls back from Mode 1 → 2 → 3 if accuracy is below threshold.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from config.prompt_loader import load_prompt, format_prompt
from config.settings import get_settings
from models.document import PageContent
from utils.llm_client import LLMClient
from utils.text_utils import estimate_tokens

logger = logging.getLogger(__name__)


@dataclass
class TOCEntry:
    """A single entry extracted from the Table of Contents."""

    title: str
    page_number: int  # Logical page number from TOC
    physical_page: int = 0  # Actual PDF page (after offset correction)
    level: int = 0  # Hierarchy depth (0 = chapter, 1 = section, etc.)
    entry_type: str = "section"  # chapter, section, subsection, annexure, etc.
    verified: bool = False


@dataclass
class StructureResult:
    """Result of structure detection."""

    entries: list[TOCEntry]
    mode_used: int  # Which mode succeeded (1, 2, or 3)
    accuracy: float  # Verification accuracy (0.0 - 1.0)
    page_offset: int = 0  # Offset between logical and physical pages
    total_pages: int = 0
    doc_description: str = ""


class StructureDetector:
    """
    Detect document structure using 3-mode fallback.

    Mode 1: TOC with page numbers (best quality)
    Mode 2: TOC without page numbers (good quality)
    Mode 3: LLM-inferred structure (acceptable quality)
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._settings = get_settings()

    def detect(self, pages: list[PageContent]) -> StructureResult:
        """
        Detect document structure from parsed pages.

        Tries each mode in order, falling back if accuracy is too low.
        """
        logger.info("Starting structure detection (%d pages)", len(pages))

        # Try Mode 1: TOC with page numbers
        toc_text = self._find_toc_pages(pages)
        if toc_text:
            logger.info("TOC found — trying Mode 1 (TOC with page numbers)")
            result = self._mode_1_toc_with_pages(toc_text, pages)
            if result and result.accuracy >= self._settings.tree.toc_accuracy_threshold:
                logger.info(
                    "Mode 1 succeeded: %d entries, %.0f%% accuracy, offset=%d",
                    len(result.entries),
                    result.accuracy * 100,
                    result.page_offset,
                )
                return result
            logger.warning(
                "Mode 1 accuracy too low (%.0f%%), falling back to Mode 3",
                (result.accuracy * 100) if result else 0,
            )

        # Skip Mode 2 for now — Mode 3 handles both cases
        # Mode 3: LLM infers structure from text
        logger.info("Trying Mode 3 (LLM-inferred structure)")
        result = self._mode_3_llm_inferred(pages)
        if result:
            logger.info("Mode 3 succeeded: %d entries", len(result.entries))
            return result

        # If everything fails, return minimal structure
        logger.error(
            "All structure detection modes failed — returning single-node structure"
        )
        return StructureResult(
            entries=[
                TOCEntry(
                    title="Full Document",
                    page_number=1,
                    physical_page=1,
                    level=0,
                    verified=True,
                )
            ],
            mode_used=0,
            accuracy=0.0,
            total_pages=len(pages),
        )

    # ------------------------------------------------------------------
    # TOC Page Detection
    # ------------------------------------------------------------------

    def _find_toc_pages(self, pages: list[PageContent]) -> str:
        """
        Find Table of Contents pages in the document.

        Looks for pages in the first 10% that contain:
        - "Table of Contents" or "Contents" header
        - Dotted leaders with page numbers
        """
        search_range = min(len(pages), max(5, len(pages) // 10))
        toc_pages: list[str] = []

        for page in pages[:search_range]:
            text = page.text

            # Check for TOC indicators
            has_toc_header = bool(
                re.search(
                    r"(?:Table\s+of\s+Contents|CONTENTS|INDEX)",
                    text,
                    re.IGNORECASE,
                )
            )

            # Check for dotted leaders (e.g., "Section ........... 4")
            dotted_lines = len(re.findall(r"\.{3,}\s*\d+", text))

            if has_toc_header or dotted_lines >= 3:
                toc_pages.append(text)

        if toc_pages:
            return "\n\n".join(toc_pages)
        return ""

    # ------------------------------------------------------------------
    # Mode 1: TOC with page numbers
    # ------------------------------------------------------------------

    def _mode_1_toc_with_pages(
        self, toc_text: str, pages: list[PageContent]
    ) -> Optional[StructureResult]:
        """
        Extract structure from a TOC that has page numbers.

        Steps:
        1. Send TOC text to LLM for structured extraction
        2. Verify extracted entries against actual page content
        3. Compute page offset (logical vs physical page numbering)
        """
        try:
            # Step 1: Extract TOC entries via LLM
            entries = self._extract_toc_entries(toc_text)
            if not entries:
                return None

            # Step 2: Determine page offset by checking where content starts
            offset = self._compute_page_offset(entries, pages)

            # Apply offset to get physical page numbers
            for entry in entries:
                entry.physical_page = entry.page_number + offset
                # Clamp to valid range
                entry.physical_page = max(1, min(entry.physical_page, len(pages)))

            # Step 3: Verify a sample of entries
            accuracy = self._verify_entries(entries, pages)

            # Mark all entries as verified if accuracy is high enough
            if accuracy >= self._settings.tree.toc_accuracy_threshold:
                for entry in entries:
                    entry.verified = True

            return StructureResult(
                entries=entries,
                mode_used=1,
                accuracy=accuracy,
                page_offset=offset,
                total_pages=len(pages),
            )

        except Exception as e:
            logger.error("Mode 1 failed: %s", str(e))
            return None

    def _extract_toc_entries(self, toc_text: str) -> list[TOCEntry]:
        """Use LLM to extract structured TOC entries from raw TOC text."""
        prompt_data = load_prompt("tree_building", "toc_extraction")
        system_prompt = prompt_data["system"]
        user_template = prompt_data["user_template"]
        user_msg = format_prompt(user_template, toc_text=toc_text)

        result = self._llm.chat_json(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=4096,
        )

        entries = []
        for item in result.get("toc_entries", []):
            entry = TOCEntry(
                title=item.get("title", "").strip(),
                page_number=int(item.get("page_number", 0)),
                level=int(item.get("level", 0)),
            )
            if entry.title and entry.page_number > 0:
                entries.append(entry)

        # Assign entry types based on title patterns
        for entry in entries:
            entry.entry_type = self._classify_entry_type(entry.title, entry.level)

        logger.info("Extracted %d TOC entries", len(entries))
        return entries

    def _compute_page_offset(
        self, entries: list[TOCEntry], pages: list[PageContent]
    ) -> int:
        """
        Compute the offset between logical (TOC) and physical (PDF) page numbers.

        Strategy: Take a few entries and check if their titles appear on
        the expected physical page or nearby.
        """
        # Sample up to 5 entries from different parts of the document
        sample = entries[: min(5, len(entries))]

        best_offset = 0
        best_matches = 0

        # Try offsets from -5 to +5
        for offset in range(-5, 6):
            matches = 0
            for entry in sample:
                physical = entry.page_number + offset
                if 1 <= physical <= len(pages):
                    page_text = pages[physical - 1].text.lower()
                    # Check if the entry title appears on this page
                    title_words = entry.title.lower().split()
                    # Match if most significant words are present
                    significant_words = [
                        w
                        for w in title_words
                        if len(w) > 3 and w not in {"the", "and", "for", "with"}
                    ]
                    if significant_words:
                        found = sum(1 for w in significant_words if w in page_text)
                        if found >= len(significant_words) * 0.6:
                            matches += 1
            if matches > best_matches:
                best_matches = matches
                best_offset = offset

        logger.info(
            "Page offset computed: %+d (matched %d/%d sample entries)",
            best_offset,
            best_matches,
            len(sample),
        )
        return best_offset

    def _verify_entries(
        self, entries: list[TOCEntry], pages: list[PageContent]
    ) -> float:
        """
        Verify extracted TOC entries against actual page content.

        Returns accuracy as float (0.0 - 1.0).
        """
        if not entries:
            return 0.0

        # Sample entries for verification (max 10 to save tokens)
        sample_size = min(10, len(entries))
        step = max(1, len(entries) // sample_size)
        sample = entries[::step][:sample_size]

        verified = 0
        for entry in sample:
            if 1 <= entry.physical_page <= len(pages):
                page_text = pages[entry.physical_page - 1].text.lower()
                # Check if title keywords appear on the page
                title_clean = re.sub(r"[^a-z0-9\s]", "", entry.title.lower())
                words = [w for w in title_clean.split() if len(w) > 3]
                if words:
                    found = sum(1 for w in words if w in page_text)
                    if found >= len(words) * 0.5:
                        verified += 1

        accuracy = verified / len(sample) if sample else 0.0
        logger.info(
            "Verification: %d/%d entries verified (%.0f%%)",
            verified,
            len(sample),
            accuracy * 100,
        )
        return accuracy

    # ------------------------------------------------------------------
    # Mode 3: LLM-inferred structure
    # ------------------------------------------------------------------

    def _mode_3_llm_inferred(
        self, pages: list[PageContent]
    ) -> Optional[StructureResult]:
        """
        Infer document structure using LLM analysis of the text.

        Sends text samples to the LLM and asks it to identify the
        hierarchical structure.
        """
        try:
            prompt_data = load_prompt("tree_building", "structure_generation")
            system_prompt = prompt_data["system"]
            user_template = prompt_data["user_template"]

            # Build text sample (first 30 pages for structure, or all if short)
            sample_pages = min(30, len(pages))
            text_parts = []
            for page in pages[:sample_pages]:
                text_parts.append(f"[Page {page.page_number}]\n{page.text}")
            document_text = "\n\n".join(text_parts)

            # Truncate if too long (aim for ~15K tokens)
            if estimate_tokens(document_text) > 15000:
                document_text = document_text[:60000]  # ~15K tokens

            user_msg = format_prompt(
                user_template,
                start_page=1,
                end_page=sample_pages,
                document_text=document_text,
            )

            result = self._llm.chat_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=8192,
                reasoning_effort="medium",
            )

            entries = self._parse_structure_result(result, pages)
            if not entries:
                return None

            return StructureResult(
                entries=entries,
                mode_used=3,
                accuracy=0.7,  # Assumed — LLM-inferred is less certain
                total_pages=len(pages),
            )

        except Exception as e:
            logger.error("Mode 3 failed: %s", str(e))
            return None

    def _parse_structure_result(
        self, result: dict | list, pages: list[PageContent]
    ) -> list[TOCEntry]:
        """Parse the LLM-generated structure into TOCEntry list."""
        entries = []

        structure = result.get("structure", []) if isinstance(result, dict) else result

        def _flatten(items: list, parent_level: int = -1):
            for item in items:
                level = item.get("level", parent_level + 1)
                entry = TOCEntry(
                    title=item.get("title", "").strip(),
                    page_number=int(item.get("start_page", 0)),
                    physical_page=int(item.get("start_page", 0)),
                    level=level,
                    entry_type=item.get("type", "section"),
                    verified=True,  # LLM already matched to pages
                )
                if entry.title:
                    entries.append(entry)
                # Recurse into children
                children = item.get("children", [])
                if children:
                    _flatten(children, level)

        _flatten(structure)
        return entries

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _classify_entry_type(title: str, level: int) -> str:
        """Classify a TOC entry into a node type based on its title."""
        title_lower = title.lower().strip()

        if re.match(r"chapter\s+", title_lower):
            return "chapter"
        if re.match(r"annex(?:ure)?\s+", title_lower):
            return "annexure"
        if re.match(r"appendix\s+", title_lower):
            return "appendix"
        if re.match(r"schedule\s+", title_lower):
            return "schedule"
        if "definition" in title_lower:
            return "definition"
        if "introduction" in title_lower or "preliminary" in title_lower:
            return "section"

        if level == 0:
            return "chapter"
        if level == 1:
            return "section"
        if level == 2:
            return "subsection"
        return "paragraph"

    def generate_doc_description(
        self, pages: list[PageContent], toc_overview: str
    ) -> str:
        """Generate a document description using the LLM."""
        try:
            prompt_data = load_prompt("tree_building", "document_description")
            system_prompt = prompt_data["system"]
            user_template = prompt_data["user_template"]

            # First page text as title page
            title_page_text = pages[0].text[:2000] if pages else ""

            user_msg = format_prompt(
                user_template,
                title_page_text=title_page_text,
                toc_overview=toc_overview,
            )

            description = self._llm.chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=500,
            )

            return description.strip()

        except Exception as e:
            logger.error("Document description generation failed: %s", str(e))
            return ""
