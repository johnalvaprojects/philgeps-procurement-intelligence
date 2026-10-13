const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function isCalendarDay(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * Old PhilGEPS prints day/month/year. Convert that to the calendar text this
 * app already stores (13-Oct-2026). Slash dates are not guessed anywhere else.
 * Unreadable text becomes null so a missing date stays empty.
 */
export function legacyCalendarDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm]))?$/)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (!isCalendarDay(year, month, day)) return null
  const date = `${pad2(day)}-${MONTHS[month - 1]}-${year}`
  if (!match[4]) return date
  const hour = pad2(Number(match[4]))
  const minute = pad2(Number(match[5]))
  const meridiem = match[6].toUpperCase()
  return `${date} ${hour}:${minute} ${meridiem}`
}
