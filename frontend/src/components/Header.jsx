import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import LineHoverText from './LineHoverText.jsx'

const THEME_KEY = 'philgeps-theme'

function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export default function Header({
  online,
  scanning,
  scanRangeLabel = '',
  onShowOpportunities,
  onShowSoftware,
  onShowAwards,
  onShowMerchant,
  onShowReports,
  onSignOut,
}) {
  const noticesRef = useRef(null)
  const softwareRef = useRef(null)
  const awardsRef = useRef(null)
  const merchantRef = useRef(null)
  const reportsRef = useRef(null)
  const themeRef = useRef(null)
  const headerRef = useRef(null)
  const [theme, setTheme] = useState(storedTheme)
  let status = 'CHECKING'
  if (online === true) status = scanning ? 'SCANNING' : 'ONLINE'
  if (online === false) status = 'OFFLINE'
  const showRange = scanning && scanRangeLabel

  useLayoutEffect(() => {
    const node = headerRef.current
    if (!node) return undefined
    const apply = () => {
      document.documentElement.style.setProperty('--masthead-height', `${node.offsetHeight}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // The toggle still works for this visit if storage is blocked.
    }
  }, [theme])

  const themeLabel = theme === 'dark' ? 'Light' : 'Dark'

  return (
    <header className="masthead" ref={headerRef}>
      <div className="masthead-brand">
        <p className="mono">PhilGEPS / 001</p>
        <p className="masthead-title display">Procurement Intelligence</p>
      </div>
      <nav className="masthead-nav" aria-label="Sections">
        <button
          type="button"
          className="nav-link mono"
          onClick={onShowOpportunities}
          onMouseEnter={() => noticesRef.current?.play()}
          onFocus={() => noticesRef.current?.play()}
        >
          <LineHoverText ref={noticesRef} text="Notices" />
        </button>
        {onShowSoftware ? (
          <button
            type="button"
            className="nav-link mono"
            onClick={onShowSoftware}
            onMouseEnter={() => softwareRef.current?.play()}
            onFocus={() => softwareRef.current?.play()}
          >
            <LineHoverText ref={softwareRef} text="Software" />
          </button>
        ) : null}
        {onShowAwards ? (
          <button
            type="button"
            className="nav-link mono"
            onClick={onShowAwards}
            onMouseEnter={() => awardsRef.current?.play()}
            onFocus={() => awardsRef.current?.play()}
          >
            <LineHoverText ref={awardsRef} text="Awards" />
          </button>
        ) : null}
        {onShowMerchant ? (
          <button
            type="button"
            className="nav-link mono"
            onClick={onShowMerchant}
            onMouseEnter={() => merchantRef.current?.play()}
            onFocus={() => merchantRef.current?.play()}
          >
            <LineHoverText ref={merchantRef} text="Merchant" />
          </button>
        ) : null}
        {onShowReports ? (
          <button
            type="button"
            className="nav-link mono"
            onClick={onShowReports}
            onMouseEnter={() => reportsRef.current?.play()}
            onMouseLeave={() => reportsRef.current?.restore()}
            onBlur={() => reportsRef.current?.restore()}
          >
            <LineHoverText ref={reportsRef} text="Reports" />
          </button>
        ) : null}
        {onSignOut ? (
          <button type="button" className="nav-link mono" onClick={onSignOut}>
            Sign out
          </button>
        ) : null}
        <button
          type="button"
          className="nav-link mono"
          aria-pressed={theme === 'dark'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          onMouseEnter={() => themeRef.current?.play()}
          onFocus={() => themeRef.current?.play()}
        >
          <LineHoverText ref={themeRef} text={themeLabel} />
        </button>
      </nav>
      <p className={`system-status mono status-${online} ${scanning ? 'is-scanning' : ''}`} aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span className="system-status-copy">
          <span>{status}</span>
          {showRange ? <span className="system-status-range">{scanRangeLabel}</span> : null}
        </span>
      </p>
    </header>
  )
}
