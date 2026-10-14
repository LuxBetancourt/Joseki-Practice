// Saves Josekipedia's empty-board node as resources/root-node.json, which the site reads instead of
// asking the proxy (see getNode in js/josekipedia.js). Run it now and then to pick up new openings.
// Usage: node tools/update-root-node.mjs

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = fileURLToPath(new URL('../resources/root-node.json', import.meta.url))
const response = await fetch('https://www.josekipedia.com/db/node.php?id=1&pid=0')
const text = await response.text()
const node = JSON.parse(text)
if (!response.ok || node._id !== 1 || !Array.isArray(node._children)) {
    console.error(`Unexpected response from Josekipedia (${response.status})`)
    process.exit(1)
}
await writeFile(output, text)
console.log(`Wrote ${output}: ${node._children.length} opening moves, ${text.length} bytes`)
