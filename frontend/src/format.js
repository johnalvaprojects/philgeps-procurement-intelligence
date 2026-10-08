const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

export function displayText(value) {
  const text = value == null ? '' : String(value).trim()
  return text || '—'
}

function dateParts(value) {
  const match = String(value || '').match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/)
  if (!match) return null
  const month = MONTHS[match[2].toLowerCase()]
  if (month == null) return null
  return { day: Number(match[1]), month, year: Number(match[3]) }
}

export function publishTime(value) {
  const parts = dateParts(value)
  if (!parts) return null
  const time = Date.UTC(parts.year, parts.month, parts.day)
  return Number.isNaN(time) ? null : time
}

/** Calendar day from an HTML date input value (YYYY-MM-DD), as UTC midnight. */
export function filterDayTime(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const time = Date.UTC(year, month, day)
  if (Number.isNaN(time)) return null
  const date = new Date(time)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return null
  }
  return time
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Explicit source formats. Slash dates are never inferred. */
export const DATE_SOURCE_PHILGEPS = 'philgeps'
export const DATE_SOURCE_ISO = 'iso'

const PHILGEPS_DATE = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?))?$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?))?$/

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** True calendar day via UTC components, so local timezone cannot shift the day. */
export function isCalendarDay(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

/**
 * Parse a full date string in one known source format.
 * Returns calendar parts plus the original time text, or null.
 * Does not accept numeric slash dates.
 */
export function parseKnownCalendarDate(value, source = DATE_SOURCE_PHILGEPS) {
  const text = value == null ? '' : String(value).trim()
  if (!text) return null

  let match = null
  let year
  let month
  let day
  let timeText = null

  if (source === DATE_SOURCE_PHILGEPS) {
    match = text.match(PHILGEPS_DATE)
    if (!match) return null
    day = Number(match[1])
    month = (MONTHS[match[2].toLowerCase()] ?? -1) + 1
    year = Number(match[3])
    timeText = match[4] || null
  } else if (source === DATE_SOURCE_ISO) {
    match = text.match(ISO_DATE)
    if (!match) return null
    year = Number(match[1])
    month = Number(match[2])
    day = Number(match[3])
    timeText = match[4] || null
  } else {
    return null
  }

  if (!isCalendarDay(year, month, day)) return null
  return { year, month, day, timeText }
}

function formatParsed(parts, style) {
  const date = style === 'long'
    ? `${MONTH_NAMES[parts.month - 1]} ${pad2(parts.day)}, ${parts.year}`
    : `${pad2(parts.month)}/${pad2(parts.day)}/${parts.year}`
  return parts.timeText ? `${date} ${parts.timeText}` : date
}

function presentDate(value, source, style) {
  const parts = parseKnownCalendarDate(value, source)
  if (!parts) return displayText(value)
  return formatParsed(parts, style)
}

/** Compact month-first date: MM/DD/YYYY. Optional original clock time is kept. */
export function formatCompactDate(value, source = DATE_SOURCE_PHILGEPS) {
  return presentDate(value, source, 'compact')
}

/** Detail date: Month DD, YYYY. Optional original clock time is kept. */
export function formatLongDate(value, source = DATE_SOURCE_PHILGEPS) {
  return presentDate(value, source, 'long')
}

/**
 * Detail display for a value whose source is either PhilGEPS DD-Mon-YYYY
 * or an ISO calendar day. Unrecognized text, including slash dates, is unchanged.
 */
export function formatDetailDate(value) {
  const text = value == null ? '' : String(value).trim()
  if (!text) return displayText(value)
  if (parseKnownCalendarDate(text, DATE_SOURCE_PHILGEPS)) {
    return formatLongDate(text, DATE_SOURCE_PHILGEPS)
  }
  if (parseKnownCalendarDate(text, DATE_SOURCE_ISO)) {
    return formatLongDate(text, DATE_SOURCE_ISO)
  }
  return text
}

export function formatDateLabel(value) {
  return formatLongDate(value, DATE_SOURCE_PHILGEPS)
}

export function formatDateDots(value) {
  return formatCompactDate(value, DATE_SOURCE_PHILGEPS)
}

export function padCount(value) {
  return String(value ?? 0).padStart(3, '0')
}

export function formatPeso(value) {
  const text = value == null ? '' : String(value).trim()
  if (!text) return '—'
  const numeric = Number(text.replace(/₱/g, '').replace(/php/ig, '').replace(/,/g, '').trim())
  if (!Number.isFinite(numeric)) return text
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(numeric)
}

export function classificationLabel(value) {
  if (value === 'software') return 'Software'
  if (value === 'review') return 'Review'
  if (value === 'not relevant') return 'Not Relevant'
  return displayText(value)
}

export function classificationKind(value) {
  if (value === 'software' || value === 'review' || value === 'not relevant') return value
  return 'unknown'
}

export function workStatusLabel(value) {
  if (value === 'new') return 'New'
  if (value === 'in-progress') return 'In progress'
  if (value === 'done') return 'Done'
  return ''
}

export function sourceLabel(value) {
  if (value === 'manual') return 'Manual'
  if (value === 'automatic') return 'Automatic'
  return displayText(value)
}

export function reviewStatusLabel(packet) {
  if (packet?.reviewed === true || packet?.review?.status === 'reviewed') return 'Reviewed'
  if (packet?.review?.status === 'pending' || packet?.reviewed === false) return 'Pending'
  return displayText(packet?.review?.status)
}
