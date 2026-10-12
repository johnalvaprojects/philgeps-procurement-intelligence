import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { projectRoot } from '../../../src/project-root.js'
import { MERCHANT_SEED } from './merchant-seed.js'

const FIELDS = [
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
  'sourceUrl',
  'source',
  'verifiedAt',
]

const ACCEPTANCE = new Set(['Pending for Acceptance', 'Accepted', 'Refused'])
const STATUSES = new Set(['Published', 'Cancelled', 'NTP issued'])
const SOURCES = new Set(['merchant-list', 'merchant-detail'])
const SECRET = /cookie|password|token|session|authorization|csrf/i

export function merchantAwardsDirectory(directory) {
  return directory || path.join(projectRoot, 'data', 'merchant-awards')
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

export function normalizeAwardNumber(value) {
  const text = String(value ?? '').trim()
  return /^\d{3,12}$/.test(text) ? text : ''
}

function seedByNumber() {
  return new Map(MERCHANT_SEED.map((record) => [record.awardNumber, { ...record, history: record.history || [] }]))
}

function present(record) {
  return {
    awardNumber: record.awardNumber,
    lineItem: record.lineItem ?? null,
    status: record.status ?? null,
    awardCategory: record.awardCategory ?? null,
    acceptance: record.acceptance ?? null,
    supplier: record.supplier ?? null,
    noticeReference: record.noticeReference ?? null,
    approvedBudget: record.approvedBudget ?? null,
    contractAmount: record.contractAmount ?? null,
    awardDate: record.awardDate ?? null,
    publishedDate: record.publishedDate ?? null,
    agency: record.agency ?? null,
    procurementMode: record.procurementMode ?? null,
    classification: record.classification ?? null,
    sourceUrl: record.sourceUrl ?? null,
    source: record.source ?? null,
    verifiedAt: record.verifiedAt ?? null,
    history: Array.isArray(record.history) ? record.history : [],
  }
}

function snapshot(record) {
  const { history, ...current } = present(record)
  return current
}

async function readFileRecord(directory, awardNumber) {
  try {
    const data = JSON.parse(await readFile(path.join(directory, `${awardNumber}.json`), 'utf8'))
    if (data?.awardNumber !== awardNumber) return null
    return present(data)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function listMerchantAwards(directory) {
  const folder = merchantAwardsDirectory(directory)
  const records = seedByNumber()
  let files = []
  try {
    files = await readdir(folder)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const awardNumber = normalizeAwardNumber(file.replace(/\.json$/, ''))
    if (!awardNumber) continue
    const stored = await readFileRecord(folder, awardNumber)
    if (stored) records.set(awardNumber, stored)
  }
  const seedOrder = MERCHANT_SEED.map((record) => record.awardNumber)
  return [...records.values()].map(present).sort((left, right) => {
    const leftIndex = seedOrder.indexOf(left.awardNumber)
    const rightIndex = seedOrder.indexOf(right.awardNumber)
    if (leftIndex === -1 && rightIndex === -1) return left.awardNumber.localeCompare(right.awardNumber)
    if (leftIndex === -1) return 1
    if (rightIndex === -1) return -1
    return leftIndex - rightIndex
  })
}

export async function readMerchantAward(directory, awardNumber) {
  const safe = normalizeAwardNumber(awardNumber)
  if (!safe) return null
  const stored = await readFileRecord(merchantAwardsDirectory(directory), safe)
  if (stored) return stored
  const seed = seedByNumber().get(safe)
  return seed ? present(seed) : null
}

export function validateMerchantUpdate(awardNumber, body) {
  const safe = normalizeAwardNumber(awardNumber)
  if (!safe) invalid('Invalid award number.')
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Invalid award record.')
  if (Object.keys(body).some((key) => SECRET.test(key))) invalid('Merchant credentials cannot be stored.')
  const unknown = Object.keys(body).filter((key) => key !== 'awardNumber' && !FIELDS.includes(key))
  if (unknown.length) invalid('Unrecognized award field.')
  if (body.awardNumber != null && String(body.awardNumber).trim() !== safe) invalid('Award number does not match.')
  if (body.acceptance != null && !ACCEPTANCE.has(body.acceptance)) {
    invalid('Acceptance must be Pending for Acceptance, Accepted, or Refused.')
  }
  if (body.status != null && !STATUSES.has(body.status)) invalid('Unrecognized award status.')
  if (body.source != null && !SOURCES.has(body.source)) invalid('Unrecognized award source.')
  if (body.sourceUrl != null && String(body.sourceUrl).trim() && String(body.sourceUrl).trim() !== `https://philgeps.gov.ph/BidAwards/viewAwardNotice/${safe}`) {
    invalid('Unrecognized award source.')
  }
  if (body.verifiedAt != null && Number.isNaN(Date.parse(body.verifiedAt))) invalid('Verification time is not a valid date.')
  return safe
}

function content(record) {
  const copy = snapshot(record)
  delete copy.verifiedAt
  return JSON.stringify(copy)
}

export async function updateMerchantAward(directory, awardNumber, body, verifiedAt = new Date().toISOString()) {
  const safe = validateMerchantUpdate(awardNumber, body)
  const folder = merchantAwardsDirectory(directory)
  const current = await readMerchantAward(folder, safe)
  const next = current ? snapshot(current) : {
    awardNumber: safe,
    lineItem: null,
    status: null,
    awardCategory: null,
    acceptance: null,
    supplier: null,
    noticeReference: null,
    approvedBudget: null,
    contractAmount: null,
    awardDate: null,
    publishedDate: null,
    agency: null,
    procurementMode: null,
    sourceUrl: null,
    source: null,
    verifiedAt: null,
  }
  for (const field of FIELDS) {
    if (Object.hasOwn(body, field)) next[field] = blank(body[field])
  }
  if (!next.acceptance) invalid('Acceptance must be Pending for Acceptance, Accepted, or Refused.')
  if (!next.lineItem) invalid('Line item is required.')
  if (!next.source) next.source = 'merchant-detail'
  if (!Object.hasOwn(body, 'verifiedAt')) next.verifiedAt = verifiedAt
  if (current && content(current) === content(next) && !Object.hasOwn(body, 'verifiedAt')) {
    return current
  }
  const history = current?.history ? [...current.history] : []
  if (current && content(current) !== content(next)) history.push(snapshot(current))
  const stored = { ...next, history }
  await mkdir(folder, { recursive: true })
  const file = path.join(folder, `${safe}.json`)
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`)
  await rename(temporary, file)
  return present(stored)
}

const PESO = /^PHP (\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/

export function pesoCentavos(value) {
  const match = PESO.exec(String(value ?? '').trim())
  if (!match) return null
  return BigInt(match[1].replaceAll(',', '')) * 100n + BigInt(match[2])
}

export function formatPeso(centavos) {
  const pesos = (centavos / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const cents = (centavos % 100n).toString().padStart(2, '0')
  return `PHP ${pesos}.${cents}`
}

export function merchantSummary(records) {
  let contractCentavos = 0n
  let pending = 0
  let accepted = 0
  for (const record of records) {
    if (record.acceptance === 'Pending for Acceptance') pending += 1
    if (record.acceptance === 'Accepted') accepted += 1
    if (record.status === 'Published') {
      const amount = pesoCentavos(record.contractAmount)
      if (amount != null) contractCentavos += amount
    }
  }
  return {
    awards: records.length,
    pending,
    accepted,
    contractValue: formatPeso(contractCentavos),
  }
}
