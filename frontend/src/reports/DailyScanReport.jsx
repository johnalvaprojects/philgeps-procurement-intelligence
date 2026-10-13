import { useLayoutEffect, useRef, useState } from 'react'
import logoUrl from '../assets/trustera-logo.png'
import { classificationLabel, DATE_SOURCE_ISO, formatLongDate } from '../format.js'
import ReportShell from './ReportShell.jsx'
import {
  classificationSourceLabel,
  completionLabel,
  completionReasonLabel,
  countText,
  formatManilaTimestamp,
  formatReportDuration,
  reviewStateLabel,
  savedRecordLabel,
} from './report-format.js'
import './print.css'
import './publication.css'

const MATCHING_NOTE = 'Notices found in range are the PhilGEPS notices for the selected dates. Notices processed are the notices this run handled, including saved notices that were skipped. New software counts notices classified in this run. Previously saved notices were skipped and were not reclassified. Matching software opportunities includes both for that date range.'
const RECORD_NOTE = 'New means classified in this run. Saved means the notice was already stored and was not reclassified.'
const EMPTY_OPPORTUNITIES = 'No matching software opportunities were recorded for this notice date range.'
const EMPTY_ERRORS = 'No processing errors were recorded.'
const OPP_SECTION = 'Section 02'
const ERR_SECTION = 'Section 03'
const NO_ROWS = []

function currentClassificationNote(row) {
  if (!row || row.packetFound !== true) {
    return row?.packetFound === false ? 'Current classification not recorded' : null
  }
  const current = row.currentClassification == null ? '' : String(row.currentClassification).trim()
  if (!current) return 'Current classification not recorded'
  if (current === 'software') return null
  if (current === 'not relevant') {
    return 'Scan classification: Software. Current classification: Not Relevant. Not a current software opportunity.'
  }
  return `Scan classification: Software. Current classification: ${classificationLabel(current)}.`
}

function periodLabel(from, to) {
  if (!from && !to) return 'Not recorded'
  const left = from ? formatLongDate(from, DATE_SOURCE_ISO) : 'Not recorded'
  const right = to ? formatLongDate(to, DATE_SOURCE_ISO) : 'Not recorded'
  return `${left} to ${right}`
}

function PageFooter({ pageNo, dark = false }) {
  return (
    <footer className={dark ? 'pub-foot pub-foot-dark' : 'pub-foot'}>
      <span>Trustera Solutions, Inc.</span>
      <span>{String(pageNo).padStart(2, '0')}</span>
    </footer>
  )
}

function WhitePage({ pageNo, children }) {
  return (
    <section className="pub-page pub-page-white">
      <div className="pub-page-body">{children}</div>
      <aside className="pub-rail" aria-hidden="true"><span>Daily Report</span></aside>
      <div className="pub-rail-print" aria-hidden="true" />
      <PageFooter pageNo={pageNo} />
    </section>
  )
}

function OpportunityTable({ rows, showsRecord, head = true }) {
  return (
    <table className="pub-table pub-table-scan">
      <colgroup>
        <col />
        <col />
        <col />
        <col />
        <col />
        {showsRecord ? <col /> : null}
      </colgroup>
      {head ? (
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
      ) : null}
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.referenceNumber || row.title || `opp-${index}`}>
            <td>
              {row.referenceNumber || 'Not recorded'}
              <div>{row.portalLabel || 'Current PhilGEPS'}</div>
            </td>
            <td>
              {row.title || 'Not recorded'}
              {currentClassificationNote(row) ? <span className="pub-reclass">{currentClassificationNote(row)}</span> : null}
            </td>
            <td>{row.organization || 'Not recorded'}</td>
            <td>{classificationSourceLabel(row.source)}</td>
            <td>{reviewStateLabel(row.reviewStatus)}</td>
            {showsRecord ? <td>{savedRecordLabel(row.previouslySaved)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ErrorTable({ rows, head = true }) {
  return (
    <table className="pub-table pub-table-scan pub-table-errors">
      <thead>
        {head ? (
          <tr>
            <th>Notice</th>
            <th>Recorded message</th>
          </tr>
        ) : null}
      </thead>
      <tbody>
        {rows.map((error, index) => (
          <tr key={`${error.referenceNumber || 'run'}-${index}`}>
            <td>{error.referenceNumber || 'Scan'}</td>
            <td>{error.message || 'Not recorded'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function heightOf(root, selector) {
  const node = root.querySelector(selector)
  return node ? node.getBoundingClientRect().height : 0
}

function packSequence(items, firstOverhead, nextOverhead, cap) {
  if (items.length === 0) return [[]]
  const pages = []
  let page = []
  let used = firstOverhead
  items.forEach((item) => {
    if (page.length > 0 && used + item.h > cap) {
      pages.push(page)
      page = []
      used = nextOverhead
    }
    page.push(item)
    used += item.h
  })
  if (page.length) pages.push(page)
  return pages
}

function measurePublication(root, opportunityCount, errorCount) {
  const cap = heightOf(root, '[data-cap]') - 4
  const oppHead = opportunityCount > 0 ? heightOf(root, '[data-opp-head]') : 0
  const errHead = errorCount > 0 ? heightOf(root, '[data-err-head]') : 0
  const oppOpen = heightOf(root, '[data-block="opp-open"]') + oppHead
  const oppCont = heightOf(root, '[data-block="opp-cont"]') + oppHead
  const errOpen = heightOf(root, '[data-block="err-open"]') + errHead
  const errCont = heightOf(root, '[data-block="err-cont"]') + errHead
  const opportunityPages = packSequence(
    [...root.querySelectorAll('[data-opp]')].map((node) => ({
      index: Number(node.dataset.opp),
      h: node.getBoundingClientRect().height,
    })),
    oppOpen,
    oppCont,
    cap,
  ).map((chunk, index) => ({
    continued: index > 0,
    indexes: chunk.map((item) => item.index),
    used: chunk.reduce((sum, item) => sum + item.h, 0) + (index === 0 ? oppOpen : oppCont),
  }))
  const errorPages = packSequence(
    [...root.querySelectorAll('[data-err]')].map((node) => ({
      index: Number(node.dataset.err),
      h: node.getBoundingClientRect().height,
    })),
    errOpen,
    errCont,
    cap,
  ).map((chunk, index) => ({
    continued: index > 0,
    indexes: chunk.map((item) => item.index),
    used: chunk.reduce((sum, item) => sum + item.h, 0) + (index === 0 ? errOpen : errCont),
  }))
  const last = opportunityPages[opportunityPages.length - 1]
  const remain = cap - (last?.used || 0)
  const errorsFit = errorPages.length === 1 && remain >= errorPages[0].used + 8
  return {
    opportunityPages,
    errorPages: errorsFit ? [] : errorPages,
    merged: errorsFit,
  }
}

export default function DailyScanReport({ report, onClose }) {
  const probeRef = useRef(null)
  const [layout, setLayout] = useState(null)

  const opportunities = Array.isArray(report?.softwareOpportunities) ? report.softwareOpportunities : NO_ROWS
  const errors = Array.isArray(report?.errors) ? report.errors : NO_ROWS
  const showsRecord = opportunities.some((row) => row.previouslySaved === true || row.previouslySaved === false)

  useLayoutEffect(() => {
    if (!report || !probeRef.current) return undefined
    let cancelled = false
    const measure = () => {
      if (cancelled || !probeRef.current) return
      setLayout(measurePublication(probeRef.current, opportunities.length, errors.length))
    }
    measure()
    const ready = document.fonts?.ready
    if (ready) ready.then(measure)
    return () => {
      cancelled = true
    }
  }, [report, opportunities, errors])

  if (!report) {
    return (
      <ReportShell title="Daily Scan Report" onClose={onClose}>
        <p className="report-note">No daily scan report is stored for this selection.</p>
      </ReportShell>
    )
  }

  const counts = report.counts || {}
  const legacy = report.legacy && typeof report.legacy === 'object' ? report.legacy : null
  const duration = formatReportDuration(report.durationMs)
  const reason = completionReasonLabel(report.completionReason)
  const hasMatchingCount = Number.isFinite(Number(counts.matchingSoftware))
  const savedNote = Number.isFinite(Number(counts.alreadyProcessed))
    ? `Already saved notices in this run: ${counts.alreadyProcessed}. They are not included again in the Software count.`
    : null
  const pages = layout || {
    opportunityPages: [{ continued: false, indexes: opportunities.map((_, index) => index), used: 0 }],
    errorPages: [{ continued: false, indexes: errors.map((_, index) => index), used: 0 }],
    merged: false,
  }
  let pageNo = 1
  const coverNo = pageNo
  pageNo += 1
  const opportunityNumbers = pages.opportunityPages.map(() => pageNo++)
  const errorNumbers = pages.errorPages.map(() => pageNo++)
  const supportRows = legacy
    ? [
      ['Software', countText(legacy.software)],
      ['Not relevant', countText(legacy.notRelevant)],
      ['Review', countText(legacy.review)],
      ['Duplicates skipped', countText(legacy.duplicatesSkipped)],
      ['Errors', countText(legacy.errors)],
    ]
    : [
      ['Matching software opportunities', countText(hasMatchingCount ? counts.matchingSoftware : opportunities.length)],
      ['Review', countText(counts.review)],
      ['Not relevant', countText(counts.notRelevant)],
      ['Errors', countText(counts.errors)],
      ['Documents downloaded', countText(counts.documentsDownloaded)],
    ]

  return (
    <ReportShell
      title="Daily Scan Report"
      snapshot
      generatedAt={report.generatedAt || null}
      onClose={onClose}
      layout="weekly"
    >
      <div className="pub-stage">
        <section className="pub-page pub-page-dark">
          <div className="pub-page-body pub-dark-body">
            <header className="pub-mast">
              <img className="pub-logo" src={logoUrl} alt="Trustera Solutions, Inc." />
              <div>
                <p>Trustera Solutions, Inc.</p>
                <p>PhilGEPS Procurement Automation</p>
              </div>
            </header>
            <p className="pub-kicker">Daily report</p>
            <h1 className="pub-display">
              Daily
              <br />
              Scan
              <br />
              Report
            </h1>
            <p className="pub-period">{legacy ? `Open notices, ${legacy.pageLimit || 'not recorded'} page limit` : periodLabel(report.from, report.to)}</p>
            <p className="pub-meta">{report.sourceLabel || 'Current PhilGEPS'}</p>
            <p className="pub-meta">Started {report.startedAt ? formatManilaTimestamp(report.startedAt) : 'Not recorded'}</p>
            <p className="pub-meta">Completed {report.finishedAt ? formatManilaTimestamp(report.finishedAt) : 'Not recorded'}</p>
            <p className="pub-meta">Generated {report.generatedAt ? formatManilaTimestamp(report.generatedAt) : 'Not recorded'}</p>
            <p className="pub-meta">
              Completion {completionLabel(report)}{reason ? ` · ${reason}` : ''}
            </p>
            <p className="pub-meta">Duration {duration || 'Not recorded'}</p>

            {legacy ? (
              <div className="pub-stats">
                <div>
                  <b>{countText(legacy.pagesVisited)}</b>
                  <span>Pages visited</span>
                </div>
                <div>
                  <b>{countText(legacy.noticesInspected)}</b>
                  <span>Notices inspected</span>
                </div>
                <div>
                  <b>{countText(legacy.smallValueFound)}</b>
                  <span>Small Value notices</span>
                </div>
                <div>
                  <b>{countText(legacy.noticesSaved)}</b>
                  <span>Notices saved</span>
                </div>
              </div>
            ) : (
            <div className="pub-stats">
              <div>
                <b>{countText(counts.discovered)}</b>
                <span>Notices found in range</span>
              </div>
              <div>
                <b>{countText(counts.processed)}</b>
                <span>Notices processed</span>
              </div>
              <div>
                <b>{countText(counts.software)}</b>
                <span>New software</span>
              </div>
              <div>
                <b>{countText(counts.alreadyProcessed)}</b>
                <span>Previously saved notices</span>
              </div>
            </div>
            )}

            <div className="pub-support">
              <p className="pub-kicker">Supporting figures</p>
              <dl>
                {supportRows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {legacy ? (
              <div className="pub-method">
                <p className="pub-kicker">Reporting notes</p>
                <p>Only public open notices were scanned. Each page lists about 20 notices. Login-protected attachments were not requested.</p>
              </div>
            ) : hasMatchingCount || savedNote || showsRecord ? (
              <div className="pub-method">
                <p className="pub-kicker">Reporting notes</p>
                <div className="pub-method-grid">
                  {hasMatchingCount ? <p>{MATCHING_NOTE}</p> : null}
                  {!hasMatchingCount && savedNote ? <p>{savedNote}</p> : null}
                  {showsRecord ? <p>{RECORD_NOTE}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
          <PageFooter pageNo={coverNo} dark />
        </section>

        {pages.opportunityPages.map((chunk, index) => (
          <WhitePage key={`opp-${chunk.continued ? 'c' : 'a'}-${index}`} pageNo={opportunityNumbers[index]}>
            <header className="pub-page-head">
              <p className="pub-kicker-dark">{OPP_SECTION}</p>
              <h2>{chunk.continued ? 'Software opportunities, continued' : 'Software opportunities'}</h2>
            </header>
            {opportunities.length === 0 ? (
              <p className="pub-note">{EMPTY_OPPORTUNITIES}</p>
            ) : (
              <OpportunityTable
                rows={chunk.indexes.map((rowIndex) => opportunities[rowIndex])}
                showsRecord={showsRecord}
              />
            )}
            {pages.merged && index === pages.opportunityPages.length - 1 ? (
              <div className="pub-exceptions-follow">
                <header className="pub-page-head">
                  <p className="pub-kicker-dark">{ERR_SECTION}</p>
                  <h2>Processing errors</h2>
                </header>
                {errors.length === 0 ? (
                  <p className="pub-note">{EMPTY_ERRORS}</p>
                ) : (
                  <ErrorTable rows={errors} />
                )}
              </div>
            ) : null}
          </WhitePage>
        ))}

        {pages.errorPages.map((chunk, index) => (
          <WhitePage key={`err-${chunk.continued ? 'c' : 'a'}-${index}`} pageNo={errorNumbers[index]}>
            <header className="pub-page-head">
              <p className="pub-kicker-dark">{ERR_SECTION}</p>
              <h2>{chunk.continued ? 'Processing errors, continued' : 'Processing errors'}</h2>
            </header>
            {errors.length === 0 ? (
              <p className="pub-note">{EMPTY_ERRORS}</p>
            ) : (
              <ErrorTable rows={chunk.indexes.map((rowIndex) => errors[rowIndex])} />
            )}
          </WhitePage>
        ))}
      </div>

      <div className="pub-probe" ref={probeRef} aria-hidden="true">
        <div className="pub-probe-cap" data-cap />
        <div className="pub-probe-column">
          <div data-block="opp-open">
            <header className="pub-page-head">
              <p className="pub-kicker-dark">{OPP_SECTION}</p>
              <h2>Software opportunities</h2>
            </header>
            {opportunities.length === 0 ? <p className="pub-note">{EMPTY_OPPORTUNITIES}</p> : null}
          </div>
          <div data-block="opp-cont">
            <header className="pub-page-head">
              <p className="pub-kicker-dark">{OPP_SECTION}</p>
              <h2>Software opportunities, continued</h2>
            </header>
          </div>
          {opportunities.length > 0 ? (
            <table className="pub-table pub-table-scan">
              <colgroup>
                <col />
                <col />
                <col />
                <col />
                <col />
                {showsRecord ? <col /> : null}
              </colgroup>
              <thead data-opp-head>
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
                {opportunities.map((row, index) => (
                  <tr key={row.referenceNumber || `probe-opp-${index}`} data-opp={index}>
                    <td>
              {row.referenceNumber || 'Not recorded'}
              <div>{row.portalLabel || 'Current PhilGEPS'}</div>
            </td>
                    <td>
              {row.title || 'Not recorded'}
              {currentClassificationNote(row) ? <span className="pub-reclass">{currentClassificationNote(row)}</span> : null}
            </td>
                    <td>{row.organization || 'Not recorded'}</td>
                    <td>{classificationSourceLabel(row.source)}</td>
                    <td>{reviewStateLabel(row.reviewStatus)}</td>
                    {showsRecord ? <td>{savedRecordLabel(row.previouslySaved)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div data-block="err-open">
            <header className="pub-page-head">
              <p className="pub-kicker-dark">{ERR_SECTION}</p>
              <h2>Processing errors</h2>
            </header>
            {errors.length === 0 ? <p className="pub-note">{EMPTY_ERRORS}</p> : null}
          </div>
          <div data-block="err-cont">
            <header className="pub-page-head">
              <p className="pub-kicker-dark">{ERR_SECTION}</p>
              <h2>Processing errors, continued</h2>
            </header>
          </div>
          {errors.length > 0 ? (
            <table className="pub-table pub-table-scan pub-table-errors">
              <thead data-err-head>
                <tr>
                  <th>Notice</th>
                  <th>Recorded message</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error, index) => (
                  <tr key={`${error.referenceNumber || 'probe'}-${index}`} data-err={index}>
                    <td>{error.referenceNumber || 'Scan'}</td>
                    <td>{error.message || 'Not recorded'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </ReportShell>
  )
}
