import { flushSync } from 'react-dom'
import { cancelPeel } from './peel-transition.js'
import { cancelSlide } from './slide-over-transition.js'
import { prefersReducedMotion } from './useReducedMotion.js'
import './channel-transition.css'

// Channel, from Interlude: the page loses the signal in bands of static,
// jumps like a television, then the next view tunes back in.
const LEAVE_MS = 450
const ENTER_MS = 500
const GRAIN_X = 156
const GRAIN_Y = 260
const FPS = 30
const FLICKER = 14
const SNOW_DARK = 0.06
const SNOW_LIGHT = 0.92
const JUMP = 0.04
const JUMP_EVERY = 50
const ENTER_JUMP_SHARE = 0.8

let stage = null
let frame = 0

function hash(x, y) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function power1In(amount) {
  return amount * amount
}

function power2Out(amount) {
  return 1 - ((1 - amount) ** 3)
}

export function cancelChannel() {
  cancelAnimationFrame(frame)
  frame = 0
  stage?.remove()
  stage = null
  document.documentElement.classList.remove('is-channel')
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
    const secret = node instanceof HTMLInputElement && node.type === 'password'
    const value = secret ? '' : node.value
    copy.setAttribute('value', value)
    copy.value = value
  })
  const visual = document.createElement('div')
  visual.className = 'channel-visual'
  visual.style.top = `${-window.scrollY}px`
  visual.append(clone)
  return visual
}

function sheet(visual) {
  const node = document.createElement('div')
  node.className = 'channel-sheet'
  if (visual) node.append(visual)
  return node
}

function paint(canvas, progress, seconds, reveal) {
  const context = canvas.getContext('2d', { alpha: true })
  const image = context.createImageData(GRAIN_X, GRAIN_Y)
  const data = image.data
  const picture = Math.floor(seconds * FPS) % 97
  const deal = (Math.floor(seconds * FLICKER) % 97) + (reveal ? 50 : 0)
  const level = progress * 1.2 - 0.1
  const signal = progress <= 0 ? 0 : Math.min(1, progress / 0.2)
  const rollAt = (seconds * 1.2) % 1

  for (let y = 0; y < GRAIN_Y; y += 1) {
    const v = (y + 0.5) / GRAIN_Y
    const row = hash(Math.floor(v * 6), deal) * 0.5 + hash(Math.floor(v * 40), deal + 3.1) * 0.5
    const snowy = row <= level
    const roll = (v - rollAt) / 0.08
    const bar = Math.exp(-roll * roll) * 0.18
    const pictureX = picture * 13.7
    const pictureY = picture * 7.3

    for (let x = 0; x < GRAIN_X; x += 1) {
      const index = (y * GRAIN_X + x) * 4
      if (!snowy) {
        data[index + 3] = 0
        continue
      }
      const snow = SNOW_DARK + (SNOW_LIGHT - SNOW_DARK) * hash(x + pictureX, y + pictureY)
      const grey = Math.round(Math.min(1, snow + bar * 0.5) * 255)
      data[index] = grey
      data[index + 1] = grey
      data[index + 2] = grey
      data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return signal
}

function jump(node, amount, worse) {
  const strength = worse ? amount : 1 - amount
  if (strength <= 0.001) {
    node.style.transform = 'translate3d(0, 0, 0)'
    return
  }
  const big = Math.random() < 0.3
  const x = (Math.random() * 2 - 1) * JUMP * 100 * strength * (big ? 1 : 0.3)
  const y = big ? (Math.random() * 2 - 1) * 2 * strength : 0
  node.style.transform = `translate3d(${x}%, ${y}%, 0)`
}

export function playChannel(update) {
  if (typeof update !== 'function') return
  if (prefersReducedMotion()) {
    cancelPeel()
    cancelSlide()
    cancelChannel()
    update()
    return
  }
  if (stage) return

  cancelPeel()
  cancelSlide()
  const leaving = takeVisual()
  if (!leaving) {
    update()
    return
  }

  const current = document.createElement('div')
  current.className = 'channel-stage'
  current.setAttribute('aria-hidden', 'true')
  current.inert = true
  current.style.background = getComputedStyle(document.body).backgroundColor
  const page = sheet(leaving)
  const scan = document.createElement('div')
  scan.className = 'channel-scan'
  const bar = document.createElement('div')
  bar.className = 'channel-bar'
  const canvas = document.createElement('canvas')
  canvas.className = 'channel-static'
  canvas.width = GRAIN_X
  canvas.height = GRAIN_Y
  current.append(page, scan, bar, canvas)
  document.body.append(current)
  document.documentElement.classList.add('is-channel')
  stage = current

  const started = performance.now()
  let phase = 'leave'
  let enterAt = 0
  let nextJump = started
  let arriving = page

  const step = (now) => {
    if (stage !== current) return
    const seconds = (now - started) / 1000
    if (phase === 'leave') {
      const amount = Math.min(1, (now - started) / LEAVE_MS)
      const signal = paint(canvas, power1In(amount), seconds, false)
      scan.style.opacity = String(signal)
      bar.style.opacity = String(signal)
      bar.style.top = `${((seconds * 1.2) % 1) * 100}%`
      if (now >= nextJump) {
        jump(page, amount, true)
        nextJump = now + JUMP_EVERY
      }
      if (amount < 1) {
        frame = requestAnimationFrame(step)
        return
      }
      page.style.transform = 'translate3d(0, 0, 0)'
      try {
        flushSync(update)
      } catch (error) {
        cancelChannel()
        throw error
      }
      const visual = takeVisual()
      arriving = sheet(visual)
      page.replaceWith(arriving)
      phase = 'enter'
      enterAt = performance.now()
      nextJump = enterAt
      frame = requestAnimationFrame(step)
      return
    }

    const elapsed = now - enterAt
    const amount = Math.min(1, elapsed / ENTER_MS)
    const signal = paint(canvas, 1 - power2Out(amount), seconds, true)
    scan.style.opacity = String(signal)
    bar.style.opacity = String(signal)
    bar.style.top = `${((seconds * 1.2) % 1) * 100}%`
    if (elapsed < ENTER_MS * ENTER_JUMP_SHARE && now >= nextJump) {
      jump(arriving, amount, false)
      nextJump = now + JUMP_EVERY
    } else if (elapsed >= ENTER_MS * ENTER_JUMP_SHARE) {
      arriving.style.transform = 'translate3d(0, 0, 0)'
    }
    if (amount < 1) {
      frame = requestAnimationFrame(step)
      return
    }
    cancelChannel()
  }

  frame = requestAnimationFrame(step)
}
