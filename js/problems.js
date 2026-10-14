// Generates problems by walking random joseki lines through Josekipedia.
// Each step costs one node lookup, so walks stop at a random target depth.

import { Position, PASS, SIZE, EMPTY, BLACK, WHITE, fromSgf, toSgf, opponent } from './go.js'
import { ROOT_ID, MoveType, TENUKI_LABEL } from './josekipedia.js'
import { CLASSIC_OPENINGS } from './starting-points.js'
import { mainLine } from './lines.js'

const MAX_TARGET_DEPTH = 12
const MAX_DEPTH = 30
// How many candidates the generators check before giving up on a walk. Most lookups along the
// walk are already cached, so trying several is cheap and makes failures much rarer.
const MAX_MISTAKES_CHECKED = 10
const MAX_LINES_CHECKED = 6
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
    // Counted from the starting point, so deep starting points still get walked into
    const targetDepth = Math.max(MIN_MOVES, state.moves.length + 1) + Math.floor(random() * (MAX_TARGET_DEPTH - MIN_MOVES + 1))
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
        // The punishment is the ideal answer, or failing that a good one
        if ([...answers.values()].some((type) => type === MoveType.IDEAL || type === MoveType.GOOD)) {
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
    const candidates = []
    await walk(await replay(startMoves, getNode), { firstTen, getNode, random }, (state) => {
        const suitable = state.position.toPlay === color && state.moves.length >= MIN_MOVES
            && josekiMoves(state.node, state.position, firstTen).length >= 2
        if (suitable) { candidates.push(state) }
        return suitable
    })

    // Deepest position first; at each, the player's joseki moves in random order
    let checked = 0
    for (const state of candidates.reverse()) {
        for (const child of shuffle(josekiMoves(state.node, state.position, firstTen), random)) {
            if (++checked > MAX_LINES_CHECKED) { return null }
            const after = await step(state, child, getNode)
            const rest = await mainLine({ node: after.node, position: after.position, getNode })
            const line = [{ move: child.move, color: child.color }, ...rest.moves]
            if (line.length <= MAX_SHAPE_LINE && line.filter((m) => m.color === color).length >= 2) {
                return { moves: state.moves, answers: answerTypes(state.node, color), answer: child.move, line, target: rest.position }
            }
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

    // Deepest first, find a position whose main line is a sensible length and that has enough
    // wrong sequences to go with it
    for (const state of candidates.reverse().slice(0, MAX_LINES_CHECKED)) {
        const main = await mainLine({ node: state.node, position: state.position, getNode })
        if (main.moves.length < MIN_PATH_LINE || main.moves.length > MAX_PATH_LINE) { continue }
        const options = await pathOptions(state, main, { getNode, random })
        if (options) { return { moves: state.moves, line: main.moves, options } }
    }
    return null
}

/** The joseki line plus PATH_OPTIONS - 1 sequences branching off it, shuffled; or null. */
async function pathOptions(chosen, main, { getNode, random }) {
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

    return options.length < PATH_OPTIONS ? null : shuffle(options, random)
}

/** The kind-specific part of a problem as plain data, so it can be saved for review. */
export function problemData(kind, problem) {
    switch (kind) {
        case 'punish': return { mistake: problem.mistake }
        case 'shape': return { answer: problem.answer, line: problem.line }
        case 'path': return { line: problem.line, options: problem.options.map(({ line, mistake }) => ({ line, mistake })) }
        case 'better': return { answer: problem.answer, labels: problem.labels }
        case 'tenuki': return { answer: problem.answer, inferredFrom: problem.inferredFrom }
        default: return {}
    }
}

/**
 * Rebuilds a saved problem ({ kind, moves, color, data }) in the same shape the generators
 * return. Throws if Josekipedia no longer has the position.
 * Saved reviews keep all of problemData; links keep only what can't be worked out again from
 * Josekipedia (see compactData), and the rest is filled in here.
 */
export async function rebuildProblem({ kind, moves, color, data }, { getNode, random = Math.random }) {
    const { node, position } = await replay(moves, getNode)
    const answers = answerTypes(node, color)
    const stale = (what) => { throw new StaleProblemError(`Saved ${what} problem no longer fits the position`) }
    switch (kind) {
        case 'punish': {
            // The mistake is the last move
            const before = await replay(moves.slice(0, -1), getNode)
            const last = before.node.children.find((child) => child.move === moves.at(-1) && child.color === before.position.toPlay)
            return { moves, answers, mistake: data.mistake || { move: last.move, type: last.type } }
        }
        case 'shape': {
            let line = data.line
            if (!line) {
                const child = node.children.find((c) => c.move === data.answer && c.color === color) || stale('shape')
                const rest = await mainLine({ node: await getNode(child.id), position: position.playSgf(child.move, child.color), getNode })
                line = [{ move: child.move, color: child.color }, ...rest.moves]
            }
            const target = playLine(position, line) || stale('shape')
            return { moves, answers, answer: data.answer, line, target }
        }
        case 'path': {
            const saved = data.options || await pathFromPicks({ node, position }, data.picks, getNode)
            const options = saved.map(({ line, mistake }) => ({ line, mistake, position: playLine(position, line) }))
            if (options.some((option) => !option.position)) { stale('path') }
            return { moves, line: data.line || options.find((option) => !option.mistake).line, options: shuffle(options, random) }
        }
        case 'better': {
            const labels = data.labels || node.labels
            return { moves, answers, answer: data.answer || outcomeOf(labels) || stale("who's better"), labels }
        }
        case 'tenuki': {
            const answer = data.answer || (data.inferredFrom ? 'no' : tenukiVerdict(node, color)) || stale('tenuki')
            return { moves, answers, answer, inferredFrom: data.inferredFrom }
        }
        default:
            return { moves, answers }
    }
}

/**
 * Pick the Path's options from the joseki line and where the others branch off it, as
 * pathOptions makes them: a recorded mistake continues as Josekipedia does, a made-up one stops.
 */
async function pathFromPicks(start, picks, getNode) {
    const main = await mainLine({ ...start, getNode })
    const options = [{ line: main.moves }]
    for (const { step, move, stops } of picks) {
        const state = main.states[step]
        if (!state) { throw new StaleProblemError('Saved path problem no longer fits the position') }
        const color = state.position.toPlay
        const known = state.node.children.find((child) => child.move === move && child.color === color)
        let line = [...main.moves.slice(0, step), { move, color }]
        if (!stops && known) {
            const rest = await mainLine({ node: await getNode(known.id), position: state.position.playSgf(move, color), getNode })
            line = [...line, ...rest.moves].slice(0, main.moves.length + 2)
        }
        options.push({ line, mistake: { step, move, color, type: known ? known.type : null } })
    }
    return options
}

const KINDS = ['next', 'punish', 'shape', 'path', 'better', 'tenuki']

// --- Spare problems -----------------------------------------------------------------
// Who's Better? and Tenuki-able? choose their answer first, so a walk often passes positions that
// fit other answers. Rather than throw those away, they're kept (in memory, for this visit) and
// used when a later walk can't find the answer it wants. Each is used at most once.

const MAX_SPARES = 40 // Per kind and answer
const spares = new Map() // "kind:answer" -> [problem]

function stashSpare(kind, problem) {
    const key = `${kind}:${problem.answer}`
    const list = spares.get(key) || []
    if (list.some((p) => p.moves.join('') === problem.moves.join(''))) { return }
    list.push(problem)
    if (list.length > MAX_SPARES) { list.shift() }
    spares.set(key, list)
}

/** A stashed problem with this answer from the given starting point (and for `color`, if it says), removed from the stash. */
function takeSpare(kind, answer, startMoves, color) {
    const list = spares.get(`${kind}:${answer}`) || []
    const index = list.findIndex((p) => startMoves.every((move, i) => p.moves[i] === move) && (!color || p.color === color))
    return index === -1 ? null : list.splice(index, 1)[0]
}

/** Forgets every stashed problem (for tests). */
export function clearSpares() {
    spares.clear()
}

// --- Who's Better? -----------------------------------------------------------------

// Josekipedia's verdict labels: good / slightly good for one side, the other side collapsing, even
const OUTCOME_LABELS = { black: [2, 46, 20], white: [1, 47, 21], even: [45] }
export const OUTCOMES = Object.keys(OUTCOME_LABELS)

/** 'black' | 'white' | 'even' from a move's labels, or null if they don't say (or disagree). */
export function outcomeOf(labels) {
    const found = OUTCOMES.filter((outcome) => OUTCOME_LABELS[outcome].some((label) => labels.includes(label)))
    return found.length === 1 ? found[0] : null
}

/**
 * "Who's better?" problem: a position Josekipedia gives a verdict on (good for Black, even, good
 * for White). The answer is chosen first, evenly, and then searched for, since most verdicts are
 * "even"; returns null if this walk doesn't find one.
 * Returns { moves, answer, labels } or null.
 */
export async function generateWhosBetter(options) {
    const want = pick(OUTCOMES, options.random || Math.random)
    // A scarce answer gets a second walk, so failing doesn't tilt problems toward the common one
    return await findWhosBetter(want, options) || await findWhosBetter(want, options)
}

async function findWhosBetter(want, { startMoves, firstTen, getNode, random = Math.random }) {
    const found = [] // Positions with any verdict: the wanted ones are used, the rest stashed
    await walk(await replay(startMoves, getNode), { firstTen, getNode, random }, (state) => {
        // The verdicts are on the moves from here, which the node already lists
        for (const child of state.node.children) {
            const answer = outcomeOf(child.labels)
            if (!answer || child.move === PASS || state.moves.length + 1 < MIN_MOVES || !isLegal(state.position, child)) { continue }
            found.push({ moves: [...state.moves, child.move], answer, labels: child.labels })
        }
        return found.some((problem) => problem.answer === want)
    })
    const wanted = found.filter((problem) => problem.answer === want)
    const chosen = wanted.length ? pick(wanted, random) : takeSpare('better', want, startMoves)
    found.filter((problem) => problem !== chosen).forEach((problem) => stashSpare('better', problem))
    return chosen
}

// --- Tenuki-able? -------------------------------------------------------------------

const NECESSARY_LABEL = 15

/**
 * Whether `color` can tenuki in this position, by Josekipedia, or null if it doesn't say.
 * Yes: a "can tenuki" label, or tenuki recorded as a joseki (ideal/good) move. No: tenuki recorded
 * as a bad move, or a local move marked "Necessary". (A missing label isn't evidence either way.)
 */
export function tenukiVerdict(node, color) {
    const pass = node.children.find((child) => child.move === PASS && child.color === color)
    const necessary = node.children.some((child) => child.color === color && child.move !== PASS && child.labels.includes(NECESSARY_LABEL))
    const no = pass?.type === MoveType.BAD || necessary
    const yes = node.labels.includes(TENUKI_LABEL[color]) || pass?.type === MoveType.IDEAL || pass?.type === MoveType.GOOD
    if (yes === no) { return null } // No evidence, or contradictory evidence
    return yes ? 'yes' : 'no'
}

const SETTLED_LABEL = 23
const MAX_INFERRED_CHECKED = 4
// How often to look for "yes" rather than "no", tuned by simulation so the problems players
// actually see come out about even (with the second walk and the stash, "yes" is the easier find)
const AIM_FOR_YES = 0.4

/**
 * The joseki move that would make a position an inferred "no" for `color`, or null. Josekipedia
 * rarely says outright that tenuki is wrong, so "no" is also inferred (more weakly) when nothing
 * marks tenuki as playable, the position isn't settled, and the main line continues with this
 * player's local move. The caller also checks the sequence carries on after that move.
 */
function inferredNoMove(node, color) {
    if (tenukiVerdict(node, color) !== null || node.labels.includes(SETTLED_LABEL)) { return null }
    if (node.children.some((child) => child.move === PASS && child.color === color)) { return null } // Tenuki is recorded, as neither joseki nor bad
    return node.children.find((child) => child.color === color && child.type === MoveType.IDEAL && child.move !== PASS) || null
}

/**
 * "Tenuki-able?" problem: a position where `color` is to play and can or can't play elsewhere.
 * The answer is chosen first (see AIM_FOR_YES). Recorded evidence (tenukiVerdict) is preferred;
 * failing that, "no" is inferred from the joseki carrying on locally (see inferredNoMove).
 * Returns { moves, answer, color, inferredFrom? } (the side asked about, and for an inferred "no"
 * the local move the joseki continues with) or null.
 */
export async function generateTenuki(options) {
    const want = (options.random || Math.random)() < AIM_FOR_YES ? 'yes' : 'no'
    // A scarce answer gets a second walk, so failing doesn't tilt problems toward the common one
    return await findTenuki(want, options) || await findTenuki(want, options)
}

async function findTenuki(want, { startMoves, color, firstTen, getNode, random = Math.random }) {
    const recorded = [] // Positions with recorded evidence either way: the wanted ones are used, the rest stashed
    const inferred = []
    await walk(await replay(startMoves, getNode), { firstTen, getNode, random }, (state) => {
        if (state.moves.length < MIN_MOVES || state.position.toPlay !== color) { return false }
        const answer = tenukiVerdict(state.node, color)
        if (answer) { recorded.push({ moves: state.moves, answer, color }) }
        if (answer === want) { return true }
        const move = want === 'no' && !answer && inferredNoMove(state.node, color)
        if (move) { inferred.push({ state, move }) }
        return false
    })
    const wanted = recorded.filter((problem) => problem.answer === want)
    const chosen = wanted.length ? pick(wanted, random) : null
    recorded.filter((problem) => problem !== chosen).forEach((problem) => stashSpare('tenuki', problem))
    if (chosen) { return chosen }

    // An inferred "no" needs the sequence to carry on after the local move: the other side has a
    // joseki reply, so the exchange isn't finished
    for (const { state, move } of inferred.reverse().slice(0, MAX_INFERRED_CHECKED)) {
        const after = await getNode(move.id)
        const continues = !after.labels.includes(SETTLED_LABEL)
            && after.children.some((child) => child.color !== move.color && child.type === MoveType.IDEAL && child.move !== PASS)
        if (continues) {
            return { moves: state.moves, answer: 'no', color, inferredFrom: move.move }
        }
    }
    return takeSpare('tenuki', want, startMoves, color)
}

// --- A problem from a chosen position ---------------------------------------------
// For saving an Explore position to Review: the given type of problem at exactly this position,
// held to the same standards as the generators.

/**
 * The `kind` of problem at the position after `moves`, for the side to play (or `color`, for
 * Who's Better?, which doesn't depend on whose turn it is). Returns { problem } in the shape the
 * generators return (with its color), or { why } saying why this position can't be one.
 */
export async function problemAt(kind, moves, { color, firstTen = false, getNode, random = Math.random }) {
    const state = await replay(moves, getNode)
    const { node, position } = state
    const toPlay = position.toPlay
    const side = toPlay === BLACK ? 'Black' : 'White'
    const answers = answerTypes(node, toPlay)
    const hasAnswer = (types) => node.children.some((child) => child.color === toPlay && child.move !== PASS && types.includes(child.type))
    const none = (why) => ({ why })

    switch (kind) {
        case 'next':
            if (!hasAnswer([MoveType.IDEAL, MoveType.GOOD])) { return none(`No joseki move for ${side} here`) }
            return { problem: { moves, answers, color: toPlay } }
        case 'punish': {
            if (!moves.length) { return none('No move to punish yet') }
            const before = await replay(moves.slice(0, -1), getNode)
            const last = before.node.children.find((child) => child.move === moves.at(-1) && child.color === before.position.toPlay)
            if (last.type !== MoveType.BAD && last.type !== MoveType.TRICK) { return none('The last move isn’t a mistake') }
            if (!hasAnswer([MoveType.IDEAL, MoveType.GOOD])) { return none('Josekipedia doesn’t record how to punish it') }
            return { problem: { moves, answers, mistake: { move: last.move, type: last.type }, color: toPlay } }
        }
        case 'shape': {
            const choices = josekiMoves(node, position, firstTen)
            if (choices.length < 2) { return none(`${side} needs a choice of joseki moves here`) }
            for (const child of choices) {
                const after = await step(state, child, getNode)
                const rest = await mainLine({ node: after.node, position: after.position, getNode })
                const line = [{ move: child.move, color: child.color }, ...rest.moves]
                if (line.length <= MAX_SHAPE_LINE && line.filter((m) => m.color === toPlay).length >= 2) {
                    return { problem: { moves, answers, answer: child.move, line, target: rest.position, color: toPlay } }
                }
            }
            return none('The joseki from here is too short or too long')
        }
        case 'path': {
            if (!josekiMoves(node, position, false).length) { return none(`No joseki move for ${side} here`) }
            const main = await mainLine({ node, position, getNode })
            if (main.moves.length < MIN_PATH_LINE || main.moves.length > MAX_PATH_LINE) { return none('The joseki from here is too short or too long') }
            const options = await pathOptions(state, main, { getNode, random })
            if (!options) { return none('Not enough other sequences from here') }
            return { problem: { moves, line: main.moves, options, color: toPlay } }
        }
        case 'better': {
            const answer = outcomeOf(node.labels)
            if (!answer) { return none('Josekipedia doesn’t say who’s better here') }
            return { problem: { moves, answers: answerTypes(node, color), answer, labels: node.labels, color } }
        }
        case 'tenuki': {
            const answer = tenukiVerdict(node, toPlay)
            if (answer) { return { problem: { moves, answer, color: toPlay } } }
            const move = inferredNoMove(node, toPlay)
            if (move) {
                const after = await getNode(move.id)
                const continues = !after.labels.includes(SETTLED_LABEL)
                    && after.children.some((child) => child.color !== move.color && child.type === MoveType.IDEAL && child.move !== PASS)
                if (continues) { return { problem: { moves, answer: 'no', color: toPlay, inferredFrom: move.move } } }
            }
            return none(`Josekipedia doesn’t say whether ${side} can tenuki here`)
        }
        default:
            return none('Unknown problem type')
    }
}

// Problem links: a letter for the kind, one for the color, the moves, then anything that can't be
// worked out again from Josekipedia, each after a dot. For example "sbpdqfncqcpc.qe" is a Final
// Shape problem for Black after pd qf nc qc pc, whose answer is qe.
const KIND_CODES = { next: 'n', punish: 'p', shape: 's', path: 'l', better: 'b', tenuki: 't' }
const MOVE = '[a-t]{2}'

/** A saved problem ({ kind, moves, color, data }) as a short, URL-safe string, for sharing. */
export function encodeProblem({ kind, moves, color, data }) {
    return [`${KIND_CODES[kind]}${color === BLACK ? 'b' : 'w'}${moves.join('')}`, ...compactData(kind, data)].join('.')
}

/** The parts of problemData a link needs; rebuildProblem works out the rest. */
function compactData(kind, data) {
    switch (kind) {
        case 'shape': return [data.answer]
        // Where each wrong sequence leaves the joseki: "3qd", or "3qd-" if it stops there
        case 'path': return data.options.filter((option) => option.mistake).map(({ line, mistake: { step, move } }) =>
            `${step}${move}${line.length === step + 1 ? '-' : ''}`)
        case 'tenuki': return data.inferredFrom ? [data.inferredFrom] : []
        default: return []
    }
}

/** The reverse of encodeProblem (and of the older, longer JSON links). Throws if the text isn't a problem link. */
export function decodeProblem(text) {
    const match = new RegExp(`^([npslbt])([bw])((?:${MOVE})*)((?:\\.[0-9a-t-]+)*)$`).exec(text)
    if (!match) { return decodeLegacyProblem(text) }
    const [, code, colorCode, moves, rest] = match
    const kind = KINDS.find((k) => KIND_CODES[k] === code)
    const extras = rest.split('.').slice(1)
    const fail = () => { throw new Error('Not a problem link') }
    const one = () => (extras.length === 1 && new RegExp(`^${MOVE}$`).test(extras[0]) ? extras[0] : fail())
    let data = {}
    if (kind === 'shape') { data = { answer: one() } }
    else if (kind === 'tenuki' && extras.length) { data = { inferredFrom: one() } }
    else if (kind === 'path') {
        data = {
            picks: extras.map((extra) => {
                const pick = new RegExp(`^(\\d+)(${MOVE})(-?)$`).exec(extra) || fail()
                return { step: Number(pick[1]), move: pick[2], stops: pick[3] === '-' }
            }),
        }
        if (!data.picks.length) { fail() }
    }
    else if (extras.length) { fail() }
    return { kind, moves: moves.match(/../g) || [], color: colorCode === 'b' ? BLACK : WHITE, data }
}

/** Links from before the short format: base64 JSON of the whole problem. */
function decodeLegacyProblem(text) {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
    const { k, m, c, d } = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)))
    if (!KINDS.includes(k) || typeof m !== 'string' || !/^(?:[a-t]{2})+$/.test(m)
        || (c !== BLACK && c !== WHITE) || typeof d !== 'object' || d === null) {
        throw new Error('Not a problem link')
    }
    return { kind: k, moves: m.match(/../g), color: c, data: d }
}
