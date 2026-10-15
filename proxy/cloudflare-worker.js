// Cloudflare Worker that proxies Josekipedia node lookups with CORS headers and caching.
// Josekipedia doesn't allow cross-origin requests, so the site needs this (or similar) in production.
//
// Deploy:  cd proxy && npx wrangler deploy   (settings are in wrangler.toml)
// Then set PRODUCTION_NODE_URL in js/config.js to  https://joseki-proxy.<your-subdomain>.workers.dev/api/node/{id}
// The database's table is made by schema.sql:  npx wrangler d1 execute joseki-nodes --remote --file schema.sql
//
// Only /api/node/{numeric id} is forwarded, so this can't be used as an open proxy.
//
// To put as little load on Josekipedia as possible, each node is looked up in three places:
//   1. this data center's cache (fast, but each Cloudflare location has its own)
//   2. a D1 database shared by every location (env.DB), so a node is fetched from Josekipedia
//      once for everyone, then kept for STORE_SECONDS (the free plan allows 100,000 new nodes a
//      day, and the whole of Josekipedia fits comfortably)
//   3. Josekipedia itself, only if neither has it; simultaneous requests for the same node share
//      one fetch
// The X-Joseki-Cache response header says which one answered (edge, d1 or origin).
//
// Every step can fail without failing the request: if the database is unavailable or over a
// limit, nodes still come from the cache or from Josekipedia.

const EDGE_SECONDS = 60 * 60 * 24 * 30
const STORE_SECONDS = 60 * 60 * 24 * 365 // Joseki data rarely changes

// Fetches from Josekipedia in progress, by node id, so simultaneous requests share one (within
// this instance of the Worker, which is where requests arriving together usually land)
const pending = new Map()

export default {
    async fetch(request, env, ctx) {
        const cors = {
            'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Expose-Headers': 'X-Joseki-Cache',
        }
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: cors })
        }

        const match = /^\/api\/node\/(\d{1,9})$/.exec(new URL(request.url).pathname)
        if (request.method !== 'GET' || !match) {
            return new Response('Not found', { status: 404, headers: cors })
        }
        const id = Number(match[1])

        const respond = (body, source) => new Response(body, {
            headers: {
                ...cors,
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': `public, max-age=${EDGE_SECONDS}`,
                'X-Joseki-Cache': source,
            },
        })
        const cacheKey = new Request(`https://josekipedia-cache/node/${id}`)
        const cache = caches.default
        const now = Math.floor(Date.now() / 1000)

        // 1. This data center's cache
        const cached = await cache.match(cacheKey).catch(() => null)
        if (cached) { return respond(await cached.text(), 'edge') }

        // 2. The shared database (anything older than STORE_SECONDS is fetched again)
        const stored = await env.DB?.prepare('SELECT body FROM nodes WHERE id = ? AND fetched > ?')
            .bind(id, now - STORE_SECONDS).first('body').catch(() => null)
        if (stored) {
            ctx.waitUntil(cache.put(cacheKey, respond(stored, 'edge')).catch(() => {}))
            return respond(stored, 'd1')
        }

        // 3. Josekipedia
        if (!pending.has(id)) {
            const fetching = fetchNode(id).then((body) => {
                if (body) {
                    ctx.waitUntil(Promise.all([
                        cache.put(cacheKey, respond(body, 'edge')).catch(() => {}),
                        env.DB?.prepare('INSERT OR REPLACE INTO nodes (id, body, fetched) VALUES (?, ?, ?)')
                            .bind(id, body, now).run().catch(() => {}),
                    ]))
                }
                return body
            }).finally(() => pending.delete(id))
            pending.set(id, fetching)
            ctx.waitUntil(fetching) // Finishes even if this request is cancelled, for the others waiting on it
        }
        const body = await pending.get(id)
        if (!body) {
            return new Response('Upstream error', { status: 502, headers: cors }) // Never cache errors
        }
        return respond(body, 'origin')
    },
}

/** A node's JSON from Josekipedia, or null if it didn't send one. */
async function fetchNode(id) {
    try {
        const upstream = await fetch(`https://www.josekipedia.com/db/node.php?id=${id}&pid=0`)
        const body = upstream.ok ? await upstream.text() : null
        return body && isNode(body) ? body : null
    }
    catch {
        return null
    }
}

function isNode(body) {
    try { return JSON.parse(body)._id !== undefined }
    catch { return false }
}
