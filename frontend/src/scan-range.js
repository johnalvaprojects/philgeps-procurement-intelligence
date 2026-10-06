const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function parseIsoCalendarDay(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null
  }
  return date
}

/**
 * Validate optional scan FROM/TO fields before POST /api/scan.
 * Both empty → default server window. Both set → custom range. Otherwise invalid.
 */
export function validateScanRange(from, to) {
  const rawFrom = String(from || '').trim()
  const rawTo = String(to || '').trim()
  const hasFrom = Boolean(rawFrom)
  const hasTo = Boolean(rawTo)

  if (!hasFrom && !hasTo) {
    return { ok: true, payload: null }
  }

  if (hasFrom !== hasTo) {
    return { ok: false, error: 'Set both SCAN FROM and SCAN TO, or clear the range.' }
  }

  const start = parseIsoCalendarDay(rawFrom)
  const end = parseIsoCalendarDay(rawTo)
  if (!start || !end) {
    return { ok: false, error: 'Scan dates must be valid calendar days.' }
  }

  if (start.getTime() > end.getTime()) {
    return { ok: false, error: 'SCAN FROM must be on or before SCAN TO.' }
  }

  return {
    ok: true,
    payload: { from: rawFrom, to: rawTo },
  }
}

export function formatScanRangeLabel(from, to) {
  const start = parseIsoCalendarDay(from)
  const end = parseIsoCalendarDay(to)
  if (!start || !end) return ''
  const left = `${MONTHS[start.getMonth()]} ${String(start.getDate()).padStart(2, '0')}`
  const right = `${MONTHS[end.getMonth()]} ${String(end.getDate()).padStart(2, '0')}`
  return `${left} — ${right}`
}
