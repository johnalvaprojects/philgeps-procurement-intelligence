import { useEffect, useState } from 'react'
import { formatLongDate, formatPeso } from '../../../frontend/src/format.js'
import { apiFetch } from '../../../frontend/src/api.js'
import './awards.css'

function outcomeLabel(outcome) {
  if (outcome === 'published') return 'Published award'
  if (outcome === 'none') return 'No published award'
  if (outcome === 'failed') return 'Check failed'
  if (outcome === 'conflict') return 'Conflicting record'
  return 'Not checked'
}

export function checkedLabel(value) {
  if (!value) return 'Not checked'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(date)
}

export function AwardList({ awards, truncated }) {
  if (!awards?.length) return null
  return (
    <div className="award-list">
      {awards.map((award) => (
        <article className="award-record" key={award.awardNumber}>
          <p className="mono award-number">Award {award.awardNumber}</p>
          <h4 className="award-title">{award.title || 'Untitled award'}</h4>
          <dl className="award-facts">
            <div>
              <dt className="mono">Supplier</dt>
              <dd>{award.supplier || 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="mono">Contract amount</dt>
              <dd>{award.contractAmount ? formatPeso(award.contractAmount) : 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="mono">Award date</dt>
              <dd>{award.awardDate ? formatLongDate(award.awardDate) : 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="mono">Published</dt>
              <dd>{award.publishedDate ? formatLongDate(award.publishedDate) : 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="mono">Status</dt>
              <dd>{award.status || 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="mono">Bid reference</dt>
              <dd>{award.bidReference || 'Not recorded'}</dd>
            </div>
          </dl>
          {award.sourceUrl ? (
            <a className="text-link mono" href={award.sourceUrl} target="_blank" rel="noopener noreferrer">
              View award notice <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </article>
      ))}
      {truncated ? <p className="award-note">The public search page may list more awards than were returned.</p> : null}
    </div>
  )
}

export default function AwardPanel({ noticeId, staff = false }) {
  const [record, setRecord] = useState(null)
  const [state, setState] = useState('loading')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setRecord(null)
    setError('')
    apiFetch(`/api/awards/${encodeURIComponent(noticeId)}`)
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load awards')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setRecord(body)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [noticeId])

  async function checkAward() {
    if (checking) return
    setChecking(true)
    setError('')
    try {
      const response = await apiFetch(`/api/awards/${encodeURIComponent(noticeId)}/check`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (response.status === 409) {
        setError('An award check is already running.')
        return
      }
      if (!response.ok) {
        setError(body.error || 'Unable to check this award.')
        return
      }
      setRecord((current) => ({ ...current, ...body }))
      setState('ready')
    } catch {
      setError('Unable to check this award.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <section className="dossier-block award-panel" aria-labelledby="award-panel-title">
      <div className="award-panel-bar">
        <h3 id="award-panel-title" className="mono">Public awards</h3>
        {staff ? (
          <button type="button" className="award-action" onClick={checkAward} disabled={checking}>
            {checking ? 'Checking' : 'Check award'}
          </button>
        ) : null}
      </div>
      {state === 'loading' ? <p className="state-line mono">Loading award results...</p> : null}
      {state === 'error' ? <p className="state-line mono">Unable to load award results.</p> : null}
      {error ? <p className="award-note" role="alert">{error}</p> : null}
      {state === 'ready' && record ? (
        <>
          <p className="award-outcome mono">{outcomeLabel(record.outcome)}</p>
          <p className="award-note">
            {record.lastCheckedAt ? `Last checked ${checkedLabel(record.lastCheckedAt)}.` : 'Not checked yet.'}
          </p>
          {record.outcome === 'failed' && staff && record.error ? <p className="award-note">{record.error}</p> : null}
          {record.outcome === 'none' ? <p>No published award was found for this bid reference.</p> : null}
          {record.outcome === 'never' ? <p>This notice has not been checked against the public award bulletin.</p> : null}
          {record.outcome === 'failed' ? <p>The last check could not be completed. Earlier confirmed awards are unchanged.</p> : null}
          <AwardList awards={record.awards} truncated={record.truncated} />
          {record.conflicts?.length ? (
            <p className="award-note">A public record did not match this bid reference and was not saved as an award.</p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
