const attempts = new Map();

export function loginRateLimit({ maxAttempts = 5, windowMs = 15 * 60 * 1000 } = {}) {
  return {
    blocked(key, now = Date.now()) {
      const entry = attempts.get(key);
      if (!entry || entry.resetAt <= now) return false;
      return entry.count >= maxAttempts;
    },
    fail(key, now = Date.now()) {
      const entry = attempts.get(key);
      if (!entry || entry.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return;
      }
      entry.count += 1;
    },
    clear(key) {
      attempts.delete(key);
    },
  };
}

export function clientAddress(req) {
  return req.socket?.remoteAddress || 'unknown';
}
