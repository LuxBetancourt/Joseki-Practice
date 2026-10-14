// Fetching, caching and normalizing Josekipedia nodes.

import { NODE_URL } from './config.js'
import { BLACK, WHITE, PASS } from './go.js'

export const ROOT_ID = 1

export const MoveType = { IDEAL: 0, GOOD: 1, BAD: 2, TRICK: 3, QUESTION: 4 }
export const MOVE_TYPE_NAMES = ['ideal', 'good', 'bad', 'trick', 'question']

// Josekipedia's label ids. "%" stands for the move itself.
export const LABELS = {
    1: 'Good for White.', 2: 'Good for Black.', 3: 'White has good influence.', 4: 'Black has good influence.',
    5: 'This requires a favorable ladder.', 6: '% requires a favorable ladder.', 7: 'Leads to a ko.', 8: '% leads to a ko.',
    9: 'White can tenuki.', 10: 'Black can tenuki.', 11: 'White takes the corner.', 12: 'Black takes the corner.',
    13: 'Solid move.', 14: 'Old pattern.', 15: 'Necessary.', 16: 'Sacrifice play.', 17: 'White is thick.', 18: 'Black is thick.',
    19: 'Tesuji.', 20: 'White collapses.', 21: 'Black collapses.', 22: 'Modern pattern.', 23: 'Position is settled.',
    24: 'White has good profit.', 25: 'Black has good profit.', 26: 'Vital point.', 27: 'Simple position.',
    28: 'Complicated position.', 29: 'Fighting pattern.', 30: 'Running battle.', 31: 'Probing move.', 32: 'Honte.',
    33: 'Leads to complicated variations.', 34: '% leads to complicated variations.', 35: 'Kills.', 36: 'Reducing move.',
    37: '% kills.', 38: '% reduces.', 39: 'Takes sente.', 40: 'Overplay.', 41: '% is an overplay.', 42: 'Leaves weaknesses.',
    43: 'Makes life.', 44: 'Refutes the trick play.', 45: 'Position is even.', 46: 'Slightly good for Black.',
    47: 'Slightly good for White.', 48: 'White connects.', 49: 'Black connects.', 50: 'Ko.', 51: 'Black is sealed in.',
    52: 'White is sealed in.', 53: 'Slack.', 54: 'Black has bad shape.', 55: 'White has bad shape.',
}
export const TENUKI_LABEL = { [WHITE]: 9, [BLACK]: 10 }

export function labelText(id) {
    return (LABELS[id] || '').replace('%', 'This move')
}

/** Converts a raw Josekipedia node (or child summary) into the shape the app uses. */
function normalize(raw) {
    const color = raw.B !== undefined ? BLACK : raw.W !== undefined ? WHITE : null
    const node = {
        id: raw._id,
        move: color ? (raw.B ?? raw.W) || PASS : null,
        color,
        type: typeof raw._mtype === 'number' ? raw._mtype : null,
        labels: Array.isArray(raw._labels) ? raw._labels : [],
        comment: raw.C || '',
        sources: Array.isArray(raw._sources) ? raw._sources : [], // See sources.js
    }
    if (Array.isArray(raw._children)) {
        node.children = raw._children.map(normalize)
    }
    return node
}

/** A fully loaded node always has `children`; Josekipedia omits `_children` at the end of a line. */
function normalizeFull(raw) {
    const node = normalize(raw)
    node.children ??= []
    return node
}

// --- Caching -----------------------------------------------------------------
// To put as little load on Josekipedia as possible, every node is kept: in memory for the visit,
// and in IndexedDB (far roomier than localStorage) for STORAGE_TTL. The proxy caches them too.

const STORAGE_TTL = 180 * 24 * 60 * 60 * 1000 // Joseki data rarely changes
const LEGACY_PREFIX = 'jp-node:v1:' // The old localStorage cache, cleared out on first use
const memory = new Map() // id -> Promise<node>
let database = null

/** The IndexedDB database, or a rejected promise where it's unavailable (e.g. some private modes). */
function openDatabase() {
    database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open('joseki-practice', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('nodes')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    database.then(clearLegacyCache, () => {})
    return database
}

function clearLegacyCache() {
    try {
        Object.keys(localStorage).filter((key) => key.startsWith(LEGACY_PREFIX)).forEach((key) => localStorage.removeItem(key))
    }
    catch { /* storage unavailable */ }
}

/** Runs one request against the nodes store; resolves with its result. */
async function inStore(mode, use) {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
        const request = use(db.transaction('nodes', mode).objectStore('nodes'))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

async function readStorage(id) {
    try {
        const stored = await inStore('readonly', (store) => store.get(id))
        if (stored && Date.now() - stored.t < STORAGE_TTL) { return stored.raw }
    }
    catch { /* storage unavailable */ }
    return null
}

function writeStorage(id, raw) {
    inStore('readwrite', (store) => store.put({ t: Date.now(), raw }, id))
        .catch(() => { /* storage unavailable or full: the memory cache still works */ })
}

async function download(id) {
    const response = await fetch(NODE_URL.replace('{id}', encodeURIComponent(id)), {
        signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) { throw new Error(`Josekipedia request failed (${response.status})`) }
    const raw = await response.json()
    if (!raw || raw._id === undefined) { throw new Error('Unexpected response from Josekipedia') }
    return raw
}

/** Returns a promise for the full node (including children). Failed requests aren't cached. */
export function getNode(id) {
    if (!memory.has(id)) {
        const promise = readStorage(id).then(async (stored) => {
            if (stored) { return normalizeFull(stored) }
            const raw = await download(id)
            writeStorage(id, raw)
            return normalizeFull(raw)
        })
        promise.catch(() => memory.delete(id))
        memory.set(id, promise)
    }
    return memory.get(id)
}

/** Warms the cache for several nodes in parallel, ignoring failures. */
export function prefetch(ids) {
    ids.forEach((id) => getNode(id).catch(() => {}))
}
