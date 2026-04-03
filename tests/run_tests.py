"""
Simple test runner for GOVINDA V2 memory system tests.
"""

import pytest
import sys
import os

# Add project root to Python path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)


def run_unit_tests():
    """Run all unit tests."""
    print("\n" + "=" * 60)
    print("RUNNING UNIT TESTS")
    print("=" * 60)

    result = pytest.main(["unit/", "-v", "--tb=short"])

    return result


def run_integration_tests():
    """Run all integration tests."""
    print("\n" + "=" * 60)
    print("RUNNING INTEGRATION TESTS")
    print("=" * 60)

    result = pytest.main(["integration/", "-v", "--tb=short"])

    return result


def run_e2e_tests():
    """Run all end-to-end tests."""
    print("\n" + "=" * 60)
    print("RUNNING END-TO-END TESTS")
    print("=" * 60)

    result = pytest.main(["e2e/", "-v", "--tb=short"])

    return result


def run_performance_tests():
    """Run all performance tests."""
    print("\n" + "=" * 60)
    print("RUNNING PERFORMANCE TESTS")
    print("=" * 60)

    result = pytest.main(["performance/", "-v", "--tb=short"])

    return result


def run_diagnostics_tests():
    """Run all diagnostics tests."""
    print("\n" + "=" * 60)
    print("RUNNING DIAGNOSTICS TESTS")
    print("=" * 60)

    result = pytest.main(["diagnostics/", "-v", "--tb=short"])

    return result


def run_all_tests():
    """Run all test suites."""
    print("GOVINDA V2 MEMORY SYSTEM TEST SUITE")
    print("Testing all 5 learning loops and memory coordination")

    results = {}

    # Run each test suite
    results["unit"] = run_unit_tests()
    results["integration"] = run_integration_tests()
    results["e2e"] = run_e2e_tests()
    results["performance"] = run_performance_tests()
    results["diagnostics"] = run_diagnostics_tests()

    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)

    total_passed = 0
    total_failed = 0

    for suite, result in results.items():
        if result == 0:
            status = "PASSED"
            total_passed += 1
        else:
            status = "FAILED"
            total_failed += 1
        print(f"{suite:>15}: {status}")

    print("-" * 60)
    print(f"Total: {total_passed} passed, {total_failed} failed")

    if total_failed == 0:
        print("ALL TESTS PASSED! Memory system is functioning correctly.")
    else:
        print(f"WARNING: {total_failed} test suite(s) failed. Review the output above.")

    return total_failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
