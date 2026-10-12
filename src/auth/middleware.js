import { safeEqual } from './crypto.js';
import { clearSessionCookie, readCookie, SESSION_COOKIE } from './cookies.js';
import { authDirectory, readSession } from './store.js';
import { requestHasGuestFullAccess } from './access.js';

export function sessionTtlMs(req) {
  const fromApp = req.app.get('sessionTtlMs');
  if (fromApp != null) {
    const value = Number(fromApp);
    if (Number.isFinite(value) && value >= 1) return value;
  }
  const configured = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
  if (!Number.isFinite(configured) || configured < 60_000) return 12 * 60 * 60 * 1000;
  return configured;
}

export function directoryFor(req) {
  return authDirectory(req.app.get('authDir'));
}

export function attachAuth(req, res, next) {
  readSession(directoryFor(req), readCookie(req, SESSION_COOKIE))
    .then((session) => {
      req.auth = session;
      if (!session && readCookie(req, SESSION_COOKIE)) clearSessionCookie(res, req);
      next();
    })
    .catch(next);
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    const role = req.auth.role;
    const guestOperator = role === 'guest' && roles.includes('staff') && requestHasGuestFullAccess(req);
    if (!roles.includes(role) && !guestOperator) {
      res.status(403).json({ error: 'Staff sign-in required' });
      return;
    }
    next();
  };
}

export function requireCsrf(req, res, next) {
  const sent = String(req.get('x-csrf-token') || '');
  const expected = String(req.auth?.csrfToken || '');
  if (!sent || !expected || !safeEqual(sent, expected)) {
    res.status(403).json({ error: 'Request blocked' });
    return;
  }
  next();
}
