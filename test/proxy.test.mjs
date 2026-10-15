import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// The Worker, run against a fake Josekipedia, a fake edge cache and a fake D1 database

let origin // How many times Josekipedia was asked, by id; and what it answers
const answers = new Map()
let edge // The edge cache: url -> body
let rows // The database: id -> { body, fetched }

globalThis.caches = {
    default: {
        match: async (request) => (edge.has(request.url) ? new Response(edge.get(request.url)) : undefined),
        put: async (request, response) => { edge.set(request.url, await response.text()) },
    },
}
globalThis.fetch = async (url) => {
    const id = Number(new URL(url).searchParams.get('id'))
    origin.set(id, (origin.get(id) || 0) + 1)
    await new Promise((resolve) => setTimeout(resolve, 20)) // Slow enough for requests to overlap
    return answers.has(id) ? new Response(answers.get(id)) : new Response('nope', { status: 500 })
}

const db = {
    prepare: (sql) => ({
        bind: (...args) => ({
            first: async () => {
                const [id, after] = args
                const row = rows.get(id)
                return row && row.fetched > after ? row.body : null
            },
            run: async () => {
                assert.match(sql, /^INSERT OR REPLACE/)
                const [id, body, fetched] = args
                rows.set(id, { body, fetched })
            },
        }),
    }),
}

const { default: worker } = await import('../proxy/cloudflare-worker.js')

/** Calls the Worker the way Cloudflare would, and waits for its background work too. */
async function get(path, env = { DB: db }) {
    const waiting = []
    const response = await worker.fetch(new Request(`https://proxy.test${path}`), env, { waitUntil: (p) => waiting.push(p) })
    await Promise.all(waiting)
    return response
}

beforeEach(() => {
    origin = new Map()
    edge = new Map()
    rows = new Map()
    answers.clear()
    answers.set(7, JSON.stringify({ _id: 7, B: 'pd' }))
})

test('a node comes from Josekipedia once, then from the cache and the database', async () => {
    const first = await get('/api/node/7')
    assert.equal(first.headers.get('X-Joseki-Cache'), 'origin')
    assert.equal(JSON.parse(await first.text())._id, 7)
    assert.equal((await get('/api/node/7')).headers.get('X-Joseki-Cache'), 'edge')
    edge.clear() // Another Cloudflare location
    assert.equal((await get('/api/node/7')).headers.get('X-Joseki-Cache'), 'd1')
    assert.equal(origin.get(7), 1)
})

test('simultaneous requests for a new node share one fetch from Josekipedia', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => get('/api/node/7')))
    assert.equal(origin.get(7), 1)
    for (const response of responses) { assert.equal(JSON.parse(await response.text())._id, 7) }
})

test('errors are never stored, so the next request tries again', async () => {
    assert.equal((await get('/api/node/8')).status, 502)
    assert.equal(rows.has(8), false)
    assert.equal(edge.size, 0)
    answers.set(8, JSON.stringify({ _id: 8 }))
    assert.equal((await get('/api/node/8')).status, 200)
    assert.equal(origin.get(8), 2)
})

test('nodes older than a year are fetched again', async () => {
    const now = Math.floor(Date.now() / 1000)
    rows.set(7, { body: JSON.stringify({ _id: 7, old: true }), fetched: now - 366 * 24 * 60 * 60 })
    assert.equal((await get('/api/node/7')).headers.get('X-Joseki-Cache'), 'origin')
    rows.set(7, { body: JSON.stringify({ _id: 7 }), fetched: now - 300 * 24 * 60 * 60 })
    edge.clear()
    assert.equal((await get('/api/node/7')).headers.get('X-Joseki-Cache'), 'd1', 'kept for a year')
})

test('a database failure only means asking Josekipedia', async () => {
    const failing = () => Promise.reject(new Error('over the limit'))
    const down = { prepare: () => ({ bind: () => ({ first: failing, run: failing }) }) }
    const response = await get('/api/node/7', { DB: down })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('X-Joseki-Cache'), 'origin')
    assert.equal((await get('/api/node/7', {})).status, 200, 'no database at all still answers')
})

test('only numeric node ids are served', async () => {
    for (const path of ['/api/node/abc', '/api/node/', '/other', '/api/node/7/x']) {
        assert.equal((await get(path)).status, 404, path)
    }
    assert.equal(origin.size, 0)
})
