/**
 * chrome-local-ai-pii
 *
 * Client-side PII redaction for Dutch text using Chrome's built-in Gemini Nano.
 *
 * Usage (vragen.ai Run.js integration example):
 *
 *   import { createPiiFilter } from 'chrome-local-ai-pii'
 *
 *   const filter = await createPiiFilter({
 *     onPiiFound: ({ replacements }) => {
 *       // replacements: [{ token: 'NAAM_1', type: 'naam' }, ...]
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
 *   - BSN tokens are stripped (not restored) in answers per Dutch law (Wabb)
 *   - Include client-side PII processing in your AVG register and privacy notice
 */

import { createDetector } from './detector.js'
import { PiiSession } from './session.js'
import { resolveActiveKeys } from './categories.js'

/**
 * Creates a PII filter instance.
 *
 * @param {object} [options]
 * @param {string[]} [options.categories]
 *   PII categories to detect. Defaults to all: ['naam', 'e-mail', 'telefoonnummer', 'adres', 'postcode', 'BSN', 'IBAN'].
 *   Pass a subset to limit detection (e.g. ['naam', 'e-mail']).
 * @param {(payload: { replacements: { token: string, type: string }[] }) => void} [options.onPiiFound]
 *   Called after redaction with a list of { token, type } pairs. Original values are never included.
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
    const { categories, onPiiFound, signal } = options
    const activeKeys = resolveActiveKeys(categories)

    const detector = await createDetector({ activeKeys, signal })
    let currentSession = new PiiSession()

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
        currentSession = new PiiSession()

        const { text: redacted } = await detector.detect(
            text,
            (key, value) => currentSession.getOrCreateToken(key, value),
            signal
        )

        if (currentSession.hasReplacements()) {
            try {
                onPiiFound?.({ replacements: currentSession.getReplacements() })
            } catch (err) {
                console.warn('[pii-filter] onPiiFound callback threw an error', err)
            }
        }

        return redacted
    }

    /**
     * Restores [TYPE_N] tokens in the server's answer back to their original values.
     * Best-effort: unknown tokens are left as-is.
     * BSN tokens are stripped (replaced with empty string) per Dutch law.
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
