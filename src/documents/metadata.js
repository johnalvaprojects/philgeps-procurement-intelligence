import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePhilgepsDate } from '../philgeps/search.js';

export function formatIsoDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function publishDateValue(value) {
  const parsed = parsePhilgepsDate(value);
  if (!parsed) return value ? String(value) : null;
  return formatIsoDay(parsed);
}

export function savedNoticeFiles(documents) {
  const names = [];
  for (const document of documents || []) {
    const stored = String(document?.localPath || '').split('\\').join('/');
    if (!stored.includes('/documents/')) continue;
    if (stored.includes('/philgeps-inspect-')) continue;
    if (!document.filename || document.filename === 'metadata.json') continue;
    if (!names.includes(document.filename)) names.push(document.filename);
  }
  return names;
}

export function buildNoticeMetadata({
  noticeId,
  title,
  publishDate,
  classification,
  files,
  downloadedAt = new Date(),
  classificationSource,
  reviewed,
  reviewedAt,
}) {
  const savedFiles = [...new Set((files || []).filter((name) => name && name !== 'metadata.json'))];
  const metadata = {
    noticeId: String(noticeId),
    title: title || '',
    publishDate: publishDateValue(publishDate),
    classification: classification || null,
    attachmentCount: savedFiles.length,
    files: savedFiles,
    downloadedAt: downloadedAt instanceof Date ? downloadedAt.toISOString() : String(downloadedAt),
  };
  if (classificationSource) metadata.classificationSource = classificationSource;
  if (reviewed != null) metadata.reviewed = reviewed === true;
  if (reviewedAt) metadata.reviewedAt = reviewedAt;
  return metadata;
}

export async function writeNoticeMetadata(metadata, documentsRoot = path.join('data', 'documents')) {
  const directory = path.join(documentsRoot, String(metadata.noticeId));
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, 'metadata.json');
  let current = {};
  if (existsSync(filePath)) {
    try {
      current = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      current = {};
    }
  }

  const next = {
    ...current,
    ...metadata,
    noticeId: String(metadata.noticeId),
    files: metadata.files,
    attachmentCount: metadata.files.length,
  };
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function updateMetadataClassification(noticeId, fields, documentsRoot = path.join('data', 'documents'), options = {}) {
  const filePath = path.join(documentsRoot, String(noticeId), 'metadata.json');
  if (!existsSync(filePath)) return null;
  const current = JSON.parse(await readFile(filePath, 'utf8'));
  const next = {
    ...current,
    classification: fields.classification,
    classificationSource: fields.classificationSource || 'automatic',
  };
  if (options.files) {
    next.files = options.files;
    next.attachmentCount = options.files.length;
  }
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function updateMetadataDecision(noticeId, fields, documentsRoot = path.join('data', 'documents')) {
  const filePath = path.join(documentsRoot, String(noticeId), 'metadata.json');
  if (!existsSync(filePath)) return null;
  const current = JSON.parse(await readFile(filePath, 'utf8'));
  const next = {
    ...current,
    classification: fields.classification,
    classificationSource: 'manual',
    reviewed: true,
    reviewedAt: fields.reviewedAt,
  };
  if (fields.workStatus) next.workStatus = fields.workStatus;
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
