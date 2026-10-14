import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import logoUrl from '../assets/trustera-logo.png'
import { DATE_SOURCE_ISO, formatLongDate, formatPeso } from '../format.js'
import ReportShell, { ReportButton } from './ReportShell.jsx'
import {
  completionReasonLabel,
  countText,
  formatManilaTimestamp,
  formatReportDetailDate,
} from './report-format.js'
import './print.css'
import './publication.css'
import { apiFetch } from '../api.js'

function recorded(value) {
  if (value == null || String(value).trim() === '') return 'Not recorded'
  return String(value)
}

function abcText(value) {
  if (value == null || String(value).trim() === '') return 'Not recorded'
  const formatted = formatPeso(value)
  return formatted === '—' ? recorded(value) : formatted
}

function classificationText(value) {
  if (value === 'software') return 'Software'
  if (value === 'review') return 'Review'
  if (value === 'not relevant') return 'Not Relevant'
  return recorded(value)
}

function workStatusText(value) {
  if (value === 'new') return 'New'
  if (value === 'in-progress') return 'In progress'
  if (value === 'done') return 'Done'
  return 'Not recorded'
}

function extractionText(value) {
  if (value === 'complete') return 'Complete'
  if (value === 'partial') return 'Partial'
  if (value === 'needs_review') return 'Needs review'
  return recorded(value)
}

function shiftIsoDay(isoDay, days) {
  const match = String(isoDay || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function eventFigure(events) {
  if (!events) return { figure: 'Not recorded', note: '' }
  const figure = countText(events.total)
  const note = events.missingScans > 0
    ? `Recorded on ${events.recordedScans} of ${events.recordedScans + events.missingScans} scans`
    : ''
  return { figure, note }
}

function eventLine(events) {
  const { figure, note } = eventFigure(events)
  return note ? `${figure}, ${note.charAt(0).toLowerCase()}${note.slice(1)}` : figure
}

function classificationStatus(row) {
  if (row?.packetFound === false || row?.classification == null || String(row.classification).trim() === '') {
    return { missing: true, reclassified: false, label: 'Current classification not recorded' }
  }
  const label = classificationText(row.classification)
  if (row.classification === 'not relevant') return { missing: false, reclassified: true, label }
  if (row.classification !== 'software') return { missing: false, reclassified: true, label }
  return { missing: false, reclassified: false, label }
}

function NoticeEntry({ row }) {
  const status = classificationStatus(row)
  return (
    <article className="pub-notice">
      <div className="pub-notice-top">
        <p>{recorded(row.referenceNumber)}</p>
        <p>{row.portalLabel || 'Current PhilGEPS'}</p>
        <p>{status.missing ? status.label : status.reclassified ? `Current: ${status.label}` : status.label}</p>
      </div>
      <h3>{recorded(row.title)}</h3>
      {status.reclassified ? (
        <p className="pub-reclass">
          {row.classification === 'not relevant'
            ? 'Scan classification: Software. Current classification: Not Relevant. Not a current software opportunity.'
            : `Scan classification: Software. Current classification: ${status.label}.`}
        </p>
      ) : null}
      <p className="pub-notice-agency">{recorded(row.organization)}</p>
      <dl className="pub-notice-meta">
        <div>
          <dt>ABC</dt>
          <dd>{abcText(row.abc)}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{row.deadline ? formatReportDetailDate(row.deadline) : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Work status</dt>
          <dd>{workStatusText(row.workStatus)}</dd>
        </div>
        <div>
          <dt>Extraction</dt>
          <dd>{extractionText(row.extractionStatus)}</dd>
        </div>
      </dl>
    </article>
  )
}

function RuledTable({ columns, rows, wideFirst = false }) {
  return (
    <table className={wideFirst ? 'pub-table pub-table-wide-first' : 'pub-table'}>
      <thead>
        <tr>
          {columns.map((column) => <th key={column}>{column}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {row.cells.map((cell, index) => <td key={`${row.key}-${index}`}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
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
      <aside className="pub-rail" aria-hidden="true"><span>Weekly Report</span></aside>
      <div className="pub-rail-print" aria-hidden="true" />
      <PageFooter pageNo={pageNo} />
    </section>
  )
}

const OPP_INTRO = 'These notices were identified as new software by a scan this week. Classification and work status are the labels stored now, so a later manual change can show Not Relevant without removing the notice. Extraction status comes from the stored requirements file. A missing extraction status is not a failed scan.'

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

function packBlocks(blocks, openH, contH, cap) {
  const pages = []
  let page = []
  let used = openH
  blocks.forEach((block) => {
    if (page.length > 0 && used + block.h > cap) {
      pages.push(page)
      page = []
      used = contH
    }
    page.push(block)
    used += block.h
  })
  if (page.length) pages.push(page)
  return pages.map((chunk, index) => ({
    continued: index > 0,
    blocks: chunk,
    used: chunk.reduce((sum, block) => sum + block.h, 0) + (index === 0 ? openH : contH),
  }))
}

function composePublication(root) {
  const cap = heightOf(root, '[data-cap]') - 4
  const oppOpen = heightOf(root, '[data-block="opp-open"]')
  const oppCont = heightOf(root, '[data-block="opp-cont"]')
  const notices = [...root.querySelectorAll('[data-notice]')].map((node) => ({
    id: node.dataset.notice,
    h: node.getBoundingClientRect().height,
  }))
  const opportunityPages = packSequence(notices, oppOpen, oppCont, cap).map((chunk, index) => ({
    continued: index > 0,
    ids: chunk.map((item) => item.id),
    used: chunk.reduce((sum, item) => sum + item.h, 0) + (index === 0 ? oppOpen : oppCont),
  }))

  const blockNodes = [...root.querySelectorAll('[data-exc]')]
  const blocks = blockNodes.map((node) => ({
    key: node.dataset.exc,
    h: node.getBoundingClientRect().height,
  }))
  const excOpen = heightOf(root, '[data-block="exc-open"]')
  const excCont = heightOf(root, '[data-block="exc-cont"]')
  let exceptionPages = packBlocks(blocks, excOpen, excCont, cap)

  const lastOpp = opportunityPages[opportunityPages.length - 1]
  const remain = cap - (lastOpp?.used || 0)
  const exceptionsFit = exceptionPages.length === 1 && remain >= exceptionPages[0].used + 8 && remain >= 150
  let merged = false
  if (exceptionsFit) {
    merged = true
    exceptionPages = []
  }

  return { opportunityPages, exceptionPages, merged }
}

function blocksToNodes(blocks, unknownRows, errorRows) {
  const nodes = []
  let index = 0
  while (index < blocks.length) {
    const key = blocks[index].key
    if (key.startsWith('unknown-row-') || key.startsWith('error-row-')) {
      const prefix = key.startsWith('unknown-row-') ? 'unknown-row-' : 'error-row-'
      const indexes = []
      while (index < blocks.length && blocks[index].key.startsWith(prefix)) {
        indexes.push(Number(blocks[index].key.slice(prefix.length)))
        index += 1
      }
      const source = prefix.startsWith('unknown') ? unknownRows : errorRows
      nodes.push({
        key: `${prefix}${indexes[0]}`,
        columns: prefix.startsWith('unknown')
          ? ['Notice', 'Agency', 'Title']
          : ['Scan started', 'Notice', 'Recorded message'],
        wideFirst: prefix.startsWith('error'),
        rows: indexes.map((rowIndex) => source[rowIndex]),
      })
    } else {
      nodes.push({ key })
      index += 1
    }
  }
  return nodes
}

function ExceptionBlocks({ blocks, unknownRows, errorRows }) {
  return blocksToNodes(blocks, unknownRows, errorRows).map((node) => {
    if (node.key === 'unknown-head') {
      return (
        <div key={node.key} className="pub-subsection">
          <p className="pub-bar">Unknown record</p>
          <p className="pub-note">These rows did not say whether the notice was new or already saved. They are not counted as newly identified.</p>
        </div>
      )
    }
    if (node.key === 'unknown-empty') {
      return <p key={node.key} className="pub-note">No software rows with an unknown record were stored for this week.</p>
    }
    if (node.key === 'error-head') {
      return (
        <div key={node.key} className="pub-subsection">
          <p className="pub-bar">Scan errors</p>
        </div>
      )
    }
    if (node.key === 'error-empty') {
      return <p key={node.key} className="pub-note">No scan errors were recorded.</p>
    }
    if (node.rows) {
      return (
        <RuledTable
          key={node.key}
          columns={node.columns}
          rows={node.rows}
          wideFirst={node.wideFirst}
        />
      )
    }
    return null
  })
}

export default function WeeklyReport({ onClose }) {
  const [from, setFrom] = useState(null)
  const [report, setReport] = useState(null)
  const [state, setState] = useState('loading')
  const [layout, setLayout] = useState(null)
  const probeRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setLayout(null)
    const query = from ? `?from=${encodeURIComponent(from)}` : ''
    apiFetch(`/api/scan/reports/weekly${query}`)
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load weekly report')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setReport(body)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [from])

  const opportunities = Array.isArray(report?.opportunities) ? report.opportunities : []
  const unknownSoftware = Array.isArray(report?.unknownSoftware) ? report.unknownSoftware : []
  const errors = Array.isArray(report?.errors) ? report.errors : []

  useLayoutEffect(() => {
    if (!report || !probeRef.current) return undefined
    let cancelled = false
    const measure = () => {
      if (cancelled || !probeRef.current) return
      setLayout(composePublication(probeRef.current))
    }
    measure()
    const ready = document.fonts?.ready
    if (ready) ready.then(measure)
    return () => {
      cancelled = true
    }
  }, [report])

  const period = report?.period
  const weekNav = (
    <span className="report-week-nav">
      <ReportButton
        onClick={() => setFrom(period ? shiftIsoDay(period.from, -7) : null)}
        disabled={!period}
      >
        Previous week
      </ReportButton>
      <ReportButton onClick={() => setFrom(null)}>Current week</ReportButton>
      <ReportButton
        onClick={() => setFrom(period ? shiftIsoDay(period.from, 7) : null)}
        disabled={!period}
      >
        Next week
      </ReportButton>
    </span>
  )

  if (!report) {
    return (
      <div className="report-root">
        <div className="report-toolbar no-print">
          <ReportButton onClick={onClose}>Back</ReportButton>
        </div>
        <p className="state-line mono">
          {state === 'error' ? 'This weekly report could not be loaded.' : 'Loading weekly report...'}
        </p>
      </div>
    )
  }

  const scans = report.scans || {}
  const software = report.software || {}
  const events = report.classificationEvents || {}
  const work = report.workStatus || {}
  const incompleteRuns = Array.isArray(scans.incompleteRuns) ? scans.incompleteRuns : []
  const periodLabel = period?.from && period?.to
    ? `${formatLongDate(period.from, DATE_SOURCE_ISO)} to ${formatLongDate(period.to, DATE_SOURCE_ISO)}`
    : 'Not recorded'
  const generatedLabel = report.generatedAt ? formatManilaTimestamp(report.generatedAt) : 'Not recorded'
  const review = eventFigure(events.review)
  const noticeById = new Map(opportunities.map((row, index) => [row.referenceNumber || `row-${index}`, row]))
  const unknownRows = unknownSoftware.map((row, index) => ({
    key: row.referenceNumber || `unknown-${index}`,
    cells: [recorded(row.referenceNumber), recorded(row.organization), recorded(row.title)],
  }))
  const errorRows = errors.map((error, index) => ({
    key: `${error.scanId || 'scan'}-${error.referenceNumber || index}`,
    cells: [
      error.startedAt ? formatManilaTimestamp(error.startedAt) : 'Not recorded',
      error.referenceNumber || 'Scan',
      recorded(error.message),
    ],
  }))

  const supportRows = [
    ['Completed scans', countText(scans.completed)],
    ['Incomplete scans', countText(scans.incomplete)],
    ['Unknown record', countText(software.unknownRecord)],
    ['Not Relevant scan events', eventLine(events.notRelevant)],
    ['Work status, new', countText(work.new)],
    ['Work status, in progress', countText(work.inProgress)],
    ['Work status, done', countText(work.done)],
    ['Work status, not recorded', countText(work.notRecorded)],
  ]

  const exceptionBlocks = [
    { key: 'unknown-head' },
    ...(unknownRows.length
      ? unknownRows.map((row, index) => ({ key: `unknown-row-${index}` }))
      : [{ key: 'unknown-empty' }]),
    { key: 'error-head' },
    ...(errorRows.length
      ? errorRows.map((row, index) => ({ key: `error-row-${index}` }))
      : [{ key: 'error-empty' }]),
  ]

  const pages = layout || {
    opportunityPages: [{ continued: false, ids: opportunities.map((row, index) => row.referenceNumber || `row-${index}`), used: 0 }],
    exceptionPages: [{ continued: false, blocks: exceptionBlocks, used: 0 }],
    merged: false,
  }

  let pageNo = 1
  const overviewNo = pageNo
  pageNo += 1
  const opportunityNumbers = pages.opportunityPages.map(() => pageNo++)
  const exceptionNumbers = pages.exceptionPages.map(() => pageNo++)

  return (
    <ReportShell
      title="Weekly Procurement Report"
      snapshot
      generatedAt={report.generatedAt || null}
      onClose={onClose}
      toolbar={weekNav}
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
            <p className="pub-kicker">Weekly report</p>
            <h1 className="pub-display">
              Weekly
              <br />
              Procurement
              <br />
              Report
            </h1>
            <p className="pub-period">{periodLabel}</p>
            <p className="pub-meta">{report?.sourceLabel || 'Current PhilGEPS'}</p>
            <p className="pub-meta">Generated {generatedLabel}</p>
            <p className="pub-meta">Asia/Manila, Monday through Sunday</p>

            <div className="pub-stats">
              <div>
                <b>{countText(scans.total)}</b>
                <span>Scan runs</span>
              </div>
              <div>
                <b>{countText(software.newlyIdentified)}</b>
                <span>Newly identified software</span>
              </div>
              <div>
                <b>{countText(software.previouslySaved)}</b>
                <span>Previously saved software</span>
              </div>
              <div>
                <b>{review.figure}</b>
                <span>Review scan events{review.note ? `. ${review.note}` : ''}</span>
              </div>
            </div>

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

            <div className="pub-method">
              <p className="pub-kicker">Reporting methodology</p>
              <div className="pub-method-grid">
                <p>A scan is included when it started during this week. Publication dates are not used as discovery dates.</p>
                <p>A unique count of every notice discovered this week is not available. Snapshots do not keep every notice id.</p>
                <p>Newly identified and previously saved software are unique reference numbers. A missing saved-or-new flag stays Unknown and is not counted as new.</p>
                <p>Review and Not Relevant totals add each scan&apos;s stored count. They are scan events, not unique notices. Not Relevant can repeat when an unsaved notice is seen again.</p>
                <p>Work status is the status stored now for newly identified software. It is not the status from the week of the scan.</p>
                {incompleteRuns.length === 0 ? (
                  <p>No incomplete scans were recorded. An incomplete scan is not the same as a notice error inside a completed scan.</p>
                ) : (
                  <div>
                    <p>Incomplete scans are listed below. An incomplete scan is not the same as a notice error inside a completed scan.</p>
                    <ul>
                      {incompleteRuns.map((run) => (
                        <li key={run.id || run.startedAt}>
                          {run.startedAt ? formatManilaTimestamp(run.startedAt) : 'Not recorded'}
                          {' · '}
                          {completionReasonLabel(run.completionReason) || 'Incomplete'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
          <PageFooter pageNo={overviewNo} dark />
        </section>

        {pages.opportunityPages.map((chunk, index) => (
          <WhitePage key={`opp-${chunk.continued ? 'c' : 'a'}-${index}`} pageNo={opportunityNumbers[index]}>
            <header className="pub-page-head">
              <p className="pub-kicker-dark">02</p>
              <h2>{chunk.continued ? 'Procurement Opportunities — Continued' : 'Procurement Opportunities'}</h2>
            </header>
            {chunk.continued ? null : <p className="pub-intro">{OPP_INTRO}</p>}
            {chunk.ids.length === 0 ? (
              <p className="pub-note">No newly identified software opportunities were recorded for this week.</p>
            ) : (
              chunk.ids.map((id) => <NoticeEntry key={id} row={noticeById.get(id)} />)
            )}
            {pages.merged && index === pages.opportunityPages.length - 1 ? (
              <div className="pub-exceptions-follow">
                <header className="pub-page-head">
                  <p className="pub-kicker-dark">03</p>
                  <h2>Additional Records and Exceptions</h2>
                </header>
                <ExceptionBlocks blocks={exceptionBlocks} unknownRows={unknownRows} errorRows={errorRows} />
              </div>
            ) : null}
          </WhitePage>
        ))}

        {pages.exceptionPages.map((chunk, index) => (
          <WhitePage key={`exc-${index}`} pageNo={exceptionNumbers[index]}>
            <header className="pub-page-head">
              <p className="pub-kicker-dark">03</p>
              <h2>{chunk.continued ? 'Additional Records and Exceptions — Continued' : 'Additional Records and Exceptions'}</h2>
            </header>
            <ExceptionBlocks blocks={chunk.blocks} unknownRows={unknownRows} errorRows={errorRows} />
          </WhitePage>
        ))}
      </div>

      <div className="pub-probe" ref={probeRef} aria-hidden="true">
        <div className="pub-probe-cap" data-cap />
        <div className="pub-probe-column">
          <div data-block="opp-open">
            <header className="pub-page-head">
              <p className="pub-kicker-dark">02</p>
              <h2>Procurement Opportunities</h2>
            </header>
            <p className="pub-intro">{OPP_INTRO}</p>
          </div>
          <div data-block="opp-cont">
            <header className="pub-page-head">
              <p className="pub-kicker-dark">02</p>
              <h2>Procurement Opportunities — Continued</h2>
            </header>
          </div>
          {opportunities.map((row, index) => (
            <div key={row.referenceNumber || `row-${index}`} data-notice={row.referenceNumber || `row-${index}`}>
              <NoticeEntry row={row} />
            </div>
          ))}
          <div data-block="exc-open">
            <header className="pub-page-head">
              <p className="pub-kicker-dark">03</p>
              <h2>Additional Records and Exceptions</h2>
            </header>
          </div>
          <div data-block="exc-cont">
            <header className="pub-page-head">
              <p className="pub-kicker-dark">02</p>
              <h2>Additional Records and Exceptions — Continued</h2>
            </header>
          </div>
          {exceptionBlocks.map((block) => (
            <div key={block.key} data-exc={block.key}>
              <ExceptionBlocks blocks={[block]} unknownRows={unknownRows} errorRows={errorRows} />
            </div>
          ))}
        </div>
      </div>
    </ReportShell>
  )
}
