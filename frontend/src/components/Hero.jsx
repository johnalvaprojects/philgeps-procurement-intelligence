import { useEffect, useRef, useState } from 'react'
import { padCount } from '../format.js'
import DateField from './DateField.jsx'

const HOLD_MS = 800

export default function Hero({
  total,
  state,
  scanning,
  scanError,
  scanFrom,
  scanTo,
  onScanFromChange,
  onScanToChange,
  onClearScanRange,
  onScan,
}) {
  const [phase, setPhase] = useState('idle')
  const [focused, setFocused] = useState(false)
  const holdTimer = useRef(null)
  const onScanRef = useRef(onScan)
  const scanningRef = useRef(scanning)

  let figure = padCount(total)
  if (state === 'loading') figure = '···'
  if (state === 'error') figure = '—'

  onScanRef.current = onScan
  scanningRef.current = scanning

  useEffect(() => () => {
    if (holdTimer.current != null) clearTimeout(holdTimer.current)
  }, [])

  useEffect(() => {
    if (scanning) setPhase('idle')
  }, [scanning])

  useEffect(() => {
    if (scanError) setPhase('idle')
  }, [scanError])

  function clearHoldTimer() {
    if (holdTimer.current == null) return false
    clearTimeout(holdTimer.current)
    holdTimer.current = null
    return true
  }

  function beginHold(target, pointerId) {
    if (scanningRef.current || holdTimer.current != null) return
    if (pointerId != null) {
      try {
        target.setPointerCapture(pointerId)
      } catch {
        // Pointer capture is unavailable for this event.
      }
    }
    setPhase('holding')
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      if (scanningRef.current) return
      setPhase('committed')
      onScanRef.current()
    }, HOLD_MS)
  }

  function cancelHold() {
    if (!clearHoldTimer()) return
    setPhase('idle')
  }

  function onPointerDown(event) {
    if (event.button !== 0) return
    beginHold(event.currentTarget, event.pointerId)
  }

  function onPointerUp() {
    cancelHold()
  }

  function onKeyDown(event) {
    if (event.repeat) return
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    beginHold(event.currentTarget, null)
  }

  function onKeyUp(event) {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    cancelHold()
  }

  function onBlur() {
    setFocused(false)
    cancelHold()
  }

  const busy = scanning || phase === 'committed'
  const holding = phase === 'holding'
  const className = [
    'scan-action',
    holding ? 'is-holding' : '',
    busy ? 'is-scanning' : '',
  ].filter(Boolean).join(' ')
  const accessibleLabel = busy ? 'Scanning...' : (holding || focused) ? 'Hold to scan' : 'Scan PhilGEPS'
  const rangeActive = Boolean(scanFrom || scanTo)

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-figure display" aria-hidden={state !== 'ready'}>
        {figure}
      </div>
      <div className="hero-copy">
        <h1 id="hero-title" className="display hero-title">
          Procurement
          <br />
          Opportunities.
        </h1>
        <p className="hero-lede">
          Software opportunities automatically identified from public PhilGEPS
          Small Value Procurement notices.
        </p>
        <div className="hero-actions">
          <div
            className={rangeActive ? 'scan-panel is-custom' : 'scan-panel'}
            role="group"
            aria-label="Scan publication date range"
          >
            <div className="scan-panel-meta">
              <span className="mono scan-panel-id">
                Scan <span className="scan-panel-slash" aria-hidden="true">/</span> 001
              </span>
              <div className="scan-panel-meta-right">
                <span className="mono scan-panel-mode">
                  Range <span className="scan-panel-slash" aria-hidden="true">/</span>{' '}
                  {rangeActive ? 'Custom' : 'Default'}
                </span>
                <button
                  type="button"
                  className={rangeActive ? 'scan-range-clear mono is-active' : 'scan-range-clear mono'}
                  onClick={onClearScanRange}
                  disabled={!rangeActive || busy}
                >
                  Use default
                </button>
              </div>
            </div>

            <div className="scan-panel-dates">
              <div className="scan-range-field">
                <span className="mono scan-range-key">From</span>
                <DateField
                  label="Scan from"
                  placeholder="DD.MM.YYYY"
                  value={scanFrom}
                  onChange={onScanFromChange}
                />
              </div>
              <span className="scan-range-sep" aria-hidden="true">→</span>
              <div className="scan-range-field">
                <span className="mono scan-range-key">To</span>
                <DateField
                  label="Scan to"
                  placeholder="DD.MM.YYYY"
                  value={scanTo}
                  onChange={onScanToChange}
                />
              </div>
            </div>

            <p className="mono scan-panel-note">
              {rangeActive
                ? 'Custom / PhilGEPS publish window for the next scan'
                : 'Default / today + previous 3 publish days'}
            </p>

            <button
              type="button"
              className={className}
              disabled={busy}
              aria-label={accessibleLabel}
              aria-describedby="scan-hold-hint"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={cancelHold}
              onPointerLeave={cancelHold}
              onFocus={() => setFocused(true)}
              onKeyDown={onKeyDown}
              onKeyUp={onKeyUp}
              onBlur={onBlur}
            >
              <span className="scan-fill" aria-hidden="true" />
              <span className="scan-action-body">
                <span className="scan-copy-stack">
                  <span className="scan-copy scan-copy-idle" aria-hidden="true">Scan PhilGEPS</span>
                  <span className="scan-copy scan-copy-hold" aria-hidden="true">Hold to scan</span>
                  <span className="scan-copy scan-copy-busy" aria-hidden="true">Scanning...</span>
                </span>
                <span className="scan-action-arrow" aria-hidden="true">↗</span>
              </span>
              <span className="scan-label-ink scan-ink-hold" aria-hidden="true">
                <span>Hold to scan</span>
                <span>↗</span>
              </span>
              <span className="scan-label-ink scan-ink-busy" aria-hidden="true">
                <span>Scanning...</span>
                <span>↗</span>
              </span>
            </button>
          </div>
          <p id="scan-hold-hint" className="visually-hidden">
            Press and hold to start the scan. Releasing early cancels it.
          </p>
          {scanError ? <p className="hero-error mono">{scanError}</p> : null}
        </div>
      </div>
    </section>
  )
}
