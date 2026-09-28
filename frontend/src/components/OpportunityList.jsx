import { displayText, formatDateDots, formatPeso, workStatusLabel } from '../format.js'
import { effectiveWorkStatus } from '../notices.js'
import StatusBadge from './StatusBadge.jsx'

export default function OpportunityList({ notices, state, onOpen }) {
  if (state === 'loading') return <p className="state-line mono">Loading notices...</p>
  if (state === 'error') return <p className="state-line mono">Unable to load notices.</p>
  if (notices.length === 0) return <p className="state-line mono">No notices found.</p>

  return (
    <div className="list">
      <div className="list-head mono" aria-hidden="true">
        <span>Ref</span>
        <span>Opportunity</span>
        <span className="list-org">Organization</span>
        <span className="list-abc">ABC</span>
        <span className="list-date">Published</span>
        <span className="list-date list-closing">Closing</span>
        <span>Status</span>
        <span />
      </div>
      <ul className="list-body">
        {notices.map((notice) => {
          const id = notice.referenceNumber
          return (
            <li key={id || notice.title}>
              <button
                type="button"
                className="row"
                onClick={(event) => onOpen(id, event.currentTarget)}
                disabled={!id}
              >
                <span className="row-ref mono">{displayText(id)}</span>
                <span className="row-main">
                  <span className="row-title">{displayText(notice.title)}</span>
                  <span className="row-org">{displayText(notice.organization)}</span>
                </span>
                <span className="row-abc list-abc">{formatPeso(notice.abc)}</span>
                <span className="row-date mono list-date">{formatDateDots(notice.postedDate)}</span>
                <span className="row-date mono list-date list-closing">{formatDateDots(notice.deadline)}</span>
                <span className="row-status">
                  <StatusBadge classification={notice.classification} />
                  {notice.classification === 'software' ? (
                    <span className={`work-mark mono is-${effectiveWorkStatus(notice)}`}>
                      {workStatusLabel(effectiveWorkStatus(notice))}
                    </span>
                  ) : null}
                </span>
                <span className="row-arrow" aria-hidden="true">→</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
