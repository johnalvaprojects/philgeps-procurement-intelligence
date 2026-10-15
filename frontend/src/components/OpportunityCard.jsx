import { displayText, formatCompactDate, formatPeso, workStatusLabel } from '../format.js'
import { effectiveWorkStatus } from '../notices.js'
import StatusBadge from './StatusBadge.jsx'

export default function OpportunityCard({ notice, onOpen, lead = false }) {
  const id = notice.storageId || notice.referenceNumber
  const workStatus = effectiveWorkStatus(notice)
  const unread = notice.unread === true
  return (
    <button
      type="button"
      className={`${lead ? 'card card-lead' : 'card'}${unread ? ' has-unread' : ''}`}
      onClick={(event) => onOpen(id, event.currentTarget)}
      aria-label={`Open notice ${id}: ${displayText(notice.title)}`}
    >
      {unread ? (
        <span className="card-new mono">
          <span>New</span>
        </span>
      ) : null}
      <span className="card-portal mono">{notice.sourceLabel || 'Current PhilGEPS'}</span>
      <span className="card-meta mono">
        <span className="card-ref">Ref / {displayText(notice.referenceNumber || id)}</span>
        {workStatus && workStatus !== 'new' ? (
          <span className={`work-mark mono is-${workStatus}`}>
            {workStatusLabel(workStatus)}
          </span>
        ) : null}
        <span className="card-date">{formatCompactDate(notice.postedDate)}</span>
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
