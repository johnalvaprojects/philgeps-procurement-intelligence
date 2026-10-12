import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { delay } from '../../../src/log.js';
import { baseUrl, requestDelayMs } from '../../../src/philgeps/client.js';
import { projectRoot } from '../../../src/project-root.js';
import { selectBatch } from './batch.js';
import { normalizeReference } from './parse.js';
import { retrieveAwards } from './retrieve.js';
import { classifyBid, classifySupplier } from './supplier.js';
import { applyCheckResult, awardsDirectory, listAwards, readAward, writeAward } from './store.js';

const activeChecks = new Map();
const batchJobs = new Map();

function outputDirectory(directory) {
  return directory || path.join(projectRoot, 'data', 'output');
}

function activeSet(directory) {
  const key = awardsDirectory(directory);
  if (!activeChecks.has(key)) activeChecks.set(key, new Set());
  return activeChecks.get(key);
}

function busy() {
  const error = new Error('An award check is already running.');
  error.code = 'BUSY';
  return error;
}

export function awardSettings(req) {
  const configuredDelay = req.app.get('awardDelayMs');
  return {
    awardsDir: awardsDirectory(req.app.get('awardsDir')),
    outputDir: outputDirectory(req.app.get('outputDir')),
    fetchImpl: req.app.get('awardFetch') || fetch,
    baseUrl: req.app.get('awardBaseUrl') || baseUrl(),
    delayMs: configuredDelay == null ? requestDelayMs() : Number(configuredDelay),
    timeoutMs: Number(req.app.get('awardTimeoutMs') || 20000),
  };
}

async function readNoticeFile(outputDir, reference) {
  try {
    const content = await readFile(path.join(outputDir, `${reference}.json`), 'utf8');
    const packet = JSON.parse(content);
    return {
      referenceNumber: reference,
      title: packet.notice?.title ?? null,
      organization: packet.notice?.organization ?? null,
      postedDate: packet.notice?.postedDate ?? null,
      deadline: packet.notice?.deadline ?? null,
      classification: packet.classification ?? null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function savedNoticeSummaries(outputDir) {
  const directory = outputDirectory(outputDir);
  let files = [];
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const notices = [];
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue;
    const reference = normalizeReference(file.replace(/\.json$/, ''));
    if (!reference) continue;
    const notice = await readNoticeFile(directory, reference);
    if (notice) notices.push(notice);
  }
  return notices;
}

export function publicAward(award) {
  return {
    awardNumber: award.awardNumber,
    bidReference: award.bidReference,
    title: award.title ?? null,
    supplier: award.supplier ?? null,
    contractAmount: award.contractAmount ?? null,
    awardDate: award.awardDate ?? null,
    publishedDate: award.publishedDate ?? null,
    status: award.status ?? null,
    sourceUrl: award.sourceUrl ?? null,
  };
}

export function presentAward(record, role) {
  const body = {
    referenceNumber: record.referenceNumber,
    outcome: record.outcome || 'never',
    lastCheckedAt: record.lastCheckedAt || null,
    truncated: Boolean(record.truncated),
    awards: (record.awards || []).map((award) => ({
      ...publicAward(award),
      supplierStanding: classifySupplier(award?.supplier),
    })),
    supplierStanding: classifyBid(record),
    conflicts: (record.conflicts || []).map((conflict) => ({
      awardNumber: conflict.awardNumber,
      bidReference: conflict.bidReference ?? null,
      sourceUrl: conflict.sourceUrl ?? null,
      reason: conflict.reason,
    })),
  };
  if (role === 'staff') body.error = record.error || null;
  return body;
}

export function buildOverview(notices, records, role) {
  const stored = new Map(records.map((record) => [record.referenceNumber, record]));
  const rows = notices.map((notice) => {
    const record = stored.get(notice.referenceNumber);
    const row = presentAward(record || {
      referenceNumber: notice.referenceNumber,
      outcome: 'never',
      awards: [],
      conflicts: [],
    }, role);
    row.title = notice.title;
    row.organization = notice.organization;
    row.postedDate = notice.postedDate;
    row.deadline = notice.deadline;
    if (role === 'staff') row.classification = notice.classification ?? null;
    return row;
  });
  const count = (outcome) => rows.filter((row) => row.outcome === outcome).length;
  const lastCheckedAt = rows.map((row) => row.lastCheckedAt).filter(Boolean).sort().at(-1) || null;
  return {
    totals: {
      savedNotices: rows.length,
      checked: rows.length - count('never'),
      published: count('published'),
      none: count('none'),
      failed: count('failed'),
      conflict: count('conflict'),
      never: count('never'),
    },
    lastCheckedAt,
    records: rows,
  };
}

export async function checkSavedNotice(reference, settings, { fromBatch = false } = {}) {
  const safe = normalizeReference(reference);
  if (!safe) {
    const error = new Error('Invalid bid reference.');
    error.code = 'INVALID';
    throw error;
  }
  const job = batchJobs.get(awardsDirectory(settings.awardsDir));
  if (!fromBatch && job?.running) throw busy();
  const running = activeSet(settings.awardsDir);
  if (running.has(safe)) throw busy();
  running.add(safe);
  try {
    const notice = await readNoticeFile(settings.outputDir, safe);
    if (!notice) {
      const error = new Error('Notice not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const previous = await readAward(settings.awardsDir, safe);
    const result = await retrieveAwards(safe, settings);
    const record = applyCheckResult(previous, result, new Date().toISOString());
    await writeAward(settings.awardsDir, record);
    return record;
  } finally {
    running.delete(safe);
  }
}

export function batchStatus(directory) {
  const job = batchJobs.get(awardsDirectory(directory));
  if (!job) {
    return { running: false, total: 0, completed: 0, current: null, results: [], limit: 0 };
  }
  return {
    running: job.running,
    total: job.total,
    completed: job.completed,
    current: job.current,
    results: job.results.map((result) => ({ ...result })),
    limit: job.limit,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export async function startBatch(settings, limit, classification = null) {
  const directory = awardsDirectory(settings.awardsDir);
  const existing = batchJobs.get(directory);
  if (existing?.running || activeSet(directory).size > 0) throw busy();
  const notices = await savedNoticeSummaries(settings.outputDir);
  const stored = new Map((await listAwards(directory)).map((record) => [record.referenceNumber, record]));
  const references = selectBatch(notices, stored, { limit, classification });
  const job = {
    running: true,
    total: references.length,
    completed: 0,
    current: null,
    results: [],
    limit,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  batchJobs.set(directory, job);
  if (references.length === 0) {
    job.running = false;
    job.finishedAt = new Date().toISOString();
    return { started: false, status: batchStatus(directory) };
  }
  (async () => {
    for (const reference of references) {
      job.current = reference;
      try {
        const record = await checkSavedNotice(reference, settings, { fromBatch: true });
        job.results.push({ referenceNumber: reference, outcome: record.outcome });
      } catch (error) {
        job.results.push({
          referenceNumber: reference,
          outcome: 'failed',
          error: error.code === 'BUSY' ? 'An award check is already running.' : 'The public award search did not respond.',
        });
      }
      job.completed += 1;
      if (settings.delayMs > 0) await delay(settings.delayMs);
    }
    job.current = null;
    job.running = false;
    job.finishedAt = new Date().toISOString();
  })();
  return { started: true, status: batchStatus(directory) };
}
