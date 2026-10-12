/** Confirmed public awardee text. Add an alias only after it is read from an official record. */
export const TRUSTERA_ALIASES = ['TRUSTERA SOLUTIONS INC.']

export function normalizeSupplierName(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ALIAS_KEYS = new Set(TRUSTERA_ALIASES.map(normalizeSupplierName).filter(Boolean))

/** Award-level party from the supplier field only. A blank name is unverified, not a loss. */
export function classifySupplier(supplier) {
  const key = normalizeSupplierName(supplier)
  if (!key) return 'unverified'
  return ALIAS_KEYS.has(key) ? 'truster' : 'other'
}

/**
 * Bid-level party. Check outcome wins over supplier text.
 * Mixed requires one confirmed Trustera award and one confirmed other supplier.
 * A missing supplier never counts as another supplier. It also does not erase a confirmed Trustera award.
 */
export function classifyBid(record) {
  const outcome = record?.outcome || 'never'
  if (outcome === 'failed') return 'failed'
  if (outcome === 'conflict') return 'conflict'
  if (outcome === 'none') return 'none'
  if (outcome !== 'published') return 'never'
  const parties = (record.awards || []).map((award) => classifySupplier(award?.supplier))
  const awardedToTrustera = parties.includes('truster')
  const awardedToOther = parties.includes('other')
  const supplierMissing = parties.includes('unverified')
  if (awardedToTrustera && awardedToOther) return 'mixed'
  if (awardedToTrustera) return 'truster'
  if (awardedToOther && !supplierMissing) return 'other'
  return 'unverified'
}

export function supplierStandingLabel(standing) {
  if (standing === 'truster') return 'Awarded to Trustera'
  if (standing === 'other') return 'Awarded to another supplier'
  if (standing === 'mixed') return 'Mixed suppliers'
  if (standing === 'unverified') return 'Supplier unverified'
  if (standing === 'none') return 'No published award'
  if (standing === 'failed') return 'Failed or unverified'
  if (standing === 'conflict') return 'Conflict'
  return 'Not checked'
}
