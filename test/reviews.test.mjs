import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ReviewDeck, reviewKey } from '../js/reviews.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A deck with in-memory storage and a controllable clock. */
function makeDeck(store = new Map()) {
    const clock = { now: 1_000_000 }
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
    const deck = new ReviewDeck({ storage, now: () => clock.now })
    return { deck, clock, store }
}

const spec = (moves, kind = 'next', color = 1, data = {}) => ({ kind, moves, color, data })
const ALL = { kinds: ['next', 'punish', 'shape', 'path'], color: 1, startMoves: [] }

test('a missed problem comes back after five minutes', () => {
    const { deck, clock } = makeDeck()
    deck.recordMiss(spec(['pd', 'qf', 'nc']))
    assert.equal(deck.size, 1)
    clock.now += 5 * MINUTE - 1
    assert.equal(deck.due(ALL).length, 0)
    clock.now += 1
    assert.equal(deck.due(ALL).length, 1)
})

test('correct reviews step through 1 hour, 1 day, 1 week, 1 month, 1 year', () => {
    const { deck, clock } = makeDeck()
    const { key } = deck.recordMiss(spec(['pd', 'qf', 'nc']))
    for (const wait of [HOUR, DAY, 7 * DAY, 30 * DAY, 365 * DAY, 365 * DAY]) {
        const item = deck.recordSuccess(key)
        assert.equal(item.due - clock.now, wait)
        clock.now += wait - 1
        assert.equal(deck.due(ALL).length, 0, 'not due early')
        clock.now += 1
        assert.equal(deck.due(ALL).length, 1)
    }
})

test('a miss sends a problem back to five minutes', () => {
    const { deck, clock } = makeDeck()
    const { key } = deck.recordMiss(spec(['pd', 'qf', 'nc']))
    deck.recordSuccess(key)
    deck.recordSuccess(key)
    const item = deck.recordMiss(spec(['pd', 'qf', 'nc']))
    assert.equal(item.due - clock.now, 5 * MINUTE)
    assert.equal(item.lapses, 2)
    assert.equal(deck.size, 1, 'the same problem is not added twice')
    assert.equal(deck.recordSuccess(key).due - clock.now, HOUR, 'and climbs the steps again')
})

test('due reviews only match the current settings', () => {
    const { deck, clock } = makeDeck()
    deck.recordMiss(spec(['pd', 'qf', 'nc'], 'next', 1))
    deck.recordMiss(spec(['pd', 'qc', 'pc'], 'punish', 1))
    deck.recordMiss(spec(['qd', 'od', 'oc'], 'next', 1))
    deck.recordMiss(spec(['pd', 'qf', 'nc', 'qc'], 'next', 2))
    clock.now += 5 * MINUTE

    assert.equal(deck.due(ALL).length, 3, 'black problems of any kind')
    assert.equal(deck.due({ ...ALL, color: 2 }).length, 1)
    assert.equal(deck.due({ ...ALL, kinds: ['punish'] }).length, 1)
    assert.equal(deck.due({ ...ALL, startMoves: ['pd'] }).length, 2, 'only those under the 4-4')
    assert.equal(deck.due({ ...ALL, startMoves: ['pd', 'qf'] }).length, 1)
})

test('the most overdue review comes first', () => {
    const { deck, clock } = makeDeck()
    deck.recordMiss(spec(['pd', 'qf', 'nc']))
    clock.now += MINUTE
    deck.recordMiss(spec(['qd', 'od', 'oc']))
    clock.now += 20 * MINUTE
    assert.deepEqual(deck.due(ALL).map((item) => item.moves[0]), ['pd', 'qd'])
})

test('the deck persists in storage', () => {
    const { deck, store } = makeDeck()
    deck.recordMiss(spec(['pd', 'qf', 'nc'], 'shape', 1, { answer: 'qc', line: [{ move: 'qc', color: 1 }] }))
    const reloaded = makeDeck(store).deck
    assert.equal(reloaded.size, 1)
    assert.deepEqual(reloaded.items[0].data.line, [{ move: 'qc', color: 1 }])
    reloaded.clear()
    assert.equal(makeDeck(store).deck.size, 0)
})

test('shape problems with different targets are different reviews', () => {
    assert.notEqual(reviewKey(spec(['pd'], 'shape', 1, { answer: 'qc' })), reviewKey(spec(['pd'], 'shape', 1, { answer: 'nc' })))
    assert.equal(reviewKey(spec(['pd'], 'next')), reviewKey(spec(['pd'], 'next')))
})
