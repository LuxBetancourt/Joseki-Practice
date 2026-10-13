// Spaced repetition for missed problems. The deck lives in localStorage; each item holds enough
// to rebuild its problem (kind, moves, color and kind-specific data) plus its schedule.

const STORAGE_KEY = 'reviews:v1'
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// How long until a problem comes back. A newly missed problem is due straight away; each correct
// review moves it one step further, staying at the last. Failing a review restarts it at the
// first step, but only RELEARN_DELAY later rather than immediately.
export const REVIEW_STEPS = [0, HOUR, DAY, 7 * DAY, 30 * DAY, 365 * DAY]
export const RELEARN_DELAY = 5 * MINUTE

/** Identifies the same problem across sessions: the kind and position (and target, for shapes). */
export const reviewKey = ({ kind, moves, data }) => [kind, moves.join(''), data?.answer || ''].join(':')

export class ReviewDeck {
    constructor({ storage = globalThis.localStorage, now = () => Date.now() } = {}) {
        this.storage = storage
        this.now = now
        this.items = []
        try { this.items = JSON.parse(storage?.getItem(STORAGE_KEY)) || [] }
        catch { /* storage unavailable or corrupt: start empty */ }
    }

    save() {
        try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.items)) }
        catch { /* storage unavailable: the deck still works for this session */ }
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
}
