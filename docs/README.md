# Design and implementation notes

Working notes written while building Verbatim. They record what was changed and
why at the time of writing; they are **not** maintained as current reference
documentation, and some of them describe work that has since moved on. The
README at the repository root is the current description of the system.

| Document | Subject |
|---|---|
| [SYSTEM_ARCHITECTURE_REFERENCE.md](SYSTEM_ARCHITECTURE_REFERENCE.md) | Whole-system component map: backend, frontend, workflow roles, data model |
| [SELF_EVOLVING_ARCHITECTURE.md](SELF_EVOLVING_ARCHITECTURE.md) | Design of the five memory learning loops (RAPTOR heat, user memory, query intelligence, retrieval feedback, R2R fallback) |
| [MULTI_TENANT_INTELLIGENCE_SYSTEM.md](MULTI_TENANT_INTELLIGENCE_SYSTEM.md) | Per-institution scoping of the intelligence layer |
| [MULTI_TENANT_UI_PARITY.md](MULTI_TENANT_UI_PARITY.md) | Bringing the tenant UI to parity with the single-tenant dashboards |
| [CLIENT_DATA_ISOLATION_IMPLEMENTATION.md](CLIENT_DATA_ISOLATION_IMPLEMENTATION.md) | How client data isolation was implemented |
| [CLIENT_DATA_ISOLATION_FIX.md](CLIENT_DATA_ISOLATION_FIX.md) | A follow-up correction to that isolation work |
| [RISK_SCORE_FIX_SUMMARY.md](RISK_SCORE_FIX_SUMMARY.md) | Correction to inherent/residual risk scoring |
| [THEME_WEIGHTS_SCOPE_RESTRICTION.md](THEME_WEIGHTS_SCOPE_RESTRICTION.md) | Restricting theme-weight configuration to the CAG Compliance Officer role |
| [UI_ADJUSTMENTS_SUMMARY.md](UI_ADJUSTMENTS_SUMMARY.md) | Risk and Actionables UI changes, plus Indian-convention number formatting (K/L/CR) |

Deployment instructions live in [`../DEPLOY.md`](../DEPLOY.md).
The memory-learning test harness has its own notes in
[`../tests/memory_learning/README.md`](../tests/memory_learning/README.md).
