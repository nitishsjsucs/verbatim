# Risk Score Calculation Fix — Summary

## Problem
The system was calculating the overall bank risk score using an **incorrect category-average method**:

```
OLD (WRONG):
Final Score = (LowAverage × 1 + MediumAverage × 1 + HighAverage × 2) / (1 + 1 + 2)
```

This treated the three risk categories as three equal data points, ignoring that they contain **different numbers of themes**, causing severe distortion.

## Solution
Replaced with a **mathematically correct per-theme weighted average**:

```
NEW (CORRECT):
Final Score = SUM(theme_score × weight) / SUM(weight)
```

Where each theme contributes individually with its assigned weight based on risk category.

## Implementation

### Files Modified

#### 1. `web/src/lib/risk-engine.ts`
- **Added new function**: `computeParam1Weighted()`
- Applies weights directly to individual theme scores
- Uses the formula: `SUM(avgResidual × weight) / SUM(weight)`
- Kept old `computeParam1()` for reference (marked as OLD)

#### 2. `web/src/app/risk/page.tsx`
- Updated import: Changed from `computeParam1` to `computeParam1Weighted`
- Updated call: Line 157 now uses the new weighted function
- All downstream calculations automatically use the corrected P1 score

## Weight Rules
| Risk Category | Weight |
|---|---|
| Low (< 13) | 1 |
| Medium (13-27) | 1 |
| High (≥ 28) | 2 |

## Example Calculation

Using your synthetic dataset (26 themes):

**Theme Distribution:**
- Low themes: 10 (Market Risk, Audit, NPA & Restructuring, Corporate Governance, Financial Accounting & Records, Outsourcing, Compliance, Loans & Advances, Priority Sector Lending, Credit Risk)
- Medium themes: 15 (Third Party Products, Other Operating Regulations, Digital Banking, Treasury, CMS, Branch Banking, Cyber & Information Security, FCRM, IT Governance, Debit Card, Employer Communications, Credit Card, Customer Service, Trade & FEMA, KYC / AML)
- High themes: 1 (Deposit)

**Calculation:**
```
Weighted Sum = (89.37 × 1) + (269.58 × 1) + (28.95 × 2)
             = 89.37 + 269.58 + 57.90
             = 416.85

Weighted Count = (10 × 1) + (15 × 1) + (1 × 2)
               = 10 + 15 + 2
               = 27

Final P1 Score = 416.85 / 27 = 15.43 (or 15.44 with rounding)
```

## Expected Result
After this fix, the Risk page will display:
- **P1 Score**: ~15.43–15.44 (instead of the incorrect ~1.04)
- **Bank-Level Risk Score**: P1 + Total Parameter Score (using correct P1)
- **Risk Interpretation**: Based on the corrected final score

## Validation
- ✅ TypeScript: 0 errors
- ✅ New function properly weights individual theme scores
- ✅ Calculation is mathematically correct
- ✅ Works dynamically regardless of theme count changes
- ✅ Backward compatible (old function still available for reference)

## Testing
Run the Risk page with the synthetic dataset to verify:
1. P1 Score displays ~15.43–15.44
2. Bank-Level Risk Score reflects the corrected calculation
3. Risk interpretation updates accordingly
