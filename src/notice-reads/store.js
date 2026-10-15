import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../project-root.js';
import { isSafeStorageId, storageIdFromFilename } from '../notice-source.js';

const PROJECT_READS = path.resolve(projectRoot, 'data', 'notice-reads');
const PROJECT_OUTPUT = path.resolve(projectRoot, 'data', 'output');

const locks = new Map();

function requiredDirectory(directory) {
  if (!directory || typeof directory !== 'string') {
    const error = new Error('Notice read directory is required');
    error.status = 500;
    throw error;
  }
  return directory;
}

function assertCompatibleLocations(directory, outputDir) {
  const reads = path.resolve(requiredDirectory(directory));
  const output = path.resolve(outputDir || '');
  if (reads === PROJECT_READS && output !== PROJECT_OUTPUT) {
    const error = new Error('Refusing to use the project notice-read store with another notice directory');
    error.status = 500;
    throw error;
  }
}

export function noticeReadsDirectory(directory) {
  return requiredDirectory(directory);
}

function statePath(directory) {
  return path.join(noticeReadsDirectory(directory), 'reads.json');
}

function withLock(directory, fn) {
  const key = noticeReadsDirectory(directory);
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(key, run.then(() => {}, () => {}));
  return run;
}

async function readState(directory) {
  try {
    const parsed = JSON.parse(await readFile(statePath(directory), 'utf8'));
    const read = parsed?.read && typeof parsed.read === 'object' ? parsed.read : {};
    return {
      baselineRecorded: parsed?.baselineRecorded === true,
      read,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { baselineRecorded: false, read: {} };
    throw error;
  }
}

async function writeState(directory, state) {
  const file = statePath(directory);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    baselineRecorded: state.baselineRecorded === true,
    read: state.read,
  }, null, 2)}\n`);
  await rename(temporary, file);
}

async function storageIds(outputDir) {
  const names = await readdir(outputDir);
  return names.map((name) => storageIdFromFilename(name)).filter(Boolean);
}

function sameIds(left, right) {
  if (left.length !== right.length) return false;
  const seen = new Set(right);
  return left.every((id) => seen.has(id));
}

function appearedAt(fileStat) {
  if (Number.isFinite(fileStat.birthtimeMs) && fileStat.birthtimeMs > 0) return fileStat.birthtimeMs;
  return fileStat.mtimeMs;
}

async function ensureBaseline(directory, outputDir, knownIds) {
  const state = await readState(directory);
  if (state.baselineRecorded) return state;
  const present = await storageIds(outputDir);
  if (Array.isArray(knownIds)) {
    const requested = knownIds.filter((id) => isSafeStorageId(id));
    if (!sameIds(requested, present)) {
      const error = new Error('Refusing to record a partial notice-read baseline');
      error.status = 500;
      throw error;
    }
  }
  const now = new Date().toISOString();
  for (const id of present) {
    if (!state.read[id]) state.read[id] = now;
  }
  state.baselineRecorded = true;
  await writeState(directory, state);
  return state;
}

export function isUnread(state, noticeId) {
  if (!state?.baselineRecorded) return false;
  return !state.read?.[noticeId];
}

export function loadNoticeReads(directory, outputDir, knownIds) {
  return Promise.resolve().then(() => {
    assertCompatibleLocations(directory, outputDir);
    return withLock(directory, () => ensureBaseline(directory, outputDir, knownIds));
  });
}

export function recordNoticeRead(directory, outputDir, noticeId) {
  return Promise.resolve().then(() => {
    assertCompatibleLocations(directory, outputDir);
    return withLock(directory, async () => {
      if (!isSafeStorageId(noticeId)) {
        const error = new Error('Invalid notice id');
        error.status = 400;
        throw error;
      }
      const state = await ensureBaseline(directory, outputDir);
      if (!state.read[noticeId]) {
        state.read[noticeId] = new Date().toISOString();
        await writeState(directory, state);
      }
      return { noticeId, read: true, unread: false };
    });
  });
}

export function repairNoticeReadBaseline(directory, outputDir, { cutoff } = {}) {
  return Promise.resolve().then(() => {
    assertCompatibleLocations(directory, outputDir);
    const cutoffMs = Date.parse(cutoff);
    if (!Number.isFinite(cutoffMs)) {
      const error = new Error('A baseline cutoff time is required');
      error.status = 400;
      throw error;
    }
    const cutoffStamp = new Date(cutoffMs).toISOString();
    return withLock(directory, async () => {
      const state = await readState(directory);
      const names = await readdir(outputDir);
      const read = {};
      for (const name of names) {
        const id = storageIdFromFilename(name);
        if (!id) continue;
        const fileStat = await stat(path.join(outputDir, name));
        const existing = typeof state.read?.[id] === 'string' ? state.read[id] : '';
        const existingMs = Date.parse(existing);
        const hasRead = Boolean(existing) && Number.isFinite(existingMs);
        if (appearedAt(fileStat) <= cutoffMs) {
          read[id] = hasRead ? existing : cutoffStamp;
        } else if (hasRead && existingMs > cutoffMs) {
          read[id] = existing;
        }
      }
      const next = { baselineRecorded: true, read };
      await writeState(directory, next);
      return next;
    });
  });
}
