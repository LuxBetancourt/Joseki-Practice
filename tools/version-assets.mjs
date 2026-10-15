// Gives each script, stylesheet and data file a version in its address when the site is deployed,
// e.g. js/app.js?v=3f9a2c71d0, taken from its contents. Neocities doesn't say how long browsers
// may keep files, so they guess, file by file; after a deploy a returning visitor could get a new
// app.js with an old module it imports, and the app would fail to start. With versions, a changed
// file has a new address and is always fetched fresh, while unchanged files stay cached.
//
// Only the uploaded copies are changed; the source files keep their plain addresses, so the site
// still runs as it is from the dev server. Used by deploy.mjs.

import { createHash } from 'node:crypto'

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10)

/**
 * The deployed contents of the site's HTML pages and modules, with versioned addresses.
 * `read(path)` returns a file's text (paths relative to the site root, e.g. 'js/app.js');
 * `files` lists the files being deployed. Returns a Map from path to new text, for the files that
 * changed; every other file is uploaded as it is.
 */
export function versionAssets(files, read) {
    const versions = new Map() // module path -> { text, version }
    const inProgress = new Set()

    const fileVersion = (path) => hash(read(path))

    /** A module's deployed text (its imports versioned) and its version, which covers what it imports. */
    function module(path) {
        if (versions.has(path)) { return versions.get(path) }
        if (inProgress.has(path)) { throw new Error(`Import cycle through ${path}`) }
        inProgress.add(path)
        const dir = path.slice(0, path.lastIndexOf('/') + 1)
        const text = read(path)
            // import … from './other.js'
            .replace(/(from\s+')\.\/([\w-]+\.js)(')/g, (_, before, file, after) =>
                `${before}./${file}?v=${module(dir + file).version}${after}`)
            // Data files the module loads, e.g. '../resources/root-node.json'
            .replace(/'\.\.\/(resources\/[\w.-]+\.json)'/g, (_, file) => `'../${file}?v=${fileVersion(file)}'`)
        inProgress.delete(path)
        const result = { text, version: hash(text) }
        versions.set(path, result)
        return result
    }

    const changed = new Map()
    for (const path of files.filter((f) => /^js\/[\w-]+\.js$/.test(f))) {
        const { text } = module(path)
        if (text !== read(path)) { changed.set(path, text) }
    }
    for (const page of files.filter((f) => f.endsWith('.html'))) {
        const text = read(page).replace(/((?:src|href)=")(js\/[\w-]+\.js|[\w-]+\.css|resources\/[\w.-]+\.json)(")/g,
            (_, before, path, after) => `${before}${path}?v=${path.endsWith('.js') ? module(path).version : fileVersion(path)}${after}`)
        if (text !== read(page)) { changed.set(page, text) }
    }
    return changed
}
