import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSource, describeCitation } from '../js/sources.js'
import { parseComment } from '../js/text.js'

test('books are named, with their page and Sensei’s Library link', () => {
    assert.deepEqual(describeSource(['sps', 'p. 141']),
        { title: 'Star Point Joseki', detail: 'p. 141', url: 'https://senseis.xmp.net/?StarPointJoseki' })
    assert.equal(describeSource(['nm', '']).url, null, 'no Sensei’s Library page')
})

test('professionals are named, with Josekipedia’s note', () => {
    assert.deepEqual(describeSource(['player28', 'Modern proponent from 2000-01', 'Yamashita Keigo']),
        { title: 'Yamashita Keigo', detail: 'Modern proponent from 2000-01', url: null })
})

test('unknown or malformed sources are left out', () => {
    for (const bad of [['zzz', ''], ['player1', 'note', ''], [], null, 'dobj']) {
        assert.equal(describeSource(bad), null, JSON.stringify(bad))
    }
})

test('books cited inside comments', () => {
    assert.deepEqual(describeCitation('dobj, p. 12'), describeSource(['dobj', 'p. 12']))
    const segments = parseComment('As in [src:38bj].')
    assert.deepEqual(segments[1], { type: 'source', ...describeSource(['38bj', '']) })
    assert.equal(parseComment('[src:nope]')[0].text, '[src:nope]', 'unknown codes stay as written')
})
