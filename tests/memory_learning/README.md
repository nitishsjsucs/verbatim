# GOVINDA Memory Learning Test System

Real integration tests that prove whether the self-learning memory system actually works.

## What This Tests

The GOVINDA system has 5 learning loops designed to make the system "think like a human" — getting faster and more efficient with experience:

1. **Loop 1 (RAPTOR)** — Node heat map learns which sections matter
2. **Loop 2 (User Memory)** — Remembers user preferences and past interactions
3. **Loop 3 (Query Intelligence)** — Learns retrieval patterns from past queries
4. **Loop 4 (Retrieval Feedback)** — Grades retrieval quality, boosts/penalizes nodes
5. **Loop 5 (R2R Fallback)** — Hybrid search safety net

The 300 questions from `rbi_open_ended_300_qa.md` are structured as **60 themes × 5 variations**. Within each theme, the 5 questions ask about the same topic from different angles. If the memory system works:

- **Q2 should be faster than Q1** (immediate learning)
- **Q5 should be faster than Q1** (accumulated learning)
- **Token usage should decrease** within themes
- **Retrieval precision should improve** as the system learns which nodes matter

## Files

| File | Purpose |
|------|---------|
| `qa_parser.py` | Parses the 300 Q&A markdown into structured objects |
| `learning_test_harness.py` | Main test runner — sends questions to live backend, captures metrics |
| `analyze_results.py` | Deep statistical analysis of test results |
| `quick_test.py` | Quick smoke test (10 questions) to verify setup |

## Usage

### 1. Quick test (verify everything works)

```bash
python -m tests.memory_learning.quick_test \
    --backend-url https://your-url.ngrok-free.dev \
    --doc-id YOUR_DOC_ID \
    --questions 10
```

### 2. Full 300-question test

```bash
python -m tests.memory_learning.learning_test_harness \
    --backend-url https://your-url.ngrok-free.dev \
    --doc-id YOUR_DOC_ID \
    --questions 300 \
    --delay 2.0 \
    --theme-delay 5.0
```

### 3. Analyze results

```bash
python -m tests.memory_learning.analyze_results \
    --results-dir test_results/memory_learning
```

### 4. Resume after interruption

The harness saves after every question. To resume:

```bash
python -m tests.memory_learning.learning_test_harness \
    --backend-url https://your-url.ngrok-free.dev \
    --doc-id YOUR_DOC_ID \
    --resume-from 50
```

## What the Metrics Mean

### Position Analysis (strongest signal)
Aggregates all themes by question position (1-5). If Position 5 is faster than Position 1 across 60 themes, that's strong evidence of learning.

### Statistical Significance (Welch's t-test)
Tests whether the improvement is real or just random variation. p < 0.05 = statistically significant.

### Learning Curves
Per-theme time/token trends. Negative slope = system getting faster. R² > 0.3 = consistent trend.

### Efficiency Metrics
Tokens per citation and time per citation. If these decrease, the system is doing more with less.

## Output Files

Results are saved to the output directory:

- `raw_results.json` — Every query's metrics (crash-resilient, saved incrementally)
- `learning_report.json` — Full structured report
- `learning_summary.txt` — Human-readable summary with verdict
- `deep_analysis.json` — Statistical analysis (after running analyze_results)
- `deep_analysis_summary.txt` — Human-readable analysis summary

## Notes

- The backend must have the two RBI documents ingested (163MD.pdf for ALM, 169MD for KYC)
- For ngrok backends, the `ngrok-skip-browser-warning` header is automatically included
- Free ngrok drops connections after ~5 minutes; the 300-second timeout and per-question delay handle this
- The harness maintains conversation context within each theme to give memory loops maximum signal
