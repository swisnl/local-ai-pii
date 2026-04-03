/**
 * PII category definitions.
 *
 * Each category maps:
 *   key        — the uppercase token prefix used in placeholders (e.g. NAAM → [NAAM_1])
 *   label      — the Dutch display name used in onPiiFound callbacks (e.g. 'naam')
 *   restoreBsn — whether answers should restore this token (BSN is never restored)
 */
export const CATEGORIES = {
    NAAM: { key: 'NAAM', label: 'naam', restore: true },
    EMAIL: { key: 'EMAIL', label: 'e-mail', restore: true },
    TELEFOON: { key: 'TELEFOON', label: 'telefoonnummer', restore: true },
    ADRES: { key: 'ADRES', label: 'adres', restore: true },
    POSTCODE: { key: 'POSTCODE', label: 'postcode', restore: true },
    BSN: { key: 'BSN', label: 'BSN', restore: false },
    IBAN: { key: 'IBAN', label: 'IBAN', restore: true },
}

/**
 * Maps user-facing category names (from options.categories) to CATEGORY keys.
 * Allows the host app to pass plain Dutch labels like 'naam', 'e-mail', etc.
 */
export const LABEL_TO_KEY = Object.fromEntries(
    Object.values(CATEGORIES).map(cat => [cat.label, cat.key])
)

/**
 * Returns the set of active category keys for a given list of labels.
 * Defaults to all categories when no list is provided.
 *
 * @param {string[] | undefined} labels
 * @returns {Set<string>}
 */
export function resolveActiveKeys(labels) {
    if (!labels || labels.length === 0) {
        return new Set(Object.keys(CATEGORIES))
    }
    const keys = new Set()
    for (const label of labels) {
        const key = LABEL_TO_KEY[label]
        if (key) keys.add(key)
    }
    return keys
}
