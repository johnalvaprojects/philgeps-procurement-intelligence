import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../../src/project-root.js';
import { normalizeReference } from './parse.js';

const locks = new Map();

export function awardsDirectory(directory) {
  return directory || path.join(projectRoot, 'data', 'awards');
}

function awardPath(directory, reference) {
  const safe = normalizeReference(reference);
  if (!safe) {
    const error = new Error('Invalid bid reference.');
    error.code = 'INVALID';
    throw error;
  }
  return path.join(awardsDirectory(directory), `${safe}.json`);
}

function withLock(directory, fn) {
  const key = awardsDirectory(directory);
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(key, run.then(() => {}, () => {}));
  return run;
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temporary, file);
}

export function applyCheckResult(previous, result, checkedAt) {
  if (!result.ok) {
    return {
      referenceNumber: result.referenceNumber,
      outcome: 'failed',
      lastCheckedAt: checkedAt,
      error: result.error || 'The public award search did not respond.',
      truncated: Boolean(previous?.truncated),
      awards: previous?.awards || [],
      conflicts: previous?.conflicts || [],
    };
  }
  const conflicts = result.conflicts || [];
  const confirmed = result.awards || [];
  const keepPrevious = conflicts.length > 0 && confirmed.length === 0 && (previous?.awards || []).length > 0;
  let outcome = 'none';
  if (conflicts.length > 0) outcome = 'conflict';
  else if (confirmed.length > 0) outcome = 'published';
  return {
    referenceNumber: result.referenceNumber,
    outcome,
    lastCheckedAt: checkedAt,
    error: null,
    truncated: Boolean(result.truncated),
    awards: keepPrevious ? previous.awards : confirmed,
    conflicts,
  };
}

export async function readAward(directory, reference) {
  try {
    const content = await readFile(awardPath(directory, reference), 'utf8');
    const data = JSON.parse(content);
    if (data?.referenceNumber !== normalizeReference(reference)) return null;
    return data;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'INVALID') return null;
    throw error;
  }
}

export async function writeAward(directory, record) {
  const reference = normalizeReference(record?.referenceNumber);
  if (!reference) {
    const error = new Error('Invalid bid reference.');
    error.code = 'INVALID';
    throw error;
  }
  const stored = { ...record, referenceNumber: reference };
  await withLock(directory, () => writeJson(awardPath(directory, reference), stored));
  return stored;
}

export async function listAwards(directory) {
  const folder = awardsDirectory(directory);
  let files = [];
  try {
    files = await readdir(folder);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue;
    try {
      const data = JSON.parse(await readFile(path.join(folder, file), 'utf8'));
      if (normalizeReference(data?.referenceNumber)) records.push(data);
    } catch {
      // A damaged award file stays out of the overview.
    }
  }
  return records;
}
