"""Risk score computation service.

Extracted from main.py as part of Phase 4 — Backend Layered Architecture.
Contains all risk-related business logic: score computation, classification,
and residual risk interpretation.
"""
from app_backend.constants import Collection


def safe_score(d: dict | None) -> float:
    """Extract numeric score from a sub-dropdown dict, defaulting to 0."""
    if not d or not isinstance(d, dict):
        return 0
    v = d.get("score", 0)
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


def recompute_risk_scores(target) -> None:
    """Recompute all derived risk scores from sub-dropdown selections.

    OVERALL LIKELIHOOD SCORE = MAX(businessVolume, productProcess, complianceViolation)
    OVERALL IMPACT SCORE     = (selectedImpactScore)²
    INHERENT RISK SCORE      = overallLikelihoodScore × overallImpactScore
    OVERALL CONTROL SCORE    = (monitoringMechanism + controlEffectiveness) / 2
    OVERALL RESIDUAL SCORE   = inherentRiskScore × overallControlScore

    The residual_risk_label is resolved via the admin-configurable
    residual_risk_matrix collection. If no matrix match, falls back to
    a simple threshold classification.
    """
    # Likelihood = MAX of 3 independent sub-dropdown scores
    bv = safe_score(target.likelihood_business_volume)
    pp = safe_score(target.likelihood_products_processes)
    cv = safe_score(target.likelihood_compliance_violations)
    ls = max(bv, pp, cv)
    target.likelihood_score = ls
    target.overall_likelihood_score = int(ls)

    # Impact = (single dropdown score)²
    raw_impact = safe_score(target.impact_dropdown)
    ims = raw_impact ** 2
    target.impact_score = ims
    target.overall_impact_score = int(ims)

    # Inherent risk = likelihood × impact
    ir = ls * ims
    target.inherent_risk_score = ir
    target.inherent_risk_label = classify_inherent_risk(ir)

    # Control = average of 2 sub-dropdown scores
    mon = safe_score(target.control_monitoring)
    eff = safe_score(target.control_effectiveness)
    cs = (mon + eff) / 2 if (mon or eff) else 0
    target.control_score = cs
    target.overall_control_score = cs

    # Residual risk = inherent × control
    rr = ir * cs
    target.residual_risk_score = rr
    target.residual_risk_label = resolve_residual_risk_label(rr)
    target.residual_risk_interpretation = interpret_residual_risk(rr)


def classify_inherent_risk(score: int) -> str:
    """Simple threshold-based inherent risk label."""
    if score <= 0:
        return ""
    if score <= 3:
        return "Low"
    if score <= 6:
        return "Medium"
    return "High"


def resolve_residual_risk_label(residual_score: float) -> str:
    """Look up residual risk label from the admin-configurable interpretation matrix.
    Falls back to simple threshold if no matrix entry matches."""
    try:
        from utils.mongo import get_db
        db = get_db()
        matrix = db[Collection.RESIDUAL_RISK_MATRIX]
        # Find the range entry that contains this score
        entry = matrix.find_one({
            "min_score": {"$lte": residual_score},
            "max_score": {"$gte": residual_score},
        })
        if entry and entry.get("label"):
            return entry["label"]
    except Exception:
        pass
    # Fallback: simple threshold
    if residual_score <= 0:
        return ""
    if residual_score <= 3:
        return "Low"
    if residual_score <= 9:
        return "Medium"
    return "High"


def interpret_residual_risk(residual_score: float) -> str:
    """Map residual risk score to a human-readable interpretation per spec §10.

    1 ≤ score < 13  → "Satisfactory (Low)"
    13 ≤ score < 28 → "Improvement Needed (Medium)"
    28 ≤ score < 81 → "Weak (High)"
    """
    if residual_score < 1:
        return ""
    if residual_score < 13:
        return "Satisfactory (Low)"
    if residual_score < 28:
        return "Improvement Needed (Medium)"
    return "Weak (High)"
