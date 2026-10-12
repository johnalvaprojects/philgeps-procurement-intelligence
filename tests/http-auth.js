import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFirstStaff } from '../src/auth/store.js';
import authRoutes from '../src/server/routes/auth-routes.js';

export async function provisionStaff(app, { username = 'tester' } = {}) {
  const authDir = await mkdtemp(path.join(tmpdir(), 'philgeps-auth-'));
  const password = `Phrase-${randomBytes(8).toString('hex')}`;
  app.set('authDir', authDir);
  await createFirstStaff({ directory: authDir, username, password });
  return { authDir, username, password };
}

export function useAuthRoutes(app) {
  app.use('/api/auth', authRoutes);
}

export async function loginStaff(port, account) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, password: account.password }),
  });
  const body = await response.json();
  if (response.status !== 200) {
    throw new Error(`Staff sign-in failed with ${response.status}`);
  }
  return {
    cookie: (response.headers.get('set-cookie') || '').split(';')[0],
    csrfToken: body.csrfToken,
    username: body.username,
  };
}

export function staffHeaders(auth, extra = {}) {
  return {
    cookie: auth.cookie,
    'x-csrf-token': auth.csrfToken,
    ...extra,
  };
}
