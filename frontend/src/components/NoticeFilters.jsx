import { useRef } from 'react'
import LineHoverText from './LineHoverText.jsx'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'software', label: 'Software' },
  { id: 'review', label: 'Review' },
  { id: 'not relevant', label: 'Not Relevant' },
]

const WORK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
]

export default function NoticeFilters({ query, onQueryChange, active, onSelect, workStatus, onWorkStatus }) {
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
      {active === 'software' ? (
        <div className="filter-group work-filters" role="group" aria-label="Work status filter">
          <span className="mono filter-label">Work status</span>
          {WORK_FILTERS.map((filter, index) => (
            <span key={filter.id} className="filter-item">
              {index > 0 ? <span className="filter-slash" aria-hidden="true">/</span> : null}
              <button
                type="button"
                className={workStatus === filter.id ? 'filter mono is-active' : 'filter mono'}
                onClick={() => onWorkStatus(filter.id)}
                onMouseEnter={() => labels.current[`work-${filter.id}`]?.play()}
                onFocus={() => labels.current[`work-${filter.id}`]?.play()}
                aria-pressed={workStatus === filter.id}
              >
                <LineHoverText
                  ref={(node) => {
                    labels.current[`work-${filter.id}`] = node
                  }}
                  text={filter.label}
                />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
