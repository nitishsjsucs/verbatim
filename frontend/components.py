"""
Reusable UI components for GOVINDA V2 Streamlit app.

Display components for answers, citations, verification,
routing logs, and document tree visualization.
"""

from __future__ import annotations

import streamlit as st

from typing import Optional

from models.query import Answer, Citation, InferredPoint, RetrievedSection, RoutingLog


def render_answer_card(query_text: str, answer: Answer) -> None:
    """Render a complete answer card with citations and verification."""
    with st.container(border=True):
        # ── Header row ──
        cols = st.columns([5, 1, 1, 1])
        with cols[0]:
            st.markdown(f"**Q:** {query_text}")
        with cols[1]:
            st.caption(f"Type: `{answer.query_type.value}`")
        with cols[2]:
            _render_verification_badge(answer.verification_status)
        with cols[3]:
            st.caption(f"{answer.total_time_seconds:.1f}s")

        # ── Main answer ──
        st.markdown("---")
        st.markdown(answer.text)

        # ── Citations ──
        if answer.citations:
            with st.expander(f"Citations ({len(answer.citations)})", expanded=False):
                _render_citations(answer.citations)

        # ── Inferred Points ──
        if answer.inferred_points:
            with st.expander(
                f"Inferred Points ({len(answer.inferred_points)})", expanded=False
            ):
                _render_inferred_points(answer.inferred_points)

        # ── Verification Details ──
        if answer.verification_notes:
            with st.expander("Verification Details", expanded=False):
                st.text(answer.verification_notes)

        # ── Pipeline Stats ──
        with st.expander("Pipeline Stats", expanded=False):
            stat_cols = st.columns(4)
            with stat_cols[0]:
                st.metric("Sections Retrieved", len(answer.retrieved_sections))
            with stat_cols[1]:
                st.metric("Citations", len(answer.citations))
            with stat_cols[2]:
                st.metric("LLM Calls", answer.llm_calls)
            with stat_cols[3]:
                st.metric("Total Tokens", f"{answer.total_tokens:,}")

            # ── Stage Timing Breakdown ──
            if answer.stage_timings:
                st.markdown("**Stage Timing Breakdown**")
                _render_stage_timings(answer.stage_timings, answer.total_time_seconds)

                # Show retrieval sub-step breakdown if available
                if answer.routing_log and answer.routing_log.stage_timings:
                    st.markdown("**Retrieval Sub-step Breakdown**")
                    _render_stage_timings(
                        answer.routing_log.stage_timings,
                        answer.stage_timings.get("2_retrieval", 0),
                    )


def _render_verification_badge(status: str) -> None:
    """Render a colored verification badge."""
    color_map = {
        "verified": "green",
        "partially_verified": "orange",
        "unverified": "red",
        "skipped": "gray",
    }
    color = color_map.get(status, "gray")
    label = status.replace("_", " ").title()
    st.markdown(
        f'<span style="color:{color};font-weight:bold;font-size:0.85em">{label}</span>',
        unsafe_allow_html=True,
    )


def _render_stage_timings(timings: dict[str, float], total: float) -> None:
    """Render a timing breakdown as a horizontal bar + table."""
    if not timings or total <= 0:
        return

    # Render as a simple table with percentage bars
    for stage, seconds in timings.items():
        pct = (seconds / total * 100) if total > 0 else 0
        label = stage.replace("_", " ").title()
        # Bar width capped at 100%
        bar_width = min(pct, 100)
        st.markdown(
            f'<div style="margin:2px 0">'
            f'<span style="display:inline-block;width:180px;font-size:0.85em">{label}</span>'
            f'<span style="display:inline-block;width:60px;font-size:0.85em;text-align:right">{seconds:.1f}s</span>'
            f'&nbsp;'
            f'<span style="display:inline-block;width:{bar_width * 2}px;height:12px;'
            f'background:{"#ff4b4b" if pct > 50 else "#ffa726" if pct > 25 else "#66bb6a"};'
            f'border-radius:3px"></span>'
            f'<span style="font-size:0.75em;color:#888">&nbsp;{pct:.0f}%</span>'
            f'</div>',
            unsafe_allow_html=True,
        )


def _render_citations(citations: list[Citation]) -> None:
    """Render citation list."""
    for c in citations:
        page = f" ({c.page_range})" if c.page_range else ""
        st.markdown(f"**{c.citation_id}** {c.title}{page}")
        if c.excerpt:
            st.caption(f'"{c.excerpt[:200]}"')


def _render_inferred_points(points: list[InferredPoint]) -> None:
    """Render inferred points with confidence badges and reasoning chains."""
    st.info(
        "These points are **logically inferred** from definitions and rules "
        "in the regulatory text. They are NOT explicitly stated. Review the "
        "reasoning chain and supporting text for each point."
    )
    for i, ip in enumerate(points, 1):
        conf_color = {"high": "green", "medium": "orange", "low": "red"}.get(
            ip.confidence, "gray"
        )
        st.markdown(
            f'**{i}.** <span style="color:{conf_color};font-weight:bold">'
            f"[{ip.confidence.upper()}]</span> {ip.point}",
            unsafe_allow_html=True,
        )
        if ip.reasoning:
            st.markdown(f"&nbsp;&nbsp;&nbsp;&nbsp;*Reasoning:* {ip.reasoning}")
        if ip.supporting_definitions:
            for sd in ip.supporting_definitions:
                st.markdown(
                    f'&nbsp;&nbsp;&nbsp;&nbsp;*Based on:* "{sd[:300]}"',
                    unsafe_allow_html=True,
                )
        if ip.supporting_sections:
            st.caption(
                f"&nbsp;&nbsp;&nbsp;&nbsp;Source sections: "
                f"{', '.join(ip.supporting_sections)}"
            )


def render_routing_log(log: RoutingLog) -> None:
    """Render a routing log for audit purposes."""
    with st.container(border=True):
        st.subheader("Routing Log")
        cols = st.columns(4)
        with cols[0]:
            st.metric("Query Type", log.query_type.value if log.query_type else "N/A")
        with cols[1]:
            st.metric("Nodes Located", log.total_nodes_located)
        with cols[2]:
            st.metric("Sections Read", log.total_sections_read)
        with cols[3]:
            st.metric("Tokens Retrieved", f"{log.total_tokens_retrieved:,}")

        if log.locate_results:
            with st.expander("Located Nodes", expanded=False):
                for r in log.locate_results:
                    st.markdown(
                        f"**{r['node_id']}**: {r['title']} "
                        f"(conf: {r.get('confidence', 'N/A')})"
                    )
                    if r.get("reason"):
                        st.caption(r["reason"][:150])

        if log.cross_ref_follows:
            with st.expander("Cross-Reference Follows", expanded=False):
                for r in log.cross_ref_follows:
                    st.markdown(
                        f"**{r['node_id']}**: {r['title']} ({r.get('tokens', 0)} tok)"
                    )


def render_tree_outline(tree) -> None:
    """Render document tree as an expandable outline."""
    for node in tree.structure:
        _render_tree_node(node, depth=0)


def _render_tree_node(node, depth: int = 0) -> None:
    """Recursively render a tree node."""
    indent = "&nbsp;" * (depth * 4)
    page_info = node.page_range_str
    tables = f" [{len(node.tables)} tables]" if node.tables else ""
    refs = f" [{len(node.cross_references)} refs]" if node.cross_references else ""

    label = f"{indent}**{node.node_id}** {node.title} ({page_info}){tables}{refs}"

    if node.children:
        with st.expander(label, expanded=(depth == 0)):
            if node.summary:
                st.caption(node.summary)
            for child in node.children:
                _render_tree_node(child, depth + 1)
    else:
        st.markdown(label, unsafe_allow_html=True)
        if node.summary:
            st.caption(
                f"{'&nbsp;' * ((depth + 1) * 4)}{node.summary}", unsafe_allow_html=True
            )


def render_document_info(tree) -> None:
    """Render document metadata."""
    cols = st.columns(4)
    with cols[0]:
        st.metric("Document", tree.doc_name)
    with cols[1]:
        st.metric("Pages", tree.total_pages)
    with cols[2]:
        st.metric("Nodes", tree.node_count)
    with cols[3]:
        top_level = len(tree.structure)
        st.metric("Top-Level Sections", top_level)

    if tree.doc_description:
        st.caption(tree.doc_description[:300])


# ======================================================================
# Retrieval Preview (shown while synthesis is running)
# ======================================================================


def render_retrieval_preview(
    query_text: str,
    sections: list[RetrievedSection],
    routing_log: Optional[RoutingLog] = None,
    tree=None,
) -> None:
    """Render a preview of retrieved sections while synthesis is running."""
    with st.container(border=True):
        st.markdown(f"**Q:** {query_text}")
        st.info(
            "Synthesizing answer... Retrieved sections shown below for early reading."
        )

        if routing_log:
            cols = st.columns(3)
            with cols[0]:
                st.metric("Sections Retrieved", len(sections))
            with cols[1]:
                st.metric("Total Tokens", f"{sum(s.token_count for s in sections):,}")
            with cols[2]:
                qt = routing_log.query_type.value if routing_log.query_type else "N/A"
                st.metric("Query Type", qt)

        # Sort sections by locator confidence (highest first)
        sorted_sections = _sort_by_relevance(sections, routing_log)

        for s in sorted_sections:
            with st.container(border=True):
                col_title, col_pages, col_conf = st.columns([4, 1, 1])
                with col_title:
                    st.markdown(f"**{s.node_id}:** {s.title}")
                with col_pages:
                    st.caption(s.page_range)
                with col_conf:
                    conf = _get_confidence(s.node_id, routing_log)
                    if conf is not None:
                        color = "#66bb6a" if conf >= 0.7 else "#ffa726" if conf >= 0.4 else "#ff4b4b"
                        st.markdown(
                            f'<span style="color:{color};font-size:0.85em;font-weight:bold">'
                            f'{conf:.0%} relevance</span>',
                            unsafe_allow_html=True,
                        )
                    else:
                        st.caption(f"{s.token_count} tok")

                # Show summary/description from tree node if available
                if tree is not None:
                    node = tree.get_node(s.node_id)
                    if node:
                        if node.summary:
                            st.caption(f"*{node.summary}*")
                        elif node.description:
                            st.caption(f"*{node.description[:200]}*")

                # Show first ~200 chars of section text
                preview = s.text[:200].strip()
                if len(s.text) > 200:
                    preview += "..."
                st.text(preview)


def _sort_by_relevance(
    sections: list[RetrievedSection],
    routing_log: Optional[RoutingLog],
) -> list[RetrievedSection]:
    """Sort sections by locator confidence score (highest first)."""
    if not routing_log or not routing_log.locate_results:
        return sections

    # Build confidence map: node_id -> confidence
    conf_map: dict[str, float] = {}
    for r in routing_log.locate_results:
        nid = r.get("node_id", "")
        conf = r.get("confidence", 0.0)
        if isinstance(conf, (int, float)):
            conf_map[nid] = float(conf)

    if not conf_map:
        return sections

    # Sort: sections whose node_id (or parent) has a confidence score come first,
    # ordered by confidence descending. Sections without a score go last.
    def sort_key(s: RetrievedSection) -> float:
        return conf_map.get(s.node_id, -1.0)

    return sorted(sections, key=sort_key, reverse=True)


def _get_confidence(
    node_id: str, routing_log: Optional[RoutingLog]
) -> Optional[float]:
    """Get the locator confidence score for a node_id."""
    if not routing_log or not routing_log.locate_results:
        return None
    for r in routing_log.locate_results:
        if r.get("node_id") == node_id:
            conf = r.get("confidence")
            if isinstance(conf, (int, float)):
                return float(conf)
    return None


# ======================================================================
# Feedback UI (shown below each answer)
# ======================================================================


def render_feedback_ui(record_id: Optional[str]) -> None:
    """Render a feedback form below an answer card."""
    if record_id is None:
        return

    submitted_key = f"feedback_submitted_{record_id}"

    if st.session_state.get(submitted_key, False):
        st.caption("Feedback submitted. Thank you.")
        return

    with st.expander("Provide Feedback", expanded=False):
        feedback_text = st.text_area(
            "Your feedback on this answer",
            key=f"feedback_{record_id}",
            height=80,
            placeholder="e.g., Answer was accurate but missed Section 12 requirements...",
        )
        rating = st.select_slider(
            "Rating",
            options=[1, 2, 3, 4, 5],
            value=3,
            key=f"rating_{record_id}",
            help="1 = Poor, 5 = Excellent",
        )

        if st.button("Submit Feedback", key=f"submit_{record_id}"):
            if feedback_text.strip():
                from tree.query_store import QueryStore

                store = QueryStore()
                success = store.update_feedback(
                    record_id, feedback_text.strip(), rating
                )
                if success:
                    st.session_state[submitted_key] = True
                    st.success("Feedback saved.")
                    st.rerun()
                else:
                    st.error("Could not save feedback -- record not found.")
            else:
                st.warning("Please enter feedback text before submitting.")
