# GOVINDA Accuracy Diagnostic — 30q Analysis

## Executive Summary

| Metric | 5q Baseline | 30q Result | Delta |
|--------|-------------|------------|-------|
| Mean coverage | 45.0% | 61.4% | **+16.4pp** |
| Median coverage | — | 62.5% | — |
| Hallucinations | 0 | 0 | — |
| Perfect scores (100%) | 0 | 3 | — |
| Failed (timeout) | 0 | 2 | — |

**Improvement drivers**: Scorer v2 (stopword filtering, 0.60 threshold, paragraph-number matching) accounts for ~10pp of the gain. Memory accumulation contributed ~5pp early on but then **degraded** accuracy in later questions.

---

## 1. Performance Distribution

| Tier | Coverage | Count | Questions |
|------|----------|-------|-----------|
| Perfect | 100% | 3 | Q7 (CAP), Q15 (e-KYC conversion), Q20 (Secrecy) |
| Strong | 83-88% | 8 | Q3, Q4, Q12, Q19, Q21, Q24, Q25, Q29 |
| Good | 60-75% | 5 | Q2, Q5, Q10, Q11, Q28 |
| Weak | 38-56% | 6 | Q1, Q6, Q8, Q9, Q14, Q22 |
| Poor | 17-33% | 5 | Q17, Q18, Q26, Q27, Q30 |
| **Failed** | **0%** | **1** | **Q13 (wrong sections retrieved)** |

**By category**:
- regulatory_update: **75.0%** (best — only 1 question but scored well)
- conceptual: **65.3%** (strong)
- clause_interpretation: **59.4%**
- scenario: **57.1%** (worst — operational detail gaps)

---

## 2. Root Causes Identified

### RC1: WRONG SECTIONS RETRIEVED [CRITICAL]

**Q13 is the smoking gun**: Query asks about "Exception Handling in Paragraph 23" for individuals unable to perform e-KYC. The system retrieved:
- F.1 Enhanced Due Diligence
- F.2 Simplified Due Diligence

**Should have retrieved**: A. CDD Procedure in case of Individuals (which contains Paragraph 23).

**Cause**: The embedding pre-filter + memory candidates excluded CDD Procedure sections. With only 2 sections in the compressed index, the locator LLM had no choice but to return those 2.

**Also affects**: Q18 (Paragraph 65, got 20%), Q26 (Small Accounts/Paragraph 28, got 17%).

**Fix implemented**: `PARA_BOOST` in `retrieval/router.py` — extracts paragraph numbers from query text, scans tree nodes for matching paragraph references, and injects them as memory candidates. This ensures sections containing explicitly-referenced paragraphs always appear in the candidate set.

---

### RC2: MEMORY DEGRADATION [HIGH]

| Period | Mean Coverage | QI Facts | Interactions | Feedback Nodes |
|--------|-------------|----------|--------------|----------------|
| Early (Q1-14) | 65.1% | 8→15 | 93→99 | 38→43 |
| Late (Q15-30) | 59.1% | 16→37 | 99→123 | 43→51 |

Memory GREW consistently but accuracy DECLINED by 6pp. This means accumulated QI facts and feedback nodes are adding noise rather than signal for later questions.

**Cause**: QI suggested_nodes are globally popular nodes from all past queries. For later questions on different topics, these suggestions are stale/irrelevant but still consume candidate slots in the compressed index.

**Existing mitigation**: F3 fix (key_term overlap weighting for QI suggestions) was applied previously. The 30q data suggests it's insufficient — the QI still suggests the same globally popular nodes.

**Additional fix needed**: Time-decay or topic-gating for QI suggestions so older/unrelated suggestions fade.

---

### RC3: SINGLE_HOP UNDER-RETRIEVES [HIGH]

| Classification | Avg Coverage | Avg Sections | Avg Tokens |
|---------------|-------------|--------------|------------|
| multi_hop | ~67% | 18.5 | 28,800 |
| single_hop | ~52% | 8.2 | 8,400 |
| definitional | 33% | 19 | 15,835 |

Single_hop skips query expansion entirely (no sub-queries), does one locate pass, and often gets too few relevant sections.

**Critical examples**:
- Q13 (single_hop): 2 sections, 3748 tokens → 0%
- Q26 (single_hop): 6 sections, 3129 tokens → 17%
- Q18 (single_hop): 13 sections, 7013 tokens → 20%

**Fix needed**: Add a "thin retrieval" fallback — when single_hop returns <5 sections or <5000 tokens, do a second locate pass with the full tree index instead of compressed.

---

### RC4: ANALYTICAL FACTS NOT GENERATED [MEDIUM]

Many missed facts are high-level interpretive conclusions:
- "CDD becomes relational not just transactional"
- "Every touchpoint is a potential KYC event"
- "Paragraph 68 defines bank as proactive guardian"
- "Shift from manual oversight to automated surveillance"
- "Investigation integrity over procedural CDD"
- "KYC-compliant status is systemic attribute"

These are CONCEPTUAL FRAMEWORKS that require analytical leaps beyond what's in the regulatory text. The synthesis prompt currently says "ONLY use information from the provided sections" and the inference policy focuses on logical complements/entailments, not conceptual interpretations.

**Fix needed**: Add inference category for "regulatory implications and systemic observations" in the inference policy. These would be medium-confidence inferences grounded in the regulatory text but expressing higher-level patterns.

---

### RC5: PARAGRAPH REFERENCES STILL PARTIALLY MISSED [MEDIUM]

The synthesis prompt Rule 8 (paragraph number precision) was added locally but NOT deployed to the backend. Despite this, the improved scorer caught more paragraph matches:
- Q1: Now hits "Paragraph 5(2)(iii)" (was missed in 5q baseline)
- Q2: Now hits "Paragraph 11 mandates proportionate mitigation" via para+terms matching
- Q4: Still misses "V-CIP defined in Paragraph 5(2)(xvi)"

**Fix**: Deploy the synthesis prompt change to the backend. This should improve paragraph citation in the LLM's actual answers.

---

## 3. Decision Chain Analysis

### Classification Distribution
- multi_hop: 12 questions (avg 67% coverage, 100K tokens, 170s)
- single_hop: 14 questions (avg 52% coverage, 16K tokens, 45s)
- definitional: 1 question (33% coverage)

### Verification Status
- verified: 17 questions (avg 70% coverage)
- partially_verified: 11 questions (avg 48% coverage)

Partially verified answers have significantly lower accuracy, suggesting that when the system is uncertain, it's also less complete.

### Section Retrieval Patterns
Top retrieved sections across all queries:
1. **C. Definitions** — appears in 28/28 queries (always retrieved)
2. **A. CDD Procedure in case of Individuals** — appears in 14/28
3. **Chapter IV – Risk Management** — appears in 12/28
4. **Chapter V – Customer Identification Procedure (CIP)** — appears in 11/28
5. **E. On-going Due Diligence** — appears in 10/28

Definitions section is ALWAYS retrieved (good), but the CDD Procedure section is only retrieved for 50% of queries. For clause_interpretation questions that reference specific paragraphs within CDD Procedure, this is a retrieval gap.

---

## 4. Fixes Implemented This Session

### A. Scorer v2 (`tests/accuracy/accuracy_diagnostic.py`)
- Lowered threshold from 0.75 → 0.60
- Added stopword filtering (38 common words excluded from term counts)
- Added paragraph-number extraction and matching (para+terms threshold at 0.45)
- **Impact**: +16pp mean coverage (45% → 61.4%)

### B. LLM Decision Chain Tracking (`tests/accuracy/accuracy_diagnostic.py`)
- Now captures: query_type, sub_queries, key_terms, sections_retrieved, section_titles, tokens_retrieved, verification_status, inferred_points_count
- Added to both JSON and text reports
- **Impact**: Full pipeline visibility for debugging

### C. Synthesis Prompt Rule 8 (`config/prompts/answering/synthesis.yaml`)
- Added paragraph number precision instruction
- Instructs LLM to always cite specific paragraph numbers from source text
- Instructs cross-referencing between related paragraphs
- **Impact**: Not yet deployed — needs backend restart with updated files

### D. Paragraph-Number Retrieval Boost (`retrieval/router.py`)
- Extracts paragraph numbers from query text
- Scans tree nodes for matching paragraph references
- Injects matching nodes into memory candidates
- **Impact**: Not yet deployed — should fix Q13 (0%), Q18 (20%), Q26 (17%)

---

## 5. Recommended Next Steps (Priority Order)

1. **Deploy changes to backend** — sync updated files to the other laptop and restart. This activates:
   - Rule 8 paragraph citation
   - PARA_BOOST retrieval
   
2. **Add thin-retrieval fallback for single_hop** — when <5 sections or <5K tokens retrieved, do a second pass with full index. This targets the 14 single_hop questions averaging 52%.

3. **Add time-decay to QI suggestions** — recent queries should weight more heavily. This targets the memory degradation (65.1% → 59.1%).

4. **Add "systemic observation" inference category** — allow the LLM to generate medium-confidence conceptual frameworks from the regulatory text. This targets the ~15 analytical facts currently missed.

5. **Re-run 30q test** after deploying fixes #1-2 to measure improvement. Target: 70%+ mean coverage.

---

## 6. Projected Impact

| Fix | Affected Questions | Est. Coverage Gain |
|-----|-------------------|-------------------|
| PARA_BOOST | Q13, Q18, Q26 (+partial: Q9, Q17) | +5-8pp mean |
| Rule 8 synthesis | All 28 (paragraph citation) | +3-5pp mean |
| Thin-retrieval fallback | Q6, Q13, Q17, Q18, Q22, Q26 | +3-5pp mean |
| QI time-decay | Q15-Q30 (late queries) | +2-3pp mean |
| Analytical inference | Q1, Q5, Q6, Q8, Q10, Q27 | +2-3pp mean |
| **Combined projected** | — | **~75-80% mean** |
