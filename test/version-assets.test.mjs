import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { versionAssets } from '../tools/version-assets.mjs'

/** A tiny site, as path -> text. */
const site = () => ({
    'index.html': '<link rel="stylesheet" href="index.css"><script type="module" src="js/app.js"></script>'
        + '<link rel="modulepreload" href="js/data.js"><link rel="preload" href="resources/root.json" as="fetch">'
        + '<a href="about.html">About</a>',
    'index.css': 'body { color: red }',
    'js/app.js': "import { load } from './data.js'\nimport { add } from './math.js'\n",
    'js/data.js': "import { add } from './math.js'\nconst ROOT = new URL('../resources/root.json', import.meta.url)\n",
    'js/math.js': 'export const add = (a, b) => a + b\n',
    'resources/root.json': '{"_id":1}',
})
const run = (files) => versionAssets(Object.keys(files), (path) => files[path])
const version = (text, path) => new RegExp(`${path.replace('.', '\\.')}\\?v=([0-9a-f]{10})`).exec(text)?.[1]

test('pages and imports get versions in their addresses', () => {
    const out = run(site())
    const page = out.get('index.html')
    for (const path of ['index.css', 'js/app.js', 'js/data.js', 'resources/root.json']) {
        assert.ok(version(page, path), path)
    }
    assert.match(page, /href="about\.html"/, 'links between pages are left alone')
    assert.ok(version(out.get('js/app.js'), './data.js'))
    assert.ok(version(out.get('js/data.js'), 'resources/root.json'))
    assert.equal(out.has('js/math.js'), false, 'a module importing nothing is unchanged')
    assert.equal(version(page, 'js/data.js'), version(out.get('js/app.js'), './data.js'), 'the preload matches the import')
    assert.equal(version(page, 'resources/root.json'), version(out.get('js/data.js'), 'resources/root.json'), 'the preload matches the fetch')
})

test('changing a module changes its version and that of everything importing it, and nothing else', () => {
    const before = run(site())
    const changed = site()
    changed['js/math.js'] = 'export const add = (a, b) => b + a\n'
    const after = run(changed)
    assert.notEqual(version(after.get('js/data.js'), './math.js'), version(before.get('js/data.js'), './math.js'))
    assert.notEqual(version(after.get('index.html'), 'js/data.js'), version(before.get('index.html'), 'js/data.js'), 'data.js imports math.js')
    assert.notEqual(version(after.get('index.html'), 'js/app.js'), version(before.get('index.html'), 'js/app.js'))
    assert.equal(version(after.get('index.html'), 'index.css'), version(before.get('index.html'), 'index.css'))
    assert.equal(version(after.get('index.html'), 'resources/root.json'), version(before.get('index.html'), 'resources/root.json'))
})

test('the same files always get the same versions', () => {
    assert.deepEqual(run(site()), run(site()))
})

test('an import cycle is reported rather than looping', () => {
    const files = site()
    files['js/math.js'] = "import { load } from './data.js'\n"
    assert.throws(() => run(files), /cycle/)
})

test('the real site versions every module and page reference', () => {
    const root = new URL('../', import.meta.url)
    const read = (path) => readFileSync(new URL(path, root), 'utf8')
    const modules = ['app', 'go', 'josekipedia', 'config', 'problems', 'starting-points', 'lines', 'ladder', 'reviews',
        'problem-mix', 'shape-view', 'text', 'sources', 'board-view', 'reviews-page'].map((m) => `js/${m}.js`)
    const out = versionAssets(['index.html', 'reviews.html', 'about.html', ...modules], read)
    for (const [path, text] of out) {
        assert.doesNotMatch(text, /from '\.\/[\w-]+\.js'/, `${path}: an import without a version`)
        assert.doesNotMatch(text, /(?:src|href)="(?:js\/[\w-]+\.js|[\w-]+\.css)"/, `${path}: a reference without a version`)
    }
    assert.match(out.get('js/josekipedia.js'), /root-node\.json\?v=/)
})
