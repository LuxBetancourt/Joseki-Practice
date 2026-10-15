// Uploads the site to Neocities via its API.
// Usage: NEOCITIES_API_KEY=... node deploy.mjs [--dry-run]
// Get the API key from https://neocities.org/settings (Manage Site Settings -> API).

import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { versionAssets } from './tools/version-assets.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const API = 'https://neocities.org/api'
const dryRun = process.argv.includes('--dry-run')

// Files from the old version of the site that no longer exist. Only these are ever deleted.
const OBSOLETE = ['index.js', 'profile_fetcher.js']

async function siteFiles() {
    const files = ['index.html', 'about.html', 'reviews.html', 'josekipedia-load.html', 'index.css', 'about.css', 'reviews.css']
    for (const dir of ['js', 'resources']) {
        for (const name of await readdir(join(root, dir))) { files.push(`${dir}/${name}`) }
    }
    return files
}

async function api(path, options) {
    const response = await fetch(`${API}/${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${process.env.NEOCITIES_API_KEY}` },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.result !== 'success') {
        throw new Error(`${path}: ${body.message || response.status}`)
    }
    return body
}

const config = await readFile(join(root, 'js/config.js'), 'utf8')
if (config.includes('REPLACE-ME')) {
    console.error('Set PRODUCTION_NODE_URL in js/config.js to your Cloudflare Worker URL first.')
    if (!dryRun) { process.exit(1) }
}

const files = await siteFiles()
// Scripts, stylesheets and data get a version in their address (see tools/version-assets.mjs)
const versioned = versionAssets(files, (path) => readFileSync(join(root, path), 'utf8'))
if (dryRun) {
    console.log('Would upload:', files.join(', '))
    console.log('With versioned addresses in:', [...versioned.keys()].join(', '))
    console.log('Would delete if present:', OBSOLETE.join(', '))
    process.exit(0)
}
if (!process.env.NEOCITIES_API_KEY) {
    console.error('Set NEOCITIES_API_KEY (from https://neocities.org/settings).')
    process.exit(1)
}

const form = new FormData()
for (const file of files) {
    form.append(file, new Blob([versioned.get(file) ?? await readFile(join(root, file))]), file)
}
await api('upload', { method: 'POST', body: form })
console.log(`Uploaded ${files.length} files.`)

const remote = new Set((await api('list')).files.map((f) => f.path))
const toDelete = OBSOLETE.filter((f) => remote.has(f))
if (toDelete.length) {
    const params = new URLSearchParams()
    toDelete.forEach((f) => params.append('filenames[]', f))
    await api('delete', { method: 'POST', body: params })
    console.log(`Deleted obsolete files: ${toDelete.join(', ')}`)
}
console.log('Done: https://josekipractice.neocities.org/')
