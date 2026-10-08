import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './project-root.js';
import { getScanProgress } from './scan-progress.js';

export const SCAN_REPORTS_DIR = path.join(projectRoot, 'data', 'output', 'scan-reports');

const REPORT_ID = /^\d+$/;

export function isSafeReportId(id) {
  return REPORT_ID.test(String(id || ''));
}

/**
 * Identity used to keep one row per notice in a report.
 * A source-aware id can be supplied later. Until then the reference number is the identity.
 */
export function noticeReportIdentity(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.identity != null && String(row.identity).trim() !== '') return String(row.identity);
  if (row.referenceNumber != null && String(row.referenceNumber).trim() !== '') {
    return String(row.referenceNumber);
  }
  return null;
}

function softwareOpportunity(row) {
  return {
    referenceNumber: row.referenceNumber ? String(row.referenceNumber) : null,
    title: row.title || null,
    organization: row.organization || null,
    source: row.classificationSource || null,
    reviewStatus: row.reviewed === true ? 'reviewed' : row.reviewed === false ? 'pending' : null,
    previouslySaved: row.alreadyProcessed === true,
  };
}

export function buildScanReport({ progress = {}, rows = [], mode = 'scan', errorMessage = null, finishedAt = null } = {}) {
  const softwareOpportunities = [];
  const errors = [];
  const seenSoftware = new Set();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (row.error) {
      errors.push({
        referenceNumber: row.referenceNumber ? String(row.referenceNumber) : null,
        message: String(row.error),
      });
      continue;
    }
    const matchingSoftware = row.isRelevant === true && row.needsReview !== true;
    if (!matchingSoftware) continue;
    const identity = noticeReportIdentity(row);
    if (identity && seenSoftware.has(identity)) continue;
    if (identity) seenSoftware.add(identity);
    softwareOpportunities.push(softwareOpportunity(row));
  }

  if (errorMessage && errors.length === 0) {
    errors.push({ referenceNumber: null, message: String(errorMessage) });
  }

  const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

  return {
    id: progress.startedAt != null ? String(progress.startedAt) : null,
    startedAt: progress.startedAt ?? null,
    finishedAt: finishedAt || new Date().toISOString(),
    from: progress.from || null,
    to: progress.to || null,
    mode: mode || 'scan',
    durationMs: Number.isFinite(Number(progress.elapsedMs)) ? Number(progress.elapsedMs) : null,
    complete: progress.complete === true,
    completionReason: progress.completionReason || null,
    counts: {
      discovered: count(progress.noticesDiscovered),
      processed: count(progress.noticesProcessed),
      software: count(progress.softwareCount),
      review: count(progress.reviewCount),
      notRelevant: count(progress.notRelevantCount),
      alreadyProcessed: count(progress.alreadyProcessedCount),
      errors: count(progress.errorCount),
      documentsDownloaded: count(progress.documentsDownloaded),
      matchingSoftware: softwareOpportunities.length,
    },
    softwareOpportunities,
    errors,
  };
}

/**
 * Write one summary per scan start time.
 * If that file already exists, leave it unchanged.
 */
export async function writeScanReport(directory, report) {
  if (report?.startedAt == null) {
    return { saved: false, reason: 'missing-start' };
  }
  await mkdir(directory, { recursive: true });
  const baseId = String(report.startedAt);
  const basePath = path.join(directory, `${baseId}.json`);
  if (existsSync(basePath)) {
    return { saved: false, reason: 'exists', id: baseId };
  }
  const finalPath = basePath;
  const tempPath = path.join(directory, `.${baseId}.${process.pid}.tmp`);
  const body = {
    ...report,
    id: baseId,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(tempPath, `${JSON.stringify(body, null, 2)}\n`);
  await rename(tempPath, finalPath);
  return { saved: true, id: baseId, report: body };
}

export async function persistFinishedScanReport({
  mode = 'scan',
  rows = [],
  errorMessage = null,
  directory = SCAN_REPORTS_DIR,
} = {}) {
  const progress = getScanProgress();
  const report = buildScanReport({ progress, rows, mode, errorMessage });
  return writeScanReport(directory, report);
}

export async function listScanReports(directory = SCAN_REPORTS_DIR) {
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const reports = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    if (!isSafeReportId(id)) continue;
    try {
      const report = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      reports.push({
        id: report.id || id,
        startedAt: report.startedAt ?? null,
        finishedAt: report.finishedAt || null,
        from: report.from || null,
        to: report.to || null,
        mode: report.mode || null,
        complete: report.complete === true,
        completionReason: report.completionReason || null,
        durationMs: Number.isFinite(Number(report.durationMs)) ? Number(report.durationMs) : null,
        counts: report.counts || null,
      });
    } catch {
      // Skip unreadable files. Do not invent a summary.
    }
  }

  reports.sort((left, right) => Number(right.startedAt || 0) - Number(left.startedAt || 0));
  return reports;
}

export async function readScanReport(id, directory = SCAN_REPORTS_DIR) {
  if (!isSafeReportId(id)) return null;
  const filePath = path.join(directory, `${id}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}
