import { describe, it, expect, beforeEach } from 'vitest'
import { PiiSession } from '../src/session.js'

describe('PiiSession — token minting', () => {
    let session

    beforeEach(() => {
        session = new PiiSession()
    })

    it('mints a token for a new value', () => {
        const token = session.getOrCreateToken('NAME', 'Jan de Vries')
        expect(token).toBe('[NAME_1]')
    })

    it('returns the same token for the same value', () => {
        const t1 = session.getOrCreateToken('NAME', 'Jan de Vries')
        const t2 = session.getOrCreateToken('NAME', 'Jan de Vries')
        expect(t1).toBe(t2)
        expect(t1).toBe('[NAME_1]')
    })

    it('mints different tokens for different values in the same category', () => {
        const t1 = session.getOrCreateToken('NAME', 'Jan de Vries')
        const t2 = session.getOrCreateToken('NAME', 'Piet Pietersen')
        expect(t1).toBe('[NAME_1]')
        expect(t2).toBe('[NAME_2]')
    })

    it('keeps counters separate per category', () => {
        const naam = session.getOrCreateToken('NAME', 'Jan')
        const email = session.getOrCreateToken('EMAIL', 'jan@example.com')
        expect(naam).toBe('[NAME_1]')
        expect(email).toBe('[EMAIL_1]')
    })

    it('retrieves the original value by token', () => {
        session.getOrCreateToken('EMAIL', 'jan@example.com')
        expect(session.getValue('[EMAIL_1]')).toBe('jan@example.com')
    })

    it('returns undefined for an unknown token', () => {
        expect(session.getValue('[NAME_99]')).toBeUndefined()
    })
})

describe('PiiSession — hasReplacements', () => {
    it('returns false on a fresh session', () => {
        expect(new PiiSession().hasReplacements()).toBe(false)
    })

    it('returns true after a token is minted', () => {
        const session = new PiiSession()
        session.getOrCreateToken('NAME', 'Jan')
        expect(session.hasReplacements()).toBe(true)
    })
})

describe('PiiSession — getReplacements', () => {
    it('returns an array of { token, type } without original values', () => {
        const session = new PiiSession()
        session.getOrCreateToken('NAME', 'Jan de Vries')
        session.getOrCreateToken('EMAIL', 'jan@example.com')

        const replacements = session.getReplacements()
        expect(replacements).toHaveLength(2)
        expect(replacements).toContainEqual({ token: '[NAME_1]', type: 'naam' })
        expect(replacements).toContainEqual({ token: '[EMAIL_1]', type: 'e-mail' })

        // Original values must never be present
        const values = JSON.stringify(replacements)
        expect(values).not.toContain('Jan de Vries')
        expect(values).not.toContain('jan@example.com')
    })
})

describe('PiiSession — restore', () => {
    let session

    beforeEach(() => {
        session = new PiiSession()
        session.getOrCreateToken('NAME', 'Jan de Vries')
        session.getOrCreateToken('EMAIL', 'jan@example.com')
    })

    it('restores a known token', () => {
        expect(session.restore('Bedankt [NAME_1]')).toBe('Bedankt Jan de Vries')
    })

    it('restores multiple tokens in one string', () => {
        expect(session.restore('Hoi [NAME_1], uw mail is [EMAIL_1]'))
            .toBe('Hoi Jan de Vries, uw mail is jan@example.com')
    })

    it('leaves unknown tokens unchanged', () => {
        expect(session.restore('Hallo [NAME_99]')).toBe('Hallo [NAME_99]')
    })

    it('strips BSN tokens instead of restoring them', () => {
        const bsnSession = new PiiSession(new Set(['BSN']))
        bsnSession.getOrCreateToken('BSN', '111222333')
        expect(bsnSession.restore('Uw BSN [BSN_1] is verwerkt')).toBe('Uw BSN  is verwerkt')
    })

    it('returns unchanged text when no tokens are present', () => {
        expect(session.restore('Geen tokens hier')).toBe('Geen tokens hier')
    })
})

describe('PiiSession — destroy', () => {
    it('clears the token map so restore no longer works', () => {
        const session = new PiiSession()
        session.getOrCreateToken('NAME', 'Jan')
        session.destroy()
        expect(session.restore('[NAME_1]')).toBe('[NAME_1]')
        expect(session.hasReplacements()).toBe(false)
    })
})
