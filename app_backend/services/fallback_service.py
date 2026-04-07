"""
Fallback computation for actionable fields.

Each actionable can inherit values from document-level global metadata
when its own field is empty. This module provides helpers to compute
the effective (resolved) value for a field, and to enrich a list of
actionables with computed_* fields for the frontend.
"""

from __future__ import annotations

from typing import Any


# Fields that support fallback from document-level global metadata
FALLBACK_FIELDS = {
    "theme":                  "global_theme",
    "deadline":               "global_deadline",
    "tranche3":               "global_tranche3",
    "new_product":            "global_new_product",
    "product_live_date":      "global_live_date",
    "impact_dropdown":        "global_impact_dropdown",
    "likelihood_owner_team":  "global_likelihood_owner_team",
}


def _is_empty(value: Any) -> bool:
    """Check if a value is considered empty (None, empty string, empty dict)."""
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, dict) and not value.get("label"):
        return True
    return False


def compute_field_with_fallback(
    actionable: dict,
    field_name: str,
    doc_metadata: dict,
) -> Any:
    """Return the effective value for a field: actionable-level if present,
    else document-level global, else None/empty."""
    local_value = actionable.get(field_name)
    if not _is_empty(local_value):
        return local_value

    global_key = FALLBACK_FIELDS.get(field_name)
    if global_key:
        global_value = doc_metadata.get(global_key)
        if not _is_empty(global_value):
            return global_value

    return local_value  # original (empty) value


def enrich_actionables_with_fallbacks(
    actionables: list[dict],
    doc_metadata: dict,
) -> list[dict]:
    """Add computed_* fields to each actionable dict for frontend consumption.

    Does NOT mutate the original field values — only adds computed_* keys.
    """
    for item in actionables:
        for field_name in FALLBACK_FIELDS:
            computed_key = f"computed_{field_name}"
            item[computed_key] = compute_field_with_fallback(item, field_name, doc_metadata)
    return actionables
