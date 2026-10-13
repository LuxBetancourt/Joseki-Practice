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
 * Returns { moves: [{ move, color }], position, node }.
 */
export async function mainLine({ node, position, getNode }) {
    const moves = []
    while (moves.length < MAX_LENGTH && !node.labels.includes(SETTLED_LABEL)) {
        const next = node.children.find((child) => child.color === position.toPlay && child.type === MoveType.IDEAL)
        const point = next && next.move !== PASS && fromSgf(next.move)
        if (!point || !isNearStones(position, point) || !position.isLegal(point.x, point.y, next.color)) { break }

        position = position.play(point.x, point.y, next.color)
        moves.push({ move: next.move, color: next.color })
        node = await getNode(next.id)
    }
    return { moves, position, node }
}
