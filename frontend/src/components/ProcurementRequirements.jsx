import { displayText, formatPeso } from '../format.js'

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

function Fact({ label, field, wide = false, children = null }) {
  const value = fieldValue(field)
  if ((value == null || value === '') && !children) return null
  return (
    <div className={wide ? 'fact-wide' : undefined}>
      <dt className="mono">{label}</dt>
      <dd>
        {children || String(value)}
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

function SpecRows({ items, noticeId }) {
  if (!Array.isArray(items) || items.length === 0) return null
  const rows = items
    .map((item) => ({ value: fieldValue(item), field: item }))
    .filter((row) => row.value)
  if (rows.length === 0) return null

  return (
    <ol className="document-list req-spec-rows">
      {rows.map((row, index) => {
        const url = documentUrl(noticeId, row.field?.source)
        return (
          <li key={`spec-${index}`}>
            <span className="document-index mono">{String(index + 1).padStart(2, '0')}</span>
            <span className="document-name">{row.value}</span>
            {url ? (
              <a
                className="text-link mono"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open source document"
                title={sourceFullName(row.field?.source) || undefined}
              >
                Open <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span
                className="mono req-spec-origin"
                title={sourceFullName(row.field?.source) || undefined}
              >
                {shortSourceName(row.field?.source) || '—'}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function flattenTechnical(technical) {
  const groups = [
    ['Required features', technical.requiredFeatures],
    ['Minimum specifications', technical.minimumSpecifications],
    ['Compatibility', technical.compatibilityRequirements],
    ['Deployment', technical.deploymentRequirements],
    ['License requirements', technical.licenseRequirements],
    ['Support', technical.supportRequirements],
    ['Training', technical.trainingRequirements],
    ['Implementation', technical.implementationRequirements],
  ]
  const seen = new Set()
  const flat = []
  for (const [, items] of groups) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const value = fieldValue(item)
      if (!value || seen.has(value)) continue
      seen.add(value)
      flat.push(item)
    }
  }
  return flat
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
          const isMoney = conflict.field === 'financial.abc'
          const display = isMoney ? moneyDisplay(raw) : raw
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
  const technical = requirements.technical || {}
  const delivery = requirements.delivery || {}
  const submission = requirements.submission || {}
  const financial = requirements.financial || {}
  const identification = requirements.identification || {}
  const missing = requirements.missingFields || []
  const conflicts = Array.isArray(requirements.conflicts) ? requirements.conflicts : []
  const emailCandidates = Array.isArray(submission.contactEmailCandidates)
    ? submission.contactEmailCandidates
    : []
  const techRows = flattenTechnical(technical)
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
        <h3 className="mono">Technical Specifications</h3>
        {techRows.length === 0 ? (
          <p className="state-line mono">No technical specifications extracted.</p>
        ) : (
          <SpecRows items={techRows} noticeId={noticeId} />
        )}
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
          <Fact label="Deadline" field={submission.quotationDeadline} />
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
