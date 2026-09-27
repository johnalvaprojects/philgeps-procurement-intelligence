import { useRef } from 'react'
import LineHoverText from './LineHoverText.jsx'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'software', label: 'Software' },
  { id: 'review', label: 'Review' },
  { id: 'not relevant', label: 'Not Relevant' },
]

export default function NoticeFilters({ query, onQueryChange, active, onSelect }) {
  const labels = useRef({})

  return (
    <div className="filters">
      <label className="search">
        <span className="mono">Search</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Reference, title, or organization"
        />
      </label>
      <div className="filter-group" role="group" aria-label="Classification filter">
        {FILTERS.map((filter, index) => (
          <span key={filter.id} className="filter-item">
            {index > 0 ? <span className="filter-slash" aria-hidden="true">/</span> : null}
            <button
              type="button"
              className={active === filter.id ? 'filter mono is-active' : 'filter mono'}
              onClick={() => onSelect(filter.id)}
              onMouseEnter={() => labels.current[filter.id]?.play()}
              onFocus={() => labels.current[filter.id]?.play()}
              aria-pressed={active === filter.id}
            >
              <LineHoverText
                ref={(node) => {
                  labels.current[filter.id] = node
                }}
                text={filter.label}
              />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
