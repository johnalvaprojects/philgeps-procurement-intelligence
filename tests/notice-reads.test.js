import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import noticeRoutes from '../src/server/routes/notice-routes.js';
import { rejectDataPaths } from '../src/server/reject-data.js';
import { loginStaff, provisionStaff, staffHeaders, useAuthRoutes } from './http-auth.js';

function packet(reference, { legacy = false, title = 'Blood bank equipment' } = {}) {
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
    source: legacy ? { id: 'legacy' } : { id: 'current' },
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

async function createApp({ guestFullAccess = true } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-reads-'));
  const outputDir = path.join(directory, 'output');
  const readsDir = path.join(directory, 'notice-reads');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, '97334.json'), `${JSON.stringify(packet('97334'), null, 2)}\n`);
  await writeFile(
    path.join(outputDir, 'legacy-13252540.json'),
    `${JSON.stringify(packet('13252540', { legacy: true, title: 'Old portal notice' }), null, 2)}\n`,
  );

  const app = express();
  app.use(rejectDataPaths);
  app.use(express.json());
  const account = await provisionStaff(app);
  app.set('outputDir', outputDir);
  app.set('noticeReadsDir', readsDir);
  app.set('guestFullAccess', guestFullAccess);
  useAuthRoutes(app);
  app.use('/api/notices', noticeRoutes);
  const server = await listen(app);
  return { directory, outputDir, server, account };
}

async function closeApp(context) {
  await new Promise((resolve) => context.server.close(resolve));
  await rm(context.directory, { recursive: true, force: true });
  await rm(context.account.authDir, { recursive: true, force: true });
}

function byReference(notices, reference) {
  return notices.find((notice) => notice.referenceNumber === reference);
}

test('existing notices stay read, new notices stay unread until opened, and rescans keep that state', async () => {
  const context = await createApp();
  const port = context.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const currentPath = path.join(context.outputDir, '97334.json');
  const before = await readFile(currentPath);
  try {
    const guestResponse = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
    const guest = await guestResponse.json();
    assert.equal(guest.role, 'guest');
    assert.equal(guest.fullAccess, true);
    const guestHeaders = {
      cookie: (guestResponse.headers.get('set-cookie') || '').split(';')[0],
      'x-csrf-token': guest.csrfToken,
      'Content-Type': 'application/json',
    };
    const staff = await loginStaff(port, context.account);

    const first = await fetch(`${base}/api/notices`, { headers: guestHeaders });
    assert.equal(first.status, 200);
    const existing = await first.json();
    assert.equal(byReference(existing, '97334').unread, false);
    assert.equal(byReference(existing, '13252540').unread, false);
    assert.equal(byReference(existing, '97334').workStatus, 'new');

    const discoveredPath = path.join(context.outputDir, '99901.json');
    await writeFile(discoveredPath, `${JSON.stringify(packet('99901', { title: 'Newly discovered' }), null, 2)}\n`);

    const listed = await fetch(`${base}/api/notices`, { headers: { cookie: staff.cookie } });
    const discovered = byReference(await listed.json(), '99901');
    assert.equal(discovered.unread, true);
    assert.equal(discovered.classification, 'software');
    assert.equal(discovered.workStatus, 'new');
    assert.equal(byReference(await (await fetch(`${base}/api/notices`, { headers: { cookie: staff.cookie } })).json(), '99901').unread, true);

    await writeFile(currentPath, `${JSON.stringify(packet('97334', { title: 'Rescanned title' }), null, 2)}\n`);
    await writeFile(discoveredPath, `${JSON.stringify(packet('99901', { title: 'Rescanned discovery' }), null, 2)}\n`);
    const afterRescan = await (await fetch(`${base}/api/notices`, { headers: { cookie: staff.cookie } })).json();
    assert.equal(byReference(afterRescan, '97334').unread, false);
    assert.equal(byReference(afterRescan, '97334').title, 'Rescanned title');
    assert.equal(byReference(afterRescan, '97334').workStatus, 'new');
    assert.equal(byReference(afterRescan, '99901').unread, true);

    const beforeOpen = await readFile(discoveredPath);
    const opened = await fetch(`${base}/api/notices/99901/read`, { method: 'POST', headers: guestHeaders });
    assert.equal(opened.status, 200);
    assert.equal((await opened.json()).unread, false);
    const saved = JSON.parse(await readFile(discoveredPath, 'utf8'));
    assert.equal(saved.classification, 'software');
    assert.equal(saved.workStatus, 'new');
    assert.equal(saved.notice.title, 'Rescanned discovery');
    assert.equal(
      createHash('sha256').update(await readFile(discoveredPath)).digest('hex'),
      createHash('sha256').update(beforeOpen).digest('hex'),
    );

    await writeFile(discoveredPath, `${JSON.stringify(packet('99901', { title: 'Rescanned after reading' }), null, 2)}\n`);
    const shared = await (await fetch(`${base}/api/notices`, { headers: { cookie: staff.cookie } })).json();
    assert.equal(byReference(shared, '99901').unread, false);
    assert.equal(byReference(shared, '99901').workStatus, 'new');
    assert.equal(byReference(shared, '13252540').unread, false);
    const currentSaved = JSON.parse(await readFile(currentPath, 'utf8'));
    assert.equal(currentSaved.workStatus, 'new');
    assert.equal(currentSaved.classification, 'software');
    assert.notEqual(createHash('sha256').update(before).digest('hex'), createHash('sha256').update(await readFile(currentPath)).digest('hex'));
  } finally {
    await closeApp(context);
  }
});

test('marking a notice read requires a signed-in user and does not rewrite the notice', async () => {
  const context = await createApp({ guestFullAccess: false });
  const port = context.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const noticePath = path.join(context.outputDir, '97334.json');
  const before = await readFile(noticePath);
  try {
    assert.equal((await fetch(`${base}/api/notices`)).status, 401);
    assert.equal((await fetch(`${base}/api/notices/97334/read`, { method: 'POST' })).status, 401);

    const guestResponse = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
    const guest = await guestResponse.json();
    assert.equal(guest.fullAccess, false);
    const cookie = (guestResponse.headers.get('set-cookie') || '').split(';')[0];
    const blocked = await fetch(`${base}/api/notices/97334/read`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
    });
    assert.equal(blocked.status, 403);

    const opened = await fetch(`${base}/api/notices/97334/read`, {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': guest.csrfToken },
    });
    assert.equal(opened.status, 200);
    assert.equal(createHash('sha256').update(await readFile(noticePath)).digest('hex'), createHash('sha256').update(before).digest('hex'));

    const missing = await fetch(`${base}/api/notices/99999/read`, {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': guest.csrfToken },
    });
    assert.equal(missing.status, 404);

    const staff = await loginStaff(port, context.account);
    const notices = await (await fetch(`${base}/api/notices`, { headers: staffHeaders(staff) })).json();
    assert.equal(byReference(notices, '97334').unread, false);
    assert.equal(byReference(notices, '97334').workStatus, 'new');
  } finally {
    await closeApp(context);
  }
});
