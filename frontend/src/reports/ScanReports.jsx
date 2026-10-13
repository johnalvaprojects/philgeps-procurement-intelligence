import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import DailyScanReport from './DailyScanReport.jsx'
import WeeklyReport from './WeeklyReport.jsx'
import { ReportButton } from './ReportShell.jsx'
import { compactWindow, completionLabel, countText } from './report-format.js'
import { apiFetch } from '../api.js'
import './print.css'

export default function ScanReports({ onClose }) {
  const [reports, setReports] = useState([])
  const [state, setState] = useState('loading')
  const [selectedId, setSelectedId] = useState(null)
  const [report, setReport] = useState(null)
  const [reportState, setReportState] = useState('idle')
  const [weeklyOpen, setWeeklyOpen] = useState(() => (
    new URLSearchParams(window.location.search).get('view') === 'weekly'
  ))
  const [portal, setPortal] = useState('all')
  const visibleReports = reports.filter((item) => {
    if (portal === 'all') return true
    return (item.source || 'current') === portal
  })

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/scan/reports')
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load scan reports')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setReports(Array.isArray(body) ? body : [])
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedId) return undefined
    let cancelled = false
    setReportState('loading')
    apiFetch(`/api/scan/reports/${encodeURIComponent(selectedId)}`)
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load scan report')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setReport(body)
        setReportState('ready')
      })
      .catch(() => {
        if (!cancelled) setReportState('error')
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  if (weeklyOpen) {
    return createPortal(
      <WeeklyReport onClose={() => setWeeklyOpen(false)} />,
      document.body,
    )
  }

  if (selectedId) {
    if (reportState === 'loading') {
      return <p className="state-line mono reports-workspace">Loading scan report...</p>
    }
    if (reportState === 'error') {
      return (
        <div className="reports-workspace">
          <p className="state-line mono">This scan report is not stored.</p>
          <ReportButton onClick={() => setSelectedId(null)}>Back</ReportButton>
        </div>
      )
    }
    return createPortal(
      <DailyScanReport report={report} onClose={() => setSelectedId(null)} />,
      document.body,
    )
  }

  return (
    <section className="reports-workspace" aria-labelledby="scan-reports-title">
      <header className="reports-workspace-head">
        <div>
          <p className="mono reports-workspace-kicker">Operations</p>
          <h1 id="scan-reports-title">Daily scan reports</h1>
          <p className="report-note">
            Reports are saved when a scan finishes. Earlier scans were not reconstructed.
          </p>
        </div>
        <div className="reports-workspace-actions">
          <ReportButton onClick={() => setWeeklyOpen(true)}>Weekly report</ReportButton>
          <ReportButton onClick={onClose}>Back to notices</ReportButton>
        </div>
      </header>
      {state === 'loading' ? <p className="state-line mono">Loading scan reports...</p> : null}
      {state === 'error' ? <p className="state-line mono">Unable to load scan reports.</p> : null}
      {state === 'ready' ? (
        <div className="filter-group" role="group" aria-label="Portal filter">
          {[
            ['all', 'All'],
            ['current', 'Current PhilGEPS'],
            ['legacy', 'Old PhilGEPS'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={portal === value ? 'filter mono is-active' : 'filter mono'}
              aria-pressed={portal === value}
              onClick={() => setPortal(value)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {state === 'ready' && reports.length === 0 ? (
        <p className="state-line mono">No daily scan report is stored.</p>
      ) : null}
      {state === 'ready' && reports.length > 0 && visibleReports.length === 0 ? (
        <p className="state-line mono">No reports for this portal.</p>
      ) : null}
      {state === 'ready' && visibleReports.length > 0 ? (
        <table className="report-index">
          <thead>
            <tr>
              <th>Portal</th>
              <th>Scan range</th>
              <th>Status</th>
              <th>Software</th>
              <th>Review</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {visibleReports.map((item) => (
              <tr key={item.id}>
                <td data-label="Portal">{item.sourceLabel || 'Current PhilGEPS'}</td>
                <td data-label="Scan range">
                  <button type="button" onClick={() => {
                    setReport(null)
                    setReportState('loading')
                    setSelectedId(item.id)
                  }}>
                    {item.source === 'legacy' && item.pageLimit
                      ? `Open notices / ${item.pageLimit} ${item.pageLimit === 1 ? 'page' : 'pages'}`
                      : item.from || item.to
                        ? compactWindow(item.from, item.to)
                        : 'Range not recorded'}
                  </button>
                </td>
                <td data-label="Status">{completionLabel(item)}</td>
                <td data-label="Software">{countText(item.counts?.software)}</td>
                <td data-label="Review">{countText(item.counts?.review)}</td>
                <td data-label="Errors">{countText(item.counts?.errors)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
