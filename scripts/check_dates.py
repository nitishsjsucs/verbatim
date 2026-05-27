"""Check if dates were stored in tree store"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.mongo import get_db

db = get_db()
docs = list(db['trees'].find({}, {'_id': 1, 'doc_name': 1, 'circular_effective_date': 1, 'created_at': 1}).limit(8))

print('Tree store dates:')
for d in docs:
    print(f"{d.get('_id')}: {d.get('doc_name', '')}")
    print(f"  effective: {d.get('circular_effective_date', '')}")
    print(f"  created: {d.get('created_at', '')}")
    print()
