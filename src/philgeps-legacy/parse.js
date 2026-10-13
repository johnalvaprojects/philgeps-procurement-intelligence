import * as cheerio from 'cheerio'

const NEXT_TARGET = 'pgCtrlDetailedSearch$nextLB'
const DOCUMENT_LIST = /ViewDocumentRequestList\.aspx/i
const SITE_FAILURE = /Transaction cannot be completed/i

function clean(value) {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text || null
}

function normLabel(value) {
  return String(value || '')
    .replace(/[:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function hiddenValue($, name) {
  return clean($(`input[name="${name}"]`).attr('value'))
}

export function parseOpenList(html) {
  const $ = cheerio.load(html)
  const failed = SITE_FAILURE.test($.root().text())
  const seen = new Set()
  const referenceIds = []
  const duplicateIds = []

  $('a[href*="refID="]').each((_, element) => {
    const href = $(element).attr('href') || ''
    if (DOCUMENT_LIST.test(href)) return
    const match = href.match(/[?&]refID=(\d+)/i)
    if (!match) return
    if (seen.has(match[1])) {
      duplicateIds.push(match[1])
      return
    }
    seen.add(match[1])
    referenceIds.push(match[1])
  })

  const nextLink = $('a').filter((_, element) => {
    const href = $(element).attr('href') || ''
    const id = $(element).attr('id') || ''
    return href.includes(NEXT_TARGET) || id.includes('nextLB')
  })

  return {
    failed,
    referenceIds,
    duplicateIds,
    hasNext: nextLink.length > 0,
    form: {
      viewState: hiddenValue($, '__VIEWSTATE'),
      viewStateGenerator: hiddenValue($, '__VIEWSTATEGENERATOR'),
      eventValidation: hiddenValue($, '__EVENTVALIDATION'),
    },
  }
}

function labelMap($) {
  const map = new Map()
  $('tr').each((_, row) => {
    const cells = $(row).children('td, th')
    if (cells.length < 2) return
    const label = normLabel($(cells[0]).text())
    if (!label || label.length > 80) return
    if (!map.has(label)) map.set(label, clean($(cells[1]).text()))
  })
  return map
}

function field(map, key) {
  const wanted = normLabel(key)
  if (map.has(wanted)) return map.get(wanted)
  for (const [label, value] of map) {
    if (label.startsWith(`${wanted} `)) return value
  }
  return null
}

function parseLineItems($) {
  const items = []
  $('table').each((_, table) => {
    const headerRow = $(table).find('tr').filter((__, row) => $(row).find('th').length > 0).first()
    if (!headerRow.length) return
    const headers = headerRow.find('th').map((__, cell) => normLabel($(cell).text())).get()
    const quantityIndex = headers.findIndex((header) => header === 'quantity' || header === 'qty')
    if (quantityIndex < 0) return
    const itemIndex = headers.findIndex((header) => /item|description|goods/.test(header))
    const unitIndex = headers.findIndex((header) => header === 'unit' || header === 'uom')
    $(table).find('tr').each((__, row) => {
      if ($(row).find('th').length > 0) return
      const cells = $(row).find('td').map((___, cell) => clean($(cell).text())).get()
      if (cells.length === 0) return
      const description = itemIndex >= 0 ? cells[itemIndex] : null
      const quantity = cells[quantityIndex] || null
      const unit = unitIndex >= 0 ? cells[unitIndex] : null
      if (!description && !quantity) return
      items.push({
        lotName: description,
        lotDescription: description,
        quantity,
        unitOfMeasure: unit,
        unspsc: null,
      })
    })
  })
  return items
}

export function parseAbstract(html, url) {
  const $ = cheerio.load(html)
  const failed = SITE_FAILURE.test($.root().text())
  const map = labelMap($)
  const documentLinks = $('a[href]')
    .map((_, element) => $(element).attr('href') || '')
    .get()
    .filter((href) => DOCUMENT_LIST.test(href))

  const posted = field(map, 'date published')
  const closing = field(map, 'closing date')
  const duration = field(map, 'contract duration') || field(map, 'delivery period')

  return {
    failed,
    documentListLinked: documentLinks.length > 0,
    notice: {
      referenceNumber: field(map, 'reference number'),
      title: field(map, 'title'),
      projectTitle: field(map, 'title'),
      organization: field(map, 'procuring entity'),
      governmentEntity: field(map, 'procuring entity'),
      areaOfDelivery: field(map, 'area of delivery'),
      controlNumber: field(map, 'solicitation number'),
      procurementMode: field(map, 'procurement mode'),
      philgepsClassification: field(map, 'classification'),
      businessCategory: field(map, 'category'),
      abc: field(map, 'approved budget'),
      deliveryPeriod: duration,
      status: field(map, 'status'),
      description: field(map, 'description'),
      postedDate: posted,
      publishedDate: posted,
      deadline: closing,
      closingDate: closing,
      lineItems: parseLineItems($),
      url: url || null,
      noticeUrl: url || null,
    },
  }
}

export function isSmallValueProcurement(mode) {
  return /small\s+value\s+procurement/i.test(String(mode || ''))
}
