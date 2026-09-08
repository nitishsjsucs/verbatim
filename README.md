# Verbatim

**A compliance platform built on the premise that a clause read out of context is a wrong answer.**

Verbatim covers the working life of a compliance officer end to end: it ingests regulatory
circulars, extracts the rules and limits inside them as tracked actionables, routes those
through a multi-team approval workflow, scores residual risk on what is left, and answers
questions about any of it. This document covers the retrieval engine underneath, which is
the part that makes the rest trustworthy.

Compliance work has a property most document QA ignores: every word has to be interpreted
in exactly the manner it was written to be interpreted, and in no other. A defined term
means what the definitions section says it means, not what it usually means. A clause that
points at another clause is not complete until you have read the one it points at. A
sentence lifted out of its section can be individually accurate and still wrong.

Standard retrieval-augmented generation is structurally bad at this. Chunk a regulation,
embed the chunks, retrieve the nearest few, and you have handed a model a set of fragments
with the structure that fixed their meaning stripped away. Verbatim does not chunk and does
not embed. It reconstructs the document as a hierarchical tree and reasons over that tree,
so a clause is always read inside the section that governs it.

---

## How it works

**Ingestion, PDF to tree.** The pipeline extracts a table of contents, verifies that
extraction with a second pass, detects structure, builds a node tree, enriches each node,
and links cross-references between nodes.

```
pdf_parser -> structure_detector -> tree_builder -> node_enricher -> cross_ref_linker
```

**Retrieval, locate then read.** A query is classified and expanded, a locator walks the
tree to the governing nodes, and a reader pulls their text. Two compliance-specific steps
run after retrieval:

- **Definition injection.** If a query touches a defined term, the node carrying that
  definition is pulled in automatically. Regulatory answers almost always have to begin
  from the definition. This step uses no LLM calls: it is tree traversal and pattern
  matching, so it cannot itself hallucinate a definition.
- **Cross-reference following.** When a retrieved section points at another provision, the
  referenced node is followed and included, so the answer is built on the complete rule
  rather than half of it.

A retrieval reflector then judges whether what was retrieved is actually sufficient to
answer, and routes back if it is not.

**Answering, with a verification gate.** A synthesizer drafts the answer, then a separate
verifier fact-checks every claim against the source sections it came from, confirms the
citations resolve, and checks nothing material was dropped. Verification status travels with
the answer rather than being discarded, so a partially verified answer is visibly that.

```
query_classifier -> query_expander -> locator -> reader
                 -> definition_injector -> cross_ref_follower
                 -> retrieval_reflector -> synthesizer -> verifier
```

Every prompt lives in versioned YAML under `config/prompts/`, split by stage
(`tree_building/`, `retrieval/`, `answering/`), so prompt changes are reviewable diffs
rather than edits buried in Python.

---

## Benchmarked against V1

`data/comparison/v1_vs_v2_comparison.json` records a head-to-head on RBI KYC Directions,
scored by an LLM judge on accuracy, completeness, citation quality, clarity and regulatory
precision.

On the definitional query "What is the definition of 'Beneficial Owner' under these KYC
Directions?":

| | V1 | V2 |
|---|---|---|
| Verification status | partially verified | **verified** |
| Citation quality (judge, /10) | 4 | **8** |
| Wall clock | 119.6s | **82.0s** |
| Citations returned | 10 | 2 |

Both versions scored 9 on accuracy and regulatory precision. The difference is entirely in
whether a compliance officer can *trace* the answer: V1's citations were opaque hash-like
tokens that pointed nowhere a human could check. V2 returns fewer citations, and they point
at the Definitions section with page pointers. Fewer, traceable citations beat more,
untraceable ones, which is the whole point in this domain.

The judge's remaining criticism of V2 is recorded rather than removed: citations still do
not resolve to an exact clause number.

---

## The platform around it

- **Actionable extraction.** LLM extraction of the rules, limits and operational guidance
  buried in a circular, each one tracked as an object with its own lifecycle.
- **Workflow engine.** A multi-team state machine over those actionables. Team Members
  execute and upload evidence, Team Reviewers do a first-pass approval, and the Compliance
  Officer holds final authority to publish and sign off.
- **Risk matrix.** Inherent and residual risk scoring on outstanding actionables.
- **Multi-tenant.** An intelligence layer with its own JWT auth, PBKDF2 hashing and
  HMAC-SHA256 written against the standard library, with per-institution account scoping.
- **Team management** in MongoDB, and document-scoped chat threads.

## Stack

Python, FastAPI backend, Next.js App Router frontend with role-based dashboards, MongoDB,
JSON tree storage, OpenAI models, better-auth for platform roles. No vector database, by
design.

## Layout

```
ingestion/    PDF to tree pipeline
retrieval/    locator, reader, definition injector, cross-ref follower, reflector, router
agents/       planner, qa_engine, synthesizer, verifier
config/       settings and versioned YAML prompts
tree/         tree and query stores
app_backend/  FastAPI service
web/          Next.js frontend
```

## Running it

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
echo "OPENAI_API_KEY=sk-..." > .env
uvicorn app_backend.main:app --reload --port 8000

cd web && npm install && npm run dev
```

Backend deploys to Render via `render.yaml` with a persistent disk at `/data` for document
storage; frontend deploys to Vercel with `NEXT_PUBLIC_API_URL` pointed at the backend.
