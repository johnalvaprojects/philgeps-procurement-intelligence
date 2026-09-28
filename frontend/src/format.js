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

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

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

export function formatDateLabel(value) {
  const parts = dateParts(value)
  if (!parts) return displayText(value)
  return `${MONTH_LABELS[parts.month]} ${String(parts.day).padStart(2, '0')} ${parts.year}`
}

export function formatDateDots(value) {
  const parts = dateParts(value)
  if (!parts) return displayText(value)
  return `${String(parts.day).padStart(2, '0')}.${String(parts.month + 1).padStart(2, '0')}.${parts.year}`
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
