import { classificationLabel, formatPeso } from '../format.js'
import { buildCaseReport } from './case-report.js'
import ReportShell from './ReportShell.jsx'
import {
  blank,
  classificationSourceLabel,
  formatReportDetailDate,
  formatReportDate,
  reviewStateLabel,
} from './report-format.js'
import './print.css'

function Record({ label, value, wide = false, children = null }) {
  return (
    <div className={wide ? 'report-span' : undefined}>
      <dt>{label}</dt>
      <dd>{children || blank(value)}</dd>
    </div>
  )
}

function Sourced({ label, record, wide = false, date = false }) {
  if (!record) {
    return <Record label={label} value={null} wide={wide} />
  }
  const shown = date ? formatReportDetailDate(record.value) : record.value
  const constraint = record.constraint === 'minimum'
    ? 'Minimum'
    : record.constraint === 'maximum'
      ? 'Maximum'
      : null
  return (
    <Record label={label} wide={wide}>
      <span>{shown}{constraint ? ` (${constraint})` : ''}</span>
      {record.source || record.confidence ? (
        <span className="report-source">
          {[record.source, record.confidence ? `${record.confidence} confidence` : null].filter(Boolean).join(' · ')}
        </span>
      ) : null}
    </Record>
  )
}

function extractionLabel(status) {
  if (status === 'complete') return 'Complete'
  if (status === 'needs_review') return 'Needs review'
  if (status === 'partial') return 'Partial'
  return blank(status)
}

function scopeText(value) {
  if (!value) return null
  if (value === 'philgeps_notice') return 'PhilGEPS notice'
  if (value === 'item_table') return 'Item table'
  if (value === 'philgeps_notice_and_item_table') return 'PhilGEPS + item table'
  if (value === 'document_header') return 'RFQ header'
  return value
}

function reviewFieldLabel(field) {
  if (field === 'financial.abc') return 'Financial amount'
  if (field === 'submission.quotationDeadline') return 'Quotation deadline'
  if (field === 'submission.contactEmail') return 'Contact email'
  return field || 'Field'
}

export default function CaseReport({ packet, onClose }) {
  const report = buildCaseReport(packet)
  const money = report.financialAbc?.value ? formatPeso(report.financialAbc.value) : null

  return (
    <ReportShell title="Procurement Case Report" onClose={onClose}>
      <section className="report-section">
        <h2>Notice</h2>
        <p className="report-copy">{blank(report.title)}</p>
        <dl className="report-facts">
          <Record label="PhilGEPS notice ID" value={report.referenceNumber} />
          <Record label="Source" value={report.sourceLabel} />
          <Record label="Procuring agency" value={report.organization} wide />
          <Record label="Published" value={formatReportDate(report.postedDate, 'philgeps')} />
          <Record label="Closing" value={formatReportDetailDate(report.deadline)} />
          <Record label="Source URL" value={report.sourceUrl} wide />
          <Record label="Classification" value={classificationLabel(report.classification)} />
          <Record label="Classification source" value={classificationSourceLabel(report.classificationSource)} />
          <Record label="Review status" value={reviewStateLabel(report.reviewed)} />
        </dl>
      </section>

      <section className="report-section">
        <h2>Approved budget</h2>
        <dl className="report-facts">
          <Record label="Notice ABC" value={report.noticeAbc ? formatPeso(report.noticeAbc) : null} />
          <Sourced label="Extracted ABC" record={money ? { ...report.financialAbc, value: money } : null} />
          <Record label="Financial scope" value={scopeText(report.abcScope)} />
          <Sourced label="Currency" record={report.currency} />
          <Sourced label="VAT wording" record={report.vatWording} wide />
        </dl>
        {report.otherFinancialLimits.length > 0 ? (
          <div className="report-warning">
            <strong>Other recorded financial amounts</strong>
            <ul className="report-list">
              {report.otherFinancialLimits.map((limit, index) => (
                <li key={`limit-${index}`}>
                  {formatPeso(limit.value)}
                  {limit.role ? ` · ${limit.role}` : ''}
                  {limit.source ? ` · ${limit.source}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {report.conflicts.length > 0 ? (
        <section className="report-section">
          <h2>Conflicts</h2>
          {report.conflicts.map((conflict, index) => (
            <div className="report-warning" key={`conflict-${index}`}>
              <strong>{reviewFieldLabel(conflict.field)}</strong>
              <ul className="report-list">
                {(conflict.values || []).map((entry, valueIndex) => {
                  const value = entry?.value ?? entry
                  if (value == null || value === '') return null
                  return (
                    <li key={`conflict-value-${valueIndex}`}>
                      {String(value)}
                      {entry?.source ? ` · ${entry.source}` : ''}
                      {entry?.confidence ? ` · ${entry.confidence} confidence` : ''}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section className="report-section">
        <h2>Products or services</h2>
        {!report.requirementsPresent ? (
          <p className="report-note">Requirements were not extracted for this notice.</p>
        ) : null}
        {report.requirementsPresent && report.items.length === 0 ? (
          <p className="report-note">No line items were extracted.</p>
        ) : null}
        {report.items.map((item, index) => (
          <article className="report-item" key={`item-${index}`}>
            <h3>Item {String(index + 1).padStart(2, '0')}</h3>
            <dl className="report-facts">
              <Sourced label="Description" record={item.description} wide />
              <Sourced label="Quantity" record={item.quantity} />
              <Sourced label="Unit" record={item.unit} />
              <Sourced label="Licenses / seats" record={item.licenses} />
              <Sourced label="Subscription duration" record={item.duration} />
              <Sourced label="License type" record={item.licenseType} wide />
            </dl>
          </article>
        ))}
      </section>

      <section className="report-section">
        <h2>Technical requirements</h2>
        <p className="report-note">
          Automatically extracted. Verify against source documents. The original procurement documents remain authoritative.
        </p>
        {report.technicalFacts.length === 0 ? (
          <p className="report-note">No additional technical fields were extracted. Review the original source documents.</p>
        ) : (
          <dl className="report-facts">
            {report.technicalFacts.map((fact, index) => (
              <Sourced
                key={`tech-${index}`}
                label={fact.label}
                record={{ ...fact, source: fact.sourceLabel || null }}
                wide={String(fact.value).length > 80}
              />
            ))}
          </dl>
        )}
        <p className="report-note">
          {report.extractedClauseCount > 0
            ? `${report.extractedClauseCount} extracted clauses are stored with this case and are not printed here.`
            : 'No technical clauses were extracted.'}
        </p>
      </section>

      <section className="report-section">
        <h2>Delivery and submission</h2>
        <dl className="report-facts">
          <Sourced label="Delivery period" record={report.deliveryPeriod} />
          <Sourced label="Subscription duration" record={report.subscriptionDuration} />
          <Sourced label="Delivery location" record={report.deliveryLocation} wide />
          <Sourced label="Submission deadline" record={report.quotationDeadline} date />
          <Sourced label="Submission method" record={report.submissionMethod} wide />
          <Sourced label="Contact person" record={report.contactPerson} />
          <Sourced label="Email" record={report.contactEmail} />
        </dl>
      </section>

      <section className="report-section">
        <h2>Source documents</h2>
        <p className="report-note">The original procurement documents remain authoritative.</p>
        {report.documents.length === 0 && report.sourceDocuments.length === 0 ? (
          <p className="report-note">No source documents are stored.</p>
        ) : (
          <ul className="report-list">
            {[...new Set([...report.documents, ...report.sourceDocuments])].map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="report-section">
        <h2>Extraction and review</h2>
        <dl className="report-facts">
          <Record label="Extraction status" value={extractionLabel(report.extractionStatus)} />
          <Record label="Review status" value={reviewStateLabel(report.reviewed)} />
        </dl>
        {report.fieldsNeedingReview.length > 0 ? (
          <div className="report-warning">
            <strong>Fields marked for review</strong>
            <ul className="report-list">
              {report.fieldsNeedingReview.map((field) => (
                <li key={field}>{reviewFieldLabel(field)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {report.emailCandidates.length > 0 ? (
          <div className="report-warning">
            <strong>Unverified OCR contact candidates</strong>
            <ul className="report-list">
              {report.emailCandidates.map((candidate, index) => (
                <li key={`candidate-${index}`}>
                  {candidate.value}
                  {candidate.confidence ? ` · ${candidate.confidence} confidence` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </ReportShell>
  )
}
