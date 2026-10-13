// SVG rendering of the board plus pointer input. Knows nothing about joseki logic.

import { SIZE, EMPTY, BLACK, columnLabel, rowLabel, colorName } from './go.js'

const NS = 'http://www.w3.org/2000/svg'
const STAR_POINTS = [3, 9, 15].flatMap((x) => [3, 9, 15].map((y) => [x, y]))
const MARGIN = 1.6

/** SVG for a traditional point marker ('triangle' | 'square' | 'circle') centered on (x, y). */
export function markShape(shape, x, y, className) {
    if (shape === 'triangle') {
        const r = 0.34
        const points = [[x, y - r], [x + r * 0.866, y + r / 2], [x - r * 0.866, y + r / 2]]
        return `<polygon class="${className}" points="${points.map((p) => p.join(',')).join(' ')}"/>`
    }
    if (shape === 'square') {
        return `<rect class="${className}" x="${x - 0.22}" y="${y - 0.22}" width="0.44" height="0.44"/>`
    }
    return `<circle class="${className}" cx="${x}" cy="${y}" r="0.25"/>`
}

/**
 * Defines the stone gradients once, in a tiny SVG of their own. Every board (main and small)
 * refers to them by id, and gradients inside a hidden SVG don't render, so they can't live in
 * any one board.
 */
export function ensureStoneGradients() {
    if (document.getElementById('stone-gradients')) { return }
    const svg = el('svg', { id: 'stone-gradients', width: 0, height: 0, 'aria-hidden': 'true', style: 'position: absolute' })
    const defs = el('defs', {}, svg)
    for (const [id, inner, outer] of [['stone-black', '#5a5a5a', '#101010'], ['stone-white', '#ffffff', '#d4d4d4']]) {
        const gradient = el('radialGradient', { id, cx: '35%', cy: '35%', r: '70%' }, defs)
        el('stop', { offset: '0%', 'stop-color': inner }, gradient)
        el('stop', { offset: '100%', 'stop-color': outer }, gradient)
    }
    document.body.prepend(svg)
}

function el(name, attrs = {}, parent) {
    const node = document.createElementNS(NS, name)
    for (const [key, value] of Object.entries(attrs)) { node.setAttribute(key, value) }
    if (parent) { parent.append(node) }
    return node
}

export class BoardView {
    /**
     * @param {SVGSVGElement} svg
     * @param {{ onPlay(x, y), onContextMenu(x, y), canHover(): number|null }} handlers
     *   canHover returns the color to preview, or null when input is disabled.
     */
    constructor(svg, handlers) {
        this.svg = svg
        this.handlers = handlers
        this.state = { position: null, lastMove: null, highlights: [], marks: [], target: null }
        this.hoverPoint = null

        const size = SIZE - 1 + 2 * MARGIN
        svg.setAttribute('viewBox', `${-MARGIN} ${-MARGIN} ${size} ${size}`)
        svg.classList.add('goban')
        svg.replaceChildren()
        this.drawStatic()
        this.highlightLayer = el('g', { class: 'highlights' }, svg)
        this.stoneLayer = el('g', { class: 'stones' }, svg)
        this.markLayer = el('g', { class: 'marks' }, svg)
        this.ghost = el('circle', { class: 'stone ghost', r: 0.47, visibility: 'hidden' }, svg)

        svg.addEventListener('pointermove', (e) => this.onPointerMove(e))
        svg.addEventListener('pointerleave', () => this.setHover(null))
        svg.addEventListener('click', (e) => {
            const point = this.pointFromEvent(e)
            if (point) { this.handlers.onPlay(point.x, point.y) }
        })
        svg.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            const point = this.pointFromEvent(e)
            if (point) { this.handlers.onContextMenu(point.x, point.y) }
        })
    }

    drawStatic() {
        const max = SIZE - 1
        ensureStoneGradients()
        el('rect', { class: 'wood', x: -MARGIN, y: -MARGIN, width: max + 2 * MARGIN, height: max + 2 * MARGIN, rx: 0.3 }, this.svg)

        let d = ''
        for (let i = 0; i < SIZE; ++i) {
            d += `M0 ${i}H${max}M${i} 0V${max}`
        }
        el('path', { class: 'grid', d }, this.svg)
        el('rect', { class: 'grid-edge', x: 0, y: 0, width: max, height: max }, this.svg)
        STAR_POINTS.forEach(([x, y]) => el('circle', { class: 'star', cx: x, cy: y, r: 0.12 }, this.svg))

        const labels = el('g', { class: 'coordinates', 'aria-hidden': 'true' }, this.svg)
        for (let i = 0; i < SIZE; ++i) {
            for (const y of [-1, SIZE]) {
                el('text', { x: i, y }, labels).textContent = columnLabel(i)
            }
            for (const x of [-1, SIZE]) {
                el('text', { x, y: i }, labels).textContent = rowLabel(i)
            }
        }
    }

    pointFromEvent(event) {
        const matrix = this.svg.getScreenCTM()
        if (!matrix) { return null }
        const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
        const x = Math.round(p.x)
        const y = Math.round(p.y)
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) { return null }
        if (Math.hypot(p.x - x, p.y - y) > 0.55) { return null }
        return { x, y }
    }

    onPointerMove(event) {
        this.setHover(event.pointerType === 'mouse' ? this.pointFromEvent(event) : null)
    }

    setHover(point) {
        this.hoverPoint = point
        this.updateGhost()
    }

    updateGhost() {
        const point = this.hoverPoint
        const color = this.handlers.canHover()
        const position = this.state.position
        const show = point && color && position && position.at(point.x, point.y) === EMPTY
        this.ghost.setAttribute('visibility', show ? 'visible' : 'hidden')
        this.svg.classList.toggle('clickable', Boolean(show))
        if (show) {
            this.ghost.setAttribute('cx', point.x)
            this.ghost.setAttribute('cy', point.y)
            this.ghost.setAttribute('class', `stone ghost ${colorName(color)}`)
        }
    }

    /**
     * @param {object} state
     *   position:   Position to draw
     *   lastMove:   {x, y, style?} | null; style 'cross' marks it with an X instead of a ring
     *   highlights: [{x, y, type}] candidate moves; type is a CSS class suffix
     *   marks:      [{x, y, shape}] marked points; shape is 'triangle', 'square' or 'circle'
     *   target:     Position | null; stones it adds are drawn faded, stones it lacks are crossed out
     */
    render(state) {
        Object.assign(this.state, state)
        const { position, lastMove, highlights, marks, target } = this.state

        const stones = []
        const removed = []
        if (target) {
            for (let y = 0; y < SIZE; ++y) {
                for (let x = 0; x < SIZE; ++x) {
                    const now = position.at(x, y)
                    const later = target.at(x, y)
                    if (later !== EMPTY && now === EMPTY) {
                        stones.push(`<circle class="stone future ${later === BLACK ? 'black' : 'white'}" cx="${x}" cy="${y}" r="0.47"/>`)
                    }
                    else if (now !== EMPTY && now !== later) { // Captured (and possibly retaken by the other color)
                        removed.push({ x, y, on: now === BLACK ? 'on-black' : 'on-white' })
                    }
                }
            }
        }
        for (let y = 0; y < SIZE; ++y) {
            for (let x = 0; x < SIZE; ++x) {
                const color = position.at(x, y)
                if (color !== EMPTY) {
                    stones.push(`<circle class="stone ${color === BLACK ? 'black' : 'white'}" cx="${x}" cy="${y}" r="0.47"/>`)
                }
            }
        }
        const marked = (x, y) => marks.some((m) => m.x === x && m.y === y)
        if (lastMove && position.at(lastMove.x, lastMove.y) !== EMPTY && !marked(lastMove.x, lastMove.y)) {
            const { x, y } = lastMove
            const on = position.at(x, y) === BLACK ? 'on-black' : 'on-white'
            stones.push(lastMove.style === 'cross'
                ? `<path class="last-move-cross" d="M${x - 0.24} ${y - 0.24}L${x + 0.24} ${y + 0.24}M${x + 0.24} ${y - 0.24}L${x - 0.24} ${y + 0.24}"/>`
                : `<circle class="last-move ${on}" cx="${x}" cy="${y}" r="0.2"/>`)
        }
        this.stoneLayer.innerHTML = stones.join('')

        this.highlightLayer.innerHTML = highlights
            .filter(({ x, y }) => position.at(x, y) === EMPTY)
            .map(({ x, y, type }) => `<circle class="highlight ${type}" cx="${x}" cy="${y}" r="0.28"/>`)
            .join('')

        this.markLayer.innerHTML = marks.map(({ x, y, shape }) => {
            const on = { [EMPTY]: 'on-empty', [BLACK]: 'on-black' }[position.at(x, y)] || 'on-white'
            return markShape(shape, x, y, `mark ${on}`)
        }).concat(removed.map(({ x, y, on }) =>
            `<path class="removed ${on}" d="M${x - 0.22} ${y - 0.22}L${x + 0.22} ${y + 0.22}M${x + 0.22} ${y - 0.22}L${x - 0.22} ${y + 0.22}"/>`,
        )).join('')

        this.updateGhost()
    }
}
