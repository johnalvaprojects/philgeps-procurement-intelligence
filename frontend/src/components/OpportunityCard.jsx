import { displayText, formatDateDots, formatPeso, workStatusLabel } from '../format.js'
import { effectiveWorkStatus } from '../notices.js'
import StatusBadge from './StatusBadge.jsx'

export default function OpportunityCard({ notice, onOpen, lead = false }) {
  const id = notice.referenceNumber
  return (
    <button
      type="button"
      className={lead ? 'card card-lead' : 'card'}
      onClick={(event) => onOpen(id, event.currentTarget)}
      aria-label={`Open notice ${id}: ${displayText(notice.title)}`}
    >
      <span className="card-meta mono">
        <span>Ref / {displayText(id)}</span>
        {notice.classification === 'software' ? (
          <span className={`work-mark mono is-${effectiveWorkStatus(notice)}`}>
            {workStatusLabel(effectiveWorkStatus(notice))}
          </span>
        ) : null}
        <span>{formatDateDots(notice.postedDate)}</span>
      </span>
      <span className="card-title display">{displayText(notice.title)}</span>
      <span className="card-foot">
        <span className="card-abc display">{formatPeso(notice.abc)}</span>
        <span className="card-org">{displayText(notice.organization)}</span>
        <StatusBadge classification={notice.classification} arrow />
      </span>
      <span className="card-accent" aria-hidden="true" />
    </button>
  )
}
