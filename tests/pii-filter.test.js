import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPiiFilter } from '../src/index.js'

// Mock LanguageModel that returns the given entities
function mockLM(entities = []) {
    return {
        availability: vi.fn().mockResolvedValue('available'),
        create: vi.fn().mockResolvedValue({
            clone: vi.fn().mockResolvedValue({
                prompt: vi.fn().mockResolvedValue(JSON.stringify(entities)),
                destroy: vi.fn(),
            }),
            destroy: vi.fn(),
        }),
    }
}

function stubUnavailableLM() {
    vi.stubGlobal('LanguageModel', undefined)
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

// ─── Basic redact / restore roundtrip ────────────────────────────────────────

describe('createPiiFilter — regex redaction roundtrip', () => {
    beforeEach(() => stubUnavailableLM())

    it('redacts an email and restores it in the answer', async () => {
        const filter = await createPiiFilter()

        const redacted = await filter.redact('Stuur naar jan@example.com alsjeblieft')
        expect(redacted).toBe('Stuur naar [EMAIL_1] alsjeblieft')
        expect(redacted).not.toContain('jan@example.com')

        const restored = filter.restore('Wij sturen een bevestiging naar [EMAIL_1]')
        expect(restored).toBe('Wij sturen een bevestiging naar jan@example.com')
    })

    it('redacts a Dutch phone number', async () => {
        const filter = await createPiiFilter()
        const redacted = await filter.redact('Bel mij op 0612345678')
        expect(redacted).toBe('Bel mij op [TELEFOON_1]')
    })

    it('redacts a Dutch postcode', async () => {
        const filter = await createPiiFilter()
        const redacted = await filter.redact('Ik woon in 2517 KJ')
        expect(redacted).toBe('Ik woon in [POSTCODE_1]')
    })

    it('redacts a Dutch IBAN', async () => {
        const filter = await createPiiFilter()
        const redacted = await filter.redact('Rekeningnummer NL91ABNA0417164300')
        expect(redacted).toBe('Rekeningnummer [IBAN_1]')
    })

    it('passes through text with no PII unchanged', async () => {
        const filter = await createPiiFilter()
        const redacted = await filter.redact('Hoe laat is het?')
        expect(redacted).toBe('Hoe laat is het?')
    })

    it('uses the same token for the same value appearing twice', async () => {
        const filter = await createPiiFilter()
        const redacted = await filter.redact('Mail jan@example.com of jan@example.com')
        expect(redacted).toBe('Mail [EMAIL_1] of [EMAIL_1]')
    })
})

// ─── onPiiFound callback ──────────────────────────────────────────────────────

describe('createPiiFilter — onPiiFound callback', () => {
    beforeEach(() => stubUnavailableLM())

    it('calls onPiiFound with replacement types only (no original values)', async () => {
        const onPiiFound = vi.fn()
        const filter = await createPiiFilter({ onPiiFound })

        await filter.redact('Mail jan@example.com')

        expect(onPiiFound).toHaveBeenCalledOnce()
        const { replacements } = onPiiFound.mock.calls[0][0]
        expect(replacements).toContainEqual({ token: '[EMAIL_1]', type: 'e-mail' })

        // Verify original value is not in the payload
        expect(JSON.stringify(replacements)).not.toContain('jan@example.com')
    })

    it('does not call onPiiFound when no PII is found', async () => {
        const onPiiFound = vi.fn()
        const filter = await createPiiFilter({ onPiiFound })

        await filter.redact('Geen PII aanwezig')
        expect(onPiiFound).not.toHaveBeenCalled()
    })

    it('does not let a throwing onPiiFound break the redaction', async () => {
        const filter = await createPiiFilter({
            onPiiFound: () => { throw new Error('UI crashed') },
        })

        // Should not throw; redacted text should still be returned
        await expect(filter.redact('Mail jan@example.com')).resolves.toBe('Mail [EMAIL_1]')
    })
})

// ─── LLM integration ─────────────────────────────────────────────────────────

describe('createPiiFilter — LLM name detection', () => {
    it('redacts a name found by the LLM', async () => {
        vi.stubGlobal('LanguageModel', mockLM([{ type: 'NAAM', value: 'Jan de Vries' }]))

        const filter = await createPiiFilter()
        const redacted = await filter.redact('Bel Jan de Vries morgen.')
        expect(redacted).toBe('Bel [NAAM_1] morgen.')
    })

    it('restores a name token in the answer', async () => {
        vi.stubGlobal('LanguageModel', mockLM([{ type: 'NAAM', value: 'Jan de Vries' }]))

        const filter = await createPiiFilter()
        await filter.redact('Bel Jan de Vries morgen.')
        const restored = filter.restore('Bedankt, [NAAM_1] wordt teruggebeld.')
        expect(restored).toBe('Bedankt, Jan de Vries wordt teruggebeld.')
    })
})

// ─── restore edge cases ───────────────────────────────────────────────────────

describe('createPiiFilter — restore edge cases', () => {
    beforeEach(() => stubUnavailableLM())

    it('leaves unknown tokens unchanged (best-effort)', async () => {
        const filter = await createPiiFilter()
        await filter.redact('Mail jan@example.com')
        const restored = filter.restore('Hallo [NAAM_99]')
        expect(restored).toBe('Hallo [NAAM_99]')
    })

    it('strips BSN tokens in answers instead of restoring them', async () => {
        const filter = await createPiiFilter()
        await filter.redact('Mijn BSN is 111222333')
        const restored = filter.restore('Uw BSN [BSN_1] is geregistreerd.')
        expect(restored).toBe('Uw BSN  is geregistreerd.')
        expect(restored).not.toContain('111222333')
    })

    it('returns the answer unchanged when restore() is called with no active session', async () => {
        const filter = await createPiiFilter()
        // No redact() call — session is fresh, map is empty
        const result = filter.restore('Hallo [EMAIL_1]')
        expect(result).toBe('Hallo [EMAIL_1]')
    })
})

// ─── category filtering ───────────────────────────────────────────────────────

describe('createPiiFilter — category filtering', () => {
    beforeEach(() => stubUnavailableLM())

    it('only redacts configured categories', async () => {
        const filter = await createPiiFilter({ categories: ['e-mail'] })

        // Phone is not in categories — should pass through
        const redacted = await filter.redact('Bel 0612345678 of mail jan@example.com')
        expect(redacted).toContain('[EMAIL_1]')
        expect(redacted).toContain('0612345678')
    })
})

// ─── destroy ─────────────────────────────────────────────────────────────────

describe('createPiiFilter — destroy', () => {
    beforeEach(() => stubUnavailableLM())

    it('clears the session map so subsequent restore() returns tokens unchanged', async () => {
        const filter = await createPiiFilter()
        await filter.redact('Mail jan@example.com')
        filter.destroy()

        const result = filter.restore('[EMAIL_1] is uw adres')
        expect(result).toBe('[EMAIL_1] is uw adres')
    })
})

// ─── graceful degradation ─────────────────────────────────────────────────────

describe('createPiiFilter — graceful degradation', () => {
    it('falls back to regex-only without throwing when LanguageModel is unavailable', async () => {
        vi.stubGlobal('LanguageModel', {
            availability: vi.fn().mockResolvedValue('unavailable'),
            create: vi.fn(),
        })

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const filter = await createPiiFilter()

        // Should still work via regex
        const redacted = await filter.redact('Mail jan@example.com')
        expect(redacted).toBe('Mail [EMAIL_1]')
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unavailable'))
    })
})
