import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Position, BLACK, WHITE } from '../js/go.js'
import { readLadder, ladderNear, ladderStoneOnPath, groupAt } from '../js/ladder.js'

/** A position with these stones, and `toPlay` to move. */
function board(stones, toPlay = BLACK) {
    const position = stones.reduce((p, [x, y, color]) => p.play(x, y, color), new Position())
    return new Position(position.stones, toPlay)
}

// A white stone in the middle that Black can ladder towards the bottom left (another white stone
// stops the ladder going the other way)
const LADDER = [[9, 10, BLACK], [10, 9, BLACK], [11, 11, BLACK], [10, 10, WHITE], [14, 6, WHITE]]

test('a ladder on an empty board runs to the edge and captures', () => {
    const { captured, path } = readLadder(board(LADDER), 10, 10, true)
    assert.ok(captured)
    assert.ok(path.length >= 6, `ran ${path.length} moves`)
    const last = path.at(-1)
    assert.ok([0, 18].includes(last.x) || [0, 18].includes(last.y) || [1, 17].includes(last.x) || [1, 17].includes(last.y), 'ends near an edge')
})

test('a stone of the runner on the path breaks the ladder', () => {
    const { path } = readLadder(board(LADDER), 10, 10, true)
    const breaker = path[Math.floor(path.length / 2)]
    const broken = board([...LADDER, [breaker.x, breaker.y, WHITE]])
    assert.equal(readLadder(broken, 10, 10, true).captured, false)
})

test('a group with three liberties is not a ladder, and one in atari with the runner to move still runs', () => {
    assert.equal(readLadder(board([[10, 10, WHITE]]), 10, 10, true).captured, false)
    const atari = board([[9, 10, BLACK], [10, 9, BLACK], [11, 11, BLACK], [11, 10, BLACK], [10, 10, WHITE]], WHITE)
    assert.equal(groupAt(atari, 10, 10).liberties.length, 1)
    assert.ok(readLadder(atari, 10, 10, false).path.length > 0, 'the runner extends')
})

test('the decisive stone lies on the path, on the far fourth line, and works for its color', () => {
    const position = board(LADDER)
    const ladder = ladderNear(position, 10, 10)
    assert.ok(ladder)
    assert.equal(ladder.runner, WHITE)
    for (const color of [WHITE, BLACK]) {
        const stone = ladderStoneOnPath(ladder, color)
        assert.ok(stone, `a stone for ${color === BLACK ? 'Black' : 'White'}`)
        assert.ok(ladder.path.some((p) => p.x === stone.x && p.y === stone.y), 'on the path')
        assert.ok([3, 15].includes(stone.x) || [3, 15].includes(stone.y), 'on a fourth line')
        const withStone = board([...LADDER, [stone.x, stone.y, color]])
        assert.equal(readLadder(withStone, 10, 10, true).captured, color === BLACK, 'decides it for that color')
    }
})
