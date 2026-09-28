import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseNoticeId } from '../philgeps/notices.js';
import { log } from '../log.js';

export const WORK_STATUS_VALUES = ['new', 'in-progress', 'done'];

export function normalizeWorkStatus(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  const compact = normalized === 'inprogress' ? 'in-progress' : normalized;
  if (WORK_STATUS_VALUES.includes(compact)) return compact;
  const error = new Error('Work status must be new, in-progress, or done.');
  error.code = 'INVALID_WORK_STATUS';
  throw error;
}

export function storedWorkStatus(value) {
  if (value == null || String(value).trim() === '') return null;
  try {
    return normalizeWorkStatus(value);
  } catch {
    return null;
  }
}

export function workStatusForClassification(classification, existing) {
  const kept = storedWorkStatus(existing);
  if (classification === 'software') return kept || 'new';
  return kept;
}

export function attachWorkStatus(fields, saved) {
  const workStatus = workStatusForClassification(fields?.classification, saved?.workStatus);
  if (!workStatus) return fields;
  return { ...fields, workStatus };
}

export function publicWorkStatus(notice) {
  if (notice?.classification !== 'software') return storedWorkStatus(notice?.workStatus);
  return storedWorkStatus(notice?.workStatus) || 'new';
}

export async function saveWorkStatus(noticeId, workStatus, {
  outputDir = path.join('data', 'output'),
  documentsRoot = path.join('data', 'documents'),
} = {}) {
  const choice = normalizeWorkStatus(workStatus);
  const outputPath = path.join(outputDir, `${noticeId}.json`);
  const packet = JSON.parse(await readFile(outputPath, 'utf8'));
  if (!packet?.notice?.referenceNumber) {
    const error = new Error('This file is not a saved notice.');
    error.code = 'NOTICE_NOT_FOUND';
    throw error;
  }
  const updated = { ...packet, workStatus: choice };
  await writeFile(outputPath, `${JSON.stringify(updated, null, 2)}\n`);

  const metadataPath = path.join(documentsRoot, String(noticeId), 'metadata.json');
  if (existsSync(metadataPath)) {
    const current = JSON.parse(await readFile(metadataPath, 'utf8'));
    await writeFile(metadataPath, `${JSON.stringify({ ...current, workStatus: choice }, null, 2)}\n`);
  }
  return updated;
}

export async function setSavedWorkStatus(referenceInput, workStatusInput, options = {}) {
  let noticeId;
  try {
    noticeId = parseNoticeId(referenceInput);
  } catch (error) {
    error.code = 'INVALID_NOTICE_ID';
    throw error;
  }

  let workStatus;
  try {
    workStatus = normalizeWorkStatus(workStatusInput);
  } catch (error) {
    error.code = 'INVALID_WORK_STATUS';
    throw error;
  }

  const outputDir = options.outputDir || path.join('data', 'output');
  const outputPath = path.join(outputDir, `${noticeId}.json`);
  if (!existsSync(outputPath)) {
    const error = new Error(`No saved notice ${noticeId}.`);
    error.code = 'NOTICE_NOT_FOUND';
    throw error;
  }

  const updated = await saveWorkStatus(noticeId, workStatus, options);
  log('INFO', `Saved work status for notice ${noticeId}: ${workStatus}`);
  return updated;
}
