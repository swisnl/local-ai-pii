import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDetector } from '../src/detector.js'
import { PiiSession } from '../src/session.js'
import { nl } from '../src/locales/nl.js'

// Helper: create a mintToken function backed by a real PiiSession
function makeSession() {
    const session = new PiiSession()
    return {
        mintToken: (key, value) => session.getOrCreateToken(key, value),
        session,
    }
}

// Helper: build a mock LanguageModel that returns the given entities JSON
function mockLanguageModel(entities = []) {
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

describe('createDetector — regex-only (no LanguageModel)', () => {
    beforeEach(() => {
        vi.stubGlobal('LanguageModel', undefined)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('redacts an email address without LLM', async () => {
        const detector = await createDetector({ locale: nl, activeKeys: new Set(['EMAIL']) })
        const { mintToken } = makeSession()

        const result = await detector.detect('Stuur naar jan@example.com', mintToken, undefined)

        expect(result.text).toBe('Stuur naar [EMAIL_1]')
        expect(result.entities).toHaveLength(1)
        expect(result.entities[0].type).toBe('EMAIL')
    })

    it('redacts a Dutch phone number', async () => {
        const detector = await createDetector({ locale: nl, activeKeys: new Set(['PHONE']) })
        const { mintToken } = makeSession()

        const result = await detector.detect('Bel 0612345678', mintToken, undefined)
        expect(result.text).toBe('Bel [PHONE_1]')
    })

    it('returns unchanged text when no PII found', async () => {
        const detector = await createDetector({ locale: nl, activeKeys: new Set(['EMAIL']) })
        const { mintToken } = makeSession()

        const result = await detector.detect('Geen PII hier', mintToken, undefined)
        expect(result.text).toBe('Geen PII hier')
        expect(result.entities).toHaveLength(0)
    })

    it('returns unchanged text for empty input', async () => {
        const detector = await createDetector({ locale: nl, activeKeys: new Set(['EMAIL']) })
        const { mintToken } = makeSession()

        const result = await detector.detect('', mintToken, undefined)
        expect(result.text).toBe('')
    })

    it('applies the same token for the same value appearing twice', async () => {
        const detector = await createDetector({ locale: nl, activeKeys: new Set(['EMAIL']) })
        const { mintToken } = makeSession()

        const result = await detector.detect(
            'Mail jan@example.com of nogmaals jan@example.com',
            mintToken,
            undefined
        )
        expect(result.text).toBe('Mail [EMAIL_1] of nogmaals [EMAIL_1]')
    })
})

describe('createDetector — with mocked LanguageModel', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('uses LLM entities for contextual PII like names', async () => {
        vi.stubGlobal('LanguageModel', mockLanguageModel([
            { type: 'NAME', value: 'Jan de Vries' },
        ]))

        const detector = await createDetector({ locale: nl, activeKeys: new Set(['NAME', 'EMAIL']) })
        const { mintToken } = makeSession()

        const result = await detector.detect('Bel Jan de Vries morgen.', mintToken, undefined)
        expect(result.text).toBe('Bel [NAME_1] morgen.')
    })

    it('combines regex and LLM results', async () => {
        vi.stubGlobal('LanguageModel', mockLanguageModel([
            { type: 'NAME', value: 'Jan de Vries' },
        ]))

        const detector = await createDetector({ locale: nl, activeKeys: new Set(['NAME', 'EMAIL']) })
        const { mintToken } = makeSession()

        const result = await detector.detect(
            'Bel Jan de Vries op jan@example.com',
            mintToken,
            undefined
        )
        expect(result.text).toContain('[NAME_1]')
        expect(result.text).toContain('[EMAIL_1]')
    })

    it('degrades gracefully when LLM prompt throws', async () => {
        const lm = mockLanguageModel()
        lm.create = vi.fn().mockResolvedValue({
            clone: vi.fn().mockResolvedValue({
                prompt: vi.fn().mockRejectedValue(new Error('model error')),
                destroy: vi.fn(),
            }),
            destroy: vi.fn(),
        })
        vi.stubGlobal('LanguageModel', lm)

        const detector = await createDetector({ locale: nl, activeKeys: new Set(['EMAIL', 'NAME']) })
        const { mintToken } = makeSession()

        // Should still redact email via regex; NAME silently skipped
        const result = await detector.detect(
            'Schrijf Jan op jan@example.com',
            mintToken,
            undefined
        )
        expect(result.text).toContain('[EMAIL_1]')
        expect(result.text).not.toContain('jan@example.com')
    })

    it('skips LLM entities that are not in activeKeys', async () => {
        vi.stubGlobal('LanguageModel', mockLanguageModel([
            { type: 'NAME', value: 'Jan de Vries' },
            { type: 'ADDRESS', value: 'Keizersgracht 1' },
        ]))

        // Only NAME is active — ADDRESS should not be redacted
        const detector = await createDetector({ locale: nl, activeKeys: new Set(['NAME']) })
        const { mintToken } = makeSession()

        const result = await detector.detect(
            'Jan de Vries woont op Keizersgracht 1',
            mintToken,
            undefined
        )
        expect(result.text).toContain('[NAME_1]')
        expect(result.text).toContain('Keizersgracht 1')
    })

    it('does not create a nested token when LLM returns an existing token as a value', async () => {
        // Regex replaces a postcode → [POSTCODE_1]. The LLM sees "[POSTCODE_1]" in the text
        // and echoes it back as an entity value. Gemini Nano may strip the brackets
        // and return "POSTCODE_1" instead of "[POSTCODE_1]". Both must be ignored.
        vi.stubGlobal('LanguageModel', mockLanguageModel([
            { type: 'NAME', value: 'Jan de Vries' },
            { type: 'POSTCODE', value: 'POSTCODE_1' }, // Gemini Nano strips brackets
        ]))

        const detector = await createDetector({ locale: nl, activeKeys: new Set(['NAME', 'POSTCODE']) })
        const { mintToken, session } = makeSession()

        const result = await detector.detect(
            'Jan de Vries woont in 1015 CJ',
            mintToken,
            undefined
        )
        // [POSTCODE_1] should be in the text, NOT [POSTCODE_2]
        expect(result.text).not.toContain('[POSTCODE_2]')
        expect(result.text).toContain('[POSTCODE_1]')
        // Restoring should give back the real postcode, not a token string
        expect(session.restore(result.text)).not.toContain('[POSTCODE_1]')
        expect(session.restore(result.text)).toContain('1015 CJ')
    })

    it('does not double-redact a value already caught by regex', async () => {
        // LLM also claims the email that regex already caught
        vi.stubGlobal('LanguageModel', mockLanguageModel([
            { type: 'EMAIL', value: 'jan@example.com' },
        ]))

        const detector = await createDetector({ locale: nl, activeKeys: new Set(['EMAIL']) })
        const { mintToken } = makeSession()

        const result = await detector.detect('Mail jan@example.com', mintToken, undefined)
        // Should appear exactly once as [EMAIL_1], not twice
        expect(result.text).toBe('Mail [EMAIL_1]')
        expect((result.text.match(/\[EMAIL_1\]/g) ?? []).length).toBe(1)
    })
})

describe('createDetector — LanguageModel unavailable', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('warns and continues when availability returns "unavailable"', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.stubGlobal('LanguageModel', {
            availability: vi.fn().mockResolvedValue('unavailable'),
            create: vi.fn(),
        })

        const detector = await createDetector({ locale: nl, activeKeys: new Set(['EMAIL']) })
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unavailable'))

        const { mintToken } = makeSession()
        const result = await detector.detect('Mail jan@example.com', mintToken, undefined)
        expect(result.text).toBe('Mail [EMAIL_1]')

        warnSpy.mockRestore()
    })

    it('warns and continues when LanguageModel.availability throws', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.stubGlobal('LanguageModel', {
            availability: vi.fn().mockRejectedValue(new Error('not supported')),
        })

        const detector = await createDetector({ locale: nl, activeKeys: new Set(['EMAIL']) })
        expect(warnSpy).toHaveBeenCalled()

        warnSpy.mockRestore()
    })
})
