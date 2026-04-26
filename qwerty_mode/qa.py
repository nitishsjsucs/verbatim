"""
qwerty_mode QA engine.

Vector retrieval + LLM synthesis with chunk-grounded citations.

Flow:
1. Embed query.
2. Cloudflare Vectorize top-K.
3. Fetch full chunk text from Convex.
4. Synthesize answer using govinda's LLMClient (gpt-5.2 by default).
5. Return answer + citations (each citation = chunk_id, file_id, page_start, page_end, excerpt).
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass

from qwerty_mode import convex_client, embeddings, vectorize
from qwerty_mode.config import assert_qwerty_ready, get_qwerty_config
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


@dataclass
class QwertyCitation:
    citation_id: str
    chunk_id: str
    file_id: str
    filename: str
    page_start: int
    page_end: int
    excerpt: str
    score: float


@dataclass
class QwertyAnswer:
    text: str
    citations: list[QwertyCitation]
    matches_considered: int


_SYSTEM_PROMPT = """You are a precise compliance research assistant.

Answer the user's question using ONLY the provided source excerpts. Each excerpt is labeled like [1], [2]. When you use information from an excerpt, cite it inline using its bracketed number, e.g. "Banks must report transactions above the threshold [2]."

Rules:
- Never invent facts not present in the excerpts.
- Prefer concise direct answers grounded in the excerpts.
- If the excerpts do not contain enough information, say so explicitly.
- Use multiple citations when an answer draws from multiple excerpts.
"""


def _build_user_prompt(question: str, chunks: list[dict]) -> str:
    parts = ["Question:", question, "", "Source excerpts:"]
    for i, c in enumerate(chunks, start=1):
        parts.append(
            f"[{i}] (file_id={c.get('fileId') or c.get('file_id')}, "
            f"pages {c.get('pageStart')}-{c.get('pageEnd')}):\n"
            f"{c.get('text','').strip()}"
        )
    parts.append("")
    parts.append("Answer with inline [n] citations only.")
    return "\n\n".join(parts)


def answer_question(question: str, file_ids: list[str] | None = None) -> QwertyAnswer:
    assert_qwerty_ready()
    cfg = get_qwerty_config()

    # 1. Embed
    qvec = embeddings.embed_query(question)

    # 2. Vector search
    matches = vectorize.query(qvec, top_k=cfg.top_k, file_ids=file_ids)
    if not matches:
        return QwertyAnswer(
            text="No relevant excerpts were found for this query.",
            citations=[],
            matches_considered=0,
        )

    # 3. Fetch chunk texts from Convex
    chunk_ids = [m.id for m in matches]
    chunks = convex_client.get_chunks_by_ids(chunk_ids)
    # Preserve match ordering and merge metadata.
    by_id = {c.get("chunkId"): c for c in chunks}
    ordered: list[dict] = []
    for m in matches:
        c = by_id.get(m.id)
        if not c:
            continue
        merged = dict(c)
        merged["score"] = m.score
        merged.setdefault("filename", m.metadata.get("filename", ""))
        merged.setdefault("fileId", m.metadata.get("file_id", ""))
        ordered.append(merged)
    if not ordered:
        return QwertyAnswer(
            text="Retrieved chunks were not available in the database.",
            citations=[],
            matches_considered=len(matches),
        )

    # 4. Synthesize
    llm = LLMClient()
    response = llm.chat(
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(question, ordered)},
        ],
        model=cfg.synth_model,
        reasoning_effort=cfg.synth_reasoning_effort,
    )
    answer_text = response.strip() if isinstance(response, str) else str(response)

    # 5. Build citation list (in the same [n] order as the prompt).
    citations: list[QwertyCitation] = []
    for i, c in enumerate(ordered, start=1):
        excerpt = (c.get("text") or "")[:280]
        citations.append(
            QwertyCitation(
                citation_id=f"[{i}]",
                chunk_id=c.get("chunkId", ""),
                file_id=c.get("fileId", ""),
                filename=c.get("filename", ""),
                page_start=int(c.get("pageStart") or 0),
                page_end=int(c.get("pageEnd") or 0),
                excerpt=excerpt,
                score=float(c.get("score") or 0.0),
            )
        )

    return QwertyAnswer(
        text=answer_text,
        citations=citations,
        matches_considered=len(matches),
    )


def answer_to_dict(ans: QwertyAnswer) -> dict:
    return {
        "text": ans.text,
        "citations": [asdict(c) for c in ans.citations],
        "matches_considered": ans.matches_considered,
    }
