# Multi-Tenant UI Parity Architecture

## ✅ CORRECTED IMPLEMENTATION

This document describes the **corrected architecture** where CLIENT and ADMIN share the **SAME UI** with only capability restrictions.

---

## Core Principle

**CLIENTS AND ADMINS USE THE SAME APPLICATION**

The only differences are:
1. **Visibility of admin-only navigation items** (Clients, Requests)
2. **Visibility of AI/extraction buttons** (hidden for clients)
3. **Server-side data filtering** (clients see only tagged documents)

---

## Unified Navigation

### Same Layout for Both Roles

**File**: `web/src/app/intelligence/layout.tsx`

Both admin and client see:
- ✅ **Workspace** - same page, same UI
- ✅ **Teams** - same page, same UI

Admin additionally sees:
- ✅ **Clients** - admin-only (hidden for clients)
- ✅ **Requests** - admin-only (hidden for clients)

**Implementation**:
```typescript
const NAV_ITEMS = [
    { href: "/intelligence", label: "Workspace", adminOnly: false },
    { href: "/intelligence/teams", label: "Teams", adminOnly: false },
    { href: "/intelligence/clients", label: "Clients", adminOnly: true },
    { href: "/intelligence/requests", label: "Requests", adminOnly: true },
];

// Filter nav items based on role
NAV_ITEMS.filter(item => !item.adminOnly || admin).map(...)
```

---

## Workspace Page - Same UI, Role-Based Actions

**File**: `web/src/app/intelligence/page.tsx`

### Shared Features (Both Roles)
- ✅ Same document table
- ✅ Same layout and styling
- ✅ Same search functionality
- ✅ Same export CSV button
- ✅ Same refresh button
- ✅ Same document viewing (click to open)
- ✅ Same tag display

### Admin-Only Features (Hidden for Clients)
- ❌ **Upload PDF** button - hidden for clients
- ❌ **Extract / Re-extract** buttons - hidden for clients
- ❌ **Reset** button - hidden for clients
- ❌ **Rename document** button - hidden for clients
- ❌ **Edit tags** button - hidden for clients

### Implementation
```typescript
const isAdmin = isIntelAdmin();

// Conditional rendering
{isAdmin && (
    <UploadModal>
        <Button>Upload PDF</Button>
    </UploadModal>
)}

{isAdmin && (
    <Button onClick={onResetAll}>Reset</Button>
)}

// In DocumentRow component
{isAdmin && (
    <Button onClick={onStartEdit}>
        <Edit2 />
    </Button>
)}

{isAdmin && (
    <Button onClick={onExtract}>
        {doc.has_intel_run ? "Re-extract" : "Extract"}
    </Button>
)}
```

---

## Document Detail Page - Same UI

**File**: `web/src/app/intelligence/workspace/[docId]/page.tsx`

### Shared Features (Both Roles)
- ✅ Same document viewer
- ✅ Same actionable list
- ✅ Same additionals display
- ✅ Same export functionality
- ✅ Same navigation structure

### Admin-Only Features
- ❌ AI regeneration buttons
- ❌ Modification controls
- ❌ Admin-specific actions

### Client Local Sandbox
- ✅ Clients can edit actionables locally
- ✅ Edits stored in localStorage only
- ✅ No server persistence
- ✅ Reset button clears local edits

---

## Teams Page - Same UI

**File**: `web/src/app/intelligence/teams/page.tsx`

### Shared Features (Both Roles)
- ✅ Same team list
- ✅ Same team viewer
- ✅ Same layout

### Admin-Only Features
- ❌ Create team button
- ❌ Edit team button
- ❌ Delete team button

---

## Login Flow - Unified Redirect

**File**: `web/src/app/intelligence/login/page.tsx`

**BOTH admin and client redirect to**: `/intelligence`

```typescript
// After successful login
window.location.href = "/intelligence";
```

No separate client dashboard. Same workspace for everyone.

---

## Data Filtering - Server-Side

### Admin View
- Sees **ALL documents**
- No tag filtering applied
- Full dataset access

### Client View
- Sees **ONLY documents matching their institution tags**
- Server-side filtering in `/intel/documents` endpoint
- Cannot bypass tag restrictions

**Backend**: `intelligence/tenant_router.py`
```python
@router.get("/documents")
def list_documents(account: dict = Depends(get_current_account)):
    role = account.get("role")
    client_tags = account.get("tags") or []
    
    if role == "admin":
        return all_documents  # No filtering
    
    # Client: filter by tags
    visible_doc_ids = get_docs_by_tags(client_tags)
    return filtered_documents
```

---

## Removed Components

### ❌ Deleted Files
- `web/src/app/intelligence/client/page.tsx` - separate client dashboard (DELETED)
- `web/src/app/intelligence/client/[docId]/page.tsx` - separate client document view (DELETED)

These were replaced with role-based visibility in the existing pages.

---

## Role-Based Capability Summary

| Feature | Admin | Client |
|---------|-------|--------|
| **Navigation** | Workspace, Teams, Clients, Requests | Workspace, Teams |
| **View Documents** | All documents | Tag-filtered documents |
| **Upload PDF** | ✅ Yes | ❌ No |
| **Extract Intelligence** | ✅ Yes | ❌ No |
| **Re-extract** | ✅ Yes | ❌ No |
| **Reset Data** | ✅ Yes | ❌ No |
| **Rename Documents** | ✅ Yes | ❌ No |
| **Edit Tags** | ✅ Yes | ❌ No |
| **Create Teams** | ✅ Yes | ❌ No (view only) |
| **Manage Clients** | ✅ Yes | ❌ No |
| **Manage Requests** | ✅ Yes | ❌ No |
| **Export CSV** | ✅ Yes | ✅ Yes |
| **View Actionables** | ✅ Yes | ✅ Yes |
| **Local Sandbox Edits** | ✅ Yes | ✅ Yes |

---

## UI Consistency Checklist

✅ **Same layout system** - both use `intelligence/layout.tsx`  
✅ **Same workspace page** - both use `intelligence/page.tsx`  
✅ **Same teams page** - both use `intelligence/teams/page.tsx`  
✅ **Same document viewer** - both use `intelligence/workspace/[docId]/page.tsx`  
✅ **Same components** - Button, Input, Table, etc.  
✅ **Same styling** - Tailwind classes, shadcn/ui  
✅ **Same navigation structure** - top bar, nav items  
✅ **Same data rendering** - document tables, actionable lists  
✅ **Same export/import UX** - CSV export, etc.  

---

## Security Enforcement

### Frontend
- Role-based button visibility
- Conditional rendering of admin actions
- No separate UI forks

### Backend
- JWT token includes role
- All `/intel/*` endpoints check role
- Tag filtering enforced server-side
- Admin-only endpoints use `require_admin` dependency
- Client endpoints use tag-based filtering

---

## Implementation Benefits

1. **Single codebase** - no UI duplication
2. **Consistent UX** - same experience for all users
3. **Easier maintenance** - one set of components
4. **Role-based restrictions** - clean capability model
5. **Server-side security** - cannot bypass restrictions
6. **Shared rendering logic** - same data flow
7. **Unified navigation** - same structure

---

## Migration Notes

### What Changed
- ❌ Removed separate `/intelligence/client` routes
- ✅ Added role-based visibility to existing pages
- ✅ Updated login to redirect everyone to `/intelligence`
- ✅ Added `isAdmin` checks throughout workspace
- ✅ Filtered navigation items by role

### What Stayed the Same
- ✅ All existing admin pages
- ✅ All existing components
- ✅ All existing styling
- ✅ All existing data structures
- ✅ All existing API endpoints

---

## Testing Checklist

### As Admin
- [ ] Login redirects to `/intelligence`
- [ ] See Workspace, Teams, Clients, Requests in nav
- [ ] See Upload PDF button
- [ ] See Extract/Re-extract buttons
- [ ] See Reset button
- [ ] Can rename documents
- [ ] Can edit tags
- [ ] See all documents

### As Client
- [ ] Login redirects to `/intelligence`
- [ ] See Workspace, Teams in nav (no Clients, Requests)
- [ ] No Upload PDF button
- [ ] No Extract/Re-extract buttons
- [ ] No Reset button
- [ ] Cannot rename documents
- [ ] Cannot edit tags
- [ ] See only tagged documents
- [ ] Can export CSV
- [ ] Can view actionables
- [ ] Can edit locally (sandbox)

---

## Summary

**ONE APPLICATION. TWO ROLES. SAME UI.**

Clients experience the exact same platform as admins, with AI/admin capabilities gracefully hidden. The UI remains identical - only the available actions differ based on role and server-side data filtering.
