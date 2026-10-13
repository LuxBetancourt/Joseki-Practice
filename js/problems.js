// Generates problems by walking random joseki lines through Josekipedia.
// Each step costs one node lookup, so walks stop at a random target depth.

import { Position, PASS, SIZE, EMPTY, fromSgf, toSgf, opponent } from './go.js'
import { ROOT_ID, MoveType } from './josekipedia.js'
import { CLASSIC_OPENINGS } from './starting-points.js'
import { mainLine } from './lines.js'

const MAX_TARGET_DEPTH = 12
const MAX_DEPTH = 30
const MAX_MISTAKES_CHECKED = 6
const MAX_SHAPE_CANDIDATES = 3
const MAX_SHAPE_LINE = 10 // Longer targets are too much to picture at once
const PATH_OPTIONS = 3
const MIN_PATH_LINE = 3
const MAX_PATH_LINE = 10
const MAX_DEVIATIONS_CHECKED = 6
const MISTAKE_TYPES = [MoveType.BAD, MoveType.TRICK, MoveType.QUESTION]
const MIN_MOVES = 3 // Skip trivial positions like answering the very first approach

const isLegal = (position, child) => {
    const point = fromSgf(child.move)
    return point && position.isLegal(point.x, point.y, child.color)
}

/** Ideal and good on-board moves for the side to play: the moves a random line may follow. */
function josekiMoves(node, position, firstTen) {
    let children = node.children.filter((child) => child.color === position.toPlay)
    if (firstTen) { children = children.slice(0, 10) }
    if (node.id === ROOT_ID) { children = children.filter((child) => CLASSIC_OPENINGS.includes(child.move)) }
    return children.filter((child) =>
        (child.type === MoveType.IDEAL || child.type === MoveType.GOOD) && child.move !== PASS && isLegal(position, child))
}

/** Every move Josekipedia knows for `color` at `node`, keyed by coordinate, valued by move type. */
function answerTypes(node, color) {
    return new Map(node.children.filter((child) => child.color === color).map((child) => [child.move, child.type]))
}

/** A starting point or saved problem that doesn't match Josekipedia (any more). */
export class StaleProblemError extends Error {}

const pick = (items, random) => items[Math.floor(random() * items.length)]
const shuffle = (items, random) => items
    .map((item) => ({ item, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item)

/** Replays a starting path from the root; returns the walk state at its end. */
async function replay(moves, getNode) {
    let node = await getNode(ROOT_ID)
    let position = new Position()
    for (const coord of moves) {
        const child = node.children.find((c) => c.move === coord && c.color === position.toPlay)
        if (!child) { throw new StaleProblemError(`Position isn't in Josekipedia (at ${coord})`) }
        position = position.playSgf(coord, child.color)
        node = await getNode(child.id)
    }
    return { moves: [...moves], position, node }
}

async function step(state, child, getNode) {
    return {
        moves: [...state.moves, child.move],
        position: state.position.playSgf(child.move, child.color),
        node: await getNode(child.id),
    }
}

/**
 * Walks a random joseki line from `state` towards a random target depth, calling `visit(state)` on
 * each position along the way. Stops once `visit` returns true at or past the target depth, or when
 * the line ends.
 */
async function walk(state, { firstTen, getNode, random }, visit) {
    const targetDepth = MIN_MOVES + Math.floor(random() * (MAX_TARGET_DEPTH - MIN_MOVES + 1))
    for (let depth = 0; depth < MAX_DEPTH; ++depth) {
        const suitable = visit(state)
        if (suitable && state.moves.length >= targetDepth) { return }
        const options = josekiMoves(state.node, state.position, firstTen)
        if (!options.length) { return }
        state = await step(state, pick(options, random), getNode)
    }
}

/**
 * "Next move" problem: a position partway through a joseki where `color` is to play.
 * Returns { moves, answers } or null if no suitable position was found.
 */
export async function generateNextMove({ startMoves, color, firstTen, getNode, random = Math.random }) {
    let chosen = null
    await walk(await replay(startMoves, getNode), { firstTen, getNode, random }, (state) => {
        const suitable = state.position.toPlay === color && state.moves.length >= MIN_MOVES
            && josekiMoves(state.node, state.position, false).length > 0
        if (suitable) { chosen = state } // The deepest suitable position seen so far
        return suitable
    })
    return chosen && { moves: chosen.moves, answers: answerTypes(chosen.node, color) }
}

/**
 * "Punish" problem: the opponent plays a bad or trick move that Josekipedia records an ideal
 * answer to, and `color` must find it.
 * Returns { moves, answers, mistake: { move, type } } or null.
 */
export async function generatePunish({ startMoves, color, firstTen, getNode, random = Math.random }) {
    const enemy = opponent(color)
    const candidates = [] // { state, mistake }, collected for free from the nodes along the line

    await walk(await replay(startMoves, getNode), { firstTen, getNode, random }, (state) => {
        if (state.position.toPlay !== enemy || state.moves.length + 1 < MIN_MOVES) { return false }
        const mistakes = state.node.children.filter((child) =>
            child.color === enemy && (child.type === MoveType.BAD || child.type === MoveType.TRICK) && isLegal(state.position, child))
        mistakes.forEach((mistake) => candidates.push({ state, mistake }))
        return mistakes.length > 0
    })

    // Check the deepest mistakes first, picking randomly among those at the same depth
    const ordered = candidates
        .map((candidate) => ({ candidate, key: random() }))
        .sort((a, b) => b.candidate.state.moves.length - a.candidate.state.moves.length || a.key - b.key)
        .map(({ candidate }) => candidate)
    for (const { state, mistake } of ordered.slice(0, MAX_MISTAKES_CHECKED)) {
        const after = await step(state, mistake, getNode)
        const answers = answerTypes(after.node, color)
        if ([...answers.values()].includes(MoveType.IDEAL)) {
            return { moves: after.moves, answers, mistake: { move: mistake.move, type: mistake.type } }
        }
    }
    return null
}

/**
 * "Final shape" problem: a position where `color` is to play, plus the shape the joseki ends in
 * after one of their joseki moves. The player must find the move that starts the line, so the
 * line needs at least two of their stones (otherwise the answer would be the only one shown), and
 * at most MAX_SHAPE_LINE moves.
 * Returns { moves, answers, answer, line: [{ move, color }], target: Position } or null.
 */
export async function generateFinalShape({ startMoves, color, firstTen, getNode, random = Math.random }) {
    let chosen = null
    await walk(await replay(startMoves, getNode), { firstTen, getNode, random }, (state) => {
        const suitable = state.position.toPlay === color && state.moves.length >= MIN_MOVES
            && josekiMoves(state.node, state.position, firstTen).length >= 2
        if (suitable) { chosen = state }
        return suitable
    })
    if (!chosen) { return null }

    for (const child of shuffle(josekiMoves(chosen.node, chosen.position, firstTen), random).slice(0, MAX_SHAPE_CANDIDATES)) {
        const after = await step(chosen, child, getNode)
        const rest = await mainLine({ node: after.node, position: after.position, getNode })
        const line = [{ move: child.move, color: child.color }, ...rest.moves]
        if (line.length <= MAX_SHAPE_LINE && line.filter((m) => m.color === color).length >= 2) {
            return { moves: chosen.moves, answers: answerTypes(chosen.node, color), answer: child.move, line, target: rest.position }
        }
    }
    return null
}

/** Plays a line of { move, color } onto a position; returns null if a move is illegal. */
function playLine(position, line) {
    try {
        return line.reduce((p, { move, color }) => p.playSgf(move, color), position)
    }
    catch {
        return null
    }
}

/**
 * "Pick the path" problem: from a position partway through a joseki, several numbered sequences
 * are shown and only one is the joseki (both sides play the main line). The others branch off it:
 * first with mistakes Josekipedia records (followed by how that branch continues), then, if there
 * aren't enough, with a random nearby non-joseki move near the end of the line.
 * Returns { moves, line, options: [{ line, position, mistake? }] } or null, where the correct
 * option has no `mistake` and the others have { step, move, color, type } (type null = made up).
 */
export async function generatePickPath({ startMoves, color, firstTen, getNode, random = Math.random }) {
    const candidates = []
    await walk(await replay(startMoves, getNode), { firstTen, getNode, random }, (state) => {
        const suitable = state.position.toPlay === color && state.moves.length >= MIN_MOVES
            && josekiMoves(state.node, state.position, false).length > 0
        if (suitable) { candidates.push(state) }
        return suitable
    })

    // Deepest first, find a position whose main line is a sensible length
    let chosen = null
    let main = null
    for (const state of candidates.reverse().slice(0, MAX_SHAPE_CANDIDATES)) {
        const line = await mainLine({ node: state.node, position: state.position, getNode })
        if (line.moves.length >= MIN_PATH_LINE && line.moves.length <= MAX_PATH_LINE) {
            chosen = state
            main = line
            break
        }
    }
    if (!chosen) { return null }

    const options = [{ line: main.moves, position: main.position }]
    const addOption = (line, mistake) => {
        const position = playLine(chosen.position, line)
        if (position && options.every((option) => !option.position.sameStones(position))) {
            options.push({ line, position, mistake })
        }
    }

    // Mistakes recorded along the main line, followed by how Josekipedia continues from them
    const deviations = []
    main.states.forEach((state, step) => {
        for (const child of state.node.children) {
            if (child.color === state.position.toPlay && MISTAKE_TYPES.includes(child.type)
                && child.move !== PASS && isLegal(state.position, child)) {
                deviations.push({ step, child })
            }
        }
    })
    for (const { step, child } of shuffle(deviations, random).slice(0, MAX_DEVIATIONS_CHECKED)) {
        if (options.length >= PATH_OPTIONS) { break }
        const state = main.states[step]
        const rest = await mainLine({ node: await getNode(child.id), position: state.position.playSgf(child.move, child.color), getNode })
        // Keep it about as long as the correct line, so length doesn't give the answer away
        const line = [...main.moves.slice(0, step), { move: child.move, color: child.color }, ...rest.moves]
            .slice(0, main.moves.length + 2)
        addOption(line, { step, move: child.move, color: child.color, type: child.type })
    }

    // Not enough recorded mistakes: replace one of the last two moves with a random nearby
    // move that isn't joseki there
    for (let tries = 0; options.length < PATH_OPTIONS && tries < 30; ++tries) {
        const step = main.moves.length - 1 - Math.floor(random() * 2)
        const { node, position } = main.states[step]
        const original = fromSgf(main.moves[step].move)
        const x = original.x + Math.floor(random() * 5) - 2
        const y = original.y + Math.floor(random() * 5) - 2
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || position.at(x, y) !== EMPTY) { continue }
        const move = toSgf(x, y)
        const known = node.children.find((child) => child.move === move && child.color === position.toPlay)
        if (known && (known.type === MoveType.IDEAL || known.type === MoveType.GOOD)) { continue }
        const stoneColor = position.toPlay
        addOption([...main.moves.slice(0, step), { move, color: stoneColor }], { step, move, color: stoneColor, type: known ? known.type : null })
    }

    if (options.length < PATH_OPTIONS) { return null }
    return { moves: chosen.moves, line: main.moves, options: shuffle(options, random) }
}

/** The kind-specific part of a problem as plain data, so it can be saved for review. */
export function problemData(kind, problem) {
    switch (kind) {
        case 'punish': return { mistake: problem.mistake }
        case 'shape': return { answer: problem.answer, line: problem.line }
        case 'path': return { line: problem.line, options: problem.options.map(({ line, mistake }) => ({ line, mistake })) }
        default: return {}
    }
}

/**
 * Rebuilds a saved problem ({ kind, moves, color, data }) in the same shape the generators
 * return. Throws if Josekipedia no longer has the position.
 */
export async function rebuildProblem({ kind, moves, color, data }, { getNode, random = Math.random }) {
    const { node, position } = await replay(moves, getNode)
    const answers = answerTypes(node, color)
    switch (kind) {
        case 'punish':
            return { moves, answers, mistake: data.mistake }
        case 'shape': {
            const target = playLine(position, data.line)
            if (!target) { throw new StaleProblemError('Saved shape problem no longer fits the position') }
            return { moves, answers, answer: data.answer, line: data.line, target }
        }
        case 'path': {
            const options = data.options.map(({ line, mistake }) => ({ line, mistake, position: playLine(position, line) }))
            if (options.some((option) => !option.position)) { throw new StaleProblemError('Saved path problem no longer fits the position') }
            return { moves, line: data.line, options: shuffle(options, random) }
        }
        default:
            return { moves, answers }
    }
}
