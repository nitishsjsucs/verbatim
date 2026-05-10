"""
Migration script to populate missing circular_effective_date and created_at fields
for existing documents that were uploaded before these fields existed.
"""
import sys
from pathlib import Path
from datetime import datetime, timedelta
import random

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from tree.tree_store import TreeStore
from tree.actionable_store import ActionableStore


def migrate_document_dates():
    """Populate missing dates for old documents with reasonable mock dates."""
    ts = TreeStore()
    astore = ActionableStore()
    
    # Get all documents
    docs = ts.list_documents_summary()
    print(f"Found {len(docs)} documents to check")
    
    # Base date for generating mock dates (align with existing data)
    base_date = datetime(2024, 1, 1)
    
    updated_count = 0
    
    for idx, doc in enumerate(docs):
        doc_id = doc.get("id")
        if not doc_id:
            continue
            
        # Load the actionable root for this document
        ar = astore.load(doc_id)
        needs_update = False
        
        if ar is None:
            # Store dates directly in tree store for documents without actionable roots
            print(f"  Adding dates to tree store for {doc.get('name', doc_id)}")
            
            # Generate mock dates
            days_offset = idx * 7 + random.randint(0, 30)
            mock_effective_date = (base_date + timedelta(days=days_offset)).strftime("%Y-%m-%d")
            
            ingested_at = doc.get("ingested_at", "")
            if ingested_at:
                created_at = ingested_at
            else:
                created_at = (base_date + timedelta(days=idx * 7)).isoformat()
            
            # Update tree store with dates
            ts._collection.update_one(
                {"_id": doc_id},
                {
                    "$set": {
                        "circular_effective_date": mock_effective_date,
                        "created_at": created_at,
                    }
                }
            )
            updated_count += 1
            print(f"  Set effective date: {mock_effective_date}, created_at: {created_at}")
        else:
            needs_update = False
            # Check if circular_effective_date is missing
            if not getattr(ar, "circular_effective_date", ""):
                # Generate a mock effective date (spread over 2024-2025)
                days_offset = idx * 7 + random.randint(0, 30)  # Spread documents over time
                mock_effective_date = (base_date + timedelta(days=days_offset)).strftime("%Y-%m-%d")
                ar.circular_effective_date = mock_effective_date
                needs_update = True
                print(f"  Setting effective date for {doc.get('name', doc_id)}: {mock_effective_date}")
            
            # Check if created_at is missing
            if not getattr(ar, "created_at", ""):
                # Use ingested_at if available, otherwise generate mock date
                ingested_at = doc.get("ingested_at", "")
                if ingested_at:
                    ar.created_at = ingested_at
                else:
                    # Generate mock created_at slightly before effective date
                    if hasattr(ar, "circular_effective_date") and ar.circular_effective_date:
                        try:
                            eff_date = datetime.fromisoformat(ar.circular_effective_date.replace("Z", "+00:00"))
                            created_date = (eff_date - timedelta(days=random.randint(30, 90))).isoformat()
                        except (ValueError, AttributeError):
                            created_date = (base_date + timedelta(days=idx * 7)).isoformat()
                    else:
                        created_date = (base_date + timedelta(days=idx * 7)).isoformat()
                    ar.created_at = created_date
                needs_update = True
                print(f"  Setting created_at for {doc.get('name', doc_id)}: {ar.created_at}")
            
            # Save if any updates were made
            if needs_update:
                astore.save(ar)
                updated_count += 1
    
    print(f"\nMigration complete! Updated {updated_count} documents.")


if __name__ == "__main__":
    print("Starting document date migration...")
    migrate_document_dates()
