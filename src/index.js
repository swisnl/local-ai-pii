/**
 * local-ai-pii
 *
 * Client-side PII redaction using Chrome's built-in Gemini Nano.
 * Supports Dutch ('nl', default) and English ('en').
 *
 * Usage (vragen.ai Run.js integration example):
 *
 *   import { createPiiFilter } from 'local-ai-pii'
 *
 *   const filter = await createPiiFilter({
 *     language: 'nl',  // 'nl' | 'en', default: 'nl'
 *     onPiiFound: ({ replacements }) => {
 *       // replacements: [{ token: '[NAME_1]', type: 'naam', source: 'regex' }, ...]
 *       // Original values are never included — safe to pass to UI layer
 *       emit('pii-replaced', replacements)
 *     },
 *   })
 *
 *   // Before sending question (in startConversation / startAgent / fetchSearchResults):
 *   const safeQuestion = await filter.redact(this.question)
 *   endpointUrl.searchParams.set('question', safeQuestion)
 *
 *   // After receiving answer (in onRunFinished / answer render path):
 *   this.runState.answer = filter.restore(this.runState.answer)
 *
 *   // Clean up when the conversation component is destroyed:
 *   filter.destroy()
 *
 * Privacy notes (GDPR/AVG):
 *   - PII is stored only in memory (never in sessionStorage, localStorage, or window)
 *   - The in-memory map is pseudonymised data — it remains subject to GDPR obligations
 *   - The map is cleared automatically after restore() and on beforeunload
 *   - BSN tokens are stripped (not restored) in NL mode per Dutch law (Wabb)
 *   - Include client-side PII processing in your AVG register and privacy notice
 */

import { createDetector } from './detector.js'
import { PiiSession } from './session.js'
import { resolveActiveKeys, CATEGORIES } from './categories.js'
import { nl } from './locales/nl.js'
import { en } from './locales/en.js'

const LOCALES = { nl, en }

/**
 * Creates a PII filter instance.
 *
 * @param {object} [options]
 * @param {'nl' | 'en'} [options.language]
 *   Language locale to use for detection. Defaults to 'nl' (Dutch) for backward compatibility.
 * @param {string[]} [options.categories]
 *   PII categories to detect. Accepts canonical keys ('NAME', 'EMAIL') or locale labels ('naam', 'e-mail').
 *   Defaults to all categories for the selected locale.
 * @param {(payload: { replacements: { token: string, type: string, source: string }[] }) => void} [options.onPiiFound]
 *   Called after redaction with a list of { token, type, source } pairs. Original values are never included.
 *   source is 'regex' for pattern-matched PII or 'llm' for contextual detections via Gemini Nano.
 * @param {(progress: { loaded: number, total: number }) => void} [options.onDownloadProgress]
 *   Called during Gemini Nano model download with bytes loaded and total.
 *   Only fires when the model needs to be downloaded (LanguageModel availability: "downloadable" or "downloading").
 * @param {AbortSignal} [options.signal]
 *   Optional AbortSignal to cancel the LanguageModel session initialisation.
 *
 * @returns {Promise<{
 *   redact: (text: string) => Promise<string>,
 *   restore: (text: string) => string,
 *   destroy: () => void,
 * }>}
 */
export async function createPiiFilter(options = {}) {
    const { language = 'nl', categories, onPiiFound, onDownloadProgress, signal } = options

    const locale = LOCALES[language] ?? nl
    // Build label→key map from the locale's labels so resolveActiveKeys can accept them
    const localeLabels = Object.fromEntries(
        Object.entries(locale.labels).map(([key, label]) => [label, key])
    )
    const activeKeys = resolveActiveKeys(categories, localeLabels)

    const detector = await createDetector({ locale, activeKeys, signal, onDownloadProgress })
    let currentSession = new PiiSession(locale.nonRestorableKeys)

    // Safety net: clear PII from memory when the page unloads.
    // This is a fallback — callers should invoke destroy() explicitly.
    function handleBeforeUnload() {
        currentSession.destroy()
        detector.destroy()
    }
    globalThis.addEventListener?.('beforeunload', handleBeforeUnload)

    /**
     * Redacts PII from the given text before it is sent to the server.
     *
     * Creates a fresh session for each call. The session holds the token→value
     * map for the subsequent restore() call. Calling redact() before restore()
     * has completed will overwrite the session — do not call concurrently.
     *
     * @param {string} text
     * @returns {Promise<string>} — the redacted text with [TYPE_N] tokens
     */
    async function redact(text) {
        // Reset session for this round-trip
        currentSession.destroy()
        currentSession = new PiiSession(locale.nonRestorableKeys)

        const { text: redacted, entities } = await detector.detect(
            text,
            (key, value) => currentSession.getOrCreateToken(key, value),
            signal
        )

        if (currentSession.hasReplacements()) {
            // Build replacements from the entities list so we can include source (regex/llm).
            // Deduplicate by token — the same value may appear multiple times in entities.
            const seen = new Set()
            const replacements = []
            for (const entity of entities) {
                const token = currentSession.getToken(entity.value)
                if (!token || seen.has(token)) continue
                seen.add(token)
                const label = locale.labels[entity.type] ?? entity.type.toLowerCase()
                replacements.push({ token, type: label, source: entity.source })
            }
            try {
                onPiiFound?.({ replacements })
            } catch (err) {
                console.warn('[pii-filter] onPiiFound callback threw an error', err)
            }
        }

        return redacted
    }

    /**
     * Restores [TYPE_N] tokens in the server's answer back to their original values.
     * Best-effort: unknown tokens are left as-is.
     * Tokens in locale.nonRestorableKeys are stripped (e.g. BSN in Dutch mode).
     *
     * The session is cleared after restoration — original values are no longer
     * needed once the answer has been processed.
     *
     * @param {string} text
     * @returns {string}
     */
    function restore(text) {
        const restored = currentSession.restore(text)
        currentSession.destroy()
        return restored
    }

    /**
     * Destroys the filter: clears all PII from memory, destroys the LanguageModel
     * session, and removes the beforeunload listener.
     *
     * Call this when the host component is unmounted / the conversation ends.
     */
    function destroy() {
        currentSession.destroy()
        detector.destroy()
        globalThis.removeEventListener?.('beforeunload', handleBeforeUnload)
    }

    return { redact, restore, destroy }
}
