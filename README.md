# Verbatim

**Question answering over regulatory documents, built on the premise that a clause read
out of context is a wrong answer — and measured to find out whether that premise holds.**

Compliance text has a property most document QA ignores: a defined term means what the
definitions section says it means, not what it usually means; a clause that points at
another clause is not complete until you have read the one it points at; a sentence lifted
out of its section can be individually accurate and still wrong.

Chunk a regulation, embed the chunks, retrieve the nearest few, and you have handed a model
a set of fragments with the structure that fixed their meaning stripped away. Verbatim
instead reconstructs the document as a hierarchical tree and has an LLM reason over that
tree to choose which sections to read, so a clause arrives inside the section that governs
it. Embeddings are used, but only to narrow the candidate set before that reasoning step —
they never decide the answer.

The interesting part of this repository is not the claim. It is `test_results/`, which
records what happened when the claim was tested, including where it did not hold.

---

## Architecture

### Ingestion — PDF to tree

```
pdf_parser -> structure_detector -> tree_builder -> node_enricher -> cross_ref_linker
```

`ingestion/pipeline.py` extracts a table of contents, verifies that extraction with a
second pass, detects structure, builds a node tree, enriches each node with a summary and
topics, and links cross-references between nodes. Trees are persisted whole in MongoDB
(the `trees` collection), not in a vector store.

### Retrieval — locate, then read

`retrieval/router.py` (`StructuralRouter`) is the single entry point and runs the pipeline
below. Each named stage is its own module under `retrieval/`.

| Stage | Module | What it does |
|---|---|---|
| **Classifier** | `query_classifier.py` | Sorts the query into `single_hop`, `multi_hop`, `global` or `definitional`, which selects the retrieval strategy |
| **Expander** | `query_expander.py` | Generates alternative phrasings for broad queries, so legal jargon in the document still matches plain-language questions |
| **Locator** | `locator.py` | The core step. An LLM reads the tree index — titles and summaries, not body text — and picks up to 15 relevant nodes (`MAX_LOCATED_NODES`). An embedding pre-filter narrows the tree to the top 30 candidates by cosine similarity first (`prefilter_top_k`, on by default); when it is disabled or fails, the full index is sent instead |
| **Reader** | `reader.py` | Pulls the full text of the located nodes, plus sibling and parent context |
| **Definition injector** | `definition_injector.py` | If the query touches a defined term, pulls in the node carrying that definition. Matches on node type and on definitional phrasing (`"X" means`, `includes`, `refers to`, `shall mean`). **Makes no LLM calls** — tree traversal and regex only, so it cannot itself invent a definition |
| **Cross-ref follower** | `cross_ref_follower.py` | Walks the cross-reference links built at ingestion and pulls in referenced provisions, recursively, to a depth of 2 (`MAX_CROSS_REF_DEPTH`) |
| **Reflector** | `retrieval_reflector.py` | Judges whether the retrieved evidence is actually sufficient to answer. If not, it writes targeted sub-queries and retrieves again — capped at 2 rounds, and skipped outright when more than 6 sections or 50k tokens are already in hand |

`corpus_router.py` handles cross-document questions: an LLM picks 1–5 relevant documents
from a corpus index, then the per-document pipeline above runs on each.

### Answering

```
synthesizer -> verifier
```

`agents/synthesizer.py` drafts the answer; `agents/verifier.py` separately fact-checks each
claim against the sections it came from, confirms citations resolve, and checks nothing
material was dropped. The verification status (`verified` / `partially_verified`) travels
with the answer rather than being discarded — and, as the numbers below show, it correlates
with accuracy strongly enough to be worth surfacing to the reader.

Every prompt lives in versioned YAML under `config/prompts/`, split by stage
(`tree_building/`, `retrieval/`, `answering/`, `corpus/`, `actionables/`), so a prompt
change is a reviewable diff rather than an edit buried in Python.

---

## Evaluation

Three evaluations were run against a live backend, over two public RBI directions — the
Commercial Banks KYC Directions, 2025 (answer quality) and the Commercial Banks Asset
Liability Management Directions, 2025 (the memory-learning runs). All are committed in
full — reports, per-question detail and raw responses — under `test_results/` and
`data/comparison/`. Nothing below is a number this README computed; each figure is in a
committed artifact, and the file is named above each table.

### Methodology

**Key-fact coverage** (`tests/accuracy/accuracy_diagnostic.py`). A bank of 30 questions
(`tests/accuracy/kyc_qa_bank.json`) each carries a human-written reference answer broken
into 5–9 atomic `key_facts` (mean 6.7) — for example "Walk-in threshold is ₹50,000",
"Paragraph 5(2)(iii) defines Customer broadly". The system's answer is scored on what
fraction of those facts it contains.

The matcher is **lexical, not an LLM judge**: direct substring match, then significant-term
overlap at a 0.60 threshold with stopwords filtered, plus a paragraph-number rule that
accepts a fact at 0.45 overlap when the answer cites the same paragraph number. This is
worth stating plainly because it bounds what the score means — it rewards an answer for
restating the reference's vocabulary, and will miss a correct fact expressed in different
words. The scorer was revised once mid-project (threshold lowered from 0.75, stopwords and
paragraph matching added), which by itself accounted for roughly 10 of the 16 points
separating the 5-question and 30-question runs.

An LLM judge is wired in for one narrower job — `HallucinationDetector` asks `gpt-4o-mini`
whether the answer contradicts the reference (wrong paragraph numbers, wrong thresholds,
inverted rules) — but see the caveat under the results below: it is gated to high-coverage
answers and the committed runs do not show it firing.

**Head-to-head judging** (`data/comparison/v1_vs_v2_comparison.json`). Answers from the
previous flat-retrieval version and from this tree-based one were scored by an LLM judge on
five criteria — accuracy, completeness, citation quality, clarity, regulatory precision —
presented as anonymous "answer A" and "answer B".

### Results: key-fact coverage, 30 questions

`test_results/accuracy_30q/` · 2026-04-04 · 28 of 30 questions completed, 2 timed out · 3,396s

| | 5-question baseline | 30-question run |
|---|---|---|
| Mean fact coverage | 45.0% | **61.4%** |
| Median | 50.0% | 62.5% |
| Range | 25–50% | 0–100% |

Both reports also print `hallucination_count: 0`, and **that number should not be read as a
finding.** Hallucination checking is opt-in behind a `--hallucination-check` flag, and even
when enabled it is gated to answers already scoring above 0.5 coverage — which was 17 of 28
answers in the 30-question run, and *none at all* in the 5-question run, which still
reported zero. The run metadata does not record whether the flag was passed, and no answer
in any committed run carries a detector message. The count is fully consistent with
"nothing was checked". Establishing a real hallucination rate would mean judging every
answer regardless of coverage, and that has not been done.

By question category, and by the pipeline's own decisions:

| Category | Coverage | | Classified as | Count | Coverage |
|---|---|---|---|---|---|
| regulatory_update | 75.0% (n=1) | | multi_hop | 12 | ~67% |
| conceptual | 65.3% | | single_hop | 14 | ~52% |
| clause_interpretation | 59.4% | | definitional | 1 | 33% |
| scenario | 57.1% | | | | |

| Verification status | Questions | Mean coverage |
|---|---|---|
| `verified` | 17 | 70% |
| `partially_verified` | 11 | 48% |

That last table is the most useful operational finding: the system's own verification
signal predicts its accuracy. When it says it is unsure, it is also less complete — so the
status is worth showing to a compliance officer rather than hiding.

**Where it fails.** Worst case was Q13 (0%), which asked about exception handling in
Paragraph 23 and retrieved Enhanced and Simplified Due Diligence instead of the CDD
Procedure section that actually contains Paragraph 23. The embedding pre-filter and the
memory candidates had already excluded the right section, leaving just two in the
compressed index, so the locator had nothing correct to choose. `single_hop` queries
under-retrieve generally: 14 of them averaged 8.2 sections and 52% coverage against
multi_hop's 18.5 sections and 67%. `test_results/accuracy_30q/analysis.md` carries the full
root-cause breakdown and the fixes that followed, including the `PARA_BOOST` rule now in
`retrieval/router.py`, which forces sections containing an explicitly referenced paragraph
number into the candidate set.

### Results: tree retrieval vs. the previous version

`data/comparison/v1_vs_v2_comparison.json` · 2026-02-14 · 5 queries · LLM judge

| Judge criterion (/10) | V1 (flat) | V2 (tree) |
|---|---|---|
| Accuracy | 8.0 | 8.2 |
| Completeness | 6.6 | 7.6 |
| **Citation quality** | **3.8** | **7.4** |
| Clarity | 6.8 | 8.0 |
| Regulatory precision | 7.4 | 8.2 |
| **Overall** | **6.52** | **7.88** |

The judge picked V2 on all 5 queries. Almost the entire margin is citation quality: V1
returned opaque hash-like identifiers that pointed nowhere a human could check, V2 returns
section names with page pointers. In this domain that is the difference between an answer a
compliance officer can file and one they cannot. The judge's remaining criticism of V2 is
recorded rather than removed — citations still do not resolve to an exact clause number.

**This quality came at a real cost**, which the same file records:

| | V1 | V2 |
|---|---|---|
| Mean wall clock | 153s | **237s** |
| Mean tokens per query | 24,798 | **84,925** |

V2 was slower on 4 of the 5 queries and used 3.4× the tokens. Reading whole governing
sections instead of nearest-neighbour fragments is not free.

### Results: does the memory layer actually learn?

`test_results/memory_learning_30/` · 2026-04-03 · 30 questions on the ALM Directions · 5,090s

The system has five memory loops (`memory/`) meant to make repeat questions on a topic
cheaper. The question bank (`rbi_open_ended_300_qa.md`, 300 questions as 60 themes × 5
variations) is built for exactly this test: within a theme the 5 questions ask about one
topic from different angles, so the 5th can be compared against the 1st.

| Position within theme | Tokens | Precision | Wall clock | LLM calls |
|---|---|---|---|---|
| 1st question | 327,588 | 0.517 | 160.8s | 11.5 |
| 5th question | 80,459 | 0.694 | 178.0s | 13.0 |

Tokens fall 75% and retrieval precision rises meaningfully. **Latency does not improve** —
it gets ~11% worse, with 13% more LLM calls. The harness's own recorded verdict is
`PARTIAL`, and the smaller 10-question run in `test_results/quick_test/` puts numbers on
the uncertainty: every measured effect has p > 0.5, and it concludes
`LEARNING POSSIBLE (confidence: low)`. Neither of the two themes it tracked showed a
learning curve.

The 30-question accuracy run found something worse, and it is left in the record rather
than dropped: as memory accumulated, **accuracy declined**.

| | Questions 1–14 | Questions 15–30 |
|---|---|---|
| Mean coverage | 65.1% | 59.1% |
| Stored query-intelligence facts | 8 → 15 | 16 → 37 |

Memory grew monotonically while accuracy fell 6 points. The diagnosis in `analysis.md` is
that suggested nodes are globally popular across all past queries, so on a later question
about a different topic they are stale but still consume candidate slots in the compressed
index. Time-decay and topic-gating are proposed there; neither has been run.

---

## What is verified and what is exploratory

**Verified — measured, with the output committed:**

- Tree retrieval beats the previous flat approach on judged answer quality, decisively on
  citation traceability (5 queries, LLM judge).
- Verification status predicts coverage (70% vs 48%).
- The quality is bought with ~1.5× latency and ~3.4× tokens.
- Memory cuts token volume ~75% within a theme and raises retrieval precision.

**Exploratory — built and instrumented, not yet demonstrated:**

- That the memory layer makes the system *faster*. It does not, on current evidence.
- That memory helps accuracy over a long session. Measured effect is negative.
- The 61.4% coverage figure as an absolute measure of quality. It is a lexical overlap
  score against one 30-question bank on one document; it is useful for comparing runs of
  this system, not for comparing against anything else.
- `qwerty_mode/` and `convex_qwerty/` — a separate, isolated chunk-and-vector pipeline over
  Cloudflare Vectorize, built for comparison against the tree approach. No evaluation of it
  is committed.
- The compliance platform layered on top — actionable extraction, the multi-team approval
  workflow, risk scoring, multi-tenancy. Working and deployed, but unevaluated. Design
  notes are in [`docs/`](docs/).

---

## Running it

Requires Python 3.11+, MongoDB, and an OpenAI API key.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cat > .env <<'EOF'
OPENAI_API_KEY=sk-...
MONGO_URI=mongodb://localhost:27017
EOF

./start_backend.sh          # uvicorn on :8001, loads .env
```

Frontend:

```bash
cd web
cp env.example .env.local   # then fill in BETTER_AUTH_SECRET and MONGODB_URI
npm install
npm run dev                 # :3000
```

Tests — no API key or database needed, everything is mocked:

```bash
pip install -r tests/requirements.txt
pytest tests/unit tests/integration tests/e2e tests/performance
```

This is what CI runs (`.github/workflows/ci.yml`), along with `ruff check .` and a
typecheck of `web/`. `tests/diagnostics/` is excluded: it targets a `MemoryHealthChecker`
signature that no longer exists. The accuracy and memory-learning harnesses
(`tests/accuracy/`, `tests/memory_learning/`) are not in CI — they need a live backend and
paid LLM calls, and are driven by hand:

```bash
pip install requests          # needed by the harnesses, not by the service
python tests/accuracy/accuracy_diagnostic.py \
    --backend-url <url> \
    --doc-id <ingested-doc-id> \
    --qa-bank tests/accuracy/kyc_qa_bank.json \
    --questions 30 \
    --hallucination-check      # opt-in; also needs OPENAI_API_KEY
```

Deployment: `render.yaml`, `railway.json` and `Procfile` are all present and all start the
same ASGI app (`uvicorn app_backend.main:app`). The frontend reads `NEXT_PUBLIC_API_URL`
(`web/src/lib/api.ts`) and falls back to a same-origin `/api/backend` proxy. Step-by-step
instructions are in [`DEPLOY.md`](DEPLOY.md).

---

## Layout

```
ingestion/      PDF -> tree pipeline
retrieval/      classifier, expander, locator, reader, definition injector,
                cross-ref follower, reflector, router, corpus router
agents/         planner, qa_engine, synthesizer, verifier, actionable extractor
memory/         five learning loops: RAPTOR heat, user memory, query intelligence,
                retrieval feedback, R2R fallback
models/         document, query, corpus, actionable, conversation
config/         settings and versioned YAML prompts
tree/           MongoDB stores for trees, queries, corpora, actionables
app_backend/    FastAPI service
web/            Next.js App Router frontend, role-based dashboards
qwerty_mode/    separate chunk-and-vector pipeline (Cloudflare Vectorize + R2 + Convex)
tests/          unit/integration/e2e (mocked) and the live eval harnesses
test_results/   committed output of every evaluation run
docs/           design and implementation notes
```

**Stack.** Python, FastAPI, MongoDB, OpenAI models. Next.js App Router frontend with
better-auth. No vector database in the tree pipeline: embeddings are stored in MongoDB
alongside the trees and used for the locator's candidate pre-filter, the semantic query
cache, and similarity inside the memory loops — never as the final answer to "which section
governs this question".

## License

MIT — see [LICENSE](LICENSE). Third-party material in the tree keeps its own attribution;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
