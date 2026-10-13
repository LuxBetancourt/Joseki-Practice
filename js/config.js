// URL template for fetching a Josekipedia node; `{id}` is replaced with the node id.
// Josekipedia doesn't allow cross-origin requests, so this must point at a proxy:
//   - locally, `npm run dev` serves one at /api/node/{id}
//   - in production, proxy/cloudflare-worker.js (see the comment at its top)
const PRODUCTION_NODE_URL = 'https://joseki-proxy.REPLACE-ME.workers.dev/api/node/{id}'

const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
export const NODE_URL = isLocal ? 'api/node/{id}' : PRODUCTION_NODE_URL

export const JOSEKIPEDIA_URL = 'https://www.josekipedia.com/'
