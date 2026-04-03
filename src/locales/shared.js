/**
 * Shared patterns and utilities used across all locales.
 */

/** Universal email pattern — works for all locales */
export const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/gi

/**
 * Validates a BSN (Burgerservicenummer) using the elfproef (11-proof) algorithm.
 * BSN digits are multiplied by weights 9,8,7,6,5,4,3,2,-1 and summed.
 * A valid BSN produces a sum divisible by 11.
 *
 * @param {string} bsn — exactly 9 digit characters
 * @returns {boolean}
 */
export function isValidBsn(bsn) {
    if (!/^\d{9}$/.test(bsn)) return false
    const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1]
    const sum = bsn.split('').reduce((acc, digit, i) => acc + parseInt(digit, 10) * weights[i], 0)
    return sum % 11 === 0
}
