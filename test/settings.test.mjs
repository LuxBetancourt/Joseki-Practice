import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, SETTINGS_VERSION } from '../js/settings.js'
import { readJson, writeJson } from '../js/storage.js'

/** In-memory localStorage, optionally holding some values (stored as given). */
function fakeStorage(values = {}) {
    const store = new Map(Object.entries(values))
    return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), store }
}
const saved = (settings) => fakeStorage({ settings: JSON.stringify(settings) })

test('with nothing saved, the defaults', () => {
    const { settings, changed } = loadSettings({ storage: fakeStorage() })
    assert.deepEqual(settings, DEFAULT_SETTINGS)
    assert.equal(changed, false)
})

test('unreadable or broken storage gives the defaults rather than failing', () => {
    for (const storage of [fakeStorage({ settings: '{not json' }), fakeStorage({ settings: '[1,2]' }),
        { getItem: () => { throw new Error('denied') } }]) {
        assert.deepEqual(loadSettings({ storage }).settings, DEFAULT_SETTINGS)
    }
})

test('saved settings win over the defaults, and new settings take their defaults', () => {
    const { settings } = loadSettings({ storage: saved({ version: SETTINGS_VERSION, player: 'white', autoAdvance: true }) })
    assert.equal(settings.player, 'white')
    assert.equal(settings.autoAdvance, true)
    assert.equal(settings.firstTen, DEFAULT_SETTINGS.firstTen)
})

test('a problem type added since reaches players who saved settings before it, on', () => {
    const { settings } = loadSettings({ storage: saved({ version: SETTINGS_VERSION, problemTypes: { next: false, punish: true } }) })
    assert.equal(settings.problemTypes.next, false, 'their own choices stay')
    assert.equal(settings.problemTypes.sente, true)
})

test('version 2: Play both sides is switched on once for settings saved before it', () => {
    const before = loadSettings({ storage: saved({ shapeBothSides: false }) }) // Version 1 didn't save a version
    assert.equal(before.settings.shapeBothSides, true)
    assert.equal(before.settings.version, SETTINGS_VERSION)
    assert.equal(before.changed, true, 'so the app saves it straight away')
    const after = loadSettings({ storage: saved({ version: 2, shapeBothSides: false }) })
    assert.equal(after.settings.shapeBothSides, false, 'turning it off afterwards sticks')
})

test('version 3: Random becomes the Player, unless White was chosen', () => {
    assert.equal(loadSettings({ storage: saved({ version: 2, player: 'black' }) }).settings.player, 'random')
    assert.equal(loadSettings({ storage: saved({ version: 2, player: 'white' }) }).settings.player, 'white')
    const after = loadSettings({ storage: saved({ version: 3, player: 'black' }) })
    assert.equal(after.settings.player, 'black', 'choosing Black afterwards sticks')
    assert.equal(after.changed, false)
    assert.equal(loadSettings({ storage: fakeStorage() }).settings.player, 'random', 'new players start on Random')
})

test('old mode names become the current ones', () => {
    for (const [old, now] of [['next', 'problems'], ['punish', 'problems'], ['shape', 'problems'], ['practice', 'explore'], ['review', 'review']]) {
        assert.equal(loadSettings({ storage: saved({ version: 2, mode: old }) }).settings.mode, now, old)
    }
})

test('settings saved one per key by the first version of the site are carried over', () => {
    const storage = fakeStorage({ ideal: 'false', good: 'true', noPass: 'true', player: 'white', unrelated: 'x' })
    const { settings, changed } = loadSettings({ storage })
    assert.equal(settings.ideal, false)
    assert.equal(settings.good, true)
    assert.equal(settings.onlyPassIfJoseki, true)
    assert.equal(settings.player, 'white')
    assert.equal(changed, true)
})

test('saving round-trips, and a storage failure doesn\'t throw', () => {
    const storage = fakeStorage()
    const { settings } = loadSettings({ storage })
    settings.player = 'white'
    saveSettings(settings, { storage })
    assert.equal(loadSettings({ storage }).settings.player, 'white')
    assert.doesNotThrow(() => saveSettings(settings, { storage: { setItem: () => { throw new Error('full') } } }))
})

test('readJson and writeJson', () => {
    const storage = fakeStorage({ list: '["a","b"]', object: '{"a":1}' })
    assert.deepEqual(readJson('list', [], { storage, valid: Array.isArray }), ['a', 'b'])
    assert.deepEqual(readJson('object', [], { storage, valid: Array.isArray }), [], 'rejected by valid')
    assert.deepEqual(readJson('missing', 'fallback', { storage }), 'fallback')
    assert.equal(writeJson('x', { a: 1 }, { storage }), true)
    assert.equal(storage.store.get('x'), '{"a":1}')
    assert.equal(writeJson('x', 1, { storage: { setItem: () => { throw new Error('full') } } }), false)
})
