import { useEffect, useRef, useState } from 'react'
import { padCount } from '../format.js'
import { useReducedMotion } from '../useReducedMotion.js'
import OpportunityCard from './OpportunityCard.jsx'

const LABELS = {
  all: {
    title: 'Selected / Notices',
    viewAll: 'View all notices',
    empty: 'No notices identified yet.',
  },
  software: {
    title: 'Selected / Software',
    viewAll: 'View all software',
    empty: 'No software opportunities identified yet.',
  },
  review: {
    title: 'Selected / Review',
    viewAll: 'View all review',
    empty: 'No review notices identified yet.',
  },
  'not relevant': {
    title: 'Selected / Not Relevant',
    viewAll: 'View all not relevant',
    empty: 'No not-relevant notices identified yet.',
  },
}

const EXIT_MS = 160
const ENTER_MS = 420

function sameNoticeList(left, right) {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((notice, index) => notice.referenceNumber === right[index]?.referenceNumber)
}

export default function FeaturedOpportunities({
  notices,
  total,
  state,
  category = 'software',
  onOpen,
  onViewAll,
}) {
  const reduced = useReducedMotion()
  const [view, setView] = useState({ category, notices, total, state })
  const [phase, setPhase] = useState('idle')
  const viewRef = useRef(view)
  const timers = useRef([])

  viewRef.current = view

  useEffect(() => () => {
    timers.current.forEach((id) => window.clearTimeout(id))
  }, [])

  useEffect(() => {
    const current = viewRef.current
    const categoryChanged = current.category !== category
    const contentChanged = current.state !== state
      || current.total !== total
      || !sameNoticeList(current.notices, notices)

    if (!categoryChanged && !contentChanged) return undefined

    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []

    const next = { category, notices, total, state }

    if (reduced || !categoryChanged) {
      setView(next)
      setPhase('idle')
      return undefined
    }

    setPhase('out')
    const exitTimer = window.setTimeout(() => {
      setView(next)
      setPhase('in')
      const enterTimer = window.setTimeout(() => {
        setPhase('idle')
      }, ENTER_MS)
      timers.current.push(enterTimer)
    }, EXIT_MS)
    timers.current.push(exitTimer)

    return () => {
      timers.current.forEach((id) => window.clearTimeout(id))
      timers.current = []
    }
  }, [category, notices, total, state, reduced])

  const labels = LABELS[view.category] || LABELS.software
  const panelClass = [
    'featured-panel',
    phase === 'out' ? 'is-out' : '',
    phase === 'in' ? 'is-in' : '',
  ].filter(Boolean).join(' ')

  return (
    <section id="featured" className="featured" aria-labelledby="featured-title">
      <div className={panelClass}>
        <div className="section-rule">
          <h2 id="featured-title" className="mono">{labels.title}</h2>
          <button
            type="button"
            className="text-link mono"
            onClick={onViewAll}
          >
            <span>{`${labels.viewAll} / ${padCount(view.total)}`}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>

        {view.state === 'loading' ? <p className="state-line mono">Loading notices...</p> : null}
        {view.state === 'error' ? <p className="state-line mono">Unable to load notices.</p> : null}
        {view.state === 'ready' && view.notices.length === 0 ? (
          <p className="state-line mono">{labels.empty}</p>
        ) : null}

        {view.state === 'ready' && view.notices.length > 0 ? (
          <div
            key={view.category}
            className={`featured-grid count-${Math.min(view.notices.length, 5)}`}
          >
            {view.notices.map((notice, index) => (
              <OpportunityCard
                key={notice.referenceNumber}
                notice={notice}
                onOpen={onOpen}
                lead={index === 0}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
