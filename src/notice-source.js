export const CURRENT_PORTAL = Object.freeze({
  id: 'current',
  label: 'Current PhilGEPS',
})

export const LEGACY_PORTAL = Object.freeze({
  id: 'legacy',
  label: 'Old PhilGEPS',
})

export const DOCUMENTS_LOGIN_REQUIRED = 'Documents unavailable — login required'

const STORAGE_ID = /^(?:\d+|legacy-\d+)$/

export function isSafeStorageId(value) {
  return STORAGE_ID.test(String(value ?? '').trim())
}

export function storageIdFromFilename(name) {
  const file = String(name || '')
  if (!file.endsWith('.json')) return null
  const id = file.slice(0, -'.json'.length)
  return isSafeStorageId(id) ? id : null
}

export function portalFromPacket(packet, storageId = '') {
  const raw = String(packet?.source?.id || '').trim().toLowerCase()
  if (raw === 'legacy' || raw === 'old') return { ...LEGACY_PORTAL }
  if (raw === 'current' || raw === 'modern') return { ...CURRENT_PORTAL }
  if (String(storageId).startsWith('legacy-')) return { ...LEGACY_PORTAL }
  return { ...CURRENT_PORTAL }
}

export function documentsRequireLogin(packet) {
  return packet?.documentAccess === 'login-required'
}
