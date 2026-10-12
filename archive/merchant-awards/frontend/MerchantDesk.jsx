import { useEffect, useState } from 'react'
import { apiFetch } from '../../../frontend/src/api.js'
import './awards.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function text(value) {
  const shown = value == null ? '' : String(value).trim()
  return shown || 'Unavailable'
}

function formatDate(value) {
  const raw = value == null ? '' : String(value).trim()
  if (!raw) return 'Unavailable'
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) return `${Number(iso[3])} ${MONTHS[Number(iso[2]) - 1]} ${iso[1]}`
  const written = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw)
  if (written) {
    const month = `${written[2].slice(0, 1).toUpperCase()}${written[2].slice(1).toLowerCase()}`
    return `${Number(written[1])} ${month} ${written[3]}`
  }
  return raw
}

function AwardTable({ records }) {
  return (
    <div className="merchant-table">
      <div className="merchant-head merchant-awards-grid">
        <span>Award notice</span>
        <span>Line item</span>
        <span>Contract amount</span>
        <span>Mode</span>
        <span>Classification</span>
        <span>Publish date</span>
        <span>Award date</span>
        <span>Status</span>
        <span>Category</span>
        <span>Acceptance</span>
        <span>Details</span>
      </div>
      <ol className="merchant-rows">
        {records.map((record) => (
          <li key={record.awardNumber}>
            <div className="merchant-line merchant-awards-grid">
              <span className="mono merchant-id" data-label="Award notice">{record.awardNumber}</span>
              <span className="merchant-title-cell" data-label="Line item">{text(record.lineItem)}</span>
              <span className="merchant-amount" data-label="Contract amount">{text(record.contractAmount)}</span>
              <span data-label="Mode">{text(record.procurementMode)}</span>
              <span data-label="Classification">{text(record.classification)}</span>
              <span className="merchant-date" data-label="Publish date">{formatDate(record.publishedDate)}</span>
              <span className="merchant-date" data-label="Award date">{formatDate(record.awardDate)}</span>
              <span data-label="Status">{text(record.status)}</span>
              <span data-label="Category">{text(record.awardCategory)}</span>
              <span data-label="Acceptance">{text(record.acceptance)}</span>
              <span data-label="Details">
                {record.sourceUrl ? <a href={record.sourceUrl}>View award</a> : 'Unavailable'}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function InvitationTable({ records }) {
  if (!records.length) {
    return (
      <div className="merchant-empty">
        <p className="merchant-empty-title">No invitations retrieved yet.</p>
        <p>PhilGEPS Merchant is not connected. Invitation records will appear here when an authorized retrieval method is available.</p>
      </div>
    )
  }
  return (
    <div className="merchant-table">
      <div className="merchant-head merchant-bids-grid">
        <span>Reference</span>
        <span>Notice title</span>
        <span>Mode</span>
        <span>Classification</span>
        <span>Approved budget</span>
        <span>Publish date</span>
        <span>Closing date</span>
        <span>Agency</span>
        <span>Status</span>
        <span>Details</span>
      </div>
      <ol className="merchant-rows">
        {records.map((record) => (
          <li key={record.noticeReference}>
            <div className="merchant-line merchant-bids-grid">
              <span className="mono" data-label="Reference">{text(record.noticeReference)}</span>
              <span data-label="Notice title">{text(record.title)}</span>
              <span data-label="Mode">{text(record.procurementMode)}</span>
              <span data-label="Classification">{text(record.classification)}</span>
              <span data-label="Approved budget">{text(record.approvedBudget)}</span>
              <span data-label="Publish date">{text(record.publishedDate)}</span>
              <span data-label="Closing date">{text(record.closingDate)}</span>
              <span data-label="Agency">{text(record.agency)}</span>
              <span data-label="Status">{text(record.status)}</span>
              <span data-label="Details">
                {record.sourceUrl ? <a href={record.sourceUrl}>View notice</a> : 'Unavailable'}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function MerchantDesk() {
  const [tab, setTab] = useState('awards')
  const [awards, setAwards] = useState(null)
  const [invitations, setInvitations] = useState(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    Promise.all([
      apiFetch('/api/awards/merchant'),
      apiFetch('/api/awards/invitations'),
    ])
      .then(async ([awardResponse, invitationResponse]) => {
        if (!awardResponse.ok || !invitationResponse.ok) throw new Error('Unable to load Merchant views')
        const awardBody = await awardResponse.json()
        const invitationBody = await invitationResponse.json()
        if (cancelled) return
        setAwards(awardBody)
        setInvitations(invitationBody)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connection = awards?.connection || invitations?.connection
  const active = tab === 'awards' ? awards : invitations

  return (
    <div className="merchant-desk">
      <p className="merchant-connection mono" role="status">{connection?.label || 'PhilGEPS Merchant — Not connected'}</p>
      <header className="merchant-hero">
        <div>
          <p className="mono merchant-kicker">Trustera Solutions, Inc.</p>
          <h1 className="display merchant-title">Merchant account.</h1>
        </div>
        <p>A read-only view of My Award Notices and Invitation to Bid. PhilGEPS is not connected.</p>
      </header>

      <nav className="ledger-views" aria-label="Merchant views">
        <button type="button" className={tab === 'awards' ? 'is-on' : ''} aria-pressed={tab === 'awards'} onClick={() => setTab('awards')}>My Award Notices</button>
        <button type="button" className={tab === 'bids' ? 'is-on' : ''} aria-pressed={tab === 'bids'} onClick={() => setTab('bids')}>Invitation to Bid</button>
      </nav>

      {state === 'loading' ? <p className="state-line mono">Loading Merchant views...</p> : null}
      {state === 'error' ? <p className="state-line mono">Unable to load Merchant views.</p> : null}

      {state === 'ready' && active ? (
        <section aria-labelledby="merchant-view-title">
          <h2 id="merchant-view-title" className="visually-hidden">{tab === 'awards' ? 'My Award Notices' : 'Invitation to Bid'}</h2>
          {tab === 'awards' ? <p className="merchant-provenance">{active.provenanceLabel}</p> : null}
          {tab === 'awards' ? <AwardTable records={awards.records || []} /> : <InvitationTable records={invitations.records || []} />}
        </section>
      ) : null}
    </div>
  )
}
