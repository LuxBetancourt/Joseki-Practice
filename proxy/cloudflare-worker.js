// Cloudflare Worker that proxies Josekipedia node lookups with CORS headers and caching.
// Josekipedia doesn't allow cross-origin requests, so the site needs this (or similar) in production.
//
// Deploy:  cd proxy && npx wrangler deploy   (settings are in wrangler.toml)
// Then set PRODUCTION_NODE_URL in js/config.js to  https://joseki-proxy.<your-subdomain>.workers.dev/api/node/{id}
//
// Only /api/node/{numeric id} is forwarded, so this can't be used as an open proxy.
//
// To put as little load on Josekipedia as possible, each node is looked up in three places:
//   1. this data center's cache (fast, but each Cloudflare location has its own)
//   2. a KV store shared by every location (env.NODES), so a node is fetched from Josekipedia
//      once for everyone, then kept for KV_SECONDS
//   3. Josekipedia itself, only if neither has it
// The X-Joseki-Cache response header says which one answered (edge, kv or origin).

const EDGE_SECONDS = 60 * 60 * 24 * 30
const KV_SECONDS = 60 * 60 * 24 * 180

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
        const id = match[1]

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

        // 1. This data center's cache
        const cached = await cache.match(cacheKey)
        if (cached) { return respond(await cached.text(), 'edge') }

        // 2. The shared store
        const stored = env.NODES && await env.NODES.get(id)
        if (stored) {
            ctx.waitUntil(cache.put(cacheKey, respond(stored, 'edge')))
            return respond(stored, 'kv')
        }

        // 3. Josekipedia
        const upstream = await fetch(`https://www.josekipedia.com/db/node.php?id=${id}&pid=0`)
        const body = upstream.ok ? await upstream.text() : null
        if (!body || !isNode(body)) {
            return new Response('Upstream error', { status: 502, headers: cors }) // Never cache errors
        }
        ctx.waitUntil(Promise.all([
            cache.put(cacheKey, respond(body, 'edge')),
            // The free plan allows 1,000 writes a day; past that this fails and the node is simply refetched later
            env.NODES?.put(id, body, { expirationTtl: KV_SECONDS }).catch(() => {}),
        ]))
        return respond(body, 'origin')
    },
}

function isNode(body) {
    try { return JSON.parse(body)._id !== undefined }
    catch { return false }
}
