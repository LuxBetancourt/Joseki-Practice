// Pure Go rules: board representation, captures, suicide and ko.
// Coordinates follow SGF/Josekipedia: "pd" means x = 'p' (column), y = 'd' (row from top).

export const SIZE = 19
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2
export const PASS = 'tt'

const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRST' // Go boards skip "I"

export const opponent = (color) => (color === BLACK ? WHITE : BLACK)
export const colorName = (color) => (color === BLACK ? 'black' : 'white')

export function toSgf(x, y) {
    return String.fromCharCode(97 + x, 97 + y)
}

/** Returns {x, y} for an on-board SGF coordinate, or null for passes / invalid input. */
export function fromSgf(coord) {
    if (typeof coord !== 'string' || coord.length !== 2 || coord === PASS) { return null }
    const x = coord.charCodeAt(0) - 97
    const y = coord.charCodeAt(1) - 97
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) { return null }
    return { x, y }
}

/** "pd" -> "Q16" */
export function sgfToDisplay(coord) {
    const point = fromSgf(coord)
    if (!point) { return 'Pass' }
    return COLUMN_LETTERS[point.x] + (SIZE - point.y)
}

/** "q16" / "Q16" -> "pd", or null */
export function displayToSgf(text) {
    const match = /^([a-hj-t])(\d{1,2})$/i.exec(text.trim())
    if (!match) { return null }
    const x = COLUMN_LETTERS.indexOf(match[1].toUpperCase())
    const row = Number(match[2])
    if (row < 1 || row > SIZE) { return null }
    return toSgf(x, SIZE - row)
}

export const columnLabel = (x) => COLUMN_LETTERS[x]
export const rowLabel = (y) => String(SIZE - y)

const index = (x, y) => y * SIZE + x

function neighbors(i) {
    const x = i % SIZE
    const y = (i - x) / SIZE
    const result = []
    if (x > 0) { result.push(i - 1) }
    if (x < SIZE - 1) { result.push(i + 1) }
    if (y > 0) { result.push(i - SIZE) }
    if (y < SIZE - 1) { result.push(i + SIZE) }
    return result
}

/** Flood-fills the group containing `start`; returns its stones and whether it has any liberty. */
function group(stones, start) {
    const color = stones[start]
    const seen = new Uint8Array(SIZE * SIZE)
    const members = []
    const stack = [start]
    let hasLiberty = false
    seen[start] = 1
    while (stack.length) {
        const i = stack.pop()
        members.push(i)
        for (const n of neighbors(i)) {
            if (seen[n]) { continue }
            if (stones[n] === EMPTY) {
                hasLiberty = true
            }
            else if (stones[n] === color) {
                seen[n] = 1
                stack.push(n)
            }
        }
    }
    return { members, hasLiberty }
}

export class IllegalMoveError extends Error {
    constructor(reason) {
        super({
            occupied: 'There is already a stone there.',
            suicide: 'That move is illegal (self-capture).',
            ko: 'That move is illegal (ko). Play elsewhere first.',
        }[reason] || 'Illegal move.')
        this.reason = reason
    }
}

/** An immutable board position. */
export class Position {
    constructor(stones = new Uint8Array(SIZE * SIZE), toPlay = BLACK, koPoint = -1, captures = [0, 0, 0]) {
        this.stones = stones
        this.toPlay = toPlay
        this.koPoint = koPoint
        this.captures = captures // indexed by capturing color
    }

    at(x, y) {
        return this.stones[index(x, y)]
    }

    /**
     * Plays a stone and returns the resulting position. `color` defaults to the side to play,
     * but can be given explicitly since joseki trees sometimes skip turns.
     * Throws IllegalMoveError for occupied points, suicide and ko.
     */
    play(x, y, color = this.toPlay) {
        const i = index(x, y)
        if (this.stones[i] !== EMPTY) { throw new IllegalMoveError('occupied') }
        if (i === this.koPoint && color === this.toPlay) { throw new IllegalMoveError('ko') }

        const stones = this.stones.slice()
        stones[i] = color
        const enemy = opponent(color)
        const captured = []

        for (const n of neighbors(i)) {
            if (stones[n] !== enemy) { continue }
            const g = group(stones, n)
            if (!g.hasLiberty) {
                for (const m of g.members) {
                    stones[m] = EMPTY
                    captured.push(m)
                }
            }
        }

        const own = group(stones, i)
        if (!own.hasLiberty) { throw new IllegalMoveError('suicide') }

        // Simple ko: a single stone captured a single stone and is left in atari.
        let koPoint = -1
        if (captured.length === 1 && own.members.length === 1) {
            const liberties = neighbors(i).filter((n) => stones[n] === EMPTY)
            if (liberties.length === 1) { koPoint = captured[0] }
        }

        const captures = this.captures.slice()
        captures[color] += captured.length
        return new Position(stones, enemy, koPoint, captures)
    }

    pass(color = this.toPlay) {
        return new Position(this.stones, opponent(color), -1, this.captures)
    }

    /** Plays an SGF coordinate ("tt" or empty for pass). */
    playSgf(coord, color = this.toPlay) {
        const point = fromSgf(coord)
        return point ? this.play(point.x, point.y, color) : this.pass(color)
    }

    /** True if both positions have the same stones (ignoring whose turn it is). */
    sameStones(other) {
        return this.stones.every((color, i) => color === other.stones[i])
    }

    isLegal(x, y, color = this.toPlay) {
        try {
            this.play(x, y, color)
            return true
        }
        catch (e) {
            if (e instanceof IllegalMoveError) { return false }
            throw e
        }
    }
}
