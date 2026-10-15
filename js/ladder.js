// Reads ladders, to find where a ladder from a joseki would run, and so where a stone would decide it.

import { SIZE, EMPTY, opponent } from './go.js'

// Positions a single reading may visit, so a tangled fight can't hold up the page: a ladder across
// the whole board visits about 100
const MAX_READ = 500
const LONG_LADDER = 6 // Runner moves before a ladder counts as reaching across the board
const NEAR = 2 // How far from the ladder move to look for replies that start a ladder

const inBoard = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE
const adjacent = (x, y) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => inBoard(a, b))

/** The group at (x, y): its stones and liberties, as [x, y] pairs. */
export function groupAt(position, x, y) {
    const color = position.at(x, y)
    const seen = new Set([y * SIZE + x])
    const stones = []
    const liberties = new Map()
    const stack = [[x, y]]
    while (stack.length) {
        const [cx, cy] = stack.pop()
        stones.push([cx, cy])
        for (const [nx, ny] of adjacent(cx, cy)) {
            const key = ny * SIZE + nx
            const there = position.at(nx, ny)
            if (there === EMPTY) { liberties.set(key, [nx, ny]) }
            else if (there === color && !seen.has(key)) {
                seen.add(key)
                stack.push([nx, ny])
            }
        }
    }
    return { color, stones, liberties: [...liberties.values()] }
}

const tryPlay = (position, x, y, color) => {
    try { return position.play(x, y, color) }
    catch { return null }
}

/** True if the runner's group touches a chaser group it could capture right now. */
function canCaptureNeighbor(position, runner) {
    const enemy = opponent(runner.color)
    return runner.stones.some(([x, y]) => adjacent(x, y).some(([nx, ny]) =>
        position.at(nx, ny) === enemy && groupAt(position, nx, ny).liberties.length === 1))
}

/**
 * Reads the ladder on the group at (x, y): the other color chases, and `chaserToMove` says whose
 * turn it is. Returns { captured, path }, where path is where the runner extended, in order.
 */
export function readLadder(position, x, y, chaserToMove) {
    const budget = { left: MAX_READ }
    const runnerColor = position.at(x, y)
    if (runnerColor === EMPTY) { return { captured: false, path: [] } }
    return read(position, x, y, opponent(runnerColor), chaserToMove, [], budget)
}

function read(position, x, y, chaser, chaserToMove, path, budget) {
    if (--budget.left < 0) { return { captured: false, path } }
    if (position.at(x, y) === EMPTY) { return { captured: true, path } }
    const runner = groupAt(position, x, y)
    const liberties = runner.liberties.length

    if (chaserToMove) {
        if (liberties === 1) { return { captured: true, path } }
        if (liberties >= 3) { return { captured: false, path } }
        // Atari from either side; the ladder works if either keeps the runner caught, and the
        // quicker capture is the one that counts (a ladder that needn't cross the board doesn't
        // depend on what's there)
        let best = null
        for (const [lx, ly] of runner.liberties) {
            const next = tryPlay(position, lx, ly, chaser)
            if (!next || next.at(x, y) === EMPTY) { continue }
            if (groupAt(next, x, y).liberties.length !== 1) { continue }
            const result = read(next, x, y, chaser, false, path, budget)
            if (result.captured && (!best || result.path.length < best.path.length)) { best = result }
        }
        return best || { captured: false, path }
    }

    // The runner, in atari, captures its way out if it can, or else extends
    if (liberties >= 2) { return read(position, x, y, chaser, true, path, budget) }
    if (canCaptureNeighbor(position, runner)) { return { captured: false, path } }
    const [ex, ey] = runner.liberties[0]
    const next = tryPlay(position, ex, ey, runner.color)
    if (!next) { return { captured: true, path } }
    const extended = [...path, { x: ex, y: ey }]
    const after = groupAt(next, ex, ey).liberties.length
    if (after >= 3) { return { captured: false, path: extended } }
    if (after <= 1) { return { captured: true, path: extended } }
    return read(next, ex, ey, chaser, true, extended, budget)
}

const longer = (a, b) => (!b || (a && a.path.length > b.path.length) ? a : b)

/**
 * The longest ladder that could start straight away in `position` near (x, y), one that ends in a
 * capture on this board: a group of the side not to play with two liberties (to be chased), or of
 * the side to play in atari (to run). Returns
 * { runner (its color), path, start: { position, x, y, chaserToMove } } to read it again from, or null.
 */
export function ladderNear(position, x, y) {
    let best = null
    const seen = new Set()
    for (let ny = y - NEAR; ny <= y + NEAR; ++ny) {
        for (let nx = x - NEAR; nx <= x + NEAR; ++nx) {
            if (!inBoard(nx, ny) || position.at(nx, ny) === EMPTY || seen.has(ny * SIZE + nx)) { continue }
            const group = groupAt(position, nx, ny)
            group.stones.forEach(([sx, sy]) => seen.add(sy * SIZE + sx))
            const chaserToMove = group.color !== position.toPlay
            if (group.liberties.length !== (chaserToMove ? 2 : 1)) { continue }
            const result = readLadder(position, nx, ny, chaserToMove)
            if (result.captured && result.path.length >= LONG_LADDER) {
                best = longer({ runner: group.color, path: result.path, start: { position, x: nx, y: ny, chaserToMove } }, best)
            }
        }
    }
    return best
}

/**
 * The ladder a move relies on: `after` is the position once it has been played at (x, y). Tries
 * the ladders that could start straight away, or after any reply nearby (a cut, say). Returns the
 * longest (see ladderNear), or null. `more` adds positions to check as well, e.g. how the joseki
 * continues, as [{ position, x, y }].
 */
export function findLadder(after, x, y, more = []) {
    let best = ladderNear(after, x, y)
    for (let ny = y - NEAR; ny <= y + NEAR; ++ny) {
        for (let nx = x - NEAR; nx <= x + NEAR; ++nx) {
            if (!inBoard(nx, ny) || after.at(nx, ny) !== EMPTY) { continue }
            const reply = tryPlay(after, nx, ny, after.toPlay)
            if (reply) { best = longer(ladderNear(reply, nx, ny), best) }
        }
    }
    // The same position can come up more than once (a sequence the comments link to, and the same
    // moves in the joseki tree); each is read once
    const read = new Set()
    for (const extra of more) {
        const key = `${extra.position.stones.join('')}${extra.position.toPlay}:${extra.x},${extra.y}`
        if (read.has(key)) { continue }
        read.add(key)
        best = longer(ladderNear(extra.position, extra.x, extra.y), best)
    }
    return best
}

/**
 * Where to put a stone of `color` that decides `ladder` (from findLadder) in its favor: on the
 * ladder's path, where it first reaches the fourth line on the far side of the board. Checked by
 * reading the ladder again with the stone there: it must then catch the other side's runner, or
 * let `color`'s own runner escape. Returns { x, y } or null.
 */
export function ladderStoneOnPath(ladder, color) {
    const { path, start } = ladder
    const works = (point) => {
        const withStone = tryPlay(start.position, point.x, point.y, color)
        if (!withStone || withStone.at(start.x, start.y) !== ladder.runner) { return false }
        const { captured } = readLadder(withStone, start.x, start.y, start.chaserToMove)
        return ladder.runner === color ? !captured : captured
    }
    const first = path[0]
    const last = path.at(-1)
    const farX = last.x < first.x ? 3 : SIZE - 4
    const farY = last.y < first.y ? 3 : SIZE - 4
    const crossing = path.findIndex((p) => p.x === farX || p.y === farY)
    if (crossing === -1) { return null }
    // From where it crosses the fourth line, the first point where the stone works
    for (const point of path.slice(crossing)) {
        if (start.position.at(point.x, point.y) === EMPTY && works(point)) { return { x: point.x, y: point.y } }
    }
    return null
}
