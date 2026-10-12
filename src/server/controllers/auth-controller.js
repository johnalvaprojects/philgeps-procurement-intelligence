import { clientAddress, loginRateLimit } from '../../auth/rate-limit.js';
import { clearSessionCookie, readCookie, SESSION_COOKIE, setSessionCookie } from '../../auth/cookies.js';
import { directoryFor, sessionTtlMs } from '../../auth/middleware.js';
import { authenticateStaff, createSession, destroySession } from '../../auth/store.js';
import { passwordError, usernameError } from '../../auth/validation.js';
import { requestHasGuestFullAccess } from '../../auth/access.js';

const limiters = new WeakMap();

function limiterFor(app) {
  let limiter = limiters.get(app);
  if (!limiter) {
    const maxAttempts = Number(app.get('loginMaxAttempts') || process.env.LOGIN_MAX_ATTEMPTS || 5);
    const windowMs = Number(app.get('loginWindowMs') || process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
    limiter = loginRateLimit({
      maxAttempts: Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5,
      windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 15 * 60 * 1000,
    });
    limiters.set(app, limiter);
  }
  return limiter;
}

function sessionBody(session, req) {
  const fullAccess = session.role === 'staff' || (session.role === 'guest' && requestHasGuestFullAccess(req));
  return {
    authenticated: true,
    role: session.role,
    username: session.role === 'staff' ? session.username : null,
    csrfToken: session.csrfToken,
    fullAccess,
  };
}

export async function getSession(req, res, next) {
  try {
    if (!req.auth) {
      res.json({ authenticated: false });
      return;
    }
    res.json(sessionBody(req.auth, req));
  } catch (error) {
    next(error);
  }
}

export async function startGuest(req, res, next) {
  try {
    const directory = directoryFor(req);
    const ttlMs = sessionTtlMs(req);
    const session = await createSession(directory, { role: 'guest', ttlMs });
    setSessionCookie(res, req, session.token, ttlMs);
    res.json(sessionBody(session, req));
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const limiter = limiterFor(req.app);
    const address = clientAddress(req);
    if (limiter.blocked(address)) {
      res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
      return;
    }

    const username = req.body?.username;
    const password = req.body?.password;
    if (typeof username !== 'string' || typeof password !== 'string' || usernameError(username) || passwordError(password, username)) {
      limiter.fail(address);
      res.status(401).json({ error: 'Sign-in failed.' });
      return;
    }

    const account = await authenticateStaff(directoryFor(req), username, password);
    if (!account) {
      limiter.fail(address);
      res.status(401).json({ error: 'Sign-in failed.' });
      return;
    }

    limiter.clear(address);
    const ttlMs = sessionTtlMs(req);
    const session = await createSession(directoryFor(req), {
      role: 'staff',
      userId: account.id,
      username: account.username,
      ttlMs,
    });
    setSessionCookie(res, req, session.token, ttlMs);
    res.json(sessionBody(session, req));
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    await destroySession(directoryFor(req), readCookie(req, SESSION_COOKIE));
    clearSessionCookie(res, req);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}
