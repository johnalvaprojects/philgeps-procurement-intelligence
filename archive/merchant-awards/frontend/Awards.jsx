import { useEffect, useMemo, useState } from 'react'
import OpportunityPager from '../../../frontend/src/components/OpportunityPager.jsx'
import { formatDetailDate, formatPeso, padCount } from '../../../frontend/src/format.js'
import { apiFetch } from '../../../frontend/src/api.js'
import './awards.css'

const PAGE_SIZE = 25

const STATUS_FILTERS = [
  ['checked', 'Checked'],
  ['published', 'Published'],
  ['none', 'None found'],
  ['failed', 'Failed'],
  ['conflict', 'Conflict'],
]

function supplierStandingLabel(standing) {
  if (standing === 'truster') return 'Awarded to Trustera'
  if (standing === 'other') return 'Awarded to another supplier'
  if (standing === 'mixed') return 'Mixed suppliers'
  if (standing === 'unverified') return 'Supplier unverified'
  if (standing === 'none') return 'No published award'
  if (standing === 'failed') return 'Failed or unverified'
  if (standing === 'conflict') return 'Conflict'
  return 'Not checked'
}

function statusHeadline(outcome) {
  if (outcome === 'published') return 'Published'
  if (outcome === 'none') return 'No published award found'
  if (outcome === 'failed') return 'Check failed'
  if (outcome === 'conflict') return 'Conflicting record'
  return 'Not checked yet'
}

function scopeName(scope) {
  if (scope === 'review') return 'Review'
  if (scope === 'all') return 'All notices'
  return 'Software'
}

function scopeLabel(scope) {
  if (scope === 'review') return 'review'
  if (scope === 'all') return 'saved'
  return 'software'
}

function classificationLabel(value) {
  if (value === 'software') return 'Software'
  if (value === 'review') return 'Review'
  if (value === 'not relevant' || value === 'not-relevant') return 'Not relevant'
  if (!value) return ''
  return String(value)
}

function byLastChecked(left, right) {
  return String(right.lastCheckedAt || '').localeCompare(String(left.lastCheckedAt || ''))
}

function summarizeBatch(results) {
  const count = (outcome) => results.filter((item) => item.outcome === outcome).length
  return `${count('published')} published · ${count('none')} no result · ${count('failed')} failed · ${count('conflict')} conflict`
}

function metricValue(state, count) {
  if (state !== 'ready') return '···'
  return padCount(count || 0)
}

function manilaStamp(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const dateText = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(date)
  const timeText = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  }).format(date)
  return { dateText, timeText }
}

function addedLabel(value) {
  const text = value == null ? '' : String(value).trim()
  if (!text) return 'Not recorded'
  const formatted = formatDetailDate(text)
  if (!formatted || formatted === '\u2014') return 'Not recorded'
  return formatted.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?$/, '')
}

function scopeDetail(record, scope) {
  const classified = classificationLabel(record.classification)
  if (classified) return classified
  if (scope === 'software' || scope === 'review') return scopeName(scope)
  return 'Not recorded'
}

function AwardDetail({ record, staff, scope }) {
  const awards = record.awards || []
  const checked = manilaStamp(record.lastCheckedAt)
  return (
    <div className="ledger-detail">
      <dl className="ledger-facts">
        <div>
          <dt>Bid reference</dt>
          <dd className="mono">{record.referenceNumber}</dd>
        </div>
        <div>
          <dt>Agency</dt>
          <dd>{record.organization || 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{scopeDetail(record, scope)}</dd>
        </div>
        <div>
          <dt>Date added</dt>
          <dd>{addedLabel(record.postedDate)}</dd>
        </div>
      </dl>
      <div className="ledger-status-copy">
        <p className="mono ledger-detail-kicker">{statusHeadline(record.outcome)}</p>
        {record.outcome === 'none' ? (
          <p>No published award was found for this bid reference based on the latest PhilGEPS award bulletin search.</p>
        ) : null}
        {record.outcome === 'failed' ? (
          <p>The last check could not be completed. Earlier confirmed awards are unchanged.</p>
        ) : null}
        {record.outcome === 'conflict' ? (
          <p>A public record did not match this bid reference and was not saved as an award.</p>
        ) : null}
        {staff && record.error ? <p>{record.error}</p> : null}
        <p className="mono ledger-checked-line">
          {checked ? `Last checked ${checked.dateText}, ${checked.timeText}` : 'No check performed'}
        </p>
      </div>
      {awards.map((award) => (
        <article className="ledger-award" key={award.awardNumber}>
          <p className="mono ledger-detail-kicker">Award {award.awardNumber}</p>
          <h3>{award.supplier || 'Supplier unverified'}</h3>
          <p className="mono">{supplierStandingLabel(award.supplierStanding)}</p>
          <p className="ledger-amount">{award.contractAmount ? formatPeso(award.contractAmount) : 'Amount not recorded'}</p>
          <p className="mono">
            {award.awardDate ? formatDetailDate(award.awardDate) : 'Award date not recorded'}
            {' · '}
            {award.publishedDate ? `Published ${formatDetailDate(award.publishedDate)}` : 'Publication date not recorded'}
            {award.status ? ` · ${award.status}` : ''}
          </p>
          {award.title ? <p>{award.title}</p> : null}
          {award.sourceUrl ? (
            <a className="ledger-source" href={award.sourceUrl} target="_blank" rel="noopener noreferrer">
              View on PhilGEPS
            </a>
          ) : <p className="mono">Official source not recorded</p>}
        </article>
      ))}
      {record.truncated ? <p>The public search page may list more awards than were returned.</p> : null}
    </div>
  )
}

function BatchStrip({ batch, scope, staff, error, onClick }) {
  const running = Boolean(batch?.running)
  const total = Number(batch?.total) || 0
  const completed = Number(batch?.completed) || 0
  const summary = !running && batch?.results?.length ? summarizeBatch(batch.results) : ''
  const fraction = running && total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
  const progressText = running
    ? `Checking ${completed} of ${total}${batch?.current ? ` · bid ${batch.current}` : ''}`
    : (summary || 'Past closing dates first')

  return (
    <section className="ledger-batch" aria-labelledby="batch-title">
      <h2 id="batch-title" className="mono">Batch check</h2>
      {staff ? (
        <button type="button" className="ledger-batch-action" onClick={onClick} disabled={running} aria-busy={running}>
          {running ? `Checking ${completed} of ${total}` : `Check 8 ${scopeLabel(scope)} notices`}
        </button>
      ) : (
        <p className="ledger-quiet">Sign in as staff to check notices in this scope.</p>
      )}
      <p className="mono ledger-progress-line" aria-live="polite">{progressText}</p>
      <span
        className="award-batch-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total > 0 ? total : 1}
        aria-valuenow={running ? completed : 0}
        aria-valuetext={running ? `${completed} of ${total} complete` : 'No batch in progress'}
      >
        <span className="award-batch-fill" style={{ width: `${running ? fraction : 0}%` }} />
      </span>
      {error ? <p className="ledger-quiet" role="alert">{error}</p> : null}
    </section>
  )
}

function PublicAwards({ staff = false }) {
  const [overview, setOverview] = useState(null)
  const [state, setState] = useState('loading')
  const [scope, setScope] = useState('software')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('checked')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [openId, setOpenId] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [batch, setBatch] = useState(null)
  const [batchError, setBatchError] = useState('')

  async function loadOverview(nextScope = scope) {
    const response = await apiFetch(`/api/awards?scope=${encodeURIComponent(nextScope)}`)
    if (!response.ok) throw new Error('Unable to load awards')
    return response.json()
  }

  useEffect(() => {
    let cancelled = false
    setState('loading')
    loadOverview(scope)
      .then((body) => {
        if (cancelled) return
        setOverview(body)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [scope])

  useEffect(() => {
    if (!staff) return undefined
    let stopped = false
    apiFetch('/api/awards/batch')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!stopped && body) setBatch(body)
      })
      .catch(() => {})
    return () => {
      stopped = true
    }
  }, [staff])

  useEffect(() => {
    if (!staff || !batch?.running) return undefined
    let stopped = false
    let timer = 0

    async function poll() {
      try {
        const response = await apiFetch('/api/awards/batch')
        if (!response.ok || stopped) return
        const body = await response.json()
        if (stopped) return
        setBatch(body)
        if (body.running) {
          timer = window.setTimeout(poll, 2000)
          return
        }
        const next = await loadOverview(scope)
        if (!stopped) setOverview(next)
      } catch {
        if (!stopped) timer = window.setTimeout(poll, 2000)
      }
    }

    timer = window.setTimeout(poll, 2000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [staff, batch?.running, scope])

  async function startBatch() {
    if (batch?.running) return
    setBatchError('')
    try {
      const response = await apiFetch('/api/awards/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 8, scope }),
      })
      const body = await response.json().catch(() => ({}))
      if (response.status === 409) {
        setBatchError('An award check is already running.')
        return
      }
      if (!response.ok) {
        setBatchError(body.error || 'Unable to start the award check.')
        return
      }
      setBatch(body)
      if (!body.running) {
        const next = await loadOverview(scope)
        setOverview(next)
      }
    } catch {
      setBatchError('Unable to start the award check.')
    }
  }

  const totals = overview?.totals
  const records = overview?.records || []
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return records.filter((record) => {
      if (record.outcome === 'never') return false
      if (status !== 'checked' && record.outcome !== status) return false
      if (!needle) return true
      const haystack = [
        record.referenceNumber,
        record.title,
        record.organization,
        ...(record.awards || []).flatMap((award) => [award.awardNumber, award.supplier, award.title]),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    }).sort(byLastChecked)
  }, [records, query, status])

  const recent = useMemo(
    () => records.filter((record) => record.lastCheckedAt).sort(byLastChecked).slice(0, 5),
    [records],
  )

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize) || 1)
  const currentPage = Math.min(page, pageCount)
  const pageRecords = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const showEmpty = state === 'ready' && (totals?.checked ?? 0) === 0 && status === 'checked' && !query.trim()
  const statusName = STATUS_FILTERS.find(([value]) => value === status)?.[1] || 'Checked'

  function chooseScope(next) {
    if (next === scope) return
    setScope(next)
    setPage(1)
    setOpenId(null)
  }

  function chooseStatus(next) {
    setStatus(next)
    setPage(1)
    setOpenId(null)
  }

  function openRecent(reference) {
    setStatus('checked')
    setQuery(reference)
    setPage(1)
    setOpenId(reference)
    setFiltersOpen(true)
  }

  const metrics = [
    ['checked', 'Checked', totals?.checked],
    ['published', 'Published', totals?.published],
    ['none', 'None found', totals?.none],
    ['failed', 'Failed', totals?.failed],
    ['conflict', 'Conflict', totals?.conflict],
  ]

  return (
    <div className="ledger">
      <header className="ledger-mast">
        <div>
          <p className="mono ledger-kicker">Award monitoring</p>
          <h1 id="awards-title" className="display ledger-title">The award ledger.</h1>
        </div>
        <p className="ledger-deck">
          A record of public procurement decisions, winning suppliers, and contract values.
        </p>
      </header>

      <section className="ledger-metrics" aria-label="Award totals">
        {metrics.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={status === id ? 'ledger-metric is-active' : 'ledger-metric'}
            onClick={() => chooseStatus(id)}
            aria-pressed={status === id}
          >
            <span className="display ledger-metric-value">{metricValue(state, count)}</span>
            <span className="mono">{label}</span>
          </button>
        ))}
      </section>

      <section className="ledger-register" aria-labelledby="award-list-title">
        <header className="ledger-register-bar">
          <div>
            <h2 id="award-list-title" className="display">Register</h2>
            <p className="mono">
              {state === 'ready' ? `${padCount(visible.length)} results` : '···'}
              {' · '}
              {scopeName(scope)}
              {' · '}
              {statusName}
              {' · Last checked'}
            </p>
          </div>
          <button
            type="button"
            className="ledger-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="award-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {filtersOpen ? 'Close filters' : 'Search and filter'}
          </button>
        </header>

        <div id="award-filters" className={filtersOpen ? 'ledger-filters is-open' : 'ledger-filters'}>
          <label className="ledger-search">
            <span className="mono">Search</span>
            <input
              value={query}
              placeholder="Reference, title, agency, supplier"
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <div className="ledger-field">
            <span className="mono">Scope</span>
            <div className="ledger-choices" role="group" aria-label="Notice scope">
              <button type="button" className={scope === 'software' ? 'is-on' : ''} onClick={() => chooseScope('software')}>Software</button>
              {staff ? <button type="button" className={scope === 'review' ? 'is-on' : ''} onClick={() => chooseScope('review')}>Review</button> : null}
              <button type="button" className={scope === 'all' ? 'is-on' : ''} onClick={() => chooseScope('all')}>All</button>
            </div>
          </div>
          <div className="ledger-field">
            <span className="mono">Status</span>
            <div className="ledger-choices" role="group" aria-label="Award status">
              {STATUS_FILTERS.map(([value, label]) => (
                <button key={value} type="button" className={status === value ? 'is-on' : ''} onClick={() => chooseStatus(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {state === 'loading' ? <p className="state-line mono">Loading award results...</p> : null}
        {state === 'error' ? <p className="state-line mono">Unable to load award results.</p> : null}
        {showEmpty ? (
          <div className="award-empty">
            <p className="mono award-empty-index">01 / Not checked</p>
            <h3 className="display award-empty-title">No award checks yet.</h3>
            <p>
              Award monitoring looks up each saved bid on the public PhilGEPS award bulletin. A notice stays unchecked until a staff member runs a check.
            </p>
          </div>
        ) : null}
        {state === 'ready' && !showEmpty && visible.length === 0 ? (
          <p className="state-line mono">No award records match this view.</p>
        ) : null}

        {state === 'ready' && !showEmpty ? (
          <ol className="ledger-rows">
            {pageRecords.map((record, index) => {
              const open = openId === record.referenceNumber
              const number = (currentPage - 1) * pageSize + index + 1
              const awardCount = record.awards?.length || 0
              const stamp = manilaStamp(record.lastCheckedAt)
              return (
                <li key={record.referenceNumber} className={open ? 'is-open' : ''}>
                  <button
                    type="button"
                    className="ledger-row"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : record.referenceNumber)}
                  >
                    <span className="mono ledger-index">{String(number).padStart(2, '0')}</span>
                    <span className="ledger-copy">
                      <span className="ledger-name">{record.title || 'Untitled notice'}</span>
                      <span className="mono ledger-meta">
                        {record.referenceNumber}
                        {' · '}
                        {record.organization || 'Agency not recorded'}
                      </span>
                    </span>
                    <span className="ledger-aside">
                      <span className="mono">{supplierStandingLabel(record.supplierStanding)}</span>
                      <span className="mono">
                        {record.outcome === 'published'
                          ? `${awardCount} award notice${awardCount === 1 ? '' : 's'}`
                          : (stamp ? stamp.dateText : 'Not checked')}
                      </span>
                    </span>
                  </button>
                  {open ? <AwardDetail record={record} staff={staff} scope={scope} /> : null}
                </li>
              )
            })}
          </ol>
        ) : null}

        {state === 'ready' && !showEmpty ? (
          <OpportunityPager
            page={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
            total={visible.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        ) : null}
      </section>

      <BatchStrip batch={batch} scope={scope} staff={staff} error={batchError} onClick={startBatch} />

      <section className="ledger-recent" aria-labelledby="recent-title">
        <h2 id="recent-title" className="mono">Recent</h2>
        {recent.length === 0 ? <p className="ledger-quiet">No checks in this scope yet.</p> : (
          <ul className="ledger-activity">
            {recent.map((record) => {
              const stamp = manilaStamp(record.lastCheckedAt)
              return (
                <li key={record.referenceNumber}>
                  <button type="button" onClick={() => openRecent(record.referenceNumber)}>
                    <span className="mono">{stamp ? `${stamp.dateText} ${stamp.timeText}` : 'Not recorded'}</span>
                    <strong>{record.referenceNumber}</strong>
                    <span className="mono">{supplierStandingLabel(record.supplierStanding)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function Awards({ staff = false }) {
  return <PublicAwards staff={staff} />
}
