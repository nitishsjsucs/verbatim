"""
One-time script to add topic/keyword tags to all nodes in an existing document tree.

Usage:
    python -m govinda_v2_COPY_COPY.scripts.add_topics [doc_id]

If no doc_id is provided, processes all available trees.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root))

from config.settings import get_settings
from models.document import DocumentTree
from tree.tree_store import TreeStore
from utils.llm_client import LLMClient

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

TOPIC_PROMPT_SYSTEM = """\
You are an expert in Indian banking regulation (RBI).

TASK: For each document section, generate 3-8 keyword topic tags that capture
the key regulatory concepts, entity types, procedures, and terms in this section.

These tags will be used for fast query matching — an officer searching for
"V-CIP requirements" should match nodes tagged with "v-cip".

RULES:
- Tags should be lowercase keyword phrases (1-3 words each)
- Use precise regulatory terms (e.g., "cdd", "edd", "ovd", "v-cip", "pep", "aadhaar e-kyc")
- Include entity types the section applies to (e.g., "individuals", "legal entities", "trusts")
- Include specific procedures or concepts (e.g., "beneficial owner", "risk categorisation")
- Include important thresholds or limits as tags when relevant (e.g., "small account limits")
- 3-8 tags per node — be selective, not exhaustive

OUTPUT FORMAT (JSON):
{
  "topics": [
    {"node_id": "0001", "tags": ["applicability", "commercial banks", "overseas branches"]}
  ]
}
"""

TOPIC_PROMPT_USER = """\
Here are the document sections. For each, generate topic tags based on the
title and summary:

{sections_text}

Return JSON with the "topics" array.
"""


def generate_topics_for_tree(tree: DocumentTree, llm: LLMClient) -> int:
    """Generate topic tags for all nodes in the tree. Returns count of enriched nodes."""
    all_nodes = []
    for node in tree.structure:
        _collect_all(node, all_nodes)

    logger.info("Generating topics for %d nodes", len(all_nodes))

    batch_size = 10  # Larger batches since we only send title+summary
    enriched = 0

    for i in range(0, len(all_nodes), batch_size):
        batch = all_nodes[i : i + batch_size]

        sections_parts = []
        for node in batch:
            summary = node.summary or "(no summary)"
            sections_parts.append(
                f"--- NODE {node.node_id}: {node.title} ({node.page_range_str}) ---\n"
                f"Summary: {summary}"
            )

        sections_text = "\n\n".join(sections_parts)
        user_msg = TOPIC_PROMPT_USER.format(sections_text=sections_text)

        try:
            result = llm.chat_json(
                messages=[
                    {"role": "system", "content": TOPIC_PROMPT_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=2000,
            )

            node_map = {n.node_id: n for n in batch}
            for item in result.get("topics", []):
                nid = item.get("node_id", "")
                tags = item.get("tags", [])
                if nid in node_map:
                    node_map[nid].topics = tags
                    enriched += 1

            logger.info("  Batch %d-%d: %d nodes enriched", i, i + len(batch), len(batch))

        except Exception as e:
            logger.error("  Batch %d-%d failed: %s", i, i + len(batch), e)

    return enriched


def _collect_all(node, result):
    result.append(node)
    for child in node.children:
        _collect_all(child, result)


def main():
    settings = get_settings()
    store = TreeStore()
    llm = LLMClient()

    doc_ids = sys.argv[1:] if len(sys.argv) > 1 else store.list_trees()

    for doc_id in doc_ids:
        logger.info("Processing %s", doc_id)
        tree = store.load(doc_id)
        if tree is None:
            logger.error("Tree not found: %s", doc_id)
            continue

        count = generate_topics_for_tree(tree, llm)
        logger.info("Enriched %d nodes with topics", count)

        # Save updated tree
        store.save(tree)
        logger.info("Saved updated tree: %s", doc_id)

        # Regenerate index
        index = tree.to_index()
        index_path = settings.storage.trees_dir / f"{doc_id}_index.json"
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2, ensure_ascii=False)
        logger.info("Saved updated index: %s", index_path.name)


if __name__ == "__main__":
    main()
