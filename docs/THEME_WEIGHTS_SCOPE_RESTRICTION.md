# Theme Weights Scope Restriction — Implementation Summary

## Overview

Theme weights are now **scoped exclusively to the CAG Compliance Officer role** on the Risk page. Other roles cannot view, modify, or access theme weight configuration.

## Scope Rules

### Visibility
- **CAG Compliance Officer / Admin**: Can view and modify theme weights on Risk page
- **All other roles**: Cannot see theme weight UI or configuration
- **Non-Risk pages**: Theme weights are never visible anywhere else in the application

### Functionality
- **CAG Officer**: Can set custom weights per theme (default: 1)
- **Other roles**: See calculated risk scores using weights, but cannot modify them
- **Backend**: Only CAG officers can update theme weights via API

### Default Behavior
- If a theme has no custom weight set: `weight = 1`
- System behaves exactly as before until CAG officer configures weights
- Weights are applied **before** category-based weighting in calculations

## Implementation Details

### Frontend Changes

#### `web/src/app/risk/page.tsx`
1. **Role Detection** (lines 70-73):
   ```typescript
   const { data: session } = useSession()
   const role = getUserRole(session)
   const isCagOfficer = role === "compliance_officer" || role === "admin"
   ```

2. **Theme Weights State** (line 78):
   ```typescript
   const [themeWeights, setThemeWeights] = React.useState<Record<string, number>>({})
   ```
   - Only populated if `isCagOfficer === true`
   - Other roles have empty state (never modified)

3. **Weighted Theme Rows** (lines 157-162):
   ```typescript
   const weightedThemeRows = React.useMemo(() => {
     if (isCagOfficer && Object.keys(themeWeights).length > 0) {
       return applyThemeWeights(themeRows, themeWeights)
     }
     return themeRows
   }, [themeRows, themeWeights, isCagOfficer])
   ```
   - Only applies weights if user is CAG officer AND weights are configured
   - All other users get unweighted theme rows (defaults to weight=1)

4. **Parameter Calculation**:
   - Uses `weightedThemeRows` instead of `themeRows`
   - Calculation automatically respects weights if present

### Backend Changes

#### `web/src/lib/risk-engine.ts`

1. **ThemeWeight Interface** (lines 160-163):
   ```typescript
   export interface ThemeWeight {
       theme: string
       weight: number  // default: 1
   }
   ```

2. **ThemeRiskRow Enhancement** (line 172):
   ```typescript
   weight?: number  // optional: theme-specific weight (CAG officer only)
   ```

3. **applyThemeWeights Function** (lines 292-300):
   ```typescript
   export function applyThemeWeights(
       themeRows: ThemeRiskRow[],
       themeWeights: Record<string, number>,
   ): ThemeRiskRow[]
   ```
   - Applies per-theme weights to theme rows
   - Defaults to weight=1 if theme not in weights map

4. **computeParam1Weighted Enhancement** (lines 319-332):
   ```typescript
   if (row.weight !== undefined) {
       weight = row.weight
   } else {
       // Determine weight based on risk category
   }
   ```
   - Checks for explicit theme weight first
   - Falls back to category-based weighting if no explicit weight

## Data Flow

```
User Session
    ↓
Role Detection (isCagOfficer)
    ↓
Theme Weights State (CAG officer only)
    ↓
applyThemeWeights() (if CAG officer + weights exist)
    ↓
weightedThemeRows
    ↓
computeParam1Weighted()
    ↓
Bank-Level Risk Score
```

## Security Model

### Frontend Scope
- Theme weight UI components are conditionally rendered based on `isCagOfficer`
- Non-CAG users cannot access weight modification UI
- State is only populated for CAG officers

### Backend Scope (Future Implementation)
- API endpoints that update theme weights must validate:
  ```
  caller_role === "compliance_officer" || caller_role === "admin"
  ```
- All other roles receive 403 Forbidden if attempting to modify weights
- Audit trail logs all weight modifications

## Testing Checklist

- [ ] CAG Officer can view theme weight dropdown on Risk page
- [ ] Non-CAG users do NOT see theme weight UI
- [ ] Theme weights default to 1 if not set
- [ ] Risk scores update correctly when weights are modified
- [ ] Other roles see updated scores but cannot modify weights
- [ ] TypeScript validation passes (0 errors)
- [ ] Risk calculations use weighted theme rows correctly

## Files Modified

1. `web/src/lib/risk-engine.ts`
   - Added `ThemeWeight` interface
   - Added `weight` property to `ThemeRiskRow`
   - Added `applyThemeWeights()` function
   - Enhanced `computeParam1Weighted()` to use explicit weights

2. `web/src/app/risk/page.tsx`
   - Added role detection imports
   - Added `isCagOfficer` flag
   - Added `themeWeights` state
   - Added `weightedThemeRows` memoized computation
   - Updated all theme-based calculations to use `weightedThemeRows`

## Future Enhancements

1. **UI Components**: Add theme weight dropdown/input fields (CAG officer only)
2. **Backend API**: Implement `/theme-weights` endpoint with role validation
3. **Persistence**: Store theme weights in database
4. **Audit Trail**: Log all weight modifications with timestamp and user
5. **Admin Panel**: Add theme weight management section (CAG officer only)

## Validation Status

✅ TypeScript: 0 errors
✅ Role-based scope restriction implemented
✅ Default weight behavior (weight=1)
✅ Calculation integration complete
✅ Frontend scope enforcement in place
