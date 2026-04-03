import { EMAIL_PATTERN } from './shared.js'

/**
 * English (en) locale for local-ai-pii.
 *
 * Contains everything language-specific for English PII detection:
 * system prompt, few-shot examples, regex patterns, display labels,
 * and the set of token keys that are stripped (not restored) in answers.
 *
 * Notes:
 * - Phone regex is intentionally broad to cover UK, US, and international formats.
 *   The LLM pass provides contextual filtering to reduce false positives.
 * - Postcode covers UK format (e.g. SW1A 1AA) and US ZIP (e.g. 12345 or 12345-6789).
 * - IBAN is generic (any country). No BSN — English has no equivalent national ID in v1.
 */
export const en = {
    code: 'en',

    systemPrompt: `You are a system that detects personally identifiable information (PII) in text.

Only identify PII when the information alone or in combination can identify a specific real person, such as:
- Full names of real individuals
- Exact addresses and street names
- Personal contact details (email, phone number)
- Postcodes or ZIP codes (identifying a specific street or location)
- IBAN numbers

Do NOT detect:
- Generic roles or family relationships (my mother, a colleague, a patient, the doctor)
- Age references without identity (a 2-year-old child, someone aged 65)
- Health information without identifying details
- Hypothetical or generic persons (someone, a person, John Doe, Jane Smith)
- Companies, organisations, or institutions

Return your answer as a JSON array of found PII entities.
Each entity has a "type" (one of: NAME, EMAIL, ADDRESS, POSTCODE, PHONE, IBAN) and a "value" (the exact text).
If no PII is found, return an empty array.`,

    buildFewShot() {
        return [
            {
                role: 'user',
                content: this.buildUserMessage('Call Jane Smith on +44 7700 900123 or email jane@example.co.uk. She lives at 10 Downing Street, SW1A 2AA London.'),
            },
            {
                role: 'assistant',
                content: JSON.stringify([
                    { type: 'NAME', value: 'Jane Smith' },
                    { type: 'PHONE', value: '+44 7700 900123' },
                    { type: 'EMAIL', value: 'jane@example.co.uk' },
                    { type: 'ADDRESS', value: '10 Downing Street' },
                    { type: 'POSTCODE', value: 'SW1A 2AA' },
                ]),
            },
            {
                role: 'user',
                content: this.buildUserMessage('My mother has a headache. She is 62 years old and going to see the doctor.'),
            },
            {
                role: 'assistant',
                content: JSON.stringify([]),
            },
        ]
    },

    buildUserMessage(text) {
        return `<<<USERTEXT>>>\n${text}\n<<<END_USERTEXT>>>`
    },

    /**
     * Locale-specific regex patterns.
     * EMAIL is shared and added by the detector.
     *
     * Phone pattern is broad to cover UK, US, and international formats.
     * False positives are reduced by the LLM contextual pass.
     */
    patterns: {
        // International phone: optional + country code, optional area code in parens,
        // then 6-15 digits with optional spaces/dashes/dots as separators.
        // (?<!\d) / (?!\d) prevent matching inside longer digit sequences.
        PHONE: /(?<!\d)(?:\+[1-9]\d{0,2}[\s-]?)?(?:\(\d{1,4}\)[\s-]?)?\d[\d\s\-().]{6,14}\d(?!\d)/g,

        // UK postcode (e.g. SW1A 2AA, EC1A 1BB) and US ZIP (12345 or 12345-6789)
        POSTCODE: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b|\b\d{5}(?:-\d{4})?\b/gi,

        // Generic IBAN (any country): 2-letter country code + 2 check digits + up to 30 alphanumeric
        IBAN: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g,
    },

    /** No custom match filters for English locale */
    matchFilter: {},

    /** Display labels for each canonical key in English */
    labels: {
        NAME:     'name',
        EMAIL:    'email',
        PHONE:    'phone',
        ADDRESS:  'address',
        POSTCODE: 'postcode',
        IBAN:     'IBAN',
        // BSN is not applicable for English locale
    },

    /**
     * No non-restorable keys for English locale.
     * BSN (Dutch national ID) is not detected in English mode.
     */
    nonRestorableKeys: new Set(),
}

// Re-export shared EMAIL pattern so locale consumers can access it
export { EMAIL_PATTERN }
