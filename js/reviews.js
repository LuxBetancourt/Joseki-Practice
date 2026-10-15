// Spaced repetition for missed problems. The deck lives in localStorage; each item holds enough
// to rebuild its problem (kind, moves, color and kind-specific data) plus its schedule.

import { KINDS } from './problem-kinds.js'
import { readJson, writeJson } from './storage.js'

const STORAGE_KEY = 'reviews:v1'
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// How long until a problem comes back. A newly missed problem is due straight away; each correct
// review moves it one step further, staying at the last. Failing a review restarts it at the
// first step, but only RELEARN_DELAY later rather than immediately.
export const REVIEW_STEPS = [0, HOUR, DAY, 7 * DAY, 30 * DAY, 365 * DAY]
export const RELEARN_DELAY = 5 * MINUTE

/** "in 5 minutes", "in 3 hours", "in 2 days"… for a future timestamp. */
export function relativeTime(time, now = Date.now()) {
    const minutes = Math.max(1, Math.round((time - now) / MINUTE))
    const [amount, unit] = minutes < 60 ? [minutes, 'minute']
        : minutes < 48 * 60 ? [Math.round(minutes / 60), 'hour']
            : minutes < 60 * 24 * 60 ? [Math.round(minutes / (24 * 60)), 'day']
                : [Math.round(minutes / (30 * 24 * 60)), 'month']
    return `in ${amount} ${unit}${amount === 1 ? '' : 's'}`
}

/** Identifies the same problem across sessions: the kind and position (and target, for shapes). */
export const reviewKey = ({ kind, moves, data }) => [kind, moves.join(''), data?.answer || ''].join(':')

export class ReviewDeck {
    constructor({ storage = globalThis.localStorage, now = () => Date.now() } = {}) {
        this.storage = storage
        this.now = now
        // If storage is unavailable or corrupt, the deck starts empty, and still works for this session
        this.items = readJson(STORAGE_KEY, [], { storage, valid: Array.isArray })
    }

    save() {
        writeJson(STORAGE_KEY, this.items, { storage: this.storage })
    }

    get size() { return this.items.length }

    find(key) { return this.items.find((item) => item.key === key) }

    /** Adds a missed problem (due now), or restarts one already in the deck (due in a few minutes). */
    recordMiss(spec) {
        const key = reviewKey(spec)
        let item = this.find(key)
        const failedReview = Boolean(item)
        if (!item) {
            item = { key, kind: spec.kind, moves: spec.moves, color: spec.color, data: spec.data, added: this.now(), lapses: 0 }
            this.items.push(item)
        }
        item.step = 0
        item.due = this.now() + (failedReview ? RELEARN_DELAY : REVIEW_STEPS[0])
        item.lapses += 1
        this.save()
        return item
    }

    /** Adds a problem the player chose to review (due now), unless it's already in the deck. Returns the item or null. */
    add(spec) {
        const key = reviewKey(spec)
        if (this.find(key)) { return null }
        const item = { key, kind: spec.kind, moves: spec.moves, color: spec.color, data: spec.data, added: this.now(), lapses: 0, step: 0, due: this.now() }
        this.items.push(item)
        this.save()
        return item
    }

    /** A review answered correctly the first time: wait longer before showing it again. */
    recordSuccess(key) {
        const item = this.find(key)
        if (!item) { return null }
        item.step = Math.min((item.step ?? 0) + 1, REVIEW_STEPS.length - 1)
        item.due = this.now() + REVIEW_STEPS[item.step]
        this.save()
        return item
    }

    remove(key) {
        this.items = this.items.filter((item) => item.key !== key)
        this.save()
    }

    clear() {
        this.items = []
        this.save()
    }

    /** Puts back items that were removed (for undo), keeping any that are already there. */
    restore(items) {
        for (const item of items) {
            if (!this.find(item.key)) { this.items.push(item) }
        }
        this.save()
    }

    /**
     * Due items, most overdue first, optionally limited to some kinds, a color and a starting
     * point (to match the player's settings).
     * @param {{ kinds?: string[], color?: number, startMoves?: string[] }} filter
     */
    due({ kinds, color, startMoves = [] } = {}) {
        const now = this.now()
        return this.items
            .filter((item) => item.due <= now && (!kinds || kinds.includes(item.kind)) && (!color || item.color === color)
                && startMoves.every((move, i) => item.moves[i] === move))
            .sort((a, b) => a.due - b.due)
    }

    /** When the next item is due (a timestamp), or null if the deck is empty. */
    nextDue() {
        return this.items.length ? Math.min(...this.items.map((item) => item.due)) : null
    }

    /** The deck as a file's text, for backing up or moving to another browser (see readExport). */
    export() {
        return JSON.stringify({ app: EXPORT_APP, version: 1, exported: new Date(this.now()).toISOString(), items: this.items }, null, 1)
    }

    /**
     * Adds the problems from an exported file that aren't already in the deck (ones that are keep
     * their own schedule). Returns the items added. Throws if the text isn't an export.
     */
    import(text) {
        const added = readExport(text).filter((item) => !this.find(item.key))
        this.items.push(...added)
        this.save()
        return added
    }
}

const EXPORT_APP = 'joseki-practice-reviews'


/** The valid items in an exported deck, skipping any that are damaged. Throws if it isn't an export at all. */
export function readExport(text) {
    let file
    try { file = JSON.parse(text) }
    catch { throw new Error('That file isn’t a Joseki Practice reviews export.') }
    if (file?.app !== EXPORT_APP || !Array.isArray(file.items)) { throw new Error('That file isn’t a Joseki Practice reviews export.') }
    const valid = (item) => item && KINDS.includes(item.kind)
        && Array.isArray(item.moves) && item.moves.every((move) => typeof move === 'string' && /^[a-t]{2}$/.test(move))
        && (item.color === 1 || item.color === 2)
        && item.data && typeof item.data === 'object'
        && Number.isFinite(item.due)
    return file.items.filter(valid).map((item) => ({
        key: reviewKey(item),
        kind: item.kind,
        moves: item.moves,
        color: item.color,
        data: item.data,
        added: Number.isFinite(item.added) ? item.added : item.due,
        lapses: Number.isInteger(item.lapses) && item.lapses >= 0 ? item.lapses : 1, // 0: added by the player
        step: Number.isInteger(item.step) ? Math.min(Math.max(item.step, 0), REVIEW_STEPS.length - 1) : 0,
        due: item.due,
    }))
}
