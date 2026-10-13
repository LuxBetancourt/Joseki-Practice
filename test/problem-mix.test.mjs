import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindWeight, orderKinds, addRecentKind, RECENT_KINDS_KEPT, seenKey, addSeen, SEEN_KEPT } from '../js/problem-mix.js'

test('a type gets more weight the longer since it came up', () => {
    const recent = ['next', 'shape', 'better', 'better', 'tenuki']
    assert.equal(kindWeight('tenuki', recent), 1, 'just came up')
    assert.ok(kindWeight('better', recent) > kindWeight('tenuki', recent))
    assert.ok(kindWeight('shape', recent) > kindWeight('better', recent))
    assert.ok(kindWeight('punish', recent) > kindWeight('next', recent), 'never came up counts as long ago')
})

test('the weight stops growing, so an old gap does not take over', () => {
    const recent = ['next', ...Array(40).fill('shape')]
    assert.equal(kindWeight('next', recent), kindWeight('punish', recent))
})

test('every enabled type is in the order, once', () => {
    const kinds = ['next', 'punish', 'shape', 'path', 'better', 'tenuki']
    for (let i = 0; i < 20; i++) {
        assert.deepEqual([...orderKinds(kinds, ['better'])].sort(), [...kinds].sort())
    }
})

test('over many problems, the mix evens out, and under-used types catch up', () => {
    const kinds = ['next', 'punish', 'shape', 'path', 'better', 'tenuki']
    // Start lopsided: lots of Who's Better?
    let recent = Array(20).fill('better')
    const counts = Object.fromEntries(kinds.map((kind) => [kind, 0]))
    let seed = 1
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 6000; i++) {
        const kind = orderKinds(kinds, recent, random)[0]
        counts[kind]++
        recent = addRecentKind(recent, kind)
    }
    for (const kind of kinds) { assert.ok(Math.abs(counts[kind] - 1000) < 80, `${kind}: ${counts[kind]}`) }
    // Back-to-back repeats are less likely than the 1 in 6 of a plain random pick
    let repeats = 0
    recent = []
    for (let i = 0; i < 6000; i++) {
        const kind = orderKinds(kinds, recent, random)[0]
        if (kind === recent.at(-1)) { repeats++ }
        recent = addRecentKind(recent, kind)
    }
    assert.ok(repeats / 6000 < 0.12, `repeats ${repeats}`)
})

test('the recent list keeps only the last few', () => {
    let recent = []
    for (let i = 0; i < 50; i++) { recent = addRecentKind(recent, i % 2 ? 'next' : 'shape') }
    assert.equal(recent.length, RECENT_KINDS_KEPT)
    assert.equal(recent.at(-1), 'next')
})

test('seen problems: keyed by type and position, newest last, and only the last few kept', () => {
    assert.equal(seenKey('next', ['pd', 'qf']), 'next:pdqf')
    assert.notEqual(seenKey('next', ['pd', 'qf']), seenKey('shape', ['pd', 'qf']))
    let seen = addSeen(addSeen([], 'a'), 'b')
    assert.deepEqual(addSeen(seen, 'a'), ['b', 'a'], 'seeing one again moves it to the end')
    for (let i = 0; i < SEEN_KEPT + 20; i++) { seen = addSeen(seen, `p${i}`) }
    assert.equal(seen.length, SEEN_KEPT)
    assert.ok(!seen.includes('a'))
})
