import { describe, it, expect } from 'vitest'
import {
    buildInitialPrompts,
    buildUserMessage,
    validateEntities,
    PII_EXTRACTION_SCHEMA,
    SYSTEM_PROMPT,
} from '../src/prompt.js'

describe('buildInitialPrompts', () => {
    it('returns an array with system as first entry', () => {
        const prompts = buildInitialPrompts()
        expect(prompts[0].role).toBe('system')
        expect(prompts[0].content).toBe(SYSTEM_PROMPT)
    })

    it('has an even number of user/assistant pairs after the system prompt', () => {
        const prompts = buildInitialPrompts()
        const rest = prompts.slice(1)
        expect(rest.length % 2).toBe(0)
        for (let i = 0; i < rest.length; i += 2) {
            expect(rest[i].role).toBe('user')
            expect(rest[i + 1].role).toBe('assistant')
        }
    })

    it('assistant entries are valid JSON arrays', () => {
        const prompts = buildInitialPrompts()
        const assistantEntries = prompts.filter(p => p.role === 'assistant')
        for (const entry of assistantEntries) {
            expect(() => JSON.parse(entry.content)).not.toThrow()
            expect(Array.isArray(JSON.parse(entry.content))).toBe(true)
        }
    })
})

describe('buildUserMessage', () => {
    it('wraps text in Dutch delimiters', () => {
        const msg = buildUserMessage('Hallo wereld')
        expect(msg).toContain('<<<GEBRUIKERSTEKST>>>')
        expect(msg).toContain('Hallo wereld')
        expect(msg).toContain('<<<EINDE_GEBRUIKERSTEKST>>>')
    })
})

describe('PII_EXTRACTION_SCHEMA', () => {
    it('is an array schema', () => {
        expect(PII_EXTRACTION_SCHEMA.type).toBe('array')
    })

    it('requires type and value on each item', () => {
        expect(PII_EXTRACTION_SCHEMA.items.required).toContain('type')
        expect(PII_EXTRACTION_SCHEMA.items.required).toContain('value')
    })

    it('accepts any non-empty string for type (no hardcoded enum)', () => {
        const typeProp = PII_EXTRACTION_SCHEMA.items.properties.type
        expect(typeProp.type).toBe('string')
        expect(typeProp.minLength).toBe(1)
        expect(typeProp.enum).toBeUndefined()
    })
})

describe('validateEntities', () => {
    it('accepts a valid array', () => {
        const input = [
            { type: 'NAME', value: 'Jan de Vries' },
            { type: 'EMAIL', value: 'jan@example.com' },
        ]
        expect(validateEntities(input)).toHaveLength(2)
    })

    it('returns empty array for non-array input', () => {
        expect(validateEntities(null)).toHaveLength(0)
        expect(validateEntities({ type: 'NAAM', value: 'Jan' })).toHaveLength(0)
        expect(validateEntities('string')).toHaveLength(0)
    })

    it('accepts entries with any non-empty type string', () => {
        const input = [
            { type: 'NAME', value: 'Jan' },
            { type: 'SOME_FUTURE_TYPE', value: 'something' },
        ]
        // validateEntities no longer rejects unknown types — the detector filters to active categories
        expect(validateEntities(input)).toHaveLength(2)
    })

    it('filters out entries with empty type', () => {
        const input = [{ type: '', value: 'Jan' }]
        expect(validateEntities(input)).toHaveLength(0)
    })

    it('filters out entries with missing value', () => {
        const input = [{ type: 'NAME' }, { type: 'EMAIL', value: '' }]
        expect(validateEntities(input)).toHaveLength(0)
    })

    it('filters out null entries in the array', () => {
        const input = [null, { type: 'NAME', value: 'Jan' }]
        expect(validateEntities(input)).toHaveLength(1)
    })
})
