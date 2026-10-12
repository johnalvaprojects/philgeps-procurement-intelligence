import { useRef } from 'react'
import LineHoverText from '../components/LineHoverText.jsx'
import logoUrl from '../assets/trustera-logo.png'
import { formatGeneratedAt, formatManilaTimestamp } from './report-format.js'

export function ReportButton({ children, primary = false, className = '', ...props }) {
  const textRef = useRef(null)
  const classes = `report-button${primary ? ' report-button-primary' : ''}${className ? ` ${className}` : ''}`
  return (
    <button
      type="button"
      className={classes}
      {...props}
      onMouseEnter={() => textRef.current?.play()}
      onFocus={() => textRef.current?.play()}
    >
      <LineHoverText ref={textRef} text={typeof children === 'string' ? children.trim() : String(children)} />
    </button>
  )
}

export default function ReportShell({
  title,
  generatedAt = new Date(),
  snapshot = false,
  onPrint,
  onClose,
  toolbar = null,
  layout,
  meta = null,
  children,
}) {
  const generatedLabel = snapshot
    ? (generatedAt ? formatManilaTimestamp(generatedAt) : 'Not recorded')
    : formatGeneratedAt(generatedAt)
  const weekly = layout === 'weekly'
  if (weekly) {
    return (
      <div className="report-root report-root-weekly">
        <div className="report-toolbar no-print">
          <ReportButton onClick={onClose}>Back</ReportButton>
          {toolbar}
          <ReportButton primary onClick={onPrint || (() => window.print())}>Print / Save PDF</ReportButton>
        </div>
        {children}
      </div>
    )
  }
  return (
    <div className="report-root">
      <div className="report-toolbar no-print">
        <ReportButton onClick={onClose}>Back</ReportButton>
        {toolbar}
        <ReportButton primary onClick={onPrint || (() => window.print())}>Print / Save PDF</ReportButton>
      </div>
      <article className="report-sheet">
        <header className="report-header">
          <div className="report-logo-frame">
            <img className="report-logo" src={logoUrl} alt="Trustera Solutions, Inc." />
          </div>
          <div className="report-heading">
            <p className="report-company">Trustera Solutions, Inc.</p>
            <h1 className="report-title">{title}</h1>
            <p className="report-generated">Generated {generatedLabel}</p>
            {meta}
          </div>
        </header>
        {children}
        <footer className="report-footer">
          <span>Trustera Solutions, Inc. · PhilGEPS Procurement Automation</span>
        </footer>
      </article>
    </div>
  )
}
