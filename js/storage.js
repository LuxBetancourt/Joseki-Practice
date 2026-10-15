// JSON in the browser's localStorage, which may be unavailable (some private modes) or hold
// anything (an older version of the site, another tab): reads fall back to a default, and writes
// are best-effort. `storage` can be swapped out, for tests.

/** The value stored under `key`, if there is one that `valid` accepts; otherwise `fallback`. */
export function readJson(key, fallback, { storage = globalThis.localStorage, valid = () => true } = {}) {
    try {
        const value = JSON.parse(storage.getItem(key))
        return value !== null && valid(value) ? value : fallback
    }
    catch {
        return fallback
    }
}

/** Stores `value` under `key`; returns false if it couldn't be stored (and the page carries on). */
export function writeJson(key, value, { storage = globalThis.localStorage } = {}) {
    try {
        storage.setItem(key, JSON.stringify(value))
        return true
    }
    catch {
        return false
    }
}

/** True for a plain object (not an array, not null). */
export const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
