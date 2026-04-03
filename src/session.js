import { CATEGORIES } from './categories.js'

/**
 * PiiSession manages the in-memory mapping between placeholder tokens and
 * original PII values for a single question/answer round-trip.
 *
 * Privacy guarantees:
 * - Original values are held in private class fields (not on window or in storage)
 * - The same literal value always maps to the same token within a session
 *   (reverse lookup prevents minting duplicate tokens for the same value)
 * - Calling destroy() clears both Maps immediately — do not rely on GC
 * - Tokens in nonRestorableKeys are stripped rather than restored (e.g. BSN per Dutch law Wabb)
 */
export class PiiSession {
    /** @type {Map<string, string>} token → original value */
    #tokenToValue = new Map()

    /** @type {Map<string, string>} original value → token (prevents duplicate tokens) */
    #valueToToken = new Map()

    /** @type {Map<string, number>} category key → next sequence number */
    #counters = new Map()

    /** @type {Set<string>} category keys whose tokens are stripped (not restored) in answers */
    #nonRestorableKeys

    /**
     * @param {Set<string>} [nonRestorableKeys]
     *   Set of category keys whose tokens are stripped rather than restored in answers.
     *   Defaults to empty set. Pass `new Set(['BSN'])` for Dutch mode.
     */
    constructor(nonRestorableKeys = new Set()) {
        this.#nonRestorableKeys = nonRestorableKeys
    }

    /**
     * Mint or retrieve the token for a given PII value.
     * If the value was seen before in this session, the existing token is returned.
     *
     * @param {string} categoryKey — e.g. 'NAME', 'EMAIL'
     * @param {string} value       — the original PII value
     * @returns {string}           — the placeholder token, e.g. '[NAME_1]'
     */
    getOrCreateToken(categoryKey, value) {
        const existing = this.#valueToToken.get(value)
        if (existing) return existing

        const n = (this.#counters.get(categoryKey) ?? 0) + 1
        this.#counters.set(categoryKey, n)

        const token = `[${categoryKey}_${n}]`
        this.#tokenToValue.set(token, value)
        this.#valueToToken.set(value, token)

        return token
    }

    /**
     * Retrieve the original value for a token.
     *
     * @param {string} token — e.g. '[NAME_1]'
     * @returns {string | undefined}
     */
    getValue(token) {
        return this.#tokenToValue.get(token)
    }

    /**
     * Returns the token previously minted for a given original value, or undefined.
     * Used by the detector to associate entity source (regex/llm) with tokens.
     *
     * @param {string} value
     * @returns {string | undefined}
     */
    getToken(value) {
        return this.#valueToToken.get(value)
    }

    /**
     * Returns true if this session has any replacements.
     *
     * @returns {boolean}
     */
    hasReplacements() {
        return this.#tokenToValue.size > 0
    }

    /**
     * Returns all minted replacements as an array of { token, type } objects
     * (no original values) for the onPiiFound callback.
     *
     * @returns {{ token: string, type: string }[]}
     */
    getReplacements() {
        return Array.from(this.#tokenToValue.keys()).map(token => {
            // Extract category key from '[NAME_1]' → 'NAME'
            const key = token.slice(1, token.lastIndexOf('_'))
            const cat = CATEGORIES[key]
            return { token, type: cat?.label ?? key.toLowerCase() }
        })
    }

    /**
     * Restores tokens in the given text back to their original values.
     * Best-effort: unrecognised tokens are left unchanged.
     * Tokens in nonRestorableKeys are stripped (replaced with empty string).
     *
     * @param {string} text
     * @returns {string}
     */
    restore(text) {
        return text.replace(/\[([A-Z]+)_(\d+)\]/g, match => {
            const key = match.slice(1, match.lastIndexOf('_'))

            // Strip non-restorable tokens (e.g. BSN per Dutch law requirement)
            if (this.#nonRestorableKeys.has(key)) return ''

            return this.#tokenToValue.get(match) ?? match
        })
    }

    /**
     * Clears all PII data from memory. Must be called after restore().
     * Also called automatically on beforeunload.
     */
    destroy() {
        this.#tokenToValue.clear()
        this.#valueToToken.clear()
        this.#counters.clear()
    }
}
