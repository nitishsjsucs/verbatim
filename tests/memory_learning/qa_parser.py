"""
QA Parser — Extracts structured questions from rbi_open_ended_300_qa.md

Parses the 300 Q&A pairs into structured objects with:
- Question number, text, expected answer, grounding
- Theme grouping (5 questions per theme)
- Document source (ALM = Q1-100, KYC = Q101-200, Cross-doc = Q201-300)
- Question variation type (explain/why/how/governance/scenario)
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional


@dataclass
class QAPair:
    """A single question-answer pair from the benchmark set."""
    number: int
    question: str
    answer: str
    grounding: str = ""
    theme_number: int = 0
    theme_title: str = ""
    document: str = ""          # "ALM", "KYC", or "Cross-document"
    variation_type: str = ""    # "explain", "why", "how", "governance", "scenario"
    part: str = ""              # "Part I", "Part II", "Part III"

    @property
    def theme_key(self) -> str:
        """Unique key for the theme group."""
        return f"{self.document}_theme_{self.theme_number}"

    @property
    def position_in_theme(self) -> int:
        """1-based position within the theme (1-5)."""
        return ((self.number - 1) % 5) + 1


@dataclass
class ThemeGroup:
    """A group of 5 related questions on the same theme."""
    theme_number: int
    title: str
    document: str
    questions: List[QAPair] = field(default_factory=list)

    @property
    def theme_key(self) -> str:
        return f"{self.document}_theme_{self.theme_number}"


def classify_variation(question_text: str, position: int) -> str:
    """Classify the question variation type based on text and position."""
    text_lower = question_text.lower()
    if text_lower.startswith("explain ") or "explain the " in text_lower:
        return "explain"
    if "why does the rbi" in text_lower or "why does " in text_lower:
        return "why"
    if "how should a bank" in text_lower or "operationalise" in text_lower:
        return "how"
    if "governance or control failures" in text_lower:
        return "governance"
    if "realistic banking scenario" in text_lower or "in a practical scenario" in text_lower:
        return "scenario"
    # Fallback based on position in theme
    variation_map = {1: "explain", 2: "why", 3: "how", 4: "governance", 5: "scenario"}
    return variation_map.get(position, "explain")


def classify_document(number: int) -> str:
    """Classify which document source based on question number."""
    if number <= 100:
        return "ALM"
    elif number <= 200:
        return "KYC"
    else:
        return "Cross-document"


def classify_part(number: int) -> str:
    """Classify which part based on question number."""
    if number <= 100:
        return "Part I"
    elif number <= 200:
        return "Part II"
    else:
        return "Part III"


def parse_qa_file(filepath: str) -> List[QAPair]:
    """
    Parse the rbi_open_ended_300_qa.md file into structured QAPair objects.

    Two-pass approach:
      Pass 1 — Scan all theme headers and the first question number that follows
               each header to build a (theme_number, title, first_q) map.
      Pass 2 — Parse every Q/A/Grounding block and assign the correct theme
               by looking up which theme range the question number falls into.

    Returns:
        List of 300 QAPair objects, ordered by question number.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"QA file not found: {filepath}")

    content = path.read_text(encoding="utf-8")

    # ── Pass 1: Build theme boundary map ──────────────────────────────
    # Each theme header is followed by its first question.  We record
    # (first_question_number, theme_number, theme_title).
    theme_boundaries: List[tuple] = []  # (first_q_num, theme_num, title)
    theme_pattern = re.compile(
        r"^###\s+Theme\s+(\d+):\s+(.+?)$",
        re.MULTILINE,
    )
    first_q_after = re.compile(r"\*\*(\d+)\.\s+Question:\*\*")

    for tm in theme_pattern.finditer(content):
        theme_num = int(tm.group(1))
        theme_title = tm.group(2).strip()
        # Find the first question number after this header
        q_match = first_q_after.search(content, tm.end())
        if q_match:
            first_q = int(q_match.group(1))
            theme_boundaries.append((first_q, theme_num, theme_title))

    # Sort by first_q ascending so we can do range lookups
    theme_boundaries.sort(key=lambda t: t[0])

    def _theme_for_question(q_num: int):
        """Return (theme_number, theme_title) for a given question number."""
        best = (0, "")
        for first_q, tnum, ttitle in theme_boundaries:
            if first_q <= q_num:
                best = (tnum, ttitle)
            else:
                break
        return best

    # ── Pass 2: Parse every Q/A/Grounding block ──────────────────────
    qa_pairs: List[QAPair] = []

    blocks = re.split(r"(?=\*\*\d+\.\s+Question:\*\*)", content)

    for block in blocks:
        q_match = re.search(
            r"\*\*(\d+)\.\s+Question:\*\*\s+(.+?)(?=\n\n\*\*Answer:\*\*)",
            block, re.DOTALL,
        )
        if not q_match:
            continue

        q_number = int(q_match.group(1))
        q_text = q_match.group(2).strip()

        a_match = re.search(
            r"\*\*Answer:\*\*\s+(.+?)(?=\n\n\*Grounding:|\n\n\*\*\d+|\n\n###|\n\n##|\n\n---|\Z)",
            block, re.DOTALL,
        )
        a_text = a_match.group(1).strip() if a_match else ""

        g_match = re.search(r"\*Grounding:\*\s+(.+?)(?=\n\n|\Z)", block, re.DOTALL)
        g_text = g_match.group(1).strip() if g_match else ""

        theme_number, theme_title = _theme_for_question(q_number)
        document = classify_document(q_number)
        part = classify_part(q_number)
        position = ((q_number - 1) % 5) + 1
        variation = classify_variation(q_text, position)

        qa = QAPair(
            number=q_number,
            question=q_text,
            answer=a_text,
            grounding=g_text,
            theme_number=theme_number,
            theme_title=theme_title,
            document=document,
            variation_type=variation,
            part=part,
        )
        qa_pairs.append(qa)

    qa_pairs.sort(key=lambda x: x.number)
    return qa_pairs


def group_by_theme(qa_pairs: List[QAPair]) -> List[ThemeGroup]:
    """Group QA pairs into ThemeGroup objects (5 questions per theme)."""
    themes: dict[str, ThemeGroup] = {}

    for qa in qa_pairs:
        key = qa.theme_key
        if key not in themes:
            themes[key] = ThemeGroup(
                theme_number=qa.theme_number,
                title=qa.theme_title,
                document=qa.document,
            )
        themes[key].questions.append(qa)

    # Sort themes by document then theme number
    doc_order = {"ALM": 0, "KYC": 1, "Cross-document": 2}
    sorted_themes = sorted(
        themes.values(),
        key=lambda t: (doc_order.get(t.document, 99), t.theme_number),
    )
    return sorted_themes


def get_document_questions(qa_pairs: List[QAPair], document: str) -> List[QAPair]:
    """Filter questions by document type."""
    return [qa for qa in qa_pairs if qa.document == document]


if __name__ == "__main__":
    # Quick test
    project_root = Path(__file__).resolve().parent.parent.parent
    qa_file = project_root / "rbi_open_ended_300_qa.md"

    pairs = parse_qa_file(str(qa_file))
    print(f"Parsed {len(pairs)} questions")

    themes = group_by_theme(pairs)
    print(f"Grouped into {len(themes)} themes")

    for doc in ["ALM", "KYC", "Cross-document"]:
        doc_qs = get_document_questions(pairs, doc)
        print(f"  {doc}: {len(doc_qs)} questions")

    # Show first theme
    if themes:
        t = themes[0]
        print(f"\nFirst theme: {t.title} ({t.document})")
        for q in t.questions:
            print(f"  Q{q.number} [{q.variation_type}]: {q.question[:80]}...")
