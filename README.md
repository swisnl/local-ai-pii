# local-ai-pii

Client-side PII redaction using the browser's built-in AI (Gemini Nano via `LanguageModel` API) with a regex fallback for structured patterns.

Supports Dutch (`nl`) and English (`en`). Intercepts questions before they leave the browser, replaces PII with numbered placeholder tokens, and transparently restores original values in server responses.

```
"Call Jane Smith on +44 7700 900123"
              ↓ redact()
"Call [NAME_1] on [PHONE_1]"   ← sent to server
              ↓ restore()
"Call Jane Smith on +44 7700 900123"  ← shown to user
```

**[→ Live demo](https://swisnl.github.io/local-ai-pii/)**

---

## How it works

Detection runs in two passes:

1. **Regex pass** (always, synchronous) — catches structured PII with high precision: email addresses, phone numbers, postcodes, IBAN numbers, and BSN numbers (Dutch only).
2. **LLM pass** (when `LanguageModel` is available, async) — runs Gemini Nano on-device to catch contextual PII: full names and prose addresses that regex can't reliably detect.

The LLM pass uses `responseConstraint` (JSON Schema) to force structured output and a locale-specific system prompt adapted to the same nuance rules as the existing server-side PII filter.

When `LanguageModel` is unavailable (wrong browser, no GPU, no origin trial), the module falls back to regex-only silently — no errors, no UX disruption.

---

## Installation

```bash
npm install local-ai-pii
```

Or copy `src/` into your project — the module has zero runtime dependencies.

---

## Usage

```js
import { createPiiFilter } from 'local-ai-pii'

const filter = await createPiiFilter({
    language: 'en',   // 'nl' | 'en', default: 'nl'
    onPiiFound: ({ replacements }) => {
        // replacements: [{ token: '[NAME_1]', type: 'name', source: 'regex' }, ...]
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
| `language` | `'nl' \| 'en'` | `'nl'` | Locale for detection patterns, prompts, and labels. |
| `categories` | `string[]` | all | PII types to detect. Accepts canonical keys (`'NAME'`) or locale labels (`'naam'`, `'name'`). See [Categories](#categories). |
| `onPiiFound` | `function` | — | Called after redaction with `{ replacements: [{token, type, source}] }`. Never includes original values. `source` is `'regex'` or `'llm'`. |
| `onDownloadProgress` | `function` | — | Called during model download with `{ loaded, total }` in bytes. |
| `signal` | `AbortSignal` | — | Cancels `LanguageModel` session initialisation. |

### `filter.redact(text)` → `Promise<string>`

Redacts PII from `text`. Returns the text with `[TYPE_N]` tokens in place of PII values.

Calls `onPiiFound` if any PII is found. Creates a fresh session for the upcoming `restore()` call.

### `filter.restore(text)` → `string`

Restores `[TYPE_N]` tokens in the server's response back to their original values. Best-effort: unrecognised tokens are left unchanged.

In Dutch mode (`language: 'nl'`), BSN tokens (`[BSN_1]` etc.) are stripped rather than restored per Dutch law (Wabb).

Clears the session map after restoration — original values are no longer held in memory.

### `filter.destroy()` → `void`

Clears all PII from memory, destroys the `LanguageModel` session, and removes the `beforeunload` listener. Call when the conversation component is unmounted.

---

## Categories

Token keys are language-neutral. Labels and which categories are active vary by locale.

### Dutch (`language: 'nl'`)

| Label | Canonical key | Token format | Detected by |
|---|---|---|---|
| `naam` | `NAME` | `[NAME_N]` | LLM |
| `e-mail` | `EMAIL` | `[EMAIL_N]` | Regex |
| `telefoonnummer` | `PHONE` | `[PHONE_N]` | Regex |
| `adres` | `ADDRESS` | `[ADDRESS_N]` | LLM |
| `postcode` | `POSTCODE` | `[POSTCODE_N]` | Regex |
| `BSN` | `BSN` | `[BSN_N]` | Regex + elfproef |
| `IBAN` | `IBAN` | `[IBAN_N]` | Regex |

BSN tokens are stripped (not restored) in `restore()` — Dutch law (Wabb) requires this.

### English (`language: 'en'`)

| Label | Canonical key | Token format | Detected by |
|---|---|---|---|
| `name` | `NAME` | `[NAME_N]` | LLM |
| `email` | `EMAIL` | `[EMAIL_N]` | Regex |
| `phone` | `PHONE` | `[PHONE_N]` | Regex (broad international pattern) |
| `address` | `ADDRESS` | `[ADDRESS_N]` | LLM |
| `postcode` | `POSTCODE` | `[POSTCODE_N]` | Regex (UK + US ZIP) |
| `IBAN` | `IBAN` | `[IBAN_N]` | Regex (any country) |

Pass a subset to `options.categories` to limit detection. Both canonical keys and locale labels are accepted:

```js
// Dutch mode — Dutch label
const filter = await createPiiFilter({ language: 'nl', categories: ['naam', 'e-mail'] })

// English mode — English label
const filter = await createPiiFilter({ language: 'en', categories: ['name', 'email'] })

// Either mode — canonical key (language-neutral)
const filter = await createPiiFilter({ categories: ['NAME', 'EMAIL'] })
```

---

## Integration with vragen.ai

```js
// Run.js — initialise once per conversation
import { createPiiFilter } from 'local-ai-pii'

const filter = await createPiiFilter({
    language: 'nl',
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
- In Dutch mode, BSN values require a specific legal basis (Wabb) and are never restored in responses.
- Include client-side PII processing in your AVG register and privacy notice.

---

## Detection nuance

The LLM prompt preserves the same nuance rules in both locales:

**Not redacted:**
- Generic roles and family relations (`my mother`, `a colleague`, `a patient` / `mijn moeder`, `een collega`)
- Age references without identity (`a 2-year-old child` / `een kind van 2 jaar`)
- Health information without identifying details
- Hypothetical or general persons (`John Doe`, `Jane Smith` / `Jan Modaal`)
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
