---
date: 2026-04-03
topic: chrome-local-ai-pii-filter
---

# Chrome Local AI PII Filter Module

## Problem Frame

vragen.ai lets users ask questions to a site. Those questions may contain PII (names, emails, phone numbers, addresses) that should not reach the server. Currently, PII redaction happens server-side after the question is sent — meaning PII already travels over the wire. A client-side module using Chrome's built-in local AI (Prompt API / Gemini Nano) can intercept and redact PII before the question ever leaves the browser, keeping sensitive data local. Because the AI may echo back placeholder tokens in its answers, the module also restores original values in returned answers so the experience stays natural for the user.

The application and its users are Dutch-speaking, so detection must be tuned for Dutch language and Dutch-style PII (BSN, Dutch addresses, Dutch phone formats, etc.).

## Requirements

- R1. The module is a framework-agnostic ES module with a `createPiiFilter(options)` factory function. No framework dependencies.
- R2. The module uses Chrome's local Prompt API (Gemini Nano) to classify and redact PII. It must gracefully degrade when the API is unavailable — the question passes through unredacted and a warning is emitted. No user-visible disruption.
- R3. Before a question is sent, the module redacts PII by replacing it with unique numbered tokens (e.g., `[NAAM_1]`, `[EMAIL_1]`, `[TELEFOON_1]`, `[ADRES_1]`). Original values are stored in an in-memory session map keyed to the interaction.
- R4. The redaction prompt is adapted from the existing server-side PII prompt (Dutch language, Dutch placeholder conventions). It must preserve the same nuance rules: do NOT redact generic roles (`mijn moeder`, `een collega`), age references without identity, health info without identifying details, hypothetical persons, or organisations.
- R5. After redaction, the module emits a callback/event with the list of replacement types and tokens found — but **not** the original values (e.g., `[{ token: 'NAAM_1', type: 'naam' }]`). The host app uses this to show a local visual indicator to the user (e.g., "Naam en e-mailadres verwijderd").
- R6. When an answer is received from the server, the module performs best-effort restoration: any `[TOKEN_N]` patterns in the answer text are swapped back to the original values from the session map. If the AI paraphrased and dropped a token, no error is raised — the answer is returned as-is for those values.
- R7. The session map is scoped to a single question/answer round-trip and is discarded after restoration. No PII is persisted to storage.
- R8. Supported PII categories (configurable at init time, all enabled by default): names (`naam`), email addresses (`e-mail`), phone numbers (`telefoon`), physical addresses (`adres`).

## Success Criteria

- A question containing PII sent through the module reaches the server with all configured PII replaced by tokens.
- The host app receives a `onPiiFound` callback with replacement types (no originals) so it can render user-facing indicators.
- Answers containing tokens are transparently restored before display, with no visible tokens in the final output.
- When Chrome's Prompt API is unavailable, questions still go through and a `console.warn` is emitted — no errors thrown, no UX breakage.
- The module has no runtime dependencies and works as a plain ES module import.

## Scope Boundaries

- **Not in scope (v1):** Confirmation mode before sending (user approves each replacement) — flagged as a future setting.
- **Not in scope:** Real-time/on-type detection. Detection happens once, on submit.
- **Not in scope:** Persistence of replacement maps across sessions or page reloads.
- **Not in scope:** Restoration of answers where the AI paraphrased away the token — best-effort only.
- **Not in scope:** Server-side fallback when Chrome AI is unavailable.
- **Not in scope:** Non-Dutch language support in v1.

## Key Decisions

- **Unique numbered tokens over generic Dutch tags:** Using `[NAAM_1]` instead of `[naam verwijderd]` enables round-trip restoration, which is the key differentiator from the existing server-side approach.
- **Callback exposes types, not originals:** Keeps the host app free from needing to handle raw PII while still enabling rich UX indicators.
- **Graceful degradation over blocking:** Blocking submission when AI is unavailable would break the product for most users today given low Chrome AI availability. Fail open.
- **Session map discarded after restore:** Avoids any risk of PII accumulating in memory across interactions.

## Dependencies / Assumptions

- Chrome's Prompt API (Gemini Nano) must be available in the target browser for detection to run. Availability requires Chrome 127+ with the API enabled (Origin Trial or flag).
- The host application is responsible for: calling `redact()` before sending, calling `restore()` after receiving the answer, and rendering the `onPiiFound` indicators in its UI.
- The existing server-side prompt logic is the source of truth for what constitutes PII in this context.

## Outstanding Questions

### Resolve Before Planning
_(none — all product decisions resolved)_

### Deferred to Planning

- [Affects R2][Needs research] Which exact Chrome Prompt API surface to target — the API has evolved across Chrome versions (`window.ai.assistant`, `LanguageModel`, etc.). Pin to the most current stable Origin Trial shape.
- [Affects R1][Needs research] What is the exact integration point in vragen.ai — fetch interceptor, form submit handler, or SDK method? The module API should match that integration pattern.
- [Affects R3][Technical] Should the prompt request structured JSON output (`{ "text": "...", "replacements": [...] }`) in one pass, or run two prompts (detect then redact)? One-pass is faster but may be less reliable with smaller models.
- [Affects R7][Technical] Gemini Nano may struggle with the full nuance prompt. Plan for prompt simplification or few-shot examples if accuracy is low in testing.

## Next Steps

→ `/ce:plan` for structured implementation planning
