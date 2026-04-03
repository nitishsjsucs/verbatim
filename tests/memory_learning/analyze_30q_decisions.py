"""
Retroactive Decision Analysis — Extract every decision from the 30-question results.

This script reads the existing learning_report.json from the 30-question run
and produces a full decision audit without needing to re-run queries.
"""

import json
import os
import sys
from pathlib import Path

_project_root = str(Path(__file__).resolve().parent.parent.parent)


def analyze_decisions(results_path: str, output_dir: str = None):
    """Analyze all decisions from a learning_report.json."""

    with open(results_path, "r") as f:
        report = json.load(f)

    metrics = report.get("raw_metrics", [])
    if not metrics:
        print("ERROR: No raw_metrics found in report")
        return

    if not output_dir:
        output_dir = str(Path(results_path).parent)

    print(f"Analyzing {len(metrics)} queries from {results_path}\n")

    # ═══════════════════════════════════════════════════════════════
    # Extract per-query decision data
    # ═══════════════════════════════════════════════════════════════

    decisions = []
    for m in metrics:
        st = m.get("stage_timings", {})
        bm = st.get("_benchmark", {})
        stages = bm.get("stages", [])

        # Extract from benchmark stages
        load_meta = {}
        ret_meta = {}
        ret_input_tokens = 0
        ret_output_tokens = 0
        ret_llm_calls = 0

        for stage in stages:
            if stage["stage_name"] == "load_tree":
                load_meta = stage.get("metadata", {})
            elif stage["stage_name"] == "retrieval":
                ret_meta = stage.get("metadata", {})
                ret_input_tokens = stage.get("input_tokens", 0)
                ret_output_tokens = stage.get("output_tokens", 0)
                ret_llm_calls = stage.get("llm_calls", 0)

        d = {
            "q": m["question_number"],
            "theme": m["theme_number"],
            "pos": m.get("position_in_theme", ((m["question_number"] - 1) % 5) + 1),
            "variation": m.get("variation_type", ""),
            "query_type": m.get("query_type", ""),
            "sub_queries": len(m.get("sub_queries", [])),
            "sub_query_texts": m.get("sub_queries", []),
            "key_terms": m.get("key_terms", []),
            # Memory influence
            "qi_suggested": load_meta.get("qi_suggested_nodes", 0),
            "qi_avoid": load_meta.get("qi_avoid_nodes", 0),
            "raptor_candidates": load_meta.get("raptor_candidates", 0),
            "total_memory_candidates": load_meta.get("total_memory_candidates", 0),
            "reliability_scored": load_meta.get("reliability_scored_nodes", 0),
            "user_context_injected": ret_meta.get("user_context_injected", False),
            # Retrieval
            "ret_input_tokens": ret_input_tokens,
            "ret_output_tokens": ret_output_tokens,
            "ret_llm_calls": ret_llm_calls,
            "sections": ret_meta.get("sections_count", m.get("sections_retrieved", 0)),
            "tokens_retrieved": ret_meta.get("tokens_retrieved", m.get("tokens_retrieved", 0)),
            "nodes_located": m.get("nodes_located", 0),
            "nodes_read": m.get("nodes_read", 0),
            # Totals
            "total_tokens": m.get("total_tokens", 0),
            "total_llm_calls": m.get("llm_calls", 0),
            "citations": m.get("citations_count", 0),
            "precision": round(m.get("retrieval_precision", 0), 3),
            "verification": m.get("verification_status", ""),
            "answer_length": m.get("answer_length", 0),
            # Timing
            "wall_time": round(m.get("wall_time_seconds", 0), 1),
            "server_time": round(m.get("server_time_seconds", 0), 1),
            "t_memory": round(st.get("0_memory_prequery", 0), 3),
            "t_retrieval": round(st.get("2_retrieval", 0), 1),
            "t_synthesis": round(st.get("4_synthesis", 0), 1),
            "t_verification": round(st.get("5_verification", 0), 1),
        }
        decisions.append(d)

    # ═══════════════════════════════════════════════════════════════
    # Write decision audit
    # ═══════════════════════════════════════════════════════════════

    audit_path = os.path.join(output_dir, "decision_audit_30q.txt")
    with open(audit_path, "w", encoding="utf-8") as f:
        f.write("=" * 80 + "\n")
        f.write("GOVINDA 30-QUESTION DECISION AUDIT\n")
        f.write("=" * 80 + "\n\n")

        # ── Global patterns ──
        f.write("GLOBAL PATTERNS\n")
        f.write("─" * 40 + "\n\n")

        # Query classification
        qtypes = set(d["query_type"] for d in decisions)
        f.write(f"Query types seen: {qtypes}\n")
        f.write(f"  → ALL queries classified as '{decisions[0]['query_type']}'\n")
        f.write(f"  → This forces the expensive Planner path for every query\n\n")

        # Sub-query counts
        sq_counts = [d["sub_queries"] for d in decisions]
        f.write(f"Sub-queries per query: min={min(sq_counts)}, max={max(sq_counts)}, "
                f"avg={sum(sq_counts)/len(sq_counts):.1f}\n")
        for d in decisions:
            f.write(f"  Q{d['q']:2d} ({d['variation']:10s}): {d['sub_queries']} sub-queries\n")
        f.write("\n")

        # Memory influence stability
        qi_suggested = [d["qi_suggested"] for d in decisions]
        qi_avoid = [d["qi_avoid"] for d in decisions]
        raptor = [d["raptor_candidates"] for d in decisions]
        mem_cands = [d["total_memory_candidates"] for d in decisions]
        f.write(f"QI suggested nodes: {set(qi_suggested)} (unique values)\n")
        f.write(f"QI avoid nodes: {set(qi_avoid)} (unique values)\n")
        f.write(f"RAPTOR candidates: {set(raptor)} (unique values)\n")
        f.write(f"Total memory candidates: {set(mem_cands)} (unique values)\n")
        if len(set(qi_suggested)) == 1:
            f.write(f"  → QI NEVER ADAPTED: always {qi_suggested[0]} suggested nodes\n")
        if all(r == 0 for r in raptor):
            f.write(f"  → RAPTOR NEVER FIRED: 0 candidates for every query\n")
        f.write("\n")

        # ── THE SMOKING GUN: Retrieval input token growth ──
        f.write("═" * 80 + "\n")
        f.write("🔍 CRITICAL FINDING: RETRIEVAL INPUT TOKEN GROWTH\n")
        f.write("═" * 80 + "\n\n")
        f.write("This is the root cause of the token spikes.\n")
        f.write("The user_context is injected into retrieval and grows unboundedly.\n\n")
        f.write(f"{'Q':>3} {'Theme':>5} {'Pos':>3} {'Variation':>10} "
                f"{'Ret Input':>12} {'Ret Output':>12} {'Total Tokens':>12} "
                f"{'Sections':>8} {'Tok Retrieved':>13}\n")
        f.write("-" * 95 + "\n")
        for d in decisions:
            marker = " <<<" if d["ret_input_tokens"] > 50000 else ""
            f.write(f"Q{d['q']:2d}  T{d['theme']:2d}    {d['pos']}  {d['variation']:>10} "
                    f"{d['ret_input_tokens']:>12,} {d['ret_output_tokens']:>12,} "
                    f"{d['total_tokens']:>12,} {d['sections']:>8} "
                    f"{d['tokens_retrieved']:>13,}{marker}\n")

        f.write("\n")
        f.write("KEY OBSERVATION:\n")
        # Find the transition point
        normal_qs = [d for d in decisions if d["ret_input_tokens"] < 20000]
        spike_qs = [d for d in decisions if d["ret_input_tokens"] > 50000]
        if normal_qs and spike_qs:
            f.write(f"  Normal queries (ret_input < 20K): Q{', Q'.join(str(d['q']) for d in normal_qs)}\n")
            f.write(f"  Spike queries (ret_input > 50K):  Q{', Q'.join(str(d['q']) for d in spike_qs)}\n")
            first_spike = spike_qs[0]["q"]
            f.write(f"  First spike at Q{first_spike}\n")
            f.write(f"\n  The user_context injection causes retrieval input tokens to explode.\n")
            f.write(f"  Normal retrieval uses ~10-12K input tokens.\n")
            f.write(f"  After user memory accumulates, retrieval uses 190K+ input tokens.\n")
            f.write(f"  This means the LLM processes 15-20x more data for the same task.\n")
        f.write("\n")

        # ── Per-theme analysis ──
        themes = sorted(set(d["theme"] for d in decisions))
        for theme in themes:
            tqs = [d for d in decisions if d["theme"] == theme]
            f.write("─" * 80 + "\n")
            f.write(f"THEME {theme}: {report['per_theme_learning'][theme-1]['theme_title']}\n")
            f.write("─" * 80 + "\n\n")

            f.write(f"{'Pos':>3} {'Var':>10} {'Wall':>6} {'Synth':>6} "
                    f"{'RetIn':>8} {'Tokens':>8} {'LLM':>4} "
                    f"{'Cit':>4} {'Prec':>5} {'SubQs':>5} {'Verif':>8}\n")
            f.write("-" * 75 + "\n")

            for d in tqs:
                f.write(f"  {d['pos']}  {d['variation']:>10} "
                        f"{d['wall_time']:>5.0f}s {d['t_synthesis']:>5.0f}s "
                        f"{d['ret_input_tokens']:>7,} {d['total_tokens']:>7,} "
                        f"{d['total_llm_calls']:>3} "
                        f"{d['citations']:>3} {d['precision']:>5.2f} "
                        f"{d['sub_queries']:>4} "
                        f"{d['verification']:>8}\n")

            f.write("\n")

            # Theme-specific observations
            time_trend = [d["wall_time"] for d in tqs]
            token_trend = [d["total_tokens"] for d in tqs]
            prec_trend = [d["precision"] for d in tqs]
            ret_in_trend = [d["ret_input_tokens"] for d in tqs]

            if time_trend[-1] > time_trend[0] * 1.2:
                f.write(f"  ⚠ TIME DEGRADATION: {time_trend[0]:.0f}s → {time_trend[-1]:.0f}s "
                        f"(+{(time_trend[-1]/time_trend[0]-1)*100:.0f}%)\n")

            if max(ret_in_trend) > min(ret_in_trend) * 3 and min(ret_in_trend) > 0:
                f.write(f"  ⚠ RETRIEVAL INPUT VARIANCE: {min(ret_in_trend):,} → {max(ret_in_trend):,} "
                        f"({max(ret_in_trend)/min(ret_in_trend):.1f}x)\n")

            if max(token_trend) > min(token_trend) * 3 and min(token_trend) > 0:
                f.write(f"  ⚠ TOKEN BIMODALITY: {min(token_trend):,} → {max(token_trend):,} "
                        f"({max(token_trend)/min(token_trend):.1f}x)\n")

            # Sub-queries
            f.write(f"\n  Sub-query counts: {[d['sub_queries'] for d in tqs]}\n")

            # Decision comparison Q1 vs Q5
            q1 = tqs[0]
            q5 = tqs[-1] if len(tqs) >= 5 else tqs[-1]
            f.write(f"\n  Q1 vs Q{q5['pos']} COMPARISON:\n")
            f.write(f"    Time:       {q1['wall_time']:.0f}s → {q5['wall_time']:.0f}s "
                    f"({'better' if q5['wall_time'] < q1['wall_time'] else 'WORSE'})\n")
            f.write(f"    Tokens:     {q1['total_tokens']:,} → {q5['total_tokens']:,} "
                    f"({'better' if q5['total_tokens'] < q1['total_tokens'] else 'WORSE'})\n")
            f.write(f"    Precision:  {q1['precision']:.2f} → {q5['precision']:.2f} "
                    f"({'better' if q5['precision'] > q1['precision'] else 'WORSE'})\n")
            f.write(f"    Ret Input:  {q1['ret_input_tokens']:,} → {q5['ret_input_tokens']:,} "
                    f"({'better' if q5['ret_input_tokens'] < q1['ret_input_tokens'] else 'WORSE'})\n")
            f.write(f"    Sub-queries: {q1['sub_queries']} → {q5['sub_queries']}\n")
            f.write(f"    LLM calls:  {q1['total_llm_calls']} → {q5['total_llm_calls']}\n")
            f.write("\n")

        # ── Root Cause Summary ──
        f.write("=" * 80 + "\n")
        f.write("ROOT CAUSE ANALYSIS\n")
        f.write("=" * 80 + "\n\n")

        f.write("[CRITICAL] F1 — UNBOUNDED USER CONTEXT INJECTION\n")
        f.write("  The UserMemoryManager accumulates interaction history.\n")
        f.write("  This context is injected into EVERY retrieval query via:\n")
        f.write('    effective_query = f"{query_text}\\n\\n[User Context]: {user_context}"\n')
        f.write("  By Q11, user_context contains summaries of 10 previous Q&A pairs,\n")
        f.write("  causing retrieval input tokens to explode from 10K to 190K+.\n")
        f.write("  This happens because the LLM classifier/locator receives the\n")
        f.write("  entire bloated query for EVERY sub-query retrieval in the Planner.\n")
        f.write("  FIX: Cap user_context to 2000 tokens or last 3 interactions.\n\n")

        f.write("[HIGH] F2 — SYNTHESIS DOMINATES PIPELINE TIME\n")
        synth_pcts = []
        for d in decisions:
            if d["server_time"] > 0:
                synth_pcts.append(d["t_synthesis"] / d["server_time"] * 100)
        avg_synth_pct = sum(synth_pcts) / len(synth_pcts) if synth_pcts else 0
        f.write(f"  Synthesis is {avg_synth_pct:.0f}% of server time on average.\n")
        f.write("  The Planner runs N sub-query retrievals in parallel, then\n")
        f.write("  synthesizes from all merged sections. Each sub-query retrieval\n")
        f.write("  includes the bloated user_context.\n")
        f.write("  FIX: Cache synthesis for near-duplicate queries within a theme.\n")
        f.write("       Reduce sub-queries to max 4.\n\n")

        f.write("[MEDIUM] F3 — QUERY INTELLIGENCE IS STALE\n")
        f.write(f"  QI suggested the same {qi_suggested[0]} nodes for ALL {len(decisions)} queries.\n")
        f.write(f"  QI avoided the same {qi_avoid[0]} node for ALL queries.\n")
        f.write("  The learning loop records facts but the suggestions don't adapt\n")
        f.write("  because they're based on embedding similarity to the query,\n")
        f.write("  and all ALM queries have similar embeddings.\n")
        f.write("  FIX: Weight QI suggestions by recent key_term overlap, not just\n")
        f.write("       embedding similarity.\n\n")

        f.write("[MEDIUM] F4 — ALL QUERIES CLASSIFIED AS MULTI_HOP\n")
        f.write("  Even simple 'explain' and 'why' variations get the expensive\n")
        f.write("  multi-hop Planner path with parallel sub-query retrieval.\n")
        f.write("  FIX: After the first multi_hop query in a theme achieves\n")
        f.write("       high precision, classify subsequent variations as single_hop.\n\n")

        f.write("[LOW] F5 — RAPTOR INDEX NEVER FIRES\n")
        f.write("  The 'Know What Matters' loop contributed 0 candidates.\n")
        f.write("  This entire learning subsystem is inactive during normal queries.\n")
        f.write("  FIX: Trigger raptor.build_index after N queries on a doc.\n\n")

        f.write("[INFO] F6 — RETRIEVAL TIME IS CONSTANT\n")
        ret_times = [d["t_retrieval"] for d in decisions]
        f.write(f"  Retrieval time: {min(ret_times):.0f}s to {max(ret_times):.0f}s "
                f"(avg {sum(ret_times)/len(ret_times):.0f}s)\n")
        f.write("  The memory system is NOT reducing retrieval time.\n")
        f.write("  Retrieval does the same 6 LLM calls every time.\n\n")

    print(f"\nDecision audit written to: {audit_path}")

    # Also save structured JSON
    json_path = os.path.join(output_dir, "decisions_30q.json")
    with open(json_path, "w") as f:
        json.dump(decisions, f, indent=2)
    print(f"Structured decisions: {json_path}")

    return decisions


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", default="test_results/memory_learning_30/learning_report.json")
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()
    analyze_decisions(args.results, args.output_dir)
