// The Saved Reviews page: lists the review deck, with removing (and undoing removals), and
// exporting it to a file or importing one.

import { ReviewDeck, relativeTime } from './reviews.js'
import { Position, colorName, PASS, fromSgf } from './go.js'
import { renderShape } from './shape-view.js'
import { ensureStoneGradients } from './board-view.js'
import { byKind } from './problem-kinds.js'

const $ = (selector) => document.querySelector(selector)
const KIND_NAMES = byKind((kind) => kind.name)

const deck = new ReviewDeck()
let undo = null // Puts back the last removal or import

const capitalize = (s) => s[0].toUpperCase() + s.slice(1)

/** The position a saved problem starts from, or null if its moves don't replay. */
function startPosition(item) {
    try {
        return item.moves.reduce((position, move) => position.playSgf(move), new Position())
    }
    catch {
        return null
    }
}

function render() {
    const now = Date.now()
    const dueCount = deck.items.filter((item) => item.due <= now).length
    const summary = $('#reviews-summary')
    if (deck.size) {
        summary.textContent = `${deck.size} saved · ${dueCount ? `${dueCount} due now` : `next due ${relativeTime(deck.nextDue())}`}`
    }
    else {
        const back = Object.assign(document.createElement('a'), { href: 'index.html', textContent: 'Back to the board' })
        summary.replaceChildren('No saved reviews. Problems you miss are saved here. ', back)
    }
    $('#remove-all').hidden = !deck.size
    $('#export-reviews').hidden = !deck.size

    const list = $('#review-list')
    list.replaceChildren(...[...deck.items].sort((a, b) => a.due - b.due).map((item) => card(item, now)))
}

function card(item, now) {
    const li = document.createElement('li')
    li.className = 'panel review-card'

    const position = startPosition(item)
    if (position) {
        // Ring the last move, which is what the problem responds to
        const last = [...item.moves].reverse().find((move) => move !== PASS)
        const rings = last ? [{ ...fromSgf(last), type: 'last' }] : []
        li.append(renderShape(position, { rings, label: 'Problem position' }))
    }

    const title = document.createElement('h2')
    title.textContent = KIND_NAMES[item.kind] || item.kind
    const details = document.createElement('p')
    details.className = 'review-details'
    const lines = [
        `Play as ${capitalize(colorName(item.color))}`,
        item.due <= now ? 'Due now' : `Due ${relativeTime(item.due, now)}`,
        item.lapses ? `Missed ${item.lapses} time${item.lapses === 1 ? '' : 's'}` : 'Added from Explore',
    ]
    details.append(...lines.flatMap((line, i) => (i ? [document.createElement('br'), line] : [line])))

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'link'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => removeItems([item], 'Removed 1 problem.'))

    li.append(title, details, remove)
    return li
}

/** Shows `message`, with an Undo button that runs `action` (if there is one). */
function offerUndo(message, action) {
    undo = action
    $('#undo-text').textContent = message
    $('#undo-remove').hidden = !action
    $('#undo-bar').hidden = false
}

function removeItems(items, message) {
    for (const item of items) { deck.remove(item.key) }
    offerUndo(message, () => deck.restore(items))
    render()
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

$('#export-reviews').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([deck.export()], { type: 'application/json' }))
    const link = Object.assign(document.createElement('a'), {
        href: url,
        download: `joseki-practice-reviews-${new Date().toISOString().slice(0, 10)}.json`,
    })
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
})

$('#import-reviews').addEventListener('click', () => $('#import-file').click())
$('#import-file').addEventListener('change', async () => {
    const file = $('#import-file').files[0]
    $('#import-file').value = '' // So choosing the same file again still counts as a change
    if (!file) { return }
    let added
    try { added = deck.import(await file.text()) }
    catch (error) {
        alert(error.message)
        return
    }
    if (added.length) {
        offerUndo(`Imported ${plural(added.length, 'problem')}.`, () => added.forEach((item) => deck.remove(item.key)))
    }
    else {
        offerUndo('Nothing new to import: you already have every problem in that file.', null)
    }
    render()
})

$('#remove-all').addEventListener('click', () => {
    if (confirm(`Remove all ${deck.size} saved problems?`)) {
        removeItems([...deck.items], `Removed ${deck.size} problems.`)
    }
})

$('#undo-remove').addEventListener('click', () => {
    undo?.()
    undo = null
    $('#undo-bar').hidden = true
    render()
})

ensureStoneGradients()
render()
