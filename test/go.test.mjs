import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Position, IllegalMoveError, BLACK, WHITE, EMPTY, fromSgf, toSgf, sgfToDisplay, displayToSgf, orient, unorient, orientSgf } from '../js/go.js'

/** Plays a sequence of SGF moves ("tt" = pass), alternating colors from black. */
const play = (moves, position = new Position()) =>
    moves.split(' ').filter(Boolean).reduce((p, m) => p.playSgf(m), position)

const illegalReason = (fn) => {
    try { fn() }
    catch (e) {
        assert.ok(e instanceof IllegalMoveError)
        return e.reason
    }
    assert.fail('expected an illegal move')
}

test('coordinate conversions', () => {
    assert.deepEqual(fromSgf('pd'), { x: 15, y: 3 })
    assert.equal(toSgf(15, 3), 'pd')
    assert.equal(fromSgf('tt'), null)
    assert.equal(fromSgf('zz'), null)
    assert.equal(sgfToDisplay('pd'), 'Q16')
    assert.equal(sgfToDisplay('aa'), 'A19')
    assert.equal(sgfToDisplay('ss'), 'T1')
    assert.equal(sgfToDisplay('tt'), 'Pass')
    assert.equal(displayToSgf('q16'), 'pd')
    assert.equal(displayToSgf('J10'), 'ij')
    assert.equal(displayToSgf('I5'), null)
    assert.equal(displayToSgf('A20'), null)
})

test('stones alternate colors and passes switch turns', () => {
    const p = play('pd dd tt')
    assert.equal(p.at(15, 3), BLACK)
    assert.equal(p.at(3, 3), WHITE)
    assert.equal(p.toPlay, WHITE)
})

test('occupied points are illegal', () => {
    assert.equal(illegalReason(() => play('pd pd')), 'occupied')
})

test('captures a single stone in the corner', () => {
    // White at A19 (aa), black surrounds at B19 (ba) and A18 (ab)
    const p = play('ba aa ab')
    assert.equal(p.at(0, 0), EMPTY)
    assert.equal(p.captures[BLACK], 1)
})

test('captures a multi-stone group', () => {
    // White stones at aa, ba; black at ab, bb, ca
    const p = play('ab aa bb ba ca')
    assert.equal(p.at(0, 0), EMPTY)
    assert.equal(p.at(1, 0), EMPTY)
    assert.equal(p.captures[BLACK], 2)
})

test('suicide is illegal, including filling your own last liberty', () => {
    // Single-stone suicide: white surrounds aa, black plays there
    assert.equal(illegalReason(() => play('tt ba tt ab aa')), 'suicide')

    // Black: ab, bb, ba  White: ac, bc, cb, ca  -> the black group's only liberty is aa.
    // Black playing aa touches its own group but leaves it with no liberties.
    const p = play('ab ac bb bc ba cb tt ca')
    assert.equal(p.toPlay, BLACK)
    assert.equal(illegalReason(() => p.playSgf('aa')), 'suicide')
})

test('capturing move is legal even with no liberties before the capture', () => {
    // White: aa, bb, ac   Black: ba, ad, bc
    // Black ab is surrounded by white stones, but it captures aa (whose last liberty was ab), so it's legal.
    const p = play('ba aa ad bb bc ac tt tt')
    assert.equal(p.toPlay, BLACK)
    const after = p.playSgf('ab')
    assert.equal(after.at(0, 0), EMPTY)
})

test('simple ko is enforced and can be retaken after a move elsewhere', () => {
    //   . B W .
    //   B W . W
    //   . B W .
    // Black stones: (1,0),(0,1),(1,2)  White: (2,0),(3,1),(2,2),(1,1)
    // Black captures at (2,1), creating ko.
    let p = new Position()
    const s = (x, y, color) => { p = p.play(x, y, color) }
    s(1, 0, BLACK); s(0, 1, BLACK); s(1, 2, BLACK)
    s(2, 0, WHITE); s(3, 1, WHITE); s(2, 2, WHITE); s(1, 1, WHITE)
    p = new Position(p.stones, BLACK)
    p = p.play(2, 1) // black captures (1,1)
    assert.equal(p.at(1, 1), EMPTY)
    assert.equal(p.toPlay, WHITE)
    assert.equal(illegalReason(() => p.play(1, 1)), 'ko')

    // After an exchange elsewhere, white may retake
    p = p.play(10, 10).play(11, 11)
    assert.equal(p.play(1, 1).at(2, 1), EMPTY)
})

test('sameStones compares stones regardless of move order or turn', () => {
    const a = play('pd dd pp')
    const b = play('pp dd pd')
    assert.ok(a.sameStones(b))
    assert.ok(!a.sameStones(play('pd dd pq')))
    assert.ok(a.sameStones(a.pass()))
})

test('the 8 orientations: each takes the top-right corner to a different corner or mirror, and undoes cleanly', () => {
    const corners = new Set()
    for (let n = 0; n < 8; ++n) {
        assert.deepEqual(unorient(orient({ x: 16, y: 3 }, n), n), { x: 16, y: 3 })
        assert.deepEqual(unorient(orient({ x: 2.5, y: -0.5 }, n), n), { x: 2.5, y: -0.5 }, 'fractional points too')
        corners.add(orientSgf('qd', n))
    }
    assert.equal(corners.size, 8, 'Q16 lands somewhere different each time')
    assert.equal(orientSgf('pd', 0), 'pd')
    assert.equal(orientSgf('tt', 5), 'tt', 'a pass stays a pass')
})
