/** Elevated guest access is opt-in for local development and demo only.
 *  Do not expose a server with this enabled to the public internet. */

const PERMITTED_ENVIRONMENTS = new Set(['development', 'demo'])

export function guestFullAccessEnabled(env = process.env) {
  if (env.NODE_ENV === 'production') return false
  if (env.GUEST_FULL_ACCESS !== 'true') return false
  return PERMITTED_ENVIRONMENTS.has(env.NODE_ENV)
}

export function requestHasGuestFullAccess(req, env = process.env) {
  if (env.NODE_ENV === 'production') return false
  const override = req.app?.get('guestFullAccess')
  if (override === true || override === false) return override
  return guestFullAccessEnabled(env)
}
