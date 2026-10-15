import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'

const STATUSES = [
  ['pending', 'Pending for Acceptance'],
  ['accepted', 'Accepted'],
  ['unknown', 'Unknown'],
]

function messageFrom(response, fallback) {
  return response.json()
    .then((body) => body?.error || fallback)
    .catch(() => fallback)
}

function AwardForm({
  prefix,
  initial,
  busy,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}) {
  const [awardNoticeNumber, setAwardNoticeNumber] = useState(initial?.awardNoticeNumber || '')
  const [acceptanceStatus, setAcceptanceStatus] = useState(initial?.acceptanceStatus || 'unknown')
  const numberId = `${prefix}-award-number`
  const statusId = `${prefix}-acceptance`

  return (
    <form
      className="company-award-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          awardNoticeNumber: awardNoticeNumber.trim(),
          acceptanceStatus,
        })
      }}
    >
      <label className="mono" htmlFor={numberId}>Award notice number</label>
      <input
        id={numberId}
        value={awardNoticeNumber}
        onChange={(event) => setAwardNoticeNumber(event.target.value)}
        inputMode="numeric"
        autoComplete="off"
        required
        pattern="[0-9]{1,12}"
      />
      <p className="company-award-hint">Official award notice number. This is not the original notice reference.</p>
      <label className="mono" htmlFor={statusId}>Acceptance status</label>
      <select
        id={statusId}
        value={acceptanceStatus}
        onChange={(event) => setAcceptanceStatus(event.target.value)}
      >
        {STATUSES.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <div className="company-award-actions">
        <button type="submit" className="classify-choice mono" disabled={busy}>
          <span aria-hidden="true">[ </span>
          {busy ? 'Saving' : submitLabel}
          <span aria-hidden="true"> ]</span>
        </button>
        {onCancel ? (
          <button type="button" className="classify-choice mono" onClick={onCancel} disabled={busy}>
            <span aria-hidden="true">[ </span>
            Cancel
            <span aria-hidden="true"> ]</span>
          </button>
        ) : null}
      </div>
      <p className="classify-note mono" aria-live="polite">{error}</p>
    </form>
  )
}

function AwardFacts({ record }) {
  return (
    <dl className="facts company-award-facts">
      <div>
        <dt className="mono">Original notice reference</dt>
        <dd>{record.referenceNumber || record.noticeId}</dd>
      </div>
      <div>
        <dt className="mono">Award notice number</dt>
        <dd>{record.awardNoticeNumber}</dd>
      </div>
      <div>
        <dt className="mono">Acceptance status</dt>
        <dd>{record.acceptanceLabel}</dd>
      </div>
      <div>
        <dt className="mono">Agency</dt>
        <dd>{record.organization || 'Not recorded'}</dd>
      </div>
    </dl>
  )
}

export function CompanyAwardMark({ noticeId, onChanged }) {
  const [record, setRecord] = useState(null)
  const [state, setState] = useState('loading')
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setRecord(null)
    setEditing(false)
    setConfirming(false)
    setError('')
    apiFetch(`/api/company-awards/${encodeURIComponent(noticeId)}`)
      .then(async (response) => {
        if (response.status === 404) return null
        if (!response.ok) throw new Error(await messageFrom(response, 'Unable to load the award marking'))
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setRecord(body)
        setState('ready')
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(loadError.message)
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [noticeId])

  async function save(body) {
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(`/api/company-awards/${encodeURIComponent(noticeId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await messageFrom(response, 'Unable to save the award marking'))
      const saved = await response.json()
      setRecord(saved)
      setEditing(false)
      onChanged?.()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(`/api/company-awards/${encodeURIComponent(noticeId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await messageFrom(response, 'Unable to remove the award marking'))
      setRecord(null)
      setConfirming(false)
      setEditing(false)
      onChanged?.()
    } catch (removeError) {
      setError(removeError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dossier-block company-award" aria-labelledby="company-award-title">
      <h3 id="company-award-title" className="mono">Awarded to us</h3>
      <p className="company-award-note">Internal record. This does not confirm the award on PhilGEPS.</p>
      {state === 'loading' ? <p className="state-line mono">Loading award marking...</p> : null}
      {state === 'error' ? <p className="state-line mono">{error}</p> : null}
      {state === 'ready' && !record && !editing ? (
        <button type="button" className="classify-choice mono" onClick={() => setEditing(true)}>
          <span aria-hidden="true">[ </span>
          Mark as Awarded to Us
          <span aria-hidden="true"> ]</span>
        </button>
      ) : null}
      {state === 'ready' && editing ? (
        <AwardForm
          prefix={`detail-${noticeId}`}
          initial={record}
          busy={busy}
          error={error}
          submitLabel={record ? 'Save changes' : 'Save marking'}
          onSubmit={save}
          onCancel={record ? () => { setEditing(false); setError('') } : () => { setEditing(false); setError('') }}
        />
      ) : null}
      {state === 'ready' && record && !editing ? (
        <>
          <h4 className="company-award-title">{record.title || 'Untitled notice'}</h4>
          <AwardFacts record={record} />
          {record.awardUrl ? (
            <a className="text-link mono" href={record.awardUrl} target="_blank" rel="noopener noreferrer">
              View in PhilGEPS <span aria-hidden="true">↗</span>
            </a>
          ) : null}
          <div className="company-award-actions">
            <button type="button" className="classify-choice mono" onClick={() => { setEditing(true); setConfirming(false) }}>
              <span aria-hidden="true">[ </span>
              Edit
              <span aria-hidden="true"> ]</span>
            </button>
            <button type="button" className="classify-choice mono" onClick={() => setConfirming(true)} disabled={busy}>
              <span aria-hidden="true">[ </span>
              Remove marking
              <span aria-hidden="true"> ]</span>
            </button>
          </div>
          {confirming ? (
            <div className="company-award-confirm">
              <p>Remove this marking? The original notice stays in Notices and Software.</p>
              <div className="company-award-actions">
                <button type="button" className="classify-choice mono" onClick={remove} disabled={busy}>
                  <span aria-hidden="true">[ </span>
                  {busy ? 'Removing' : 'Remove'}
                  <span aria-hidden="true"> ]</span>
                </button>
                <button type="button" className="classify-choice mono" onClick={() => setConfirming(false)} disabled={busy}>
                  <span aria-hidden="true">[ </span>
                  Cancel
                  <span aria-hidden="true"> ]</span>
                </button>
              </div>
            </div>
          ) : null}
          {error ? <p className="classify-note mono" aria-live="polite">{error}</p> : null}
        </>
      ) : null}
    </section>
  )
}

export default function AwardedToUs({ onClose, revision = 0 }) {
  const [records, setRecords] = useState([])
  const [note, setNote] = useState('')
  const [state, setState] = useState('loading')
  const [editingId, setEditingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    apiFetch('/api/company-awards')
      .then(async (response) => {
        if (!response.ok) throw new Error(await messageFrom(response, 'Unable to load awarded notices'))
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setRecords(Array.isArray(body?.records) ? body.records : [])
        setNote(body?.note || '')
        setState('ready')
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(loadError.message)
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  async function save(noticeId, body) {
    setBusyId(noticeId)
    setError('')
    try {
      const response = await apiFetch(`/api/company-awards/${encodeURIComponent(noticeId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await messageFrom(response, 'Unable to save the award marking'))
      const saved = await response.json()
      setRecords((current) => current.map((item) => (item.noticeId === noticeId ? { ...item, ...saved } : item)))
      setEditingId(null)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusyId('')
    }
  }

  async function remove(noticeId) {
    setBusyId(noticeId)
    setError('')
    try {
      const response = await apiFetch(`/api/company-awards/${encodeURIComponent(noticeId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await messageFrom(response, 'Unable to remove the award marking'))
      setRecords((current) => current.filter((item) => item.noticeId !== noticeId))
      setConfirmingId(null)
      setEditingId(null)
    } catch (removeError) {
      setError(removeError.message)
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="company-awards" aria-labelledby="company-awards-title">
      <header className="company-awards-head">
        <div>
          <p className="mono company-awards-kicker">Internal record</p>
          <h1 id="company-awards-title">Awarded to Us</h1>
          <p className="company-award-note">{note || 'These markings are entered by staff. They are not a confirmation from PhilGEPS.'}</p>
        </div>
        <button type="button" className="classify-choice mono" onClick={onClose}>
          <span aria-hidden="true">[ </span>
          Back to notices
          <span aria-hidden="true"> ]</span>
        </button>
      </header>
      {state === 'loading' ? <p className="state-line mono">Loading awarded notices...</p> : null}
      {state === 'error' ? <p className="state-line mono">{error}</p> : null}
      {state === 'ready' && records.length === 0 ? (
        <p className="state-line mono">No notices are marked as awarded to us.</p>
      ) : null}
      {error && state === 'ready' ? <p className="state-line mono">{error}</p> : null}
      {state === 'ready' && records.length > 0 ? (
        <div className="company-award-list">
          {records.map((record) => (
            <article className="company-award-row" key={record.noticeId}>
              <div className="company-award-row-main">
                <p className="mono company-award-ref">Notice {record.referenceNumber || record.noticeId}</p>
                <h2>{record.title || 'Untitled notice'}</h2>
                <p className="company-award-agency">{record.organization || 'Agency not recorded'}</p>
                {record.noticeMissing ? <p className="company-award-hint">The original notice file is no longer in the saved list.</p> : null}
              </div>
              {editingId === record.noticeId ? (
                <AwardForm
                  prefix={`list-${record.noticeId}`}
                  initial={record}
                  busy={busyId === record.noticeId}
                  error={busyId === record.noticeId ? error : ''}
                  submitLabel="Save changes"
                  onSubmit={(body) => save(record.noticeId, body)}
                  onCancel={() => { setEditingId(null); setError('') }}
                />
              ) : (
                <>
                  <AwardFacts record={record} />
                  <div className="company-award-actions">
                    {record.awardUrl ? (
                      <a className="text-link mono" href={record.awardUrl} target="_blank" rel="noopener noreferrer">
                        View in PhilGEPS <span aria-hidden="true">↗</span>
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="classify-choice mono"
                      onClick={() => { setEditingId(record.noticeId); setConfirmingId(null) }}
                    >
                      <span aria-hidden="true">[ </span>
                      Edit
                      <span aria-hidden="true"> ]</span>
                    </button>
                    <button
                      type="button"
                      className="classify-choice mono"
                      onClick={() => setConfirmingId(record.noticeId)}
                      disabled={busyId === record.noticeId}
                    >
                      <span aria-hidden="true">[ </span>
                      Remove marking
                      <span aria-hidden="true"> ]</span>
                    </button>
                  </div>
                  {confirmingId === record.noticeId ? (
                    <div className="company-award-confirm">
                      <p>Remove this marking? The original notice stays in Notices and Software.</p>
                      <div className="company-award-actions">
                        <button type="button" className="classify-choice mono" onClick={() => remove(record.noticeId)} disabled={busyId === record.noticeId}>
                          <span aria-hidden="true">[ </span>
                          {busyId === record.noticeId ? 'Removing' : 'Remove'}
                          <span aria-hidden="true"> ]</span>
                        </button>
                        <button type="button" className="classify-choice mono" onClick={() => setConfirmingId(null)}>
                          <span aria-hidden="true">[ </span>
                          Cancel
                          <span aria-hidden="true"> ]</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
