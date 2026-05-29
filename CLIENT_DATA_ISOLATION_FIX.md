# Client Data Isolation Fix

## ✅ ISSUE 1: TAG-BASED FILTERING - FIXED

### Problem
- Workspace was calling `/intelligence/documents` (unfiltered)
- Clients could see ALL documents regardless of tags

### Solution
- Updated workspace to call `/intel/documents` (filtered tenant API)
- Server enforces tag-based filtering in `intelligence/tenant_router.py`
- Clients now only receive documents matching their institution tags

### Changes Made
- `web/src/app/intelligence/page.tsx`: Use `listTenantDocuments()` instead of `listIntelDocuments()`
- Maps `TenantDocument` to `IntelDocumentMeta` format
- Tags included in response, no separate API calls needed

---

## ⚠️ ISSUE 2: CLIENT MODIFICATIONS AFFECT MASTER DATA - NEEDS FIX

### Problem
- Document detail page calls `/intelligence/documents/{doc_id}/actionables/{item_id}` PATCH
- This endpoint **directly modifies the master database**
- Client edits overwrite admin data
- No isolation between client and master datasets

### Current Dangerous Endpoints
```
PATCH /intelligence/documents/{doc_id}/actionables/{item_id}
POST /intelligence/documents/{doc_id}/import
```

These modify `intel_runs` collection directly.

---

## Required Solution

### Option A: Admin-Only Master Data + Client Sandbox (RECOMMENDED)

**Master Data (Admin Only)**
- `/intelligence/*` endpoints require admin authentication
- Only admins can modify `intel_runs` collection
- Clients get read-only access via `/intel/*` endpoints

**Client Sandbox**
- Client edits stored in **localStorage** or **separate client collection**
- Format: `intel_sandbox_{client_id}_{doc_id}`
- Edits overlay on top of master data for display
- Never synced back to master
- Reset button clears sandbox

**Implementation**:

1. **Protect Admin Endpoints**
```python
# app_backend/services/intelligence_router.py

from intelligence.auth.dependencies import require_admin

@router.patch("/documents/{doc_id}/actionables/{item_id}")
def patch_actionable(
    doc_id: str, 
    item_id: str, 
    body: ActionablePatch,
    _admin: dict = Depends(require_admin)  # ADD THIS
):
    # existing code...
```

2. **Client Sandbox in Frontend**
```typescript
// web/src/lib/client-sandbox.ts

export function getClientSandbox(docId: string): Record<string, Partial<EnrichedActionable>> {
    const key = `intel_sandbox_${docId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : {};
}

export function saveClientEdit(docId: string, itemId: string, patch: Partial<EnrichedActionable>) {
    const sandbox = getClientSandbox(docId);
    sandbox[itemId] = { ...sandbox[itemId], ...patch };
    localStorage.setItem(`intel_sandbox_${docId}`, JSON.stringify(sandbox));
}

export function clearClientSandbox(docId: string) {
    localStorage.removeItem(`intel_sandbox_${docId}`);
}

export function applyClientEdits(
    actionables: EnrichedActionable[], 
    docId: string
): EnrichedActionable[] {
    const sandbox = getClientSandbox(docId);
    return actionables.map(a => ({
        ...a,
        ...(sandbox[a.id] || {})
    }));
}
```

3. **Update Document Detail Page**
```typescript
// web/src/app/intelligence/workspace/[docId]/page.tsx

import { isIntelAdmin } from "@/lib/intel-auth";
import { saveClientEdit, applyClientEdits, clearClientSandbox } from "@/lib/client-sandbox";

const isAdmin = isIntelAdmin();

const patchItem = async (itemId: string, patch: Partial<EnrichedActionable>) => {
    if (!run) return;
    
    if (isAdmin) {
        // Admin: modify master data
        const updated = await patchIntelActionable(decodedId, itemId, patch);
        setRun({
            ...run,
            actionables: run.actionables.map((a) => (a.id === itemId ? { ...a, ...updated } : a)),
        });
    } else {
        // Client: save to local sandbox
        saveClientEdit(decodedId, itemId, patch);
        setRun({
            ...run,
            actionables: run.actionables.map((a) => (a.id === itemId ? { ...a, ...patch } : a)),
        });
        toast.info("Changes saved locally (not synced to server)");
    }
};

// On load, apply client edits
useEffect(() => {
    if (run && !isAdmin) {
        const withEdits = applyClientEdits(run.actionables, decodedId);
        setRun({ ...run, actionables: withEdits });
    }
}, [run?.doc_id]);

// Add reset button for clients
{!isAdmin && (
    <Button onClick={() => {
        clearClientSandbox(decodedId);
        window.location.reload();
    }}>
        Reset Local Changes
    </Button>
)}
```

---

## Option B: Separate Client Database Collection (Alternative)

Create `intel_client_edits` collection:
```python
{
    "_id": "client_123_doc_456_item_789",
    "client_id": "client_123",
    "doc_id": "doc_456",
    "item_id": "item_789",
    "patch": { "priority": "High", "notes": "..." },
    "updated_at": "2026-05-29T10:50:00Z"
}
```

Merge on read:
```python
@router.get("/intel/documents/{doc_id}/actionables")
def get_client_actionables(doc_id: str, account: dict = Depends(get_current_account)):
    run = _runs().get(doc_id)
    if account["role"] == "client":
        # Apply client-specific edits
        edits = get_client_edits(account["account_id"], doc_id)
        for actionable in run.actionables:
            if actionable.id in edits:
                actionable.update(edits[actionable.id])
    return run
```

---

## Recommended Approach

**Use Option A (localStorage sandbox)** because:
- ✅ Simpler implementation
- ✅ No database overhead
- ✅ Clear client-side isolation
- ✅ Easy to reset
- ✅ No server-side complexity
- ✅ Clients understand "local edits"

---

## Implementation Checklist

### Backend
- [ ] Add `require_admin` to PATCH `/intelligence/documents/{doc_id}/actionables/{item_id}`
- [ ] Add `require_admin` to POST `/intelligence/documents/{doc_id}/import`
- [ ] Add `require_admin` to POST `/intelligence/documents/{doc_id}/extract`
- [ ] Add `require_admin` to POST `/intelligence/reset-all`
- [ ] Verify `/intel/*` endpoints use tag filtering

### Frontend
- [ ] Create `web/src/lib/client-sandbox.ts` with localStorage helpers
- [ ] Update document detail page to use sandbox for clients
- [ ] Add "Reset Local Changes" button for clients
- [ ] Show indicator when viewing local edits
- [ ] Disable CSV import for clients (or make it local-only)
- [ ] Test admin can still modify master data
- [ ] Test client edits stay local

---

## Testing

### As Admin
- [ ] Can modify actionables (persists to server)
- [ ] Can import CSV (updates master data)
- [ ] Can extract intelligence
- [ ] Changes visible to all users

### As Client
- [ ] Can modify actionables (stays local)
- [ ] Changes NOT visible to admin
- [ ] Changes NOT visible to other clients
- [ ] Reset button clears local edits
- [ ] Indicator shows "local edits active"
- [ ] Cannot import CSV (or imports locally only)
- [ ] Cannot extract intelligence

---

## Security Validation

- [ ] Client cannot call admin-only endpoints (403 Forbidden)
- [ ] Client cannot see documents outside their tags
- [ ] Client modifications never touch `intel_runs` collection
- [ ] Admin modifications work as before
- [ ] No data leakage between clients
