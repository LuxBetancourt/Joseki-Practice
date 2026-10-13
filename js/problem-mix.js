// Keeps the mix of problem types even: a type that hasn't come up for a while gets a little more
// likely each problem, so no type goes missing for long, while the order stays unpredictable.

export const RECENT_KINDS_KEPT = 30
const GROWTH = 0.25 // Extra weight per problem since a type last came up
const MAX_GAP = 12 // Weight stops growing after this many problems (a type that has never come up counts as this)

/** How strongly to prefer `kind`, given the types of recent problems (oldest first). */
export function kindWeight(kind, recent) {
    const last = recent.lastIndexOf(kind)
    const gap = last === -1 ? MAX_GAP : Math.min(MAX_GAP, recent.length - 1 - last)
    return 1 + GROWTH * gap
}

/**
 * The enabled types in the order to try them: drawn one at a time by weight, so the first is
 * usually one that hasn't come up lately, and the rest are fallbacks if it can't find a problem.
 */
export function orderKinds(kinds, recent, random = Math.random) {
    const left = [...kinds]
    const order = []
    while (left.length) {
        const weights = left.map((kind) => kindWeight(kind, recent))
        let roll = random() * weights.reduce((sum, weight) => sum + weight, 0)
        let index = weights.findIndex((weight) => (roll -= weight) < 0)
        if (index === -1) { index = left.length - 1 } // Rounding
        order.push(...left.splice(index, 1))
    }
    return order
}

/** `recent` with `kind` added, keeping the last RECENT_KINDS_KEPT. */
export function addRecentKind(recent, kind) {
    return [...recent, kind].slice(-RECENT_KINDS_KEPT)
}

// Problems seen lately, so a new problem can skip them: some positions are much easier for the
// random walks to reach than others, and would otherwise keep coming back

export const SEEN_KEPT = 300

/** Identifies a problem by its type and position (Pick the Path's shuffled sequences don't matter). */
export const seenKey = (kind, moves) => `${kind}:${moves.join('')}`

/** `seen` with `key` added (moved to the end if it was already there), keeping the last SEEN_KEPT. */
export function addSeen(seen, key) {
    return [...seen.filter((k) => k !== key), key].slice(-SEEN_KEPT)
}
