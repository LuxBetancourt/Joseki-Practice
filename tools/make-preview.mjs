// Renders tools/preview-image.html to resources/preview.png (the link preview image) with a
// headless Chromium browser: Microsoft Edge or Google Chrome, wherever it's installed.
// Usage: node tools/make-preview.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const page = fileURLToPath(new URL('preview-image.html', import.meta.url))
const output = fileURLToPath(new URL('../resources/preview.png', import.meta.url))

const browsers = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
]
const browser = browsers.find((path) => existsSync(path))
if (!browser) {
    console.error('No Edge or Chrome found. Add its path to the list in tools/make-preview.mjs.')
    process.exit(1)
}

// Its own profile, so an already-open browser doesn't take the job over and drop it
const profile = mkdtempSync(join(tmpdir(), 'preview-'))
execFileSync(browser, [
    `--user-data-dir=${profile}`, '--no-first-run', '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1200,630', `--screenshot=${output}`, pathToFileURL(page).href,
], { stdio: 'inherit' })
rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
console.log(`Wrote ${output}`)
