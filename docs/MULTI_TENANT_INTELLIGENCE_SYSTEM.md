# Multi-Tenant Intelligence System

## Overview

The intelligence system has been converted into a **multi-tenant architecture** with separate admin and client roles. This is a **completely isolated pocket system** with its own authentication, separate from the main application's better-auth system.

## Architecture

### Authentication System
- **Separate JWT-based auth** (not using better-auth)
- **Location**: `intelligence/auth/`
- **Collections**: `intel_accounts`
- **Token storage**: localStorage (`intel_token`, `intel_user`)
- **Secret**: `INTEL_AUTH_SECRET` env var (default: auto-generated, change in production)

### Key Components

#### Backend (Python/FastAPI)

**Auth Module** (`intelligence/auth/`)
- `models.py` - IntelAccount dataclass with role, institution_tags
- `password.py` - PBKDF2 password hashing (stdlib, no external deps)
- `jwt_utils.py` - Manual JWT creation/verification with HMAC-SHA256
- `account_store.py` - MongoDB CRUD for accounts
- `dependencies.py` - FastAPI dependencies for route protection
- `router.py` - Auth endpoints (`/intel-auth/*`)

**Multi-Tenant Features** (`intelligence/`)
- `additionals.py` - Additionals system (admin appends actionables)
- `requests.py` - Client request system (document/team requests)
- `tenant_router.py` - Tag-filtered APIs (`/intel/*`)

**New Collections**
- `intel_accounts` - Admin and client accounts
- `intel_additionals` - Additional actionables appended by admin
- `intel_requests` - Client requests (document/team)
- `intel_doc_tags` - Institution tags per document
- `intel_institution_tags` - Tag registry

#### Frontend (Next.js/React)

**Auth Client** (`web/src/lib/`)
- `intel-auth.ts` - JWT token management, login/logout
- `intel-tenant-api.ts` - API client for multi-tenant endpoints

**Pages**
- `/intelligence/login` - Intelligence system login (separate from main app)
- `/intelligence/clients` - Admin client management
- `/intelligence/requests` - Admin request management
- `/intelligence/client` - Client dashboard (workspace, services, profile)
- `/intelligence/client/[docId]` - Client document view with local sandbox

**Layout**
- `intelligence/layout.tsx` - Role-aware navigation (admin vs client)

## Roles & Permissions

### Admin Role
- **Access**: Full system access
- **Capabilities**:
  - View all documents (no tag filtering)
  - Extract intelligence, manage teams
  - Create/manage client accounts
  - Assign institution tags to documents
  - Create additionals (append actionables to documents)
  - Review and approve/reject client requests
  - Manage institution tag registry

### Client Role
- **Access**: Tag-filtered read-only
- **Capabilities**:
  - View documents matching their `institution_tags`
  - View actionables (read-only)
  - View additionals appended by admin
  - Local sandbox editing (localStorage, non-persistent)
  - Submit document requests (with optional file upload)
  - Submit team requests
  - View request status

## Data Flow

### Document Tagging
1. Admin uploads document → ingestion pipeline
2. Admin assigns institution tags via `/intel/documents/{doc_id}/tags`
3. Tags stored in `intel_doc_tags` collection
4. Client queries filtered by tag match

### Client Data Access
1. Client logs in → receives JWT with `institution_tags`
2. Client requests documents → server filters by tags
3. Client views actionables → server validates tag access
4. Client edits locally → stored in localStorage only

### Additionals System
1. Admin creates additional entry for a document
2. Entry stored in `intel_additionals` with actionables array
3. Clients see additionals when viewing document
4. Original extraction remains unchanged

### Request System
1. Client submits request (document/team)
2. Request stored in `intel_requests` with status "pending"
3. Admin reviews in `/intelligence/requests`
4. Admin approves/rejects/archives
5. Client sees status update in services tab

## API Endpoints

### Auth (`/intel-auth/*`)
- `POST /intel-auth/login` - Login (public)
- `GET /intel-auth/me` - Get current user (protected)
- `POST /intel-auth/clients` - Create client (admin)
- `GET /intel-auth/clients` - List clients (admin)
- `GET /intel-auth/clients/{id}` - Get client (admin)
- `PATCH /intel-auth/clients/{id}` - Update client (admin)
- `POST /intel-auth/clients/{id}/set-password` - Reset password (admin)
- `DELETE /intel-auth/clients/{id}` - Delete client (admin)

### Multi-Tenant (`/intel/*`)
- `GET /intel/documents` - List documents (tag-filtered for clients)
- `GET /intel/documents/{id}/actionables` - Get actionables (tag-filtered)
- `POST /intel/documents/{id}/tags` - Set tags (admin)
- `GET /intel/documents/{id}/tags` - Get tags (all)
- `GET /intel/documents/{id}/additionals` - List additionals (tag-filtered)
- `POST /intel/documents/{id}/additionals` - Create additional (admin)
- `PATCH /intel/additionals/{id}` - Update additional (admin)
- `DELETE /intel/additionals/{id}` - Delete additional (admin)
- `POST /intel/requests/document` - Submit document request (client)
- `POST /intel/requests/team` - Submit team request (client)
- `GET /intel/requests/mine` - List my requests (client)
- `GET /intel/requests` - List all requests (admin)
- `PATCH /intel/requests/{id}` - Resolve request (admin)
- `GET /intel/tags` - List institution tags (all)
- `POST /intel/tags` - Create tag (admin)
- `DELETE /intel/tags/{name}` - Delete tag (admin)

## Security

### Route Protection
- All `/intel-auth/*` endpoints except `/login` require authentication
- All `/intel/*` endpoints require authentication
- Admin-only endpoints use `require_admin` dependency
- Client-only endpoints use `require_client` dependency
- Tag-based filtering enforced server-side

### Password Security
- PBKDF2-HMAC-SHA256 with 260,000 iterations
- 32-byte random salt per password
- Constant-time comparison for verification

### JWT Security
- HMAC-SHA256 signature
- 7-day expiry
- Payload includes: account_id, role, username, institution_tags
- Secret key from `INTEL_AUTH_SECRET` env var

### Client Sandbox
- Local edits stored in localStorage with prefix `intel_sandbox_{docId}`
- No API calls for client edits
- Edits visible only to the client on their device
- Reset button clears local sandbox

## Default Admin Account

On first startup, a default admin account is created:
- **Username**: `admin` (or `INTEL_ADMIN_USERNAME` env var)
- **Password**: `admin123` (or `INTEL_ADMIN_PASSWORD` env var)
- **⚠️ Change immediately in production**

## Environment Variables

```bash
# Intelligence Auth Secret (min 32 chars)
INTEL_AUTH_SECRET=your-secret-key-here-min-32-chars

# Default admin credentials (optional, for first-time setup)
INTEL_ADMIN_USERNAME=admin
INTEL_ADMIN_PASSWORD=admin123
```

## Migration Notes

### Existing Admin Workflows
- **Preserved**: All existing `/intelligence/*` admin routes remain unchanged
- **No breaking changes**: Extraction, teams, dashboard work as before
- **Additive**: New multi-tenant features are parallel, not replacements

### Database Schema
- **New collections**: All new collections have `intel_` prefix
- **No modifications**: Existing collections untouched
- **Backward compatible**: System works with or without multi-tenant features

## Usage Guide

### Admin Workflow

1. **Login**: Navigate to `/intelligence/login`, use admin credentials
2. **Create Clients**:
   - Go to `/intelligence/clients`
   - Click "Create Client"
   - Set username, password, institution tags
3. **Tag Documents**:
   - Upload documents via existing flow
   - Navigate to document in workspace
   - Assign institution tags
4. **Create Additionals**:
   - View document
   - Add additional actionables without modifying extraction
5. **Manage Requests**:
   - Go to `/intelligence/requests`
   - Review client requests
   - Approve/reject/archive

### Client Workflow

1. **Login**: Navigate to `/intelligence/login`, use client credentials
2. **View Documents**:
   - See only documents matching your institution tags
   - Read-only access to actionables
3. **Local Notes**:
   - Expand actionable
   - Add personal notes and status
   - Changes saved locally only
4. **Submit Requests**:
   - Go to "Services" tab
   - Request new documents or teams
   - Track request status

## Testing

### Create Test Client
```bash
# Via admin UI: /intelligence/clients
# Or via API:
curl -X POST http://localhost:8000/intel-auth/clients \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_bank",
    "password": "test123",
    "display_name": "Test Bank Client",
    "institution_tags": ["banking", "nbfc"]
  }'
```

### Tag a Document
```bash
curl -X POST http://localhost:8000/intel/documents/DOC123/tags \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["banking"]}'
```

## Performance Considerations

- **Tag filtering**: Indexed queries on `intel_doc_tags.tags`
- **Lazy singletons**: Store instances created on-demand
- **Minimal overhead**: Tag checks are simple array intersections
- **No extraction changes**: Intelligence pipeline unchanged

## Future Enhancements

- [ ] Email notifications for request status changes
- [ ] Audit log for admin actions
- [ ] Bulk client import/export
- [ ] Custom client permissions beyond tags
- [ ] Client-specific branding/themes
- [ ] API rate limiting per client
- [ ] Multi-factor authentication
- [ ] SSO integration

## Troubleshooting

### Login Issues
- Check `INTEL_AUTH_SECRET` is set
- Verify MongoDB connection
- Check browser localStorage for stale tokens
- Clear localStorage: `localStorage.clear()`

### Tag Filtering Not Working
- Verify tags assigned to document in `intel_doc_tags`
- Check client's `institution_tags` in `intel_accounts`
- Ensure server-side filtering in `/intel/documents`

### Client Can't See Documents
- Confirm document has matching tags
- Verify client account is active (`is_active: true`)
- Check JWT payload includes correct tags

## Code Structure

```
intelligence/
├── auth/
│   ├── __init__.py
│   ├── models.py          # IntelAccount
│   ├── password.py        # PBKDF2 hashing
│   ├── jwt_utils.py       # JWT creation/verification
│   ├── account_store.py   # MongoDB CRUD
│   ├── dependencies.py    # FastAPI dependencies
│   └── router.py          # Auth endpoints
├── additionals.py         # Additionals system
├── requests.py            # Request system
└── tenant_router.py       # Multi-tenant endpoints

web/src/
├── lib/
│   ├── intel-auth.ts      # Auth client
│   └── intel-tenant-api.ts # API client
└── app/intelligence/
    ├── login/page.tsx     # Login page
    ├── clients/page.tsx   # Client management
    ├── requests/page.tsx  # Request management
    └── client/
        ├── page.tsx       # Client dashboard
        └── [docId]/page.tsx # Document view with sandbox
```

## Support

For issues or questions:
1. Check this documentation
2. Review API endpoint responses for error details
3. Check browser console for frontend errors
4. Check backend logs for authentication failures
5. Verify environment variables are set correctly
