const CLAUSE_KEYS = [
  'requiredFeatures',
  'minimumSpecifications',
  'compatibilityRequirements',
  'supportedPlatforms',
  'deploymentRequirements',
  'licenseRequirements',
  'supportRequirements',
  'maintenanceRequirements',
  'trainingRequirements',
  'implementationRequirements',
]

function text(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export function readStoredField(field) {
  if (field == null || field === '') return null
  if (typeof field === 'object' && !Array.isArray(field) && 'value' in field) {
    const value = text(field.value)
    if (!value) return null
    return {
      value,
      source: text(field.source),
      confidence: text(field.confidence),
      constraint: field.constraint === 'minimum' || field.constraint === 'maximum' ? field.constraint : null,
    }
  }
  const value = text(field)
  if (!value) return null
  return { value, source: null, confidence: null, constraint: null }
}

function pushFact(facts, label, field) {
  const record = readStoredField(field)
  if (!record) return
  facts.push({ label, ...record })
}

export function extractedClauses(technical = {}) {
  const clauses = []
  for (const key of CLAUSE_KEYS) {
    const entries = technical?.[key]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const record = readStoredField(entry)
      if (!record) continue
      clauses.push(record)
    }
  }
  return clauses
}

function addName(names, seen, name) {
  const value = text(name)
  if (!value || value === 'metadata.json' || value === 'philgeps-structured') return
  if (seen.has(value)) return
  seen.add(value)
  names.push(value)
}

export function sourceDocumentNames(requirements, packetDocuments = []) {
  const names = []
  const seen = new Set()
  for (const name of requirements?.sourceDocuments || []) addName(names, seen, name)
  for (const clause of extractedClauses(requirements?.technical)) addName(names, seen, clause.source)
  for (const fact of summaryFacts(requirements)) addName(names, seen, fact.source)
  for (const document of packetDocuments || []) {
    addName(names, seen, document?.filename || document?.name)
  }
  return names
}

function summaryFacts(requirements) {
  const items = Array.isArray(requirements?.items) ? requirements.items : []
  const facts = []
  items.forEach((item, index) => {
    const suffix = items.length > 1 ? ` ${index + 1}` : ''
    pushFact(facts, `License type / edition${suffix}`, item?.licenseType)
    pushFact(facts, `Subscription duration${suffix}`, item?.subscriptionDuration)
  })
  const itemHasDuration = facts.some((fact) => fact.label.startsWith('Subscription duration'))
  if (!itemHasDuration) {
    pushFact(facts, 'Subscription duration', requirements?.delivery?.subscriptionDuration)
  }
  pushFact(facts, 'Deployment / installation', requirements?.technical?.cloudOrOnPremise)
  return facts
}

export function sourceLabelFor(source, documents = []) {
  if (!source || source === 'philgeps-structured') {
    return source === 'philgeps-structured' ? 'PhilGEPS' : null
  }
  const index = documents.findIndex((name) => name === source)
  if (index >= 0) return `Document ${String(index + 1).padStart(2, '0')}`
  return 'Source document'
}

export function buildTechnicalSummary(requirements, packetDocuments = []) {
  const clauses = requirements ? extractedClauses(requirements.technical) : []
  const documents = sourceDocumentNames(requirements, packetDocuments)
  const facts = requirements
    ? summaryFacts(requirements).map((fact) => ({
      ...fact,
      sourceLabel: sourceLabelFor(fact.source, documents),
    }))
    : []
  return {
    facts,
    clauses,
    clauseCount: clauses.length,
    documents,
  }
}

export function resolveDocumentLinks(names, files, state) {
  const listed = Array.isArray(files) ? files : []
  return (names || []).map((name) => {
    if (state !== 'ready') {
      return {
        name,
        href: null,
        status: state === 'error' || state === 'unavailable' ? 'unknown' : 'checking',
      }
    }
    const match = listed.find((file) => file?.filename === name)
    if (!match?.url) return { name, href: null, status: 'unavailable' }
    return { name, href: match.url, status: 'available' }
  })
}
