import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../project-root.js';
import { isSafeStorageId } from '../notice-source.js';

const locks = new Map();
const AWARD_NUMBER = /^\d{1,12}$/;

export const ACCEPTANCE_STATUSES = Object.freeze({
  pending: 'Pending for Acceptance',
  accepted: 'Accepted',
  unknown: 'Unknown',
});

export function companyAwardsDirectory(directory) {
  return directory || path.join(projectRoot, 'data', 'company-awards');
}

export function awardNoticeUrl(awardNoticeNumber) {
  return `https://philgeps.gov.ph/BidAwards/viewAwardNotice/${awardNoticeNumber}`;
}

export function normalizeAwardNoticeNumber(value) {
  const text = String(value ?? '').trim();
  return AWARD_NUMBER.test(text) ? text : null;
}

export function normalizeAcceptanceStatus(value) {
  if (value == null || String(value).trim() === '') return 'unknown';
  const text = String(value).trim().toLowerCase();
  if (text === 'pending' || text === 'pending for acceptance') return 'pending';
  if (text === 'accepted') return 'accepted';
  if (text === 'unknown') return 'unknown';
  return null;
}

function markingsPath(directory) {
  return path.join(companyAwardsDirectory(directory), 'markings.json');
}

function withLock(directory, fn) {
  const key = companyAwardsDirectory(directory);
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(key, run.then(() => {}, () => {}));
  return run;
}

async function readMarkings(directory) {
  try {
    const parsed = JSON.parse(await readFile(markingsPath(directory), 'utf8'));
    return Array.isArray(parsed.markings) ? parsed.markings : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeMarkings(directory, markings) {
  const file = markingsPath(directory);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ markings }, null, 2)}\n`);
  await rename(temporary, file);
}

export function toPublicMarking(record) {
  const acceptanceStatus = ACCEPTANCE_STATUSES[record.acceptanceStatus] ? record.acceptanceStatus : 'unknown';
  return {
    noticeId: record.noticeId,
    referenceNumber: record.referenceNumber || record.noticeId,
    title: record.title || '',
    organization: record.organization || '',
    awardNoticeNumber: record.awardNoticeNumber,
    acceptanceStatus,
    acceptanceLabel: ACCEPTANCE_STATUSES[acceptanceStatus],
    awardUrl: awardNoticeUrl(record.awardNoticeNumber),
    markedAt: record.markedAt,
    updatedAt: record.updatedAt,
    source: 'internal-marking',
    philgepsConfirmed: false,
  };
}

export function listMarkings(directory) {
  return withLock(directory, async () => {
    const markings = await readMarkings(directory);
    return markings
      .map(toPublicMarking)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  });
}

export function getMarking(directory, noticeId) {
  return withLock(directory, async () => {
    if (!isSafeStorageId(noticeId)) return null;
    const markings = await readMarkings(directory);
    const found = markings.find((item) => item.noticeId === noticeId);
    return found ? toPublicMarking(found) : null;
  });
}

export function saveMarking(directory, input) {
  return withLock(directory, async () => {
    const noticeId = String(input.noticeId || '').trim();
    if (!isSafeStorageId(noticeId)) {
      const error = new Error('Invalid notice id');
      error.status = 400;
      throw error;
    }
    const awardNoticeNumber = normalizeAwardNoticeNumber(input.awardNoticeNumber);
    if (!awardNoticeNumber) {
      const error = new Error('Enter the official award notice number.');
      error.status = 400;
      throw error;
    }
    const acceptanceStatus = normalizeAcceptanceStatus(input.acceptanceStatus);
    if (!acceptanceStatus) {
      const error = new Error('Acceptance status must be Pending for Acceptance, Accepted, or Unknown.');
      error.status = 400;
      throw error;
    }

    const markings = await readMarkings(directory);
    const duplicate = markings.find((item) => (
      item.awardNoticeNumber === awardNoticeNumber && item.noticeId !== noticeId
    ));
    if (duplicate) {
      const error = new Error('That award notice number is already linked to another notice.');
      error.status = 409;
      throw error;
    }

    const now = new Date().toISOString();
    const existing = markings.find((item) => item.noticeId === noticeId);
    const next = {
      noticeId,
      referenceNumber: String(input.referenceNumber || noticeId).trim(),
      title: String(input.title || '').trim(),
      organization: String(input.organization || '').trim(),
      awardNoticeNumber,
      acceptanceStatus,
      markedAt: existing?.markedAt || now,
      updatedAt: now,
    };
    const remaining = markings.filter((item) => item.noticeId !== noticeId);
    remaining.push(next);
    await writeMarkings(directory, remaining);
    return toPublicMarking(next);
  });
}

export function removeMarking(directory, noticeId) {
  return withLock(directory, async () => {
    if (!isSafeStorageId(noticeId)) {
      const error = new Error('Invalid notice id');
      error.status = 400;
      throw error;
    }
    const markings = await readMarkings(directory);
    const existing = markings.find((item) => item.noticeId === noticeId);
    if (!existing) {
      const error = new Error('This notice is not marked as awarded to us.');
      error.status = 404;
      throw error;
    }
    await writeMarkings(directory, markings.filter((item) => item.noticeId !== noticeId));
    return { removed: true, noticeId };
  });
}
