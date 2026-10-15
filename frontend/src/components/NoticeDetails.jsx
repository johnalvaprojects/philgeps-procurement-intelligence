import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { displayText, formatLongDate, formatPeso, reviewStatusLabel, sourceLabel } from '../format.js'
import CaseReport from '../reports/CaseReport.jsx'
import ClassificationControls from './ClassificationControls.jsx'
import NoticeDocuments from './NoticeDocuments.jsx'
import ProcurementRequirements from './ProcurementRequirements.jsx'
import StatusBadge from './StatusBadge.jsx'
import { CompanyAwardMark } from './CompanyAwards.jsx'
import AwardPanel from '../../../archive/merchant-awards/frontend/AwardPanel.jsx'
import { featureEnabled } from '../../../config/features.js'
import WorkStatusControls from './WorkStatusControls.jsx'
import { effectiveWorkStatus } from '../notices.js'
import { apiFetch } from '../api.js'

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

export default function NoticeDetails({ noticeId, onBack, onClassified, staff = true, companyAwards = false, onAwardChanged }) {
  const [packet, setPacket] = useState(null)
  const [state, setState] = useState('loading')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savingWork, setSavingWork] = useState(false)
  const [workError, setWorkError] = useState('')
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setPacket(null)
    setSaveError('')

    apiFetch(`/api/notices/${encodeURIComponent(noticeId)}`)
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
      const response = await apiFetch(`/api/notices/${encodeURIComponent(noticeId)}/classification`, {
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
      const response = await apiFetch(`/api/notices/${encodeURIComponent(noticeId)}/work-status`, {
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
        <div className="dossier-bar-start">
          <button type="button" className="back-link mono" onClick={onBack} data-autofocus>
            <span aria-hidden="true">← </span>Back to notices
          </button>
          <p className="mono dossier-case">
            Case / {displayText(noticeId)}
            {packet?.portal ? (
              <span className="dossier-case-portal">{packet.portal.label || 'Current PhilGEPS'}</span>
            ) : null}
          </p>
        </div>
        {staff && packet ? (
          <div className="dossier-bar-end">
            <button type="button" className="back-link mono" onClick={() => setPrinting(true)}>
              Print / Save PDF
            </button>
            <StatusBadge classification={packet.classification} source={packet.classificationSource} />
          </div>
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
                  <dd>{formatLongDate(notice.postedDate)}</dd>
                </div>
                <div>
                  <dt className="mono">Closing</dt>
                  <dd>{formatLongDate(notice.deadline)}</dd>
                </div>
                {notice.procurementMode ? (
                  <div>
                    <dt className="mono">Mode</dt>
                    <dd>{displayText(notice.procurementMode)}</dd>
                  </div>
                ) : null}
                {staff ? (
                  <div>
                    <dt className="mono">Source</dt>
                    <dd>{sourceLabel(packet.classificationSource)}</dd>
                  </div>
                ) : null}
                {staff ? (
                  <div>
                    <dt className="mono">Review</dt>
                    <dd>{reviewStatusLabel(packet)}</dd>
                  </div>
                ) : null}
                {extra.map(([label, value]) => (
                  <div key={label} className="fact-wide">
                    <dt className="mono">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          {staff ? (
            <NoticeDocuments
              noticeId={noticeId}
              documentsLoginRequired={packet.documentsLoginRequired === true}
            />
          ) : null}

          {staff && packet.classification === 'software' ? (
            <ProcurementRequirements
              requirements={packet.extractedRequirements}
              noticeId={noticeId}
            />
          ) : null}

          {staff ? <section className="dossier-block classification" aria-labelledby="classification-title">
            <h3 id="classification-title" className="mono">Classification</h3>
            <ClassificationControls
              current={packet.classification}
              saving={saving}
              error={saveError}
              onChoose={saveClassification}
            />
          </section> : null}
          {staff && packet.classification === 'software' ? (
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
          {companyAwards ? <CompanyAwardMark noticeId={noticeId} onChanged={onAwardChanged} /> : null}
          {featureEnabled('awards') ? <AwardPanel noticeId={noticeId} staff={staff} /> : null}
        </>
      ) : null}
      {staff && printing && packet ? createPortal(
        <CaseReport packet={packet} onClose={() => setPrinting(false)} />,
        document.body,
      ) : null}
    </article>
  )
}
