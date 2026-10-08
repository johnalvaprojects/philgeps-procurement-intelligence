import ReportShell from './ReportShell.jsx'
import {
  classificationSourceLabel,
  compactWindow,
  completionLabel,
  completionReasonLabel,
  countText,
  formatManilaTimestamp,
  formatReportDuration,
  reviewStateLabel,
  savedRecordLabel,
} from './report-format.js'
import './print.css'

export default function DailyScanReport({ report, onClose }) {
  if (!report) {
    return (
      <ReportShell title="Daily Scan Report" onClose={onClose}>
        <p className="report-note">No daily scan report is stored for this selection.</p>
      </ReportShell>
    )
  }

  const counts = report.counts || {}
  const duration = formatReportDuration(report.durationMs)
  const reason = completionReasonLabel(report.completionReason)
  const opportunities = Array.isArray(report.softwareOpportunities) ? report.softwareOpportunities : []
  const errors = Array.isArray(report.errors) ? report.errors : []
  const hasMatchingCount = Number.isFinite(Number(counts.matchingSoftware))
  const showsRecord = opportunities.some((row) => row.previouslySaved === true || row.previouslySaved === false)

  return (
    <ReportShell
      title="Daily Scan Report"
      snapshot
      generatedAt={report.generatedAt || null}
      onClose={onClose}
    >
      <section className="report-section">
        <h2>Scan run</h2>
        <dl className="report-facts">
          <div>
            <dt>Notice date range</dt>
            <dd>{report.from || report.to ? compactWindow(report.from, report.to) : 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Scan started</dt>
            <dd>{report.startedAt ? formatManilaTimestamp(report.startedAt) : 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Scan completed</dt>
            <dd>{report.finishedAt ? formatManilaTimestamp(report.finishedAt) : 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Report generated</dt>
            <dd>{report.generatedAt ? formatManilaTimestamp(report.generatedAt) : 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Completion</dt>
            <dd>{completionLabel(report)}{reason ? ` · ${reason}` : ''}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{duration || 'Not recorded'}</dd>
          </div>
        </dl>
      </section>

      <section className="report-section">
        <h2>Counts</h2>
        <dl className="report-metrics">
          <div>
            <dt>Notices found in range</dt>
            <dd>{countText(counts.discovered)}</dd>
          </div>
          <div>
            <dt>Notices processed</dt>
            <dd>{countText(counts.processed)}</dd>
          </div>
          <div>
            <dt>New software</dt>
            <dd>{countText(counts.software)}</dd>
          </div>
          <div>
            <dt>Previously saved notices</dt>
            <dd>{countText(counts.alreadyProcessed)}</dd>
          </div>
          <div>
            <dt>Matching software opportunities</dt>
            <dd>{countText(hasMatchingCount ? counts.matchingSoftware : opportunities.length)}</dd>
          </div>
          <div>
            <dt>Review</dt>
            <dd>{countText(counts.review)}</dd>
          </div>
          <div>
            <dt>Not relevant</dt>
            <dd>{countText(counts.notRelevant)}</dd>
          </div>
          <div>
            <dt>Errors</dt>
            <dd>{countText(counts.errors)}</dd>
          </div>
          <div>
            <dt>Documents downloaded</dt>
            <dd>{countText(counts.documentsDownloaded)}</dd>
          </div>
        </dl>
        {hasMatchingCount ? (
          <p className="report-note">Notices found in range are the PhilGEPS notices for the selected dates. Notices processed are the notices this run handled, including saved notices that were skipped. New software counts notices classified in this run. Previously saved notices were skipped and were not reclassified. Matching software opportunities includes both for that date range.</p>
        ) : Number.isFinite(Number(counts.alreadyProcessed)) ? (
          <p className="report-note">Already saved notices in this run: {counts.alreadyProcessed}. They are not included again in the Software count.</p>
        ) : null}
      </section>

      <section className="report-section">
        <h2>Software opportunities</h2>
        {showsRecord ? (
          <p className="report-note">New means classified in this run. Saved means the notice was already stored and was not reclassified.</p>
        ) : null}
        {opportunities.length === 0 ? (
          <p className="report-note">No matching software opportunities were recorded for this notice date range.</p>
        ) : (
          <table className="report-table report-table-software">
            <colgroup>
              <col className="col-notice" />
              <col className="col-title" />
              <col className="col-agency" />
              <col className="col-source" />
              <col className="col-review" />
              {showsRecord ? <col className="col-record" /> : null}
            </colgroup>
            <thead>
              <tr>
                <th>Notice</th>
                <th>Title</th>
                <th>Agency</th>
                <th>Source</th>
                <th>Review</th>
                {showsRecord ? <th>Record</th> : null}
              </tr>
            </thead>
            <tbody>
              {opportunities.map((row) => (
                <tr key={row.referenceNumber || row.title}>
                  <td>{row.referenceNumber || 'Not recorded'}</td>
                  <td>{row.title || 'Not recorded'}</td>
                  <td>{row.organization || 'Not recorded'}</td>
                  <td>{classificationSourceLabel(row.source)}</td>
                  <td>{reviewStateLabel(row.reviewStatus)}</td>
                  {showsRecord ? <td>{savedRecordLabel(row.previouslySaved)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="report-section">
        <h2>Processing errors</h2>
        {errors.length === 0 ? (
          <p className="report-note">No processing errors were recorded.</p>
        ) : (
          <table className="report-table report-table-errors">
            <colgroup>
              <col className="col-notice" />
              <col className="col-message" />
            </colgroup>
            <thead>
              <tr>
                <th>Notice</th>
                <th>Recorded message</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((error, index) => (
                <tr key={`${error.referenceNumber || 'run'}-${index}`}>
                  <td>{error.referenceNumber || 'Scan'}</td>
                  <td>{error.message || 'Not recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </ReportShell>
  )
}
