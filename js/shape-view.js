// Small, non-interactive board showing just the region around a shape (e.g. a joseki's final position).
// Uses the same CSS classes and stone gradients as the main board.

import { SIZE, EMPTY, BLACK, orient, unorient } from './go.js'

const NS = 'http://www.w3.org/2000/svg'
const EDGE_SNAP = 5 // Show the edge if the shape comes within this many lines of it
const MIN_SPAN = 7
const OVERHANG = 0.6 // How far cut-off lines extend past the region

/**
 * Small boards draw their grid with a fixed hairline, which must be a whole number of device
 * pixels to look even (at 150% scaling, "1px" is 1.5 device pixels and lines alternate between
 * 1 and 2). Sets --grid-line to the nearest whole number of device pixels, and keeps it updated
 * if the ratio changes (zooming, moving to another screen).
 */
let trackingPixelRatio = false
function trackPixelRatio() {
    if (trackingPixelRatio) { return }
    trackingPixelRatio = true
    const update = () => {
        const ratio = window.devicePixelRatio || 1
        document.documentElement.style.setProperty('--grid-line', `${Math.max(1, Math.round(ratio)) / ratio}px`)
        matchMedia(`(resolution: ${ratio}dppx)`).addEventListener('change', update, { once: true })
    }
    update()
}

/** Grows the inclusive range [lo, hi] to `span` points, preferring to grow away from a board edge. */
function grow(lo, hi, span) {
    while (hi - lo + 1 < span) {
        const preferHi = lo === 0 || (hi < SIZE - 1 && (hi - lo) % 2 === 0)
        if (preferHi && hi < SIZE - 1) { ++hi }
        else { --lo }
    }
    return [lo, hi]
}

/** All stones on the board, as {x, y}. */
function allStones(position) {
    const points = []
    for (let y = 0; y < SIZE; ++y) {
        for (let x = 0; x < SIZE; ++x) {
            if (position.at(x, y) !== EMPTY) { points.push({ x, y }) }
        }
    }
    return points
}

/**
 * `points` plus every stone connected to them through stones at most `reach` lines apart:
 * the local shape around some moves, ignoring stones in other corners.
 */
export function localShape(position, points, reach = 3) {
    const stones = allStones(position)
    const shape = [...points]
    const included = new Set(shape.map(({ x, y }) => `${x},${y}`))
    for (let i = 0; i < shape.length; ++i) {
        for (const stone of stones) {
            const key = `${stone.x},${stone.y}`
            if (!included.has(key) && Math.max(Math.abs(stone.x - shape[i].x), Math.abs(stone.y - shape[i].y)) <= reach) {
                included.add(key)
                shape.push(stone)
            }
        }
    }
    return shape
}

/** The square region {x0, y0, x1, y1} (inclusive) to show `points` (default: every stone). */
export function shapeRegion(position, points = allStones(position)) {
    let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1
    for (const { x, y } of points) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x)
        y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    if (x1 < 0) { return { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 } }

    // One line of margin around the stones, extended to any nearby edge
    const axis = (lo, hi) => [
        lo - 1 <= EDGE_SNAP ? 0 : lo - 1,
        hi + 1 >= SIZE - 1 - EDGE_SNAP ? SIZE - 1 : hi + 1,
    ]
    const [ax0, ax1] = axis(x0, x1)
    const [ay0, ay1] = axis(y0, y1)
    const span = Math.max(MIN_SPAN, ax1 - ax0 + 1, ay1 - ay0 + 1)
    const [rx0, rx1] = grow(ax0, ax1, span)
    const [ry0, ry1] = grow(ay0, ay1, span)
    return { x0: rx0, y0: ry0, x1: rx1, y1: ry1 }
}

/**
 * Renders `position` cropped to `region` (default: shapeRegion(position)).
 * `numbers` maps "x,y" to a label drawn on that stone (e.g. move order).
 * `rings` are [{x, y, type}] points to circle; `type` is a CSS class for the ring's color.
 * `orientation` turns and mirrors it as the main board is (see orient in go.js); everything else
 * is given in the game's coordinates.
 */
export function renderShape(position, { region = shapeRegion(position), numbers = new Map(), rings = [], label = '', orientation = 0 } = {}) {
    trackPixelRatio()
    if (orientation) {
        // Draw the turned board: look up each drawn point's stone back in the game's coordinates
        const game = position
        position = { at: (x, y) => { const p = unorient({ x, y }, orientation); return game.at(p.x, p.y) } }
        const a = orient({ x: region.x0, y: region.y0 }, orientation)
        const b = orient({ x: region.x1, y: region.y1 }, orientation)
        region = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
        numbers = new Map([...numbers].map(([key, number]) => {
            const [x, y] = key.split(',').map(Number)
            const p = orient({ x, y }, orientation)
            return [`${p.x},${p.y}`, number]
        }))
        rings = rings.map((ring) => ({ ...ring, ...orient(ring, orientation) }))
    }
    const { x0, y0, x1, y1 } = region
    const left = x0 - OVERHANG
    const top = y0 - OVERHANG
    const right = x1 + OVERHANG
    const bottom = y1 + OVERHANG

    // Lines stop at the board edge but run off the side of the region elsewhere
    const lineX0 = x0 === 0 ? 0 : left
    const lineX1 = x1 === SIZE - 1 ? x1 : right
    const lineY0 = y0 === 0 ? 0 : top
    const lineY1 = y1 === SIZE - 1 ? y1 : bottom

    const parts = [`<rect class="wood" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" rx="0.25"/>`]
    let d = ''
    for (let y = y0; y <= y1; ++y) { d += `M${lineX0} ${y}H${lineX1}` }
    for (let x = x0; x <= x1; ++x) { d += `M${x} ${lineY0}V${lineY1}` }
    parts.push(`<path class="grid" d="${d}"/>`)
    for (const x of [3, 9, 15]) {
        for (const y of [3, 9, 15]) {
            if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { parts.push(`<circle class="star" cx="${x}" cy="${y}" r="0.12"/>`) }
        }
    }
    for (let y = y0; y <= y1; ++y) {
        for (let x = x0; x <= x1; ++x) {
            const color = position.at(x, y)
            if (color === EMPTY) { continue }
            const name = color === BLACK ? 'black' : 'white'
            parts.push(`<circle class="stone ${name}" cx="${x}" cy="${y}" r="0.47"/>`)
            const number = numbers.get(`${x},${y}`)
            if (number !== undefined) {
                parts.push(`<text class="move-number on-${name}" x="${x}" y="${y}">${number}</text>`)
            }
        }
    }

    for (const { x, y, type } of rings) {
        parts.push(`<circle class="ring ${type}" cx="${x}" cy="${y}" r="0.54"/>`)
    }

    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('class', 'goban shape')
    svg.setAttribute('viewBox', `${left} ${top} ${right - left} ${bottom - top}`)
    svg.setAttribute('role', 'img')
    if (label) { svg.setAttribute('aria-label', label) }
    svg.innerHTML = parts.join('')
    return svg
}
