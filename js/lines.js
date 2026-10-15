// Follows a joseki's main line to its final shape.

import { PASS, SIZE, EMPTY, fromSgf } from './go.js'
import { MoveType } from './josekipedia.js'

const SETTLED_LABEL = 23
const MAX_LENGTH = 30
const NEAR = 3 // A move further than this from every stone is treated as a whole-board (fuseki) move

function isNearStones(position, point) {
    for (let y = Math.max(0, point.y - NEAR); y <= Math.min(SIZE - 1, point.y + NEAR); ++y) {
        for (let x = Math.max(0, point.x - NEAR); x <= Math.min(SIZE - 1, point.x + NEAR); ++x) {
            if (position.at(x, y) !== EMPTY) { return true }
        }
    }
    return false
}

/**
 * From a fully loaded `node` and the `position` it leads to, repeatedly plays the first ideal
 * move for the side to play. Stops when the joseki ends: the next ideal move is tenuki or far
 * away, there is none, or Josekipedia marks the position as settled.
 * Returns { moves: [{ move, color }], position, node, states, ended }, where states[i] is the
 * { node, position } before moves[i], and `ended` says why it stopped: 'settled', 'tenuki' (the
 * next ideal move), 'elsewhere' (it's far away), 'end' (nothing more is recorded), 'unclear' (no
 * ideal move among what is), 'illegal' or 'length' (more than `maxLength` moves: callers that can't
 * use longer lines pass it, so as not to look up nodes they'd throw away).
 */
export async function mainLine({ node, position, getNode, maxLength = MAX_LENGTH }) {
    const moves = []
    const states = []
    let ended = 'length'
    while (moves.length < maxLength) {
        if (node.labels.includes(SETTLED_LABEL)) {
            ended = 'settled'
            break
        }
        const next = node.children.find((child) => child.color === position.toPlay && child.type === MoveType.IDEAL)
        const point = next && next.move !== PASS && fromSgf(next.move)
        if (!point) {
            ended = next ? 'tenuki' : node.children.length ? 'unclear' : 'end'
            break
        }
        if (!isNearStones(position, point)) {
            ended = 'elsewhere'
            break
        }
        if (!position.isLegal(point.x, point.y, next.color)) {
            ended = 'illegal'
            break
        }

        states.push({ node, position })
        position = position.play(point.x, point.y, next.color)
        moves.push({ move: next.move, color: next.color })
        // At the limit, the move's summary (labels and comment, no children) stands in for its
        // node: the line stops here anyway, so its children would never be read
        node = moves.length < maxLength ? await getNode(next.id) : next
    }
    return { moves, position, node, states, ended }
}
