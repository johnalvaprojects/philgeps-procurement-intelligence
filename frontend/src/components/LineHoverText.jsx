import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { prefersReducedMotion } from '../useReducedMotion.js'

const GLYPHS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '!', '@', '#', '$', '%', '^', '&', '*', '-', '_', '+', '=', ';', ':', '<', '>', ',']

function splitText(text) {
  return String(text).split(/(\s+)/).flatMap((part) => (
    part.trim() === '' ? [part] : [...part]
  ))
}

const LineHoverText = forwardRef(function LineHoverText({ text }, ref) {
  const timers = useRef([])
  const generation = useRef(0)
  const sequence = splitText(text)
  const [shown, setShown] = useState(null)

  function clearTimers() {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }

  useImperativeHandle(ref, () => ({
    play() {
      if (prefersReducedMotion()) return
      const gen = generation.current + 1
      generation.current = gen
      clearTimers()
      setShown(null)
      sequence.forEach((char, position) => {
        if (!char || char.trim() === '') return
        const start = (position + 1) * 70
        for (let cycle = 0; cycle < 4; cycle += 1) {
          timers.current.push(window.setTimeout(() => {
            if (generation.current !== gen) return
            setShown((current) => {
              const next = current ? [...current] : [...sequence]
              next[position] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
              return next
            })
          }, start + cycle * 70))
        }
        timers.current.push(window.setTimeout(() => {
          if (generation.current !== gen) return
          setShown((current) => {
            if (!current) return null
            const next = [...current]
            next[position] = sequence[position]
            return next.every((value, index) => value === sequence[index]) ? null : next
          })
        }, start + 4 * 70 + 30))
      })
    },
    restore() {
      generation.current += 1
      clearTimers()
      setShown(null)
    },
  }))

  useEffect(() => () => {
    generation.current += 1
    clearTimers()
  }, [])

  let cursor = 0
  const parts = String(text).split(/(\s+)/)

  return (
    <span className="line-hover">
      {parts.map((part, index) => {
        if (part.trim() === '') {
          cursor += 1
          return <span key={index}>{part}</span>
        }
        return (
          <span key={index} className="line-word">
            {[...part].map((char, charIndex) => {
              const at = cursor
              cursor += 1
              const visible = shown?.[at] ?? char
              return (
                <span key={charIndex} className="line-char" data-char={char}>
                  {visible}
                </span>
              )
            })}
          </span>
        )
      })}
    </span>
  )
})

export default LineHoverText
