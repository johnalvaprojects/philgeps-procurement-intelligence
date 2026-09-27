import { useRef } from 'react'
import { padCount } from '../format.js'
import LineHoverText from './LineHoverText.jsx'
import OpportunityCard from './OpportunityCard.jsx'

export default function FeaturedOpportunities({ notices, total, state, onOpen, onViewAll }) {
  const viewAllRef = useRef(null)
  return (
    <section className="featured" aria-labelledby="featured-title">
      <div className="section-rule">
        <h2 id="featured-title" className="mono">Selected / Software</h2>
        <button
          type="button"
          className="text-link mono"
          onClick={onViewAll}
          onMouseEnter={() => viewAllRef.current?.play()}
          onFocus={() => viewAllRef.current?.play()}
        >
          <LineHoverText ref={viewAllRef} text={`View all software / ${padCount(total)}`} />
          <span aria-hidden="true">→</span>
        </button>
      </div>

      {state === 'loading' ? <p className="state-line mono">Loading notices...</p> : null}
      {state === 'error' ? <p className="state-line mono">Unable to load notices.</p> : null}
      {state === 'ready' && notices.length === 0 ? (
        <p className="state-line mono">No software opportunities identified yet.</p>
      ) : null}

      {state === 'ready' && notices.length > 0 ? (
        <div className={`featured-grid count-${Math.min(notices.length, 5)}`}>
          {notices.map((notice, index) => (
            <OpportunityCard
              key={notice.referenceNumber}
              notice={notice}
              onOpen={onOpen}
              lead={index === 0}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
