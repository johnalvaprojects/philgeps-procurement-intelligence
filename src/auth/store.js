import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../project-root.js';
import { hashPassword, randomToken, sha256, verifyPassword } from './crypto.js';
import { normalizeUsername, passwordError, usernameError } from './validation.js';

const locks = new Map();

export function authDirectory(directory) {
  return directory || path.join(projectRoot, 'data', 'auth');
}

function usersPath(directory) {
  return path.join(authDirectory(directory), 'users.json');
}

function sessionsPath(directory) {
  return path.join(authDirectory(directory), 'sessions.json');
}

function withLock(directory, fn) {
  const key = authDirectory(directory);
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(key, run.then(() => {}, () => {}));
  return run;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temporary, file);
}

async function readUsers(directory) {
  const data = await readJson(usersPath(directory), { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

async function readSessions(directory) {
  const data = await readJson(sessionsPath(directory), { sessions: [] });
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function listStaffUsernames(directory) {
  const users = await readUsers(directory);
  return users.map((user) => user.username).filter(Boolean);
}

export async function createFirstStaff({ directory, username, password }) {
  return withLock(directory, async () => {
    const users = await readUsers(directory);
    if (users.length > 0) {
      const error = new Error('A staff account already exists.');
      error.code = 'ACCOUNT_EXISTS';
      throw error;
    }
    const record = await buildUser(username, password);
    await writeJson(usersPath(directory), { users: [record] });
    return { id: record.id, username: record.username };
  });
}

export async function addStaffAccount({ directory, username, password }) {
  return withLock(directory, async () => {
    const users = await readUsers(directory);
    const record = await buildUser(username, password);
    if (users.some((user) => user.username === record.username)) {
      const error = new Error('That username is already in use.');
      error.code = 'USERNAME_EXISTS';
      throw error;
    }
    users.push(record);
    await writeJson(usersPath(directory), { users });
    return { id: record.id, username: record.username };
  });
}

async function buildUser(username, password) {
  const nameError = usernameError(username);
  if (nameError) {
    const error = new Error(nameError);
    error.code = 'INVALID_USERNAME';
    throw error;
  }
  const secretError = passwordError(password, username);
  if (secretError) {
    const error = new Error(secretError);
    error.code = 'INVALID_PASSWORD';
    throw error;
  }
  const hashed = await hashPassword(password);
  return {
    id: randomToken(16),
    username: normalizeUsername(username),
    passwordHash: hashed.passwordHash,
    salt: hashed.salt,
    scrypt: hashed.scrypt,
    createdAt: new Date().toISOString(),
  };
}

let dummyUser = null;

async function dummyPasswordUser() {
  if (!dummyUser) dummyUser = await buildUser('unused', randomToken(24));
  return dummyUser;
}

export async function authenticateStaff(directory, username, password) {
  const users = await readUsers(directory);
  const name = normalizeUsername(username);
  const user = users.find((item) => item.username === name);
  const valid = await verifyPassword(password, user || await dummyPasswordUser());
  if (!user || !valid) return null;
  return { id: user.id, username: user.username };
}

function liveSessions(sessions, now) {
  return sessions.filter((session) => Date.parse(session.expiresAt) > now);
}

export async function createSession(directory, { role, userId = null, username = null, ttlMs }) {
  return withLock(directory, async () => {
    const now = Date.now();
    const token = randomToken(32);
    const session = {
      tokenHash: sha256(token),
      role,
      userId,
      username,
      csrfToken: randomToken(32),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };
    const sessions = liveSessions(await readSessions(directory), now);
    sessions.push(session);
    await writeJson(sessionsPath(directory), { sessions });
    return { token, csrfToken: session.csrfToken, expiresAt: session.expiresAt, role, username };
  });
}

export async function readSession(directory, token) {
  if (!token) return null;
  const tokenHash = sha256(token);
  const now = Date.now();
  const sessions = await readSessions(directory);
  const session = sessions.find((item) => item.tokenHash === tokenHash);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= now) {
    await destroySession(directory, token);
    return null;
  }
  return {
    role: session.role,
    userId: session.userId,
    username: session.username,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  };
}

export async function destroySession(directory, token) {
  if (!token) return;
  return withLock(directory, async () => {
    const tokenHash = sha256(token);
    const sessions = (await readSessions(directory)).filter((session) => session.tokenHash !== tokenHash);
    await writeJson(sessionsPath(directory), { sessions });
  });
}

export async function sessionFileContains(directory, value) {
  try {
    const text = await readFile(sessionsPath(directory), 'utf8');
    return text.includes(value);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
