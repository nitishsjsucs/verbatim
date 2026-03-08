# SYSTEM_ARCHITECTURE_REFERENCE

## 1. System Overview
An enterprise compliance and regulatory document tracking system. It ingests regulatory circulars, uses LLMs to extract compliance actionable items, and orchestrates a multi-role, multi-team workflow to ensure required actions are implemented. It features dynamic team assignments, automated risk assessment scoring, conversational document querying (RAG), and strict audit trails.

## 2. Project Structure
- `app_backend/`: FastAPI backend serving API routes, database operations, and background tasks (`main.py`).
- `web/`: Next.js frontend (App Router) containing role-based dashboards, UI components, and state management.
- `models/`: Python dataclasses/enums defining system schema (`actionable.py`, `document.py`, `query.py`).
- `agents/`, `ingestion/`, `retrieval/`, `tree/`: Core LLM data pipeline for PDF parsing, tree generation, and RAG operations.
- `config/`: Application and LLM settings.
- `scripts/` & Root `.js`: Maintenance, migrations, and database reset tools.

## 3. Core Modules
- **Document Ingestion**: Parses unstructured PDFs into hierarchical `DocumentTree` nodes.
- **Actionable Extraction**: Identifies rules, limits, and operational guidance from documents via LLM.
- **Workflow Engine**: Tracks actionable lifecycles, supporting complex multi-team state machines.
- **Risk Matrix Engine**: Calculates dynamic inherent and residual risk scores based on user-selected dropdowns.
- **Team Management**: Dynamic hierarchical team structure stored and queried from MongoDB.
- **Chat & Memory**: Contextual conversation threads scoped to documents, alongside an LLM benchmark/memory system.

## 4. Role System
Access is managed via `better-auth` with specific frontend route guards:
- **Compliance Officer (CO)**: Final authority. Reviews/publishes actionables, assesses risk, and performs final approval of team implementation.
- **Team Member**: Executes tasks, provides implementation notes, uploads evidence files, and submits for review.
- **Team Reviewer**: First-pass approver. Reviews team member submissions and approves (sending to CO) or rejects (sending back to member).
- **Team Lead**: Manages high-level team responsibilities and provides justifications when tasks breach deadlines.
- **Chief**: High-level viewer for aggregate reporting.
- **Admin**: Manages users, hierarchical team trees, risk configuration matrix, and system benchmarks.

## 5. Scoring / Calculation Logic
Defined in `app_backend/main.py` and `models/actionable.py`:
- **Likelihood**: 3 sub-factors (Business Volume, Products, Compliance). Score = `MAX(3 sub-scores)`.
- **Impact**: Single factor. Score = `value²` (squared).
- **Control**: 2 sub-factors (Monitoring, Effectiveness). Score = `AVG(2 sub-scores)`.
- **Inherent Risk**: `Likelihood Score * Impact Score`.
- **Residual Risk**: `Inherent Risk Score * Control Score`.
*Note: String labels (High, Medium, Low) are resolved dynamically based on calculated thresholds.*

## 6. Data Flow
1. **Ingestion**: PDF uploaded -> parsed to hierarchy -> LLM extracts `ActionableItem`s.
2. **Review & Publish**: CO validates extracted items, adjusts risk scores, and assigns to dynamic teams -> Published to tracker.
3. **Execution**: Teams work on `team_workflows`. Implementation notes and evidence are saved.
4. **Approval**: Hierarchical approval (Member -> Reviewer -> CO).
5. **Retrieval**: Users query documents -> RAG pipeline searches `LocatedNode`s -> synthesis returns citations and inferred points.

## 7. Automation Logic
- **Status Aggregation**: A parent actionable's overall `task_status` is dynamically calculated based on the priority order of its per-team `team_workflows` (e.g., if one team is `reworking`, parent shows `reworking`).
- **Delay Detection**: System checks `deadline` against current date. If breached, auto-flags `is_delayed = True` and transitions status to `awaiting_justification`.
- **Audit Logging**: All workflow transitions, reassignments, and approvals automatically append to the document's `audit_trail`.
- **Cascade Deletions/Renames**: Renaming or deleting a team cascades changes across all actionables, users, and chat channels.

## 8. Workflow Pipeline (Actionable Lifecycle)
1. `pending`: Extracted, awaiting CO publication.
2. `assigned`: Published and assigned to specific team(s).
3. `in_progress`: Claimed/started by a Team Member.
4. `team_review`: Submitted by Member -> awaiting Team Reviewer.
5. `review`: Approved by Reviewer -> awaiting Compliance Officer.
6. `completed`: Final approval by CO.
*Exceptions:*
- `reworking`: Rejected by Reviewer or CO.
- `awaiting_justification`: Delayed, awaiting Team Lead explanation.

## 9. Integration Points
- **MongoDB**: Primary database for all collections (documents, actionables, teams, conversations, auth).
- **LLM Providers**: Configurable abstraction (OpenAI, Anthropic) for generation, classification, and embeddings.
- **Better-Auth**: Next.js authentication adapter mapping to MongoDB.

## 10. Implementation Notes for Future AI
- **Dynamic Teams**: NEVER hardcode team names. Use the `useTeams()` hook on the frontend and the `teams` collection on the backend.
- **Multi-Team Data Structure**: Actionables use a dictionary for multi-team tracking (`team_workflows[team_name]`). Avoid relying on legacy flat status fields for multi-team tasks.
- **Role-Based UI**: Conditional rendering relies heavily on `userRole`. (e.g., Non-compliance roles see Implementation/Evidence fields before Risk Assessment).
- **Backend Authority**: Frontend should send raw updates. The FastAPI backend must handle cascade calculations (risk scores, status aggregations, audit trails). Do not duplicate this logic on the frontend.
- **Idempotency**: Schema migrations (like `migrate-actionables-schema.js`) must be idempotent to support legacy database documents.
