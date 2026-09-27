import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../useReducedMotion.js'

const DURATION = 360
const CLOSE_DELAY = 80

// Place the full-viewport panel over the clicked card. transform-origin is 0 0,
// and translate() is listed before scale() so the offset stays in screen pixels.
function invertTransform(rect) {
  const width = window.innerWidth
  const height = window.innerHeight
  if (!rect || rect.width < 1 || rect.height < 1 || width < 1 || height < 1) {
    return 'translate(0px, 0px) scale(1, 1)'
  }
  const scaleX = rect.width / width
  const scaleY = rect.height / height
  return `translate(${rect.left}px, ${rect.top}px) scale(${scaleX}, ${scaleY})`
}

// The panel is always inset: 0. Only transform and opacity move, so the
// expansion stays on the compositor. Phases: invert -> expanding -> settled,
// then closing -> onClosed().
export default function ExpandingPanel({ originRect, open, onRequestClose, onClosed, label, children }) {
  const reduced = useReducedMotion()
  const panelRef = useRef(null)
  const invert = useRef(invertTransform(originRect))
  const [phase, setPhase] = useState(reduced ? 'settled' : 'invert')

  useEffect(() => {
    document.documentElement.classList.add('panel-open')
    document.body.classList.add('panel-open')
    return () => {
      document.documentElement.classList.remove('panel-open')
      document.body.classList.remove('panel-open')
    }
  }, [])

  useLayoutEffect(() => {
    if (!open || reduced) return undefined
    panelRef.current?.getBoundingClientRect()
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setPhase((current) => (current === 'invert' ? 'expanding' : current))
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [open, reduced])

  useEffect(() => {
    if (!open) return undefined
    if (reduced) {
      setPhase('settled')
      return undefined
    }
    const timer = setTimeout(() => {
      setPhase((current) => (current === 'closing' ? current : 'settled'))
    }, DURATION + 20)
    return () => clearTimeout(timer)
  }, [open, reduced])

  useEffect(() => {
    if (open) return undefined
    if (reduced) {
      onClosed()
      return undefined
    }
    setPhase('closing')
    const timer = setTimeout(onClosed, DURATION + CLOSE_DELAY + 30)
    return () => clearTimeout(timer)
  }, [open, reduced, onClosed])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onRequestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRequestClose])

  useEffect(() => {
    if (phase !== 'settled') return undefined
    const panel = panelRef.current
    const target = panel?.querySelector('[data-autofocus]') || panel
    target?.focus({ preventScroll: true })
    return undefined
  }, [phase])

  return (
    <div
      ref={panelRef}
      className={`expanding-panel phase-${phase}`}
      style={{ '--panel-invert': invert.current }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
    >
      <div className="panel-content" aria-hidden={phase !== 'settled'}>
        {children}
      </div>
    </div>
  )
}
