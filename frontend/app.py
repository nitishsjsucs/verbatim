"""
GOVINDA V2 — Vectorless Structure-First RAG — Streamlit Frontend.

Three-tab interface:
  1. Q&A            — Ask compliance questions against ingested documents
  2. Documents      — Upload PDFs, trigger ingestion, manage documents
  3. Tree Explorer  — Browse document tree structure, node summaries

Run from project root:
    python -m streamlit run govinda_v2/frontend/app.py --server.port 8502
"""

from __future__ import annotations

import logging
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Optional

import streamlit as st

# ---------------------------------------------------------------------------
# Ensure project root is importable
# ---------------------------------------------------------------------------
_FRONTEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _FRONTEND_DIR.parent.parent  # up from govinda_v2/frontend/ to GOVINDA/
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# ---------------------------------------------------------------------------
# Page config (must be first Streamlit call)
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="GOVINDA V2 — Vectorless RAG",
    page_icon="\u2696\ufe0f",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy cached resource loaders
# ---------------------------------------------------------------------------


@st.cache_resource
def _get_settings():
    from config.settings import get_settings

    return get_settings()


@st.cache_resource
def _get_tree_store():
    from tree.tree_store import TreeStore

    return TreeStore()


@st.cache_resource
def _get_qa_engine():
    from agents.qa_engine import QAEngine

    return QAEngine()


@st.cache_resource
def _get_ingestion_pipeline():
    from ingestion.pipeline import IngestionPipeline

    return IngestionPipeline()


@st.cache_resource
def _get_query_store():
    from tree.query_store import QueryStore

    return QueryStore()


# ---------------------------------------------------------------------------
# Component imports (lazy to avoid import errors on startup)
# ---------------------------------------------------------------------------


def _import_components():
    from frontend.components import (
        render_answer_card,
        render_feedback_ui,
        render_retrieval_preview,
        render_routing_log,
        render_tree_outline,
        render_document_info,
    )

    return (
        render_answer_card,
        render_feedback_ui,
        render_retrieval_preview,
        render_routing_log,
        render_tree_outline,
        render_document_info,
    )


# ---------------------------------------------------------------------------
# Session state initialization
# ---------------------------------------------------------------------------


def _init_session_state() -> None:
    """Initialize session state variables on first load."""
    defaults = {
        "qa_history": [],  # list of (query_text, Answer, RoutingLog | None)
        "selected_doc_id": None,  # currently selected document
        "ingestion_results": [],  # list of ingestion result dicts
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


_init_session_state()


# ======================================================================
# SIDEBAR
# ======================================================================


def _render_sidebar() -> None:
    """Render sidebar with branding, document selector, and config."""
    st.sidebar.title("GOVINDA V2")
    st.sidebar.caption("Vectorless Structure-First RAG")

    st.sidebar.divider()

    # --- Document Selector ---
    st.sidebar.markdown("**Active Document**")
    try:
        store = _get_tree_store()
        doc_ids = store.list_trees()

        if doc_ids:
            # If no document selected yet, default to first available
            if st.session_state["selected_doc_id"] is None:
                st.session_state["selected_doc_id"] = doc_ids[0]

            current_idx = 0
            if st.session_state["selected_doc_id"] in doc_ids:
                current_idx = doc_ids.index(st.session_state["selected_doc_id"])

            selected = st.sidebar.selectbox(
                "Select document",
                doc_ids,
                index=current_idx,
                key="doc_selector",
            )
            st.session_state["selected_doc_id"] = selected

            # Show document info
            tree = store.load(selected)
            if tree:
                st.sidebar.text(f"Name: {tree.doc_name}")
                st.sidebar.text(f"Pages: {tree.total_pages}")
                st.sidebar.text(f"Nodes: {tree.node_count}")
        else:
            st.sidebar.info("No documents indexed yet.")
            st.sidebar.caption("Upload a PDF in the Documents tab.")
    except Exception as e:
        st.sidebar.warning(f"Could not load documents: {e}")

    st.sidebar.divider()

    # --- Configuration ---
    try:
        settings = _get_settings()
        st.sidebar.markdown("**Configuration**")
        st.sidebar.text(f"Model: {settings.llm.model}")
        st.sidebar.text(f"Pro: {settings.llm.model_pro}")
        st.sidebar.text(f"Max nodes: {settings.retrieval.max_located_nodes}")
        st.sidebar.text(f"Token budget: {settings.retrieval.retrieval_token_budget:,}")
    except Exception as e:
        logger.debug("Could not display settings: %s", e)

    st.sidebar.divider()

    # --- System Info ---
    st.sidebar.markdown("**System**")
    st.sidebar.text("Architecture: Vectorless RAG")
    st.sidebar.text("Retrieval: LLM tree reasoning")
    st.sidebar.text("No embeddings / No vector DB")


# ======================================================================
# TAB 1: Q&A
# ======================================================================


def _render_qa_tab() -> None:
    """Render the Q&A tab with query input and answer display."""
    st.header("Compliance Q&A")

    doc_id = st.session_state.get("selected_doc_id")

    if not doc_id:
        st.warning(
            "No document selected. Upload and ingest a PDF in the "
            "**Documents** tab, then select it in the sidebar."
        )
        return

    # --- Query Input ---
    col_query, col_options = st.columns([4, 1])
    with col_query:
        query = st.text_area(
            "Ask a regulatory compliance question",
            height=100,
            placeholder=(
                "e.g., What are the KYC requirements for trusts?\n"
                "e.g., Define 'Beneficial Owner' under RBI Master Direction.\n"
                "e.g., Compare KYC requirements for individuals vs legal entities."
            ),
        )
    with col_options:
        verify = st.checkbox(
            "Verify answer", value=True, help="Run verification pass (~10s extra)"
        )
        reflect = st.checkbox(
            "Enable reflection",
            value=False,
            help="Reflect on evidence sufficiency and run gap-filling retrieval rounds. Adds ~30-90s.",
        )
        st.caption(f"Document: `{doc_id}`")

    # --- Submit ---
    if st.button("Ask GOVINDA V2", type="primary", disabled=not query.strip()):
        _run_qa_query(query.strip(), doc_id, verify, reflect)

    # --- Answer History ---
    if st.session_state["qa_history"]:
        st.divider()
        (
            render_answer_card, render_feedback_ui, render_retrieval_preview,
            render_routing_log, _, _,
        ) = _import_components()

        for entry in reversed(st.session_state["qa_history"]):
            # Migration guard: old entries have 3 elements, new have 4
            if len(entry) == 4:
                query_text, answer, routing_log, record_id = entry
            else:
                query_text, answer, routing_log = entry
                record_id = None

            render_answer_card(query_text, answer)
            render_feedback_ui(record_id)

            if routing_log:
                with st.expander("Routing Log (Audit)", expanded=False):
                    render_routing_log(routing_log)


def _run_qa_query(query_text: str, doc_id: str, verify: bool, reflect: bool = False) -> None:
    """Execute a QA query in two phases with progressive display."""
    import uuid
    from datetime import datetime, timezone

    from frontend.components import render_retrieval_preview
    from models.query import QueryRecord

    engine = _get_qa_engine()

    # Placeholder: will first show section preview, then get cleared on rerun
    preview_placeholder = st.empty()

    try:
        # --- Phase 1: Retrieval (fast, ~16s) ---
        with st.spinner("Retrieving relevant sections..."):
            retrieval_result = engine.retrieve(query_text, doc_id, reflect=reflect)

        # Show retrieved sections immediately
        with preview_placeholder.container():
            render_retrieval_preview(
                query_text,
                retrieval_result.sections,
                retrieval_result.routing_log,
                retrieval_result.tree,
            )

        # --- Phase 2: Synthesis + Verification (slow, ~100-180s) ---
        with st.spinner("Synthesizing and verifying answer..."):
            answer = engine.synthesize_and_verify(
                retrieval_result, query_text, verify=verify, reflect=reflect,
            )

        # Clear the preview
        preview_placeholder.empty()

        # Auto-save audit record
        record = QueryRecord(
            record_id=str(uuid.uuid4()),
            query_text=query_text,
            doc_id=doc_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            query_type=answer.query_type,
            sub_queries=retrieval_result.query.sub_queries,
            key_terms=retrieval_result.query.key_terms,
            routing_log=answer.routing_log,
            retrieved_sections=answer.retrieved_sections,
            answer_text=answer.text,
            citations=answer.citations,
            inferred_points=answer.inferred_points,
            verification_status=answer.verification_status,
            verification_notes=answer.verification_notes,
            total_time_seconds=answer.total_time_seconds,
            total_tokens=answer.total_tokens,
            llm_calls=answer.llm_calls,
            stage_timings=answer.stage_timings,
            verify_enabled=verify,
            reflect_enabled=reflect,
        )
        try:
            _get_query_store().save(record)
        except Exception as e:
            logger.error("Failed to save query record: %s", e)

        routing_log = answer.routing_log
        st.session_state["qa_history"].append(
            (query_text, answer, routing_log, record.record_id)
        )
        st.rerun()

    except FileNotFoundError as e:
        st.error(f"Document not found: {e}")
    except Exception as e:
        st.error(f"Pipeline error: {e}")
        logger.error("QA pipeline error: %s\n%s", e, traceback.format_exc())


# ======================================================================
# TAB 2: DOCUMENTS
# ======================================================================


def _render_documents_tab() -> None:
    """Render the Documents tab for PDF upload and management."""
    st.header("Document Management")

    # --- Upload Section ---
    st.subheader("Upload & Ingest PDF")

    uploaded_file = st.file_uploader(
        "Select an RBI regulatory PDF",
        type=["pdf"],
        help="Upload an RBI Master Direction, Circular, or other regulatory PDF.",
    )

    if uploaded_file is not None:
        file_size_kb = uploaded_file.size / 1024
        st.info(f"File: **{uploaded_file.name}** ({file_size_kb:.0f} KB)")

        col_ingest, col_force = st.columns([1, 1])
        with col_ingest:
            ingest_btn = st.button("Ingest Document", type="primary")
        with col_force:
            force_reingest = st.checkbox(
                "Force re-ingest",
                value=False,
                help="Rebuild tree even if already indexed.",
            )

        if ingest_btn:
            _run_ingestion(uploaded_file, force=force_reingest)

    # --- Ingestion Results ---
    if st.session_state["ingestion_results"]:
        st.subheader("Recent Ingestion Results")
        for result in reversed(st.session_state["ingestion_results"]):
            _render_ingestion_result(result)

    # --- Indexed Documents ---
    st.divider()
    st.subheader("Indexed Documents")

    try:
        store = _get_tree_store()
        doc_ids = store.list_trees()

        if not doc_ids:
            st.info("No documents indexed yet. Upload a PDF above to get started.")
        else:
            for doc_id in doc_ids:
                tree = store.load(doc_id)
                if tree:
                    with st.container(border=True):
                        cols = st.columns([3, 1, 1, 1, 1])
                        with cols[0]:
                            st.markdown(f"**{tree.doc_name}**")
                            st.caption(f"ID: `{tree.doc_id}`")
                        with cols[1]:
                            st.metric("Pages", tree.total_pages)
                        with cols[2]:
                            st.metric("Nodes", tree.node_count)
                        with cols[3]:
                            top_level = len(tree.structure)
                            st.metric("Top-Level", top_level)
                        with cols[4]:
                            if st.button("Delete", key=f"del_{doc_id}"):
                                store.delete(doc_id)
                                # Clear selection if this was the active doc
                                if st.session_state["selected_doc_id"] == doc_id:
                                    st.session_state["selected_doc_id"] = None
                                st.rerun()

                        if tree.doc_description:
                            st.caption(tree.doc_description[:300])

            st.caption(f"Total: {len(doc_ids)} document(s)")

    except Exception as e:
        st.warning(f"Could not load document list: {e}")


def _run_ingestion(uploaded_file: Any, force: bool = False) -> None:
    """Run the ingestion pipeline on an uploaded PDF."""
    # Save uploaded file to a temp location
    settings = _get_settings()
    data_dir = settings.storage.trees_dir.parent
    pdfs_dir = data_dir / "pdfs"
    pdfs_dir.mkdir(parents=True, exist_ok=True)

    dest = pdfs_dir / uploaded_file.name
    dest.write_bytes(uploaded_file.getvalue())

    pipeline = _get_ingestion_pipeline()

    progress = st.progress(0, text="Starting ingestion...")

    try:
        progress.progress(5, text="Parsing PDF...")

        start_time = time.time()
        tree = pipeline.ingest(str(dest), force=force)
        elapsed = time.time() - start_time

        progress.progress(100, text="Ingestion complete!")

        result = {
            "doc_name": tree.doc_name,
            "doc_id": tree.doc_id,
            "total_pages": tree.total_pages,
            "node_count": tree.node_count,
            "top_level_sections": len(tree.structure),
            "time_seconds": elapsed,
            "doc_description": tree.doc_description,
        }
        st.session_state["ingestion_results"].append(result)

        # Auto-select the newly ingested document
        st.session_state["selected_doc_id"] = tree.doc_id

        st.success(
            f"Successfully ingested **{tree.doc_name}**: "
            f"{tree.node_count} nodes, {tree.total_pages} pages, "
            f"{elapsed:.1f}s"
        )

        # Refresh to show the new document
        st.rerun()

    except Exception as e:
        progress.empty()
        st.error(f"Ingestion failed: {e}")
        logger.error("Ingestion error: %s\n%s", e, traceback.format_exc())


def _render_ingestion_result(result: dict) -> None:
    """Render a single ingestion result."""
    if "error" in result:
        st.error(f"Failed: {result.get('doc_name', 'unknown')} -- {result['error']}")
        return

    with st.container(border=True):
        st.markdown(f"**{result.get('doc_name', 'Untitled')}**")

        cols = st.columns(5)
        with cols[0]:
            st.metric("Pages", result.get("total_pages", 0))
        with cols[1]:
            st.metric("Nodes", result.get("node_count", 0))
        with cols[2]:
            st.metric("Top-Level", result.get("top_level_sections", 0))
        with cols[3]:
            st.metric("Time", f"{result.get('time_seconds', 0):.0f}s")
        with cols[4]:
            st.caption(f"ID: `{result.get('doc_id', '')}`")

        if result.get("doc_description"):
            with st.expander("Description", expanded=False):
                st.text(result["doc_description"][:500])


# ======================================================================
# TAB 3: TREE EXPLORER
# ======================================================================


def _render_tree_explorer_tab() -> None:
    """Render the Tree Explorer tab for browsing document structure."""
    st.header("Document Tree Explorer")

    doc_id = st.session_state.get("selected_doc_id")

    if not doc_id:
        st.warning("No document selected. Select one in the sidebar.")
        return

    try:
        store = _get_tree_store()
        tree = store.load(doc_id)

        if not tree:
            st.error(f"Could not load tree for document `{doc_id}`.")
            return

        _, _, render_tree_outline, render_document_info = _import_components()

        # --- Document Overview ---
        render_document_info(tree)

        st.divider()

        # --- Search within tree ---
        search_term = st.text_input(
            "Search nodes",
            placeholder="e.g., KYC, beneficial owner, Annexure",
            help="Filter tree nodes by title or summary content.",
        )

        if search_term.strip():
            _render_tree_search_results(tree, search_term.strip())
        else:
            # --- Full Tree ---
            st.subheader("Document Structure")
            render_tree_outline(tree)

        # --- Node Detail Viewer ---
        st.divider()
        st.subheader("Node Detail Viewer")

        all_node_ids = [n.node_id for n in tree._all_nodes()]
        all_node_labels = [f"{n.node_id} - {n.title[:60]}" for n in tree._all_nodes()]

        if all_node_ids:
            selected_label = st.selectbox(
                "Select a node to view details",
                all_node_labels,
                index=0,
            )
            selected_idx = all_node_labels.index(selected_label)
            selected_node_id = all_node_ids[selected_idx]

            node = tree.get_node(selected_node_id)
            if node:
                _render_node_detail(node)

    except Exception as e:
        st.error(f"Error loading tree: {e}")
        logger.error("Tree explorer error: %s\n%s", e, traceback.format_exc())


def _render_tree_search_results(tree, search_term: str) -> None:
    """Search and display matching tree nodes."""
    term_lower = search_term.lower()
    matches = []

    for node in tree._all_nodes():
        title_match = term_lower in node.title.lower()
        summary_match = node.summary and term_lower in node.summary.lower()
        desc_match = node.description and term_lower in node.description.lower()
        if title_match or summary_match or desc_match:
            matches.append(node)

    if not matches:
        st.info(f"No nodes match '{search_term}'.")
        return

    st.caption(f"Found {len(matches)} node(s) matching '{search_term}'")

    for node in matches:
        with st.container(border=True):
            cols = st.columns([4, 1, 1])
            with cols[0]:
                st.markdown(f"**{node.node_id}** {node.title}")
            with cols[1]:
                st.caption(node.node_type.value)
            with cols[2]:
                st.caption(node.page_range_str)

            if node.summary:
                st.caption(node.summary)

            if node.tables:
                st.caption(f"Tables: {len(node.tables)}")
            if node.cross_references:
                resolved = sum(1 for cr in node.cross_references if cr.resolved)
                st.caption(
                    f"Cross-refs: {len(node.cross_references)} ({resolved} resolved)"
                )


def _render_node_detail(node) -> None:
    """Render detailed view of a single tree node."""
    with st.container(border=True):
        # Header
        cols = st.columns([3, 1, 1, 1])
        with cols[0]:
            st.markdown(f"### {node.node_id}: {node.title}")
        with cols[1]:
            st.metric("Type", node.node_type.value)
        with cols[2]:
            st.metric("Pages", node.page_range_str)
        with cols[3]:
            st.metric("Tokens", f"{node.token_count:,}")

        # Summary
        if node.summary:
            st.markdown("**Summary:**")
            st.text(node.summary)

        # Description
        if node.description:
            st.markdown("**Description:**")
            st.text(node.description)

        # Parent info
        if node.parent_id:
            st.caption(f"Parent: `{node.parent_id}`")

        # Children
        if node.children:
            with st.expander(f"Children ({len(node.children)})", expanded=False):
                for child in node.children:
                    st.markdown(
                        f"- **{child.node_id}** {child.title} "
                        f"({child.page_range_str}, {child.token_count} tok)"
                    )

        # Tables
        if node.tables:
            with st.expander(f"Tables ({len(node.tables)})", expanded=False):
                for table in node.tables:
                    st.markdown(f"**{table.table_id}** (p.{table.page_number})")
                    if table.caption:
                        st.caption(table.caption)
                    md = table.to_markdown()
                    if md:
                        st.markdown(md)
                    st.markdown("---")

        # Cross-references
        if node.cross_references:
            with st.expander(
                f"Cross-References ({len(node.cross_references)})", expanded=False
            ):
                for cr in node.cross_references:
                    status = "Resolved" if cr.resolved else "Unresolved"
                    target = cr.target_node_id if cr.resolved else cr.target_identifier
                    st.markdown(f"- [{status}] {cr.target_identifier} -> `{target}`")

        # Full text
        if node.text:
            with st.expander("Full Text", expanded=False):
                # Limit display to avoid overwhelming the UI
                display_text = node.text[:5000]
                if len(node.text) > 5000:
                    display_text += f"\n\n... [{len(node.text) - 5000} more characters]"
                st.text(display_text)


# ======================================================================
# MAIN
# ======================================================================


def main() -> None:
    """Main application entry point."""

    _render_sidebar()

    # Tab navigation
    tab_qa, tab_docs, tab_tree = st.tabs(
        [
            "Q&A",
            "Documents",
            "Tree Explorer",
        ]
    )

    with tab_qa:
        _render_qa_tab()

    with tab_docs:
        _render_documents_tab()

    with tab_tree:
        _render_tree_explorer_tab()


if __name__ == "__main__":
    main()
