/**
 * Temporary archive switches. A value of true hides that feature.
 * The archived code is in archive/merchant-awards/. See its README to restore a feature.
 */
export const archivedFeatures = {
  awards: true,
  merchant: true,
}

export function featureEnabled(name) {
  return archivedFeatures[name] !== true
}
