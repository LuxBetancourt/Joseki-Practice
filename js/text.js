// Cleaning and parsing of Josekipedia comment text. Pure functions, no DOM.

import { displayToSgf, sgfToDisplay } from './go.js'
import { describeCitation } from './sources.js'

// Windows-1252 code points for bytes 0x80-0x9F (bytes undefined in cp1252 map to themselves).
const CP1252_HIGH = [
    0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
    0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
]
const CP1252_TO_BYTE = new Map(CP1252_HIGH.map((codePoint, i) => [codePoint, 0x80 + i]))

/**
 * Much of Josekipedia's text is UTF-8 that was decoded as Windows-1252 and re-encoded
 * (e.g. "3â€“3" instead of "3–3"). Reverse that when the whole string round-trips cleanly.
 */
export function fixMojibake(text) {
    if (!/[À-ÿ]/.test(text)) { return text }

    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; ++i) {
        const code = text.charCodeAt(i)
        if (code < 0x80 || (code >= 0xA0 && code <= 0xFF)) {
            bytes[i] = code
        }
        else if (CP1252_TO_BYTE.has(code)) {
            bytes[i] = CP1252_TO_BYTE.get(code)
        }
        else {
            return text // Contains characters that can't come from cp1252, so it isn't mojibake
        }
    }

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    catch {
        return text
    }
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            const codePoint = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
            try { return String.fromCodePoint(codePoint) }
            catch { return match }
        }
        return NAMED_ENTITIES[entity.toLowerCase()] ?? match
    })
}

export const capitalize = (text) => text[0].toUpperCase() + text.slice(1)

export const cleanText = (text) => decodeEntities(fixMojibake(text || '')).trim()

/** Splits a path like "pdqfqh" into ["pd", "qf", "qh"]. */
export function splitPath(path) {
    return path.match(/[a-t]{2}/g) || []
}

/**
 * Parses a comment into segments so it can be rendered without innerHTML:
 *   { type: 'text', text }
 *   { type: 'path', path, label }   from "[path:pdqfqh]"
 *   { type: 'coord', coord, label } from "[q16]"
 *   { type: 'url', url }            from bare http(s) links
 */
export function parseComment(raw) {
    const text = cleanText(raw)
    const segments = []
    const pattern = /\[path:([a-t]+)\]|\[([a-hj-t]\d{1,2})\]|(https?:\/\/[^\s<>"\])]+)|\[src:([\w\s,.]+)\]/gi
    let last = 0
    let match

    const pushText = (s) => { if (s) { segments.push({ type: 'text', text: s }) } }

    while ((match = pattern.exec(text))) {
        pushText(text.slice(last, match.index))
        last = pattern.lastIndex

        if (match[1]) {
            const moves = splitPath(match[1].toLowerCase())
            segments.push({ type: 'path', path: moves.join(''), label: moves.map(sgfToDisplay).join(' ') })
        }
        else if (match[4]) {
            // A book cited inline: shown by its title (see sources.js)
            const source = describeCitation(match[4])
            if (source) { segments.push({ type: 'source', ...source }) }
            else { pushText(match[0]) }
        }
        else if (match[2]) {
            const coord = displayToSgf(match[2])
            if (coord) {
                segments.push({ type: 'coord', coord, label: match[2].toUpperCase() })
            }
            else {
                pushText(match[0])
            }
        }
        else {
            // Don't swallow sentence punctuation that follows a link
            const url = match[3].replace(/[.,;:!?]+$/, '')
            segments.push({ type: 'url', url })
            last -= match[3].length - url.length
        }
    }
    pushText(text.slice(last))
    return segments
}
