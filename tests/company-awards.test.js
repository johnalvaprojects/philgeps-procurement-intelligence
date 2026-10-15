import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import express from 'express';
import noticeRoutes from '../src/server/routes/notice-routes.js';
import companyAwardRoutes from '../src/server/routes/company-award-routes.js';
import { rejectDataPaths } from '../src/server/reject-data.js';
import { loginStaff, provisionStaff, staffHeaders, useAuthRoutes } from './http-auth.js';

function packet(reference, title) {
  return {
    notice: {
      referenceNumber: reference,
      title,
      organization: 'Example hospital',
      postedDate: '09-Oct-2026 12:00 AM',
      deadline: '12-Oct-2026 10:00 AM',
      abc: '760,000.00',
      procurementMode: 'Small Value Procurement',
      url: `https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/${reference}`,
    },
    classification: 'software',
    classificationSource: 'manual',
    reviewed: true,
    workStatus: 'new',
    review: { status: 'reviewed', source: 'manual' },
  };
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function createApp({ guestFullAccess = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-awards-'));
  const outputDir = path.join(directory, 'output');
  const awardsDir = path.join(directory, 'company-awards');
  const readsDir = path.join(directory, 'notice-reads');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, '50850.json'), `${JSON.stringify(packet('50850', 'Blood bank equipment'), null, 2)}\n`);
  await writeFile(path.join(outputDir, '50851.json'), `${JSON.stringify(packet('50851', 'Laboratory freezer'), null, 2)}\n`);
  await mkdir(path.join(directory, 'documents', '50850'), { recursive: true });
  await writeFile(path.join(directory, 'documents', '50850', 'quote.pdf'), 'pdf-bytes');

  const app = express();
  app.use(rejectDataPaths);
  app.use(express.json());
  const account = await provisionStaff(app);
  app.set('outputDir', outputDir);
  app.set('documentsRoot', path.join(directory, 'documents'));
  app.set('companyAwardsDir', awardsDir);
  app.set('noticeReadsDir', readsDir);
  app.set('guestFullAccess', guestFullAccess);
  useAuthRoutes(app);
  app.use('/api/notices', noticeRoutes);
  app.use('/api/company-awards', companyAwardRoutes);
  const server = await listen(app);
  return { directory, outputDir, awardsDir, server, account };
}

async function closeApp(context) {
  await new Promise((resolve) => context.server.close(resolve));
  await rm(context.directory, { recursive: true, force: true });
  await rm(context.account.authDir, { recursive: true, force: true });
}

async function signInGuest(base) {
  const guestResponse = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
  const guest = await guestResponse.json();
  return {
    guest,
    headers: {
      cookie: (guestResponse.headers.get('set-cookie') || '').split(';')[0],
      'x-csrf-token': guest.csrfToken,
    },
  };
}

function fileHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('company awards', { concurrency: false }, () => {
test('staff can mark, edit, and remove an award without changing the notice', async () => {
  const context = await createApp();
  const port = context.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const noticePath = path.join(context.outputDir, '50850.json');
  const before = await readFile(noticePath);
  try {
    const staff = await loginStaff(port, context.account);
    const created = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: staffHeaders(staff, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ awardNoticeNumber: '22316' }),
    });
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    assert.equal(createdBody.referenceNumber, '50850');
    assert.equal(createdBody.noticeId, '50850');
    assert.equal(createdBody.awardNoticeNumber, '22316');
    assert.equal(createdBody.acceptanceStatus, 'unknown');
    assert.equal(createdBody.acceptanceLabel, 'Unknown');
    assert.equal(createdBody.awardUrl, 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/22316');
    assert.equal(createdBody.philgepsConfirmed, false);
    assert.equal(createdBody.title, 'Blood bank equipment');
    assert.equal(createdBody.organization, 'Example hospital');

    const notices = await fetch(`${base}/api/notices`, { headers: { cookie: staff.cookie } });
    const noticeList = await notices.json();
    const saved = noticeList.find((item) => item.storageId === '50850' || item.referenceNumber === '50850');
    assert.equal(saved.classification, 'software');
    assert.equal(JSON.stringify(noticeList).includes('22316'), false);
    assert.equal(JSON.stringify(noticeList).includes('awardNoticeNumber'), false);
    assert.equal(createHash('sha256').update(await readFile(noticePath)).digest('hex'), createHash('sha256').update(before).digest('hex'));

    const updated = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: staffHeaders(staff, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ awardNoticeNumber: '22317', acceptanceStatus: 'accepted' }),
    });
    assert.equal(updated.status, 200);
    const updatedBody = await updated.json();
    assert.equal(updatedBody.awardNoticeNumber, '22317');
    assert.equal(updatedBody.acceptanceStatus, 'accepted');
    assert.equal(updatedBody.acceptanceLabel, 'Accepted');
    assert.equal(updatedBody.referenceNumber, '50850');

    const conflict = await fetch(`${base}/api/company-awards/50851`, {
      method: 'PUT',
      headers: staffHeaders(staff, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ awardNoticeNumber: '22317', acceptanceStatus: 'pending' }),
    });
    assert.equal(conflict.status, 409);

    const list = await fetch(`${base}/api/company-awards`, { headers: { cookie: staff.cookie } });
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.equal(listed.records.length, 1);
    assert.equal(listed.records[0].awardNoticeNumber, '22317');
    assert.match(listed.note, /not a confirmation from PhilGEPS/);

    const removed = await fetch(`${base}/api/company-awards/50850`, {
      method: 'DELETE',
      headers: staffHeaders(staff),
    });
    assert.equal(removed.status, 200);
    assert.equal(createHash('sha256').update(await readFile(noticePath)).digest('hex'), createHash('sha256').update(before).digest('hex'));
    const after = await fetch(`${base}/api/notices`, { headers: { cookie: staff.cookie } });
    const afterList = await after.json();
    assert.equal(afterList.some((item) => item.referenceNumber === '50850'), true);
    const empty = await fetch(`${base}/api/company-awards`, { headers: { cookie: staff.cookie } });
    assert.equal((await empty.json()).records.length, 0);
  } finally {
    await closeApp(context);
  }
});

test('an elevated development guest can mark, edit, and remove an award with staff', async () => {
  const context = await createApp({ guestFullAccess: true });
  const port = context.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const noticePath = path.join(context.outputDir, '50850.json');
  const before = await readFile(noticePath);
  try {
    const open = await fetch(`${base}/api/company-awards`);
    assert.equal(open.status, 401);

    const { guest, headers: guestHeaders } = await signInGuest(base);
    assert.equal(guest.role, 'guest');
    assert.equal(guest.fullAccess, true);

    const documents = await fetch(`${base}/api/notices/50850/documents`, { headers: guestHeaders });
    assert.equal(documents.status, 200);

    const missingToken = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: { cookie: guestHeaders.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardNoticeNumber: '22316', acceptanceStatus: 'pending' }),
    });
    assert.equal(missingToken.status, 403);

    const created = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: { ...guestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardNoticeNumber: '22316', acceptanceStatus: 'pending' }),
    });
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    assert.equal(createdBody.awardNoticeNumber, '22316');
    assert.equal(createdBody.acceptanceStatus, 'pending');
    assert.equal(createdBody.philgepsConfirmed, false);
    assert.equal(fileHash(await readFile(noticePath)), fileHash(before));

    const staff = await loginStaff(port, context.account);
    const shared = await fetch(`${base}/api/company-awards`, { headers: { cookie: staff.cookie } });
    assert.equal(shared.status, 200);
    const sharedBody = await shared.json();
    assert.equal(sharedBody.records.length, 1);
    assert.equal(sharedBody.records[0].awardNoticeNumber, '22316');
    assert.equal(sharedBody.records[0].referenceNumber, '50850');

    const notices = await fetch(`${base}/api/notices`, { headers: guestHeaders });
    const saved = (await notices.json()).find((item) => item.referenceNumber === '50850');
    assert.equal(saved.classification, 'software');
    assert.equal(saved.workStatus, 'new');
    assert.equal(JSON.stringify(saved).includes('22316'), false);

    const updated = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: { ...guestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardNoticeNumber: '22317', acceptanceStatus: 'accepted' }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).awardNoticeNumber, '22317');

    const removed = await fetch(`${base}/api/company-awards/50850`, {
      method: 'DELETE',
      headers: guestHeaders,
    });
    assert.equal(removed.status, 200);
    const empty = await fetch(`${base}/api/company-awards`, { headers: { cookie: staff.cookie } });
    assert.equal((await empty.json()).records.length, 0);
    assert.equal(fileHash(await readFile(noticePath)), fileHash(before));
  } finally {
    await closeApp(context);
  }
});

test('a restricted guest cannot view or change award markings', async () => {
  const context = await createApp({ guestFullAccess: false });
  const port = context.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const noticePath = path.join(context.outputDir, '50850.json');
  const before = fileHash(await readFile(noticePath));
  try {
    const { guest, headers: guestHeaders } = await signInGuest(base);
    assert.equal(guest.role, 'guest');
    assert.equal(guest.fullAccess, false);

    const documents = await fetch(`${base}/api/notices/50850/documents`, { headers: guestHeaders });
    assert.equal(documents.status, 403);
    const guestList = await fetch(`${base}/api/company-awards`, { headers: guestHeaders });
    assert.equal(guestList.status, 403);
    const guestWrite = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: { ...guestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardNoticeNumber: '22316', acceptanceStatus: 'pending' }),
    });
    assert.equal(guestWrite.status, 403);
    const guestDelete = await fetch(`${base}/api/company-awards/50850`, {
      method: 'DELETE',
      headers: guestHeaders,
    });
    assert.equal(guestDelete.status, 403);
    assert.equal(fileHash(await readFile(noticePath)), before);

    const staff = await loginStaff(port, context.account);
    const staffList = await fetch(`${base}/api/company-awards`, { headers: { cookie: staff.cookie } });
    assert.equal(staffList.status, 200);
  } finally {
    await closeApp(context);
  }
});

test('a production guest stays restricted even when full access is requested', async () => {
  const previousEnv = process.env.NODE_ENV;
  const previousFlag = process.env.GUEST_FULL_ACCESS;
  process.env.NODE_ENV = 'production';
  process.env.GUEST_FULL_ACCESS = 'true';
  const context = await createApp({ guestFullAccess: true });
  const port = context.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const { guest, headers: guestHeaders } = await signInGuest(base);
    assert.equal(guest.role, 'guest');
    assert.equal(guest.fullAccess, false);
    const guestList = await fetch(`${base}/api/company-awards`, { headers: guestHeaders });
    assert.equal(guestList.status, 403);
    const guestWrite = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: { ...guestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardNoticeNumber: '22316' }),
    });
    assert.equal(guestWrite.status, 403);

    const staff = await loginStaff(port, context.account);
    const staffList = await fetch(`${base}/api/company-awards`, { headers: { cookie: staff.cookie } });
    assert.equal(staffList.status, 200);
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (previousFlag === undefined) delete process.env.GUEST_FULL_ACCESS;
    else process.env.GUEST_FULL_ACCESS = previousFlag;
    await closeApp(context);
  }
});

test('award writes reject a missing token, an invalid marking, and a missing notice', async () => {
  const context = await createApp({ guestFullAccess: true });
  const port = context.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const staff = await loginStaff(port, context.account);
    const missingToken = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: { cookie: staff.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardNoticeNumber: '22316' }),
    });
    assert.equal(missingToken.status, 403);

    const invalid = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: staffHeaders(staff, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ awardNoticeNumber: '50850-award', acceptanceStatus: 'confirmed' }),
    });
    assert.equal(invalid.status, 400);

    const confirmed = await fetch(`${base}/api/company-awards/50850`, {
      method: 'PUT',
      headers: staffHeaders(staff, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ awardNoticeNumber: '22316', acceptanceStatus: 'confirmed' }),
    });
    assert.equal(confirmed.status, 400);

    const missingNotice = await fetch(`${base}/api/company-awards/99999`, {
      method: 'PUT',
      headers: staffHeaders(staff, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ awardNoticeNumber: '22316', acceptanceStatus: 'pending' }),
    });
    assert.equal(missingNotice.status, 404);
    assert.equal((await readFile(path.join(context.outputDir, '50850.json'), 'utf8')).includes('22316'), false);
  } finally {
    await closeApp(context);
  }
});
});
