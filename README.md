# Joseki Practice

Practice go joseki against random variations from [Josekipedia](https://www.josekipedia.com).

A static site with no build step and no dependencies: plain HTML, CSS and ES modules.

## Development

```bash
npm run dev    # serves the site at http://localhost:8080 and proxies Josekipedia
npm test       # rules and text-handling tests (node:test)
```

## Layout

- `js/go.js` – board rules (captures, suicide, ko); pure, tested
- `js/josekipedia.js` – fetching, caching (memory + localStorage) and normalizing nodes
- `js/text.js` – cleaning Josekipedia comments (mojibake, entities, links); pure, tested
- `js/board-view.js` – SVG board rendering and pointer input
- `js/app.js` – game flow, computer moves, undo/redo, UI
- `js/starting-points.js` – the joseki/fuseki offered in the sidebar

## Deployment

Josekipedia doesn't allow cross-origin requests, so the site needs a proxy that serves
`/api/node/{id}`. `proxy/cloudflare-worker.js` is one (with edge caching) — see the comment at
its top for deploy steps, then point `NODE_URL` in `js/config.js` at it.
