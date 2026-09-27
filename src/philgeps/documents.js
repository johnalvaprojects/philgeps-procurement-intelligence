import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { baseUrl } from './client.js';
import { log } from '../log.js';

const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeAttachmentName(originalName) {
  const raw = String(originalName || '').replaceAll('\\', '/');
  const base = raw.split('/').pop() || '';
  let cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/[. ]+$/g, '').trim();
  const extension = path.extname(cleaned);
  const stem = extension ? cleaned.slice(0, -extension.length) : cleaned;
  if (!stem || stem === '.' || stem === '..') return extension ? `attachment${extension}` : 'attachment';
  if (RESERVED_WINDOWS_NAME.test(stem)) cleaned = `_${cleaned}`;
  return cleaned;
}

export function attachmentFileName(originalName, usedNames = new Set()) {
  const safe = sanitizeAttachmentName(originalName);
  const extension = path.extname(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  let candidate = safe;
  let index = 1;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem}_${index}${extension}`;
    index += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function basenameOnly(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/');
  const base = raw.split('/').pop() || '';
  return base.replace(/^"+|"+$/g, '').trim();
}

export function looksLikeFilename(value) {
  const base = basenameOnly(value);
  if (!base || base === '.' || base === '..') return false;
  if (base.includes('..')) return false;
  const extension = path.posix.extname(base);
  if (!/^\.[A-Za-z0-9]{1,8}$/.test(extension)) return false;
  const stem = base.slice(0, -extension.length);
  if (!stem || /^(download|attachment|file|document)$/i.test(stem)) return false;
  return true;
}

export function filenameFromContentDisposition(header) {
  const source = String(header || '');
  const extended = source.match(/filename\*\s*=\s*([^;]+)/i);
  if (extended) {
    let value = extended[1].trim().replace(/^"(.*)"$/, '$1');
    const encoded = value.match(/^[^']*'[^']*'(.*)$/);
    if (encoded) {
      try {
        value = decodeURIComponent(encoded[1]);
      } catch {
        value = encoded[1];
      }
    }
    return basenameOnly(value);
  }

  const plain = source.match(/filename\s*=\s*("?)([^";]+)\1/i);
  return plain ? basenameOnly(plain[2]) : '';
}

export function filenameFromUrl(url) {
  try {
    return decodeURIComponent(path.posix.basename(new URL(url, baseUrl()).pathname));
  } catch {
    return '';
  }
}

export function chooseOriginalFilename({ linkText = '', contentDisposition = '', url = '' } = {}) {
  const candidates = [
    basenameOnly(linkText),
    filenameFromContentDisposition(contentDisposition),
    filenameFromUrl(url),
  ];
  return candidates.find((candidate) => looksLikeFilename(candidate)) || '';
}

export function fallbackAttachmentName(noticeId, index, extension = '.pdf') {
  const ext = /^\.[A-Za-z0-9]{1,8}$/.test(extension) ? extension : '.pdf';
  return `${noticeId}_${String(index + 1).padStart(2, '0')}${ext}`;
}

export function parseDocumentLinks(html) {
  const $ = cheerio.load(html);
  const documents = [];

  $('a[href*="/portal_documents/"]').each((_, element) => {
    const href = $(element).attr('href');
    const url = new URL(href, baseUrl()).href;
    const linkText = $(element).text().replace(/\s+/g, ' ').trim();
    const urlName = filenameFromUrl(url);
    const filename = chooseOriginalFilename({ linkText, url }) || urlName;
    documents.push({
      filename,
      linkText,
      urlName,
      url,
      localPath: null,
    });
  });

  return documents;
}

export async function saveDocument(noticeId, originalName, bytes, usedNames = new Set(), documentsRoot = path.join('data', 'documents')) {
  const savedName = attachmentFileName(originalName, usedNames);
  const directory = path.join(documentsRoot, String(noticeId));
  await mkdir(directory, { recursive: true });

  const localPath = path.join(directory, savedName);
  const relativePath = localPath.split(path.sep).join('/');
  if (existsSync(localPath)) {
    log('INFO', `Left existing file ${relativePath} in place`);
    return { localPath: relativePath, savedName, alreadySaved: true };
  }

  await writeFile(localPath, bytes);
  return { localPath: relativePath, savedName, alreadySaved: false };
}

export async function removeNoticeDownloads(noticeId, documentsRoot = path.join('data', 'documents')) {
  const directory = path.join(documentsRoot, String(noticeId));
  if (!existsSync(directory)) return false;
  await rm(directory, { recursive: true, force: true });
  return true;
}

export async function saveTemporaryInspection(originalName, bytes) {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-inspect-'));
  const extension = path.extname(String(originalName || ''));
  const safeExtension = /^\.[A-Za-z0-9]{1,8}$/.test(extension) ? extension.toLowerCase() : '.pdf';
  const filePath = path.join(directory, `inspect${safeExtension}`);
  try {
    await writeFile(filePath, bytes);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, filePath };
}

export async function removeTemporaryInspection(directory) {
  if (!directory) return;
  await rm(directory, { recursive: true, force: true });
}
