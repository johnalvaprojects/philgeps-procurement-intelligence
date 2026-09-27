import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { prefersReducedMotion } from '../useReducedMotion.js'

const GLYPHS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '!', '@', '#', '$', '%', '^', '&', '*', '-', '_', '+', '=', ';', ':', '<', '>', ',']

function restore(root, timers) {
  timers.current.forEach((id) => window.clearTimeout(id))
  timers.current = []
  root?.querySelectorAll('.line-char').forEach((char) => {
    char.textContent = char.dataset.char
    char.style.opacity = '1'
    char.style.setProperty('--opa', '0')
  })
}

function play(root, timers) {
  if (!root || prefersReducedMotion()) return
  restore(root, timers)
  root.querySelectorAll('.line-char').forEach((char, position) => {
    const original = char.dataset.char
    if (!original || original.trim() === '') return
    const start = (position + 1) * 70
    for (let cycle = 0; cycle < 4; cycle += 1) {
      const at = start + cycle * 70
      timers.current.push(window.setTimeout(() => {
        char.style.setProperty('--opa', cycle === 0 ? '1' : '0')
        char.style.opacity = '0'
        timers.current.push(window.setTimeout(() => {
          char.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          char.style.opacity = '1'
        }, 30))
      }, at))
    }
    timers.current.push(window.setTimeout(() => {
      char.textContent = original
      char.style.opacity = '1'
      char.style.setProperty('--opa', '0')
    }, start + 4 * 70 + 30))
  })
}

const LineHoverText = forwardRef(function LineHoverText({ text }, ref) {
  const rootRef = useRef(null)
  const timers = useRef([])
  const parts = String(text).split(/(\s+)/)

  useImperativeHandle(ref, () => ({
    play() {
      play(rootRef.current, timers)
    },
  }))

  useEffect(() => () => {
    timers.current.forEach((id) => window.clearTimeout(id))
  }, [])

  return (
    <span ref={rootRef} className="line-hover">
      {parts.map((part, index) => (
        part.trim() === '' ? (
          <span key={index}>{part}</span>
        ) : (
          <span key={index} className="line-word">
            {[...part].map((char, charIndex) => (
              <span key={charIndex} className="line-char" data-char={char}>
                {char}
              </span>
            ))}
          </span>
        )
      ))}
    </span>
  )
})

export default LineHoverText
