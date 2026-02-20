"""
Ingestion Pipeline for GOVINDA V2.

Orchestrates the full document ingestion process:
1. Parse PDF → pages
2. Detect structure (TOC / LLM inference)
3. Build tree from structure + pages
4. Enrich nodes with LLM summaries
5. Link cross-references
6. Save tree to disk

This is the offline phase — run once per document.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

from config.settings import get_settings
from ingestion.cross_ref_linker import CrossRefLinker
from ingestion.node_enricher import NodeEnricher
from ingestion.pdf_parser import PDFParser
from ingestion.relationship_detector import RelationshipDetector
from ingestion.structure_detector import StructureDetector
from ingestion.tree_builder import TreeBuilder
from models.document import DocumentTree, generate_doc_id
from tree.corpus_store import CorpusStore
from tree.tree_store import TreeStore
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)


class IngestionPipeline:
    """
    Full ingestion pipeline: PDF → Document Tree.

    Usage:
        pipeline = IngestionPipeline()
        tree = pipeline.ingest("169MD.pdf")
    """

    def __init__(
        self,
        llm: Optional[LLMClient] = None,
        tree_store: Optional[TreeStore] = None,
    ) -> None:
        self._llm = llm or LLMClient()
        self._store = tree_store or TreeStore()
        self._corpus_store = CorpusStore()
        self._parser = PDFParser()
        self._detector = StructureDetector(self._llm)
        self._builder = TreeBuilder()
        self._enricher = NodeEnricher(self._llm)
        self._linker = CrossRefLinker(self._llm)
        self._rel_detector = RelationshipDetector(self._llm)

    def ingest(
        self,
        pdf_path: str | Path,
        force: bool = False,
    ) -> DocumentTree:
        """
        Ingest a PDF document and build its tree index.

        Args:
            pdf_path: Path to the PDF file.
            force: If True, rebuild even if tree already exists.

        Returns:
            The complete DocumentTree.
        """
        pdf_path = Path(pdf_path)
        doc_id = generate_doc_id(pdf_path.name)

        # Check if already indexed
        if not force and self._store.exists(doc_id):
            logger.info("Tree already exists for %s — loading", pdf_path.name)
            tree = self._store.load(doc_id)
            if tree:
                return tree

        logger.info("=" * 60)
        logger.info("INGESTION START: %s", pdf_path.name)
        logger.info("=" * 60)

        # Save PDF to GridFS
        logger.info("[Step 0/6] Uploading PDF to GridFS...")
        from utils.mongo import get_fs

        fs = get_fs()

        # Check if file already exists in GridFS to avoid duplicates or use force
        existing_file = fs.find_one({"filename": pdf_path.name})
        if existing_file:
            if force:
                logger.info("  Deleting existing PDF in GridFS: %s", pdf_path.name)
                fs.delete(existing_file._id)
            else:
                logger.info("  PDF already in GridFS: %s", pdf_path.name)

        # We still need the file on disk temporarily for PyMuPDF processing
        # But we ensure it's stored in GridFS for persistence
        if not existing_file or force:
            with open(pdf_path, "rb") as f:
                fs.put(f, filename=pdf_path.name)
            logger.info("  -> Uploaded to GridFS")

        start_time = time.time()

        # Step 1: Parse PDF
        logger.info("[Step 1/6] Parsing PDF...")
        step_start = time.time()
        pages = self._parser.parse(pdf_path)
        logger.info(
            "  -> %d pages, %d words (%.1fs)",
            len(pages),
            sum(p.word_count for p in pages),
            time.time() - step_start,
        )

        # Step 2: Detect structure
        logger.info("[Step 2/6] Detecting document structure...")
        step_start = time.time()
        structure = self._detector.detect(pages)
        logger.info(
            "  -> Mode %d, %d entries, %.0f%% accuracy (%.1fs)",
            structure.mode_used,
            len(structure.entries),
            structure.accuracy * 100,
            time.time() - step_start,
        )

        # Step 3: Generate document description
        logger.info("[Step 3/6] Generating document description...")
        step_start = time.time()
        toc_overview = "\n".join(
            f"{'  ' * e.level}{e.title} (p.{e.page_number})"
            for e in structure.entries[:30]
        )
        doc_description = self._detector.generate_doc_description(pages, toc_overview)
        logger.info("  -> Description generated (%.1fs)", time.time() - step_start)

        # Step 4: Build tree
        logger.info("[Step 4/6] Building document tree...")
        step_start = time.time()
        tree = self._builder.build(
            structure=structure,
            pages=pages,
            doc_name=pdf_path.name,
            doc_description=doc_description,
        )
        logger.info(
            "  -> %d nodes built (%.1fs)",
            tree.node_count,
            time.time() - step_start,
        )

        # Step 5: Enrich nodes with LLM summaries
        logger.info("[Step 5/6] Enriching nodes with summaries...")
        step_start = time.time()
        tree = self._enricher.enrich(tree)
        logger.info("  -> Enrichment complete (%.1fs)", time.time() - step_start)

        # Step 6: Link cross-references
        logger.info("[Step 6/6] Linking cross-references...")
        step_start = time.time()
        tree = self._linker.link(tree)
        logger.info("  -> Cross-references linked (%.1fs)", time.time() - step_start)

        # Save tree to disk
        tree_path = self._store.save(tree)

        # Step 7: Update corpus graph + detect relationships
        logger.info("[Step 7/7] Updating corpus graph...")
        step_start = time.time()
        try:
            corpus_entry = tree.to_corpus_entry()
            corpus = self._corpus_store.load_or_create()
            corpus.add_document(corpus_entry)

            # Detect relationships with existing documents
            relationships = self._rel_detector.detect_relationships(tree, corpus)
            if relationships:
                corpus.add_relationships(relationships)

            from datetime import datetime, timezone

            corpus.last_updated = datetime.now(timezone.utc).isoformat()
            self._corpus_store.save(corpus)
            logger.info(
                "  -> Corpus updated: %d docs, %d new relationships (%.1fs)",
                len(corpus.documents),
                len(relationships),
                time.time() - step_start,
            )
        except Exception as e:
            logger.warning("Corpus update failed (non-fatal): %s", e)

        total_time = time.time() - start_time
        usage = self._llm.get_usage_summary()

        logger.info("=" * 60)
        logger.info("INGESTION COMPLETE: %s", pdf_path.name)
        logger.info("  Total time: %.1fs", total_time)
        logger.info("  Nodes: %d", tree.node_count)
        logger.info("  LLM calls: %d", usage["total_calls"])
        logger.info(
            "  Tokens: %d in / %d out",
            usage["total_input_tokens"],
            usage["total_output_tokens"],
        )
        logger.info("  Tree saved: %s", tree_path)
        logger.info("=" * 60)

        return tree
