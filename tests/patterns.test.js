import { describe, it, expect } from 'vitest'
import { isValidBsn, EMAIL_PATTERN } from '../src/locales/shared.js'
import { nl } from '../src/locales/nl.js'
import { en } from '../src/locales/en.js'

/**
 * Helper: find all matches for a given pattern key in the given locale.
 * Mirrors the logic in detector.js applyRegexPass.
 */
function findMatches(locale, key, text) {
    const pattern = key === 'EMAIL' ? EMAIL_PATTERN : locale.patterns[key]
    if (!pattern) return []

    const re = new RegExp(pattern.source, pattern.flags)
    const filter = locale.matchFilter?.[key]
    const matches = []

    for (const match of text.matchAll(re)) {
        const value = match[0]
        if (filter && !filter(value)) continue
        matches.push({ value, start: match.index, end: match.index + value.length })
    }

    return matches
}

describe('isValidBsn', () => {
    it('accepts a valid BSN', () => {
        // 111222333 is a well-known test BSN that passes elfproef
        expect(isValidBsn('111222333')).toBe(true)
    })

    it('rejects an invalid BSN', () => {
        expect(isValidBsn('123456789')).toBe(false)
    })

    it('rejects non-numeric input', () => {
        expect(isValidBsn('12345678a')).toBe(false)
    })

    it('rejects input shorter than 9 digits', () => {
        expect(isValidBsn('12345678')).toBe(false)
    })
})

describe('nl locale — EMAIL', () => {
    it('finds a plain email address', () => {
        const matches = findMatches(nl, 'EMAIL', 'Stuur naar jan@example.com graag')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('jan@example.com')
    })

    it('finds multiple email addresses', () => {
        const matches = findMatches(nl, 'EMAIL', 'jan@example.com en piet@voorbeeld.nl')
        expect(matches).toHaveLength(2)
    })

    it('returns empty array when no email found', () => {
        expect(findMatches(nl, 'EMAIL', 'Geen e-mail hier')).toHaveLength(0)
    })
})

describe('nl locale — PHONE', () => {
    it('finds a Dutch mobile number with 06 prefix and hyphen separator', () => {
        const matches = findMatches(nl, 'PHONE', 'Bel mij op 06-12345678')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('06-12345678')
    })

    it('finds a Dutch mobile number without separator', () => {
        const matches = findMatches(nl, 'PHONE', 'Bel mij op 0612345678')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('0612345678')
    })

    it('finds a +31 international number', () => {
        const matches = findMatches(nl, 'PHONE', 'Bereikbaar op +31612345678')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('+31612345678')
    })

    it('does not match a random number sequence', () => {
        expect(findMatches(nl, 'PHONE', 'Hij is 42 jaar oud')).toHaveLength(0)
    })
})

describe('nl locale — POSTCODE', () => {
    it('finds a Dutch postcode without space', () => {
        const matches = findMatches(nl, 'POSTCODE', 'Ik woon op 2517KJ')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('2517KJ')
    })

    it('finds a Dutch postcode with space', () => {
        const matches = findMatches(nl, 'POSTCODE', 'Adres: 1234 AB')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('1234 AB')
    })

    it('does not match a postcode starting with 0', () => {
        expect(findMatches(nl, 'POSTCODE', '0234 AB')).toHaveLength(0)
    })
})

describe('nl locale — IBAN', () => {
    it('finds a Dutch IBAN', () => {
        const matches = findMatches(nl, 'IBAN', 'Rekeningnummer NL91ABNA0417164300')
        expect(matches).toHaveLength(1)
        expect(matches[0].value.toUpperCase()).toBe('NL91ABNA0417164300')
    })

    it('does not match a non-Dutch IBAN prefix', () => {
        expect(findMatches(nl, 'IBAN', 'DE89370400440532013000')).toHaveLength(0)
    })
})

describe('nl locale — BSN', () => {
    it('finds a valid BSN', () => {
        const matches = findMatches(nl, 'BSN', 'BSN: 111222333')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('111222333')
    })

    it('skips an invalid BSN (fails elfproef)', () => {
        expect(findMatches(nl, 'BSN', 'nummer 123456789')).toHaveLength(0)
    })
})

// ─── English locale patterns ──────────────────────────────────────────────────

describe('en locale — PHONE', () => {
    it('finds a UK phone number with country code', () => {
        const matches = findMatches(en, 'PHONE', 'Call +44 7700 900123 now')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toContain('44')
    })

    it('finds a US phone number', () => {
        const matches = findMatches(en, 'PHONE', 'Dial (555) 123-4567 today')
        expect(matches).toHaveLength(1)
    })

    it('finds an international number with + prefix', () => {
        const matches = findMatches(en, 'PHONE', 'Reach us at +1 800 555 1234')
        expect(matches).toHaveLength(1)
    })
})

describe('en locale — POSTCODE', () => {
    it('finds a UK postcode', () => {
        const matches = findMatches(en, 'POSTCODE', 'Address: SW1A 2AA London')
        expect(matches).toHaveLength(1)
        expect(matches[0].value.replace(/\s+/g, ' ').trim()).toBe('SW1A 2AA')
    })

    it('finds a US ZIP code', () => {
        const matches = findMatches(en, 'POSTCODE', 'City, NY 10001')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('10001')
    })

    it('finds a US ZIP+4 code', () => {
        const matches = findMatches(en, 'POSTCODE', 'Send to 90210-1234')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('90210-1234')
    })
})

describe('en locale — IBAN (generic)', () => {
    it('finds a Dutch IBAN', () => {
        const matches = findMatches(en, 'IBAN', 'Account NL91ABNA0417164300')
        expect(matches).toHaveLength(1)
        expect(matches[0].value.toUpperCase()).toBe('NL91ABNA0417164300')
    })

    it('finds a German IBAN', () => {
        const matches = findMatches(en, 'IBAN', 'IBAN: DE89370400440532013000')
        expect(matches).toHaveLength(1)
    })

    it('finds a UK IBAN', () => {
        const matches = findMatches(en, 'IBAN', 'Sort: GB29NWBK60161331926819')
        expect(matches).toHaveLength(1)
    })
})
