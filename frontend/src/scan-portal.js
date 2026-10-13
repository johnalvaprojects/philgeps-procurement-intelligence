export const CURRENT_SCAN_PORTAL = 'current'
export const LEGACY_SCAN_PORTAL = 'legacy'

export function parseLegacyPageLimit(value) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    return {
      ok: false,
      error: 'Old PhilGEPS page limit must be a whole number from 1 to 5.',
    }
  }
  return { ok: true, pageLimit: value }
}
