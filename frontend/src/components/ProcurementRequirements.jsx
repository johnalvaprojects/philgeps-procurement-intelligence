import { useState } from 'react'
import { displayText, formatDetailDate, formatPeso } from '../format.js'
import { buildTechnicalSummary, resolveDocumentLinks } from '../requirements/technical-summary.js'
import { useNoticeDocuments } from '../requirements/useNoticeDocuments.js'

function fieldValue(field) {
  if (field == null) return null
  if (typeof field === 'object' && 'value' in field) {
    const value = field.value
    if (value == null || value === '') return null
    return value
  }
  return field
}

function shortSourceName(source) {
  if (!source) return null
  if (source === 'philgeps-structured') return 'PhilGEPS'
  const base = String(source).split(/[/\\]/).pop()
  if (base.length <= 56) return base
  return `${base.slice(0, 24)}…${base.slice(-24)}`
}

function sourceFullName(source) {
  if (!source) return null
  if (source === 'philgeps-structured') return 'PhilGEPS structured notice fields'
  return String(source).split(/[/\\]/).pop()
}

function documentUrl(noticeId, source) {
  if (!noticeId || !source || source === 'philgeps-structured') return null
  return `/api/notices/${encodeURIComponent(noticeId)}/documents/${encodeURIComponent(source)}`
}

function collectSources(fields, noticeId) {
  const seen = new Map()
  for (const field of fields) {
    if (!field || typeof field !== 'object' || !field.source) continue
    if (seen.has(field.source)) continue
    seen.set(field.source, {
      label: shortSourceName(field.source),
      full: sourceFullName(field.source),
      url: documentUrl(noticeId, field.source),
    })
  }
  return [...seen.values()]
}

function moneyDisplay(value) {
  if (value == null || value === '') return null
  return formatPeso(value)
}

function scopeLabel(field) {
  if (!field || typeof field !== 'object') return null
  const role = field.role || ''
  const scope = field.scope || ''
  if (role === 'document_header_abc' || scope === 'document_header') return 'RFQ Header ABC'
  if (role === 'item_abc' || scope === 'item_table') return 'Item table ABC'
  if (scope === 'philgeps_notice_and_item_table') return 'PhilGEPS + item table'
  if (scope === 'philgeps_notice') return 'PhilGEPS notice'
  if (role === 'preferred_abc') return 'Applicable / Item ABC'
  if (role === 'philgeps_closing') return 'PhilGEPS'
  if (role === 'preferred_document_deadline') return 'RFQ document'
  return null
}

function conflictTitle(fieldPath) {
  if (fieldPath === 'financial.abc') return 'Financial context'
  if (fieldPath === 'submission.quotationDeadline') return 'Quotation deadline'
  if (fieldPath === 'submission.contactEmail') return 'Contact email'
  if (fieldPath === 'identification.rfqOrSolicitationNumber') return 'RFQ / Solicitation number'
  return String(fieldPath || 'Field').replace(/\./g, ' / ')
}

function conflictSummary(conflicts, emailCandidates) {
  const messages = []
  for (const conflict of conflicts || []) {
    if (conflict.field === 'submission.quotationDeadline') {
      messages.push('Deadline differs between RFQ and PhilGEPS.')
    } else if (conflict.field === 'financial.abc') {
      messages.push('Multiple financial scopes detected.')
    } else {
      messages.push(`${conflictTitle(conflict.field)} requires verification.`)
    }
  }
  if (emailCandidates?.length) {
    messages.push('Possible OCR contact information requires verification.')
  }
  return [...new Set(messages)]
}

function statusLabel(status) {
  if (status === 'complete') return 'Complete'
  if (status === 'needs_review') return 'Needs review'
  if (status === 'partial') return 'Partial'
  return displayText(status)
}

function ProvenanceLine({ field, noticeId }) {
  if (!field || typeof field !== 'object') return null
  const source = field.source
  const label = shortSourceName(source)
  const full = sourceFullName(source)
  const url = documentUrl(noticeId, source)
  const bits = []
  const scope = scopeLabel(field)
  if (scope) bits.push(scope)
  if (field.confidence) bits.push(String(field.confidence))
  return (
    <div className="req-provenance mono">
      {label ? (
        url ? (
          <a
            className="text-link mono"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={full || label}
          >
            {label} <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span title={full || label}>{label}</span>
        )
      ) : null}
      {bits.length ? <span className="req-provenance-meta">{bits.join(' · ')}</span> : null}
    </div>
  )
}

function Fact({ label, field, wide = false, children = null, asDate = false }) {
  const value = fieldValue(field)
  if ((value == null || value === '') && !children) return null
  const shown = asDate ? formatDetailDate(value) : (children || String(value))
  return (
    <div className={wide ? 'fact-wide' : undefined}>
      <dt className="mono">{label}</dt>
      <dd>
        {shown}
      </dd>
    </div>
  )
}

function DurationFact({ field, label = 'License Term' }) {
  const value = fieldValue(field)
  if (value == null || value === '') return null
  const constraint = field?.constraint
  return (
    <div>
      <dt className="mono">{label}</dt>
      <dd className="req-duration">
        <span>{String(value)}</span>
        {constraint === 'minimum' ? <span className="req-constraint mono">Minimum</span> : null}
        {constraint === 'maximum' ? <span className="req-constraint mono">Maximum</span> : null}
      </dd>
    </div>
  )
}

function SourceRow({ fields, noticeId }) {
  const sources = collectSources(fields, noticeId)
  if (sources.length === 0) return null
  return (
    <div className="fact-wide">
      <dt className="mono">Source</dt>
      <dd className="req-sources">
        {sources.map((source) => (
          source.url ? (
            <a
              key={source.label}
              className="text-link mono"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={source.full || source.label}
            >
              {source.label} <span aria-hidden="true">↗</span>
            </a>
          ) : (
            <span key={source.label} className="mono" title={source.full || source.label}>
              {source.label}
            </span>
          )
        ))}
      </dd>
    </div>
  )
}

const CLAUSE_PAGE_SIZE = 40

function documentStatusLabel(status) {
  if (status === 'checking') return 'Checking availability'
  if (status === 'unknown') return 'Availability unknown'
  if (status === 'unavailable') return 'Unavailable'
  return null
}

function SourceDocumentList({ noticeId, names }) {
  const { state, files } = useNoticeDocuments(noticeId)
  const links = resolveDocumentLinks(names, files, state)

  if (links.length === 0) {
    return <p className="state-line mono">No source documents are recorded for these requirements.</p>
  }

  return (
    <ol className="document-list">
      {links.map((document, index) => {
        const status = documentStatusLabel(document.status)
        return (
          <li key={`${document.name}-${index}`}>
            <span className="document-index mono">{String(index + 1).padStart(2, '0')}</span>
            <span className="document-name" title={document.name}>{document.name}</span>
            {document.href ? (
              <a
                className="text-link mono"
                href={document.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${document.name}`}
              >
                Open <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="mono req-doc-status">{status}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function ExtractedClauses({ clauses, noticeId }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(clauses.length / CLAUSE_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * CLAUSE_PAGE_SIZE
  const visible = clauses.slice(start, start + CLAUSE_PAGE_SIZE)

  return (
    <details
      className="req-clauses"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="mono">View All Extracted Clauses</summary>
      <p className="req-fallback">
        {clauses.length} stored clause{clauses.length === 1 ? '' : 's'}. Wording and order are unchanged.
      </p>
      {open ? (
        <>
          <div className="req-clause-page">
            <ol className="document-list" start={start + 1}>
              {visible.map((clause, index) => {
                const url = documentUrl(noticeId, clause.source)
                const number = start + index + 1
                return (
                  <li key={`clause-${number}`}>
                    <span className="document-index mono">{String(number).padStart(3, '0')}</span>
                    <span className="document-name">{clause.value}</span>
                    {url ? (
                      <a
                        className="text-link mono"
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open source document"
                        title={sourceFullName(clause.source) || undefined}
                      >
                        {shortSourceName(clause.source) || 'Open'} <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="mono req-doc-status" title={sourceFullName(clause.source) || undefined}>
                        {shortSourceName(clause.source) || 'Source not recorded'}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
          {clauses.length > CLAUSE_PAGE_SIZE ? (
            <div className="req-clause-pager mono">
              <button
                type="button"
                className="text-link"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </button>
              <span>
                {start + 1}-{Math.min(start + CLAUSE_PAGE_SIZE, clauses.length)} of {clauses.length}
              </span>
              <button
                type="button"
                className="text-link"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </details>
  )
}

function summarySourceNotes(facts) {
  const notes = []
  const seen = new Set()
  for (const fact of facts) {
    const key = `${fact.source || ''}|${fact.confidence || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    notes.push(fact)
  }
  return notes
}

function SummaryFact({ fact }) {
  const constraint = fact.constraint === 'minimum'
    ? 'Minimum'
    : fact.constraint === 'maximum'
      ? 'Maximum'
      : null
  return (
    <div>
      <dt className="mono">{fact.label}</dt>
      <dd>
        <span className="req-duration">
          <span>{fact.value}</span>
          {constraint ? <span className="req-constraint mono">{constraint}</span> : null}
        </span>
      </dd>
    </div>
  )
}

function SummarySourceNotes({ facts }) {
  const notes = summarySourceNotes(facts)
  if (notes.length === 0) return null
  return (
    <p className="req-summary-meta">
      {notes.map((fact, index) => {
        const name = fact.sourceLabel || 'Source not recorded'
        const full = fact.source && fact.source !== 'philgeps-structured'
          ? sourceFullName(fact.source)
          : name
        const confidence = fact.confidence ? `, ${fact.confidence} confidence` : ''
        return (
          <span key={`${fact.source || 'none'}-${fact.confidence || 'none'}-${index}`} title={full}>
            {index > 0 ? ' / ' : ''}
            {name}{confidence}
          </span>
        )
      })}
    </p>
  )
}

function FinancialBlock({ financial, noticeId }) {
  const other = Array.isArray(financial.otherFinancialLimits)
    ? financial.otherFinancialLimits.filter((item) => fieldValue(item) != null)
    : []
  const hasScopeSplit = other.length > 0
  const preferredLabel = hasScopeSplit ? 'Applicable / Item ABC' : 'ABC'
  const preferredMoney = moneyDisplay(fieldValue(financial.abc))

  return (
    <dl className="facts">
      {preferredMoney ? (
        <div className={hasScopeSplit ? 'fact-wide' : undefined}>
          <dt className="mono">{preferredLabel}</dt>
          <dd>
            <span className={hasScopeSplit ? 'req-abc-preferred' : undefined}>{preferredMoney}</span>
            {hasScopeSplit && financial.abc ? (
              <ProvenanceLine field={financial.abc} noticeId={noticeId} />
            ) : null}
          </dd>
        </div>
      ) : null}

      {other.map((limit, index) => {
        const amount = moneyDisplay(fieldValue(limit))
        if (!amount) return null
        const label = scopeLabel(limit) || 'Other financial context'
        return (
          <div className="fact-wide req-other-finance" key={`other-abc-${index}`}>
            <dt className="mono">{label}</dt>
            <dd>
              <span className="req-abc-other">{amount}</span>
              <ProvenanceLine field={limit} noticeId={noticeId} />
            </dd>
          </div>
        )
      })}

      <Fact label="Currency" field={financial.currency} />
      <Fact label="VAT wording" field={financial.vatWording} wide />
      {!hasScopeSplit ? (
        <SourceRow
          noticeId={noticeId}
          fields={[financial.abc, financial.currency, financial.vatWording]}
        />
      ) : (
        <SourceRow noticeId={noticeId} fields={[financial.currency, financial.vatWording]} />
      )}
    </dl>
  )
}

function ConflictBlock({ conflict, noticeId }) {
  const values = Array.isArray(conflict.values) ? conflict.values : []
  const title = conflictTitle(conflict.field)
  let note = 'Values differ. Verify before quoting or submission.'
  if (conflict.field === 'financial.abc') {
    note = 'Different financial scopes were detected. Verify the applicable budget before quoting.'
  } else if (conflict.field === 'submission.quotationDeadline') {
    note = 'The values conflict. Verify before submission.'
  }

  return (
    <div className="req-review-block">
      <h4 className="mono">{title}</h4>
      <dl className="facts req-conflict-facts">
        {values.map((entry, index) => {
          const raw = fieldValue(entry)
          if (raw == null || raw === '') return null
          const isMoney = conflict.field === 'financial.abc'
          const isDeadline = conflict.field === 'submission.quotationDeadline'
          const display = isMoney ? moneyDisplay(raw) : (isDeadline ? formatDetailDate(raw) : raw)
          if (display == null || display === '') return null
          const sideLabel = scopeLabel(entry)
            || (entry?.source === 'philgeps-structured' ? 'PhilGEPS' : 'RFQ document')
          return (
            <div key={`conflict-${conflict.field}-${index}`}>
              <dt className="mono">{sideLabel}</dt>
              <dd>
                <span>{String(display)}</span>
                <ProvenanceLine field={entry} noticeId={noticeId} />
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="req-review-note mono">{note}</p>
    </div>
  )
}

function EmailCandidatesBlock({ candidates, noticeId }) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  return (
    <div className="req-review-block">
      <h4 className="mono">Contact / Needs review</h4>
      <ul className="req-candidate-list">
        {candidates.map((candidate, index) => {
          const email = fieldValue(candidate)
          if (!email) return null
          return (
            <li key={`email-cand-${index}`} className="req-candidate">
              <div className="mono req-candidate-label">OCR candidate</div>
              <div className="req-candidate-value">{email}</div>
              <ProvenanceLine field={candidate} noticeId={noticeId} />
              <p className="req-review-note mono">Unverified OCR extraction — check original document.</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function ProcurementRequirements({ requirements, noticeId }) {
  if (!requirements) {
    return (
      <section className="dossier-block requirements" aria-labelledby="requirements-title">
        <h3 id="requirements-title" className="mono">Procurement Requirements</h3>
        <p className="state-line mono">No extracted requirements yet.</p>
      </section>
    )
  }

  const items = Array.isArray(requirements.items) ? requirements.items : []
  const delivery = requirements.delivery || {}
  const submission = requirements.submission || {}
  const financial = requirements.financial || {}
  const identification = requirements.identification || {}
  const missing = requirements.missingFields || []
  const conflicts = Array.isArray(requirements.conflicts) ? requirements.conflicts : []
  const emailCandidates = Array.isArray(submission.contactEmailCandidates)
    ? submission.contactEmailCandidates
    : []
  const technicalSummary = buildTechnicalSummary(requirements)
  const reviewMessages = conflictSummary(conflicts, emailCandidates)
  const needsReviewUi = requirements.extractionStatus === 'needs_review'
    || conflicts.length > 0
    || emailCandidates.length > 0

  return (
    <section className="dossier-block requirements" aria-labelledby="requirements-title">
      <h3 id="requirements-title" className="mono">Procurement Requirements</h3>

      {(fieldValue(identification.controlNumber) || fieldValue(identification.rfqOrSolicitationNumber)) ? (
        <dl className="facts">
          <Fact label="PhilGEPS Control No." field={identification.controlNumber} />
          <Fact label="RFQ / Solicitation No." field={identification.rfqOrSolicitationNumber} />
          <SourceRow
            noticeId={noticeId}
            fields={[identification.controlNumber, identification.rfqOrSolicitationNumber]}
          />
        </dl>
      ) : null}

      <FinancialBlock financial={financial} noticeId={noticeId} />

      {items.length === 0 ? (
        <p className="state-line mono">No line items extracted.</p>
      ) : (
        items.map((item, index) => (
          <div className="req-item" key={`item-${index}`}>
            <h3 className="mono">Item / {String(index + 1).padStart(2, '0')}</h3>
            <dl className="facts">
              <Fact label="Product / Software" field={item.description} />
              <Fact label="Quantity" field={item.quantity} />
              <Fact label="Unit" field={item.unitOfMeasure} />
              <Fact label="Licenses / Seats" field={item.licenses || item.usersOrSeats} />
              <DurationFact field={item.subscriptionDuration} />
              <Fact label="License Type" field={item.licenseType} />
              <SourceRow
                noticeId={noticeId}
                fields={[
                  item.description,
                  item.quantity,
                  item.unitOfMeasure,
                  item.licenses,
                  item.usersOrSeats,
                  item.subscriptionDuration,
                  item.licenseType,
                ]}
              />
            </dl>
          </div>
        ))
      )}

      <div className="req-item">
        <h3 className="mono">Technical Requirements Summary</h3>
        <p className="req-verify">Automatically extracted. Verify against source documents.</p>
        {technicalSummary.facts.length === 0 ? (
          <p className="req-fallback">No additional technical fields were extracted. Review the original source documents.</p>
        ) : (
          <>
            <dl className="req-summary-grid">
              {technicalSummary.facts.map((fact, index) => (
                <SummaryFact fact={fact} key={`${fact.label}-${index}`} />
              ))}
            </dl>
            <SummarySourceNotes facts={technicalSummary.facts} />
          </>
        )}
        <p className="req-fallback">
          {technicalSummary.clauseCount > 0
            ? 'Extracted clauses are not shown as confirmed features, compatibility, deployment, or support. Open the full list or the source documents to review them.'
            : 'No technical clauses were extracted.'}
        </p>
        <h3 className="mono">Original source documents</h3>
        <SourceDocumentList noticeId={noticeId} names={technicalSummary.documents} />
        {technicalSummary.clauseCount > 0 ? (
          <ExtractedClauses clauses={technicalSummary.clauses} noticeId={noticeId} />
        ) : null}
      </div>

      <div className="req-item">
        <h3 className="mono">Delivery / Implementation</h3>
        <dl className="facts">
          <Fact label="Delivery period" field={delivery.deliveryPeriod} />
          <DurationFact label="Subscription duration" field={delivery.subscriptionDuration} />
          <Fact label="Delivery location" field={delivery.deliveryLocation} wide />
          <SourceRow
            noticeId={noticeId}
            fields={[delivery.deliveryPeriod, delivery.subscriptionDuration, delivery.deliveryLocation]}
          />
        </dl>
      </div>

      <div className="req-item">
        <h3 className="mono">Submission</h3>
        <dl className="facts">
          <Fact label="Deadline" field={submission.quotationDeadline} asDate />
          <Fact label="Submission method" field={submission.submissionMethod} />
          <Fact label="Contact person" field={submission.contactPerson} />
          <Fact label="Email" field={submission.contactEmail} />
          <SourceRow
            noticeId={noticeId}
            fields={[
              submission.quotationDeadline,
              submission.submissionMethod,
              submission.contactPerson,
              submission.contactEmail,
            ]}
          />
        </dl>
      </div>

      <div className="req-item">
        <h3 className="mono">Extraction</h3>
        <dl className="facts">
          <div className={needsReviewUi ? 'fact-wide' : undefined}>
            <dt className="mono">Status</dt>
            <dd>
              <span className={needsReviewUi ? 'req-status-review' : undefined}>
                {statusLabel(requirements.extractionStatus)}
              </span>
              {needsReviewUi && reviewMessages.length > 0 ? (
                <ul className="req-status-reasons mono">
                  {reviewMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}
            </dd>
          </div>
          {missing.length > 0 ? (
            <div className="fact-wide">
              <dt className="mono">Missing fields</dt>
              <dd>{missing.join(', ')}</dd>
            </div>
          ) : null}
        </dl>

        {needsReviewUi ? (
          <div className="req-review-panel" aria-label="Requires review">
            <h3 className="mono">Requires review</h3>
            {conflicts.map((conflict) => (
              <ConflictBlock
                key={conflict.field || JSON.stringify(conflict.values)}
                conflict={conflict}
                noticeId={noticeId}
              />
            ))}
            <EmailCandidatesBlock candidates={emailCandidates} noticeId={noticeId} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
