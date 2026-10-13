// Generates problems by walking random joseki lines through Josekipedia.
// Each step costs one node lookup, so walks stop at a random target depth.

import { Position, PASS, fromSgf, opponent } from './go.js'
import { ROOT_ID, MoveType } from './josekipedia.js'
import { CLASSIC_OPENINGS } from './starting-points.js'

const MAX_TARGET_DEPTH = 12
const MAX_DEPTH = 30
const MAX_MISTAKES_CHECKED = 6
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

const pick = (items, random) => items[Math.floor(random() * items.length)]

/** Replays a starting path from the root; returns the walk state at its end. */
async function replay(moves, getNode) {
    let node = await getNode(ROOT_ID)
    let position = new Position()
    for (const coord of moves) {
        const child = node.children.find((c) => c.move === coord && c.color === position.toPlay)
        if (!child) { throw new Error(`Starting point isn't in Josekipedia (at ${coord})`) }
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
