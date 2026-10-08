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
  children,
}) {
  const generatedLabel = snapshot
    ? (generatedAt ? formatManilaTimestamp(generatedAt) : 'Not recorded')
    : formatGeneratedAt(generatedAt)
  return (
    <div className="report-root">
      <div className="report-toolbar no-print">
        <ReportButton onClick={onClose}>Back</ReportButton>
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
