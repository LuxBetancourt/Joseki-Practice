import { Position, IllegalMoveError, BLACK, WHITE, PASS, toSgf, fromSgf, sgfToDisplay, colorName } from './go.js'
import { getNode, prefetch, ROOT_ID, MoveType, MOVE_TYPE_NAMES, TENUKI_LABEL, labelText } from './josekipedia.js'
import { generateNextMove, generatePunish } from './problems.js'
import { mainLine } from './lines.js'
import { renderShape, shapeRegion, localShape } from './shape-view.js'
import { parseComment, splitPath } from './text.js'
import { BoardView } from './board-view.js'
import { JOSEKI, FUSEKI, CLASSIC_OPENINGS } from './starting-points.js'
import { JOSEKIPEDIA_URL } from './config.js'

const $ = (selector) => document.querySelector(selector)

// --- Settings ------------------------------------------------------------------

const DEFAULT_SETTINGS = {
    mode: 'practice', // 'practice' | 'next' | 'punish'
    player: 'black',
    ideal: true, good: false, bad: false, trick: false, question: false,
    firstTen: true,
    onlyPassIfJoseki: false,
    showMoves: false,
    showMoveInfo: true,
    showFollowUps: false,
    start: 'empty',
}

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem('settings'))
        if (saved) { return { ...DEFAULT_SETTINGS, ...saved } }

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

const settings = loadSettings()
const humanColor = () => (settings.player === 'black' ? BLACK : WHITE)

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

// The active problem in "next" / "punish" mode: the player must answer at history[index].
//   answers: Map of coord -> move type for every move Josekipedia knows there
//   mistake: { move, type } for punish problems
let problem = null
const stats = { next: { solved: 0, attempted: 0 }, punish: { solved: 0, attempted: 0 } } // This session's score per mode
const problemPending = () => problem && !problem.solved && !problem.revealed

const currentEntry = () => history[current]
const isHumanTurn = (entry = currentEntry()) => freePlay || entry.position.toPlay === humanColor()

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const view = new BoardView($('#board'), {
    onPlay: (x, y) => {
        if (!busy && isHumanTurn()) { playMove(toSgf(x, y), { byHuman: true }) }
    },
    onContextMenu: returnToMove,
    canHover: () => (!busy && isHumanTurn() ? currentEntry().position.toPlay : null),
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

    const answering = byHuman && problemPending() && current === problem.index
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
    const type = problem.answers.get(coord)
    const score = stats[problem.kind]
    if (++problem.attempts === 1) { ++score.attempted }

    const correct = type === MoveType.IDEAL || (type === MoveType.GOOD && problem.kind === 'next')
    if (correct) {
        problem.solved = true
        if (problem.attempts === 1) { ++score.solved }
        toast(type === MoveType.IDEAL ? '✓✓ Correct!' : '✓ Correct (a good move).', 'success')
        advance() // The computer replies and play continues as practice
        return
    }

    let message = 'That move isn’t in Josekipedia here.'
    if (type === MoveType.GOOD) { message = 'Playable, but there’s a stronger punishment.' }
    else if (MOVE_TYPE_NAMES[type]) { message = `That’s a ${MOVE_TYPE_NAMES[type] === 'question' ? 'questionable' : MOVE_TYPE_NAMES[type]} move.` }
    toast(`${message} Try again.`, 'error')

    // Show the wrong move briefly, then take it back
    const gen = generation
    setBusy(true)
    setTimeout(() => {
        if (gen !== generation) { return }
        history = history.slice(0, problem.index + 1)
        current = problem.index
        ++generation
        setBusy(false)
    }, 1200)
}

function revealAnswer() {
    if (!problemPending()) { return }
    problem.revealed = true
    if (problem.attempts === 0) { ++stats[problem.kind].attempted }
    goTo(problem.index)
    render()
}

const problemPrompt = () => {
    const you = capitalize(colorName(humanColor()))
    if (problem.kind === 'next') { return `${you} to play. Find the joseki move.` }
    const { move, type } = problem.mistake
    const them = capitalize(colorName(humanColor() === BLACK ? WHITE : BLACK))
    const where = sgfToDisplay(move)
    return type === MoveType.TRICK
        ? `${them}’s ${where} is a trick move. Find the refutation.`
        : `${them}’s ${where} is a mistake. Punish it!`
}

async function newProblem() {
    const gen = ++generation
    problem = null
    freePlay = false
    if (!history.length) { setupPosition([]) }
    clearToasts()
    setBusy(true)

    const start = settings.start === 'empty' || settings.start === 'demo' ? '' : settings.start
    const options = { startMoves: splitPath(start), color: humanColor(), firstTen: settings.firstTen, getNode }
    try {
        const kind = settings.mode
        // Random lines often end early in tenuki, so try a few before giving up
        let found = null
        for (let attempt = 0; attempt < 3 && !found && gen === generation; ++attempt) {
            found = await (kind === 'next' ? generateNextMove(options) : generatePunish(options))
        }
        if (gen !== generation) { return }
        if (!found) {
            setBusy(false)
            toast('Couldn’t find a problem from this starting point.', 'warning', { label: 'Try Again', action: newProblem })
            return
        }
        setupPosition(found.moves)
        problem = { kind, index: current, answers: found.answers, mistake: found.mistake, attempts: 0, solved: false, revealed: false }
        ++generation
        advance()
    }
    catch (error) {
        if (gen !== generation) { return }
        console.error(error)
        setBusy(false)
        toast('Couldn’t load data from Josekipedia.', 'error', { label: 'Retry', action: newProblem })
    }
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

        if (!isHumanTurn(entry)) {
            const move = chooseComputerMove(entry)
            if (!move) { return }
            setBusy(true)
            await delay(350)
            if (gen !== generation) { return }
            busy = false
            playMove(move.move, { byHuman: false })
        }
        else if (!entry.node.children.some((child) => child.color === entry.position.toPlay)) {
            toast('That’s the end of this joseki.')
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
        toast('That’s the end of this joseki.')
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
    let target = current - 1
    while (target > 0 && !isHumanTurn(history[target])) { --target }
    goTo(target)
}

function redo() {
    let target = current + 1
    while (target < history.length - 1 && !isHumanTurn(history[target])) { ++target }
    goTo(target)
}

/**
 * Right-clicking a stone returns to the position just after it was played, or just before it
 * if it's the most recent move. If that leaves the computer to move, it picks a new reply.
 */
function returnToMove(x, y) {
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
    if (!busy && isHumanTurn()) { playMove(PASS, { byHuman: true }) }
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
    view.render({ marks: currentMarks() })
}

function togglePinnedMark(coord) {
    if (marks.pinned.has(coord)) { marks.pinned.delete(coord) }
    else { marks.pinned.add(coord) }
    for (const ref of document.querySelectorAll(`.coord-ref[data-coord="${coord}"]`)) {
        ref.classList.toggle('pinned', marks.pinned.has(coord))
        ref.setAttribute('aria-pressed', marks.pinned.has(coord))
    }
    view.render({ marks: currentMarks() })
}

function render() {
    const entry = currentEntry()
    const { position } = entry
    const lastMove = entry.move && fromSgf(entry.move.coord)
    if (marks.entry !== entry) {
        marks.entry = entry
        marks.pinned.clear()
        marks.hover = null
        marks.shapes.clear()
    }

    const toHighlight = (move, type) => ({ ...fromSgf(move), type: MOVE_TYPE_NAMES[type] || 'unknown' })
    let highlights = []
    if (problem?.revealed && current === problem.index) {
        const accepted = problem.kind === 'next' ? [MoveType.IDEAL, MoveType.GOOD] : [MoveType.IDEAL]
        highlights = [...problem.answers].filter(([, type]) => accepted.includes(type)).map(([move, type]) => toHighlight(move, type))
    }
    else if (settings.showMoves && entry.node?.children && !problemPending()) {
        highlights = entry.node.children
            .filter((child) => child.color === position.toPlay)
            .map((child) => toHighlight(child.move, child.type))
    }
    view.render({ position, lastMove, highlights: highlights.filter((h) => h.x !== undefined), marks: currentMarks() })

    $('#undo').disabled = current === 0
    $('#redo').disabled = current === history.length - 1
    $('#pass').disabled = busy || !isHumanTurn()

    const toPlay = capitalize(colorName(position.toPlay))
    const showingWrongAnswer = problemPending() && current > problem.index
    $('#status').textContent = showingWrongAnswer ? '' : busy
        ? (problem || settings.mode === 'practice' ? (isHumanTurn() ? 'Loading…' : 'Thinking…') : 'Finding a problem…')
        : freePlay || isHumanTurn() ? `${toPlay} to play` : `Computer (${toPlay})`

    renderProblemBar()
    renderMoveInfo(entry)
    renderFollowUps(entry)
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
    slot.textContent = 'Loading…'
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
    const inProblemMode = settings.mode !== 'practice'
    $('#problem-bar').hidden = !inProblemMode
    if (!inProblemMode) { return }

    let prompt = ''
    if (problemPending()) { prompt = problemPrompt() }
    else if (problem?.solved) { prompt = 'Solved! Keep playing, or get a new problem.' }
    else if (problem?.revealed) { prompt = 'Answers are highlighted.' }
    else if (!problem && !busy) { prompt = 'No problem loaded. Try again, or choose another starting point.' }
    $('#problem-prompt').textContent = prompt
    $('#show-answer').disabled = !problemPending() || busy
    const score = stats[settings.mode]
    $('#score').textContent = score.attempted ? `${score.solved} / ${score.attempted} solved first try` : ''
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
        comment.textContent = 'Loading…'
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

function toast(message, kind = 'info', action) {
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
    if (!action) {
        setTimeout(() => {
            item.classList.add('leaving')
            setTimeout(() => item.remove(), 400)
        }, 2600)
    }
}

function clearToasts() {
    $('#toasts').replaceChildren()
}

// --- Setup ---------------------------------------------------------------------

function buildStartingPoints() {
    const makeItems = (points) => points.map((point) => {
        const li = document.createElement('li')
        const label = document.createElement('label')
        const input = document.createElement('input')
        input.type = 'radio'
        input.name = 'start'
        input.value = point.path
        label.append(input, ` ${point.name}`)
        li.append(label)
        if (point.children) {
            const ul = document.createElement('ul')
            ul.append(...makeItems(point.children))
            li.append(ul)
        }
        return li
    })
    $('#starting-points').append(...makeItems(JOSEKI))
    $('#fuseki').append(...makeItems(FUSEKI))
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
            if (settings.mode !== 'practice') { return newProblem() }
            ++generation
            advance() // The computer moves if it's now its turn
        })
    }

    for (const input of document.querySelectorAll('input[name="mode"]')) {
        input.checked = input.value === settings.mode
        input.addEventListener('change', () => {
            settings.mode = input.value
            saveSettings()
            applyMode()
            begin()
        })
    }
    applyMode()
    $('#show-answer').addEventListener('click', revealAnswer)
    $('#next-problem').addEventListener('click', newProblem)

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
            n: () => { if (settings.mode !== 'practice') { newProblem() } },
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
    document.body.dataset.mode = settings.mode
    $('#start').textContent = settings.mode === 'practice' ? 'Start' : 'New Problem'
}

/** Starts a practice game or a problem, depending on the mode. */
function begin() {
    if (settings.mode === 'practice') {
        startGame(settings.start)
    }
    else {
        newProblem()
    }
}

buildStartingPoints()
bindControls()
begin()
