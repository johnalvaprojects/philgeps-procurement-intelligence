import { useEffect, useState } from 'react'
import { displayText, formatDateLabel, formatPeso, reviewStatusLabel, sourceLabel } from '../format.js'
import ClassificationControls from './ClassificationControls.jsx'
import NoticeDocuments from './NoticeDocuments.jsx'
import ProcurementRequirements from './ProcurementRequirements.jsx'
import StatusBadge from './StatusBadge.jsx'
import WorkStatusControls from './WorkStatusControls.jsx'
import { effectiveWorkStatus } from '../notices.js'

function textValue(value) {
  const text = value == null ? '' : String(value).trim()
  return text || null
}

function secondaryFacts(packet) {
  const procurement = packet.procurementDocument || {}
  const delivery = procurement.delivery || {}
  const title = textValue(packet.notice?.title)
  const product = textValue(procurement.productOrService)
  const fields = [
    ['Product or service', product && product !== title ? product : null],
    ['Description', textValue(procurement.description)],
    ['Delivery period', textValue(delivery.period)],
    ['Delivery place', textValue(delivery.place)],
    ['Awarding', textValue(procurement.awarding)],
    ['Payment terms', textValue(procurement.paymentTerms)],
  ]
  return fields.filter(([, value]) => value)
}

export default function NoticeDetails({ noticeId, onBack, onClassified }) {
  const [packet, setPacket] = useState(null)
  const [state, setState] = useState('loading')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savingWork, setSavingWork] = useState(false)
  const [workError, setWorkError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setPacket(null)
    setSaveError('')

    fetch(`/api/notices/${encodeURIComponent(noticeId)}`)
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load notice details')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setPacket(body)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })

    return () => {
      cancelled = true
    }
  }, [noticeId])

  async function saveClassification(value) {
    if (saving) return
    setSaving(true)
    setSaveError('')
    try {
      const response = await fetch(`/api/notices/${encodeURIComponent(noticeId)}/classification`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classification: value }),
      })
      if (!response.ok) throw new Error('Unable to update classification')
      const updated = await response.json()
      setPacket((current) => ({
        ...current,
        classification: updated.classification,
        classificationSource: updated.classificationSource,
        reviewed: updated.reviewed,
        reviewedAt: updated.reviewedAt,
        review: updated.review ?? current?.review,
        workStatus: updated.workStatus ?? current?.workStatus,
      }))
      onClassified(updated)
    } catch {
      setSaveError('Unable to update classification.')
    } finally {
      setSaving(false)
    }
  }

  async function saveWorkStatus(value) {
    if (savingWork) return
    setSavingWork(true)
    setWorkError('')
    try {
      const response = await fetch(`/api/notices/${encodeURIComponent(noticeId)}/work-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workStatus: value }),
      })
      if (!response.ok) throw new Error('Unable to update work status')
      const updated = await response.json()
      setPacket((current) => ({
        ...current,
        workStatus: updated.workStatus,
      }))
      onClassified(updated)
    } catch {
      setWorkError('Unable to update work status.')
    } finally {
      setSavingWork(false)
    }
  }

  const notice = packet?.notice || {}
  const extra = packet ? secondaryFacts(packet) : []

  return (
    <article className="dossier" aria-labelledby="dossier-title">
      <header className="dossier-bar">
        <button type="button" className="back-link mono" onClick={onBack} data-autofocus>
          <span aria-hidden="true">← </span>Back to notices
        </button>
        <p className="mono dossier-case">Case / {displayText(noticeId)}</p>
        {packet ? (
          <StatusBadge classification={packet.classification} source={packet.classificationSource} />
        ) : null}
      </header>

      {state === 'loading' ? <p className="state-line mono">Loading notice details...</p> : null}
      {state === 'error' ? <p className="state-line mono">Unable to load notice details.</p> : null}

      {state === 'ready' && packet ? (
        <>
          <div className="dossier-lead">
            <h2 id="dossier-title" className="display dossier-title">
              {displayText(notice.title)}
            </h2>
            <p className="dossier-abc">
              <span className="mono">Approved budget</span>
              <span className="display">{formatPeso(notice.abc)}</span>
            </p>
          </div>

          <div className="dossier-grid">
            <section className="dossier-block" aria-labelledby="org-title">
              <h3 id="org-title" className="mono">Organization</h3>
              <p className="dossier-org">{displayText(notice.organization)}</p>
              {notice.url ? (
                <a className="text-link mono" href={notice.url} target="_blank" rel="noopener noreferrer">
                  View on PhilGEPS <span aria-hidden="true">↗</span>
                </a>
              ) : null}
            </section>

            <section className="dossier-block" aria-labelledby="info-title">
              <h3 id="info-title" className="mono">Procurement info</h3>
              <dl className="facts">
                <div>
                  <dt className="mono">Published</dt>
                  <dd>{formatDateLabel(notice.postedDate)}</dd>
                </div>
                <div>
                  <dt className="mono">Closing</dt>
                  <dd>{formatDateLabel(notice.deadline)}</dd>
                </div>
                <div>
                  <dt className="mono">Source</dt>
                  <dd>{sourceLabel(packet.classificationSource)}</dd>
                </div>
                <div>
                  <dt className="mono">Review</dt>
                  <dd>{reviewStatusLabel(packet)}</dd>
                </div>
                {extra.map(([label, value]) => (
                  <div key={label} className="fact-wide">
                    <dt className="mono">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <NoticeDocuments noticeId={noticeId} />

          {packet.classification === 'software' ? (
            <ProcurementRequirements
              requirements={packet.extractedRequirements}
              noticeId={noticeId}
            />
          ) : null}

          <section className="dossier-block classification" aria-labelledby="classification-title">
            <h3 id="classification-title" className="mono">Classification</h3>
            <ClassificationControls
              current={packet.classification}
              saving={saving}
              error={saveError}
              onChoose={saveClassification}
            />
          </section>
          {packet.classification === 'software' ? (
            <section className="dossier-block work-status" aria-labelledby="work-status-title">
              <h3 id="work-status-title" className="mono">Work status</h3>
              <WorkStatusControls
                current={effectiveWorkStatus(packet)}
                saving={savingWork}
                error={workError}
                onChoose={saveWorkStatus}
              />
            </section>
          ) : null}
        </>
      ) : null}
    </article>
  )
}
