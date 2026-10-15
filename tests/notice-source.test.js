import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { filterNotices } from '../frontend/src/notices.js';
import { buildCaseReport } from '../frontend/src/reports/case-report.js';
import {
  DOCUMENTS_LOGIN_REQUIRED,
  documentsRequireLogin,
  isSafeStorageId,
  portalFromPacket,
  storageIdFromFilename,
} from '../src/notice-source.js';
import noticeRoutes from '../src/server/routes/notice-routes.js';
import { loginStaff, provisionStaff, staffHeaders, useAuthRoutes } from './http-auth.js';

test('a saved notice without a source field is Current PhilGEPS', () => {
  const portal = portalFromPacket({ notice: { referenceNumber: '96036' } }, '96036');
  assert.equal(portal.id, 'current');
  assert.equal(portal.label, 'Current PhilGEPS');
  assert.equal(documentsRequireLogin({ notice: { referenceNumber: '96036' } }), false);
});

test('an explicit legacy source is Old PhilGEPS', () => {
  const portal = portalFromPacket({ source: { id: 'legacy' } }, '13267161');
  assert.equal(portal.id, 'legacy');
  assert.equal(portal.label, 'Old PhilGEPS');
});

test('storage ids accept numeric and legacy filenames and reject traversal', () => {
  assert.equal(storageIdFromFilename('96036.json'), '96036');
  assert.equal(storageIdFromFilename('legacy-13267161.json'), 'legacy-13267161');
  assert.equal(storageIdFromFilename('legacy-../96036.json'), null);
  assert.equal(storageIdFromFilename('../96036.json'), null);
  assert.equal(storageIdFromFilename('96036.requirements.json'), null);
  assert.equal(isSafeStorageId('legacy-13267161'), true);
  assert.equal(isSafeStorageId('legacy-../x'), false);
  assert.equal(isSafeStorageId('../96036'), false);
  assert.equal(isSafeStorageId('96036/../../.env'), false);
});

test('the login-required document status is used only with explicit evidence', () => {
  assert.equal(documentsRequireLogin({ documentAccess: 'login-required' }), true);
  assert.equal(documentsRequireLogin({ source: { id: 'legacy' }, documents: [] }), false);
  assert.equal(DOCUMENTS_LOGIN_REQUIRED, 'Documents unavailable — login required');
});

test('the portal filter keeps notices that have no source field', () => {
  const notices = [
    { referenceNumber: '1', title: 'Current', classification: 'software', source: 'current' },
    { referenceNumber: '2', title: 'Saved before source', classification: 'review' },
    { referenceNumber: '3', title: 'Old', classification: 'software', source: 'legacy', storageId: 'legacy-3' },
  ];
  const options = { query: '', classification: 'all', workStatus: 'all' };
  assert.deepEqual(filterNotices(notices, { ...options, portal: 'all' }).map((row) => row.referenceNumber), ['1', '2', '3']);
  assert.deepEqual(filterNotices(notices, { ...options, portal: 'current' }).map((row) => row.referenceNumber), ['1', '2']);
  assert.deepEqual(filterNotices(notices, { ...options, portal: 'legacy' }).map((row) => row.referenceNumber), ['3']);
});

test('a case report labels a notice without a source field as Current PhilGEPS', () => {
  const report = buildCaseReport({
    notice: {
      referenceNumber: '92301',
      title: 'Example',
      url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/92301',
    },
  });
  assert.equal(report.portalLabel, 'Current PhilGEPS');
  assert.equal(report.sourceLabel, 'philgeps.gov.ph');
});

test('list and detail read both filename shapes without rewriting files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-source-'));
  const currentPath = path.join(directory, '96036.json');
  const legacyPath = path.join(directory, 'legacy-13267161.json');
  const currentBody = {
    notice: { referenceNumber: '96036', title: 'Current notice', organization: 'Agency' },
    classification: 'review',
  };
  const legacyBody = {
    notice: { referenceNumber: '13267161', title: 'Old notice', organization: 'Province' },
    source: { id: 'legacy', label: 'Old PhilGEPS' },
    documentAccess: 'login-required',
    classification: 'software',
  };
  await writeFile(currentPath, `${JSON.stringify(currentBody, null, 2)}\n`);
  await writeFile(legacyPath, `${JSON.stringify(legacyBody, null, 2)}\n`);
  const beforeCurrent = await readFile(currentPath, 'utf8');
  const beforeLegacy = await readFile(legacyPath, 'utf8');

  const app = express();
  app.use(express.json());
  const account = await provisionStaff(app);
  app.set('outputDir', directory);
  app.set('documentsRoot', path.join(directory, 'documents'));
  app.set('noticeReadsDir', path.join(directory, 'notice-reads'));
  useAuthRoutes(app);
  app.use('/api/notices', noticeRoutes);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const auth = await loginStaff(server.address().port, account);
    const base = `http://127.0.0.1:${server.address().port}`;
    const list = await fetch(`${base}/api/notices`, { headers: staffHeaders(auth) });
    assert.equal(list.status, 200);
    const notices = await list.json();
    const current = notices.find((row) => row.storageId === '96036');
    const legacy = notices.find((row) => row.storageId === 'legacy-13267161');
    assert.equal(current.sourceLabel, 'Current PhilGEPS');
    assert.equal(current.documentsLoginRequired, false);
    assert.equal(legacy.sourceLabel, 'Old PhilGEPS');
    assert.equal(legacy.referenceNumber, '13267161');
    assert.equal(legacy.documentsLoginRequired, true);
    assert.equal(current.storageId === legacy.storageId, false);

    const detail = await fetch(`${base}/api/notices/legacy-13267161`, { headers: staffHeaders(auth) });
    assert.equal(detail.status, 200);
    const packet = await detail.json();
    assert.equal(packet.portal.label, 'Old PhilGEPS');
    assert.equal(packet.documentsLoginRequired, true);
    assert.equal(packet.notice.title, 'Old notice');

    const escaped = await fetch(`${base}/api/notices/${encodeURIComponent('legacy-../96036')}`, {
      headers: staffHeaders(auth),
    });
    assert.equal(escaped.status, 400);

    assert.equal(await readFile(currentPath, 'utf8'), beforeCurrent);
    assert.equal(await readFile(legacyPath, 'utf8'), beforeLegacy);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
