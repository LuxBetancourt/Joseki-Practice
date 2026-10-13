// Cloudflare Worker that proxies Josekipedia node lookups with CORS headers and edge caching.
// Josekipedia doesn't allow cross-origin requests, so the site needs this (or similar) in production.
//
// Deploy:  cd proxy && npx wrangler deploy   (settings are in wrangler.toml)
// Then set PRODUCTION_NODE_URL in js/config.js to  https://joseki-proxy.<your-subdomain>.workers.dev/api/node/{id}
//
// Only /api/node/{numeric id} is forwarded, so this can't be used as an open proxy.

const CACHE_SECONDS = 60 * 60 * 24

export default {
    async fetch(request, env, ctx) {
        const cors = {
            'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
        }
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: cors })
        }

        const match = /^\/api\/node\/(\d{1,9})$/.exec(new URL(request.url).pathname)
        if (request.method !== 'GET' || !match) {
            return new Response('Not found', { status: 404, headers: cors })
        }

        const cache = caches.default
        const cacheKey = new Request(`https://josekipedia-cache/node/${match[1]}`)
        let response = await cache.match(cacheKey)
        if (!response) {
            const upstream = await fetch(`https://www.josekipedia.com/db/node.php?id=${match[1]}&pid=0`)
            if (!upstream.ok) {
                return new Response('Upstream error', { status: 502, headers: cors })
            }
            response = new Response(await upstream.text(), {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
                },
            })
            ctx.waitUntil(cache.put(cacheKey, response.clone()))
        }

        const result = new Response(response.body, response)
        for (const [key, value] of Object.entries(cors)) { result.headers.set(key, value) }
        return result
    },
}
