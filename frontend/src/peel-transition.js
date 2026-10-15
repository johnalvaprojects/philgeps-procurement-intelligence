import { flushSync } from 'react-dom'
import { cancelChannel } from './channel-transition.js'
import { cancelSlide } from './slide-over-transition.js'
import { prefersReducedMotion } from './useReducedMotion.js'

// Page turn from Interlude's peel transition. A fold sweeps from the
// bottom-right corner and the current view turns off the new one.
const FLAP_SHADE = 10
const DIM = 0.05
const UNDER = 0.5
const TURN_MS = 1200

let stage = null
let frame = 0

function ease(amount) {
  return amount < 0.5 ? 2 * amount * amount : 1 - ((-2 * amount + 2) ** 2) / 2
}

function cut(polygon, a, b, c) {
  const side = ([u, v]) => a * u + b * v + c
  const kept = []
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    const here = side(point)
    const there = side(next)
    if (here >= 0) kept.push(point)
    if (here >= 0 !== there >= 0) {
      const distance = here / (here - there)
      kept.push([
        point[0] + (next[0] - point[0]) * distance,
        point[1] + (next[1] - point[1]) * distance,
      ])
    }
  })
  return kept
}

function shapes(s, width, height) {
  const page = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ]
  const flat = cut(page, 1, 1, -s)
  const turned = cut(page, -1, -1, s)
  let flap = cut(flat, -1, 0, s)
  flap = cut(flap, 0, -1, s)
  flap = cut(flap, 1, 0, height - s)
  flap = cut(flap, 0, 1, width - s)
  return { flat, flap, turned }
}

function clipPath(polygon, width, height) {
  if (polygon.length < 3) return 'polygon(0px 0px, 0px 0px, 0px 0px)'
  const points = polygon.map(([u, v]) => `${width - u}px ${height - v}px`)
  return `polygon(${points.join(', ')})`
}

export function cancelPeel() {
  cancelAnimationFrame(frame)
  frame = 0
  stage?.remove()
  stage = null
  document.documentElement.classList.remove('is-peeling')
}

function clearStage() {
  cancelPeel()
}

function takeVisual() {
  const root = document.getElementById('root')
  if (!root) return null
  const clone = root.cloneNode(true)
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  clone.setAttribute('aria-hidden', 'true')
  const sources = root.querySelectorAll('input, textarea')
  const copies = clone.querySelectorAll('input, textarea')
  sources.forEach((node, index) => {
    const copy = copies[index]
    if (!copy) return
    copy.setAttribute('value', node.value)
    copy.value = node.value
  })

  const visual = document.createElement('div')
  visual.className = 'peel-visual'
  visual.style.top = `${-window.scrollY}px`
  visual.append(clone)
  return visual
}

function film() {
  const node = document.createElement('div')
  node.className = 'peel-film'
  node.style.opacity = '0'
  return node
}

function mountSheet(visual) {
  const color = getComputedStyle(document.body).backgroundColor
  const next = document.createElement('div')
  next.className = 'peel-stage'
  next.setAttribute('aria-hidden', 'true')
  next.inert = true

  const under = film()
  const sheet = document.createElement('div')
  sheet.className = 'peel-sheet'
  sheet.append(visual)
  const flatFilm = film()
  const flap = document.createElement('div')
  flap.className = 'peel-flap'
  flap.style.background = `color-mix(in srgb, ${color}, #000 ${FLAP_SHADE}%)`
  const flapFilm = film()

  next.append(under, sheet, flatFilm, flap, flapFilm)
  document.body.append(next)
  document.documentElement.classList.add('is-peeling')
  return { stage: next, under, sheet, flatFilm, flap, flapFilm }
}

function turn(parts, direction) {
  const { under, sheet, flatFilm, flap, flapFilm } = parts
  const width = sheet.clientWidth
  const height = sheet.clientHeight
  const span = width + height
  const from = direction === 'back' ? span : 0
  const to = direction === 'back' ? 0 : span
  const back = direction === 'back'
  const started = performance.now()

  const draw = (s) => {
    const folded = shapes(s, width, height)
    sheet.style.clipPath = clipPath(back ? folded.turned : folded.flat, width, height)
    flap.style.clipPath = clipPath(folded.flap, width, height)
    flatFilm.style.clipPath = clipPath(folded.flat, width, height)
    flapFilm.style.clipPath = clipPath(folded.flap, width, height)
    under.style.clipPath = clipPath(folded.turned, width, height)
    const travelled = span === 0 ? 1 : s / span
    const dark = String(DIM * Math.sqrt(Math.max(0, travelled)))
    flatFilm.style.opacity = dark
    flapFilm.style.opacity = dark
    under.style.opacity = String(UNDER * (1 - travelled))
  }

  const step = (now) => {
    const amount = Math.min(1, (now - started) / TURN_MS)
    draw(from + (to - from) * ease(amount))
    if (amount < 1 && stage === parts.stage) {
      frame = requestAnimationFrame(step)
      return
    }
    if (stage === parts.stage) clearStage()
  }

  draw(from)
  frame = requestAnimationFrame(step)
}

export function playPeel(direction, update, after) {
  if (typeof update !== 'function') return
  if (prefersReducedMotion()) {
    cancelSlide()
    cancelChannel()
    clearStage()
    update()
    after?.()
    return
  }

  cancelSlide()
  cancelChannel()
  clearStage()
  const visual = takeVisual()
  if (!visual) {
    update()
    after?.()
    return
  }

  const parts = mountSheet(visual)
  stage = parts.stage
  flushSync(update)
  after?.()
  turn(parts, direction)
}
