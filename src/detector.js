import { PATTERNS, findMatches } from './patterns.js'
import { buildInitialPrompts, buildUserMessage, PII_EXTRACTION_SCHEMA, validateEntities } from './prompt.js'
import { CATEGORIES } from './categories.js'

/**
 * Maximum number of characters passed to the LLM.
 * Gemini Nano has a 6,144 token context window; the system prompt + few-shot
 * examples consume roughly 500-600 tokens, leaving ~4,000 tokens for user text.
 * At ~4 chars/token this corresponds to ~4,000 characters — we use 3,500 to be safe.
 */
const MAX_LLM_CHARS = 3500

/**
 * Creates a detector that orchestrates the hybrid two-pass PII detection:
 *   Pass 1 (sync)  — regex patterns for structured PII (email, phone, postcode, IBAN, BSN)
 *   Pass 2 (async) — Gemini Nano via LanguageModel for contextual PII (names, prose addresses)
 *
 * The detector is created once per createPiiFilter() call. Internally it holds a
 * single "base session" that is cloned for each detection request, keeping the
 * model context stateless across calls.
 *
 * @param {{ activeKeys: Set<string>, signal?: AbortSignal }} options
 * @returns {Promise<{ detect: (text: string) => Promise<{ text: string, entities: { type: string, value: string }[] }> }>}
 */
export async function createDetector({ activeKeys, signal } = {}) {
    let baseSession = null

    // Attempt to initialise the LanguageModel base session.
    // If unavailable (wrong browser, no GPU, OT expired), we degrade to regex-only.
    try {
        const LM = globalThis.LanguageModel
        if (LM && typeof LM.availability === 'function') {
            const avail = await LM.availability({ expectedInputs: [{ type: 'text' }] })
            if (avail === 'available') {
                baseSession = await LM.create({
                    initialPrompts: buildInitialPrompts(),
                    signal,
                })
            } else {
                console.warn(`[pii-filter] LanguageModel availability: "${avail}" — falling back to regex-only detection`)
            }
        } else {
            console.warn('[pii-filter] LanguageModel API not found — falling back to regex-only detection')
        }
    } catch (err) {
        console.warn('[pii-filter] LanguageModel initialisation failed — falling back to regex-only detection', err)
    }

    /**
     * Applies the regex pass to the text.
     * Returns the redacted text and a list of detected entities.
     * Only processes categories present in activeKeys.
     *
     * Entities are sorted longest-value-first before replacement to prevent
     * shorter substrings being tokenised first and corrupting longer matches.
     *
     * @param {string} text
     * @param {(categoryKey: string, value: string) => string} mintToken
     * @returns {{ text: string, entities: { type: string, value: string }[] }}
     */
    function applyRegexPass(text, mintToken) {
        const entities = []

        // Collect all regex matches across active categories
        for (const key of Object.keys(PATTERNS)) {
            if (activeKeys && !activeKeys.has(key)) continue
            const matches = findMatches(key, text)
            for (const match of matches) {
                entities.push({ type: key, value: match.value, source: 'regex' })
            }
        }

        // Sort longest-first to avoid partial-match corruption
        entities.sort((a, b) => b.value.length - a.value.length)

        // Deduplicate by value (same value → same token)
        const seen = new Set()
        let redacted = text
        for (const entity of entities) {
            if (seen.has(entity.value)) continue
            seen.add(entity.value)
            const token = mintToken(entity.type, entity.value)
            redacted = redacted.split(entity.value).join(token)
        }

        return { text: redacted, entities }
    }

    /**
     * Calls the LanguageModel with a clone of the base session.
     * The clone is destroyed after the prompt completes (whether success or failure).
     *
     * Returns an array of validated PII entities, or an empty array on failure.
     *
     * @param {string} text — text to analyse (already partially redacted by regex pass)
     * @param {AbortSignal | undefined} requestSignal
     * @returns {Promise<{ type: string, value: string }[]>}
     */
    async function callLanguageModel(text, requestSignal) {
        const truncated = text.length > MAX_LLM_CHARS
            ? (console.warn(`[pii-filter] Input truncated from ${text.length} to ${MAX_LLM_CHARS} chars for LLM pass`), text.slice(0, MAX_LLM_CHARS))
            : text

        const session = await baseSession.clone()
        try {
            const raw = await session.prompt(buildUserMessage(truncated), {
                responseConstraint: PII_EXTRACTION_SCHEMA,
                signal: requestSignal,
            })
            return validateEntities(JSON.parse(raw))
        } catch (err) {
            console.warn('[pii-filter] LLM extraction failed, using regex-only result', err)
            return []
        } finally {
            session.destroy()
        }
    }

    /**
     * Runs the full two-pass detection on the given text.
     *
     * @param {string} text — original user input
     * @param {(categoryKey: string, value: string) => string} mintToken — session token factory
     * @param {AbortSignal | undefined} requestSignal
     * @returns {Promise<{ text: string, entities: { type: string, value: string }[] }>}
     */
    async function detect(text, mintToken, requestSignal) {
        if (!text || text.trim().length === 0) {
            return { text, entities: [] }
        }

        // Pass 1: synchronous regex layer
        const { text: afterRegex, entities: regexEntities } = applyRegexPass(text, mintToken)

        // Pass 2: LLM layer (skipped if base session could not be created)
        let llmEntities = []
        if (baseSession) {
            llmEntities = await callLanguageModel(afterRegex, requestSignal)
        }

        // Apply LLM-found entities to the already-regex-redacted text.
        // Filter to active categories; sort longest-first.
        const activeCategories = new Set(Object.keys(CATEGORIES))
        const filteredLlm = llmEntities
            .filter(e => (!activeKeys || activeKeys.has(e.type)) && activeCategories.has(e.type))
            .sort((a, b) => b.value.length - a.value.length)

        let finalText = afterRegex
        const seenValues = new Set(regexEntities.map(e => e.value))

        for (const entity of filteredLlm) {
            if (seenValues.has(entity.value)) continue
            // Only replace if the value still appears in the text (not already caught by regex)
            if (!finalText.includes(entity.value)) continue
            seenValues.add(entity.value)
            const token = mintToken(entity.type, entity.value)
            finalText = finalText.split(entity.value).join(token)
        }

        const usedLlmEntities = filteredLlm
            .filter(e => seenValues.has(e.value))
            .map(e => ({ ...e, source: 'llm' }))

        return {
            text: finalText,
            entities: [...regexEntities, ...usedLlmEntities],
        }
    }

    return {
        detect,
        destroy() {
            baseSession?.destroy()
            baseSession = null
        },
    }
}
