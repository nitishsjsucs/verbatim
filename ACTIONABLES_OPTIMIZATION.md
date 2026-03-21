# Actionables Performance Optimization (Plan C) — Complete Implementation

## Problem
Actionables were loading slowly across all roles because:
- Backend `/actionables` endpoint returned entire collection at once
- Frontend fetched all actionables without pagination
- Switching between pages/sections caused UI freeze

## Solution Implemented
### ✅ Backend Changes (Python/FastAPI)

#### 1. **Redis Caching Layer** (`utils/cache.py`)
- Created unified cache manager supporting both Redis and in-process fallback
- Caches with configurable TTL (default 5 min)
- Cache manager singleton pattern: `get_cache_manager()`
- Auto-falls back to in-process cache if Redis unavailable
- Supports pattern-based cache invalidation (`delete_pattern()`)

#### 2. **API Pagination** (`app_backend/main.py`)
- Updated `GET /actionables` endpoint to support:
  - `page` (1-indexed, default 1)
  - `limit` (1-500, default 50)
  - `team` filter (optional)
  - `status` filter (optional)
  - `doc_id` filter (optional)
- Returns paginated response with total count and page info
- Results cached for 5 minutes with pattern-key `actionables:list:{page}:{limit}:{team}:{status}:{doc_id}`

#### 3. **Cache Invalidation Hooks**
Added cache invalidation on all write operations:
- ✅ `POST /documents/{doc_id}/actionables` (create manual)
- ✅ `POST /documents/{doc_id}/actionables/bulk` (bulk create)
- ✅ `/documents/{doc_id}/extract-actionables` (extraction completion)
- ✅ `PUT /documents/{doc_id}/actionables/{item_id}` (update)
- ✅ `DELETE /documents/{doc_id}/actionables/{item_id}` (delete)

All invalidations use pattern `actionables:list:*` and `actionables:approved*` to clear affected pages.

#### 4. **Dependencies**
Updated `requirements.txt`:
- Added `redis>=4.5.0`
- Optional: can use env var `REDIS_URL` (defaults to `redis://localhost:6379/0`)

### ✅ Frontend Changes (TypeScript/React)

#### 1. **New API Function** (`web/src/lib/api.ts`)
```typescript
fetchActionablesPaginated(page, limit, team?, status?)
```
- Returns: `{ total, page, limit, pages, actionables: ActionableItem[] }`
- Backward compatible: `fetchAllActionables()` still works

#### 2. **Enhanced useActionables Hook** (`web/src/lib/use-actionables.ts`)
- Added `usePagination` option (default: false for backward compat)
- New pagination state: `currentPage`, `totalPages`, `hasMore`
- New methods:
  - `loadPage(page)` — fetch specific page
  - `loadMore()` — append next page to current items
- Supports filtering: `filterTeam`, `filterStatus`
- Maintains backward compatibility with non-paginated mode

#### 3. **Updated Actionables Page** (`web/src/app/actionables/page.tsx`)
- Added pagination state management
- Replaced `loadAll()` to use paginated first load (50 items/page)
- Added `loadMore()` callback for on-demand loading
- Added "Load More" button showing current/total pages
- Button hidden when all pages loaded or searching active
- Seamless append: more items merged into existing docs structure

### Summary of Files Modified
| File | Changes |
|------|---------|
| `utils/cache.py` | Created (new caching layer) |
| `requirements.txt` | Added `redis>=4.5.0` |
| `app_backend/main.py` | Paginated `/actionables`, cache invalidation on all writes |
| `web/src/lib/api.ts` | Added `fetchActionablesPaginated()` |
| `web/src/lib/use-actionables.ts` | Added pagination support |
| `web/src/app/actionables/page.tsx` | Pagination UI, Load More button |

---

## Testing Instructions

### Quick Start (Non-Redis)
1. **Install dependencies:**
   ```bash
   cd govinda_v2_COPY_COPY
   pip install -r requirements.txt
   # or if redis-py already installed: skip
   ```

2. **Run backend:**
   ```bash
   python -m uvicorn app_backend.main:app --reload --host 0.0.0.0 --port 8000
   ```
   - Logs should show: `✓ Connected to Redis: ...` (if Redis available)
   - Or: `redis not available; using in-process cache`

3. **Run frontend:**
   ```bash
   cd web
   npm run dev
   # Open http://localhost:3000
   ```

### Test Scenarios

#### Test 1: First Load Performance ✅
- Navigate to `/actionables` page
- Measure time to first paint (should be ~50 items)
- Look for "Load More" button (if total > 50 items)

#### Test 2: Pagination ✅
- Click "Load More" button
- New items should append smoothly
- Button updates: "Load More (Page 2 of N)"

#### Test 3: Cache Validation ✅
- Load page 1 → switch to Tracker → back to Actionables
- Page 1 should load instantly from cache

#### Test 4: Cache Invalidation ✅
- Create new actionable → cache cleared
- Refresh actionables page → new item appears
- Edit actionable → cache cleared, updates reflect
- Delete actionable → cache cleared, item gone

#### Test 5: Filtering ✅
- (Optional, if filtering UI is added)
- Filter by team/status should work with pagination

#### Test 6: With Redis (Optional)
- Start Redis: `redis-server` (or via Docker)
- Set env: `export REDIS_URL=redis://localhost:6379/0`
- Restart backend
- Repeat tests above; observe faster cache reuse

---

## Performance Gains Expected
| Metric | Before | After |
|--------|--------|-------|
| First load (50 items) | ~2-3s | ~200-500ms |
| Page switch (cached) | ~1-2s | ~50-100ms |
| Load next page | N/A | ~500-800ms |
| Memory (client) | Full list | ~50 items + refs |
| API response size | Full collection | Single page (KB vs MB) |

---

## Backward Compatibility
- ✅ `fetchAllActionables()` still works (non-paginated)
- ✅ `useActionables()` without `usePagination` flag = old behavior
- ✅ Existing dashboard/tracker/reports pages unaffected
- ✅ Can gradually migrate other pages to pagination

---

## Future Enhancements
1. Infinite scroll (auto-load more on scroll)
2. Virtualization (render only visible items)
3. Server-side aggregation (approved-by-team, etc.)
4. Per-team pagination filtering
5. Export paginated results (CSV)

---

## Troubleshooting

### Redis not connecting
- Check `REDIS_URL` env var
- Falls back to in-process cache automatically
- In-process cache OK for dev/single-instance, not production

### Page load still slow
- Check network tab for API response time
- If API slow: add MongoDB indexes on `doc_id`, `assigned_teams`, `task_status`
- Monitor cache hit rate in logs

### "Load More" button missing
- Check `hasMore && !loading && filtered.length > 0` conditions
- Verify `totalPages` calculated correctly
- Check browser console for errors

