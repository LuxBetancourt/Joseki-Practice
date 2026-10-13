import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateNextMove, generatePunish } from '../js/problems.js'
import { BLACK, WHITE } from '../js/go.js'

// A tiny fake Josekipedia tree. Types: 0 ideal, 1 good, 2 bad, 3 trick.
const B = BLACK
const W = WHITE
const TREE = {
    1: [{ id: 40, move: 'pd', color: B, type: 0 }, { id: 99, move: 'jj', color: B, type: 0 }], // jj: not a classic opening
    40: [{ id: 42, move: 'qf', color: W, type: 0 }, { id: 50, move: 'qe', color: W, type: 2 }],
    42: [{ id: 43, move: 'nc', color: B, type: 0 }, { id: 60, move: 'rd', color: B, type: 2 }],
    43: [{ id: 44, move: 'qc', color: W, type: 0 }, { id: 70, move: 'rc', color: W, type: 2 }],
    44: [{ id: 45, move: 'qd', color: B, type: 0 }],
    45: [],
    50: [{ id: 51, move: 'pe', color: B, type: 0 }, { id: 52, move: 'rc', color: B, type: 2 }], // punish answer: pe
    51: [],
    60: [{ id: 61, move: 'qc', color: W, type: 1 }], // bad move without an ideal answer
    70: [{ id: 71, move: 'qc', color: B, type: 0 }], // punish answer: qc
}

const getNode = async (id) => ({ id, labels: [], children: (TREE[id] || []).map((c) => ({ labels: [], ...c })) })
const sequence = (values) => { let i = 0; return () => values[i++ % values.length] }

test('next move: stops on a position where the player is to move, with answers', async () => {
    for (const seed of [[0.9], [0.1], [0.5, 0.2]]) {
        const problem = await generateNextMove({ startMoves: [], color: BLACK, firstTen: true, getNode, random: sequence(seed) })
        assert.ok(problem, 'expected a problem')
        assert.equal(problem.moves.length % 2, 0, 'black to play means an even number of moves')
        assert.ok(problem.moves.length >= 3)
        assert.ok([...problem.answers.values()].some((t) => t === 0 || t === 1))
        assert.ok(!problem.moves.includes('jj'), 'only classic openings from the root')
    }
})

test('next move: follows only ideal/good moves from the starting point', async () => {
    const problem = await generateNextMove({ startMoves: ['pd'], color: BLACK, firstTen: true, getNode, random: sequence([0.1]) })
    // Too shallow to stop after 2 moves; never follows the bad move rd or the mistake rc
    assert.deepEqual(problem.moves, ['pd', 'qf', 'nc', 'qc'])
    assert.equal(problem.answers.get('qd'), 0)
})

test('next move: returns null when there is nothing to find', async () => {
    const problem = await generateNextMove({ startMoves: ['pd', 'qf', 'nc', 'qc', 'qd'], color: BLACK, firstTen: true, getNode, random: sequence([0.1]) })
    assert.equal(problem, null)
})

test('punish: opponent mistake with a recorded ideal answer', async () => {
    // White's qe after one move would be too shallow, so the first eligible mistake is rc
    const problem = await generatePunish({ startMoves: ['pd'], color: BLACK, firstTen: true, getNode, random: sequence([0.1]) })
    assert.deepEqual(problem.moves, ['pd', 'qf', 'nc', 'rc'])
    assert.deepEqual(problem.mistake, { move: 'rc', type: 2 })
    assert.equal(problem.answers.get('qc'), 0)
})

test('punish: skips mistakes that have no ideal answer', async () => {
    // As white, the only mistake (black rd at node 42) has no ideal white reply, so there is no problem.
    const problem = await generatePunish({ startMoves: ['pd', 'qf'], color: WHITE, firstTen: true, getNode, random: sequence([0.1]) })
    assert.equal(problem, null)
})
