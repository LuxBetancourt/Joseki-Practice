// The Saved Reviews page: lists the review deck, with removing (and undoing removals).

import { ReviewDeck, relativeTime } from './reviews.js'
import { Position, colorName, PASS, fromSgf } from './go.js'
import { renderShape } from './shape-view.js'
import { ensureStoneGradients } from './board-view.js'

const $ = (selector) => document.querySelector(selector)
const KIND_NAMES = { next: 'Next Move', punish: 'Punish', shape: 'Final Shape', path: 'Pick the Path' }

const deck = new ReviewDeck()
let lastRemoved = [] // For undo

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
    $('#reviews-summary').textContent = deck.size
        ? `${deck.size} saved · ${dueCount ? `${dueCount} due now` : `next due ${relativeTime(deck.nextDue())}`}`
        : 'No saved reviews. Problems you miss are saved here.'
    $('#remove-all').hidden = !deck.size

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
        `Missed ${item.lapses} time${item.lapses === 1 ? '' : 's'}`,
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

function removeItems(items, message) {
    lastRemoved = items
    for (const item of items) { deck.remove(item.key) }
    $('#undo-text').textContent = message
    $('#undo-bar').hidden = false
    render()
}

$('#remove-all').addEventListener('click', () => {
    if (confirm(`Remove all ${deck.size} saved problems?`)) {
        removeItems([...deck.items], `Removed ${deck.size} problems.`)
    }
})

$('#undo-remove').addEventListener('click', () => {
    deck.restore(lastRemoved)
    lastRemoved = []
    $('#undo-bar').hidden = true
    render()
})

ensureStoneGradients()
render()
