import { useRef } from 'react'
import { padCount } from '../format.js'
import LineHoverText from './LineHoverText.jsx'

const ITEMS = [
  { id: 'all', label: 'Notices', countKey: 'all' },
  { id: 'software', label: 'Software', countKey: 'software' },
  { id: 'review', label: 'Review', countKey: 'review' },
  { id: 'not relevant', label: 'Not Relevant', countKey: 'notRelevant' },
]

export default function Statistics({ counts, active, onSelect }) {
  const labels = useRef({})

  return (
    <section className="statistics" aria-label="Classification totals">
      {ITEMS.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={active === item.id ? 'stat is-active' : 'stat'}
          onClick={() => onSelect(item.id)}
          onMouseEnter={() => labels.current[item.id]?.play()}
          onFocus={() => labels.current[item.id]?.play()}
          aria-pressed={active === item.id}
        >
          <span className="stat-index mono">{String(index + 1).padStart(2, '0')}</span>
          <span className="stat-value display">{padCount(counts[item.countKey])}</span>
          <span className="stat-label mono">
            <LineHoverText
              ref={(node) => {
                labels.current[item.id] = node
              }}
              text={item.label}
            />
          </span>
        </button>
      ))}
    </section>
  )
}
