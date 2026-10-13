import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixMojibake, decodeEntities, cleanText, parseComment, splitPath } from '../js/text.js'

test('fixes UTF-8 text that was mis-decoded as Windows-1252', () => {
    assert.equal(fixMojibake('3â€“3 invasion'), '3–3 invasion')
    // Japanese, including bytes undefined in cp1252 (0x8F, 0x81) which survive as C1 controls
    assert.equal(fixMojibake('å\u008f—ã\u0081‘'), '受け')
})

test('leaves correct text alone', () => {
    assert.equal(fixMojibake('Plain ASCII'), 'Plain ASCII')
    assert.equal(fixMojibake('Café'), 'Café') // "é" alone isn't valid UTF-8 mojibake
    assert.equal(fixMojibake('受け'), '受け')
})

test('decodes HTML entities', () => {
    assert.equal(decodeEntities('the &#39;kick&#39; &amp; &lt;b&gt; &#x41;'), "the 'kick' & <b> A")
    assert.equal(decodeEntities('&bogus;'), '&bogus;')
})

test('cleanText trims and handles missing input', () => {
    assert.equal(cleanText(undefined), '')
    assert.equal(cleanText('  hi  '), 'hi')
})

test('splitPath', () => {
    assert.deepEqual(splitPath('pdqfttqh'), ['pd', 'qf', 'tt', 'qh'])
})

test('parses links, coordinates and urls into segments', () => {
    const segments = parseComment('As for [path:pdqfpj], see [q16] or https://example.com/x.')
    assert.deepEqual(segments, [
        { type: 'text', text: 'As for ' },
        { type: 'path', path: 'pdqfpj', label: 'Q16 R14 Q10' },
        { type: 'text', text: ', see ' },
        { type: 'coord', coord: 'pd', label: 'Q16' },
        { type: 'text', text: ' or ' },
        { type: 'url', url: 'https://example.com/x' },
        { type: 'text', text: '.' },
    ])
})

test('HTML in comments stays text', () => {
    assert.deepEqual(parseComment('<img src=x onerror=alert(1)>'), [{ type: 'text', text: '<img src=x onerror=alert(1)>' }])
})
