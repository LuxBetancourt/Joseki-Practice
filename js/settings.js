// The player's settings: their defaults, and how settings saved by earlier versions of the site
// are brought up to date.
//
// A new setting needs nothing more than its default here: settings saved before it simply take
// the default. But when a default *changes* and the change should reach players who already have
// saved settings (which hold every setting, the defaults included), bump SETTINGS_VERSION and add
// an upgrade to UPGRADES saying what to change.

import { byKind } from './problem-kinds.js'
import { readJson, writeJson, isObject } from './storage.js'

const KEY = 'settings'
export const SETTINGS_VERSION = 2

export const DEFAULT_SETTINGS = {
    version: SETTINGS_VERSION,
    mode: 'problems', // 'explore' | 'problems' | 'review'
    problemTypes: byKind(() => true),
    player: 'black',
    ideal: true, good: false, bad: false, trick: false, question: false,
    firstTen: true,
    onlyPassIfJoseki: false,
    showMoves: false,
    showMoveInfo: true,
    showFollowUps: false,
    autoAdvance: false, // Go to the next problem automatically after solving one
    shapeBothSides: true, // In Final Shape, the player plays the other side's moves too
    replaySetup: false, // Play each problem's moves out from an empty board before it starts
    expanded: [], // Starting-point branches the player has expanded
    start: 'empty',
}

// What changes on reaching each version, for settings saved before it
const UPGRADES = {
    2: (saved) => { saved.shapeBothSides = true }, // Final Shape's Play both sides became on by default
}

// Settings saved one per key by the first version of the site (before 'settings' existed)
const LEGACY_KEYS = {
    ideal: 'ideal', good: 'good', bad: 'bad', trick: 'trick', question: 'question',
    firstTen: 'firstTen', noPass: 'onlyPassIfJoseki', showMoveInfo: 'showMoveInfo',
}

/**
 * The saved settings, brought up to date and filled in with defaults (or the defaults, if there
 * are none). Returns { settings, changed }: changed says the stored copy is out of date and
 * should be saved again.
 */
export function loadSettings({ storage = globalThis.localStorage } = {}) {
    const saved = readJson(KEY, null, { storage, valid: isObject })
    if (saved) {
        // Next Move, Punish and Final Shape used to be separate modes, and Explore was Practice
        if (['next', 'punish', 'shape'].includes(saved.mode)) { saved.mode = 'problems' }
        if (saved.mode === 'practice') { saved.mode = 'explore' }
        const from = Number.isInteger(saved.version) ? saved.version : 1 // Version 1 didn't say
        for (let version = from + 1; version <= SETTINGS_VERSION; ++version) { UPGRADES[version]?.(saved) }
        saved.version = SETTINGS_VERSION
        const defaults = structuredClone(DEFAULT_SETTINGS) // A copy, so changing settings never changes the defaults
        const problemTypes = { ...defaults.problemTypes, ...(isObject(saved.problemTypes) ? saved.problemTypes : {}) }
        return { settings: { ...defaults, ...saved, problemTypes }, changed: from !== SETTINGS_VERSION }
    }

    const legacy = {}
    try {
        for (const [oldKey, key] of Object.entries(LEGACY_KEYS)) {
            const value = storage.getItem(oldKey)
            if (value !== null) { legacy[key] = value === 'true' }
        }
        if (['black', 'white'].includes(storage.getItem('player'))) { legacy.player = storage.getItem('player') }
    }
    catch { /* Storage unavailable: the defaults it is */ }
    return { settings: { ...structuredClone(DEFAULT_SETTINGS), ...legacy }, changed: Object.keys(legacy).length > 0 }
}

export function saveSettings(settings, { storage = globalThis.localStorage } = {}) {
    writeJson(KEY, settings, { storage })
}
