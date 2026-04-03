---
title: Chrome Local AI PII Filter — ES Module
type: feat
status: active
date: 2026-04-03
origin: docs/brainstorms/2026-04-03-chrome-local-ai-pii-filter-requirements.md
---

# Chrome Local AI PII Filter — ES Module

## Overview

A zero-dependency, framework-agnostic JavaScript ES module that detects and redacts PII from Dutch-language text before it leaves the browser, using a hybrid approach: regex for structured PII (email, phone, postcodes, IBAN, BSN) and Chrome's built-in Gemini Nano (via `LanguageModel`) for contextual PII (names, prose addresses). Redacted text travels to the server with unique numbered tokens; answers from the server are transparently restored client-side.

## Problem Statement / Motivation

vragen.ai users may include PII in their questions. Currently, redaction happens server-side, meaning PII already travels over the wire. This module moves redaction to the browser so PII never leaves the device. The existing server-side Dutch prompt is adapted as the detection logic, providing identical nuance rules in the client-side context. (see origin: docs/brainstorms/2026-04-03-chrome-local-ai-pii-filter-requirements.md)

## ⚠️ Critical Constraint: Chrome Prompt API Web Availability

The Origin Trial for `LanguageModel` on web pages **expired March 24, 2026**. As of April 2026:

- **Chrome extensions**: stable on Chrome 138+, no flags required
- **Web pages (localhost)**: available via `chrome://flags` (`#prompt-api-for-gemini-nano` + `#optimization-guide-on-device-model`)
- **Web pages (production)**: **no current mechanism** — check [developer.chrome.com/origintrials](https://developer.chrome.com/origintrials/) for a successor trial or stable availability announcement

**Before shipping**: verify current availability status and decide whether to target extension context, await a new trial, or build for `chrome://flags` gated dev use only. The module's graceful fallback (regex-only) means it degrades cleanly and can be shipped without GA availability — PII protection is additive, not blocking.

## Proposed Solution

### Architecture: Hybrid Two-Pass Detection

```
User question text
      │
      ▼
┌─────────────────────────────┐
│  Pass 1: Regex layer        │  Catches: email, phone, BSN, IBAN,
│  (synchronous, always runs) │  Dutch postcode — high-precision,
└──────────────┬──────────────┘  no LLM needed
               │ text with tokens for structured PII
               ▼
┌─────────────────────────────┐
│  Pass 2: LanguageModel      │  Catches: names, prose addresses,
│  (async, degrades if N/A)   │  contextual PII — LLM extracts
└──────────────┬──────────────┘  JSON entities; JS does replacement
               │ fully redacted text
               ▼
      onPiiFound([{token, type}])   ← callback to host app
               │
               ▼
      redacted text sent to server
               │
      server responds
               │
               ▼
┌─────────────────────────────┐
│  restore(): regex sweep     │  Swaps [TYPE_N] tokens back to
│  over response text         │  originals via session Map
└──────────────┬──────────────┘  Best-effort: unknown tokens pass through
               │
               ▼
      User sees restored answer
```

### Public API

```js
// index.js
export async function createPiiFilter(options = {}) { ... }

// Returns:
{
  redact(text: string): Promise<string>,  // async — calls LanguageModel
  restore(text: string): string,          // sync  — Map lookup sweep
  destroy(): void,                        // sync  — clears Map + LLM session
}

// Options:
{
  categories: ['naam', 'e-mail', 'telefoon', 'adres'],  // all enabled by default
  onPiiFound: ({ replacements }) => void,  // [{token: 'NAAM_1', type: 'naam'}]
  signal: AbortSignal,                     // optional cancellation
}
```

### Token Format

Unique, numbered, uppercase Dutch labels with square-bracket delimiters:

| PII type | Token key | Example token |
|---|---|---|
| Person name | `NAAM` | `[NAAM_1]` |
| Email | `EMAIL` | `[EMAIL_1]` |
| Phone | `TELEFOON` | `[TELEFOON_1]` |
| Address | `ADRES` | `[ADRES_1]` |
| Dutch postcode | `POSTCODE` | `[POSTCODE_1]` |
| BSN | `BSN` | `[BSN_1]` |
| IBAN | `IBAN` | `[IBAN_1]` |

Same literal value → same token within a session (reverse lookup enforced).

### Session Map Lifecycle

One active session per `redact()`/`restore()` round-trip. The internal `PiiSession` class:
- Holds the token → original value Map in a private field (not on `window`, not in storage)
- Maintains a reverse Map (value → token) to guarantee consistent tokenization
- Calls `destroy()` automatically after `restore()` is called
- Also clears on `beforeunload` and on explicit `filter.destroy()` call

## File Layout

```
src/
  index.js          # public API: createPiiFilter() factory
  detector.js       # orchestrates regex + LanguageModel detection
  session.js        # PiiSession class: Map lifecycle, token minting
  prompt.js         # system prompt text, few-shot examples, JSON schema
  patterns.js       # Dutch regex patterns (email, phone, postcode, BSN, IBAN)
  categories.js     # token type constants and Dutch label mappings
tests/
  pii-filter.test.js   # integration tests: full redact→restore roundtrips
  detector.test.js     # detector unit tests (mock LanguageModel)
  session.test.js      # session Map, token minting, reverse lookup
  patterns.test.js     # regex coverage with Dutch PII fixtures
package.json
.gitignore
vitest.config.js
```

## Technical Considerations

### Chrome Prompt API Surface (resolved from research)

Use `LanguageModel` — the current stable global (Chrome 138+, extensions; web flags for localhost).

```js
// Availability check — call with same options as create()
const avail = await LanguageModel.availability({ expectedInputs: [{ type: 'text' }] });
// → "available" | "downloadable" | "downloading" | "unavailable"

// Base session (created once, cloned per request)
const baseSession = await LanguageModel.create({
  initialPrompts: [
    { role: 'system', content: SYSTEM_PROMPT },
    // Few-shot Dutch example pair:
    { role: 'user',      content: 'Tekst: "Bel Jan de Vries op 06-12345678."' },
    { role: 'assistant', content: '[{"type":"NAAM","value":"Jan de Vries"},{"type":"TELEFOON","value":"06-12345678"}]' },
  ],
});

// Per-request: clone → prompt with responseConstraint → destroy
async function extractEntities(text, baseSession) {
  const session = await baseSession.clone();
  try {
    const raw = await session.prompt(
      `Tekst: "${text}"`,
      { responseConstraint: PII_EXTRACTION_SCHEMA }
    );
    return JSON.parse(raw); // guaranteed valid per schema
  } finally {
    session.destroy();
  }
}
```

### JSON Schema for `responseConstraint`

```js
const PII_EXTRACTION_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['type', 'value'],
    additionalProperties: false,
    properties: {
      type: {
        type: 'string',
        enum: ['NAAM', 'EMAIL', 'ADRES', 'POSTCODE', 'TELEFOON', 'BSN', 'IBAN'],
      },
      value: { type: 'string' },
    },
  },
}
```

### One-Pass vs Two-Pass (resolved from research)

**Two-pass** with JS performing replacements:
- LLM extracts a JSON array of `{type, value}` entities
- JavaScript iterates entities (sorted longest-value-first to avoid partial match corruption) and replaces in the text
- This avoids asking the LLM to rewrite text, which introduces hallucination and structural changes

### Dutch Regex Patterns (`patterns.js`)

Always run before LLM — these are deterministic and high-precision:

```js
export const PATTERNS = {
  EMAIL:     /\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/gi,
  TELEFOON:  /\b(?:\+31|0031|0)[1-9]\d{7,8}\b/g,
  POSTCODE:  /\b[1-9]\d{3}\s?[A-Z]{2}\b/g,
  IBAN:      /\bNL\d{2}[A-Z]{4}\d{10}\b/gi,
  BSN:       /\b\d{9}\b/g,  // apply elfproef validation before redacting
}
```

**BSN note:** BSN processing requires specific Dutch legal basis (Wabb). The module redacts BSN tokens from transit but documents this as requiring AVG assessment by the host application. Do not restore BSN tokens in answers (strip `[BSN_1]` from server responses rather than restoring to original value).

### Prompt Engineering (`prompt.js`)

Adapt the existing server-side Dutch prompt. Key nuance rules to preserve:
- Do NOT redact: generic roles (`mijn moeder`, `een collega`, `een patiënt`), age without identity (`een kind van 2 jaar`), health info without identifying details, hypothetical persons, organisations

System prompt uses explicit delimiters around user content to mitigate prompt injection:
```
<<<GEBRUIKERSTEKST>>>
{user input here}
<<<EINDE_GEBRUIKERSTEKST>>>
```

Validate LLM JSON output against schema before consuming. If `JSON.parse()` throws, degrade to regex-only result for this request and `console.warn`.

### Graceful Degradation

```js
async function createPiiFilter(options = {}) {
  let baseSession = null
  let available = false

  try {
    const avail = await LanguageModel.availability({ expectedInputs: [{ type: 'text' }] })
    if (avail === 'available') {
      baseSession = await LanguageModel.create({ initialPrompts: buildInitialPrompts() })
      available = true
    } else {
      console.warn('[pii-filter] LanguageModel not available, falling back to regex-only')
    }
  } catch {
    console.warn('[pii-filter] LanguageModel.availability() threw, falling back to regex-only')
  }

  return { redact, restore, destroy }
}
```

### System-Wide Impact

**Interaction graph:** `filter.redact()` is called in the host app's question-submit path. In vragen.ai (`Run.js`), this wraps `this.question` before it is set as a URL query parameter in `startConversation()`, `startAgent()`, and `fetchSearchResults()`. `filter.restore()` is called in the answer-render path after SSE stream completion (`RunState.answer`).

**Error propagation:** Errors in the LLM layer are caught and logged; the original (non-redacted) text is returned. Errors in the regex layer are fatal (they represent a logic bug, not a runtime condition). The `onPiiFound` callback is wrapped in try/catch — a throwing callback must not break redaction.

**State lifecycle risks:** The session Map holds PII values. If `destroy()` is never called, values accumulate for the lifetime of the page. The module registers a `beforeunload` listener to call `destroy()` automatically as a safety net. After `restore()` is called, `destroy()` is invoked automatically — the Map has served its purpose.

**API surface parity:** This module has no server-side equivalent. The server-side redaction prompt (existing) operates on already-sent text and uses lossy `[naam verwijderd]` tags. This module is additive — it does not replace the server-side check, it prevents PII reaching the server in the first place.

## Acceptance Criteria

- [ ] `createPiiFilter()` returns `{ redact, restore, destroy }` with no thrown errors when called with default options
- [ ] `filter.redact('Bel Jan op jan@example.com')` returns text with `[NAAM_1]` and `[EMAIL_1]` substituted; `onPiiFound` is called with `[{token:'NAAM_1', type:'naam'}, {token:'EMAIL_1', type:'e-mail'}]`
- [ ] `filter.restore('Bedankt [NAAM_1]')` returns `'Bedankt Jan'` when `[NAAM_1]` is in the session Map
- [ ] `filter.restore('Bedankt [NAAM_99]')` returns `'Bedankt [NAAM_99]'` (unknown token passes through unchanged)
- [ ] When `LanguageModel` is unavailable, `redact()` still applies regex patterns, logs `console.warn`, and returns without throwing
- [ ] Same PII value appearing twice in one input produces the same token both times
- [ ] `filter.destroy()` clears the Map; subsequent `restore()` returns text unchanged
- [ ] `beforeunload` triggers `destroy()` automatically
- [ ] Original PII values are never included in the `onPiiFound` callback payload
- [ ] Module has zero `import` statements from external packages in production code
- [ ] BSN tokens (`[BSN_1]`) in answers are stripped (not restored) by `restore()`
- [ ] A throwing `onPiiFound` callback does not interrupt or abort the redaction

## Success Metrics (from origin doc)

- PII-containing questions reach the vragen.ai server with all configured PII replaced by tokens
- Host app receives `onPiiFound` with replacement types only (no originals)
- Answers containing tokens are restored before display — no visible `[TOKEN_N]` in final output
- Chrome Prompt API unavailability produces only a `console.warn` — no thrown errors, no UX disruption

## Dependencies & Risks

**Risk: Origin Trial expired** — the web page Prompt API trial ended March 2026. Production deployment to end-users on the web requires either a new trial registration or waiting for stable Chrome support. The regex-only fallback means the module ships and provides partial coverage regardless. Monitor [developer.chrome.com/origintrials](https://developer.chrome.com/origintrials/) for a successor trial.

**Risk: Gemini Nano Dutch language quality** — Dutch is not in the official supported languages list (English, Spanish, Japanese). Contextual NER quality for Dutch names and addresses may be lower than English. Mitigated by: (1) regex pre-filter handles all structured PII, (2) few-shot examples in the system prompt anchor Dutch NER behavior, (3) JSON schema constrains output shape. Plan for testing with Dutch fixtures.

**Risk: 6,144 token context limit** — very long questions (unlikely in a Q&A context) could exceed the model's context window. Mitigate by truncating inputs to ~4,000 characters before passing to LLM (with a `console.warn`). Regex still runs on the full text.

**Risk: `required` field non-compliance** — Gemini Nano sometimes omits required JSON Schema fields. Mitigate by validating parsed output and treating malformed responses as "no LLM entities found" (not as errors).

**GDPR/AVG:** The in-memory Map is pseudonymized personal data — it is not exempt from data protection obligations. The host application must include this processing in its AVG register and privacy notice. BSN requires specific legal basis — flag to vragen.ai team.

**Dependency:** `LanguageModel` availability requires Chrome 138+, 22 GB free storage, and suitable GPU/CPU. No action needed — the module detects and degrades.

## Implementation Phases

### Phase 1: Project Foundation

- Initialize `package.json` (`"type": "module"`, Node 20, Vitest dev-dep only)
- `vitest.config.js` with jsdom environment for browser API mocking
- `.gitignore` (node_modules, coverage)
- `src/categories.js` — Dutch token type constants and label mappings
- `src/patterns.js` — Dutch regex patterns with BSN elfproef validation helper
- `src/session.js` — `PiiSession` class: private Map fields, token minting, reverse lookup, explicit destroy
- Tests: `tests/session.test.js`, `tests/patterns.test.js` with Dutch PII fixtures

### Phase 2: Prompt Layer

- `src/prompt.js` — adapted Dutch system prompt, `buildInitialPrompts()`, `PII_EXTRACTION_SCHEMA`, few-shot Dutch example pair
- Verify prompt nuance rules match existing server-side logic (roles, age refs, health info, orgs)
- Tests: `tests/prompt.test.js` — validate schema shape, prompt string correctness

### Phase 3: Detector

- `src/detector.js` — `createDetector(options)`:
  - `LanguageModel.availability()` check on init
  - `LanguageModel.create()` with base session (system prompt + few-shot)
  - Per-request: `baseSession.clone()` → `prompt(text, {responseConstraint})` → `session.destroy()`
  - Two-pass logic: run regex pass first, then LLM on result, sort entities longest-first, JS replacement
  - JSON parse failure → degrade to regex-only, `console.warn`
  - Wrap user content in `<<<GEBRUIKERSTEKST>>>` delimiters
- Tests: `tests/detector.test.js` — mock `LanguageModel` with `vi.stubGlobal`, test regex+LLM paths, degradation

### Phase 4: Public API + Integration

- `src/index.js` — `createPiiFilter(options)` factory: wires detector + session + `onPiiFound` callback + `beforeunload` handler
- `filter.restore()` — regex sweep `[A-Z]+_\d+` against session Map, `?? match` fallback for unknown tokens, BSN stripping
- Integration tests: `tests/pii-filter.test.js` — full redact→restore roundtrips with Dutch fixtures
- Example integration snippet for vragen.ai `Run.js` (as a code comment in index.js)

## Integration Example (vragen.ai `Run.js`)

```js
// In Run.js — call once per conversation instance
import { createPiiFilter } from 'chrome-local-ai-pii'

const filter = await createPiiFilter({
  onPiiFound: ({ replacements }) => {
    // Render indicator in UI: "Naam en e-mailadres verwijderd"
    emit('pii-replaced', replacements)
  },
})

// In startConversation() / startAgent() / fetchSearchResults()
// Before: endpointUrl.searchParams.set('question', this.question)
// After:
const safeQuestion = await filter.redact(this.question)
endpointUrl.searchParams.set('question', safeQuestion)

// In onRunFinished() / where answer is rendered:
// Before: this.runState.answer
// After:
this.runState.answer = filter.restore(this.runState.answer)
```

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-03-chrome-local-ai-pii-filter-requirements.md](../brainstorms/2026-04-03-chrome-local-ai-pii-filter-requirements.md)
  - Key decisions carried forward: unique numbered tokens for round-trip restoration; `onPiiFound` exposes types only (not originals); graceful fail-open when Chrome AI unavailable

### External References

- [Chrome Prompt API — developer.chrome.com](https://developer.chrome.com/docs/ai/prompt-api)
- [Structured output (responseConstraint) — developer.chrome.com](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api)
- [Session management best practices — developer.chrome.com](https://developer.chrome.com/docs/ai/session-management)
- [Chrome Built-in AI hardware requirements](https://developer.chrome.com/docs/ai/get-started)
- [Origin Trials portal — check for Prompt API successor trial](https://developer.chrome.com/origintrials/)
- [OWASP LLM01:2025 — Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [Dutch AVG / BSN legal basis — Wabb](https://anonym.legal/blog/dutch-ap-avg-pii-detection-bsn-compliance-2025)
