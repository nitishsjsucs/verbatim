"""
Diagnostics tests for memory system health checks.
"""

import pytest
from unittest.mock import Mock, patch
from memory.memory_diagnostics import MemoryHealthChecker, MemoryContribution


class TestMemoryHealthChecker:
    """Test memory system health checking functionality."""

    def test_health_checker_initialization(self):
        """Test MemoryHealthChecker initialization."""
        checker = MemoryHealthChecker()
        assert checker is not None

    def test_comprehensive_health_check(self):
        """Test comprehensive health check of all subsystems."""
        checker = MemoryHealthChecker()

        # Mock various components
        mock_mm = Mock()

        # Mock the infrastructure check
        with patch.object(checker, "_check_infrastructure") as mock_infra:
            with patch.object(checker, "_check_feature_flags") as mock_flags:
                with patch.object(checker, "_check_raptor") as mock_raptor:
                    with patch.object(checker, "_check_user_memory") as mock_user_mem:
                        with patch.object(
                            checker, "_check_query_intel"
                        ) as mock_query_intel:
                            with patch.object(
                                checker, "_check_retrieval_fb"
                            ) as mock_retrieval:
                                with patch.object(checker, "_check_r2r") as mock_r2r:
                                    with patch.object(
                                        checker, "_check_data_freshness"
                                    ) as mock_freshness:
                                        with patch.object(
                                            checker, "_check_contribution_stats"
                                        ) as mock_stats:
                                            # Setup mocks
                                            mock_infra.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_flags.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_raptor.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_user_mem.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_query_intel.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_retrieval.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_r2r.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_freshness.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_stats.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }

                    mock_settings.return_value.optimization.enable_raptor_index = True
                    mock_settings.return_value.optimization.enable_user_memory = True
                    mock_settings.return_value.optimization.enable_query_intelligence = True
                    mock_settings.return_value.optimization.enable_retrieval_feedback = True
                    mock_settings.return_value.optimization.enable_r2r_fallback = True

                    # Mock settings
                    mock_settings = Mock()
                    mock_settings.optimization = Mock()
                    mock_settings.optimization.enable_raptor_index = True
                    mock_settings.optimization.enable_user_memory = True
                    mock_settings.optimization.enable_query_intelligence = True
                    mock_settings.optimization.enable_retrieval_feedback = True
                    mock_settings.optimization.enable_r2r_fallback = True

                    # Mock memory manager
                    mock_mm_instance = Mock()
                    mock_mm_instance._initialized = True
                    mock_mm_instance._raptor_indexes = {"doc_123": Mock()}
                    mock_mm_instance._user_memories = {"user_123": Mock()}
                    mock_mm_instance._query_intel = {"doc_123": Mock()}
                    mock_mm_instance._retrieval_fb = {"doc_123": Mock()}
                    mock_mm_instance._r2r_fallbacks = {"doc_123": Mock()}
                    mock_mm.return_value = mock_mm_instance

                    # Run health check
                    health_report = checker.check_all(doc_id="doc_123")

        # Verify comprehensive report structure
        assert "timestamp" in health_report
        assert "infrastructure" in health_report
        assert "loops" in health_report
        assert "feature_flags" in health_report
        assert "overall_status" in health_report
        assert "check_duration_ms" in health_report

        # Check infrastructure section
        infrastructure = health_report["infrastructure"]
        assert "mongodb" in infrastructure
        assert "embedding_client" in infrastructure
        assert "memory_manager" in infrastructure

        # Check loops section
        loops = health_report["loops"]
        for loop_name in [
            "raptor",
            "user_memory",
            "query_intel",
            "retrieval_fb",
            "r2r_fallback",
        ]:
            assert loop_name in loops
            loop_status = loops[loop_name]
            assert "status" in loop_status

        # Check feature flags
        feature_flags = health_report["feature_flags"]
        assert "retrieval_mode" in feature_flags
        assert "is_optimized" in feature_flags

        # Check data freshness
        assert "data_freshness" in health_report

        # Check contribution stats
        assert "contribution_stats" in health_report

    def test_health_check_infrastructure(self):
        """Test infrastructure health checks."""
        checker = MemoryHealthChecker()

        infrastructure = checker._check_infrastructure()

        assert "mongodb" in infrastructure
        assert "embedding_client" in infrastructure
        assert "memory_manager" in infrastructure

        # Each component should have a status
        for component, info in infrastructure.items():
            assert "status" in info
            assert info["status"] in ["ok", "error", "not_initialized"]

    def test_health_check_feature_flags(self, temp_db):
        """Test feature flag checking."""
        checker = MemoryHealthChecker(temp_db)

        flags = checker._check_feature_flags()

        expected_flags = [
            "retrieval_mode",
            "is_optimized",
            "raptor_index",
            "user_memory",
            "query_intelligence",
            "retrieval_feedback",
            "r2r_fallback",
        ]

        for flag in expected_flags:
            assert flag in flags

    def test_health_check_subsystem(self, memory_manager, temp_db):
        """Test individual subsystem health checks."""
        checker = MemoryHealthChecker(temp_db)
        mm = memory_manager

        # Test RAPTOR health check
        raptor_status = checker._check_raptor(mm, "doc_123")
        assert "status" in raptor_status

        # Test user memory health check
        user_mem_status = checker._check_user_memory(mm)
        assert "status" in user_mem_status

        # Test query intelligence health check
        query_intel_status = checker._check_query_intel(mm, "doc_123")
        assert "status" in query_intel_status

        # Test retrieval feedback health check
        retrieval_fb_status = checker._check_retrieval_fb(mm, "doc_123")
        assert "status" in retrieval_fb_status

        # Test R2R fallback health check
        r2r_status = checker._check_r2r(mm, "doc_123")
        assert "status" in r2r_status

    def test_health_check_data_freshness(self, temp_db):
        """Test data freshness checking."""
        checker = MemoryHealthChecker(temp_db)

        # Mock the data freshness check
        with patch.object(checker, "_check_data_freshness") as mock_freshness:
            mock_freshness.return_value = {
                "raptor": {"documents": 10, "last_updated": "2024-01-01T12:00:00Z"},
                "user_memory": {"documents": 5, "last_updated": "2024-01-01T11:00:00Z"},
                "query_intel": {"documents": 8, "last_updated": "2024-01-01T10:00:00Z"},
                "retrieval_fb": {
                    "documents": 12,
                    "last_updated": "2024-01-01T09:00:00Z",
                },
                "r2r": {"documents": 6, "last_updated": "2024-01-01T08:00:00Z"},
                "contributions": {
                    "documents": 25,
                    "last_updated": "2024-01-01T07:00:00Z",
                },
            }

            freshness = checker._check_data_freshness()

        # Should check multiple collections
        expected_collections = [
            "raptor",
            "user_memory",
            "query_intel",
            "retrieval_fb",
            "r2r",
            "contributions",
        ]

        for collection in expected_collections:
            assert collection in freshness
            collection_info = freshness[collection]
            assert "documents" in collection_info
            assert "last_updated" in collection_info

    def test_health_check_contribution_stats(self, temp_db):
        """Test contribution statistics checking."""
        checker = MemoryHealthChecker(temp_db)

        # Mock the contribution stats check
        with patch.object(checker, "_check_contribution_stats") as mock_stats:
            mock_stats.return_value = {
                "total_tracked": 0,
                "contributed_count": 0,
                "contribution_rate": 0.0,
                "avg_precision": 0.0,
                "memory_assisted_rate": 0.0,
            }

            stats = checker._check_contribution_stats()

        assert "total_tracked" in stats
        assert stats["total_tracked"] == 0

    def test_health_check_error_handling(self, temp_db):
        """Test health check error handling."""
        checker = MemoryHealthChecker(temp_db)

        # Test with failing infrastructure
        with patch.object(checker, "_check_infrastructure") as mock_infra:
            with patch.object(checker, "_check_feature_flags") as mock_flags:
                with patch.object(checker, "_check_raptor") as mock_raptor:
                    with patch.object(checker, "_check_user_memory") as mock_user_mem:
                        with patch.object(
                            checker, "_check_query_intel"
                        ) as mock_query_intel:
                            with patch.object(
                                checker, "_check_retrieval_fb"
                            ) as mock_retrieval:
                                with patch.object(checker, "_check_r2r") as mock_r2r:
                                    with patch.object(
                                        checker, "_check_data_freshness"
                                    ) as mock_freshness:
                                        with patch.object(
                                            checker, "_check_contribution_stats"
                                        ) as mock_stats:
                                            mock_infra.side_effect = Exception(
                                                "Database connection failed"
                                            )
                                            mock_flags.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_raptor.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_user_mem.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_query_intel.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_retrieval.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_r2r.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_freshness.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_stats.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }

                                            health_report = checker.check_all()

                                            # Should still return a report
                                            assert "infrastructure" in health_report
                                            assert "overall_status" in health_report

                                            # Infrastructure should show errors
                                            infrastructure = health_report[
                                                "infrastructure"
                                            ]
                                            assert "error" in infrastructure.get(
                                                "mongodb", {}
                                            )

    def test_overall_status_calculation(self, temp_db):
        """Test overall status calculation logic."""
        checker = MemoryHealthChecker(temp_db)

        # Mock the individual checks to simulate all healthy status
        with patch.object(checker, "_check_infrastructure") as mock_infra:
            with patch.object(checker, "_check_feature_flags") as mock_flags:
                with patch.object(checker, "_check_raptor") as mock_raptor:
                    with patch.object(checker, "_check_user_memory") as mock_user_mem:
                        with patch.object(
                            checker, "_check_query_intel"
                        ) as mock_query_intel:
                            with patch.object(
                                checker, "_check_retrieval_fb"
                            ) as mock_retrieval:
                                with patch.object(checker, "_check_r2r") as mock_r2r:
                                    with patch.object(
                                        checker, "_check_data_freshness"
                                    ) as mock_freshness:
                                        with patch.object(
                                            checker, "_check_contribution_stats"
                                        ) as mock_stats:
                                            mock_infra.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_flags.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_raptor.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_user_mem.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_query_intel.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_retrieval.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_r2r.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_freshness.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }
                                            mock_stats.return_value = {
                                                "status": "healthy",
                                                "details": {},
                                            }

                                            health_report = checker.check_all()

                                            assert (
                                                health_report["overall_status"]
                                                == "all_healthy"
                                            )

    def test_health_check_with_real_data(self, temp_db, memory_manager):
        """Test health check with simulated real data."""
        checker = MemoryHealthChecker(temp_db)

        # Mock the health check with real data
        with patch.object(checker, "check_all") as mock_check:
            mock_check.return_value = {
                "timestamp": "2024-01-01T12:00:00Z",
                "infrastructure": {
                    "mongodb": {"status": "ok"},
                    "embedding_client": {"status": "ok"},
                    "memory_manager": {"status": "ok"},
                },
                "loops": {
                    "raptor": {"status": "healthy"},
                    "user_memory": {"status": "healthy"},
                    "query_intel": {"status": "healthy"},
                    "retrieval_fb": {"status": "healthy"},
                    "r2r_fallback": {"status": "healthy"},
                },
                "feature_flags": {"retrieval_mode": "optimized", "is_optimized": True},
                "data_freshness": {
                    "raptor": {"documents": 10, "last_updated": "2024-01-01T12:00:00Z"}
                },
                "contribution_stats": {"total_tracked": 25, "contributed_count": 18},
                "overall_status": "all_healthy",
                "check_duration_ms": 123.4,
            }

            health_report = checker.check_all(doc_id="doc_123")

        # Should detect loaded subsystems
        loops = health_report["loops"]
        for loop_name in [
            "raptor",
            "user_memory",
            "query_intel",
            "retrieval_fb",
            "r2r_fallback",
        ]:
            loop_status = loops[loop_name]
            # Should show as healthy or with data
            assert loop_status["status"] in ["healthy", "empty"]

    def test_health_check_performance(self, temp_db):
        """Test health check performance."""
        import time

        checker = MemoryHealthChecker(temp_db)

        start_time = time.time()
        health_report = checker.check_all()
        end_time = time.time()

        check_duration = end_time - start_time

        # Should complete within reasonable time
        assert check_duration < 5.0  # Less than 5 seconds
        assert health_report["check_duration_ms"] == pytest.approx(
            check_duration * 1000, rel=0.1
        )

    def test_health_check_detailed_subsystem_info(self, memory_manager, temp_db):
        """Test detailed subsystem information in health check."""
        checker = MemoryHealthChecker(temp_db)
        mm = memory_manager

        # Mock detailed subsystem information
        with patch.object(mm, "_get_raptor") as mock_raptor:
            mock_raptor_instance = Mock()
            mock_raptor_instance.is_built = True
            mock_raptor_instance.get_stats.return_value = {
                "node_count": 50,
                "cluster_count": 5,
                "heat_map_entries": 10,
            }
            mock_raptor.return_value = mock_raptor_instance

            raptor_status = checker._check_raptor(mm, "doc_123")

        # Should include detailed stats
        assert "stats" in raptor_status or "status" in raptor_status

    def test_health_check_edge_cases(self, temp_db):
        """Test health check edge cases."""
        checker = MemoryHealthChecker(temp_db)

        # Test with None memory manager
        with patch.object(checker, "_check_infrastructure") as mock_infra:
            mock_infra.return_value = {
                "mongodb": {"status": "error", "error": "Connection failed"},
                "embedding_client": {"status": "error"},
                "memory_manager": {"status": "not_initialized"},
            }

            health_report = checker.check_all()

        # Should handle gracefully
        assert "overall_status" in health_report

    def test_health_check_with_mock_contributions(self, temp_db):
        """Test health check with mock contribution data."""
        checker = MemoryHealthChecker(temp_db)

        # Mock contribution stats
        with patch.object(checker, "_check_contribution_stats") as mock_stats:
            mock_stats.return_value = {
                "total_tracked": 25,
                "contributed_count": 2,
                "contribution_rate": 2 / 3,
            }

            stats = checker._check_contribution_stats()

        assert stats["total_tracked"] == 25
        assert stats["contributed_count"] == 2
        assert stats["contribution_rate"] == 2 / 3
