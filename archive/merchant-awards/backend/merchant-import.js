import { formatPeso, pesoCentavos } from './merchant-store.js'

const AWARD_FIELDS = [
  'lineItem',
  'status',
  'awardCategory',
  'acceptance',
  'supplier',
  'noticeReference',
  'approvedBudget',
  'contractAmount',
  'awardDate',
  'publishedDate',
  'agency',
  'procurementMode',
  'classification',
  'sourceUrl',
  'source',
  'verifiedAt',
]

const INVITATION_FIELDS = [
  'title',
  'procurementMode',
  'classification',
  'approvedBudget',
  'publishedDate',
  'closingDate',
  'agency',
  'status',
  'sourceUrl',
]

const ACCEPTANCE = new Map([
  ['pending for acceptance', 'Pending for Acceptance'],
  ['accepted', 'Accepted'],
  ['refused', 'Refused'],
])

const AWARD_STATUS = new Map([
  ['published', 'Published'],
  ['cancelled', 'Cancelled'],
  ['canceled', 'Cancelled'],
  ['ntp issued', 'NTP issued'],
])

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const SECRET = /cookie|password|token|session|authorization|csrf/i
const AMOUNT_FIELDS = new Set(['approvedBudget', 'contractAmount'])
const AWARD_DATE_FIELDS = new Set(['awardDate', 'publishedDate'])
const INVITATION_DATE_FIELDS = new Set(['publishedDate', 'closingDate'])
const LIFECYCLE_FIELDS = {
  award: new Set(['acceptance', 'status']),
  invitation: new Set(['status']),
}

function invalid(message) {
  const error = new Error(message)
  error.code = 'INVALID'
  throw error
}

function blank(value) {
  const text = value == null ? '' : String(value).trim()
  return text || null
}

function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(message)
}

function rejectSecrets(record) {
  if (Object.keys(record).some((key) => SECRET.test(key))) invalid('Merchant credentials cannot be stored.')
}

function rejectFixture(record) {
  if (record.fixture === true) invalid('Fixture records cannot be imported as Merchant account data.')
}

export function normalizeReference(value) {
  const text = String(value ?? '').trim()
  return /^\d{3,12}$/.test(text) ? text : ''
}

export function normalizeMerchantDate(value) {
  const text = blank(value)
  if (!text) return null
  let year
  let month
  let day
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const written = /^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/.exec(text)
  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else if (written) {
    year = Number(written[3])
    month = MONTHS[written[2].toLowerCase()]
    day = Number(written[1])
  } else {
    invalid('Unrecognized date.')
  }
  if (!month || month < 1 || month > 12 || day < 1 || day > 31) invalid('Unrecognized date.')
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    invalid('Unrecognized date.')
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function normalizeMerchantAmount(value) {
  const text = blank(value)
  if (!text) return null
  let amount = text.replace(/₱/g, 'PHP ').replace(/\s+/g, ' ').trim()
  if (/^\d/.test(amount)) amount = `PHP ${amount}`
  const centavos = pesoCentavos(amount)
  if (centavos == null) invalid('Unrecognized amount.')
  return formatPeso(centavos)
}

function sameMeaning(field, left, right, dates) {
  if (left == null || right == null) return left == null && right == null
  if (AMOUNT_FIELDS.has(field)) return normalizeMerchantAmount(left) === normalizeMerchantAmount(right)
  if (dates.has(field)) return normalizeMerchantDate(left) === normalizeMerchantDate(right)
  return String(left).trim() === String(right).trim()
}

function canonicalAward(record) {
  const awardNumber = normalizeReference(record.awardNumber)
  if (!awardNumber) invalid('Invalid award number.')
  rejectSecrets(record)
  rejectFixture(record)
  const unknown = Object.keys(record).filter((key) => key !== 'awardNumber' && key !== 'history' && !AWARD_FIELDS.includes(key))
  if (unknown.length) invalid('Unrecognized award field.')
  if (!blank(record.lineItem)) invalid('Line item is required.')
  const next = { awardNumber, lineItem: blank(record.lineItem) }
  for (const field of AWARD_FIELDS) {
    if (field === 'lineItem') continue
    const value = blank(record[field])
    if (value == null) {
      next[field] = null
      continue
    }
    if (field === 'acceptance') {
      const acceptance = ACCEPTANCE.get(value.toLowerCase())
      if (!acceptance) invalid('Acceptance must be Pending for Acceptance, Accepted, or Refused.')
      next[field] = acceptance
    } else if (field === 'status') {
      const status = AWARD_STATUS.get(value.toLowerCase())
      if (!status) invalid('Unrecognized award status.')
      next[field] = status
    } else if (field === 'noticeReference') {
      const reference = normalizeReference(value)
      if (!reference) invalid('Invalid notice reference.')
      next[field] = reference
    } else if (AMOUNT_FIELDS.has(field)) {
      next[field] = normalizeMerchantAmount(value)
    } else if (AWARD_DATE_FIELDS.has(field)) {
      next[field] = normalizeMerchantDate(value)
    } else if (field === 'sourceUrl') {
      if (value !== `https://philgeps.gov.ph/BidAwards/viewAwardNotice/${awardNumber}`) invalid('Unrecognized award source.')
      next[field] = value
    } else if (field === 'verifiedAt') {
      if (Number.isNaN(Date.parse(value))) invalid('Verification time is not a valid date.')
      next[field] = value
    } else if (field === 'classification' || field === 'procurementMode' || field === 'agency' || field === 'supplier' || field === 'awardCategory' || field === 'source') {
      next[field] = value.replace(/\s+/g, ' ')
    } else {
      next[field] = value
    }
  }
  return next
}

function canonicalInvitation(record) {
  const noticeReference = normalizeReference(record.noticeReference)
  if (!noticeReference) invalid('Invalid notice reference.')
  rejectSecrets(record)
  rejectFixture(record)
  const unknown = Object.keys(record).filter((key) => key !== 'noticeReference' && key !== 'history' && !INVITATION_FIELDS.includes(key))
  if (unknown.length) invalid('Unrecognized invitation field.')
  if (!blank(record.title)) invalid('Notice title is required.')
  const next = { noticeReference, title: blank(record.title).replace(/\s+/g, ' ') }
  for (const field of INVITATION_FIELDS) {
    if (field === 'title') continue
    const value = blank(record[field])
    if (value == null) {
      next[field] = null
      continue
    }
    if (field === 'approvedBudget') next[field] = normalizeMerchantAmount(value)
    else if (INVITATION_DATE_FIELDS.has(field)) next[field] = normalizeMerchantDate(value)
    else if (field === 'sourceUrl') {
      let url
      try {
        url = new URL(value)
      } catch {
        invalid('Unrecognized invitation source.')
      }
      const referenceInUrl = url.pathname.includes(noticeReference) || url.search.includes(noticeReference)
      if (url.protocol !== 'https:' || url.hostname !== 'philgeps.gov.ph' || !referenceInUrl) {
        invalid('Unrecognized invitation source.')
      }
      next[field] = value
    } else {
      next[field] = value.replace(/\s+/g, ' ')
    }
  }
  return next
}

export function parseAwardNotice(record) {
  requireObject(record, 'Invalid award record.')
  return canonicalAward(record)
}

export function parseInvitation(record) {
  requireObject(record, 'Invalid invitation record.')
  return canonicalInvitation(record)
}

function sameLifecycle(field, left, right) {
  if (field === 'status') return String(left).trim().toLowerCase() === String(right).trim().toLowerCase()
  return left === right
}

function lifecycleDecision(kind, field, currentValue, incomingValue) {
  if (!LIFECYCLE_FIELDS[kind]?.has(field)) return 'protect'
  if (sameLifecycle(field, currentValue, incomingValue)) return 'same'
  if (kind === 'award' && field === 'acceptance') {
    if (currentValue === 'Pending for Acceptance' && (incomingValue === 'Accepted' || incomingValue === 'Refused')) return 'apply'
    return 'protect'
  }
  return 'apply'
}

function mergeRecord(existing, incoming, fields, dates, conflicts, changes, kind, key) {
  const next = { ...existing }
  let changed = false
  for (const field of fields) {
    if (field === 'verifiedAt') continue
    const incomingValue = incoming[field]
    const currentValue = existing[field] ?? null
    if (incomingValue == null) continue
    if (currentValue == null) {
      next[field] = incomingValue
      changed = true
      changes.push({ kind, key, field, previous: null, value: incomingValue })
      continue
    }
    const decision = lifecycleDecision(kind, field, currentValue, incomingValue)
    if (decision === 'apply') {
      next[field] = incomingValue
      changed = true
      changes.push({ kind, key, field, previous: currentValue, value: incomingValue })
      continue
    }
    if (decision === 'same') continue
    if (!sameMeaning(field, currentValue, incomingValue, dates)) {
      conflicts.push({ kind, key, field, kept: currentValue, received: incomingValue })
    }
  }
  if (!changed) return existing
  if (incoming.verifiedAt) next.verifiedAt = incoming.verifiedAt
  const history = Array.isArray(existing.history) ? [...existing.history] : []
  const { history: _ignored, ...previous } = existing
  history.push(previous)
  next.history = history
  return next
}

function importGroup(rows, existing, parse, keyName, fields, dates, rejected, duplicates, conflicts, changes, kind) {
  const stored = new Map()
  for (const record of existing) {
    if (record?.[keyName]) stored.set(String(record[keyName]), { ...record, history: Array.isArray(record.history) ? [...record.history] : [] })
  }
  for (const row of rows) {
    let parsed
    try {
      parsed = parse(row)
    } catch (error) {
      rejected.push({ kind, key: row?.[keyName] ?? null, error: error.message })
      continue
    }
    const key = parsed[keyName]
    if (stored.has(key)) {
      duplicates.push({ kind, key })
      stored.set(key, mergeRecord(stored.get(key), parsed, fields, dates, conflicts, changes, kind, key))
    } else {
      stored.set(key, { ...parsed, history: [] })
    }
  }
  return [...stored.values()]
}

export function importMerchantBatch({ awards = [], invitations = [], existingAwards = [], existingInvitations = [] } = {}) {
  if (!Array.isArray(awards) || !Array.isArray(invitations)) invalid('Merchant import must be a list of records.')
  const rejected = []
  const duplicates = []
  const conflicts = []
  const changes = []
  return {
    awards: importGroup(awards, existingAwards, parseAwardNotice, 'awardNumber', AWARD_FIELDS, AWARD_DATE_FIELDS, rejected, duplicates, conflicts, changes, 'award'),
    invitations: importGroup(invitations, existingInvitations, parseInvitation, 'noticeReference', INVITATION_FIELDS, INVITATION_DATE_FIELDS, rejected, duplicates, conflicts, changes, 'invitation'),
    rejected,
    duplicates,
    conflicts,
    changes,
    live: false,
  }
}
