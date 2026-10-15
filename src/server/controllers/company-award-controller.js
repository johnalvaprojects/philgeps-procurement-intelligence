import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../project-root.js';
import { isSafeStorageId } from '../../notice-source.js';
import {
  getMarking,
  listMarkings,
  removeMarking,
  saveMarking,
} from '../../company-awards/store.js';

const OUTPUT_DIR = path.join(projectRoot, 'data', 'output');

const NOTE = 'Internal markings. These records are not a confirmation from PhilGEPS.';

function outputDirectory(req) {
  return req.app.get('outputDir') || OUTPUT_DIR;
}

function awardsDirectory(req) {
  return req.app.get('companyAwardsDir');
}

function sendStoreError(res, error) {
  if (!error?.status) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function readSavedNotice(req, noticeId) {
  const directory = path.resolve(outputDirectory(req));
  const filePath = path.resolve(directory, `${noticeId}.json`);
  const relative = path.relative(directory, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('Invalid notice id');
    error.status = 400;
    throw error;
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missing = new Error('Saved notice not found');
      missing.status = 404;
      throw missing;
    }
    throw error;
  }
}

function snapshot(packet, noticeId) {
  const notice = packet?.notice || {};
  return {
    referenceNumber: String(notice.referenceNumber || noticeId).trim(),
    title: String(notice.title || '').trim(),
    organization: String(notice.organization || '').trim(),
  };
}

export async function listCompanyAwards(req, res, next) {
  try {
    const records = await listMarkings(awardsDirectory(req));
    const directory = outputDirectory(req);
    const refreshed = [];
    for (const record of records) {
      if (!isSafeStorageId(record.noticeId)) {
        refreshed.push({ ...record, philgepsConfirmed: false });
        continue;
      }
      try {
        const packet = JSON.parse(await readFile(path.join(directory, `${record.noticeId}.json`), 'utf8'));
        const live = snapshot(packet, record.noticeId);
        refreshed.push({
          ...record,
          referenceNumber: live.referenceNumber || record.referenceNumber,
          title: live.title || record.title,
          organization: live.organization || record.organization,
          philgepsConfirmed: false,
        });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        refreshed.push({ ...record, noticeMissing: true, philgepsConfirmed: false });
      }
    }
    res.json({ records: refreshed, note: NOTE });
  } catch (error) {
    next(error);
  }
}

export async function getCompanyAward(req, res, next) {
  try {
    const noticeId = String(req.params.noticeId || '');
    if (!isSafeStorageId(noticeId)) {
      res.status(400).json({ error: 'Invalid notice id' });
      return;
    }
    const record = await getMarking(awardsDirectory(req), noticeId);
    if (!record) {
      res.status(404).json({ error: 'This notice is not marked as awarded to us.' });
      return;
    }
    res.json({ ...record, philgepsConfirmed: false });
  } catch (error) {
    next(error);
  }
}

export async function putCompanyAward(req, res, next) {
  try {
    const noticeId = String(req.params.noticeId || '');
    if (!isSafeStorageId(noticeId)) {
      res.status(400).json({ error: 'Invalid notice id' });
      return;
    }
    const packet = await readSavedNotice(req, noticeId);
    const fields = snapshot(packet, noticeId);
    const record = await saveMarking(awardsDirectory(req), {
      noticeId,
      ...fields,
      awardNoticeNumber: req.body?.awardNoticeNumber,
      acceptanceStatus: req.body?.acceptanceStatus,
    });
    res.json({ ...record, philgepsConfirmed: false });
  } catch (error) {
    if (sendStoreError(res, error)) return;
    next(error);
  }
}

export async function deleteCompanyAward(req, res, next) {
  try {
    const noticeId = String(req.params.noticeId || '');
    const result = await removeMarking(awardsDirectory(req), noticeId);
    res.json(result);
  } catch (error) {
    if (sendStoreError(res, error)) return;
    next(error);
  }
}
