import { EMAIL_PATTERN, isValidBsn } from './shared.js'

/**
 * Dutch (nl) locale for local-ai-pii.
 *
 * Contains everything language-specific for Dutch PII detection:
 * system prompt, few-shot examples, regex patterns, display labels,
 * and the set of token keys that are stripped (not restored) in answers.
 */
export const nl = {
    code: 'nl',

    systemPrompt: `Je bent een systeem dat persoonsgegevens (PII) detecteert in teksten.

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
Elke entiteit heeft een "type" (een van: NAME, EMAIL, ADDRESS, POSTCODE, PHONE, BSN, IBAN) en een "value" (de exacte tekst).
Als er geen PII is gevonden, geef dan een lege array terug.`,

    buildFewShot() {
        return [
            {
                role: 'user',
                content: this.buildUserMessage('Bel Jan de Vries op 06-12345678 of stuur een mail naar jan@voorbeeld.nl. Hij woont op Keizersgracht 1, 1015 CJ Amsterdam.'),
            },
            {
                role: 'assistant',
                content: JSON.stringify([
                    { type: 'NAME', value: 'Jan de Vries' },
                    { type: 'PHONE', value: '06-12345678' },
                    { type: 'EMAIL', value: 'jan@voorbeeld.nl' },
                    { type: 'ADDRESS', value: 'Keizersgracht 1' },
                    { type: 'POSTCODE', value: '1015 CJ' },
                ]),
            },
            {
                role: 'user',
                content: this.buildUserMessage('Mijn moeder heeft last van hoofdpijn. Ze is 62 jaar en gaat naar de huisarts.'),
            },
            {
                role: 'assistant',
                content: JSON.stringify([]),
            },
        ]
    },

    buildUserMessage(text) {
        return `<<<GEBRUIKERSTEKST>>>\n${text}\n<<<EINDE_GEBRUIKERSTEKST>>>`
    },

    /**
     * Locale-specific regex patterns.
     * EMAIL is shared and added by the detector.
     */
    patterns: {
        // Dutch phone: +31, 0031, or local 0 prefix with optional separators.
        // (?<!\d) / (?!\d) instead of \b because \b fails before '+' (non-word char).
        PHONE: /(?<!\d)(?:(?:\+31|0031)[\s-]?[1-9]|0[1-9])(?:[\s-]?\d){7,8}(?!\d)/g,

        // Dutch postcode: 4 digits, optional space, 2 uppercase letters (e.g. 2517 KJ or 2517KJ)
        POSTCODE: /\b[1-9]\d{3}\s?[A-Z]{2}\b/g,

        // Dutch IBAN
        IBAN: /\bNL\d{2}[A-Z]{4}\d{10}\b/gi,

        // BSN: exactly 9 digits (validated with elfproef before redacting)
        BSN: /\b\d{9}\b/g,
    },

    /**
     * Custom match filter per pattern key.
     * Return false to discard a match; return true to keep it.
     */
    matchFilter: {
        BSN: (value) => isValidBsn(value),
    },

    /** Display labels for each canonical key in Dutch */
    labels: {
        NAME:     'naam',
        EMAIL:    'e-mail',
        PHONE:    'telefoonnummer',
        ADDRESS:  'adres',
        POSTCODE: 'postcode',
        BSN:      'BSN',
        IBAN:     'IBAN',
    },

    /**
     * Token keys that are stripped (not restored) in answers.
     * BSN is never echoed back per Dutch law (Wabb).
     */
    nonRestorableKeys: new Set(['BSN']),
}

// Re-export shared EMAIL pattern so locale consumers can access it
export { EMAIL_PATTERN }
