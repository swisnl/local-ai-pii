/**
 * Prompt configuration for Gemini Nano PII extraction.
 *
 * The system prompt is adapted from the existing server-side Dutch PII removal
 * prompt used in vragen.ai. Key nuance rules are preserved:
 *   - Do NOT redact generic roles (mijn moeder, een collega, een patiënt)
 *   - Do NOT redact age references without identity (een kind van 2 jaar)
 *   - Do NOT redact health information without identifying details
 *   - Do NOT redact hypothetical or general persons
 *   - Do NOT redact companies, organisations, or institutions
 *
 * User content is wrapped in delimiters (<<<GEBRUIKERSTEKST>>>) to mitigate
 * prompt injection attacks.
 */

export const SYSTEM_PROMPT = `Je bent een systeem dat persoonsgegevens (PII) detecteert in teksten.

Identificeer alleen PII wanneer de informatie alleen of in combinatie een specifieke echte persoon kan identificeren, zoals:
- Volledige namen van echte personen
- Exacte adressen en straatnamen
- Persoonlijke contactgegevens (e-mail, telefoonnummer)
- Postcodes (identificeren een specifieke straat of locatie)
- Burgerservicenummers (BSN)
- IBAN-nummers

Detecteer NIET:
- Generieke rollen of familierelaties (mijn baby, mijn moeder, een collega, een patiënt, de dokter)
- Leeftijdsaanduidingen zonder identiteit (een kind van 2 jaar, iemand van 65)
- Gezondheidsinformatie zonder identificerende details
- Hypothetische of algemene personen (iemand, een persoon, Jan Modaal)
- Bedrijven, organisaties of instellingen

Geef je antwoord als een JSON-array van gevonden PII-entiteiten.
Elke entiteit heeft een "type" (een van: NAAM, EMAIL, ADRES, POSTCODE, TELEFOON, BSN, IBAN) en een "value" (de exacte tekst).
Als er geen PII is gevonden, geef dan een lege array terug.`

/**
 * JSON Schema for the responseConstraint option of LanguageModel.prompt().
 * Forces the model to return a valid JSON array of PII entities.
 */
export const PII_EXTRACTION_SCHEMA = {
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

/**
 * Builds the initialPrompts array for LanguageModel.create().
 * Includes the system prompt and a Dutch few-shot example pair.
 *
 * The few-shot example anchors the model's output format for Dutch text,
 * reducing the chance of the model producing non-JSON or malformed output.
 *
 * @returns {{ role: string, content: string }[]}
 */
export function buildInitialPrompts() {
    return [
        {
            role: 'system',
            content: SYSTEM_PROMPT,
        },
        {
            role: 'user',
            content: buildUserMessage('Bel Jan de Vries op 06-12345678 of stuur een mail naar jan@voorbeeld.nl. Hij woont op Keizersgracht 1, 1015 CJ Amsterdam.'),
        },
        {
            role: 'assistant',
            content: JSON.stringify([
                { type: 'NAAM', value: 'Jan de Vries' },
                { type: 'TELEFOON', value: '06-12345678' },
                { type: 'EMAIL', value: 'jan@voorbeeld.nl' },
                { type: 'ADRES', value: 'Keizersgracht 1' },
                { type: 'POSTCODE', value: '1015 CJ' },
            ]),
        },
        {
            role: 'user',
            content: buildUserMessage('Mijn moeder heeft last van hoofdpijn. Ze is 62 jaar en gaat naar de huisarts.'),
        },
        {
            role: 'assistant',
            content: JSON.stringify([]),
        },
    ]
}

/**
 * Wraps user text in delimiters to mitigate prompt injection.
 * The LLM is instructed to analyse only what is between the delimiters.
 *
 * @param {string} text
 * @returns {string}
 */
export function buildUserMessage(text) {
    return `<<<GEBRUIKERSTEKST>>>\n${text}\n<<<EINDE_GEBRUIKERSTEKST>>>`
}

/**
 * Validates that a parsed LLM response is a well-formed array of PII entities.
 * Returns the valid entities; invalid entries are silently skipped.
 *
 * This guards against Gemini Nano's occasional non-compliance with the
 * 'required' keyword in JSON Schema, where required fields may be absent.
 *
 * @param {unknown} parsed
 * @returns {{ type: string, value: string }[]}
 */
export function validateEntities(parsed) {
    if (!Array.isArray(parsed)) return []
    const validTypes = new Set(PII_EXTRACTION_SCHEMA.items.properties.type.enum)
    return parsed.filter(
        entry =>
            entry !== null &&
            typeof entry === 'object' &&
            typeof entry.type === 'string' &&
            validTypes.has(entry.type) &&
            typeof entry.value === 'string' &&
            entry.value.length > 0
    )
}
