/**
 * Number Formatting Utility (Indian Conventions)
 * 
 * Formats large numbers using K (Thousand), L (Lakh), CR (Crore) notation.
 * 
 * Rules:
 * - 1,000 to 99,999: K format (e.g., 1.2K, 8.5K)
 * - 1,00,000 to 99,99,999: L format (e.g., 1.3L, 5.7L)
 * - 1,00,00,000+: CR format (e.g., 1.1CR, 2.4CR)
 * 
 * Examples:
 * - 1,250 → 1.25K
 * - 12,500 → 12.5K
 * - 1,20,000 → 1.2L
 * - 25,00,000 → 25L
 * - 1,50,00,000 → 1.5CR
 */

export function formatNumber(value: number | string | undefined | null): string {
    // Handle null/undefined
    if (value === null || value === undefined) return "0"
    
    // Convert to number
    const num = typeof value === "string" ? parseFloat(value) : value
    
    // Handle NaN
    if (isNaN(num)) return "0"
    
    // Handle negative numbers
    const isNegative = num < 0
    const absNum = Math.abs(num)
    
    // Less than 1,000: show as-is
    if (absNum < 1000) {
        return num.toString()
    }
    
    // 1,000 to 99,999: K format (Thousands)
    if (absNum < 100000) {
        const thousands = absNum / 1000
        const formatted = thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)
        return `${isNegative ? "-" : ""}${formatted}K`
    }
    
    // 1,00,000 to 99,99,999: L format (Lakhs)
    if (absNum < 10000000) {
        const lakhs = absNum / 100000
        const formatted = lakhs % 1 === 0 ? lakhs.toFixed(0) : lakhs.toFixed(1)
        return `${isNegative ? "-" : ""}${formatted}L`
    }
    
    // 1,00,00,000+: CR format (Crores)
    const crores = absNum / 10000000
    const formatted = crores % 1 === 0 ? crores.toFixed(0) : crores.toFixed(1)
    return `${isNegative ? "-" : ""}${formatted}CR`
}

/**
 * Format number for display in stat cards and counters.
 * Alias for formatNumber for semantic clarity.
 */
export function formatStatValue(value: number | string | undefined | null): string {
    return formatNumber(value)
}
