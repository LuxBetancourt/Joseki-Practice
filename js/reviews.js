// Spaced repetition for missed problems. The deck lives in localStorage; each item holds enough
// to rebuild its problem (kind, moves, color and kind-specific data) plus its schedule.

const STORAGE_KEY = 'reviews:v1'
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// How long until a problem comes back. A miss starts (or restarts) at the first step; each
// correct review moves it one step further, staying at the last.
export const REVIEW_STEPS = [5 * MINUTE, HOUR, DAY, 7 * DAY, 30 * DAY, 365 * DAY]

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

    /** Adds a missed problem, or resets the schedule of one already in the deck. */
    recordMiss(spec) {
        const key = reviewKey(spec)
        let item = this.find(key)
        if (!item) {
            item = { key, kind: spec.kind, moves: spec.moves, color: spec.color, data: spec.data, added: this.now(), lapses: 0 }
            this.items.push(item)
        }
        item.step = 0
        item.due = this.now() + REVIEW_STEPS[0]
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
     * Due items matching the player's current settings, most overdue first.
     * @param {{ kinds: string[], color: number, startMoves: string[] }} filter
     */
    due({ kinds, color, startMoves }) {
        const now = this.now()
        return this.items
            .filter((item) => item.due <= now && kinds.includes(item.kind) && item.color === color
                && startMoves.every((move, i) => item.moves[i] === move))
            .sort((a, b) => a.due - b.due)
    }
}
