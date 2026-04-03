import { describe, it, expect } from 'vitest'
import { findMatches, isValidBsn } from '../src/patterns.js'

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

describe('findMatches — EMAIL', () => {
    it('finds a plain email address', () => {
        const matches = findMatches('EMAIL', 'Stuur naar jan@example.com graag')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('jan@example.com')
    })

    it('finds multiple email addresses', () => {
        const matches = findMatches('EMAIL', 'jan@example.com en piet@voorbeeld.nl')
        expect(matches).toHaveLength(2)
    })

    it('returns empty array when no email found', () => {
        expect(findMatches('EMAIL', 'Geen e-mail hier')).toHaveLength(0)
    })
})

describe('findMatches — TELEFOON', () => {
    it('finds a Dutch mobile number with 06 prefix and hyphen separator', () => {
        const matches = findMatches('TELEFOON', 'Bel mij op 06-12345678')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('06-12345678')
    })

    it('finds a Dutch mobile number without separator', () => {
        const matches = findMatches('TELEFOON', 'Bel mij op 0612345678')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('0612345678')
    })

    it('finds a +31 international number', () => {
        const matches = findMatches('TELEFOON', 'Bereikbaar op +31612345678')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('+31612345678')
    })

    it('does not match a random number sequence', () => {
        expect(findMatches('TELEFOON', 'Hij is 42 jaar oud')).toHaveLength(0)
    })
})

describe('findMatches — POSTCODE', () => {
    it('finds a Dutch postcode without space', () => {
        const matches = findMatches('POSTCODE', 'Ik woon op 2517KJ')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('2517KJ')
    })

    it('finds a Dutch postcode with space', () => {
        const matches = findMatches('POSTCODE', 'Adres: 1234 AB')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('1234 AB')
    })

    it('does not match a postcode starting with 0', () => {
        expect(findMatches('POSTCODE', '0234 AB')).toHaveLength(0)
    })
})

describe('findMatches — IBAN', () => {
    it('finds a Dutch IBAN', () => {
        const matches = findMatches('IBAN', 'Rekeningnummer NL91ABNA0417164300')
        expect(matches).toHaveLength(1)
        expect(matches[0].value.toUpperCase()).toBe('NL91ABNA0417164300')
    })

    it('does not match a non-Dutch IBAN prefix', () => {
        expect(findMatches('IBAN', 'DE89370400440532013000')).toHaveLength(0)
    })
})

describe('findMatches — BSN', () => {
    it('finds a valid BSN', () => {
        const matches = findMatches('BSN', 'BSN: 111222333')
        expect(matches).toHaveLength(1)
        expect(matches[0].value).toBe('111222333')
    })

    it('skips an invalid BSN (fails elfproef)', () => {
        expect(findMatches('BSN', 'nummer 123456789')).toHaveLength(0)
    })
})
