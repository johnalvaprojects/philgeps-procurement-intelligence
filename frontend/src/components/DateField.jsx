import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { DATE_SOURCE_ISO, formatCompactDate } from '../format.js'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseIsoDay(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return date
}

function toIsoDay(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function displayDay(value) {
  return formatCompactDate(value, DATE_SOURCE_ISO)
}

function sameDay(left, right) {
  return left
    && right
    && left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function buildCells(viewYear, viewMonth) {
  const first = new Date(viewYear, viewMonth, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells = []

  for (let index = 0; index < 42; index += 1) {
    const dayNumber = index - startOffset + 1
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cells.push(null)
      continue
    }
    cells.push(new Date(viewYear, viewMonth, dayNumber))
  }

  return cells
}

export default function DateField({ value, onChange, label, placeholder = 'Select date' }) {
  const id = useId()
  const rootRef = useRef(null)
  const selected = parseIsoDay(value)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const base = selected || new Date()
    return { year: base.getFullYear(), month: base.getMonth() }
  })

  useEffect(() => {
    if (!open) return undefined
    const base = selected || new Date()
    setView({ year: base.getFullYear(), month: base.getMonth() })
  }, [open, value])

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const cells = useMemo(() => buildCells(view.year, view.month), [view.year, view.month])
  const today = new Date()

  function shiftMonth(delta) {
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  function choose(date) {
    onChange(toIsoDay(date))
    setOpen(false)
  }

  return (
    <div className={open ? 'date-field is-open' : 'date-field'} ref={rootRef}>
      <button
        type="button"
        className={value ? 'date-trigger mono has-value' : 'date-trigger mono'}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value ? displayDay(value) : placeholder}</span>
      </button>
      {open ? (
        <div className="date-popover" id={id} role="dialog" aria-label={label}>
          <div className="date-popover-nav">
            <button type="button" className="date-nav mono" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              ←
            </button>
            <p className="date-month mono">
              {MONTHS[view.month]} {view.year}
            </p>
            <button type="button" className="date-nav mono" onClick={() => shiftMonth(1)} aria-label="Next month">
              →
            </button>
          </div>
          <div className="date-weekdays mono" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="date-grid" role="grid" aria-label={`${MONTHS[view.month]} ${view.year}`}>
            {cells.map((date, index) => {
              if (!date) {
                return <span key={`empty-${index}`} className="date-cell is-empty" />
              }
              const iso = toIsoDay(date)
              const selectedDay = sameDay(date, selected)
              const todayDay = sameDay(date, today)
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    'date-cell mono',
                    selectedDay ? 'is-selected' : '',
                    todayDay ? 'is-today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => choose(date)}
                  aria-pressed={selectedDay}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
