import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateNextMove, generatePunish, generateFinalShape, generatePickPath, problemData, rebuildProblem, StaleProblemError, encodeProblem, decodeProblem, generateWhosBetter, generateTenuki, outcomeOf, tenukiVerdict, clearSpares, problemAt } from '../js/problems.js'
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
beforeEach(() => clearSpares()) // Spare problems from one test mustn't leak into the next

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

test('punish: a good answer counts as the punishment when there is no ideal one', async () => {
    // As white, the only mistake (black rd at node 42) has just a good white reply (qc)
    const problem = await generatePunish({ startMoves: ['pd', 'qf'], color: WHITE, firstTen: true, getNode, random: sequence([0.1]) })
    assert.deepEqual(problem.moves, ['pd', 'qf', 'rd'])
    assert.equal(problem.answers.get('qc'), 1)
})

test('punish: skips mistakes with no ideal or good answer', async () => {
    const tree = { ...TREE, 60: [{ id: 61, move: 'qc', color: W, type: 2 }] } // only a bad reply
    const getTreeNode = async (id) => ({ id, labels: [], children: (tree[id] || []).map((c) => ({ labels: [], ...c })) })
    const problem = await generatePunish({ startMoves: ['pd', 'qf'], color: WHITE, firstTen: true, getNode: getTreeNode, random: sequence([0.1]) })
    assert.equal(problem, null)
})

test("final shape: picks a line with at least two of the player's stones and returns its final position", async () => {
    // After pd qf nc qc, black can play qd (line continues W pc, B od: two black stones) or qg
    // (line ends at once: one black stone, so it would make a trivial problem).
    const tree = {
        1: [{ id: 40, move: 'pd', color: B, type: 0 }],
        40: [{ id: 42, move: 'qf', color: W, type: 0 }],
        42: [{ id: 43, move: 'nc', color: B, type: 0 }],
        43: [{ id: 44, move: 'qc', color: W, type: 0 }],
        44: [{ id: 90, move: 'qg', color: B, type: 0 }, { id: 45, move: 'qd', color: B, type: 0 }],
        45: [{ id: 46, move: 'pc', color: W, type: 0 }],
        46: [{ id: 47, move: 'od', color: B, type: 0 }],
    }
    const getTreeNode = async (id) => ({ id, labels: [], children: (tree[id] || []).map((c) => ({ labels: [], ...c })) })
    for (const seed of [[0.1], [0.9], [0.5, 0.2]]) {
        const problem = await generateFinalShape({ startMoves: ['pd', 'qf', 'nc', 'qc'], color: BLACK, firstTen: true, getNode: getTreeNode, random: sequence(seed) })
        assert.ok(problem)
        assert.deepEqual(problem.moves, ['pd', 'qf', 'nc', 'qc'])
        assert.equal(problem.answer, 'qd')
        assert.deepEqual(problem.line.map((m) => m.move), ['qd', 'pc', 'od'])
        assert.equal(problem.target.at(16, 3), BLACK) // qd
        assert.equal(problem.target.at(14, 3), BLACK) // od
        assert.equal(problem.answers.get('qg'), 0)
    }
})

test("final shape: returns null when no line has two of the player's stones", async () => {
    const tree = {
        1: [{ id: 40, move: 'pd', color: B, type: 0 }],
        40: [{ id: 42, move: 'qf', color: W, type: 0 }],
        42: [{ id: 43, move: 'nc', color: B, type: 0 }],
        43: [{ id: 44, move: 'qc', color: W, type: 0 }],
        44: [{ id: 90, move: 'qg', color: B, type: 0 }, { id: 91, move: 'qd', color: B, type: 0 }],
    }
    const getTreeNode = async (id) => ({ id, labels: [], children: (tree[id] || []).map((c) => ({ labels: [], ...c })) })
    const problem = await generateFinalShape({ startMoves: ['pd', 'qf', 'nc', 'qc'], color: BLACK, firstTen: true, getNode: getTreeNode, random: sequence([0.3]) })
    assert.equal(problem, null)
})

// pd qf nc qc, then black's main line is qd pc od
const pathTree = (extra = {}) => ({
    1: [{ id: 40, move: 'pd', color: B, type: 0 }],
    40: [{ id: 42, move: 'qf', color: W, type: 0 }],
    42: [{ id: 43, move: 'nc', color: B, type: 0 }],
    43: [{ id: 44, move: 'qc', color: W, type: 0 }],
    44: [{ id: 45, move: 'qd', color: B, type: 0 }],
    45: [{ id: 46, move: 'pc', color: W, type: 0 }],
    46: [{ id: 47, move: 'od', color: B, type: 0 }],
    47: [],
    ...extra,
})
const treeGetter = (tree) => async (id) => ({ id, labels: [], children: (tree[id] || []).map((c) => ({ labels: [], ...c })) })
const START = ['pd', 'qf', 'nc', 'qc']

test('pick the path: one joseki line plus lines branching off at recorded mistakes', async () => {
    const tree = pathTree({
        44: [{ id: 45, move: 'qd', color: B, type: 0 }, { id: 92, move: 'rd', color: B, type: 2 }], // bad
        92: [{ id: 93, move: 'qd', color: W, type: 0 }],
        46: [{ id: 47, move: 'od', color: B, type: 0 }, { id: 94, move: 'oc', color: B, type: 4 }], // questionable
        94: [],
    })
    const problem = await generatePickPath({ startMoves: START, color: BLACK, firstTen: true, getNode: treeGetter(tree), random: sequence([0.1, 0.6, 0.3]) })
    assert.ok(problem)
    assert.deepEqual(problem.moves, START)
    assert.deepEqual(problem.line.map((m) => m.move), ['qd', 'pc', 'od'])
    assert.equal(problem.options.length, 3)

    const correct = problem.options.filter((o) => !o.mistake)
    assert.equal(correct.length, 1)
    assert.deepEqual(correct[0].line.map((m) => m.move), ['qd', 'pc', 'od'])

    const wrong = Object.fromEntries(problem.options.filter((o) => o.mistake).map((o) => [o.mistake.move, o]))
    assert.deepEqual(wrong.rd.line.map((m) => m.move), ['rd', 'qd'])
    assert.deepEqual(wrong.rd.mistake, { step: 0, move: 'rd', color: BLACK, type: 2 })
    assert.deepEqual(wrong.oc.line.map((m) => m.move), ['qd', 'pc', 'oc'])
    assert.equal(wrong.oc.mistake.type, 4)
})

test('pick the path: makes up nearby non-joseki moves when Josekipedia has no mistakes', async () => {
    // A small seeded generator (mulberry32), so made-up moves vary between attempts
    const seeded = (seed) => () => {
        seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (const seed of [1, 2, 3, 42, 1234]) {
        const problem = await generatePickPath({ startMoves: START, color: BLACK, firstTen: true, getNode: treeGetter(pathTree()), random: seeded(seed) })
        assert.ok(problem, `expected a problem for seed ${seed}`)
        assert.equal(problem.options.length, 3)
        const made = problem.options.filter((o) => o.mistake)
        assert.equal(made.length, 2)
        for (const { line, mistake } of made) {
            assert.equal(mistake.type, null)
            assert.ok(mistake.step >= 1, 'replaces one of the last two moves')
            assert.equal(line.length, mistake.step + 1)
            const original = problem.line[mistake.step].move
            const dx = Math.abs(mistake.move.charCodeAt(0) - original.charCodeAt(0))
            const dy = Math.abs(mistake.move.charCodeAt(1) - original.charCodeAt(1))
            assert.ok(dx <= 2 && dy <= 2 && mistake.move !== original, 'nearby, and not the joseki move')
        }
        // Every option ends in a different position
        const [a, b, c] = problem.options.map((o) => o.position)
        assert.ok(!a.sameStones(b) && !a.sameStones(c) && !b.sameStones(c))
    }
})

test('pick the path: skips lines too short to be interesting', async () => {
    const tree = pathTree({ 45: [] }) // main line is just qd
    const problem = await generatePickPath({ startMoves: START, color: BLACK, firstTen: true, getNode: treeGetter(tree), random: sequence([0.3]) })
    assert.equal(problem, null)
})

test('problems survive being saved as plain data and rebuilt', async () => {
    const tree = pathTree({
        // qg gives Final Shape a second joseki choice
        44: [{ id: 45, move: 'qd', color: B, type: 0 }, { id: 92, move: 'rd', color: B, type: 2 }, { id: 95, move: 'qg', color: B, type: 0 }],
        95: [],
        92: [{ id: 93, move: 'qd', color: W, type: 0 }],
        46: [{ id: 47, move: 'od', color: B, type: 0 }, { id: 94, move: 'oc', color: B, type: 4 }],
        94: [],
    })
    const getNode = treeGetter(tree)
    const options = { startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.1, 0.6, 0.3]) }

    for (const [kind, generate] of [['next', generateNextMove], ['shape', generateFinalShape], ['path', generatePickPath]]) {
      const original = await generate({ ...options, random: sequence([0.1, 0.6, 0.3]) })
      assert.ok(original, kind)
      const spec = { kind, moves: original.moves, color: BLACK, data: problemData(kind, original) }
      // Saved reviews keep the data; links keep only what Josekipedia can't fill back in
      for (const saved of [JSON.parse(JSON.stringify(spec)), decodeProblem(encodeProblem(spec))]) {
        const rebuilt = await rebuildProblem(saved, { getNode, random: sequence([0.5]) })

        assert.deepEqual(rebuilt.moves, original.moves, kind)
        if (original.answers) { assert.deepEqual([...rebuilt.answers], [...original.answers], kind) }
        if (kind === 'shape') {
            assert.equal(rebuilt.answer, original.answer)
            assert.ok(rebuilt.target.sameStones(original.target))
        }
        if (kind === 'path') {
            assert.deepEqual(rebuilt.line, original.line)
            assert.equal(rebuilt.options.length, original.options.length)
            for (const option of original.options) {
                const match = rebuilt.options.find((o) => o.position.sameStones(option.position))
                assert.ok(match, 'every option comes back')
                assert.deepEqual(match.mistake, option.mistake)
            }
        }
      }
    }
})

test('rebuilding fails clearly when the position is no longer in Josekipedia', async () => {
    const saved = { kind: 'next', moves: ['pd', 'zz'], color: BLACK, data: {} }
    await assert.rejects(rebuildProblem(saved, { getNode: treeGetter(pathTree()) }), StaleProblemError)
})

test('problem links round-trip, including Pick the Path data', async () => {
    const tree = pathTree({
        44: [{ id: 45, move: 'qd', color: B, type: 0 }, { id: 92, move: 'rd', color: B, type: 2 }],
        92: [{ id: 93, move: 'qd', color: W, type: 0 }],
    })
    const getNode = treeGetter(tree)
    const found = await generatePickPath({ startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.1, 0.6, 0.3]) })
    const spec = { kind: 'path', moves: found.moves, color: BLACK, data: problemData('path', found) }

    const text = encodeProblem(spec)
    assert.match(text, /^[A-Za-z0-9_.-]+$/, 'safe to put in a URL')
    assert.ok(text.length < 40, text)
    const decoded = decodeProblem(text)
    assert.deepEqual(decoded.moves, spec.moves)

    const rebuilt = await rebuildProblem(decoded, { getNode })
    assert.equal(rebuilt.options.length, found.options.length)
})

test('problem links reject anything else', () => {
    for (const bad of ['', 'not-base64!', btoa('{"k":"nope","m":"pd","c":1,"d":{}}'), btoa('{"k":"next","m":"zz","c":1,"d":{}}'), btoa('{"k":"next","m":"pd","c":3,"d":{}}')]) {
        assert.throws(() => decodeProblem(bad), undefined, bad)
    }
})

test("who's better: verdict labels map to an answer", () => {
    assert.equal(outcomeOf([2]), 'black')
    assert.equal(outcomeOf([46, 13]), 'black')
    assert.equal(outcomeOf([47]), 'white')
    assert.equal(outcomeOf([21]), 'white', 'Black collapses')
    assert.equal(outcomeOf([45]), 'even')
    assert.equal(outcomeOf([2, 1]), null, 'contradictory')
    assert.equal(outcomeOf([9, 23]), null, 'no verdict')
})

test("who's better: finds a position with the chosen answer, or none", async () => {
    const tree = pathTree({
        44: [{ id: 45, move: 'qd', color: B, type: 0, labels: [45] }, { id: 92, move: 'rd', color: B, type: 2, labels: [1] }],
        92: [],
    })
    const getNode = async (id) => ({ id, labels: [], children: (tree[id] || []).map((c) => ({ labels: [], ...c })) })
    // OUTCOMES is [black, white, even]: 0.4 picks white, 0.9 even, 0.1 black
    const white = await generateWhosBetter({ startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.4]) })
    assert.deepEqual(white, { moves: [...START, 'rd'], answer: 'white', labels: [1] })
    const even = await generateWhosBetter({ startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.9, 0.1]) })
    assert.deepEqual(even.moves, [...START, 'qd'])
    assert.equal(even.answer, 'even')
    assert.equal(await generateWhosBetter({ startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.1]) }), null, 'no black verdicts here')
})

test('tenuki-able: the evidence rules', () => {
    const node = (children, labels = []) => ({ labels, children })
    const pass = (color, type) => ({ move: 'tt', color, type, labels: [] })
    assert.equal(tenukiVerdict(node([], [10]), BLACK), 'yes', 'Black can tenuki label')
    assert.equal(tenukiVerdict(node([], [10]), WHITE), null, "that label isn't about White")
    assert.equal(tenukiVerdict(node([pass(BLACK, 0)]), BLACK), 'yes', 'tenuki is joseki')
    assert.equal(tenukiVerdict(node([pass(BLACK, 2)]), BLACK), 'no', 'tenuki is a bad move')
    assert.equal(tenukiVerdict(node([pass(BLACK, 2)], [10]), BLACK), null, 'contradictory')
    assert.equal(tenukiVerdict(node([]), BLACK), null, 'a missing label proves nothing')
    assert.equal(tenukiVerdict(node([{ move: 'qd', color: BLACK, type: 0, labels: [15] }]), BLACK), 'no', 'a Necessary move')
})

test('tenuki-able: infers "no" when nothing allows tenuki and the joseki carries on locally', async () => {
    // pathTree: after pd qf nc qc, black qd, white pc, black od; no tenuki evidence anywhere
    const getNode = treeGetter(pathTree())
    const problem = await generateTenuki({ startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.7]) })
    assert.equal(problem.answer, 'no')
    assert.ok(problem.inferredFrom, 'says which local move it inferred from')
    // The inferred move is the side to play's joseki move, and the sequence carries on after it
    const line = ['qd', 'pc', 'od']
    const index = problem.moves.length - START.length
    assert.equal(problem.inferredFrom, line[index])
    assert.ok(index < line.length - 1, 'not the last move of the line')
})

test('tenuki-able: an inferred "no" needs the sequence to carry on', async () => {
    const tree = pathTree({ 45: [] }) // after qd the line stops
    const problem = await generateTenuki({ startMoves: START, color: BLACK, firstTen: true, getNode: treeGetter(tree), random: sequence([0.7]) })
    assert.equal(problem, null)
})

test('tenuki-able: finds a position with the chosen answer', async () => {
    const tree = pathTree({
        44: [{ id: 45, move: 'qd', color: B, type: 0 }, { id: 96, move: 'tt', color: B, type: 2 }], // tenuki is bad here
        46: [{ id: 47, move: 'od', color: B, type: 0 }],
    })
    const getNode = async (id) => ({ id, labels: id === 46 ? [10] : [], children: (tree[id] || []).map((c) => ({ labels: [], ...c })) })
    const no = await generateTenuki({ startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.7]) })
    assert.deepEqual(no, { moves: START, answer: 'no', color: BLACK })
    const yes = await generateTenuki({ startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.1]) })
    assert.deepEqual(yes, { moves: [...START, 'qd', 'pc'], answer: 'yes', color: BLACK })
})

test("who's better: positions with other verdicts are kept and used later", async () => {
    const tree = pathTree({
        44: [{ id: 45, move: 'qd', color: B, type: 0, labels: [45] }, { id: 92, move: 'rd', color: B, type: 2, labels: [1] }],
        92: [],
    })
    const getNode = async (id) => ({ id, labels: [], children: (tree[id] || []).map((c) => ({ labels: [], ...c })) })
    const options = { startMoves: START, color: BLACK, firstTen: true, getNode }
    // Wanting "white" finds rd, and stashes the "even" qd it passed
    const white = await generateWhosBetter({ ...options, random: sequence([0.4]) })
    assert.equal(white.answer, 'white')
    // Break the tree so a walk finds nothing: "even" now comes from the stash, once
    const empty = { ...options, getNode: async (id) => ({ id, labels: [], children: id === 44 ? [] : (tree[id] || []).map((c) => ({ labels: [], ...c })) }) }
    const even = await generateWhosBetter({ ...empty, random: sequence([0.9]) })
    assert.deepEqual(even, { moves: [...START, 'qd'], answer: 'even', labels: [45] })
    assert.equal(await generateWhosBetter({ ...empty, random: sequence([0.9]) }), null, 'each spare is used once')
})

test('spare problems only come from the current starting point', async () => {
    const tree = pathTree({
        44: [{ id: 45, move: 'qd', color: B, type: 0, labels: [45] }, { id: 92, move: 'rd', color: B, type: 2, labels: [1] }],
        92: [],
    })
    const getNode = async (id) => ({ id, labels: [], children: (tree[id] || []).map((c) => ({ labels: [], ...c })) })
    await generateWhosBetter({ startMoves: START, color: BLACK, firstTen: true, getNode, random: sequence([0.4]) }) // stashes "even" under pd qf nc qc
    // From a different starting point (3-4), with nothing to find, the stashed "even" doesn't qualify
    const other = async (id) => ({ id, labels: [], children: id === 1 ? [{ id: 39, move: 'qd', color: B, type: 0, labels: [] }] : [] })
    assert.equal(await generateWhosBetter({ startMoves: ['qd'], color: BLACK, firstTen: true, getNode: other, random: sequence([0.9]) }), null)
})

test('short problem links for every kind, and older JSON links still open', async () => {
    const moves = ['pd', 'qf', 'nc']
    for (const [spec, text] of [
        [{ kind: 'next', moves, color: BLACK, data: {} }, 'nbpdqfnc'],
        [{ kind: 'punish', moves, color: WHITE, data: { mistake: { move: 'nc', type: 2 } } }, 'pwpdqfnc'],
        [{ kind: 'shape', moves, color: BLACK, data: { answer: 'qc', line: [] } }, 'sbpdqfnc.qc'],
        [{ kind: 'better', moves, color: BLACK, data: { answer: 'even', labels: [45] } }, 'bbpdqfnc'],
        [{ kind: 'tenuki', moves, color: WHITE, data: { answer: 'no', inferredFrom: 'qc' } }, 'twpdqfnc.qc'],
        [{ kind: 'tenuki', moves, color: WHITE, data: { answer: 'yes' } }, 'twpdqfnc'],
    ]) {
        assert.equal(encodeProblem(spec), text)
        assert.deepEqual(decodeProblem(text).moves, moves)
    }
    const legacy = btoa(JSON.stringify({ k: 'next', m: 'pdqfnc', c: BLACK, d: {} })).replace(/=+$/, '')
    assert.deepEqual(decodeProblem(legacy), { kind: 'next', moves, color: BLACK, data: {} })
    for (const bad of ['sbpdqfnc', 'sbpdqfnc.qc.qd', 'lbpdqfnc', 'lbpdqfnc.x', 'nbpdqfnc.qc', 'nbpdq']) {
        assert.throws(() => decodeProblem(bad), undefined, bad)
    }
})

test('tenuki-able: only asks about the given color', async () => {
    // pathTree: after pd qf nc qc it's Black's turn, then White's after qd
    const getNode = treeGetter(pathTree())
    for (let i = 0; i < 5; i++) {
        const problem = await generateTenuki({ startMoves: START, color: WHITE, firstTen: true, getNode, random: sequence([0.7, 0.2, 0.5]) })
        if (problem) {
            assert.equal(problem.color, WHITE)
            assert.equal(problem.moves.length % 2, 1, 'White to play')
        }
    }
})

test('problemAt: a chosen position becomes a problem of the chosen type, or says why not', async () => {
    const at = (kind, moves, color = BLACK) => problemAt(kind, moves, { color, firstTen: true, getNode })
    // Next Move: Black to play qd after pd qf nc qc
    const next = await at('next', ['pd', 'qf', 'nc', 'qc'])
    assert.equal(next.problem.color, BLACK)
    assert.equal(next.problem.answers.get('qd'), 0)
    assert.ok((await at('next', ['pd', 'qf', 'nc', 'qc', 'qd'])).why, 'nothing to play at the end of the line')
    // Punish: White's rc is a mistake that Black answers with qc
    const punish = await at('punish', ['pd', 'qf', 'nc', 'rc'])
    assert.deepEqual(punish.problem.mistake, { move: 'rc', type: 2 })
    assert.ok((await at('punish', ['pd', 'qf', 'nc', 'qc'])).why, 'qc is joseki, not a mistake')
    // Who's Better? and Tenuki-able? need Josekipedia to say so
    assert.ok((await at('better', ['pd', 'qf'])).why)
    const tenuki = await at('tenuki', ['pd', 'qf', 'nc', 'qc'])
    assert.ok(tenuki.why || tenuki.problem.answer)
    // Whatever is made can be saved and rebuilt like any review
    for (const [kind, { problem }] of [['next', next], ['punish', punish]]) {
        const rebuilt = await rebuildProblem({ kind, moves: problem.moves, color: problem.color, data: problemData(kind, problem) }, { getNode })
        assert.deepEqual(rebuilt.moves, problem.moves)
    }
})

test("problemAt: who's better reads the verdict on the last move", async () => {
    const labelled = async (id) => ({ ...(await getNode(id)), labels: id === 42 ? [1] : [] })
    const { problem } = await problemAt('better', ['pd', 'qf'], { color: WHITE, getNode: labelled })
    assert.equal(problem.answer, 'white')
    assert.equal(problem.color, WHITE, 'saved for the player, whoever is to move')
})
