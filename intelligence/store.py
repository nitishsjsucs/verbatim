"""MongoDB persistence for the Actionable Intelligence System."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from utils.mongo import get_db
from intelligence.models import IntelCategory, IntelRun, IntelTeam

logger = logging.getLogger(__name__)

TEAMS_COLLECTION = "intel_teams"
RUNS_COLLECTION = "intel_runs"
CATEGORIES_COLLECTION = "intel_categories"


class IntelTeamStore:
    """CRUD for AIS teams, stored in a dedicated collection to avoid collisions
    with any existing `teams` collection the app may use."""

    def __init__(self) -> None:
        self._col = get_db()[TEAMS_COLLECTION]
        try:
            self._col.create_index("team_id", unique=True)
            self._col.create_index("name")
        except Exception as e:  # non-fatal
            logger.warning("intel_teams index init failed: %s", e)

    def list(self) -> list[IntelTeam]:
        cursor = self._col.find({}).sort("name", 1)
        return [IntelTeam.from_dict(d) for d in cursor]

    def get(self, team_id: str) -> Optional[IntelTeam]:
        d = self._col.find_one({"team_id": team_id})
        return IntelTeam.from_dict(d) if d else None

    def create(self, team: IntelTeam) -> IntelTeam:
        doc = team.to_dict()
        doc["_id"] = team.team_id
        self._col.insert_one(doc)
        return team

    def update(self, team_id: str, patch: dict) -> Optional[IntelTeam]:
        patch = {k: v for k, v in patch.items() if k in {"name", "function", "department"}}
        if not patch:
            return self.get(team_id)
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._col.update_one({"team_id": team_id}, {"$set": patch})
        return self.get(team_id)

    def delete(self, team_id: str) -> bool:
        res = self._col.delete_one({"team_id": team_id})
        return res.deleted_count > 0


# Predefined category roster as per integration spec.
PREDEFINED_CATEGORIES: list[tuple[str, str]] = [
    (
        "Compliance & Regulatory Implementation",
        "This category includes all actionables that arise directly from regulatory mandates issued by governing bodies such as RBI, SEBI, or other financial authorities. These actionables require the bank to implement, modify, or enforce rules, policies, or controls to remain compliant with external regulations. This may involve updating internal policies, ensuring adherence to new guidelines, implementing mandated checks, or aligning existing practices with revised regulatory expectations. These tasks often carry strict deadlines, are subject to audits and inspections, and may have legal or financial consequences if not executed correctly. They typically require coordination between compliance, legal, and operational teams to interpret the regulation accurately and translate it into actionable steps within the organization.",
    ),
    (
        "Process & Operational Changes",
        "This category covers actionables that require changes to the bank's internal processes, workflows, and standard operating procedures (SOPs). These may include modifications in how transactions are processed, how branches operate, how approvals are handled, or how internal coordination between departments is executed. Such actionables are focused on improving, correcting, or standardizing day-to-day operations in response to the circular. They often require retraining staff, updating internal guidelines, and ensuring consistent adoption across branches or departments. These changes are critical for smooth execution on the ground and typically involve operations teams, branch management, and process owners to ensure proper implementation and minimal disruption.",
    ),
    (
        "Technology & System Updates",
        "This category includes all actionables that require changes to the bank's technology infrastructure, systems, or digital platforms. This may involve updates to core banking systems, implementation of new features, changes in data capture or validation logic, system integrations, or modifications to existing applications. These actionables often require detailed technical analysis, development effort, testing, and deployment cycles. They may also include data migration, automation of manual processes, or enabling system-level compliance checks. Coordination between product, engineering, and IT teams is essential, and these tasks often have dependencies that impact timelines and execution sequencing.",
    ),
    (
        "Risk Management & Controls",
        "This category includes actionables focused on identifying, mitigating, and managing various types of risks, including operational risk, credit risk, fraud risk, and compliance risk. These tasks involve implementing or strengthening internal controls, monitoring mechanisms, alert systems, or risk assessment frameworks. Examples include introducing new fraud detection rules, tightening approval thresholds, enhancing due diligence processes, or setting exposure limits. These actionables are critical for maintaining the financial and operational stability of the bank and often require continuous monitoring even after implementation. They typically involve risk, compliance, audit, and sometimes technology teams working together to ensure that risks are proactively managed and controlled.",
    ),
    (
        "Customer Impact & Communication",
        "This category includes all actionables that have a direct or indirect impact on customers and therefore require clear communication, disclosure, or experience-related changes. This may involve updating terms and conditions, notifying customers about policy changes, modifying product features, changing fee structures, or altering service processes. It also includes any requirement to issue official communications through channels such as email, SMS, website updates, or branch notices. These actionables require coordination between customer service, marketing, legal, and operations teams to ensure that messaging is accurate, timely, and compliant. The goal is to maintain transparency, avoid customer confusion, and ensure a smooth transition when changes are implemented.",
    ),
    (
        "Documentation & Reporting",
        "This category includes actionables related to maintaining proper records, generating reports, updating documentation, and ensuring audit readiness. This may involve submitting reports to regulatory authorities, maintaining logs of specific activities, updating internal documentation, or creating evidence trails for compliance purposes. These tasks are essential for governance, traceability, and future audits or inspections. They often require precise data handling, adherence to specific formats or timelines, and coordination between multiple departments to gather and validate information. While these actionables may not directly change operations, they play a critical role in ensuring that all actions taken by the bank are properly recorded and can be verified when required.",
    ),
]


class IntelCategoryStore:
    """CRUD for AIS categories (Section 4 of the spec).

    Categories are user-defined classifications used by the enricher to
    classify each actionable. Stored separately from `intel_teams`.
    """

    def __init__(self) -> None:
        self._col = get_db()[CATEGORIES_COLLECTION]
        try:
            self._col.create_index("category_id", unique=True)
            self._col.create_index("name")
        except Exception as e:  # non-fatal
            logger.warning("intel_categories index init failed: %s", e)

    def seed_defaults(self) -> None:
        """Initialize the category roster with predefined defaults if empty.

        Called automatically during router startup to ensure the 6 base
        categories exist. Names and descriptions are preserved exactly as
        provided in the integration spec.
        """
        if self._col.count_documents({}) > 0:
            return  # Already seeded or user has created custom categories
        for name, description in PREDEFINED_CATEGORIES:
            cat = IntelCategory.new(name, description)
            doc = cat.to_dict()
            doc["_id"] = cat.category_id
            self._col.insert_one(doc)
            logger.info("Seeded default category: %s", name)

    def list(self) -> list[IntelCategory]:
        cursor = self._col.find({}).sort("name", 1)
        return [IntelCategory.from_dict(d) for d in cursor]

    def get(self, category_id: str) -> Optional[IntelCategory]:
        d = self._col.find_one({"category_id": category_id})
        return IntelCategory.from_dict(d) if d else None

    def create(self, category: IntelCategory) -> IntelCategory:
        doc = category.to_dict()
        doc["_id"] = category.category_id
        self._col.insert_one(doc)
        return category

    def update(self, category_id: str, patch: dict) -> Optional[IntelCategory]:
        patch = {k: v for k, v in patch.items() if k in {"name", "description"}}
        if not patch:
            return self.get(category_id)
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._col.update_one({"category_id": category_id}, {"$set": patch})
        return self.get(category_id)

    def delete(self, category_id: str) -> bool:
        res = self._col.delete_one({"category_id": category_id})
        return res.deleted_count > 0


class IntelRunStore:
    """Stores one enrichment run per doc_id (upsert semantics)."""

    def __init__(self) -> None:
        self._col = get_db()[RUNS_COLLECTION]
        try:
            self._col.create_index("doc_id", unique=True)
        except Exception as e:
            logger.warning("intel_runs index init failed: %s", e)

    def save(self, run: IntelRun) -> IntelRun:
        now = datetime.now(timezone.utc).isoformat()
        if not run.created_at:
            run.created_at = now
        run.updated_at = now
        doc = run.to_dict()
        doc["_id"] = run.doc_id
        self._col.replace_one({"_id": run.doc_id}, doc, upsert=True)
        return run

    def get(self, doc_id: str) -> Optional[IntelRun]:
        d = self._col.find_one({"_id": doc_id})
        return IntelRun.from_dict(d) if d else None

    def delete(self, doc_id: str) -> bool:
        res = self._col.delete_one({"_id": doc_id})
        return res.deleted_count > 0

    def list_summaries(self) -> list[dict]:
        """Compact per-doc summaries for cross-document dashboards."""
        out: list[dict] = []
        for d in self._col.find({}, {
            "doc_id": 1,
            "doc_name": 1,
            "stats": 1,
            "updated_at": 1,
            "actionables": 1,
            "notice_board": 1,
        }):
            out.append({
                "doc_id": d.get("doc_id") or d.get("_id"),
                "doc_name": d.get("doc_name", ""),
                "updated_at": d.get("updated_at", ""),
                "stats": d.get("stats", {}),
                "actionable_count": len(d.get("actionables", []) or []),
                "notice_count": len(d.get("notice_board", []) or []),
            })
        return out

    def update_actionable(self, doc_id: str, item_id: str, patch: dict) -> Optional[dict]:
        """Patch a single enriched actionable by id. Returns the updated item or None."""
        allowed = {
            "assigned_teams",
            "assigned_team_names",
            "team_specific_tasks",
            "priority",
            "deadline",
            "risk_score",
            "category",
            "notes",
            "description",
        }
        set_patch = {
            f"actionables.$[a].{k}": v for k, v in patch.items() if k in allowed
        }
        if not set_patch:
            return None
        set_patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        res = self._col.update_one(
            {"_id": doc_id},
            {"$set": set_patch},
            array_filters=[{"a.id": item_id}],
        )
        if res.matched_count == 0:
            return None
        run = self.get(doc_id)
        if not run:
            return None
        for a in run.actionables:
            if a.id == item_id:
                return a.to_dict()
        return None
