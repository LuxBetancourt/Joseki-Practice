import { Position, IllegalMoveError, EMPTY, BLACK, WHITE, PASS, toSgf, fromSgf, sgfToDisplay, colorName } from './go.js'
import { getNode, prefetch, ROOT_ID, MoveType, MOVE_TYPE_NAMES, TENUKI_LABEL, labelText } from './josekipedia.js'
import {
    generateNextMove, generatePunish, generateFinalShape, generatePickPath, generateWhosBetter, generateTenuki, generateSente, senteOptionsAt,
    problemData, rebuildProblem, StaleProblemError, encodeProblem, decodeProblem, problemAt, ladderSetup,
} from './problems.js'
import { ReviewDeck, reviewKey, relativeTime } from './reviews.js'
import { orderKinds, addRecentKind, seenKey, addSeen } from './problem-mix.js'
import { mainLine } from './lines.js'
import { renderShape, shapeRegion, localShape } from './shape-view.js'
import { parseComment, splitPath, cleanText } from './text.js'
import { describeSource } from './sources.js'
import { BoardView, markShape } from './board-view.js'
import { JOSEKI, FUSEKI, CLASSIC_OPENINGS } from './starting-points.js'
import { JOSEKIPEDIA_URL } from './config.js'

const $ = (selector) => document.querySelector(selector)

// --- Settings ------------------------------------------------------------------

const DEFAULT_SETTINGS = {
    mode: 'problems', // 'explore' | 'problems' | 'review'
    problemTypes: { next: true, punish: true, shape: true, path: true, better: true, tenuki: true, sente: true },
    player: 'black',
    ideal: true, good: false, bad: false, trick: false, question: false,
    firstTen: true,
    onlyPassIfJoseki: false,
    showMoves: false,
    showMoveInfo: true,
    showFollowUps: false,
    autoAdvance: false, // Go to the next problem automatically after solving one
    shapeBothSides: false, // In Final Shape, the player plays the other side's moves too
    expanded: [], // Starting-point branches the player has expanded
    start: 'empty',
}

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem('settings'))
        if (saved) {
            // Next Move, Punish and Final Shape used to be separate modes, and Explore was Practice
            if (['next', 'punish', 'shape'].includes(saved.mode)) { saved.mode = 'problems' }
            if (saved.mode === 'practice') { saved.mode = 'explore' }
            return { ...DEFAULT_SETTINGS, ...saved, problemTypes: { ...DEFAULT_SETTINGS.problemTypes, ...saved.problemTypes } }
        }

        // Migrate settings saved by the previous version of the site
        const legacy = {}
        const map = { ideal: 'ideal', good: 'good', bad: 'bad', trick: 'trick', question: 'question', firstTen: 'firstTen', noPass: 'onlyPassIfJoseki', showMoveInfo: 'showMoveInfo' }
        for (const [oldKey, newKey] of Object.entries(map)) {
            const value = localStorage.getItem(oldKey)
            if (value !== null) { legacy[newKey] = value === 'true' }
        }
        if (['black', 'white'].includes(localStorage.getItem('player'))) { legacy.player = localStorage.getItem('player') }
        return { ...DEFAULT_SETTINGS, ...legacy }
    }
    catch {
        return { ...DEFAULT_SETTINGS }
    }
}

function saveSettings() {
    try { localStorage.setItem('settings', JSON.stringify(settings)) }
    catch { /* storage unavailable */ }
}

// The types of the last few problems (oldest first), so types that haven't come up lately can be
// favored (see problem-mix.js). Kept across visits, as a session is often only a few problems.
// The problems seen lately (see problem-mix.js) are kept the same way.
const loadList = (key) => {
    try {
        const saved = JSON.parse(localStorage.getItem(key))
        return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : []
    }
    catch { return [] }
}
const saveList = (key, list) => {
    try { localStorage.setItem(key, JSON.stringify(list)) }
    catch { /* storage unavailable */ }
}
let recentKinds = loadList('recentKinds')
let seenProblems = new Set(loadList('seenProblems'))
// How many times each problem type's banner has been shown, so it can get quicker (see showTypeBanner)
const bannerViews = (() => {
    try {
        const saved = JSON.parse(localStorage.getItem('bannerViews'))
        return saved && typeof saved === 'object' ? saved : {}
    }
    catch { return {} }
})()

function noteShown(kind, moves) {
    recentKinds = addRecentKind(recentKinds, kind)
    saveList('recentKinds', recentKinds)
    const seen = addSeen([...seenProblems], seenKey(kind, moves))
    seenProblems = new Set(seen)
    saveList('seenProblems', seen)
}

const settings = loadSettings()
// In Review mode the player takes the color they missed the problem with
const humanColor = () => (settings.mode === 'review' && problem ? problem.spec.color : settings.player === 'black' ? BLACK : WHITE)

// --- Game state ----------------------------------------------------------------
// history[i] is the position after i moves. Each entry's `node` is the Josekipedia node for
// the move that produced it: undefined = not looked up yet, null = not in Josekipedia,
// otherwise a node (which has `children` once fully loaded).

let history = []
let current = 0
let freePlay = false
let busy = false
// Bumped whenever the game is navigated; async work started earlier checks it and bails out.
let generation = 0

// The active problem in Problems mode: the player must answer at history[index].
//   kind: 'next' | 'punish' | 'shape'
//   answers: Map of coord -> move type for every move Josekipedia knows there
//   mistake: { move, type } for punish problems
//   answer, line, target, step, missed, hint: for shape problems, the move that starts the
//                         line, the line itself and the final position it reaches; how many of
//                         its moves have been played; whether the player has gone wrong; and
//                         whether their next move is highlighted
//   line, options, wrong: for path problems, the joseki line, the sequences shown (see
//                         generatePickPath) and the indexes of options already picked wrongly
//   spec:      the problem as plain data, saved to the review deck if the player misses it
//   reviewKey: set when the problem is a review from the deck
let problem = null
const stats = { // This session's score per mode
    next: { solved: 0, attempted: 0 },
    punish: { solved: 0, attempted: 0 },
    shape: { solved: 0, attempted: 0 },
    path: { solved: 0, attempted: 0 },
    better: { solved: 0, attempted: 0 },
    tenuki: { solved: 0, attempted: 0 },
    sente: { solved: 0, attempted: 0 },
}
const GENERATORS = {
    next: generateNextMove, punish: generatePunish, shape: generateFinalShape, path: generatePickPath,
    better: generateWhosBetter, tenuki: generateTenuki, sente: generateSente,
}
// Shown on the banner that introduces each problem
const PROBLEM_TYPE_GOALS = {
    next: 'Find the joseki move', punish: 'Punish the mistake', shape: 'Play out the faded shape',
    path: 'Pick the joseki sequence', better: 'Judge the position', tenuki: 'Can you play elsewhere?',
    sente: 'End the joseki with sente',
}
const PROBLEM_TYPE_NAMES = {
    next: 'Next Move', punish: 'Punish', shape: 'Final Shape', path: 'Pick the Path', better: 'Who’s Better?', tenuki: 'Tenuki-able?',
    sente: 'Play for Sente',
}
// Problems answered with buttons rather than on the board, and the answers they offer
const ANSWER_CHOICES = {
    better: [['black', 'Black is better'], ['even', 'Even'], ['white', 'White is better']],
    tenuki: [['yes', 'Tenuki is fine'], ['no', 'Must play locally']], // Shown with a stone of the side asked about
}
const enabledProblemTypes = () => Object.keys(GENERATORS).filter((kind) => settings.problemTypes[kind])

// Problems the player missed come back for review (see reviews.js). In Problems mode, Next mixes
// due reviews in; Review mode works through every due review.
const deck = new ReviewDeck()
const REVIEW_MIX = 1 / 3 // Chance that Next serves a due review instead of a new problem
const TRIES_PER_TYPE = 4 // Random walks a problem type gets before Next moves on to another type
const startPath = () => (settings.start === 'empty' || settings.start === 'demo' ? '' : settings.start)
const dueReviews = () => (settings.mode === 'review'
    ? deck.due()
    : deck.due({ kinds: enabledProblemTypes(), color: humanColor(), startMoves: splitPath(startPath()) }))

/** Updates the review deck with how the player did on their first attempt at the problem. */
function recordFirstAttempt(correct) {
    if (!correct) { deck.recordMiss(problem.spec) }
    else if (problem.reviewKey) { deck.recordSuccess(problem.reviewKey) }
}
const problemPending = () => problem && !problem.solved && !problem.revealed
// Where the player answers: shape problems move along their line as the player plays it out
const answerIndex = () => problem.index + (['shape', 'sente'].includes(problem.kind) ? problem.step : 0)
// Final Shape, Play for Sente and Pick the Path follow a fixed sequence, so moving around the game would break them
const navigationLocked = () => problemPending() && ['shape', 'sente', 'path', 'better', 'tenuki'].includes(problem.kind)

const currentEntry = () => history[current]
// A Final Shape problem being played out with both sides by the player (see settings.shapeBothSides)
const playingBothSides = () => Boolean(problem?.bothSides && problemPending())
const isHumanTurn = (entry = currentEntry()) => freePlay || playingBothSides() || entry.position.toPlay === humanColor()
// Path problems are answered by picking a sequence, not by playing on the board
const canPlayOnBoard = () => !busy && isHumanTurn() && !(problemPending() && ['path', 'better', 'tenuki'].includes(problem.kind))

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const view = new BoardView($('#board'), {
    onPlay: (x, y) => {
        if (ladderStoneAt(x, y)) { return } // Not part of the game, just there to decide the ladder
        if (answeredOnBoard()) {
            // Who's Better?: a side's stone picks that side, an empty point picks even
            const color = currentEntry().position.at(x, y)
            gradeAnswerChoice(color === BLACK ? 'black' : color === WHITE ? 'white' : 'even')
        }
        else if (canPlayOnBoard()) { playMove(toSgf(x, y), { byHuman: true }) }
        else if (answeredWithButtons()) { nudgeAnswerButtons() }
    },
    onContextMenu: returnToMove,
    canHover: () => (canPlayOnBoard() ? currentEntry().position.toPlay : null),
})

function setBusy(value) {
    busy = value
    render()
}

/** Ensures history[index].node is resolved and, if it's in Josekipedia, fully loaded. */
async function resolveNode(index) {
    const entry = history[index]
    if (freePlay) {
        entry.node = null
        return
    }
    if (entry.node === undefined) {
        await resolveNode(index - 1)
        const parent = history[index - 1].node
        const { coord, color } = entry.move
        entry.node = parent?.children.find((child) => child.move === coord && child.color === color) ?? null
    }
    if (entry.node && !entry.node.children) {
        entry.node = await getNode(entry.node.id)
    }
}

function pushEntry(entry) {
    history = history.slice(0, current + 1)
    history.push(entry)
    current = history.length - 1
}

function playMove(coord, { byHuman }) {
    const entry = currentEntry()
    const color = entry.position.toPlay
    let position
    try {
        position = entry.position.playSgf(coord, color)
    }
    catch (e) {
        if (e instanceof IllegalMoveError) { return toast(e.message, 'error') }
        throw e
    }

    const answering = byHuman && problemPending() && current === answerIndex()
    pushEntry({ position, move: { coord, color }, node: undefined, path: entry.path + coord })
    ++generation
    if (answering) {
        gradeAnswer(coord)
        return
    }
    if (coord === PASS) { toast(`${byHuman && !freePlay ? 'You' : capitalize(colorName(color))} passed.`) }
    advance({ feedback: byHuman })
}

// --- Problems ------------------------------------------------------------------

function gradeAnswer(coord) {
    if (problem.kind === 'shape') { return gradeShapeAnswer(coord) }
    if (problem.kind === 'sente') { return gradeSenteAnswer(coord) }
    const type = problem.answers.get(coord)
    const score = stats[problem.kind]
    if (++problem.attempts === 1) { ++score.attempted }

    // Punish wants the strongest answer: the ideal one, or a good one when there's no ideal answer
    const hasIdeal = [...problem.answers.values()].includes(MoveType.IDEAL)
    const correct = type === MoveType.IDEAL || (type === MoveType.GOOD && (problem.kind === 'next' || !hasIdeal))
    if (problem.attempts === 1) { recordFirstAttempt(correct) }
    if (correct) {
        problem.solved = true
        if (problem.attempts === 1) { ++score.solved }
        toast(type === MoveType.IDEAL ? '✓✓ Correct!' : '✓ Correct (a good move).', 'success')
        advance() // The computer replies and play continues as in Explore mode
        autoAdvanceAfterSolving()
        return
    }

    let message = moveTypeMessage(type)
    if (type === MoveType.GOOD) { message = 'Playable, but there’s a stronger punishment.' }
    toast(`${message} Try again.`, 'error')
    takeBackWrongAnswer()
}

const moveTypeMessage = (type) => (MOVE_TYPE_NAMES[type]
    ? `That’s a ${MOVE_TYPE_NAMES[type] === 'question' ? 'questionable' : MOVE_TYPE_NAMES[type]} move.`
    : 'That move isn’t in Josekipedia here.')

/**
 * Shape problems accept the move that starts the target line, or any other joseki move whose own
 * main line reaches the same final position.
 */
/**
 * Final Shape: the player plays out the whole line, one of their moves at a time. The line's move
 * is correct, as is any other joseki move whose main line still reaches the target (the line then
 * follows that move instead). Any wrong move counts as a miss for the score and the review deck.
 */
async function gradeShapeAnswer(coord) {
    const gen = generation
    const at = answerIndex()
    const start = history[at]
    if (++problem.attempts === 1) { ++stats.shape.attempted }

    const mover = problem.line[problem.step].color // The player's color, or either with both sides
    let rest = coord === problem.line[problem.step].move ? problem.line.slice(problem.step + 1) : null
    let type = null
    try {
        setBusy(true)
        await resolveNode(at)
        const child = start.node?.children.find((c) => c.move === coord && c.color === mover)
        type = child ? child.type : null
        if (!rest && (type === MoveType.IDEAL || type === MoveType.GOOD)) {
            const line = await lineAfter(child, start.position)
            if (line.position.sameStones(problem.target)) { rest = line.moves }
        }
    }
    catch { /* Couldn't check for a transposition; treat it as a different shape */ }
    if (gen !== generation) { return }

    if (!rest) {
        if (!problem.missed) {
            problem.missed = true
            recordFirstAttempt(false)
        }
        const point = fromSgf(coord)
        let message = moveTypeMessage(type)
        if (point && problem.target.at(point.x, point.y) === mover) {
            message = `That stone is part of the shape, but it isn’t played ${problem.step ? 'next' : 'first'}.`
        }
        else if (type === MoveType.IDEAL || type === MoveType.GOOD) { message = 'That’s joseki, but it leads to a different shape.' }
        toast(`${message} Try again.`, 'error')
        takeBackWrongAnswer()
        return
    }

    problem.line = [...problem.line.slice(0, problem.step), { move: coord, color: mover }, ...rest]
    problem.step += 1
    problem.hint = false
    continueShape()
}

/** The computer plays the other side's moves along the shape line, until it's the player's turn or the shape is complete. */
async function continueShape() {
    const gen = generation
    setBusy(true)
    while (problem.step < problem.line.length && !problem.bothSides && problem.line[problem.step].color !== humanColor()) {
        await delay(450)
        if (gen !== generation) { return }
        const { move, color } = problem.line[problem.step]
        const entry = currentEntry()
        pushEntry({ position: entry.position.playSgf(move, color), move: { coord: move, color }, node: undefined, path: entry.path + move })
        problem.step += 1
        render()
    }
    if (problem.step >= problem.line.length) {
        problem.solved = true
        if (!problem.missed) {
            ++stats.shape.solved
            recordFirstAttempt(true)
        }
        toast(problem.missed ? 'That’s the final shape.' : '✓✓ That’s the final shape!', 'success')
        autoAdvanceAfterSolving()
    }
    try { await resolveNode(current) } // Load the move info
    catch { /* The move info will say it couldn't be found */ }
    if (gen === generation) { setBusy(false) }
}

/**
 * Play for Sente: the player plays out a joseki line that ends with them in sente, one of their
 * moves at a time, and the computer plays the other side. The first move must start a line that
 * ends in sente; later ones follow it, or take another joseki move whose own line still does (the
 * line then follows that move instead). Any wrong move counts as a miss.
 */
async function gradeSenteAnswer(coord) {
    const gen = generation
    const at = answerIndex()
    if (++problem.attempts === 1) { ++stats.sente.attempted }

    let option = problem.step === 0
        ? problem.options.find((o) => o.move === coord)
        : coord === problem.line[problem.step].move ? { move: coord, sente: true, line: problem.line.slice(problem.step) } : null
    let type = problem.step === 0 ? problem.answers.get(coord) : null
    if (problem.step > 0 && !option) {
        // Another joseki move here may keep sente too
        try {
            setBusy(true)
            await resolveNode(at)
            type = history[at].node?.children.find((c) => c.move === coord && c.color === humanColor())?.type ?? null
            if (type === MoveType.IDEAL || type === MoveType.GOOD) {
                const moves = history.slice(1, at + 1).map((entry) => entry.move.coord)
                option = (await senteOptionsAt(moves, { getNode })).find((o) => o.move === coord) || null
            }
        }
        catch { /* Couldn't check: treat it as not keeping sente */ }
        if (gen !== generation) { return }
    }

    if (!option?.sente) {
        if (!problem.missed) {
            problem.missed = true
            recordFirstAttempt(false)
        }
        const them = capitalize(colorName(humanColor() === BLACK ? WHITE : BLACK))
        const message = option
            ? `That’s joseki, but it ends in gote: ${them} gets to play elsewhere.`
            : moveTypeMessage(type)
        toast(`${message} Try again.`, 'error')
        takeBackWrongAnswer()
        return
    }

    problem.line = [...(problem.line || []).slice(0, problem.step), ...option.line]
    problem.step += 1
    problem.hint = false
    continueSente()
}

/** The computer plays the other side along the line, until it's the player's turn or the joseki is over. */
async function continueSente() {
    const gen = generation
    setBusy(true)
    while (problem.step < problem.line.length && problem.line[problem.step].color !== humanColor()) {
        await delay(450)
        if (gen !== generation) { return }
        const { move, color } = problem.line[problem.step]
        const entry = currentEntry()
        pushEntry({ position: entry.position.playSgf(move, color), move: { coord: move, color }, node: undefined, path: entry.path + move })
        problem.step += 1
        render()
    }
    if (problem.step >= problem.line.length) {
        problem.solved = true
        if (!problem.missed) {
            ++stats.sente.solved
            recordFirstAttempt(true)
        }
        toast(`${problem.missed ? '' : '✓✓ '}The joseki is over, and you have sente.`, 'success')
        autoAdvanceAfterSolving()
    }
    try { await resolveNode(current) } // Load the move info
    catch { /* The move info will say it couldn't be found */ }
    if (gen === generation) { setBusy(false) }
}

/** Shows a wrong answer briefly, then takes it back. */
function takeBackWrongAnswer() {
    const gen = generation
    const at = answerIndex()
    setBusy(true)
    setTimeout(() => {
        if (gen !== generation) { return }
        history = history.slice(0, at + 1)
        current = at
        ++generation
        setBusy(false)
    }, 1200)
}

const AUTO_ADVANCE_DELAY = 1800 // Long enough to see the feedback (and the computer's reply)

/** With Auto-advance on, moves on to the next problem shortly after this one is solved. */
function autoAdvanceAfterSolving() {
    if (!settings.autoAdvance) { return }
    const solved = problem
    setTimeout(() => {
        // Skip if the player has already moved on (Next, a mode change…) or turned it off
        if (problem === solved && settings.autoAdvance && settings.mode !== 'explore') { newProblem() }
    }, AUTO_ADVANCE_DELAY)
}

function revealAnswer() {
    if (!problemPending()) { return }
    if (problem.kind === 'shape' || problem.kind === 'sente') {
        // A hint: highlight the player's next move, and let them carry on playing it out
        if (problem.attempts === 0) { ++stats[problem.kind].attempted }
        if (!problem.missed) {
            problem.missed = true
            recordFirstAttempt(false)
        }
        problem.hint = true
        if (current !== answerIndex()) { goTo(answerIndex()) }
        render()
        return
    }
    problem.revealed = true
    if (problem.attempts === 0) {
        ++stats[problem.kind].attempted
        recordFirstAttempt(false)
    }
    goTo(problem.index)
    render()
}

const problemPrompt = () => {
    const you = capitalize(colorName(humanColor()))
    if (problem.kind === 'next') { return `${you} to play. Find the joseki move.` }
    if (problem.kind === 'shape') {
        if (!problem.step) {
            return problem.bothSides
                ? `${you} to play. Play out the joseki, both sides, to reach the faded shape.`
                : `${you} to play. Play out the joseki to reach the faded shape; the computer plays the other side.`
        }
        const left = problem.line.slice(problem.step).filter((m) => problem.bothSides || m.color === humanColor()).length
        return `Keep going: ${left} more move${left === 1 ? '' : 's'} to reach the shape.`
    }
    if (problem.kind === 'path') { return 'Which sequence is joseki, with both sides playing joseki moves from here?' }
    if (problem.kind === 'better') { return 'Who’s better in this position?' }
    if (problem.kind === 'sente') {
        if (!problem.step) { return `${you} to play. Play out a joseki that ends with you in sente; the computer plays the other side.` }
        const left = problem.line.slice(problem.step).filter((m) => m.color === humanColor()).length
        return `Keep going: ${left} more move${left === 1 ? '' : 's'}, ending in sente.`
    }
    if (problem.kind === 'tenuki') {
        const side = capitalize(colorName(problem.spec.color))
        return `It’s ${side}’s turn. Can ${side} tenuki here?`
    }
    const { move, type } = problem.mistake
    const them = capitalize(colorName(humanColor() === BLACK ? WHITE : BLACK))
    const where = sgfToDisplay(move)
    return type === MoveType.TRICK
        ? `${them}’s ${where} is a trick move. Find the refutation.`
        : `${them}’s ${where} is a mistake. Punish it!`
}

/** Loads a problem: in Review mode the most overdue review, in Problems mode sometimes a review. */
async function newProblem() {
    const review = settings.mode === 'review'
    // Problems mode shouldn't hand back the problem the player was just on (a miss is due at once)
    const previous = problem?.spec && reviewKey(problem.spec)
    const due = dueReviews().filter((item) => review || item.key !== previous)
    if (review && !due.length) {
        // Nothing to review: clear the board; the problem bar says when the next one is due
        ++generation
        problem = null
        freePlay = false
        clearToasts()
        setupPosition([])
        render()
        return
    }
    const gen = ++generation
    problem = null
    freePlay = false
    if (!history.length) { setupPosition([]) }
    clearToasts()
    setBusy(true)

    const options = { startMoves: splitPath(startPath()), color: humanColor(), firstTen: settings.firstTen, getNode }
    try {
        let found = null
        let kind = null
        let reviewKey = null
        let reviewColor = null

        // Reviews: rebuild the most overdue one that still fits Josekipedia
        const reviewing = review || (due.length && Math.random() < REVIEW_MIX) ? due : []
        for (const item of reviewing) {
            try {
                found = await rebuildProblem(item, { getNode })
                kind = item.kind
                reviewKey = item.key
                reviewColor = item.color
                break
            }
            catch (error) {
                if (!(error instanceof StaleProblemError)) { throw error } // e.g. offline: keep the review
                deck.remove(item.key) // Josekipedia changed and the problem no longer exists
            }
        }
        if (gen !== generation) { return }

        // New problems: random lines often end early in tenuki, so try several times. Types that
        // haven't come up lately go first (see problem-mix.js). Each gets a few walks before moving
        // on to the next, as some types fail far more often than others and would otherwise hand
        // their turns to the reliable ones
        // A problem seen lately is only used if nothing new turns up
        const kinds = enabledProblemTypes()
        const order = orderKinds(kinds, recentKinds)
        let repeat = null
        for (let attempt = 0; attempt < TRIES_PER_TYPE * 4 && !found && gen === generation; ++attempt) {
            kind = order[Math.floor(attempt / TRIES_PER_TYPE) % order.length]
            const candidate = await GENERATORS[kind](options)
            if (candidate && seenProblems.has(seenKey(kind, candidate.moves))) { repeat ??= { candidate, kind } }
            else { found = candidate }
        }
        if (gen !== generation) { return }
        if (!found && repeat) { ({ candidate: found, kind } = repeat) }
        if (!found) {
            // Show the starting point rather than leaving the last problem on the board
            setupPosition(options.startMoves)
            setBusy(false)
            // Some types are scarce from some starting points (e.g. few recorded mistakes after a fuseki)
            const names = kinds.map((k) => PROBLEM_TYPE_NAMES[k])
            const which = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]
            const suggestion = kinds.length < Object.keys(GENERATORS).length ? ' Turning on more problem types may help.' : ''
            toast(`Couldn’t find a ${which} problem from this starting point.${suggestion}`, 'warning', { label: 'Try Again', action: () => newProblem() })
            return
        }
        const ladder = await findLadderSetup(found, kind)
        if (gen !== generation) { return }
        presentProblem(found, kind, { reviewKey, color: reviewColor || found.color || humanColor(), ladder })
    }
    catch (error) {
        if (gen !== generation) { return }
        console.error(error)
        setBusy(false)
        toast('Couldn’t load data from Josekipedia.', 'error', { label: 'Retry', action: () => newProblem() })
    }
}

/** Puts a generated or rebuilt problem on the board. */
/**
 * How the problem shows a ladder it relies on (see ladderSetup), or null. Never fails: without
 * it, the problem still works, just without the ladder stone.
 */
async function findLadderSetup(found, kind) {
    try {
        const position = found.moves.reduce((p, move) => p.playSgf(move), new Position())
        return await ladderSetup(kind, found, position, { getNode })
    }
    catch (error) {
        console.warn('Couldn’t work out the ladder', error)
        return null
    }
}

function presentProblem(found, kind, { reviewKey = null, color = humanColor(), link, ladder = null } = {}) {
    setupPosition(found.moves)
    problem = {
        ...found, kind, index: current, attempts: 0, solved: false, revealed: false, wrong: [], step: 0, missed: false, hint: false,
        spec: { kind, moves: found.moves, color, data: problemData(kind, found) },
        reviewKey,
        link, // Opened from a link: keep it, as rebuilding can reorder Pick the Path's sequences
        ladder, // { color, moves, stone }: a ladder the problem relies on, and the stone that decides it
        bothSides: kind === 'shape' && settings.shapeBothSides, // The player plays both colors
    }
    noteShown(kind, found.moves) // Reviews and links count too: they're practice of that type all the same
    showTypeBanner(kind, Boolean(reviewKey))
    ++generation
    advance()
}

/** Loads info for the current position, gives feedback and lets the computer reply if it's its turn. */
async function advance({ feedback = false } = {}) {
    const gen = generation
    const index = current
    const entry = history[index]
    setBusy(true)
    try {
        await resolveNode(index)
        if (gen !== generation) { return }
        busy = false
        render()

        if (freePlay) { return }
        if (feedback) { giveFeedback(entry) }
        if (!entry.node) { return }

        if (!isHumanTurn(entry) && !navigationLocked()) { // Not while a problem is waiting for an answer
            const move = chooseComputerMove(entry)
            if (!move) { return }
            setBusy(true)
            await delay(350)
            if (gen !== generation) { return }
            busy = false
            playMove(move.move, { byHuman: false })
        }
        else if (!entry.node.children.some((child) => child.color === entry.position.toPlay)) {
            showEndOfJoseki()
        }
    }
    catch (error) {
        if (gen !== generation) { return }
        console.error(error)
        toast('Couldn’t load data from Josekipedia.', 'error', { label: 'Retry', action: () => advance({ feedback }) })
    }
    finally {
        if (gen === generation && busy) { setBusy(false) }
    }
}

const FEEDBACK = [
    ['✓✓ Ideal move!', 'success'],
    ['✓ Good move.', 'success'],
    ['✗ That’s a bad move.', 'error'],
    ['That’s a trick move.', 'warning'],
    ['That’s a questionable move.', 'warning'],
]

function giveFeedback(entry) {
    if (!entry.node) {
        toast('That move isn’t in Josekipedia. Undo (←) to try again.', 'error')
        return
    }
    const [message, kind] = FEEDBACK[entry.node.type] || []
    if (message) { toast(message, kind) }
}

function chooseComputerMove(entry) {
    const { node, position } = entry
    const color = position.toPlay
    const ownMoves = node.children.filter((child) => child.color === color)
    if (!ownMoves.length) {
        showEndOfJoseki()
        return null
    }

    // Josekipedia lists children in the order they were added, so the first few are the core
    // joseki and later ones tend to be whole-board (fuseki) moves.
    const considered = settings.firstTen ? ownMoves.slice(0, 10) : ownMoves
    const candidates = considered.filter((child) => {
        if (node.id === ROOT_ID && !CLASSIC_OPENINGS.includes(child.move)) { return false }
        if (child.type !== null && !settings[MOVE_TYPE_NAMES[child.type]]) { return false }
        if (child.move === PASS) { return !settings.onlyPassIfJoseki || node.labels.includes(TENUKI_LABEL[color]) }
        const point = fromSgf(child.move)
        return point && position.isLegal(point.x, point.y, color)
    })

    if (!candidates.length) {
        toast('No continuations match the move types selected under “Computer Plays”.', 'warning')
        return null
    }
    return candidates[Math.floor(Math.random() * candidates.length)]
}

// --- Navigation ----------------------------------------------------------------

function goTo(index) {
    if (index < 0 || index >= history.length || index === current) { return }
    current = index
    ++generation
    advance()
}

function undo() {
    if (navigationLocked()) { return }
    let target = current - 1
    while (target > 0 && !isHumanTurn(history[target])) { --target }
    goTo(target)
}

function redo() {
    if (navigationLocked()) { return }
    let target = current + 1
    while (target < history.length - 1 && !isHumanTurn(history[target])) { ++target }
    goTo(target)
}

/**
 * Right-clicking a stone returns to the position just after it was played, or just before it
 * if it's the most recent move. If that leaves the computer to move, it picks a new reply.
 */
function returnToMove(x, y) {
    if (navigationLocked()) { return }
    const coord = toSgf(x, y)
    if (currentEntry().position.at(x, y) === 0) { return }
    for (let i = current; i > 0; --i) {
        if (history[i].move.coord === coord) {
            goTo(i === current ? i - 1 : i)
            return
        }
    }
}

function pass() {
    if (canPlayOnBoard()) { playMove(PASS, { byHuman: true }) }
}

function startGame(start) {
    problem = null
    freePlay = start === 'demo'
    const preset = [...JOSEKI, ...FUSEKI].flatMap(function flatten(p) { return [p, ...(p.children || []).flatMap(flatten)] })
        .find((p) => p.path === start)
    if (!freePlay) { prefetch([ROOT_ID, ...(preset?.ids || [])]) }

    clearToasts()
    setupPosition(start === 'empty' || start === 'demo' ? [] : splitPath(start))
    ++generation
    advance()
}

/** Replaces the game with the position after `moves`. Nodes are looked up later by advance(). */
function setupPosition(moves) {
    history = [{ position: new Position(), move: null, node: freePlay ? null : { id: ROOT_ID, labels: [] }, path: '' }]
    current = 0
    for (const coord of moves) {
        const entry = currentEntry()
        const color = entry.position.toPlay
        try {
            pushEntry({ position: entry.position.playSgf(coord, color), move: { coord, color }, node: undefined, path: entry.path + coord })
        }
        catch {
            toast(`Couldn’t set up that position (illegal move at ${sgfToDisplay(coord)}).`, 'error')
            break
        }
    }
}

// --- Rendering -----------------------------------------------------------------

const capitalize = (s) => s[0].toUpperCase() + s.slice(1)

// Points marked on the board from the move comment (pinned by clicking) or while hovering a
// reference. Pins belong to the position they were made in. Each coordinate in the comment gets
// a traditional marker shape, in order of first mention.
const MARK_SHAPES = ['triangle', 'square', 'circle']
const SHAPE_SYMBOLS = { triangle: '△', square: '□', circle: '○' }
const marks = { entry: null, pinned: new Set(), hover: null, shapes: new Map() }

function currentMarks() {
    const coords = new Set(marks.pinned)
    if (marks.hover) { coords.add(marks.hover) }
    return [...coords].map((coord) => ({ ...fromSgf(coord), shape: marks.shapes.get(coord) || 'circle' }))
}

function setHoverMark(coord) {
    marks.hover = coord
    showMarks()
}

/** Draws the marks on the board, and on the starting position card when the board is hidden. */
function showMarks() {
    view.render({ marks: currentMarks() })
    renderPathStartMarks()
}

function renderPathStartMarks() {
    const svg = $('#path-choices:not([hidden]) .path-start svg')
    if (!svg) { return }
    let layer = svg.querySelector('.marks')
    if (!layer) {
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        layer.setAttribute('class', 'marks')
        svg.append(layer)
    }
    const position = history[problem.index].position
    layer.innerHTML = currentMarks().map(({ x, y, shape }) => {
        const on = { [EMPTY]: 'on-empty', [BLACK]: 'on-black' }[position.at(x, y)] || 'on-white'
        return markShape(shape, x, y, `mark ${on}`)
    }).join('')
}

function togglePinnedMark(coord) {
    if (marks.pinned.has(coord)) { marks.pinned.delete(coord) }
    else { marks.pinned.add(coord) }
    for (const ref of document.querySelectorAll(`.coord-ref[data-coord="${coord}"]`)) {
        ref.classList.toggle('pinned', marks.pinned.has(coord))
        ref.setAttribute('aria-pressed', marks.pinned.has(coord))
    }
    showMarks()
}

function render() {
    const entry = currentEntry()
    const { position } = entry
    const lastMove = entry.move && fromSgf(entry.move.coord)
    if (endNotice && endNotice.entry !== entry) {
        endNotice.element.remove()
        endNotice = null
    }
    if (marks.entry !== entry) {
        marks.entry = entry
        marks.pinned.clear()
        marks.hover = null
        marks.shapes.clear()
    }

    const toHighlight = (move, type) => ({ ...fromSgf(move), type: MOVE_TYPE_NAMES[type] || 'unknown' })
    let highlights = []
    if (problem?.kind === 'shape' && problem.hint && current === answerIndex()) {
        highlights = [toHighlight(problem.line[problem.step].move, MoveType.IDEAL)]
    }
    else if (problem?.kind === 'sente' && problem.hint && current === answerIndex()) {
        // The first move: those that keep sente, and the joseki moves that end in gote; then the line's next move
        highlights = problem.step
            ? [toHighlight(problem.line[problem.step].move, MoveType.IDEAL)]
            : problem.options.map((o) => toHighlight(o.move, o.sente ? MoveType.IDEAL : MoveType.BAD))
    }
    else if (problem?.revealed && current === problem.index) {
        if (problem.inferredFrom) {
            highlights = [toHighlight(problem.inferredFrom, MoveType.IDEAL)] // The local move the joseki continues with
        }
        else if (['path', 'better', 'tenuki'].includes(problem.kind)) {
            highlights = [] // The answer is marked among the choices instead
        }
        else {
            const hasIdeal = [...problem.answers.values()].includes(MoveType.IDEAL)
            const accepted = problem.kind === 'next' || !hasIdeal ? [MoveType.IDEAL, MoveType.GOOD] : [MoveType.IDEAL]
            highlights = [...problem.answers].filter(([, type]) => accepted.includes(type)).map(([move, type]) => toHighlight(move, type))
        }
    }
    else if (problem?.kind === 'tenuki' && problem.solved && problem.inferredFrom && current === problem.index) {
        highlights = [toHighlight(problem.inferredFrom, MoveType.IDEAL)] // The local move the joseki continues with
    }
    else if (settings.showMoves && entry.node?.children && !problemPending()) {
        highlights = entry.node.children
            .filter((child) => child.color === position.toPlay)
            .map((child) => toHighlight(child.move, child.type))
    }
    // The faded target stays up while the player plays it out (and while a wrong move is shown)
    const showTarget = problem?.kind === 'shape' && problemPending() && current >= problem.index
    const target = showTarget ? problem.target : null
    // Punish marks the mistake with an X rather than the usual last-move ring
    const mistakeShown = problem?.kind === 'punish' && current === problem.index
    view.render({
        position,
        lastMove: lastMove && { ...lastMove, style: mistakeShown ? 'cross' : 'ring' },
        highlights: highlights.filter((h) => h.x !== undefined),
        marks: currentMarks(),
        target,
        fadeStones: answeredOnBoard(),
        ...ladderDrawing(position),
    })
    renderLadderNote()

    // Pick the Path shows only the sequences, not the board
    const pathProblem = problem?.kind === 'path' && current >= problem.index
    $('#board-wrap').hidden = pathProblem
    $('#board-hint').hidden = pathProblem
    // Look, don't play (see .view-only); Who's Better? is answered by clicking the stones instead
    $('#board-wrap').classList.toggle('view-only', answeredWithButtons() && !answeredOnBoard())
    $('#board-wrap').classList.toggle('answer-on-board', answeredOnBoard())
    renderAnswerHint()
    $('#undo').disabled = current === 0 || navigationLocked()
    $('#redo').disabled = current === history.length - 1 || navigationLocked()
    $('#pass').disabled = !canPlayOnBoard()

    const toPlay = capitalize(colorName(position.toPlay))
    const showingWrongAnswer = problemPending() && current > answerIndex()
    const findingProblem = busy && !problem && settings.mode !== 'explore'
    $('#status .spinner').hidden = !busy || showingWrongAnswer
    $('#board-loading').hidden = !findingProblem // Finding a problem can take a few seconds
    $('#status-text').textContent = showingWrongAnswer ? '' : busy
        ? (problem || settings.mode === 'explore' ? (isHumanTurn() ? 'Loading…' : 'Thinking…') : 'Finding a problem…')
        : problemPending() && problem.kind === 'path' ? 'Choose a sequence below'
        : answeredOnBoard() ? 'Click the board, or choose below'
        : problemPending() && ANSWER_CHOICES[problem.kind] ? 'Choose an answer below'
        : ['shape', 'path'].includes(problem?.kind) && problem.solved && !isHumanTurn() ? '' // The joseki is complete
            : freePlay || isHumanTurn() ? `${toPlay} to play` : `Computer (${toPlay})`

    // Each problem type has its own color (see [data-kind] in the CSS)
    if (problem) { $('#board-area').dataset.kind = problem.kind }
    else { delete $('#board-area').dataset.kind }
    renderProblemBar()
    renderReviewStatus()
    updateUrl(entry)
    renderAddReview(entry)
    renderPathChoices()
    renderAnswerChoices()
    renderPathStartMarks()
    renderMoveInfo(entry)
    renderFollowUps(entry)
}

// --- Problem type banner ----------------------------------------------------------
// Each new problem is introduced by a banner with its type and goal that sweeps across the board.
// It gets a little quicker each time a type's banner is seen, up to twice as fast.

const BANNER_TIME = 1700 // ms, the first time
const BANNER_SPEEDUP = 0.05 // Faster per viewing, so twice as fast after 20
const MAX_BANNER_SPEED = 2

/** How long a type's banner takes after it has been seen `views` times. */
const bannerTime = (views) => Math.round(BANNER_TIME / Math.min(MAX_BANNER_SPEED, 1 + BANNER_SPEEDUP * views))

function showTypeBanner(kind, review) {
    const banner = $('#type-banner')
    const views = Number.isInteger(bannerViews[kind]) ? bannerViews[kind] : 0
    banner.style.setProperty('--banner-time', `${bannerTime(views)}ms`)
    bannerViews[kind] = views + 1
    try { localStorage.setItem('bannerViews', JSON.stringify(bannerViews)) }
    catch { /* storage unavailable: it just won't speed up next visit */ }
    banner.dataset.kind = kind
    banner.querySelector('.type-banner-name').textContent = PROBLEM_TYPE_NAMES[kind]
    banner.querySelector('.type-banner-goal').textContent = review ? `Review · ${PROBLEM_TYPE_GOALS[kind]}` : PROBLEM_TYPE_GOALS[kind]
    banner.classList.remove('play')
    // Over the board (or Pick the Path's cards, which replace it), once this render has laid it out
    requestAnimationFrame(() => {
        const target = $('#board-wrap').hidden ? $('#path-choices') : $('#board-wrap')
        banner.style.top = `${target.offsetTop}px`
        banner.style.height = `${target.offsetHeight}px`
        void banner.offsetWidth // Restart the animation
        banner.classList.add('play')
    })
}

// --- Ladders ---------------------------------------------------------------------
// A problem that relies on a favorable ladder has a stone of that color where the ladder would
// run (see ladderSetup), drawn on the board but not part of the game. After answering, the moves
// that need the ladder are badged, and a note explains.

const ladderStoneAt = (x, y) => {
    const stone = problem?.ladder?.stone
    return Boolean(stone && stone.x === x && stone.y === y)
}

/** The ladder stone and badges for the board, as BoardView state. */
function ladderDrawing(position) {
    const ladder = problem?.ladder
    if (!ladder) { return { extraStones: [], badges: [] } }
    const answered = !problemPending()
    const side = ladder.color && capitalize(colorName(ladder.color))
    const extraStones = ladder.stone
        ? [{ ...ladder.stone, title: answered ? `Stands in for a ladder that favors ${side}` : '' }]
        : []
    const badges = answered
        ? ladder.moves.map(({ move, color }) => ({ ...fromSgf(move), color }))
            .filter(({ x, y, color }) => position.at(x, y) === color)
            .map(({ x, y }) => ({ x, y, text: 'L', title: 'Needs a favorable ladder' }))
        : []
    return { extraStones, badges }
}

/** After answering, says which moves need a favorable ladder, and what the extra stone is for. */
function renderLadderNote() {
    const note = $('#ladder-note')
    const ladder = problem?.ladder
    note.hidden = !ladder || problemPending()
    if (note.hidden) { return }
    const moves = [...new Map(ladder.moves.map((m) => [m.move, m])).values()]
        .map(({ move, color }) => `${capitalize(colorName(color))}’s ${sgfToDisplay(move)}`)
    const list = moves.length > 1 ? `${moves.slice(0, -1).join(', ')} and ${moves.at(-1)}` : moves[0]
    let text = `${list} ${moves.length > 1 ? 'need' : 'needs'} a favorable ladder.`
    if (ladder.stone) {
        const side = colorName(ladder.color)
        text += ` The ${side} stone at ${sgfToDisplay(toSgf(ladder.stone.x, ladder.stone.y))} stands in for one.`
    }
    note.textContent = text
}

// --- Answer buttons (Who's Better?, Tenuki-able?) ------------------------------------

let answerChoicesFor = null // The problem the buttons were built for

/** True while a problem is waiting for an answer from the buttons rather than a move on the board. */
const answeredWithButtons = () => Boolean(problemPending() && ANSWER_CHOICES[problem.kind] && current >= problem.index)
/** Who's Better? can also be answered by clicking a side's stones (or an empty point for even). */
const answeredOnBoard = () => answeredWithButtons() && problem.kind === 'better'

/** A small stone of `color`, to put next to text about that side. */
function stoneIcon(color) {
    const icon = document.createElement('span')
    icon.className = `stone-icon ${colorName(color)}`
    icon.setAttribute('aria-hidden', 'true')
    return icon
}

/** The label on the board that says how to answer (and, for Tenuki-able?, the question itself). */
function renderAnswerHint() {
    const hint = $('#answer-hint')
    const tenuki = answeredWithButtons() && problem.kind === 'tenuki'
    hint.classList.toggle('question', tenuki)
    if (tenuki) {
        const color = problem.spec.color
        hint.replaceChildren(stoneIcon(color), `Can ${capitalize(colorName(color))} tenuki here?`, ' ↓')
    }
    else {
        hint.textContent = answeredOnBoard()
            ? 'Click a side’s stones for who’s better, or an empty point for even'
            : '↓ Answer with the buttons below'
    }
}

/** A click on the board in a button-answered problem: bring the buttons into view and pulse them. */
function nudgeAnswerButtons() {
    const buttons = $('#answer-buttons')
    $('#answer-choices').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    buttons.classList.remove('nudge')
    void buttons.offsetWidth // Restart the animation
    buttons.classList.add('nudge')
}

function renderAnswerChoices() {
    const container = $('#answer-choices')
    const choices = problem && ANSWER_CHOICES[problem.kind]
    container.hidden = !choices || current < problem.index
    if (container.hidden) { return }

    if (answerChoicesFor !== problem) {
        answerChoicesFor = problem
        $('#answer-buttons').replaceChildren(...choices.map(([value, label]) => {
            const button = document.createElement('button')
            button.type = 'button'
            button.dataset.value = value
            button.textContent = label
            if (problem.kind === 'tenuki') { button.prepend(stoneIcon(problem.spec.color)) }
            button.addEventListener('click', () => gradeAnswerChoice(value))
            return button
        }))
    }
    const answered = !problemPending()
    for (const button of $('#answer-buttons').children) {
        button.disabled = answered || busy
        button.classList.toggle('correct', answered && button.dataset.value === problem.answer)
        button.classList.toggle('wrong', answered && button.dataset.value === problem.picked && problem.picked !== problem.answer)
    }
    $('#answer-explanation').replaceChildren(...(answered ? answerExplanation() : []))
}

/** What Josekipedia records that gives the answer, as text (and the tenuki comment, if any). */
function answerExplanation() {
    const node = history[problem.index].node
    if (problem.kind === 'better') {
        const verdicts = problem.labels.map(labelText).filter(Boolean)
        return [`Josekipedia: ${verdicts.join(' ')}`]
    }
    const color = problem.spec.color
    const side = capitalize(colorName(color))
    const pass = node?.children?.find((child) => child.move === PASS && child.color === color)
    const reasons = []
    if (node?.labels.includes(TENUKI_LABEL[color])) { reasons.push(`Josekipedia notes that ${side} can tenuki here.`) }
    if (pass && MOVE_TYPE_NAMES[pass.type]) { reasons.push(`Tenuki is recorded as ${pass.type === MoveType.IDEAL ? 'an' : 'a'} ${MOVE_TYPE_NAMES[pass.type]} move here.`) }
    if (node?.children?.some((child) => child.color === color && child.labels.includes(15))) { reasons.push(`${side}’s next move here is marked “Necessary”.`) }
    if (problem.inferredFrom) {
        reasons.push(`Josekipedia doesn’t mark tenuki as playable here, and the joseki continues locally with ${side}’s ${sgfToDisplay(problem.inferredFrom)} (marked on the board).`)
    }
    const parts = [reasons.join(' ')]
    const comment = pass && cleanText(pass.comment)
    if (comment) {
        const quote = document.createElement('span')
        quote.className = 'tenuki-comment'
        quote.textContent = `If ${side} tenukis: ${comment}`
        parts.push(quote)
    }
    return parts
}

function gradeAnswerChoice(value) {
    if (!problemPending() || busy) { return }
    const score = stats[problem.kind]
    ++problem.attempts
    ++score.attempted
    problem.picked = value
    const correct = value === problem.answer
    recordFirstAttempt(correct)
    if (correct) {
        problem.solved = true
        ++score.solved
        toast('✓✓ Correct!', 'success')
        render()
        autoAdvanceAfterSolving()
        return
    }
    // Only two or three answers, so a wrong one reveals the right one rather than allowing guesses
    problem.revealed = true
    const right = ANSWER_CHOICES[problem.kind].find(([v]) => v === problem.answer)[1]
    toast(`Not quite: ${right}.`, 'error')
    render()
}

// --- Pick the Path choices ------------------------------------------------------

let pathChoicesFor = null // The problem the choice cards were built for

function renderPathChoices() {
    const container = $('#path-choices')
    const show = problem?.kind === 'path' && current >= problem.index
    container.hidden = !show
    if (!show) { return }

    if (pathChoicesFor !== problem) {
        pathChoicesFor = problem
        const region = pathRegion()
        container.replaceChildren(pathStartCard(region), ...problem.options.map((option, i) => pathCard(option, i, region)))
    }

    // Update the cards' state: wrong picks, and everything once answered
    const answered = !problemPending()
    container.classList.toggle('answered', answered)
    container.querySelectorAll('.path-card').forEach((card, i) => {
        const option = problem.options[i]
        card.classList.toggle('wrong', problem.wrong.includes(i) || (answered && Boolean(option.mistake)))
        card.classList.toggle('correct', answered && !option.mistake)
        card.querySelector('.path-explanation').textContent = answered || problem.wrong.includes(i) ? pathExplanation(option) : ''
        card.querySelector('button').disabled = answered || problem.wrong.includes(i)
    })
}

/** One region for all of a path problem's cards, so they're easy to compare. */
function pathRegion() {
    const start = history[problem.index].position
    const points = problem.options.flatMap(({ line, position }) => localShape(position, line.map(({ move }) => fromSgf(move))))
    return shapeRegion(start, points)
}

/** The position the sequences start from, with the last move circled. */
function pathStartCard(region) {
    const entry = history[problem.index]
    const lastMove = entry.move && fromSgf(entry.move.coord)
    const card = document.createElement('figure')
    card.className = 'path-start'
    card.append(renderShape(entry.position, { region, rings: lastMove ? [{ ...lastMove, type: 'last' }] : [], label: 'Starting position' }))
    const caption = document.createElement('figcaption')
    caption.textContent = `Starting position · ${capitalize(colorName(entry.position.toPlay))} to play`
    // The board, with its ladder stone, is hidden here, so say it
    if (problem.ladder?.color) { caption.textContent += ` · The ladder favors ${capitalize(colorName(problem.ladder.color))}` }
    card.append(caption)
    return card
}

function pathCard(option, i, region) {
    const card = document.createElement('figure')
    card.className = 'path-card'
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', `Sequence ${'ABC'[i]}`)
    button.addEventListener('click', () => gradePath(i))

    const numbers = new Map(option.line.map(({ move }, n) => {
        const { x, y } = fromSgf(move)
        return [`${x},${y}`, n + 1]
    }))
    const rings = []
    if (option.mistake) { rings.push({ ...fromSgf(option.mistake.move), type: 'bad' }) }
    button.append(renderShape(option.position, { region, numbers, rings, label: `Sequence ${'ABC'[i]}` }))

    const caption = document.createElement('figcaption')
    const letter = document.createElement('strong')
    letter.textContent = 'ABC'[i]
    const explanation = document.createElement('span')
    explanation.className = 'path-explanation'
    caption.append(letter, ' ', explanation)
    card.append(button, caption)
    return card
}

function pathExplanation(option) {
    if (!option.mistake) { return '✓ Joseki' }
    const { step, move, color, type } = option.mistake
    const what = MOVE_TYPE_NAMES[type]
        ? `is a ${MOVE_TYPE_NAMES[type] === 'question' ? 'questionable' : MOVE_TYPE_NAMES[type]} move`
        : 'isn’t joseki'
    return `Move ${step + 1}: ${capitalize(colorName(color))}’s ${sgfToDisplay(move)} ${what}.`
}

function gradePath(i) {
    if (!problemPending() || busy) { return }
    const score = stats.path
    if (++problem.attempts === 1) { ++score.attempted }
    const option = problem.options[i]
    if (problem.attempts === 1) { recordFirstAttempt(!option.mistake) }
    if (!option.mistake) {
        problem.solved = true
        if (problem.attempts === 1) { ++score.solved }
        toast('✓✓ Correct! That’s the joseki.', 'success')
        render()
        autoAdvanceAfterSolving()
        return
    }
    problem.wrong.push(i)
    toast(`${pathExplanation(option)} Try again.`, 'error')
    render()
}

// --- Follow-up variations ----------------------------------------------------

const lineCache = new Map() // child node id -> Promise<main line result>
let followUpsKey = null

/** The main line after playing `child` from `position`, cached by node. */
function lineAfter(child, position) {
    if (!lineCache.has(child.id)) {
        const promise = getNode(child.id).then((node) =>
            mainLine({ node, position: position.playSgf(child.move, child.color), getNode }))
        promise.catch(() => lineCache.delete(child.id))
        lineCache.set(child.id, promise)
    }
    return lineCache.get(child.id)
}

function renderFollowUps(entry) {
    const show = settings.showFollowUps && !freePlay && Boolean(entry.node?.children) && !problemPending()
    $('#follow-ups').hidden = !show
    if (!show) {
        followUpsKey = null
        return
    }
    const key = `${entry.node.id}:${current}:${settings.firstTen}`
    if (key === followUpsKey) { return }
    followUpsKey = key

    const { position } = entry
    let candidates = entry.node.children.filter((child) => child.color === position.toPlay)
    if (settings.firstTen) { candidates = candidates.slice(0, 10) }
    candidates = candidates.filter((child) => {
        const point = fromSgf(child.move)
        return (child.type === MoveType.IDEAL || child.type === MoveType.GOOD) && point && position.isLegal(point.x, point.y, child.color)
    }).slice(0, 6)

    const container = $('#follow-up-cards')
    container.replaceChildren()
    if (!candidates.length) {
        container.textContent = 'No joseki continuations from here.'
        return
    }
    for (const child of candidates) {
        container.append(followUpCard(child, position, key))
    }
}

function followUpCard(child, position, key) {
    const card = document.createElement('figure')
    card.className = 'follow-up-card'
    const slot = document.createElement('div')
    slot.className = 'shape-slot'
    slot.append(spinner())
    const caption = document.createElement('figcaption')
    const name = document.createElement('strong')
    name.textContent = sgfToDisplay(child.move)
    const badge = document.createElement('span')
    badge.className = `badge ${MOVE_TYPE_NAMES[child.type]}`
    badge.textContent = MOVE_TYPE_NAMES[child.type]
    const labels = document.createElement('ul')
    labels.className = 'follow-up-labels'
    caption.append(name, ' ', badge, labels)
    card.append(slot, caption)

    const point = fromSgf(child.move)
    card.addEventListener('mouseenter', () => setHoverMark(child.move))
    card.addEventListener('mouseleave', () => setHoverMark(null))

    lineAfter(child, position).then((line) => {
        if (followUpsKey !== key) { return }
        // Number the candidate 1 and the main line after it; later moves on a point win
        const played = [child, ...line.moves].map(({ move }, i) => ({ ...fromSgf(move), n: i + 1 }))
        const numbers = new Map(played.map(({ x, y, n }) => [`${x},${y}`, n]))
        const region = shapeRegion(line.position, localShape(line.position, played))
        const rings = [{ ...point, type: MOVE_TYPE_NAMES[child.type] }]
        slot.replaceWith(renderShape(line.position, { region, numbers, rings, label: `Follow-up variation after ${sgfToDisplay(child.move)}` }))

        const texts = line.node.labels.map(labelText).filter(Boolean)
        labels.replaceChildren(...texts.map((text) => {
            const li = document.createElement('li')
            li.textContent = text
            return li
        }))
        card.title = `${line.moves.length + 1} moves`
    }).catch(() => {
        if (followUpsKey === key) { slot.textContent = 'Couldn’t load.' }
    })
    return card
}

function renderProblemBar() {
    const inProblemMode = settings.mode !== 'explore'
    $('#problem-bar').hidden = !inProblemMode
    if (!inProblemMode) {
        $('#score').textContent = ''
        return
    }

    $('#problem-kind').textContent = problem ? PROBLEM_TYPE_NAMES[problem.kind] + (problem.reviewKey ? ' · Review' : '') : ''
    $('#problem-kind').hidden = !problem

    let prompt = ''
    if (problemPending()) { prompt = problemPrompt() }
    else if (problem?.solved) {
        prompt = settings.autoAdvance
            ? 'Solved! Next problem coming up…'
            : { shape: 'Solved! That’s the final shape.', path: 'Solved! That’s the joseki.', better: 'Correct!', tenuki: 'Correct!', sente: 'Solved! You end in sente.' }[problem.kind]
                || 'Solved! Keep playing, or get a new problem.'
    }
    else if (problem?.revealed) { prompt = ANSWER_CHOICES[problem.kind] ? 'The answer is marked below.' : 'Answers are highlighted.' }
    else if (!problem && !busy) {
        prompt = settings.mode === 'review' ? reviewEmptyPrompt() : 'No problem loaded. Try again, or choose another starting point.'
    }
    $('#problem-prompt').textContent = prompt
    $('#problem-text').title = prompt // In case two lines cut it off
    $('#show-answer').disabled = !problemPending() || busy
    // Once answered, Show Answer gives way to taking the position into Explore
    const answered = Boolean(problem) && !problemPending()
    $('#show-answer').hidden = answered
    $('#explore-problem').hidden = !answered
    $('#explore-problem').disabled = busy
    const kinds = Object.keys(stats)
    const solved = kinds.reduce((sum, kind) => sum + stats[kind].solved, 0)
    const attempted = kinds.reduce((sum, kind) => sum + stats[kind].attempted, 0)
    $('#score').textContent = attempted ? `${solved} / ${attempted} solved first try` : ''
    $('#score').title = kinds
        .filter((kind) => stats[kind].attempted)
        .map((kind) => `${PROBLEM_TYPE_NAMES[kind]}: ${stats[kind].solved} / ${stats[kind].attempted}`)
        .join('\n')
}

/** The Review mode label's due count, and the deck summary shown in Review mode. */
// --- Adding Explore positions to Review ------------------------------------------
// In Explore, the current position can be saved to Review as any type of problem it fits.

let addMenuFor = null // The position entry the open menu was built for

function renderAddReview(entry) {
    const button = $('#add-review')
    button.hidden = settings.mode !== 'explore'
    // Demo board positions have no joseki data to make problems from
    button.disabled = busy || freePlay || !entry?.node?.children
    button.title = freePlay ? 'The demo board has no joseki data to make problems from' : 'Save this position to Review as a problem'
    if (addMenuFor && (addMenuFor !== entry || button.hidden || button.disabled)) { closeAddMenu() }
}

function closeAddMenu() {
    addMenuFor = null
    $('#add-review-menu').hidden = true
    $('#add-review').setAttribute('aria-expanded', 'false')
}

/** Opens the menu of problem types, then checks which ones this position can be. */
async function openAddMenu() {
    const entry = currentEntry()
    addMenuFor = entry
    const menu = $('#add-review-menu')
    $('#add-review').setAttribute('aria-expanded', 'true')
    menu.hidden = false
    const items = Object.keys(GENERATORS).map((kind) => {
        const item = document.createElement('button')
        item.type = 'button'
        item.disabled = true
        item.setAttribute('role', 'menuitem')
        const name = Object.assign(document.createElement('span'), { className: 'menu-name', textContent: PROBLEM_TYPE_NAMES[kind] })
        const note = Object.assign(document.createElement('span'), { className: 'menu-note', textContent: 'Checking…' })
        item.append(name, note)
        return { kind, item, note }
    })
    menu.replaceChildren(...items.map(({ item }) => item))

    const moves = splitPath(entry.path)
    await Promise.all(items.map(async ({ kind, item, note }) => {
        let result
        try { result = await problemAt(kind, moves, { color: humanColor(), firstTen: settings.firstTen, getNode }) }
        catch { result = { why: 'Couldn’t check this position' } }
        if (addMenuFor !== entry) { return } // Closed, or moved on
        if (!result.problem) {
            note.textContent = result.why
            return
        }
        const spec = { kind, moves, color: result.problem.color, data: problemData(kind, result.problem) }
        if (deck.find(reviewKey(spec))) {
            note.textContent = 'Already in Review ✓'
            return
        }
        note.textContent = ''
        item.disabled = false
        item.addEventListener('click', () => {
            deck.add(spec)
            closeAddMenu()
            toast(`Added to Review as a ${PROBLEM_TYPE_NAMES[kind]} problem.`, 'success')
            render()
        })
    }))
    menu.querySelector('button:not(:disabled)')?.focus()
}

function renderReviewStatus() {
    const dueCount = deck.due().length
    // A dot on the Review mode button when problems are due; the count is in its tooltip and for screen readers
    const label = $('label[for="mode-review"]')
    label.classList.toggle('has-due', dueCount > 0)
    label.title = dueCount
        ? `${dueCount} problem${dueCount === 1 ? '' : 's'} ready for review`
        : 'Go through the problems you missed that are due again'
    $('#review-due-count').textContent = dueCount ? `, ${dueCount} due` : ''
    $('#review-summary').textContent = !deck.size
        ? 'Missed problems are saved here for review.'
        : `${deck.size} saved · ${dueCount ? `${dueCount} due now` : `next due ${relativeTime(deck.nextDue())}`}`
}

function reviewEmptyPrompt() {
    const dueCount = deck.due().length
    if (dueCount) { return `${dueCount} review${dueCount === 1 ? ' is' : 's are'} due. Press Next to start.` }
    if (deck.size) { return `All caught up! The next review is due ${relativeTime(deck.nextDue())}.` }
    return 'No saved reviews yet. Missed problems will come back here.'
}

function renderMoveInfo(entry) {
    $('#move-info').hidden = !settings.showMoveInfo
    if (!settings.showMoveInfo) { return }

    const spoiler = problemPending() && current >= problem.index
    $('#josekipedia-link').hidden = spoiler
    $('#josekipedia-link').href = `${JOSEKIPEDIA_URL}#path:${entry.path}`
    $('#move-title').textContent = entry.move
        ? `Move ${current}: ${capitalize(colorName(entry.move.color))} ${sgfToDisplay(entry.move.coord)}`
        : 'Start'

    const meta = $('#move-meta')
    const comment = $('#move-comment')
    meta.replaceChildren()
    comment.replaceChildren()
    $('#move-sources').hidden = true

    const node = entry.node
    if (freePlay) {
        comment.textContent = 'Demo board: joseki info is off.'
        return
    }
    if (spoiler) {
        comment.textContent = 'Comments are hidden until you answer.'
        return
    }
    if (node === undefined || (node && !node.children && busy)) {
        comment.replaceChildren(spinner(), ' Loading…')
        return
    }
    if (node === null) {
        comment.textContent = 'This position isn’t in Josekipedia.'
        return
    }

    if (entry.move && MOVE_TYPE_NAMES[node.type]) {
        const badge = document.createElement('span')
        badge.className = `badge ${MOVE_TYPE_NAMES[node.type]}`
        badge.textContent = `${MOVE_TYPE_NAMES[node.type]} move`
        meta.append(badge)
    }
    for (const label of node.labels) {
        const text = labelText(label)
        if (!text) { continue }
        const tag = document.createElement('span')
        tag.className = 'tag'
        tag.textContent = text
        meta.append(tag)
    }

    renderSources(node.sources)
    const segments = parseComment(node.comment)
    if (!segments.length) {
        comment.textContent = entry.move ? 'No comment for this move.' : 'Play a move, or choose a starting point.'
        return
    }
    marks.shapes.clear()
    for (const { coord } of segments.filter((segment) => segment.type === 'coord')) {
        if (!marks.shapes.has(coord)) { marks.shapes.set(coord, MARK_SHAPES[marks.shapes.size % MARK_SHAPES.length]) }
    }
    for (const segment of segments) {
        comment.append(renderSegment(segment))
    }
}

/** The books and professionals Josekipedia cites for a move. */
function renderSources(sources = []) {
    const items = sources.map(describeSource).filter(Boolean)
    $('#move-sources').hidden = !items.length
    $('#move-sources ul').replaceChildren(...items.map((source) => {
        const li = document.createElement('li')
        li.append(sourceTitle(source))
        if (source.detail) { li.append(` · ${cleanText(source.detail)}`) }
        return li
    }))
}

/** A source's title, linked to its Sensei's Library page if it has one. */
function sourceTitle({ title, url }) {
    if (!url) { return document.createTextNode(title) }
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = title
    a.title = 'About this book on Sensei’s Library'
    return a
}

function renderSegment(segment) {
    switch (segment.type) {
        case 'path': {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'link'
            button.textContent = segment.label
            button.title = 'Load this variation'
            button.addEventListener('click', () => {
                document.querySelectorAll('input[name="start"]').forEach((input) => { input.checked = false })
                startGame(segment.path)
            })
            return button
        }
        case 'coord': {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'coord-ref'
            button.dataset.coord = segment.coord
            const symbol = document.createElement('span')
            symbol.className = 'shape-symbol'
            symbol.setAttribute('aria-hidden', 'true')
            symbol.textContent = SHAPE_SYMBOLS[marks.shapes.get(segment.coord)]
            button.append(symbol, segment.label)
            button.title = 'Mark on the board'
            const pinned = marks.pinned.has(segment.coord)
            button.classList.toggle('pinned', pinned)
            button.setAttribute('aria-pressed', pinned)
            button.addEventListener('mouseenter', () => setHoverMark(segment.coord))
            button.addEventListener('mouseleave', () => setHoverMark(null))
            button.addEventListener('click', () => togglePinnedMark(segment.coord))
            return button
        }
        case 'source': {
            const span = document.createElement('cite')
            span.append(sourceTitle(segment))
            if (segment.detail) { span.append(` (${segment.detail})`) }
            return span
        }
        case 'url': {
            const a = document.createElement('a')
            a.href = segment.url
            a.target = '_blank'
            a.rel = 'noopener noreferrer'
            a.textContent = segment.url
            return a
        }
        default:
            return document.createTextNode(segment.text)
    }
}

// --- Toasts --------------------------------------------------------------------

/** A small loading spinner (see .spinner in index.css). */
function spinner() {
    const element = document.createElement('span')
    element.className = 'spinner'
    element.setAttribute('aria-hidden', 'true')
    return element
}

/**
 * Shows a message over the board. It fades after a few seconds, unless it has an action button
 * or is `sticky` (the caller removes it). Returns the message element.
 */
function toast(message, kind = 'info', action, { sticky = false } = {}) {
    const container = $('#toasts')
    const item = document.createElement('div')
    item.className = `toast ${kind}`
    item.append(message)
    if (action) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = action.label
        button.addEventListener('click', () => {
            item.remove()
            action.action()
        })
        item.append(button)
    }
    container.prepend(item)
    while (container.children.length > 3) { container.lastChild.remove() }
    if (!action && !sticky) {
        setTimeout(() => {
            item.classList.add('leaving')
            setTimeout(() => item.remove(), 400)
        }, 2600)
    }
    return item
}

// "End of this joseki" stays up until the player moves away from that position, so it isn't
// mistaken for a position with more to play
let endNotice = null // { entry, element }

function showEndOfJoseki() {
    // Who's Better? positions are often the end of a line, and saying so isn't news there
    if (problem?.kind === 'better' && current === problem.index) { return }
    endNotice?.element.remove()
    endNotice = { entry: currentEntry(), element: toast('That’s the end of this joseki.', 'info', null, { sticky: true }) }
}

function clearToasts() {
    $('#toasts').replaceChildren()
}

// --- Setup ---------------------------------------------------------------------

/** Builds the collapsible starting-point tree. Fuseki are a group with no position of their own. */
function buildStartingPoints() {
    const tree = [...JOSEKI, { name: 'Fuseki', key: 'fuseki', children: FUSEKI }]
    const contains = (point, path) => point.path === path || (point.children || []).some((child) => contains(child, path))

    const makeItems = (points) => points.map((point) => {
        const li = document.createElement('li')
        const row = document.createElement('div')
        row.className = 'tree-row'
        li.append(row)

        let name
        if (point.path) {
            name = document.createElement('label')
            const input = document.createElement('input')
            input.type = 'radio'
            input.name = 'start'
            input.value = point.path
            name.append(input, point.name)
        }
        else {
            name = document.createElement('span')
            name.className = 'tree-group'
            name.textContent = point.name
        }

        if (!point.children) {
            row.append(Object.assign(document.createElement('span'), { className: 'tree-spacer' }), name)
            return li
        }

        const key = point.key || point.path
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'tree-toggle'
        toggle.setAttribute('aria-label', `Show variations of ${point.name}`)
        const ul = document.createElement('ul')
        ul.append(...makeItems(point.children))

        const setExpanded = (expanded) => {
            toggle.setAttribute('aria-expanded', expanded)
            ul.hidden = !expanded
        }
        // Start collapsed, except branches the player opened before or that hold the selected start
        setExpanded(settings.expanded.includes(key) || point.children.some((child) => contains(child, settings.start)))
        const flip = () => {
            const expanded = ul.hidden
            setExpanded(expanded)
            settings.expanded = settings.expanded.filter((k) => k !== key)
            if (expanded) { settings.expanded.push(key) }
            saveSettings()
        }
        toggle.addEventListener('click', flip)
        if (!point.path) { name.addEventListener('click', flip) }

        row.append(toggle, name)
        li.append(ul)
        return li
    })
    $('#starting-points').append(...makeItems(tree))
}

function bindControls() {
    $('#undo').addEventListener('click', undo)
    $('#redo').addEventListener('click', redo)
    $('#pass').addEventListener('click', pass)

    $('#start-form').addEventListener('submit', (e) => {
        e.preventDefault()
        const start = new FormData(e.target).get('start') || 'empty'
        settings.start = start
        saveSettings()
        begin()
    })
    const savedStart = document.querySelector(`input[name="start"][value="${CSS.escape(settings.start)}"]`)
    if (savedStart) { savedStart.checked = true }

    for (const input of document.querySelectorAll('input[name="player"]')) {
        input.checked = input.value === settings.player
        input.addEventListener('change', () => {
            settings.player = input.value
            saveSettings()
            if (settings.mode !== 'explore') { return newProblem() }
            ++generation
            advance() // The computer moves if it's now its turn
        })
    }

    for (const input of document.querySelectorAll('input[name="mode"]')) {
        input.checked = input.value === settings.mode
        input.addEventListener('change', () => switchMode(input.value))
    }
    applyMode()

    // The title starts a new problem (it's still a link, so it can be opened in a new tab)
    $('#home-link').addEventListener('click', (event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { return }
        event.preventDefault()
        switchMode('problems')
    })

    for (const input of document.querySelectorAll('[data-problem-type]')) {
        const kind = input.dataset.problemType
        input.checked = settings.problemTypes[kind]
        input.addEventListener('change', () => {
            settings.problemTypes[kind] = input.checked
            if (!enabledProblemTypes().length) {
                settings.problemTypes[kind] = input.checked = true
                toast('Keep at least one problem type selected.', 'warning')
            }
            saveSettings()
            renderReviewStatus() // Due reviews depend on the enabled types
        })
    }
    $('#copy-link').addEventListener('click', copyLink)
    $('#add-review').addEventListener('click', () => (addMenuFor ? closeAddMenu() : openAddMenu()))
    document.addEventListener('click', (event) => {
        if (addMenuFor && !event.target.closest('#add-review, #add-review-menu')) { closeAddMenu() }
    })
    document.addEventListener('keydown', (event) => {
        if (addMenuFor && event.key === 'Escape') {
            closeAddMenu()
            $('#add-review').focus()
        }
    })
    $('#show-answer').addEventListener('click', revealAnswer)
    $('#explore-problem').addEventListener('click', exploreFromHere)
    $('#next-problem').addEventListener('click', () => newProblem())
    // Reviews become due over time, so keep the counts fresh
    setInterval(() => {
        renderReviewStatus()
        if (settings.mode !== 'explore') { renderProblemBar() }
    }, 30 * 1000)

    for (const input of document.querySelectorAll('[data-setting]')) {
        const key = input.dataset.setting
        input.checked = Boolean(settings[key])
        input.addEventListener('change', () => {
            settings[key] = input.checked
            saveSettings()
            render()
        })
    }

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.('textarea, select, input:not([type="checkbox"])')) { return }
        const actions = {
            ArrowLeft: undo,
            ArrowRight: redo,
            h: () => $('[data-setting="showMoves"]').click(),
            n: () => { if (settings.mode !== 'explore') { newProblem() } },
        }
        const action = actions[e.key]
        if (action) {
            e.preventDefault()
            action()
        }
    })
}

/** Shows the controls for the current mode. */
function applyMode() {
    const explore = settings.mode === 'explore'
    document.body.dataset.mode = settings.mode
    $('#start').textContent = explore ? 'Start' : 'New Problem'

    // The demo board has no joseki data, so there's nothing to make problems from
    const demo = $('input[name="start"][value="demo"]')
    demo.disabled = !explore
    $('#demo-option').title = explore
        ? 'Play both colors freely. The computer won’t respond and no joseki info is loaded.'
        : 'Only available in Explore mode. Problems need joseki data, which the demo board doesn’t load.'
    if (!explore && demo.checked) {
        $('input[name="start"][value="empty"]').checked = true
        settings.start = 'empty'
        saveSettings()
    }
}

/** Changes mode (updating the mode buttons) and starts afresh in it. */
function switchMode(mode) {
    settings.mode = mode
    saveSettings()
    document.querySelectorAll('input[name="mode"]').forEach((input) => { input.checked = input.value === mode })
    applyMode()
    begin()
}

/** Starts a game against the computer or a problem, depending on the mode. */
function begin() {
    if (settings.mode === 'explore') {
        startGame(settings.start)
    }
    else {
        newProblem()
    }
}

// --- Shareable links -------------------------------------------------------------
// The URL's hash always leads back to what's on screen, so the address can be bookmarked or
// shared and reloading keeps it: in Explore mode the moves to the current position
// (#path=pdqfnc), in the problem modes the current problem (#problem=..., see encodeProblem).

const PATH_HASH = /^#path=((?:[a-t]{2})+)$/
const PROBLEM_HASH = /^#problem=([A-Za-z0-9_.-]+)$/

function updateUrl(entry) {
    const explore = settings.mode === 'explore'
    $('#copy-link').disabled = explore ? !entry.path : !problem
    $('#copy-link').title = explore ? 'Copy a link to this position' : 'Copy a link to this problem'
    const hash = explore
        ? (entry.path ? `#path=${entry.path}` : '')
        : (problem ? `#problem=${problemLink()}` : '')
    if (location.hash !== hash) { // window.history: `history` here is the game's move list
        window.history.replaceState(null, '', hash || location.pathname + location.search)
    }
}

const problemLink = () => (problem.link ??= encodeProblem(problem.spec))
const shareUrl = () => `${location.origin}${location.pathname}${settings.mode === 'explore'
    ? `#path=${currentEntry().path}`
    : `#problem=${problemLink()}`}`

async function copyLink() {
    const url = shareUrl()
    const what = settings.mode === 'explore' ? 'position' : 'problem'
    try {
        await navigator.clipboard.writeText(url)
        toast(`Link to this ${what} copied.`, 'success')
    }
    catch {
        prompt(`Copy this link to share the ${what}:`, url) // Clipboard unavailable
    }
}

/**
 * If the URL holds a shared problem, opens it in Problems mode, played as the color it was made
 * for (whatever problem types are turned on). A reload in Review mode stays a review. Returns true
 * if it opened one.
 */
function openSharedProblem() {
    const match = PROBLEM_HASH.exec(location.hash)
    if (!match) { return false }
    let spec
    try { spec = decodeProblem(match[1]) }
    catch {
        toast('That problem link doesn’t work. It may have been cut short when it was copied.', 'error')
        return false
    }

    const previousPlayer = settings.player
    const review = settings.mode === 'review' && deck.find(reviewKey(spec)) ? reviewKey(spec) : null
    settings.mode = review ? 'review' : 'problems'
    settings.player = colorName(spec.color)
    saveSettings()
    document.querySelectorAll('input[name="mode"]').forEach((input) => { input.checked = input.value === settings.mode })
    document.querySelectorAll('input[name="player"]').forEach((input) => { input.checked = input.value === settings.player })
    applyMode()
    loadSharedProblem(spec, match[1], previousPlayer, review)
    return true
}

async function loadSharedProblem(spec, link, previousPlayer, reviewKey) {
    const gen = ++generation
    problem = null
    freePlay = false
    if (!history.length) { setupPosition([]) }
    clearToasts()
    setBusy(true)
    try {
        const found = await rebuildProblem(spec, { getNode })
        const ladder = await findLadderSetup(found, spec.kind)
        if (gen !== generation) { return }
        presentProblem(found, spec.kind, { color: spec.color, reviewKey, link, ladder })
        // Reloading the page lands here too, so only speak up if the player's color changed
        if (settings.player !== previousPlayer) { toast(`You’re playing ${capitalize(settings.player)}, the color this problem is for.`) }
    }
    catch (error) {
        if (gen !== generation) { return }
        setBusy(false)
        const message = error instanceof StaleProblemError ? 'That problem is no longer in Josekipedia.' : 'Couldn’t load that problem.'
        toast(message, 'error', { label: 'New Problem', action: () => newProblem() })
    }
}

/** Takes the position on the board into Explore mode, as a link to it would. */
function exploreFromHere() {
    window.history.replaceState(null, '', `#path=${currentEntry().path}`)
    if (!openSharedPosition()) { switchMode('explore') } // The empty board has no path
}

/**
 * If the URL holds a shared position, opens it in Explore mode, playing whoever's turn it is
 * (so the computer doesn't move away from it straight away). Returns true if it did.
 */
function openSharedPosition() {
    const match = PATH_HASH.exec(location.hash)
    if (!match) { return false }
    let position
    try { position = splitPath(match[1]).reduce((p, move) => p.playSgf(move), new Position()) }
    catch { return false } // Not a legal sequence

    const previousPlayer = settings.player
    settings.mode = 'explore'
    settings.player = colorName(position.toPlay)
    saveSettings()
    document.querySelectorAll('input[name="mode"]').forEach((input) => { input.checked = input.value === 'explore' })
    document.querySelectorAll('input[name="player"]').forEach((input) => { input.checked = input.value === settings.player })
    document.querySelectorAll('input[name="start"]').forEach((input) => { input.checked = false })
    applyMode()
    startGame(match[1])
    // Reloading the page lands here too, so only speak up if the player's color changed
    if (settings.player !== previousPlayer) { toast(`You’re playing ${capitalize(settings.player)}, whose turn it is in this position.`) }
    return true
}

window.addEventListener('hashchange', () => {
    // Our own updates use replaceState, which doesn't fire this; it's a pasted or edited link
    if (PATH_HASH.test(location.hash) && location.hash.slice(6) !== currentEntry()?.path) { openSharedPosition() }
    else if (PROBLEM_HASH.test(location.hash) && location.hash.slice(9) !== problem?.link) { openSharedProblem() }
})

// The app opens in Problems mode, unless a link (or a reload) says otherwise
if (!PATH_HASH.test(location.hash) && !PROBLEM_HASH.test(location.hash)) {
    settings.mode = 'problems'
    saveSettings()
}
buildStartingPoints()
bindControls()
// A shared link (or a reload) opens its position or problem
if (!openSharedPosition() && !openSharedProblem()) { begin() }
