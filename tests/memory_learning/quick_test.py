"""
Quick Test — Runs a small subset of questions to verify the test harness works.

Usage:
    python -m tests.memory_learning.quick_test \
        --backend-url https://your-url.ngrok-free.dev \
        --doc-id YOUR_DOC_ID
"""

import argparse
import json
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from tests.memory_learning.qa_parser import parse_qa_file, group_by_theme
from tests.memory_learning.learning_test_harness import BackendClient, LearningTestRunner


def main():
    parser = argparse.ArgumentParser(description="Quick test of memory learning harness")
    parser.add_argument("--backend-url", required=True, help="Backend URL")
    parser.add_argument("--doc-id", default="", help="Single document ID (fallback for all questions)")
    parser.add_argument("--alm-doc-id", default="", help="Document ID for ALM (163MD) questions")
    parser.add_argument("--kyc-doc-id", default="", help="Document ID for KYC (169MD) questions")
    parser.add_argument("--questions", type=int, default=10, help="Number of questions (default: 10)")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between questions")
    parser.add_argument("--timeout", type=int, default=300, help="Request timeout")
    args = parser.parse_args()

    if not args.doc_id and not args.alm_doc_id and not args.kyc_doc_id:
        parser.error("Must provide --doc-id or --alm-doc-id/--kyc-doc-id")

    qa_file = str(PROJECT_ROOT / "rbi_open_ended_300_qa.md")

    print("=" * 60)
    print("QUICK TEST — Memory Learning Harness")
    print("=" * 60)

    # Step 1: Parse QA file
    print("\n[1/4] Parsing QA file...")
    qa_pairs = parse_qa_file(qa_file)
    print(f"  Parsed {len(qa_pairs)} questions total")

    themes = group_by_theme(qa_pairs)
    print(f"  {len(themes)} themes found")

    # Show structure
    for doc in ["ALM", "KYC", "Cross-document"]:
        doc_qs = [q for q in qa_pairs if q.document == doc]
        print(f"  {doc}: {len(doc_qs)} questions")

    # Verify first few questions
    print("\n  Sample questions:")
    for q in qa_pairs[:3]:
        print(f"    Q{q.number} [{q.document}/{q.variation_type}] Theme {q.theme_number}: {q.question[:60]}...")

    # Step 2: Check backend health
    print(f"\n[2/4] Checking backend at {args.backend_url}...")
    client = BackendClient(
        base_url=args.backend_url,
        doc_id=args.doc_id,
        alm_doc_id=args.alm_doc_id,
        kyc_doc_id=args.kyc_doc_id,
        timeout=args.timeout,
    )

    if not client.check_health():
        print("  ✗ Backend is NOT reachable!")
        print("  Make sure the backend is running and the URL is correct.")
        sys.exit(1)
    print("  ✓ Backend is reachable")

    # Check memory stats
    stats = client.get_memory_stats()
    if stats:
        print(f"  Memory stats: {json.dumps(stats, indent=2)[:200]}...")
    else:
        print("  Memory stats endpoint not available (not critical)")

    # Step 3: Run a single test query
    print(f"\n[3/4] Sending single test query...")
    test_q = qa_pairs[0]
    print(f"  Q{test_q.number}: {test_q.question[:60]}...")

    try:
        start = time.time()
        response = client.send_query_auto(test_q.question, document_type=test_q.document)
        elapsed = time.time() - start

        print(f"  ✓ Response received in {elapsed:.1f}s")
        print(f"    Answer length: {len(response.get('answer', ''))} chars")
        print(f"    Citations: {len(response.get('citations', []))}")
        print(f"    Sections retrieved: {len(response.get('retrieved_sections', []))}")
        print(f"    Total tokens: {response.get('total_tokens', 0)}")
        print(f"    LLM calls: {response.get('llm_calls', 0)}")
        print(f"    Server time: {response.get('total_time_seconds', 0):.1f}s")
        print(f"    Query type: {response.get('query_type', 'N/A')}")
        print(f"    Verification: {response.get('verification_status', 'N/A')}")

        routing = response.get("routing_log", {})
        if routing:
            print(f"    Nodes located: {routing.get('total_nodes_located', 0)}")
            print(f"    Sections read: {routing.get('total_sections_read', 0)}")

    except Exception as e:
        print(f"  ✗ Query failed: {e}")
        sys.exit(1)

    # Step 4: Run the small batch test
    n = min(args.questions, len(qa_pairs))
    print(f"\n[4/4] Running {n}-question batch test...")
    print(f"  This will test {n // 5} complete themes + {n % 5} extra")
    print(f"  Delay between questions: {args.delay}s")
    print()

    runner = LearningTestRunner(
        client=client,
        qa_pairs=qa_pairs,
        output_dir="test_results/quick_test",
        max_questions=n,
        delay_between_questions=args.delay,
        delay_between_themes=2.0,
    )

    report = runner.run()

    if "error" in report:
        print(f"\n✗ Test failed: {report['error']}")
        sys.exit(1)

    # Show quick results
    print("\n" + "=" * 60)
    print("QUICK TEST RESULTS")
    print("=" * 60)

    meta = report["meta"]
    print(f"  Completed: {meta['completed']}, Failed: {meta['failed']}")
    print(f"  Total time: {meta['total_elapsed_seconds']:.0f}s")

    pos = report.get("position_analysis", {})
    if "position_1" in pos:
        print(f"\n  Position 1 (first in theme): {pos['position_1']['avg_wall_time']:.1f}s, "
              f"{pos['position_1']['avg_tokens']} tokens")
    if "position_2" in pos:
        print(f"  Position 2 (second in theme): {pos['position_2']['avg_wall_time']:.1f}s, "
              f"{pos['position_2']['avg_tokens']} tokens")

    if "improvement_1_to_5" in pos:
        imp = pos["improvement_1_to_5"]
        print(f"\n  Time improvement Q1→Q5: {imp['time_reduction_pct']:+.1f}%")
        print(f"  Token improvement Q1→Q5: {imp['token_reduction_pct']:+.1f}%")

    print(f"\n  Full results saved to: test_results/quick_test/")
    print("  Run the full analysis with:")
    print("    python -m tests.memory_learning.analyze_results --results-dir test_results/quick_test")


if __name__ == "__main__":
    main()
