import { useEffect, useRef, useState } from 'react'
import LineHoverText from './LineHoverText.jsx'

const THEME_KEY = 'philgeps-theme'

function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export default function Header({ online, scanning, onShowOpportunities, onShowSoftware }) {
  const opportunitiesRef = useRef(null)
  const softwareRef = useRef(null)
  const themeRef = useRef(null)
  const [theme, setTheme] = useState(storedTheme)
  let status = 'CHECKING'
  if (online === true) status = scanning ? 'SCANNING' : 'ONLINE'
  if (online === false) status = 'OFFLINE'

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
    <header className="masthead">
      <div className="masthead-brand">
        <p className="mono">PhilGEPS / 001</p>
        <p className="masthead-title display">Procurement Intelligence</p>
      </div>
      <nav className="masthead-nav" aria-label="Sections">
        <button
          type="button"
          className="nav-link mono"
          onClick={onShowOpportunities}
          onMouseEnter={() => opportunitiesRef.current?.play()}
          onFocus={() => opportunitiesRef.current?.play()}
        >
          <LineHoverText ref={opportunitiesRef} text="Opportunities" />
        </button>
        <button
          type="button"
          className="nav-link mono"
          onClick={onShowSoftware}
          onMouseEnter={() => softwareRef.current?.play()}
          onFocus={() => softwareRef.current?.play()}
        >
          <LineHoverText ref={softwareRef} text="Software" />
        </button>
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
        {status}
      </p>
    </header>
  )
}
