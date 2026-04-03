/**
 * PII category definitions.
 *
 * Each category maps:
 *   key     — the uppercase token prefix used in placeholders (e.g. NAME → [NAME_1])
 *   label   — the Dutch display name used in onPiiFound callbacks (e.g. 'naam')
 *   restore — whether answers should restore this token (BSN is never restored)
 */
export const CATEGORIES = {
    NAME:     { key: 'NAME',     label: 'naam',          restore: true  },
    EMAIL:    { key: 'EMAIL',    label: 'e-mail',         restore: true  },
    PHONE:    { key: 'PHONE',    label: 'telefoonnummer', restore: true  },
    ADDRESS:  { key: 'ADDRESS',  label: 'adres',          restore: true  },
    POSTCODE: { key: 'POSTCODE', label: 'postcode',       restore: true  },
    BSN:      { key: 'BSN',      label: 'BSN',            restore: false },
    IBAN:     { key: 'IBAN',     label: 'IBAN',           restore: true  },
}

/**
 * Maps user-facing category labels (from options.categories) to canonical CATEGORY keys.
 * Allows the host app to pass plain Dutch labels like 'naam', 'e-mail', etc.
 */
export const LABEL_TO_KEY = Object.fromEntries(
    Object.values(CATEGORIES).map(cat => [cat.label, cat.key])
)

/**
 * Returns the set of active category keys for a given list of category identifiers.
 * Accepts canonical keys ('NAME', 'EMAIL') and locale-specific labels ('naam', 'name', 'e-mail').
 * Defaults to all categories when no list is provided.
 *
 * @param {string[] | undefined} categories
 * @param {Record<string, string>} [localeLabels] — optional label→key map from the active locale
 * @returns {Set<string>}
 */
export function resolveActiveKeys(categories, localeLabels = {}) {
    if (!categories || categories.length === 0) {
        return new Set(Object.keys(CATEGORIES))
    }
    // Build a combined label→key map: base Dutch labels + current locale labels
    const combinedLabelToKey = { ...LABEL_TO_KEY }
    for (const [label, key] of Object.entries(localeLabels)) {
        combinedLabelToKey[label] = key
    }

    const keys = new Set()
    for (const input of categories) {
        // Accept canonical key directly (NAME, EMAIL, PHONE, etc.)
        if (CATEGORIES[input]) {
            keys.add(input)
            continue
        }
        // Accept locale label (naam, name, e-mail, email, etc.)
        const key = combinedLabelToKey[input]
        if (key) keys.add(key)
    }
    return keys
}
