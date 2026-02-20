"""
Actionable data models for GOVINDA V2.

An "actionable" is a deontic statement extracted from a regulatory document:
an obligation, prohibition, permission, or recommendation — with implementation
constraints (who, when, how, thresholds, reporting).

Schema follows the pattern:
  identify deontic sentences → structure into fields → validate → group
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Modality(str, Enum):
    """Deontic modality of the actionable."""

    MANDATORY = "Mandatory"  # shall, must, required to
    PROHIBITED = "Prohibited"  # shall not, must not, prohibited
    PERMITTED = "Permitted"  # may, at its option
    RECOMMENDED = "Recommended"  # should, endeavour to


class Workstream(str, Enum):
    """Implementation workstream category."""

    POLICY = "Policy"
    TECHNOLOGY = "Technology"
    OPERATIONS = "Operations"
    TRAINING = "Training"
    REPORTING = "Reporting"
    CUSTOMER_COMMUNICATION = "Customer Communication"
    GOVERNANCE = "Governance"
    LEGAL = "Legal"
    OTHER = "Other"


@dataclass
class ActionableItem:
    """A single extracted compliance actionable."""

    id: str  # e.g., "ACT-001"
    modality: Modality
    actor: str  # Who must do it
    action: str  # Verb phrase
    object: str  # What is acted upon
    trigger_or_condition: str = ""  # IF/WHERE/PROVIDED THAT
    thresholds: str = ""  # Numbers, limits, amounts
    deadline_or_frequency: str = ""  # within X days, periodic
    effective_date: str = ""  # with effect from...
    reporting_or_notification_to: str = ""  # Recipient of reports
    evidence_quote: str = ""  # Verbatim ≤25 words
    source_location: str = ""  # Page + section heading
    source_node_id: str = ""  # Tree node ID
    implementation_notes: str = ""  # Short operational guidance
    workstream: Workstream = Workstream.OTHER  # Implementation category
    needs_legal_review: bool = False  # Ambiguous items flagged
    validation_status: str = "pending"  # pending, validated, flagged
    validation_notes: str = ""  # Notes from validation pass

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "modality": self.modality.value,
            "actor": self.actor,
            "action": self.action,
            "object": self.object,
            "trigger_or_condition": self.trigger_or_condition,
            "thresholds": self.thresholds,
            "deadline_or_frequency": self.deadline_or_frequency,
            "effective_date": self.effective_date,
            "reporting_or_notification_to": self.reporting_or_notification_to,
            "evidence_quote": self.evidence_quote,
            "source_location": self.source_location,
            "source_node_id": self.source_node_id,
            "implementation_notes": self.implementation_notes,
            "workstream": self.workstream.value,
            "needs_legal_review": self.needs_legal_review,
            "validation_status": self.validation_status,
            "validation_notes": self.validation_notes,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ActionableItem:
        modality_str = data.get("modality", "Mandatory")
        try:
            modality = Modality(modality_str)
        except ValueError:
            modality = Modality.MANDATORY

        workstream_str = data.get("workstream", "Other")
        try:
            workstream = Workstream(workstream_str)
        except ValueError:
            workstream = Workstream.OTHER

        return cls(
            id=data.get("id", ""),
            modality=modality,
            actor=data.get("actor", ""),
            action=data.get("action", ""),
            object=data.get("object", ""),
            trigger_or_condition=data.get("trigger_or_condition", ""),
            thresholds=data.get("thresholds", ""),
            deadline_or_frequency=data.get("deadline_or_frequency", ""),
            effective_date=data.get("effective_date", ""),
            reporting_or_notification_to=data.get("reporting_or_notification_to", ""),
            evidence_quote=data.get("evidence_quote", ""),
            source_location=data.get("source_location", ""),
            source_node_id=data.get("source_node_id", ""),
            implementation_notes=data.get("implementation_notes", ""),
            workstream=workstream,
            needs_legal_review=data.get("needs_legal_review", False),
            validation_status=data.get("validation_status", "pending"),
            validation_notes=data.get("validation_notes", ""),
        )


@dataclass
class ActionablesResult:
    """Complete extraction result for a document."""

    doc_id: str
    doc_name: str = ""
    actionables: list[ActionableItem] = field(default_factory=list)
    total_extracted: int = 0
    total_validated: int = 0
    total_flagged: int = 0
    nodes_processed: int = 0
    nodes_with_actionables: int = 0
    extraction_time_seconds: float = 0.0
    llm_calls: int = 0
    total_tokens: int = 0
    extracted_at: str = ""  # ISO timestamp

    # Summary stats by modality
    by_modality: dict[str, int] = field(default_factory=dict)
    # Summary stats by workstream
    by_workstream: dict[str, int] = field(default_factory=dict)

    def compute_stats(self) -> None:
        """Recompute summary statistics from the actionables list."""
        self.total_extracted = len(self.actionables)
        self.total_validated = sum(
            1 for a in self.actionables if a.validation_status == "validated"
        )
        self.total_flagged = sum(
            1
            for a in self.actionables
            if a.needs_legal_review or a.validation_status == "flagged"
        )
        self.by_modality = {}
        for a in self.actionables:
            key = a.modality.value
            self.by_modality[key] = self.by_modality.get(key, 0) + 1
        self.by_workstream = {}
        for a in self.actionables:
            key = a.workstream.value
            self.by_workstream[key] = self.by_workstream.get(key, 0) + 1

    def to_dict(self) -> dict:
        self.compute_stats()
        return {
            "doc_id": self.doc_id,
            "doc_name": self.doc_name,
            "actionables": [a.to_dict() for a in self.actionables],
            "total_extracted": self.total_extracted,
            "total_validated": self.total_validated,
            "total_flagged": self.total_flagged,
            "nodes_processed": self.nodes_processed,
            "nodes_with_actionables": self.nodes_with_actionables,
            "extraction_time_seconds": self.extraction_time_seconds,
            "llm_calls": self.llm_calls,
            "total_tokens": self.total_tokens,
            "extracted_at": self.extracted_at,
            "by_modality": self.by_modality,
            "by_workstream": self.by_workstream,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ActionablesResult:
        result = cls(
            doc_id=data.get("doc_id", ""),
            doc_name=data.get("doc_name", ""),
            actionables=[
                ActionableItem.from_dict(a) for a in data.get("actionables", [])
            ],
            nodes_processed=data.get("nodes_processed", 0),
            nodes_with_actionables=data.get("nodes_with_actionables", 0),
            extraction_time_seconds=data.get("extraction_time_seconds", 0.0),
            llm_calls=data.get("llm_calls", 0),
            total_tokens=data.get("total_tokens", 0),
            extracted_at=data.get("extracted_at", ""),
        )
        result.compute_stats()
        return result
