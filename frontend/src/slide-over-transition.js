import { flushSync } from 'react-dom'
import { cancelChannel } from './channel-transition.js'
import { cancelPeel } from './peel-transition.js'
import { prefersReducedMotion } from './useReducedMotion.js'

// Back half of Interlude's slide-over. The view that is leaving slides down,
// and the main page comes forward out of the dark.
const SLIDE_MS = 1100
const BACK_SCALE = 0.9
const BACK_DIM = 0.6

let stage = null
let frame = 0

function expoInOut(amount) {
  if (amount <= 0) return 0
  if (amount >= 1) return 1
  return amount < 0.5
    ? (2 ** (20 * amount - 10)) / 2
    : (2 - (2 ** (-20 * amount + 10))) / 2
}

export function cancelSlide() {
  cancelAnimationFrame(frame)
  frame = 0
  stage?.remove()
  stage = null
  document.documentElement.classList.remove('is-sliding')
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
  visual.className = 'slide-visual'
  visual.style.top = `${-window.scrollY}px`
  visual.append(clone)
  return visual
}

function sheet(visual, className) {
  const node = document.createElement('div')
  node.className = `slide-sheet ${className}`
  node.append(visual)
  return node
}

function play(current, oldSheet, nextSheet, dim) {
  const height = current.clientHeight || window.innerHeight
  const started = performance.now()
  const step = (now) => {
    if (stage !== current) return
    const amount = Math.min(1, (now - started) / SLIDE_MS)
    const eased = expoInOut(amount)
    oldSheet.style.transform = `translate3d(0, ${height * eased}px, 0)`
    nextSheet.style.transform = `scale(${BACK_SCALE + (1 - BACK_SCALE) * eased})`
    dim.style.opacity = String(BACK_DIM * (1 - eased))
    if (amount < 1) {
      frame = requestAnimationFrame(step)
      return
    }
    cancelSlide()
  }
  frame = requestAnimationFrame(step)
}

export function playSlideBack(update, after) {
  if (typeof update !== 'function') return
  if (prefersReducedMotion()) {
    cancelPeel()
    cancelSlide()
    cancelChannel()
    update()
    after?.()
    return
  }

  cancelPeel()
  cancelSlide()
  cancelChannel()
  const leaving = takeVisual()
  if (!leaving) {
    update()
    after?.()
    return
  }

  const current = document.createElement('div')
  current.className = 'slide-stage'
  current.setAttribute('aria-hidden', 'true')
  current.inert = true
  document.body.append(current)
  document.documentElement.classList.add('is-sliding')
  stage = current

  flushSync(update)
  after?.()

  const arriving = takeVisual()
  const nextSheet = sheet(arriving || document.createElement('div'), 'is-next')
  nextSheet.style.transform = `scale(${BACK_SCALE})`
  const dim = document.createElement('div')
  dim.className = 'slide-dim'
  dim.style.opacity = String(BACK_DIM)
  nextSheet.append(dim)

  const oldSheet = sheet(leaving, 'is-old')
  oldSheet.style.transform = 'translate3d(0, 0, 0)'
  current.append(nextSheet, oldSheet)
  play(current, oldSheet, nextSheet, dim)
}
