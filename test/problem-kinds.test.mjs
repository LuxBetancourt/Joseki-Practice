import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PROBLEM_KINDS, KINDS } from '../js/problem-kinds.js'
import { GENERATORS, encodeProblem, decodeProblem } from '../js/problems.js'
import { BLACK } from '../js/go.js'

// Everything a problem type needs outside problem-kinds.js (see the list at its top)

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const plain = (text) => text.replace(/[‘’]/g, "'")

test('every problem type has a generator, and every generator a type', () => {
    assert.deepEqual(Object.keys(GENERATORS).sort(), [...KINDS].sort())
})

test('every problem type has its checkbox, its color and its place on the About page', () => {
    const page = read('index.html')
    const css = read('index.css')
    const about = plain(read('about.html'))
    for (const kind of KINDS) {
        assert.match(page, new RegExp(`data-problem-type="${kind}"`), `${kind}: checkbox in index.html`)
        assert.match(css, new RegExp(`\\[data-kind="${kind}"\\]`), `${kind}: color in index.css`)
        assert.ok(about.includes(`<strong>${plain(PROBLEM_KINDS[kind].name)}</strong>`), `${kind}: entry on about.html`)
    }
})

test('every problem type is described fully, and link letters are single and unique', () => {
    const codes = KINDS.map((kind) => PROBLEM_KINDS[kind].code)
    assert.equal(new Set(codes).size, codes.length)
    for (const kind of KINDS) {
        const { name, goal, code, answeredBy, choices } = PROBLEM_KINDS[kind]
        assert.ok(name && goal, kind)
        assert.match(code, /^[a-z]$/, kind)
        assert.ok(['move', 'line', 'cards', 'buttons'].includes(answeredBy), kind)
        assert.equal(Boolean(choices), answeredBy === 'buttons', `${kind}: buttons need choices, and only they do`)
    }
})

test('a link to each problem type opens as that type', () => {
    for (const kind of KINDS) {
        // The smallest data each type's link needs (see compactData)
        const data = { shape: { answer: 'qc' }, path: { options: [{ line: [{}], mistake: { step: 0, move: 'qc' } }] } }[kind] || {}
        const decoded = decodeProblem(encodeProblem({ kind, moves: ['pd', 'qf'], color: BLACK, data }))
        assert.equal(decoded.kind, kind)
        assert.deepEqual(decoded.moves, ['pd', 'qf'])
    }
})
