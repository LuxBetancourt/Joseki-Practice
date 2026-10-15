# Joseki Practice

Practice go joseki with endless problems built from [Josekipedia](https://www.josekipedia.com)'s
data: find the next move, punish mistakes, play out final shapes, pick the joseki path, judge
who's better, decide when you can tenuki, and play for sente. Missed problems come back for review.

Live at <https://josekipractice.neocities.org/>.

A static site with no build step and no dependencies: plain HTML, CSS and ES modules.

## Development

```bash
npm run dev      # serves the site at http://localhost:8080 and proxies Josekipedia
npm test         # node:test, no browser needed
```

The dev server keeps every Josekipedia node it fetches in `.node-cache/` (ignored by git), so
working on the site never asks Josekipedia for the same node twice. Delete the folder to refetch.

## Layout

| File | What it does |
| --- | --- |
| `js/app.js` | The page: game flow, problems and grading, rendering, settings UI, links |
| `js/problems.js` | Problem generators (random walks through Josekipedia's tree), links, rebuilding saved problems, ladders a problem relies on |
| `js/problem-kinds.js` | The problem types: names, goals, link letters, how each is answered |
| `js/lines.js` | Following a joseki's main line to its final shape |
| `js/ladder.js` | Reading ladders, to place the stone that decides one |
| `js/josekipedia.js` | Fetching and normalizing nodes; caching them in memory and IndexedDB |
| `js/go.js` | Board rules (captures, suicide, ko) |
| `js/board-view.js`, `js/shape-view.js` | The SVG board, and the small boards on cards |
| `js/reviews.js`, `js/reviews-page.js` | The review deck (spaced repetition), and the Saved Reviews page |
| `js/settings.js`, `js/storage.js` | Settings (defaults, upgrades of older saves), and localStorage helpers |
| `js/problem-mix.js` | Keeping the mix of problem types even, and not repeating recent problems |
| `js/text.js`, `js/sources.js` | Josekipedia comments (links, coordinates, encoding fixes), and the books they cite |
| `js/starting-points.js`, `js/config.js` | The sidebar's joseki and fuseki; the proxy's address |
| `resources/root-node.json` | The empty board's node, shipped with the site so it's never fetched |
| `proxy/` | The Cloudflare Worker that proxies and caches Josekipedia (see below) |
| `tools/` | `make-preview.mjs` (the link preview image), `update-root-node.mjs`, `version-assets.mjs` (used by deploy) |

## How Josekipedia data is fetched

Josekipedia doesn't allow cross-origin requests, so the site asks a proxy for `/api/node/{id}`.
Josekipedia is a small volunteer site, so every layer caches, and a node is fetched from it at
most once a year for everyone:

1. the browser: memory, then IndexedDB (a year), then its HTTP cache (30 days)
2. the Worker: Cloudflare's cache in that location (30 days), then a D1 database shared by all
   locations (a year), then Josekipedia, with simultaneous requests for a node sharing one fetch

## Deployment

The site is on Neocities (static hosting only); the proxy is a Cloudflare Worker.

```bash
npm run deploy:proxy   # the Worker (needs CLOUDFLARE_API_TOKEN, or npx wrangler login)
npm run deploy         # the site (needs NEOCITIES_API_KEY); node deploy.mjs --dry-run lists the files
```

Setting up the proxy from scratch: in `proxy/`, `npx wrangler d1 create joseki-nodes`, put the
database id into `wrangler.toml`, `npx wrangler d1 execute joseki-nodes --remote --file schema.sql`,
then `npx wrangler deploy`, and put the printed `*.workers.dev` address into `PRODUCTION_NODE_URL`
in `js/config.js`.

Deploying gives scripts, stylesheets and data a version in their address taken from their contents
(`js/app.js?v=…`, see `tools/version-assets.mjs`), as Neocities doesn't tell browsers how long to
keep files; the source files keep plain addresses.

Other commands: `npm run root-node` refreshes `resources/root-node.json` from Josekipedia (new
openings); `npm run preview` redraws `resources/preview.png` from `tools/preview-image.html`.
