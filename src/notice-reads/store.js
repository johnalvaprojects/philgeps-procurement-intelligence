import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../project-root.js';
import { isSafeStorageId, storageIdFromFilename } from '../notice-source.js';

const locks = new Map();

export function noticeReadsDirectory(directory) {
  return directory || path.join(projectRoot, 'data', 'notice-reads');
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

async function storageIds(outputDir, knownIds) {
  if (Array.isArray(knownIds)) return knownIds.filter((id) => isSafeStorageId(id));
  const names = await readdir(outputDir);
  return names.map((name) => storageIdFromFilename(name)).filter(Boolean);
}

async function ensureBaseline(directory, outputDir, knownIds) {
  const state = await readState(directory);
  if (state.baselineRecorded) return state;
  const now = new Date().toISOString();
  const ids = await storageIds(outputDir, knownIds);
  for (const id of ids) {
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
  return withLock(directory, () => ensureBaseline(directory, outputDir, knownIds));
}

export function recordNoticeRead(directory, outputDir, noticeId) {
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
}
