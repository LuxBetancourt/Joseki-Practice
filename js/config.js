// URL template for fetching a Josekipedia node; `{id}` is replaced with the node id.
// Josekipedia doesn't allow cross-origin requests, so this must point at a proxy:
//   - `npm run dev` serves one at /api/node/{id}
//   - proxy/cloudflare-worker.js can be deployed for production; put its URL here
export const NODE_URL = 'api/node/{id}'

export const JOSEKIPEDIA_URL = 'https://www.josekipedia.com/'
