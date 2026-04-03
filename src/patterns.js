/**
 * Dutch PII regex patterns.
 *
 * These run synchronously before the LLM pass and catch high-confidence,
 * structured PII: email addresses, Dutch phone numbers, Dutch postcodes,
 * IBAN numbers, and BSN (Burgerservicenummer).
 *
 * All patterns use the 'g' flag so they work correctly with String.matchAll().
 */

export const PATTERNS = {
    EMAIL: /\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/gi,

    // Dutch phone: +31, 0031, or local 0 prefix.
    // Optional dashes or spaces as separators within the number (e.g. 06-12345678).
    // (?<!\d) / (?!\d) instead of \b because \b fails before '+' (non-word char).
    TELEFOON: /(?<!\d)(?:(?:\+31|0031)[\s-]?[1-9]|0[1-9])(?:[\s-]?\d){7,8}(?!\d)/g,

    // Dutch postcode: 4 digits, optional space, 2 uppercase letters (e.g. 2517 KJ or 2517KJ)
    POSTCODE: /\b[1-9]\d{3}\s?[A-Z]{2}\b/g,

    // Dutch IBAN
    IBAN: /\bNL\d{2}[A-Z]{4}\d{10}\b/gi,

    // BSN: exactly 9 digits (validated with elfproef before redacting)
    BSN: /\b\d{9}\b/g,
}

/**
 * Validates a BSN number using the elfproef (11-proof) algorithm.
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

/**
 * Returns all regex matches for a given pattern key in the given text.
 * Each match includes the matched value and its start/end indices.
 *
 * For BSN, applies elfproef validation and discards invalid matches.
 *
 * @param {string} key — a key from PATTERNS (e.g. 'EMAIL')
 * @param {string} text
 * @returns {{ value: string, start: number, end: number }[]}
 */
export function findMatches(key, text) {
    const pattern = PATTERNS[key]
    if (!pattern) return []

    // Reset lastIndex — patterns are shared and stateful when using 'g' flag
    const re = new RegExp(pattern.source, pattern.flags)
    const matches = []

    for (const match of text.matchAll(re)) {
        const value = match[0]

        if (key === 'BSN' && !isValidBsn(value)) continue

        matches.push({ value, start: match.index, end: match.index + value.length })
    }

    return matches
}
