import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import noticeRoutes from '../src/server/routes/notice-routes.js';
import { rejectDataPaths } from '../src/server/reject-data.js';
import { projectRoot } from '../src/project-root.js';
import { isUnread, loadNoticeReads, repairNoticeReadBaseline } from '../src/notice-reads/store.js';
import { loginStaff, provisionStaff, staffHeaders, useAuthRoutes } from './http-auth.js';

const execFileAsync = promisify(execFile);

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

test('a missing read directory or another notice directory cannot touch the project baseline', async () => {
  const live = path.join(projectRoot, 'data', 'notice-reads', 'reads.json');
  const before = createHash('sha256').update(await readFile(live)).digest('hex');
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-reads-guard-'));
  const outputDir = path.join(directory, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, '50850.json'), '{}\n');
  try {
    await assert.rejects(() => loadNoticeReads(undefined, outputDir, ['50850']));
    await assert.rejects(() => loadNoticeReads(path.join(projectRoot, 'data', 'notice-reads'), outputDir, ['50850']));
    assert.equal(createHash('sha256').update(await readFile(live)).digest('hex'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a partial id list cannot record a notice-read baseline', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-reads-partial-'));
  const outputDir = path.join(directory, 'output');
  const readsDir = path.join(directory, 'notice-reads');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, '11111.json'), '{}\n');
  await writeFile(path.join(outputDir, '22222.json'), '{}\n');
  try {
    await assert.rejects(() => loadNoticeReads(readsDir, outputDir, ['11111']));
    await assert.rejects(() => readFile(path.join(readsDir, 'reads.json')));
    const state = await loadNoticeReads(readsDir, outputDir);
    assert.equal(state.baselineRecorded, true);
    assert.equal(typeof state.read['11111'], 'string');
    assert.equal(typeof state.read['22222'], 'string');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function backdateNotice(file) {
  const when = '2026-10-12T12:36:32Z';
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `$item = Get-Item -LiteralPath '${file.replaceAll("'", "''")}'; $item.CreationTime = [datetime]::Parse('${when}'); $item.LastWriteTime = [datetime]::Parse('${when}')`,
  ]);
}

test('repair keeps a genuine read, restores only notices created before the cutoff, and drops unknown ids', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-reads-repair-'));
  const outputDir = path.join(directory, 'output');
  const readsDir = path.join(directory, 'notice-reads');
  await mkdir(outputDir, { recursive: true });
  const existingPath = path.join(outputDir, '97334.json');
  const untouchedPath = path.join(outputDir, '11111.json');
  const discoveredPath = path.join(outputDir, '99901.json');
  const body = '{"classification":"software","workStatus":"new"}\n';
  await writeFile(existingPath, body);
  await writeFile(untouchedPath, body);
  await backdateNotice(existingPath);
  await backdateNotice(untouchedPath);
  await writeFile(discoveredPath, body);
  const beforeExisting = await readFile(existingPath);
  const beforeDiscovered = await readFile(discoveredPath);
  await mkdir(readsDir, { recursive: true });
  await writeFile(path.join(readsDir, 'reads.json'), `${JSON.stringify({
    baselineRecorded: true,
    read: {
      50850: '2026-10-15T10:28:44.620Z',
      50851: '2026-10-15T10:28:44.620Z',
      97334: '2026-10-15T11:11:19.837Z',
    },
  }, null, 2)}\n`);
  try {
    const cutoff = '2026-10-15T10:28:44.620Z';
    const repaired = await repairNoticeReadBaseline(readsDir, outputDir, { cutoff });
    assert.equal(repaired.baselineRecorded, true);
    assert.equal(repaired.read['97334'], '2026-10-15T11:11:19.837Z');
    assert.equal(repaired.read['11111'], cutoff);
    assert.equal(Object.hasOwn(repaired.read, '99901'), false);
    assert.equal(Object.hasOwn(repaired.read, '50850'), false);
    assert.equal(Object.hasOwn(repaired.read, '50851'), false);
    assert.equal(isUnread(repaired, '99901'), true);
    assert.equal(isUnread(repaired, '97334'), false);
    assert.equal(isUnread(repaired, '11111'), false);

    const again = await loadNoticeReads(readsDir, outputDir);
    assert.equal(Object.hasOwn(again.read, '99901'), false);
    assert.equal(createHash('sha256').update(await readFile(existingPath)).digest('hex'), createHash('sha256').update(beforeExisting).digest('hex'));
    assert.equal(createHash('sha256').update(await readFile(discoveredPath)).digest('hex'), createHash('sha256').update(beforeDiscovered).digest('hex'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
