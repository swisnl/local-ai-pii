# chrome-local-ai-pii

Client-side PII redaction for Dutch text using the browser's built-in AI (Gemini Nano via `LanguageModel` API) with a regex fallback for structured patterns.

Intercepts questions before they leave the browser, replaces PII with numbered placeholder tokens, and transparently restores original values in server responses.

```
"Bel Jan de Vries op 06-12345678"
            ↓ redact()
"Bel [NAAM_1] op [TELEFOON_1]"   ← sent to server
            ↓ restore()
"Bel Jan de Vries op 06-12345678" ← shown to user
```

**[→ Live demo](https://bjorn.github.io/chrome-local-ai-pii/)**

---

## How it works

Detection runs in two passes:

1. **Regex pass** (always, synchronous) — catches structured PII with high precision: email addresses, Dutch phone numbers, postcodes, IBAN numbers, and BSN numbers.
2. **LLM pass** (when `LanguageModel` is available, async) — runs Gemini Nano on-device to catch contextual PII: full names and prose addresses that regex can't reliably detect.

The LLM pass uses `responseConstraint` (JSON Schema) to force structured output, and uses a Dutch system prompt adapted to the same nuance rules as the existing server-side PII filter.

When `LanguageModel` is unavailable (wrong browser, no GPU, no origin trial), the module falls back to regex-only silently — no errors, no UX disruption.

---

## Installation

```bash
npm install chrome-local-ai-pii
```

Or copy `src/` into your project — the module has zero runtime dependencies.

---

## Usage

```js
import { createPiiFilter } from 'chrome-local-ai-pii'

const filter = await createPiiFilter({
    onPiiFound: ({ replacements }) => {
        // replacements: [{ token: 'NAAM_1', type: 'naam' }, ...]
        // Original values are never included.
        showRedactionIndicator(replacements)
    },
})

// Before sending the question to the server:
const safeQuestion = await filter.redact(userQuestion)
sendToServer(safeQuestion)

// After receiving the server's answer:
const answer = filter.restore(serverAnswer)
displayToUser(answer)

// When the component is destroyed:
filter.destroy()
```

---

## API

### `createPiiFilter(options?)` → `Promise<PiiFilter>`

Creates a filter instance. Initialises the `LanguageModel` base session if the API is available.

| Option | Type | Default | Description |
|---|---|---|---|
| `categories` | `string[]` | all | PII types to detect. See [Categories](#categories). |
| `onPiiFound` | `function` | — | Called after redaction with `{ replacements: [{token, type}] }`. Never includes original values. |
| `signal` | `AbortSignal` | — | Cancels `LanguageModel` session initialisation. |

### `filter.redact(text)` → `Promise<string>`

Redacts PII from `text`. Returns the text with `[TYPE_N]` tokens in place of PII values.

Calls `onPiiFound` if any PII is found. Creates a fresh session for the upcoming `restore()` call.

### `filter.restore(text)` → `string`

Restores `[TYPE_N]` tokens in the server's response back to their original values. Best-effort: unrecognised tokens are left unchanged.

BSN tokens (`[BSN_1]` etc.) are stripped rather than restored (Dutch law, Wabb).

Clears the session map after restoration — original values are no longer held in memory.

### `filter.destroy()` → `void`

Clears all PII from memory, destroys the `LanguageModel` session, and removes the `beforeunload` listener. Call when the conversation component is unmounted.

---

## Categories

| Label | Token prefix | Detected by |
|---|---|---|
| `naam` | `NAAM` | LLM |
| `e-mail` | `EMAIL` | Regex |
| `telefoonnummer` | `TELEFOON` | Regex |
| `adres` | `ADRES` | LLM |
| `postcode` | `POSTCODE` | Regex |
| `BSN` | `BSN` | Regex + elfproef |
| `IBAN` | `IBAN` | Regex |

Pass a subset to `options.categories` to limit detection:

```js
const filter = await createPiiFilter({
    categories: ['naam', 'e-mail'],
})
```

---

## Integration with vragen.ai

```js
// Run.js — initialise once per conversation
import { createPiiFilter } from 'chrome-local-ai-pii'

const filter = await createPiiFilter({
    onPiiFound: ({ replacements }) => emit('pii-replaced', replacements),
})

// In startConversation() / startAgent() / fetchSearchResults():
const safeQuestion = await filter.redact(this.question)
endpointUrl.searchParams.set('question', safeQuestion)

// In the answer render path:
this.runState.answer = filter.restore(this.runState.answer)
```

---

## Chrome availability

| Context | Status |
|---|---|
| Chrome extensions (Chrome 138+) | ✅ Stable, no flags |
| Web pages (localhost) | ⚙️ `chrome://flags` — enable `#prompt-api-for-gemini-nano` and `#optimization-guide-on-device-model` |
| Web pages (production) | ⏳ Origin Trial expired March 2026 — check [developer.chrome.com/origintrials](https://developer.chrome.com/origintrials/) for a successor trial |

**Hardware requirements:** 22 GB free storage, GPU with >4 GB VRAM or 16 GB RAM.

The module degrades gracefully when `LanguageModel` is unavailable — regex detection still runs for all structured PII.

---

## Privacy & GDPR

- PII is processed entirely in the browser — it never reaches the server.
- The in-memory token map is **pseudonymised data** under GDPR. It remains subject to data protection obligations.
- Original values are held in a JavaScript `Map` in a private class field — never in `sessionStorage`, `localStorage`, or on `window`.
- The map is cleared automatically after `restore()` is called and on `beforeunload`.
- BSN values require a specific Dutch legal basis (Wabb) and are never restored in responses.
- Include client-side PII processing in your AVG register and privacy notice.

---

## Detection nuance

The LLM prompt preserves the same rules as the existing server-side Dutch PII filter:

**Not redacted:**
- Generic roles and family relations (`mijn moeder`, `een collega`, `een patiënt`)
- Age references without identity (`een kind van 2 jaar`)
- Health information without identifying details
- Hypothetical or general persons
- Companies, organisations, and institutions

---

## Development

```bash
npm install
npm test          # run tests once
npm run test:watch  # watch mode
```

Requires Node 20+.

---

## Licence

MIT
