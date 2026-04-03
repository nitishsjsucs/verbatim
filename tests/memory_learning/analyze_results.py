"""
Learning Results Analyzer — Deep statistical analysis of memory learning test results.

Reads raw_results.json or learning_report.json and produces:
1. Statistical significance tests (is the improvement real or noise?)
2. Per-theme learning curves
3. Rolling average trends
4. Compute efficiency metrics (tokens per citation, time per citation)
5. Memory loop contribution correlation

Usage:
    python -m tests.memory_learning.analyze_results --results-dir test_results/memory_learning
"""

import argparse
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


# ──────────────────────────────────────────────────────────────────────
# Statistical helpers (no scipy dependency)
# ──────────────────────────────────────────────────────────────────────

def mean(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def std_dev(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = mean(values)
    return math.sqrt(sum((x - m) ** 2 for x in values) / (len(values) - 1))


def median(values: List[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 0:
        return (s[mid - 1] + s[mid]) / 2
    return s[mid]


def percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (p / 100)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


def welch_t_test(group_a: List[float], group_b: List[float]) -> Dict:
    """
    Welch's t-test for unequal variances.
    Tests whether group_b mean is significantly different from group_a mean.
    Returns t-statistic and approximate p-value (using normal approximation for large n).
    """
    n_a, n_b = len(group_a), len(group_b)
    if n_a < 2 or n_b < 2:
        return {"t_stat": 0, "p_value": 1.0, "significant": False, "note": "insufficient data"}

    mean_a, mean_b = mean(group_a), mean(group_b)
    var_a = sum((x - mean_a) ** 2 for x in group_a) / (n_a - 1)
    var_b = sum((x - mean_b) ** 2 for x in group_b) / (n_b - 1)

    se = math.sqrt(var_a / n_a + var_b / n_b)
    if se == 0:
        return {"t_stat": 0, "p_value": 1.0, "significant": False, "note": "zero variance"}

    t_stat = (mean_a - mean_b) / se

    # Welch-Satterthwaite degrees of freedom
    num = (var_a / n_a + var_b / n_b) ** 2
    denom = ((var_a / n_a) ** 2 / (n_a - 1)) + ((var_b / n_b) ** 2 / (n_b - 1))
    df = num / denom if denom > 0 else 1

    # Approximate p-value using normal distribution for large df
    # For df > 30, t-distribution ≈ normal distribution
    z = abs(t_stat)
    # Two-tailed p-value approximation
    p_value = 2 * (1 - _normal_cdf(z))

    return {
        "t_stat": round(t_stat, 3),
        "p_value": round(p_value, 4),
        "df": round(df, 1),
        "significant_at_05": p_value < 0.05,
        "significant_at_01": p_value < 0.01,
        "mean_a": round(mean_a, 3),
        "mean_b": round(mean_b, 3),
        "effect_size": round((mean_a - mean_b) / mean_a * 100, 1) if mean_a > 0 else 0,
    }


def _normal_cdf(z: float) -> float:
    """Approximate standard normal CDF using Abramowitz & Stegun formula."""
    if z < 0:
        return 1 - _normal_cdf(-z)
    a1, a2, a3 = 0.254829592, -0.284496736, 1.421413741
    a4, a5 = -1.453152027, 1.061405429
    p = 0.3275911
    t = 1.0 / (1.0 + p * z)
    poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))))
    return 1 - poly * math.exp(-z * z / 2)


def rolling_average(values: List[float], window: int = 5) -> List[float]:
    """Compute rolling average with given window size."""
    if len(values) < window:
        return values[:]
    result = []
    for i in range(len(values)):
        start = max(0, i - window + 1)
        window_vals = values[start:i + 1]
        result.append(mean(window_vals))
    return result


def linear_regression_slope(values: List[float]) -> Tuple[float, float]:
    """Simple linear regression: returns (slope, r_squared)."""
    n = len(values)
    if n < 2:
        return 0.0, 0.0

    x_values = list(range(n))
    x_mean = mean(x_values)
    y_mean = mean(values)

    ss_xy = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_values, values))
    ss_xx = sum((x - x_mean) ** 2 for x in x_values)
    ss_yy = sum((y - y_mean) ** 2 for y in values)

    if ss_xx == 0:
        return 0.0, 0.0

    slope = ss_xy / ss_xx
    r_squared = (ss_xy ** 2) / (ss_xx * ss_yy) if ss_yy > 0 else 0.0

    return round(slope, 6), round(r_squared, 4)


# ──────────────────────────────────────────────────────────────────────
# Main analyzer
# ──────────────────────────────────────────────────────────────────────

class LearningAnalyzer:
    """Deep analysis of memory learning test results."""

    def __init__(self, results_dir: str):
        self.results_dir = Path(results_dir)
        self.raw_data = self._load_data()
        self.metrics = self.raw_data.get("query_metrics", [])
        self.successful = [m for m in self.metrics if m.get("success", True)]

    def _load_data(self) -> Dict:
        """Load raw results or report data."""
        raw_file = self.results_dir / "raw_results.json"
        report_file = self.results_dir / "learning_report.json"

        if raw_file.exists():
            return json.loads(raw_file.read_text(encoding="utf-8"))
        elif report_file.exists():
            report = json.loads(report_file.read_text(encoding="utf-8"))
            return {"query_metrics": report.get("raw_metrics", [])}
        else:
            raise FileNotFoundError(f"No results found in {self.results_dir}")

    def analyze(self) -> Dict:
        """Run full analysis and return comprehensive results."""
        if not self.successful:
            return {"error": "No successful query metrics found"}

        analysis = {
            "summary_stats": self._summary_stats(),
            "position_significance": self._position_significance_tests(),
            "trend_analysis": self._trend_analysis(),
            "efficiency_metrics": self._efficiency_metrics(),
            "per_document_analysis": self._per_document_analysis(),
            "theme_learning_curves": self._theme_learning_curves(),
            "variation_type_analysis": self._variation_type_analysis(),
            "learning_verdict": self._compute_verdict(),
        }

        return analysis

    def _summary_stats(self) -> Dict:
        """Overall summary statistics."""
        times = [m["wall_time_seconds"] for m in self.successful]
        tokens = [m["total_tokens"] for m in self.successful]
        precisions = [m["retrieval_precision"] for m in self.successful]
        llm_calls = [m["llm_calls"] for m in self.successful]

        return {
            "total_queries": len(self.successful),
            "wall_time": {
                "mean": round(mean(times), 3),
                "median": round(median(times), 3),
                "std_dev": round(std_dev(times), 3),
                "p25": round(percentile(times, 25), 3),
                "p75": round(percentile(times, 75), 3),
                "min": round(min(times), 3) if times else 0,
                "max": round(max(times), 3) if times else 0,
            },
            "tokens": {
                "mean": round(mean(tokens), 1),
                "median": round(median(tokens), 1),
                "std_dev": round(std_dev(tokens), 1),
                "total": sum(tokens),
            },
            "retrieval_precision": {
                "mean": round(mean(precisions), 4),
                "median": round(median(precisions), 4),
                "std_dev": round(std_dev(precisions), 4),
            },
            "llm_calls": {
                "mean": round(mean(llm_calls), 2),
                "median": round(median(llm_calls), 2),
                "total": sum(llm_calls),
            },
        }

    def _position_significance_tests(self) -> Dict:
        """
        Statistical significance tests for position-based learning.
        Tests whether Q5 is significantly faster/cheaper than Q1 across all themes.
        """
        position_data = defaultdict(lambda: {"times": [], "tokens": [], "llm_calls": [], "precision": []})

        for m in self.successful:
            pos = m.get("position_in_theme", 0)
            if 1 <= pos <= 5:
                position_data[pos]["times"].append(m["wall_time_seconds"])
                position_data[pos]["tokens"].append(m["total_tokens"])
                position_data[pos]["llm_calls"].append(m["llm_calls"])
                position_data[pos]["precision"].append(m["retrieval_precision"])

        results = {}

        # Test Q1 vs Q5
        if 1 in position_data and 5 in position_data:
            results["q1_vs_q5_time"] = welch_t_test(
                position_data[1]["times"], position_data[5]["times"]
            )
            results["q1_vs_q5_tokens"] = welch_t_test(
                position_data[1]["tokens"], position_data[5]["tokens"]
            )
            results["q1_vs_q5_llm_calls"] = welch_t_test(
                position_data[1]["llm_calls"], position_data[5]["llm_calls"]
            )
            # For precision, we want Q5 to be HIGHER, so reverse
            results["q1_vs_q5_precision"] = welch_t_test(
                position_data[5]["precision"], position_data[1]["precision"]
            )

        # Test Q1 vs Q2 (immediate learning)
        if 1 in position_data and 2 in position_data:
            results["q1_vs_q2_time"] = welch_t_test(
                position_data[1]["times"], position_data[2]["times"]
            )
            results["q1_vs_q2_tokens"] = welch_t_test(
                position_data[1]["tokens"], position_data[2]["tokens"]
            )

        # Test first-in-theme (Q1) vs all-other (Q2-Q5)
        q1_times = position_data[1]["times"]
        other_times = []
        for pos in [2, 3, 4, 5]:
            other_times.extend(position_data[pos]["times"])
        if q1_times and other_times:
            results["q1_vs_rest_time"] = welch_t_test(q1_times, other_times)

        q1_tokens = position_data[1]["tokens"]
        other_tokens = []
        for pos in [2, 3, 4, 5]:
            other_tokens.extend(position_data[pos]["tokens"])
        if q1_tokens and other_tokens:
            results["q1_vs_rest_tokens"] = welch_t_test(q1_tokens, other_tokens)

        return results

    def _trend_analysis(self) -> Dict:
        """Analyze trends over the full question sequence."""
        times = [m["wall_time_seconds"] for m in self.successful]
        tokens = [m["total_tokens"] for m in self.successful]
        precisions = [m["retrieval_precision"] for m in self.successful]

        time_slope, time_r2 = linear_regression_slope(times)
        token_slope, token_r2 = linear_regression_slope(tokens)
        precision_slope, precision_r2 = linear_regression_slope(precisions)

        return {
            "time_trend": {
                "slope": time_slope,
                "r_squared": time_r2,
                "direction": "decreasing" if time_slope < 0 else "increasing",
                "rolling_avg_10": [round(v, 3) for v in rolling_average(times, 10)],
            },
            "token_trend": {
                "slope": token_slope,
                "r_squared": token_r2,
                "direction": "decreasing" if token_slope < 0 else "increasing",
                "rolling_avg_10": [round(v, 1) for v in rolling_average(tokens, 10)],
            },
            "precision_trend": {
                "slope": precision_slope,
                "r_squared": precision_r2,
                "direction": "improving" if precision_slope > 0 else "declining",
                "rolling_avg_10": [round(v, 4) for v in rolling_average(precisions, 10)],
            },
        }

    def _efficiency_metrics(self) -> Dict:
        """Compute efficiency metrics: cost per useful output."""
        results = {}

        for label, subset in [
            ("first_quarter", self.successful[:len(self.successful)//4]),
            ("last_quarter", self.successful[-(len(self.successful)//4):]),
        ]:
            if not subset:
                continue

            tokens = [m["total_tokens"] for m in subset]
            citations = [m["citations_count"] for m in subset]
            times = [m["wall_time_seconds"] for m in subset]

            total_tokens = sum(tokens)
            total_citations = sum(citations)
            total_time = sum(times)

            results[label] = {
                "tokens_per_citation": round(total_tokens / max(total_citations, 1), 1),
                "time_per_citation": round(total_time / max(total_citations, 1), 3),
                "tokens_per_second": round(total_tokens / max(total_time, 0.001), 1),
                "citations_per_query": round(total_citations / len(subset), 2),
                "total_tokens": total_tokens,
                "total_citations": total_citations,
            }

        # Improvement
        if "first_quarter" in results and "last_quarter" in results:
            fq = results["first_quarter"]
            lq = results["last_quarter"]
            results["efficiency_improvement"] = {
                "tokens_per_citation_change_pct": round(
                    ((fq["tokens_per_citation"] - lq["tokens_per_citation"])
                     / fq["tokens_per_citation"] * 100), 1
                ) if fq["tokens_per_citation"] > 0 else 0,
                "time_per_citation_change_pct": round(
                    ((fq["time_per_citation"] - lq["time_per_citation"])
                     / fq["time_per_citation"] * 100), 1
                ) if fq["time_per_citation"] > 0 else 0,
            }

        return results

    def _per_document_analysis(self) -> Dict:
        """Analyze learning per document type."""
        results = {}
        for doc in ["ALM", "KYC", "Cross-document"]:
            doc_metrics = [m for m in self.successful if m.get("document") == doc]
            if len(doc_metrics) < 4:
                continue

            times = [m["wall_time_seconds"] for m in doc_metrics]
            tokens = [m["total_tokens"] for m in doc_metrics]

            time_slope, time_r2 = linear_regression_slope(times)
            token_slope, token_r2 = linear_regression_slope(tokens)

            mid = len(doc_metrics) // 2
            first_times = [m["wall_time_seconds"] for m in doc_metrics[:mid]]
            second_times = [m["wall_time_seconds"] for m in doc_metrics[mid:]]

            results[doc] = {
                "count": len(doc_metrics),
                "time_slope": time_slope,
                "time_r2": time_r2,
                "token_slope": token_slope,
                "token_r2": token_r2,
                "t_test_time": welch_t_test(first_times, second_times),
            }

        return results

    def _theme_learning_curves(self) -> List[Dict]:
        """Compute detailed learning curve for each theme."""
        themes = defaultdict(list)
        for m in self.successful:
            key = f"{m['document']}_theme_{m['theme_number']}"
            themes[key].append(m)

        curves = []
        for key, metrics in themes.items():
            sorted_m = sorted(metrics, key=lambda x: x["position_in_theme"])
            if len(sorted_m) < 3:
                continue

            times = [m["wall_time_seconds"] for m in sorted_m]
            tokens = [m["total_tokens"] for m in sorted_m]

            time_slope, time_r2 = linear_regression_slope(times)
            token_slope, token_r2 = linear_regression_slope(tokens)

            curves.append({
                "theme_key": key,
                "theme_title": sorted_m[0].get("theme_title", ""),
                "document": sorted_m[0].get("document", ""),
                "n_questions": len(sorted_m),
                "time_series": [round(t, 3) for t in times],
                "token_series": tokens,
                "time_slope": time_slope,
                "time_r2": time_r2,
                "token_slope": token_slope,
                "token_r2": token_r2,
                "learning_detected": time_slope < 0 and time_r2 > 0.3,
            })

        # Sort by time_slope (most improving first)
        curves.sort(key=lambda x: x["time_slope"])
        return curves

    def _variation_type_analysis(self) -> Dict:
        """Analyze performance by question variation type."""
        by_type = defaultdict(list)
        for m in self.successful:
            by_type[m.get("variation_type", "unknown")].append(m)

        results = {}
        for vtype, metrics in by_type.items():
            times = [m["wall_time_seconds"] for m in metrics]
            tokens = [m["total_tokens"] for m in metrics]
            precisions = [m["retrieval_precision"] for m in metrics]

            results[vtype] = {
                "count": len(metrics),
                "avg_time": round(mean(times), 3),
                "avg_tokens": round(mean(tokens), 1),
                "avg_precision": round(mean(precisions), 4),
                "std_time": round(std_dev(times), 3),
            }

        return results

    def _compute_verdict(self) -> Dict:
        """Compute overall learning verdict with confidence level."""
        sig = self._position_significance_tests()
        trends = self._trend_analysis()
        efficiency = self._efficiency_metrics()

        signals = []

        # Signal 1: Q1 vs Q5 time reduction (strongest signal)
        q1_q5_time = sig.get("q1_vs_q5_time", {})
        if q1_q5_time.get("significant_at_05"):
            signals.append({
                "signal": "Q1→Q5 time reduction is statistically significant",
                "strength": "strong",
                "p_value": q1_q5_time["p_value"],
                "effect": f"{q1_q5_time['effect_size']}% reduction",
            })
        elif q1_q5_time.get("effect_size", 0) > 5:
            signals.append({
                "signal": "Q1→Q5 time reduction exists but not statistically significant",
                "strength": "weak",
                "p_value": q1_q5_time.get("p_value"),
                "effect": f"{q1_q5_time.get('effect_size', 0)}% reduction",
            })

        # Signal 2: Q1 vs Q5 token reduction
        q1_q5_tokens = sig.get("q1_vs_q5_tokens", {})
        if q1_q5_tokens.get("significant_at_05"):
            signals.append({
                "signal": "Q1→Q5 token reduction is statistically significant",
                "strength": "strong",
                "p_value": q1_q5_tokens["p_value"],
                "effect": f"{q1_q5_tokens['effect_size']}% reduction",
            })

        # Signal 3: Overall time trend (negative slope = improvement)
        time_trend = trends.get("time_trend", {})
        if time_trend.get("slope", 0) < 0 and time_trend.get("r_squared", 0) > 0.1:
            signals.append({
                "signal": "Overall time trend is decreasing",
                "strength": "moderate" if time_trend["r_squared"] > 0.3 else "weak",
                "r_squared": time_trend["r_squared"],
            })

        # Signal 4: Efficiency improvement
        eff_imp = efficiency.get("efficiency_improvement", {})
        if eff_imp.get("tokens_per_citation_change_pct", 0) > 10:
            signals.append({
                "signal": "Tokens per citation improved",
                "strength": "moderate",
                "effect": f"{eff_imp['tokens_per_citation_change_pct']}% improvement",
            })

        # Compute overall confidence
        strong_signals = sum(1 for s in signals if s["strength"] == "strong")
        moderate_signals = sum(1 for s in signals if s["strength"] == "moderate")
        weak_signals = sum(1 for s in signals if s["strength"] == "weak")

        if strong_signals >= 2:
            confidence = "high"
            verdict = "LEARNING CONFIRMED"
        elif strong_signals >= 1 or moderate_signals >= 2:
            confidence = "moderate"
            verdict = "LEARNING LIKELY"
        elif moderate_signals >= 1 or weak_signals >= 2:
            confidence = "low"
            verdict = "LEARNING POSSIBLE"
        else:
            confidence = "none"
            verdict = "NO LEARNING DETECTED"

        return {
            "verdict": verdict,
            "confidence": confidence,
            "signals": signals,
            "strong_signals": strong_signals,
            "moderate_signals": moderate_signals,
            "weak_signals": weak_signals,
        }

    def print_analysis(self, analysis: Dict):
        """Print a human-readable analysis."""
        print("=" * 70)
        print("GOVINDA MEMORY LEARNING — DEEP ANALYSIS")
        print("=" * 70)
        print()

        # Summary stats
        ss = analysis["summary_stats"]
        print("SUMMARY STATISTICS")
        print("-" * 40)
        print(f"  Total queries: {ss['total_queries']}")
        print(f"  Wall time: {ss['wall_time']['mean']:.1f}s avg (±{ss['wall_time']['std_dev']:.1f}s)")
        print(f"  Tokens: {ss['tokens']['mean']:.0f} avg, {ss['tokens']['total']} total")
        print(f"  Precision: {ss['retrieval_precision']['mean']:.3f} avg")
        print(f"  LLM calls: {ss['llm_calls']['mean']:.1f} avg, {ss['llm_calls']['total']} total")
        print()

        # Position significance
        sig = analysis["position_significance"]
        print("STATISTICAL SIGNIFICANCE TESTS")
        print("-" * 40)
        for test_name, result in sig.items():
            if isinstance(result, dict) and "p_value" in result:
                star = "***" if result.get("significant_at_01") else "**" if result.get("significant_at_05") else ""
                print(f"  {test_name}: effect={result.get('effect_size', 0):+.1f}%, "
                      f"p={result['p_value']:.4f} {star}")
        print()

        # Verdict
        verdict = analysis["learning_verdict"]
        print("VERDICT")
        print("=" * 40)
        print(f"  {verdict['verdict']} (confidence: {verdict['confidence']})")
        print(f"  Strong signals: {verdict['strong_signals']}")
        print(f"  Moderate signals: {verdict['moderate_signals']}")
        print(f"  Weak signals: {verdict['weak_signals']}")
        print()

        for s in verdict["signals"]:
            icon = "●" if s["strength"] == "strong" else "◐" if s["strength"] == "moderate" else "○"
            print(f"  {icon} {s['signal']}")
            if "effect" in s:
                print(f"    Effect: {s['effect']}")
        print()

        # Efficiency
        eff = analysis["efficiency_metrics"]
        if "first_quarter" in eff and "last_quarter" in eff:
            print("EFFICIENCY (first quarter vs last quarter)")
            print("-" * 40)
            fq = eff["first_quarter"]
            lq = eff["last_quarter"]
            print(f"  Tokens/citation: {fq['tokens_per_citation']:.0f} → {lq['tokens_per_citation']:.0f}")
            print(f"  Time/citation:   {fq['time_per_citation']:.2f}s → {lq['time_per_citation']:.2f}s")
            if "efficiency_improvement" in eff:
                ei = eff["efficiency_improvement"]
                print(f"  Token efficiency improvement: {ei['tokens_per_citation_change_pct']:+.1f}%")
                print(f"  Time efficiency improvement:  {ei['time_per_citation_change_pct']:+.1f}%")
            print()

        # Theme learning curves summary
        curves = analysis.get("theme_learning_curves", [])
        if curves:
            learning_count = sum(1 for c in curves if c.get("learning_detected"))
            print(f"THEME LEARNING CURVES ({learning_count}/{len(curves)} themes show learning)")
            print("-" * 40)
            for c in curves[:5]:  # Top 5 most improved
                icon = "✓" if c["learning_detected"] else "✗"
                print(f"  {icon} {c['theme_key']}: slope={c['time_slope']:.4f}, R²={c['time_r2']:.3f}")
                print(f"    Times: {' → '.join(f'{t:.1f}s' for t in c['time_series'])}")
            print()

    def save_analysis(self, analysis: Dict):
        """Save analysis results to disk."""
        output_file = self.results_dir / "deep_analysis.json"
        output_file.write_text(
            json.dumps(analysis, indent=2, default=str), encoding="utf-8"
        )
        print(f"Analysis saved to {output_file}")

        # Save human-readable version
        summary_file = self.results_dir / "deep_analysis_summary.txt"
        import io
        buf = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = buf
        self.print_analysis(analysis)
        sys.stdout = old_stdout
        summary_file.write_text(buf.getvalue(), encoding="utf-8")
        print(f"Summary saved to {summary_file}")


# ──────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Analyze GOVINDA memory learning test results")
    parser.add_argument("--results-dir", required=True, help="Directory containing test results")
    args = parser.parse_args()

    analyzer = LearningAnalyzer(args.results_dir)
    analysis = analyzer.analyze()

    if "error" in analysis:
        print(f"Error: {analysis['error']}")
        sys.exit(1)

    analyzer.print_analysis(analysis)
    analyzer.save_analysis(analysis)


if __name__ == "__main__":
    main()
