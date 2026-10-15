import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Each page preloads every module it imports (see the <link rel="modulepreload"> tags), so the
// browser fetches them at once. This keeps those lists in step with the imports.

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

/** Every module reachable from `entry` (a file in js/), not counting the entry itself. */
function imports(entry) {
    const seen = new Set()
    const visit = (file) => {
        for (const [, dep] of read(`js/${file}`).matchAll(/from '\.\/([\w-]+\.js)'/g)) {
            if (!seen.has(dep)) {
                seen.add(dep)
                visit(dep)
            }
        }
    }
    visit(entry)
    seen.delete(entry)
    return [...seen].sort()
}

const preloaded = (page) => [...read(page).matchAll(/<link rel="modulepreload" href="js\/([\w-]+\.js)">/g)].map((m) => m[1]).sort()

for (const [page, entry] of [['index.html', 'app.js'], ['reviews.html', 'reviews-page.js']]) {
    test(`${page} preloads exactly the modules ${entry} imports`, () => {
        assert.deepEqual(preloaded(page), imports(entry))
    })
}

test('index.html preloads the empty board it starts from', () => {
    assert.match(read('index.html'), /<link rel="preload" href="resources\/root-node.json" as="fetch" crossorigin>/)
})
