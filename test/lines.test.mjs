import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mainLine } from '../js/lines.js'
import { Position, BLACK, WHITE } from '../js/go.js'

const B = BLACK
const W = WHITE
const lineFrom = async (tree, id, moves) => {
    const getNode = async (nodeId) => ({ id: nodeId, ...tree[nodeId] })
    const position = moves.split(' ').reduce((p, m) => p.playSgf(m), new Position())
    const result = await mainLine({ node: await getNode(id), position, getNode })
    return result.moves.map((m) => m.move).join(' ')
}
const node = (children, labels = []) => ({ labels, children })

test('follows the first ideal move for the side to play', async () => {
    const tree = {
        1: node([{ id: 2, move: 'qc', color: W, type: 1 }, { id: 3, move: 'qf', color: W, type: 0 }, { id: 4, move: 'qh', color: W, type: 0 }]),
        3: node([{ id: 5, move: 'nc', color: B, type: 0 }]),
        5: node([]),
    }
    assert.equal(await lineFrom(tree, 1, 'pd'), 'qf nc')
})

test('stops at a settled position', async () => {
    const tree = {
        1: node([{ id: 2, move: 'qf', color: W, type: 0 }]),
        2: node([{ id: 3, move: 'nc', color: B, type: 0 }], [23]),
    }
    assert.equal(await lineFrom(tree, 1, 'pd'), 'qf')
})

test('stops before tenuki and before far-away (fuseki) moves', async () => {
    const tenuki = { 1: node([{ id: 2, move: 'tt', color: W, type: 0 }]) }
    assert.equal(await lineFrom(tenuki, 1, 'pd'), '')

    const far = {
        1: node([{ id: 2, move: 'qf', color: W, type: 0 }]),
        2: node([{ id: 3, move: 'dp', color: B, type: 0 }]),
    }
    assert.equal(await lineFrom(far, 1, 'pd'), 'qf')
})
