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
        expect(redacted).toBe('Bel mij op [PHONE_1]')
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
        expect(replacements[0].token).toBe('[EMAIL_1]')
        expect(replacements[0].type).toBe('e-mail')
        expect(['regex', 'llm']).toContain(replacements[0].source)

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
        vi.stubGlobal('LanguageModel', mockLM([{ type: 'NAME', value: 'Jan de Vries' }]))

        const filter = await createPiiFilter()
        const redacted = await filter.redact('Bel Jan de Vries morgen.')
        expect(redacted).toBe('Bel [NAME_1] morgen.')
    })

    it('restores a name token in the answer', async () => {
        vi.stubGlobal('LanguageModel', mockLM([{ type: 'NAME', value: 'Jan de Vries' }]))

        const filter = await createPiiFilter()
        await filter.redact('Bel Jan de Vries morgen.')
        const restored = filter.restore('Bedankt, [NAME_1] wordt teruggebeld.')
        expect(restored).toBe('Bedankt, Jan de Vries wordt teruggebeld.')
    })
})

// ─── restore edge cases ───────────────────────────────────────────────────────

describe('createPiiFilter — restore edge cases', () => {
    beforeEach(() => stubUnavailableLM())

    it('leaves unknown tokens unchanged (best-effort)', async () => {
        const filter = await createPiiFilter()
        await filter.redact('Mail jan@example.com')
        const restored = filter.restore('Hallo [NAME_99]')
        expect(restored).toBe('Hallo [NAME_99]')
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

    it('only redacts configured categories (Dutch label)', async () => {
        const filter = await createPiiFilter({ categories: ['e-mail'] })

        // Phone is not in categories — should pass through
        const redacted = await filter.redact('Bel 0612345678 of mail jan@example.com')
        expect(redacted).toContain('[EMAIL_1]')
        expect(redacted).toContain('0612345678')
    })

    it('only redacts configured categories (canonical key)', async () => {
        const filter = await createPiiFilter({ categories: ['EMAIL'] })

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

// ─── language / locale switching ─────────────────────────────────────────────

describe('createPiiFilter — language option', () => {
    beforeEach(() => stubUnavailableLM())

    it('defaults to nl when no language is specified', async () => {
        const filter = await createPiiFilter()
        // Dutch phone pattern should match
        const redacted = await filter.redact('Bel 0612345678')
        expect(redacted).toBe('Bel [PHONE_1]')
    })

    it('uses English locale patterns with language: "en"', async () => {
        const filter = await createPiiFilter({ language: 'en' })
        // UK phone with country code
        const redacted = await filter.redact('Call +44 7700 900123')
        expect(redacted).toContain('[PHONE_1]')
    })

    it('en locale redacts a UK postcode', async () => {
        const filter = await createPiiFilter({ language: 'en' })
        const redacted = await filter.redact('Address: SW1A 2AA')
        expect(redacted).toContain('[POSTCODE_1]')
    })

    it('en locale returns English labels in onPiiFound', async () => {
        const onPiiFound = vi.fn()
        const filter = await createPiiFilter({ language: 'en', onPiiFound })
        await filter.redact('Email john@example.com please')
        expect(onPiiFound).toHaveBeenCalledOnce()
        const { replacements } = onPiiFound.mock.calls[0][0]
        expect(replacements[0].type).toBe('email')
    })

    it('nl locale returns Dutch labels in onPiiFound', async () => {
        const onPiiFound = vi.fn()
        const filter = await createPiiFilter({ language: 'nl', onPiiFound })
        await filter.redact('Mail jan@example.com')
        expect(onPiiFound).toHaveBeenCalledOnce()
        const { replacements } = onPiiFound.mock.calls[0][0]
        expect(replacements[0].type).toBe('e-mail')
    })

    it('en locale does not strip BSN tokens in restore()', async () => {
        const filter = await createPiiFilter({ language: 'en' })
        // Mint a BSN token manually via redact on a 9-digit number
        // (NL BSN pattern not in EN locale, so use LLM mock approach or email)
        // Instead test via restore directly: BSN tokens in EN are restored, not stripped
        await filter.redact('Mail john@example.com')
        // Inject a [BSN_1] token into the answer — EN locale should restore it, not strip it
        // Since no BSN was redacted, the token is unknown; it stays unchanged (best-effort)
        const result = filter.restore('Here is [BSN_1] info')
        expect(result).toBe('Here is [BSN_1] info')
    })

    it('categories option accepts canonical key with en locale', async () => {
        const filter = await createPiiFilter({ language: 'en', categories: ['EMAIL'] })
        const redacted = await filter.redact('Call +44 7700 900123 or email john@example.com')
        expect(redacted).toContain('[EMAIL_1]')
        // Phone not in active categories
        expect(redacted).toContain('+44 7700 900123')
    })

    it('categories option accepts English label with en locale', async () => {
        const filter = await createPiiFilter({ language: 'en', categories: ['email'] })
        const redacted = await filter.redact('Email john@example.com please')
        expect(redacted).toBe('Email [EMAIL_1] please')
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
