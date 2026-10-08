import {
  classificationKind,
  displayText,
  formatCompactDate,
  formatPeso,
  workStatusLabel,
} from '../format.js'
import { effectiveWorkStatus } from '../notices.js'
import StatusBadge from './StatusBadge.jsx'

function statusKind(classification) {
  return classificationKind(classification).replaceAll(' ', '-')
}

export default function OpportunityList({ notices, state, onOpen }) {
  if (state === 'loading') return <p className="state-line mono">Loading notices...</p>
  if (state === 'error') return <p className="state-line mono">Unable to load notices.</p>
  if (notices.length === 0) return <p className="state-line mono">No notices found.</p>

  return (
    <div className="list">
      <div className="list-legend mono" aria-hidden="true">
        <span>Ref / Title / Meta</span>
        <span>ABC / Status</span>
      </div>
      <ul className="list-body">
        {notices.map((notice) => {
          const id = notice.referenceNumber
          const kind = statusKind(notice.classification)
          return (
            <li key={id || notice.title}>
              <button
                type="button"
                className={`entry is-${kind}`}
                onClick={(event) => onOpen(id, event.currentTarget)}
                disabled={!id}
              >
                <span className={`entry-rail is-${kind}`} aria-hidden="true" />
                <span className="entry-left">
                  <span className="entry-ref mono">
                    Ref <span className="entry-ref-slash" aria-hidden="true">/</span>{' '}
                    {displayText(id)}
                  </span>
                  <span className="entry-title">{displayText(notice.title)}</span>
                  <span className="entry-meta mono">
                    <span className="entry-org">{displayText(notice.organization)}</span>
                    <span className="entry-meta-sep" aria-hidden="true">·</span>
                    <span className="entry-date">
                      <span className="entry-date-key">Pub</span>{' '}
                      {formatCompactDate(notice.postedDate)}
                    </span>
                    <span className="entry-meta-sep" aria-hidden="true">·</span>
                    <span className="entry-date">
                      <span className="entry-date-key">Close</span>{' '}
                      {formatCompactDate(notice.deadline)}
                    </span>
                  </span>
                </span>
                <span className="entry-right">
                  <span className="entry-abc">
                    <span className="entry-abc-label mono">ABC</span>
                    <span className="entry-abc-value display">{formatPeso(notice.abc)}</span>
                  </span>
                  <span className="entry-status">
                    <StatusBadge classification={notice.classification} />
                    {notice.classification === 'software' ? (
                      <span className={`work-mark mono is-${effectiveWorkStatus(notice)}`}>
                        {workStatusLabel(effectiveWorkStatus(notice))}
                      </span>
                    ) : null}
                  </span>
                  <span className="entry-arrow" aria-hidden="true">→</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
