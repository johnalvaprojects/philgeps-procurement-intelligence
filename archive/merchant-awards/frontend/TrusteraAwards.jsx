import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../frontend/src/api.js'
import './awards.css'

const ACCEPTANCE = ['Pending for Acceptance', 'Accepted', 'Refused']
const PAGE_SIZE = 8
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

const DISPLAY_TITLES = {
  22316: 'Software Licenses and Subscription Services',
  22247: 'ChatGPT Plus and Grammarly',
  22249: 'Office Equipment (Canva PRO)',
  29475: 'Canva Pro Subscription for CWC Offices',
  16776: 'Zoom Subscription for AI Support Tools',
}

function unavailable(value) {
  const text = value == null ? '' : String(value).trim()
  return text || 'Unavailable'
}

function acceptanceClass(acceptance) {
  if (acceptance === 'Accepted') return 'is-accepted'
  if (acceptance === 'Refused') return 'is-refused'
  return 'is-pending'
}

function acceptanceLabel(acceptance) {
  if (acceptance === 'Pending for Acceptance') return 'Pending'
  if (acceptance === 'Accepted') return 'Accepted'
  if (acceptance === 'Refused') return 'Refused'
  return 'Unavailable'
}

function displayTitle(record) {
  return DISPLAY_TITLES[record.awardNumber] || record.lineItem || 'Line item unavailable'
}

function awardTime(value) {
  const text = value == null ? '' : String(value).trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  const written = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text)
  if (written) {
    const month = MONTH_INDEX[written[2].toLowerCase()]
    if (month != null) return Date.UTC(Number(written[3]), month, Number(written[1]))
  }
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? 0 : parsed
}

function formatAwardDate(value) {
  const text = value == null ? '' : String(value).trim()
  if (!text) return 'Unavailable'
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[3]} ${MONTHS[Number(iso[2]) - 1]} ${iso[1]}`
  const written = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text)
  if (written) return `${written[1].padStart(2, '0')} ${written[2]} ${written[3]}`
  return text
}

function latestVerified(records) {
  const times = records
    .map((record) => Date.parse(record.verifiedAt || ''))
    .filter((time) => !Number.isNaN(time))
  if (!times.length) return null
  return new Date(Math.max(...times))
}

function formatVerified(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)
  const pick = (type) => parts.find((part) => part.type === type)?.value || ''
  const day = `${pick('day')} ${pick('month')} ${pick('year')}`.toUpperCase()
  const time = `${pick('hour')}:${pick('minute')} ${pick('dayPeriod')}`.toUpperCase()
  return { day, time }
}

export default function TrusteraAwards() {
  const [records, setRecords] = useState([])
  const [summary, setSummary] = useState(null)
  const [state, setState] = useState('loading')
  const [query, setQuery] = useState('')
  const [acceptance, setAcceptance] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState('Pending for Acceptance')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const response = await apiFetch('/api/awards/merchant')
    if (!response.ok) throw new Error('Unable to load Trustera awards')
    return response.json()
  }

  useEffect(() => {
    let cancelled = false
    setState('loading')
    load()
      .then((body) => {
        if (cancelled) return
        setRecords(body.records || [])
        setSummary(body.summary || null)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = records.filter((record) => {
      if (acceptance !== 'all' && record.acceptance !== acceptance) return false
      if (!needle) return true
      return [
        record.awardNumber,
        record.lineItem,
        displayTitle(record),
        record.supplier,
        record.noticeReference,
        record.agency,
      ].join(' ').toLowerCase().includes(needle)
    })
    matched.sort((left, right) => {
      const delta = awardTime(left.awardDate) - awardTime(right.awardDate)
      if (delta !== 0) return sort === 'oldest' ? delta : -delta
      return String(right.awardNumber).localeCompare(String(left.awardNumber))
    })
    return matched
  }, [records, query, acceptance, sort])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const verified = latestVerified(records)
  const verifiedLabel = verified ? formatVerified(verified) : null
  const counts = {
    all: records.length,
    pending: records.filter((record) => record.acceptance === 'Pending for Acceptance').length,
    accepted: records.filter((record) => record.acceptance === 'Accepted').length,
    refused: records.filter((record) => record.acceptance === 'Refused').length,
  }

  function chooseAcceptance(value) {
    setAcceptance(value)
    setPage(1)
  }

  function openRecord(record) {
    const next = openId === record.awardNumber ? null : record.awardNumber
    setOpenId(next)
    setDraft(record.acceptance || 'Pending for Acceptance')
    setError('')
  }

  async function save(record) {
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch(`/api/awards/merchant/${record.awardNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptance: draft }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || 'Unable to update this award.')
        return
      }
      setRecords((current) => current.map((item) => (item.awardNumber === body.awardNumber ? body : item)))
    } catch {
      setError('Unable to update this award.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ledger ledger-company">
      <header className="company-hero">
        <div className="company-brand">
          <p className="mono company-kicker">Trustera Solutions, Inc.</p>
          <h1 className="display company-title">Trustera awards.</h1>
        </div>
        <p className="company-deck">
          Contracts confirmed on the company Merchant list, kept apart from the public award bulletin.
        </p>
        <p className="mono company-updated">
          <span>Last updated</span>
          {verifiedLabel ? (
            <>
              <span>{verifiedLabel.day}</span>
              <span>{verifiedLabel.time}</span>
            </>
          ) : (
            <span>{state === 'loading' ? '···' : 'Unavailable'}</span>
          )}
        </p>
      </header>

      <section className="company-stats" aria-label="Trustera award totals">
        <div className="company-stat is-primary">
          <span className="mono">Published contract value</span>
          <span className="company-stat-value">{summary ? summary.contractValue : '···'}</span>
        </div>
        <div className="company-stat">
          <span className="mono">Awards</span>
          <span className="company-stat-value">{summary ? String(summary.awards).padStart(2, '0') : '···'}</span>
        </div>
        <div className="company-stat">
          <span className="mono">Pending acceptance</span>
          <span className="company-stat-value">{summary ? String(summary.pending).padStart(2, '0') : '···'}</span>
        </div>
        <div className="company-stat">
          <span className="mono">Accepted</span>
          <span className="company-stat-value">{summary ? String(summary.accepted).padStart(2, '0') : '···'}</span>
        </div>
      </section>

      <section className="company-register" aria-labelledby="truster-title">
        <h2 id="truster-title" className="visually-hidden">Company register</h2>
        <div className="company-tools">
          <label className="company-search">
            <span className="visually-hidden">Search</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M10.2 10.2 13.5 13.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <input
              value={query}
              placeholder="Search award number, reference, or agency..."
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <div className="company-filters" role="group" aria-label="Award acceptance">
            <button type="button" aria-pressed={acceptance === 'all'} className={acceptance === 'all' ? 'is-on' : ''} onClick={() => chooseAcceptance('all')}>
              All ({counts.all})
            </button>
            <button type="button" aria-pressed={acceptance === 'Pending for Acceptance'} className={acceptance === 'Pending for Acceptance' ? 'is-on' : ''} onClick={() => chooseAcceptance('Pending for Acceptance')}>
              Pending ({counts.pending})
            </button>
            <button type="button" aria-pressed={acceptance === 'Accepted'} className={acceptance === 'Accepted' ? 'is-on' : ''} onClick={() => chooseAcceptance('Accepted')}>
              Accepted ({counts.accepted})
            </button>
            <button type="button" aria-pressed={acceptance === 'Refused'} className={acceptance === 'Refused' ? 'is-on' : ''} onClick={() => chooseAcceptance('Refused')}>
              Refused ({counts.refused})
            </button>
          </div>
          <label className="company-sort">
            <span className="mono">Sort by</span>
            <select
              value={sort}
              aria-label="Sort by award date"
              onChange={(event) => {
                setSort(event.target.value)
                setPage(1)
              }}
            >
              <option value="newest">Award date</option>
              <option value="oldest">Award date, oldest</option>
            </select>
          </label>
        </div>

        {state === 'loading' ? <p className="state-line mono">Loading Trustera awards...</p> : null}
        {state === 'error' ? <p className="state-line mono">Unable to load Trustera awards.</p> : null}
        {state === 'ready' && visible.length === 0 ? <p className="state-line mono">No Trustera awards match this view.</p> : null}

        {state === 'ready' && visible.length > 0 ? (
          <div className="company-table">
            <div className="company-head">
              <span>#</span>
              <span>Project / Agency</span>
              <span>Reference</span>
              <span>Contract amount</span>
              <span>Award date</span>
              <span>Acceptance</span>
              <span>Status</span>
              <span className="visually-hidden">Details</span>
            </div>
            <ol className="ledger-rows">
            {pageRows.map((record, index) => {
              const open = openId === record.awardNumber
              const rowNumber = (currentPage - 1) * PAGE_SIZE + index + 1
              return (
                <li key={record.awardNumber} className={open ? 'is-open' : ''}>
                  <button type="button" className="ledger-row company-line" aria-expanded={open} onClick={() => openRecord(record)}>
                    <span className="mono company-idx">{String(rowNumber).padStart(2, '0')}</span>
                    <span className="company-project">
                      <span className="ledger-name">{displayTitle(record)}</span>
                      <span className="mono company-agency">{unavailable(record.agency)}</span>
                    </span>
                    <span className="mono company-ref">{unavailable(record.noticeReference)}</span>
                    <span className="company-amount">{unavailable(record.contractAmount)}</span>
                    <span className="company-dates">
                      <span>{formatAwardDate(record.awardDate)}</span>
                      <span className="mono">Published {formatAwardDate(record.publishedDate)}</span>
                    </span>
                    <span className={`ledger-acceptance company-accept ${acceptanceClass(record.acceptance)}`}>
                      <span className="mono">{acceptanceLabel(record.acceptance)}</span>
                    </span>
                    <span className="company-status">{record.status || 'Unavailable'}</span>
                    <span className="company-arrow" aria-hidden="true">{open ? '⌃' : '>'}</span>
                  </button>
                  {open ? (
                    <div className="ledger-detail">
                      <dl className="ledger-facts">
                        <div>
                          <dt>Project</dt>
                          <dd>{unavailable(record.lineItem)}</dd>
                        </div>
                        <div>
                          <dt>Supplier</dt>
                          <dd>{unavailable(record.supplier)}</dd>
                        </div>
                        <div>
                          <dt>Award number</dt>
                          <dd className="mono">{unavailable(record.awardNumber)}</dd>
                        </div>
                        <div>
                          <dt>Notice reference</dt>
                          <dd className={record.noticeReference ? 'mono' : undefined}>{unavailable(record.noticeReference)}</dd>
                        </div>
                        <div>
                          <dt>Agency</dt>
                          <dd>{unavailable(record.agency)}</dd>
                        </div>
                        <div>
                          <dt>Procurement mode</dt>
                          <dd>{unavailable(record.procurementMode)}</dd>
                        </div>
                        <div>
                          <dt>Approved budget</dt>
                          <dd>{unavailable(record.approvedBudget)}</dd>
                        </div>
                        <div>
                          <dt>Contract amount</dt>
                          <dd>{unavailable(record.contractAmount)}</dd>
                        </div>
                        <div>
                          <dt>Award date</dt>
                          <dd>{formatAwardDate(record.awardDate)}</dd>
                        </div>
                        <div>
                          <dt>Published date</dt>
                          <dd>{formatAwardDate(record.publishedDate)}</dd>
                        </div>
                        <div>
                          <dt>Acceptance</dt>
                          <dd>{unavailable(record.acceptance)}</dd>
                        </div>
                        <div>
                          <dt>Official record</dt>
                          <dd>
                            {record.sourceUrl ? (
                              <a href={record.sourceUrl}>View award notice</a>
                            ) : 'Unavailable'}
                          </dd>
                        </div>
                        <div>
                          <dt>Verified</dt>
                          <dd className="mono">{unavailable(record.verifiedAt)}</dd>
                        </div>
                      </dl>
                      <form
                        className="ledger-update"
                        onSubmit={(event) => {
                          event.preventDefault()
                          save(record)
                        }}
                      >
                        <label>
                          <span className="mono">Acceptance</span>
                          <select value={draft} onChange={(event) => setDraft(event.target.value)}>
                            {ACCEPTANCE.map((value) => <option key={value} value={value}>{value}</option>)}
                          </select>
                        </label>
                        <button type="submit" className="ledger-batch-action" disabled={saving}>
                          {saving ? 'Saving' : 'Save verification'}
                        </button>
                        {error ? <p className="ledger-quiet" role="alert">{error}</p> : null}
                      </form>
                      {record.history?.length ? (
                        <div>
                          <p className="mono ledger-detail-kicker">Previous verification</p>
                          <ul className="ledger-history">
                            {record.history.map((entry) => (
                              <li key={`${entry.verifiedAt}-${entry.acceptance}`}>
                                <span className="mono">{entry.verifiedAt}</span>
                                <span>{entry.acceptance}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
            </ol>
            <footer className="company-foot">
              <span className="mono">Trustera awards</span>
              <span className="mono">{String(visible.length).padStart(3, '0')} records</span>
              <div className="company-pager">
                <button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>&lt;</button>
                <span>{currentPage}</span>
                <button type="button" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>&gt;</button>
              </div>
            </footer>
          </div>
        ) : null}
      </section>
    </div>
  )
}
