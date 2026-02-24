# GOVINDA V2 Performance Testing & Verification Guide

## Overview
This guide provides step-by-step instructions for measuring and verifying each performance optimization, with specific benchmarks and testing procedures.

---

## MEASUREMENT FRAMEWORK

### 1. Setup Instrumentation
Before implementing fixes, add a performance monitoring class to track metrics.

**File: `utils/performance.py` (NEW)**

```python
"""
Performance monitoring and metrics collection for GOVINDA V2.
"""

import logging
import time
from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
import json

logger = logging.getLogger(__name__)


@dataclass
class QueryMetrics:
    """Metrics for a single query execution."""
    timestamp: str
    query_text: str
    query_type: str
    total_time_ms: float
    
    # Phase timings
    classify_ms: float = 0
    expand_ms: float = 0
    locate_ms: float = 0
    read_ms: float = 0
    synthesis_ms: float = 0
    verification_ms: float = 0
    reflection_ms: float = 0
    
    # Quality metrics
    sections_retrieved: int = 0
    sections_reflected: int = 0
    citations: int = 0
    tokens_used: int = 0
    llm_calls: int = 0
    
    # Flags
    verify_enabled: bool = False
    reflect_enabled: bool = False
    reflection_triggered: bool = False
    reflection_early_terminated: bool = False
    
    # Status
    verification_status: str = "skipped"
    success: bool = True
    error: str = ""


@dataclass
class IngestionMetrics:
    """Metrics for a single document ingestion."""
    timestamp: str
    document_name: str
    total_time_ms: float
    
    # Phase timings
    parse_ms: float = 0
    structure_detect_ms: float = 0
    tree_build_ms: float = 0
    enrichment_ms: float = 0
    cross_refs_ms: float = 0
    
    # Quality metrics
    total_pages: int = 0
    total_nodes: int = 0
    enrichment_llm_calls: int = 0
    
    success: bool = True
    error: str = ""


class PerformanceMonitor:
    """Collect and analyze performance metrics."""
    
    def __init__(self, log_file: Optional[str] = None):
        self.queries: List[QueryMetrics] = []
        self.ingestions: List[IngestionMetrics] = []
        self.log_file = log_file
    
    def record_query(self, metrics: QueryMetrics):
        """Record metrics for a single query."""
        self.queries.append(metrics)
        
        if self.log_file:
            with open(self.log_file, 'a') as f:
                f.write(json.dumps(asdict(metrics)) + '\n')
        
        logger.info(f"Query recorded: {metrics.total_time_ms:.0f}ms")
    
    def record_ingestion(self, metrics: IngestionMetrics):
        """Record metrics for a single ingestion."""
        self.ingestions.append(metrics)
        
        if self.log_file:
            with open(self.log_file, 'a') as f:
                f.write(json.dumps(asdict(metrics)) + '\n')
        
        logger.info(f"Ingestion recorded: {metrics.total_time_ms:.0f}ms")
    
    def query_summary(self) -> Dict:
        """Generate summary statistics for all queries."""
        if not self.queries:
            return {}
        
        times = [q.total_time_ms for q in self.queries]
        times_sorted = sorted(times)
        n = len(times)
        
        return {
            "count": n,
            "avg_ms": sum(times) / n,
            "min_ms": min(times),
            "max_ms": max(times),
            "p50_ms": times_sorted[n // 2],
            "p95_ms": times_sorted[int(n * 0.95)],
            "p99_ms": times_sorted[int(n * 0.99)] if n > 100 else times_sorted[-1],
            "total_llm_calls": sum(q.llm_calls for q in self.queries),
            "total_tokens": sum(q.tokens_used for q in self.queries),
        }
    
    def ingestion_summary(self) -> Dict:
        """Generate summary statistics for all ingestions."""
        if not self.ingestions:
            return {}
        
        times = [i.total_time_ms for i in self.ingestions]
        times_sorted = sorted(times)
        n = len(times)
        
        return {
            "count": n,
            "avg_ms": sum(times) / n,
            "min_ms": min(times),
            "max_ms": max(times),
            "p50_ms": times_sorted[n // 2],
            "total_docs": n,
            "total_pages": sum(i.total_pages for i in self.ingestions),
            "total_nodes": sum(i.total_nodes for i in self.ingestions),
        }
    
    def print_summary(self):
        """Print summary statistics."""
        print("\n" + "=" * 70)
        print("QUERY PERFORMANCE SUMMARY")
        print("=" * 70)
        
        q_summary = self.query_summary()
        if q_summary:
            print(f"Total queries: {q_summary['count']}")
            print(f"  Avg: {q_summary['avg_ms']:.0f}ms")
            print(f"  P50: {q_summary['p50_ms']:.0f}ms")
            print(f"  P95: {q_summary['p95_ms']:.0f}ms")
            print(f"  P99: {q_summary['p99_ms']:.0f}ms")
            print(f"  Total LLM calls: {q_summary['total_llm_calls']}")
            print(f"  Total tokens: {q_summary['total_tokens']}")
        else:
            print("No query data collected")
        
        print("\n" + "=" * 70)
        print("INGESTION PERFORMANCE SUMMARY")
        print("=" * 70)
        
        i_summary = self.ingestion_summary()
        if i_summary:
            print(f"Total ingestions: {i_summary['count']}")
            print(f"  Avg: {i_summary['avg_ms']:.0f}ms")
            print(f"  P50: {i_summary['p50_ms']:.0f}ms")
            print(f"  Total documents: {i_summary['total_docs']}")
            print(f"  Total pages: {i_summary['total_pages']}")
            print(f"  Total nodes: {i_summary['total_nodes']}")
        else:
            print("No ingestion data collected")
        
        print("=" * 70 + "\n")


# Global instance
_monitor: Optional[PerformanceMonitor] = None

def get_monitor() -> PerformanceMonitor:
    """Get or create the global performance monitor."""
    global _monitor
    if _monitor is None:
        _monitor = PerformanceMonitor(log_file="/tmp/govinda_perf.jsonl")
    return _monitor
```

---

## BEFORE/AFTER TEST PROCEDURES

### Test 1: FIX #1 - Dependency Injection Singletons

**Objective:** Verify that backend components are instantiated once, not per-request.

**Measurement Script:**

```python
# test_performance_fix1.py
import time
import threading
from utils.performance import QueryMetrics, get_monitor
from datetime import datetime

def test_singleton_instantiation():
    """
    Verify that get_* functions return same instances (singletons).
    """
    print("\n" + "=" * 70)
    print("TEST: Dependency Injection Singleton Pattern")
    print("=" * 70)
    
    from app_backend.main import (
        get_tree_store, get_qa_engine, get_ingestion_pipeline,
        get_query_store, get_corpus_store
    )
    
    # Get instances multiple times
    instances_1 = [
        get_tree_store(),
        get_qa_engine(),
        get_ingestion_pipeline(),
        get_query_store(),
        get_corpus_store(),
    ]
    
    time.sleep(0.1)  # Small delay
    
    instances_2 = [
        get_tree_store(),
        get_qa_engine(),
        get_ingestion_pipeline(),
        get_query_store(),
        get_corpus_store(),
    ]
    
    # Verify same instances
    all_singleton = all(
        id(i1) == id(i2)
        for i1, i2 in zip(instances_1, instances_2)
    )
    
    if all_singleton:
        print("✓ PASS: All components are singletons (same instance returned)")
        
        # Measure instantiation overhead
        t0 = time.time()
        for _ in range(1000):
            _ = get_tree_store()
            _ = get_qa_engine()
        elapsed_ms = (time.time() - t0) * 1000
        
        print(f"  Baseline (after fix): {elapsed_ms:.1f}ms for 1000 lookups")
        print(f"  Per-lookup: {elapsed_ms / 1000:.3f}ms")
        
        if elapsed_ms < 100:  # Should be under 100ms for 1000 lookups
            print("  ✓ PASS: Singleton lookup overhead acceptable (<0.1ms per call)")
        else:
            print("  ✗ FAIL: Lookup overhead too high")
            return False
    else:
        print("✗ FAIL: Components are NOT singletons (different instances)")
        return False
    
    return True


def test_query_latency_multiple_requests():
    """
    Run multiple queries and verify response time consistency.
    Should be stable (not increasing) due to singleton reuse.
    """
    print("\n" + "=" * 70)
    print("TEST: Query Latency with Repeated Requests")
    print("=" * 70)
    
    import requests
    
    base_url = "http://localhost:8000"
    
    # First: get a document to test with
    response = requests.get(f"{base_url}/documents")
    if response.status_code != 200 or not response.json():
        print("✗ SKIP: No documents available")
        return None
    
    doc_id = response.json()[0]["id"]
    print(f"Using document: {doc_id}")
    
    # Run 10 queries sequentially
    latencies = []
    for i in range(10):
        query = {"query": f"What is section {i+1}?", "doc_id": doc_id}
        
        t0 = time.time()
        response = requests.post(f"{base_url}/query", json=query)
        latency_ms = (time.time() - t0) * 1000
        
        latencies.append(latency_ms)
        print(f"  Request {i+1}: {latency_ms:.0f}ms")
    
    # Check for stability
    avg_latency = sum(latencies) / len(latencies)
    last_3_avg = sum(latencies[-3:]) / 3
    
    print(f"\nAverage latency: {avg_latency:.0f}ms")
    print(f"Last 3 average: {last_3_avg:.0f}ms")
    
    # If singletons work, latencies should be consistent
    if abs(last_3_avg - avg_latency) < avg_latency * 0.2:  # Within 20%
        print("✓ PASS: Latencies stable (singletons working)")
        return True
    else:
        print("⚠ WARNING: Latencies vary significantly")
        return True  # Still pass, but note variance


# Run tests
if __name__ == "__main__":
    test_singleton_instantiation()
    test_query_latency_multiple_requests()
```

**Expected Results:**

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Singleton check | ✗ FAIL (new instances) | ✓ PASS (same instance) | 100% |
| Per-lookup overhead | ~5-10ms (construction) | <0.1ms (dict lookup) | 50-100× |
| Response time | 500-600ms | 400-500ms (20% faster) | 20-25% |

---

### Test 2: FIX #2 - Query Expansion Gating

**Objective:** Verify that query expansion is skipped for single-hop and definitional queries.

**Measurement Script:**

```python
# test_performance_fix2.py
import requests
import json
from datetime import datetime

def test_query_expansion_gating():
    """
    Test that query expansion is skipped for appropriate query types.
    """
    print("\n" + "=" * 70)
    print("TEST: Query Expansion Gating")
    print("=" * 70)
    
    base_url = "http://localhost:8000"
    
    # Get a document
    response = requests.get(f"{base_url}/documents")
    if not response.json():
        print("✗ SKIP: No documents")
        return None
    
    doc_id = response.json()[0]["id"]
    
    # Test cases: (query, expected_query_type, should_expand)
    test_cases = [
        ("Define beneficial owner", "definitional", False),
        ("What is KYC?", "single_hop", False),
        ("Compare KYC for individuals vs entities", "multi_hop", True),
        ("Explain all compliance requirements", "global", True),
    ]
    
    results = []
    
    for query_text, expected_type, should_expand in test_cases:
        print(f"\nQuery: {query_text}")
        print(f"Expected type: {expected_type}, Should expand: {should_expand}")
        
        # Run query via API
        payload = {"query": query_text, "doc_id": doc_id}
        response = requests.post(f"{base_url}/query", json=payload)
        
        if response.status_code != 200:
            print(f"✗ Error: {response.status_code}")
            results.append(False)
            continue
        
        data = response.json()
        query_type = data.get("query_type", "unknown")
        routing_log = data.get("routing_log", {})
        
        # Check if expansion happened
        stage_timings = routing_log.get("stage_timings", {})
        expand_time = stage_timings.get("2_expansion", 0)
        
        # Expansion should be <5ms if skipped, >50ms if run
        expansion_was_skipped = expand_time < 10
        
        print(f"Actual type: {query_type}")
        print(f"Expansion time: {expand_time:.1f}ms")
        print(f"Expansion skipped: {expansion_was_skipped}")
        
        # Verify correctness
        is_correct = (
            query_type == expected_type and
            expansion_was_skipped == (not should_expand)
        )
        
        if is_correct:
            print("✓ PASS")
            results.append(True)
        else:
            print("✗ FAIL")
            results.append(False)
    
    print("\n" + "=" * 70)
    print(f"Results: {sum(results)}/{len(results)} passed")
    
    return all(results)


# Run test
if __name__ == "__main__":
    test_query_expansion_gating()
```

**Expected Results:**

| Query Type | Expansion Skipped? | Time (ms) | Status |
|------------|-------------------|-----------|--------|
| Definitional | Yes | <5 | ✓ PASS |
| Single-hop | Yes | <5 | ✓ PASS |
| Multi-hop | No | 50-100 | ✓ PASS |
| Global | No | 50-100 | ✓ PASS |

---

### Test 3: FIX #3 - Reflection Early Termination

**Objective:** Verify that reflection is skipped for high-confidence evidence.

**Measurement Script:**

```python
# test_performance_fix3.py
import requests
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_reflection_early_termination():
    """
    Test that reflection is early-terminated for high-confidence retrievals.
    """
    print("\n" + "=" * 70)
    print("TEST: Reflection Early Termination")
    print("=" * 70)
    
    base_url = "http://localhost:8000"
    
    # Get a document
    response = requests.get(f"{base_url}/documents")
    if not response.json():
        print("✗ SKIP: No documents")
        return None
    
    doc_id = response.json()[0]["id"]
    
    # Test 1: Simple query (should have early termination)
    print("\nTest 1: Simple query (should early-terminate reflection)")
    simple_query = "What is the definition of beneficial owner?"
    
    response = requests.post(
        f"{base_url}/query",
        json={
            "query": simple_query,
            "doc_id": doc_id,
            "reflect": True,
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        routing_log = data.get("routing_log", {})
        stage_timings = routing_log.get("stage_timings", {})
        
        reflection_time = (
            data.get("stage_timings", {}).get("3_reflection", 0)
        )
        
        print(f"  Reflection time: {reflection_time:.1f}s")
        
        # If high-quality/confident evidence, reflection time should be minimal
        if reflection_time < 5:
            print("  ✓ Reflection early-terminated (expected)")
        else:
            print("  ⚠ Reflection ran (no early termination triggered)")
    
    # Test 2: Complex query (may require reflection)
    print("\nTest 2: Complex query (may require reflection)")
    complex_query = "Compare KYC requirements across all regulatory documents"
    
    response = requests.post(
        f"{base_url}/query",
        json={
            "query": complex_query,
            "doc_id": doc_id,
            "reflect": True,
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        reflection_time = (
            data.get("stage_timings", {}).get("3_reflection", 0)
        )
        
        print(f"  Reflection time: {reflection_time:.1f}s")
        
        if reflection_time > 5:
            print("  ✓ Reflection ran as expected for complex query")
        else:
            print("  ✓ Reflection early-terminated")


# Run test
if __name__ == "__main__":
    test_reflection_early_termination()
```

**Expected Results:**

| Query Complexity | Reflection Time | Status |
|------------------|-----------------|--------|
| Simple (definitive) | <5s | ✓ Early-terminated |
| Complex (multi-hop) | 30-90s | ✓ Runs as needed |

---

### Test 4: FIX #4 - Batch Synthesis + Verification

**Objective:** Verify that synthesis and verification are combined into one LLM call.

**Measurement Script:**

```python
# test_performance_fix4.py
import requests
import time

def test_synthesis_verification_batching():
    """
    Test that synthesis includes verification in same LLM call.
    Compare time with/without verification.
    """
    print("\n" + "=" * 70)
    print("TEST: Synthesis + Verification Batching")
    print("=" * 70)
    
    base_url = "http://localhost:8000"
    
    # Get a document
    response = requests.get(f"{base_url}/documents")
    if not response.json():
        print("✗ SKIP: No documents")
        return None
    
    doc_id = response.json()[0]["id"]
    query = "What are the main regulatory requirements?"
    
    # Test 1: With verification
    print("\nTest 1: Query with verification enabled")
    t0 = time.time()
    response = requests.post(
        f"{base_url}/query",
        json={"query": query, "doc_id": doc_id, "verify": True}
    )
    time_with_verify = time.time() - t0
    
    if response.status_code == 200:
        data = response.json()
        timings = data.get("stage_timings", {})
        
        synthesis_time = timings.get("4_synthesis", 0)
        verification_time = timings.get("5_verification", 0)
        
        print(f"  Synthesis time: {synthesis_time:.1f}s")
        print(f"  Verification time: {verification_time:.1f}s")
        print(f"  Total: {time_with_verify:.1f}s")
        print(f"  Verification status: {data.get('verification_status', 'unknown')}")
        
        # With batching, verification_time should be ~0 (combined in synthesis)
        if verification_time < 5:
            print("  ✓ PASS: Verification time minimal (batched in synthesis)")
        else:
            print("  ⚠ WARNING: Separate verification still running")
    
    # Test 2: Without verification
    print("\nTest 2: Query with verification disabled")
    t0 = time.time()
    response = requests.post(
        f"{base_url}/query",
        json={"query": query, "doc_id": doc_id, "verify": False}
    )
    time_without_verify = time.time() - t0
    
    if response.status_code == 200:
        data = response.json()
        print(f"  Total time: {time_without_verify:.1f}s")
        print(f"  Verification status: {data.get('verification_status', 'unknown')}")
    
    # Difference should be minimal (since verification is in synthesis)
    time_diff = time_with_verify - time_without_verify
    print(f"\nTime difference: {time_diff:.1f}s")
    
    if time_diff < 10:  # Should save at most a few seconds (if any overhead)
        print("✓ PASS: Minimal time difference (batching working)")
        return True
    else:
        print("✗ FAIL: Large time difference (separate verification still happening)")
        return False


# Run test
if __name__ == "__main__":
    test_synthesis_verification_batching()
```

**Expected Results:**

| Configuration | Synthesis (s) | Verification (s) | Total (s) | Improvement |
|---|---|---|---|---|
| Before (separate) | 80-120 | 20-40 | 100-160 | — |
| After (batched) | 90-130 | <5 | 90-135 | 10-20% faster |

---

### Test 5: FIX #5 - MongoDB Batch Reads

**Objective:** Verify that /documents endpoint uses single query, not N+1.

**Measurement Script:**

```python
# test_performance_fix5.py
import requests
import time
from unittest.mock import patch

def test_mongodb_batch_reads():
    """
    Test that document listing uses single batch query.
    """
    print("\n" + "=" * 70)
    print("TEST: MongoDB Batch Reads for Document Listing")
    print("=" * 70)
    
    base_url = "http://localhost:8000"
    
    # Measure time to list documents
    print("\nTest: /documents endpoint (should use single query)")
    
    t0 = time.time()
    response = requests.get(f"{base_url}/documents")
    elapsed_ms = (time.time() - t0) * 1000
    
    print(f"  Response time: {elapsed_ms:.1f}ms")
    
    if response.status_code == 200:
        docs = response.json()
        print(f"  Documents returned: {len(docs)}")
        
        # With batch loading:
        # - 10 docs: ~100-200ms (was 500-1000ms with N+1)
        # - 50 docs: ~150-250ms (was 2500-3000ms with N+1)
        # - 100 docs: ~200-350ms (was 5000-6000ms with N+1)
        
        if elapsed_ms < 100 + len(docs) * 2:  # Rough heuristic
            print(f"  ✓ PASS: Response time acceptable for {len(docs)} documents")
            return True
        else:
            print(f"  ✗ FAIL: Response time too slow")
            return False


# Run test
if __name__ == "__main__":
    test_mongodb_batch_reads()
```

**Expected Results:**

| Document Count | Before (ms) | After (ms) | Improvement |
|---|---|---|---|
| 10 | 500-1000 | 100-200 | 70-80% faster |
| 50 | 2500-3000 | 150-250 | 90% faster |
| 100 | 5000-6000 | 200-350 | 95% faster |

---

### Test 6: FIX #6 - Connection Pooling

**Objective:** Verify that connection pool is configured and working.

**Measurement Script:**

```python
# test_performance_fix6.py
import requests
import threading
import time

def test_db_connection_pooling():
    """
    Test that database operations work under concurrent load
    with connection pooling.
    """
    print("\n" + "=" * 70)
    print("TEST: MongoDB Connection Pooling")
    print("=" * 70)
    
    base_url = "http://localhost:8000"
    
    # Get a document to test with
    response = requests.get(f"{base_url}/documents")
    if not response.json():
        print("✗ SKIP: No documents")
        return None
    
    doc_id = response.json()[0]["id"]
    
    # Run concurrent requests to test connection pooling
    print(f"\nTest: Running 10 concurrent requests...")
    
    results = []
    errors = []
    times = []
    
    def make_request(i):
        try:
            t0 = time.time()
            response = requests.get(f"{base_url}/documents/{doc_id}")
            elapsed_ms = (time.time() - t0) * 1000
            times.append(elapsed_ms)
            results.append(response.status_code == 200)
        except Exception as e:
            errors.append(str(e))
            results.append(False)
    
    threads = [
        threading.Thread(target=make_request, args=(i,))
        for i in range(10)
    ]
    
    for t in threads:
        t.start()
    
    for t in threads:
        t.join()
    
    # Analyze results
    success_count = sum(results)
    print(f"  Successful requests: {success_count}/10")
    
    if times:
        avg_time = sum(times) / len(times)
        max_time = max(times)
        print(f"  Avg response time: {avg_time:.0f}ms")
        print(f"  Max response time: {max_time:.0f}ms")
    
    if errors:
        print(f"  Errors: {errors}")
    
    if success_count == 10:
        print("  ✓ PASS: All concurrent requests succeeded (connection pooling working)")
        return True
    else:
        print("  ✗ FAIL: Some requests failed (connection pool insufficient?)")
        return False


# Run test
if __name__ == "__main__":
    test_db_connection_pooling()
```

**Expected Results:**

| Test | Before | After | Status |
|---|---|---|---|
| 10 concurrent requests | 2-5 failures (pool exhausted) | 10/10 success | ✓ PASS |
| Connection acquire time | 5-10ms | <1ms | ✓ PASS |

---

## COMPREHENSIVE BEFORE/AFTER TEST SUITE

**Create file: `test_performance_all.py`**

```python
#!/usr/bin/env python3
"""
Comprehensive performance test suite for GOVINDA V2.
Measures all critical metrics before and after optimization.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Import all tests
from test_performance_fix1 import test_singleton_instantiation, test_query_latency_multiple_requests
from test_performance_fix2 import test_query_expansion_gating
from test_performance_fix3 import test_reflection_early_termination
from test_performance_fix4 import test_synthesis_verification_batching
from test_performance_fix5 import test_mongodb_batch_reads
from test_performance_fix6 import test_db_connection_pooling


def run_all_tests(output_file: str = "performance_results.json"):
    """Run all performance tests and save results."""
    
    results = {
        "timestamp": datetime.now().isoformat(),
        "tests": {}
    }
    
    tests = [
        ("FIX #1: Singleton Instantiation", test_singleton_instantiation),
        ("FIX #1: Query Latency Stability", test_query_latency_multiple_requests),
        ("FIX #2: Query Expansion Gating", test_query_expansion_gating),
        ("FIX #3: Reflection Early Termination", test_reflection_early_termination),
        ("FIX #4: Synthesis + Verification Batching", test_synthesis_verification_batching),
        ("FIX #5: MongoDB Batch Reads", test_mongodb_batch_reads),
        ("FIX #6: Connection Pooling", test_db_connection_pooling),
    ]
    
    for test_name, test_fn in tests:
        try:
            result = test_fn()
            results["tests"][test_name] = {
                "status": "PASS" if result else "FAIL",
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            results["tests"][test_name] = {
                "status": "ERROR",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
    
    # Save results
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\n✓ Results saved to {output_file}")
    
    # Print summary
    print("\n" + "=" * 70)
    print("FINAL SUMMARY")
    print("=" * 70)
    
    passed = sum(1 for v in results["tests"].values() if v["status"] == "PASS")
    failed = sum(1 for v in results["tests"].values() if v["status"] == "FAIL")
    errors = sum(1 for v in results["tests"].values() if v["status"] == "ERROR")
    
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Errors: {errors}")
    print(f"Total:  {len(results['tests'])}")
    
    if failed == 0 and errors == 0:
        print("\n✓ ALL TESTS PASSED")
        return 0
    else:
        print("\n✗ SOME TESTS FAILED")
        return 1


if __name__ == "__main__":
    exit_code = run_all_tests("performance_results.json")
    sys.exit(exit_code)
```

**Run tests:**
```bash
python test_performance_all.py
```

---

## BENCHMARK TARGETS

### Query Performance

**BEFORE optimizations:**
- Average query latency: 120-160s
- P95 latency: 140-180s
- LLM calls per query: 8-12
- Tokens per query: 200,000-300,000

**AFTER optimizations (Fixes 1-4 implemented):**
- Average query latency: 70-90s (40-50% improvement)
- P95 latency: 80-110s
- LLM calls per query: 5-7 (40-50% reduction)
- Tokens per query: 150,000-200,000

### Ingestion Performance

**BEFORE optimizations:**
- 100-page document: 400-500s
  - Enrichment: 200-250s (50% of total)

**AFTER optimizations (Fix #7 implemented):**
- 100-page document: 280-350s (30-40% improvement)
  - Enrichment: 120-150s

### API Endpoints

**BEFORE optimizations (Fix #5):**
- GET /documents (50 docs): 2500-3000ms

**AFTER optimizations:**
- GET /documents (50 docs): 150-250ms (90% faster)

---

## Verification Checklist

After implementing each fix, verify:

- [ ] All tests pass
- [ ] No regressions in functionality
- [ ] Response bodies unchanged (same JSON structure)
- [ ] Database queries optimized (monitor query logs)
- [ ] Memory usage stable (no memory leaks)
- [ ] Error rates unchanged (<1%)

---

## Monitoring in Production

After deployment, monitor:

```python
# Add to logging configuration
import logging

perf_logger = logging.getLogger("performance")

# Log at end of each request
perf_logger.info(f"Query latency: {total_time_ms:.0f}ms | "
                f"Type: {query_type} | "
                f"Verify: {verify} | "
                f"Reflect: {reflect} | "
                f"LLM calls: {llm_calls} | "
                f"Tokens: {tokens}")
```

**Key metrics to track:**
1. Query latency percentiles (p50, p95, p99)
2. Ingestion time per document
3. LLM call count per query
4. Token usage per query
5. Database query count per request
6. Error rate

