import { DATE_SOURCE_ISO, formatCompactDate, formatDetailDate, formatLongDate } from '../format.js'

export function formatManilaTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)
  const pick = (type) => parts.find((part) => part.type === type)?.value
  const month = pick('month')
  const day = pick('day')
  const year = pick('year')
  const hour = pick('hour')
  const minute = pick('minute')
  const dayPeriod = pick('dayPeriod')
  if (!month || !day || !year || !hour || !minute || !dayPeriod) return 'Not recorded'
  return `${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod} PHT`
}

export function formatGeneratedAt(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  }).formatToParts(date)
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  const year = parts.find((part) => part.type === 'year')?.value
  if (!month || !day || !year) return 'Not recorded'
  return `${month} ${day}, ${year}`
}

export function formatReportDate(value, source = DATE_SOURCE_ISO) {
  if (value == null || String(value).trim() === '') return 'Not recorded'
  return formatLongDate(value, source)
}

export function formatReportDetailDate(value) {
  if (value == null || String(value).trim() === '') return 'Not recorded'
  const formatted = formatDetailDate(value)
  return formatted === '—' ? 'Not recorded' : formatted
}

export function blank(value) {
  if (value == null || String(value).trim() === '') return 'Not recorded'
  return String(value)
}

export function formatReportDuration(durationMs) {
  if (!Number.isFinite(Number(durationMs))) return null
  const totalSeconds = Math.max(0, Math.round(Number(durationMs) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

export function completionLabel(report) {
  if (!report) return 'Not recorded'
  if (report.complete === true) return 'Completed'
  if (report.complete === false) return 'Incomplete'
  return 'Not recorded'
}

const COMPLETION_REASONS = {
  'date-boundary': 'Reached the end of the requested date window',
  'empty-page': 'The listing ended',
  'repeated-page': 'Pagination repeated a page and the scan stopped',
  'safety-limit': 'Stopped at the pagination safety limit',
  error: 'Stopped because of an error',
}

export function completionReasonLabel(reason) {
  if (!reason) return null
  return COMPLETION_REASONS[reason] || String(reason)
}

export function countText(value) {
  return Number.isFinite(Number(value)) ? String(value) : 'Not recorded'
}

export function compactWindow(from, to) {
  const left = from ? formatCompactDate(from, DATE_SOURCE_ISO) : 'Not recorded'
  const right = to ? formatCompactDate(to, DATE_SOURCE_ISO) : 'Not recorded'
  return `${left} – ${right}`
}

export function classificationSourceLabel(value) {
  if (value === 'manual') return 'Manual'
  if (value === 'automatic') return 'Automatic'
  return 'Not recorded'
}

export function savedRecordLabel(previouslySaved) {
  if (previouslySaved === true) return 'Saved'
  if (previouslySaved === false) return 'New'
  return 'Not recorded'
}

export function reviewStateLabel(value) {
  if (value === 'reviewed' || value === true) return 'Reviewed'
  if (value === 'pending' || value === false) return 'Pending'
  return 'Not recorded'
}
