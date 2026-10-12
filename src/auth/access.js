/** Local development gives guests the same feature access as staff. Production stays restricted. */
export function guestFullAccessEnabled(env = process.env) {
  if (env.GUEST_FULL_ACCESS === 'true') return true
  if (env.GUEST_FULL_ACCESS === 'false') return false
  return env.NODE_ENV !== 'production'
}

export function requestHasGuestFullAccess(req) {
  const override = req.app?.get('guestFullAccess')
  if (override === true || override === false) return override
  return guestFullAccessEnabled()
}
