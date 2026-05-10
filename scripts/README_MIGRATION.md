# Document Date Migration

## Overview
This migration script populates missing `circular_effective_date` and `created_at` fields for documents that were uploaded before these fields existed.

## Running the Migration

From the project root directory, run:

```bash
python scripts/migrate_document_dates.py
```

## What It Does

1. **Loads all documents** from the TreeStore
2. **For each document**, checks if dates are missing:
   - `circular_effective_date`: If missing, generates a mock date spread across 2024-2025
   - `created_at`: If missing, uses `ingested_at` if available, otherwise generates a mock date 30-90 days before the effective date

3. **Saves updated documents** back to the ActionableStore

## Expected Output

```
Starting document date migration...
Found 50 documents to check
  Setting effective date for Document_Name.pdf: 2024-03-15
  Setting created_at for Document_Name.pdf: 2024-01-20T10:30:00
  ...
Migration complete! Updated 45 documents.
```

## Notes

- The script is **idempotent** - running it multiple times won't duplicate or overwrite existing dates
- Mock dates are generated to be reasonably aligned with existing document dates
- Documents are spread over time to avoid clustering all dates on the same day
