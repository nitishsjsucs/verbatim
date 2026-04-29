"""
Reset all extracted intelligence (actionables) — CLEAN SLATE.

Wipes the entire `intel_runs` MongoDB collection. This removes:
  * Actionables
  * Team assignments
  * Team-specific tasks
  * Categories assigned to actionables
  * Deadlines
  * Priorities
  * Risk scores
  * Notes
  * Notice-board items

Documents, document metadata (titles, dates, regulators), teams, categories,
and ingestion data are NOT touched.

Usage (from the project root):
    python scripts/reset_intelligence_runs.py

Or via the API:
    curl -X POST http://localhost:8000/intelligence/admin/reset-actionables
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make project root importable when run directly as a script
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from intelligence.store import IntelRunStore  # noqa: E402


def main() -> int:
    store = IntelRunStore()
    deleted = store.delete_all()
    print(f"[reset] Removed {deleted} intelligence run(s) from `intel_runs` collection.")
    print("[reset] Documents, teams, and categories were NOT touched.")
    print("[reset] Run extraction again to repopulate actionables.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
