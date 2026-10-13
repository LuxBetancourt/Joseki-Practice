import { Position, IllegalMoveError, BLACK, WHITE, PASS, toSgf, fromSgf, sgfToDisplay, colorName } from './go.js'
import { getNode, prefetch, ROOT_ID, MOVE_TYPE_NAMES, TENUKI_LABEL, labelText } from './josekipedia.js'
import { parseComment, splitPath } from './text.js'
import { BoardView } from './board-view.js'
import { JOSEKI, FUSEKI, CLASSIC_OPENINGS } from './starting-points.js'
import { JOSEKIPEDIA_URL } from './config.js'

const $ = (selector) => document.querySelector(selector)

// --- Settings ------------------------------------------------------------------

const DEFAULT_SETTINGS = {
    player: 'black',
    ideal: true, good: false, bad: false, trick: false, question: false,
    firstTen: true,
    onlyPassIfJoseki: false,
    showMoves: false,
    showMoveInfo: true,
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

    pushEntry({ position, move: { coord, color }, node: undefined, path: entry.path + coord })
    ++generation
    if (coord === PASS) { toast(`${byHuman && !freePlay ? 'You' : capitalize(colorName(color))} passed.`) }
    advance({ feedback: byHuman })
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
    freePlay = start === 'demo'
    const moves = start === 'empty' || start === 'demo' ? [] : splitPath(start)
    const preset = [...JOSEKI, ...FUSEKI].flatMap(function flatten(p) { return [p, ...(p.children || []).flatMap(flatten)] })
        .find((p) => p.path === start)
    if (!freePlay) { prefetch([ROOT_ID, ...(preset?.ids || [])]) }

    clearToasts()
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
    ++generation
    advance()
}

// --- Rendering -----------------------------------------------------------------

const capitalize = (s) => s[0].toUpperCase() + s.slice(1)

function render() {
    const entry = currentEntry()
    const { position } = entry
    const lastMove = entry.move && fromSgf(entry.move.coord)

    let highlights = []
    if (settings.showMoves && entry.node?.children) {
        highlights = entry.node.children
            .filter((child) => child.color === position.toPlay)
            .map((child) => ({ ...fromSgf(child.move), type: MOVE_TYPE_NAMES[child.type] || 'unknown' }))
            .filter((h) => h.x !== undefined)
    }
    view.render({ position, lastMove, highlights })

    $('#undo').disabled = current === 0
    $('#redo').disabled = current === history.length - 1
    $('#pass').disabled = busy || !isHumanTurn()

    const toPlay = capitalize(colorName(position.toPlay))
    $('#status').textContent = busy
        ? (isHumanTurn() ? 'Loading…' : 'Thinking…')
        : freePlay || isHumanTurn() ? `${toPlay} to play` : `Computer (${toPlay})`

    renderMoveInfo(entry)
}

function renderMoveInfo(entry) {
    $('#move-info').hidden = !settings.showMoveInfo
    if (!settings.showMoveInfo) { return }

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
            const span = document.createElement('span')
            span.className = 'coord-ref'
            span.textContent = segment.label
            const point = fromSgf(segment.coord)
            span.addEventListener('mouseenter', () => view.render({ marks: [point] }))
            span.addEventListener('mouseleave', () => view.render({ marks: [] }))
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
        startGame(start)
    })
    const savedStart = document.querySelector(`input[name="start"][value="${CSS.escape(settings.start)}"]`)
    if (savedStart) { savedStart.checked = true }

    for (const input of document.querySelectorAll('input[name="player"]')) {
        input.checked = input.value === settings.player
        input.addEventListener('change', () => {
            settings.player = input.value
            saveSettings()
            ++generation
            advance() // The computer moves if it's now its turn
        })
    }

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
        }
        const action = actions[e.key]
        if (action) {
            e.preventDefault()
            action()
        }
    })
}

buildStartingPoints()
bindControls()
startGame(settings.start)
