import { useRef } from 'react'
import DateField from './DateField.jsx'
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

export default function NoticeFilters({
  query,
  onQueryChange,
  active,
  onSelect,
  workStatus,
  onWorkStatus,
  publishedFrom,
  publishedTo,
  onPublishedFromChange,
  onPublishedToChange,
  onClearPublishedDates,
}) {
  const labels = useRef({})
  const dateActive = Boolean(publishedFrom || publishedTo)

  return (
    <div className="filters manifest">
      <div className="manifest-row">
        <span className="manifest-key mono" id="filter-search-label">Search</span>
        <label className="search" aria-labelledby="filter-search-label">
          <span className="visually-hidden">Search notices</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Reference, title, or organization"
          />
        </label>
      </div>

      <div className="manifest-row" role="group" aria-label="Classification filter">
        <span className="manifest-key mono">Class</span>
        <div className="filter-group">
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

      <div className="manifest-row" role="group" aria-label="Published date filter">
        <span className="manifest-key mono">Date</span>
        <div className="date-filters">
          <DateField
            label="Published from"
            placeholder="From"
            value={publishedFrom}
            onChange={onPublishedFromChange}
          />
          <span className="date-sep" aria-hidden="true">→</span>
          <DateField
            label="Published to"
            placeholder="To"
            value={publishedTo}
            onChange={onPublishedToChange}
          />
          <button
            type="button"
            className={dateActive ? 'filter mono is-active' : 'filter mono'}
            onClick={onClearPublishedDates}
            disabled={!dateActive}
          >
            Clear
          </button>
        </div>
      </div>

      {active === 'software' ? (
        <div className="manifest-row" role="group" aria-label="Work status filter">
          <span className="manifest-key mono">Work</span>
          <div className="filter-group work-filters">
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
        </div>
      ) : null}
    </div>
  )
}
