import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shapeRegion, localShape } from '../js/shape-view.js'
import { Position } from '../js/go.js'

const play = (moves) => moves.split(' ').reduce((p, m) => p.playSgf(m), new Position())
const size = (r) => [r.x1 - r.x0 + 1, r.y1 - r.y0 + 1]

test('a corner joseki shows the corner edges and is square', () => {
    // 4-4, knight's approach, knight's move response, 3-3 slide: upper right corner
    const region = shapeRegion(play('pd qf nc qc'))
    assert.equal(region.x1, 18)
    assert.equal(region.y0, 0)
    const [w, h] = size(region)
    assert.equal(w, h)
    assert.ok(w >= 7)
    assert.ok(region.x0 <= 12, 'includes the knight move at N17 with a margin')
})

test('a single centre stone gets the minimum size, without touching the edges', () => {
    const region = shapeRegion(play('jj'))
    assert.deepEqual(size(region), [7, 7])
    assert.ok(region.x0 > 0 && region.x1 < 18 && region.y0 > 0 && region.y1 < 18)
    assert.ok(region.x0 <= 9 && region.x1 >= 9)
})

test('an empty board shows everything', () => {
    assert.deepEqual(shapeRegion(new Position()), { x0: 0, y0: 0, x1: 18, y1: 18 })
})

test('a side shape grows away from the edge it touches', () => {
    const region = shapeRegion(play('qj qk'))
    assert.equal(region.x1, 18)
    const [w, h] = size(region)
    assert.equal(w, h)
})

test('localShape ignores stones in other corners', () => {
    // Upper-right joseki plus a lone stone in the lower left
    const position = play('pd dp qf tt nc')
    const shape = localShape(position, [{ x: 13, y: 2 }]) // N17
    const keys = shape.map(({ x, y }) => `${x},${y}`)
    assert.ok(keys.includes('15,3') && keys.includes('16,5'), 'includes the connected corner stones')
    assert.ok(!keys.includes('3,15'), 'excludes the far stone')
    const region = shapeRegion(position, shape)
    assert.ok(region.x0 > 3, 'region stays in the upper right')
})
