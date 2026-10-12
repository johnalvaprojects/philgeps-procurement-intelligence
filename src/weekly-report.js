import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './project-root.js';
import { parseIsoCalendarDay } from './scan-range.js';
import { listScanReports, noticeReportIdentity, readScanReport, SCAN_REPORTS_DIR } from './scan-reports.js';
import { storedWorkStatus } from './review/work-status.js';

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function ymdFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Calendar parts for an instant in Asia/Manila (UTC+8, no daylight saving). */
export function manilaParts(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * Monday 00:00 through Sunday 23:59:59.999 Asia/Manila for the week that contains instant.
 */
export function manilaWeekContaining(instant) {
  const parts = manilaParts(instant);
  if (!parts) return null;
  return manilaWeekForCalendarDay(parts.year, parts.month, parts.day);
}

/** Week containing a Manila calendar day. month is 1-based. */
export function manilaWeekForCalendarDay(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const noonUtc = Date.UTC(year, month - 1, day, 4, 0, 0);
  const shifted = new Date(noonUtc + MANILA_OFFSET_MS);
  if (
    shifted.getUTCFullYear() !== year
    || shifted.getUTCMonth() !== month - 1
    || shifted.getUTCDate() !== day
  ) {
    return null;
  }
  const mondayOffset = shifted.getUTCDay() === 0 ? 6 : shifted.getUTCDay() - 1;
  const mondayNoonUtc = noonUtc - mondayOffset * DAY_MS;
  const monday = new Date(mondayNoonUtc + MANILA_OFFSET_MS);
  const sunday = new Date(mondayNoonUtc + 6 * DAY_MS + MANILA_OFFSET_MS);
  const startMs = Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()) - MANILA_OFFSET_MS;
  const endMs = Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate(), 23, 59, 59, 999) - MANILA_OFFSET_MS;
  return {
    from: ymdFromUtcDate(monday),
    to: ymdFromUtcDate(sunday),
    startMs,
    endMs,
    timeZone: 'Asia/Manila',
  };
}

export function resolveManilaWeek(from, now = new Date()) {
  if (from == null || String(from).trim() === '') {
    const week = manilaWeekContaining(now);
    if (!week) return { error: 'from must be a valid YYYY-MM-DD date' };
    return { week };
  }
  const calendar = parseIsoCalendarDay(String(from).trim());
  if (!calendar) return { error: 'from must be a valid YYYY-MM-DD date' };
  const week = manilaWeekForCalendarDay(calendar.getFullYear(), calendar.getMonth() + 1, calendar.getDate());
  if (!week) return { error: 'from must be a valid YYYY-MM-DD date' };
  return { week };
}

function finiteCount(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordKind(row) {
  if (row?.previouslySaved === true) return 'saved';
  if (row?.previouslySaved === false) return 'new';
  return 'unknown';
}

function preferKind(current, next) {
  if (current === 'new' || next === 'new') return 'new';
  if (current === 'saved' || next === 'saved') return 'saved';
  return 'unknown';
}

function blankText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function sumRecorded(reports, key) {
  let total = 0;
  let recordedScans = 0;
  let missingScans = 0;
  for (const report of reports) {
    const value = finiteCount(report?.counts?.[key]);
    if (value == null) {
      missingScans += 1;
      continue;
    }
    recordedScans += 1;
    total += value;
  }
  return { total, recordedScans, missingScans };
}

function packetFields(packet) {
  if (!packet || typeof packet !== 'object') {
    return {
      abc: null,
      deadline: null,
      classification: null,
      workStatus: null,
      packetFound: false,
    };
  }
  const notice = packet.notice || {};
  return {
    abc: blankText(notice.abc),
    deadline: blankText(notice.deadline) || blankText(notice.closingDate),
    classification: blankText(packet.classification),
    workStatus: storedWorkStatus(packet.workStatus),
    packetFound: true,
  };
}

/**
 * Aggregate existing scan snapshots for one Manila week.
 * reports are full snapshot objects. packets and requirements are maps keyed by notice id.
 * This function does not write snapshots.
 */
export function buildWeeklyReport({
  week,
  reports = [],
  packets = new Map(),
  requirements = new Map(),
  generatedAt = new Date(),
} = {}) {
  const included = reports
    .filter((report) => {
      const started = finiteCount(report?.startedAt);
      return started != null && started >= week.startMs && started <= week.endMs;
    })
    .sort((left, right) => Number(left.startedAt) - Number(right.startedAt));

  const groups = new Map();
  let softwareRowsWithoutReference = 0;

  for (const report of included) {
    for (const row of report.softwareOpportunities || []) {
      if (!row || typeof row !== 'object') continue;
      const identity = noticeReportIdentity(row);
      if (!identity) {
        softwareRowsWithoutReference += 1;
        continue;
      }
      const kind = recordKind(row);
      const existing = groups.get(identity);
      if (!existing) {
        groups.set(identity, {
          referenceNumber: identity,
          title: blankText(row.title),
          organization: blankText(row.organization),
          kind,
        });
        continue;
      }
      const nextKind = preferKind(existing.kind, kind);
      if (existing.kind !== 'new' && kind === 'new') {
        existing.title = blankText(row.title) || existing.title;
        existing.organization = blankText(row.organization) || existing.organization;
      }
      existing.kind = nextKind;
    }
  }

  const opportunities = [];
  const previouslySaved = [];
  const unknownSoftware = [];
  const workStatus = { new: 0, inProgress: 0, done: 0, notRecorded: 0 };

  for (const group of [...groups.values()].sort((left, right) => left.referenceNumber.localeCompare(right.referenceNumber))) {
    const fields = packetFields(packets.get(group.referenceNumber));
    const extractionStatus = blankText(requirements.get(group.referenceNumber)?.extractionStatus);
    const item = {
      referenceNumber: group.referenceNumber,
      title: group.title,
      organization: group.organization,
      abc: fields.abc,
      deadline: fields.deadline,
      classification: fields.classification,
      scanClassification: 'software',
      packetFound: fields.packetFound,
      workStatus: fields.workStatus,
      extractionStatus,
      record: group.kind,
    };
    if (group.kind === 'new') {
      opportunities.push(item);
      if (fields.workStatus === 'new') workStatus.new += 1;
      else if (fields.workStatus === 'in-progress') workStatus.inProgress += 1;
      else if (fields.workStatus === 'done') workStatus.done += 1;
      else workStatus.notRecorded += 1;
    } else if (group.kind === 'saved') {
      previouslySaved.push(item);
    } else {
      unknownSoftware.push(item);
    }
  }

  const errors = [];
  for (const report of included) {
    for (const error of report.errors || []) {
      if (!error || typeof error !== 'object') continue;
      errors.push({
        scanId: report.id != null ? String(report.id) : null,
        startedAt: finiteCount(report.startedAt),
        referenceNumber: blankText(error.referenceNumber),
        message: blankText(error.message),
      });
    }
  }

  const incompleteRuns = included
    .filter((report) => report.complete === false)
    .map((report) => ({
      id: report.id != null ? String(report.id) : null,
      startedAt: finiteCount(report.startedAt),
      completionReason: blankText(report.completionReason),
    }));

  return {
    period: {
      from: week.from,
      to: week.to,
      timeZone: 'Asia/Manila',
      startMs: week.startMs,
      endMs: week.endMs,
    },
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : new Date(generatedAt).toISOString(),
    scans: {
      total: included.length,
      completed: included.filter((report) => report.complete === true).length,
      incomplete: incompleteRuns.length,
      completionNotRecorded: included.filter((report) => report.complete !== true && report.complete !== false).length,
      incompleteRuns,
    },
    software: {
      newlyIdentified: opportunities.length,
      previouslySaved: previouslySaved.length,
      unknownRecord: unknownSoftware.length,
      rowsWithoutReference: softwareRowsWithoutReference,
    },
    classificationEvents: {
      review: sumRecorded(included, 'review'),
      notRelevant: sumRecorded(included, 'notRelevant'),
      uniqueNoticeDiscovery: null,
    },
    workStatus: {
      basis: 'current',
      ...workStatus,
    },
    opportunities,
    previouslySaved,
    unknownSoftware,
    errors,
  };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

export async function readWeeklyReport({
  from,
  now = new Date(),
  reportsDir = SCAN_REPORTS_DIR,
  outputDir = path.join(projectRoot, 'data', 'output'),
} = {}) {
  const resolved = resolveManilaWeek(from, now);
  if (resolved.error) return { error: resolved.error };

  const index = await listScanReports(reportsDir);
  const reports = [];
  for (const item of index) {
    const started = finiteCount(item.startedAt);
    if (started == null || started < resolved.week.startMs || started > resolved.week.endMs) continue;
    const report = await readScanReport(item.id, reportsDir);
    if (report) reports.push(report);
  }

  const identities = new Set();
  for (const report of reports) {
    for (const row of report.softwareOpportunities || []) {
      const identity = noticeReportIdentity(row);
      if (identity && /^\d+$/.test(identity)) identities.add(identity);
    }
  }

  const packets = new Map();
  const requirements = new Map();
  for (const identity of identities) {
    packets.set(identity, await readJsonIfPresent(path.join(outputDir, `${identity}.json`)));
    requirements.set(identity, await readJsonIfPresent(path.join(outputDir, `${identity}.requirements.json`)));
  }

  return {
    report: buildWeeklyReport({
      week: resolved.week,
      reports,
      packets,
      requirements,
      generatedAt: now,
    }),
  };
}
