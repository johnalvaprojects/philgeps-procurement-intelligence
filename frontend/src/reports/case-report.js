import { buildTechnicalSummary } from '../requirements/technical-summary.js'

function text(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export function fieldRecord(field) {
  if (field == null || field === '') return null
  if (typeof field === 'object' && !Array.isArray(field) && 'value' in field) {
    const value = text(field.value)
    if (!value) return null
    return {
      value,
      source: text(field.source),
      confidence: text(field.confidence),
      constraint: field.constraint === 'minimum' || field.constraint === 'maximum' ? field.constraint : null,
      scope: text(field.scope),
      role: text(field.role),
    }
  }
  const value = text(field)
  if (!value) return null
  return { value, source: null, confidence: null, constraint: null, scope: null, role: null }
}

function sourceLabel(packet, notice) {
  const explicit = text(packet?.source?.label)
  if (explicit) return explicit
  const url = text(notice?.url)
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function itemRecord(item = {}) {
  return {
    description: fieldRecord(item.description),
    quantity: fieldRecord(item.quantity),
    unit: fieldRecord(item.unitOfMeasure),
    licenses: fieldRecord(item.licenses || item.usersOrSeats),
    duration: fieldRecord(item.subscriptionDuration),
    licenseType: fieldRecord(item.licenseType),
  }
}

export function buildCaseReport(packet = {}) {
  const notice = packet.notice || {}
  const requirements = packet.extractedRequirements || null
  const packetDocuments = packet.documents || []
  const technicalSummary = buildTechnicalSummary(requirements, packetDocuments)

  const documents = []
  for (const document of packet.documents || []) {
    const name = text(document?.filename || document?.name)
    if (name && name !== 'metadata.json') documents.push(name)
  }

  return {
    referenceNumber: text(notice.referenceNumber),
    title: text(notice.title),
    organization: text(notice.organization),
    sourceUrl: text(notice.url),
    sourceLabel: sourceLabel(packet, notice),
    postedDate: text(notice.postedDate),
    deadline: text(notice.deadline),
    noticeAbc: text(notice.abc),
    financialAbc: fieldRecord(requirements?.financial?.abc),
    abcScope: text(requirements?.financial?.abcScope),
    otherFinancialLimits: (requirements?.financial?.otherFinancialLimits || []).map(fieldRecord).filter(Boolean),
    currency: fieldRecord(requirements?.financial?.currency),
    vatWording: fieldRecord(requirements?.financial?.vatWording),
    items: Array.isArray(requirements?.items) ? requirements.items.map(itemRecord) : [],
    technicalFacts: technicalSummary.facts,
    extractedClauseCount: technicalSummary.clauseCount,
    deliveryPeriod: fieldRecord(requirements?.delivery?.deliveryPeriod),
    subscriptionDuration: fieldRecord(requirements?.delivery?.subscriptionDuration),
    deliveryLocation: fieldRecord(requirements?.delivery?.deliveryLocation),
    quotationDeadline: fieldRecord(requirements?.submission?.quotationDeadline),
    submissionMethod: fieldRecord(requirements?.submission?.submissionMethod),
    contactPerson: fieldRecord(requirements?.submission?.contactPerson),
    contactEmail: fieldRecord(requirements?.submission?.contactEmail),
    emailCandidates: (requirements?.submission?.contactEmailCandidates || []).map(fieldRecord).filter(Boolean),
    documents,
    sourceDocuments: (requirements?.sourceDocuments || []).map(text).filter(Boolean),
    extractionStatus: text(requirements?.extractionStatus),
    conflicts: Array.isArray(requirements?.conflicts) ? requirements.conflicts : [],
    fieldsNeedingReview: Array.isArray(requirements?.fieldsNeedingReview) ? requirements.fieldsNeedingReview : [],
    classification: text(packet.classification),
    classificationSource: text(packet.classificationSource),
    reviewed: packet.reviewed === true || packet.review?.status === 'reviewed'
      ? true
      : packet.reviewed === false || packet.review?.status === 'pending'
        ? false
        : null,
    requirementsPresent: Boolean(requirements),
  }
}
