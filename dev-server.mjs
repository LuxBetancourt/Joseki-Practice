// Local development server: serves the site and proxies /api/node/{id} to Josekipedia.
// Usage: node dev-server.mjs [port]

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.argv[2] || process.env.PORT || 8080)

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
}

createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')

    const api = /^\/api\/node\/(\d+)$/.exec(url.pathname)
    if (api) {
        try {
            const upstream = await fetch(`https://www.josekipedia.com/db/node.php?id=${api[1]}&pid=0`)
            res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(await upstream.text())
        }
        catch (error) {
            res.writeHead(502).end(String(error))
        }
        return
    }

    const path = normalize(join(root, decodeURIComponent(url.pathname)))
    if (!path.startsWith(root)) { // root ends with a separator, so this blocks "../" escapes
        res.writeHead(403).end()
        return
    }
    try {
        const file = path.endsWith(sep) ? join(path, 'index.html') : path
        const body = await readFile(file)
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
        res.end(body)
    }
    catch {
        res.writeHead(404).end('Not found')
    }
}).listen(port, () => console.log(`Joseki Practice running at http://localhost:${port}/`))
