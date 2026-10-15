import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { addStaffAccount, createFirstStaff, sessionFileContains } from '../src/auth/store.js';
import noticeRoutes from '../src/server/routes/notice-routes.js';
import scanRoutes from '../src/server/routes/scan-routes.js';
import { rejectDataPaths } from '../src/server/reject-data.js';
import { loginStaff, provisionStaff, staffHeaders, useAuthRoutes } from './http-auth.js';
import { guestFullAccessEnabled, requestHasGuestFullAccess } from '../src/auth/access.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function packet() {
  return {
    notice: {
      referenceNumber: '96036',
      title: 'Blood bank equipment',
      organization: 'Example hospital',
      postedDate: '09-Oct-2026 12:00 AM',
      deadline: '12-Oct-2026 10:00 AM',
      abc: '760,000.00',
      procurementMode: 'Small Value Procurement',
      url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/96036',
    },
    classification: 'not relevant',
    classificationSource: 'manual',
    reviewed: true,
    workStatus: 'new',
    review: { status: 'reviewed', source: 'manual' },
    procurementDocument: { awarding: 'internal schedule line' },
    extractedRequirements: { items: [{ name: 'secret spec' }] },
  };
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function appWithNotice({ guestFullAccess = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-auth-api-'));
  const outputDir = path.join(directory, 'output');
  const documentsRoot = path.join(directory, 'documents', '96036');
  await mkdir(outputDir, { recursive: true });
  await mkdir(documentsRoot, { recursive: true });
  await writeFile(path.join(outputDir, '96036.json'), `${JSON.stringify(packet(), null, 2)}\n`);
  await writeFile(path.join(documentsRoot, 'quote.pdf'), 'pdf-bytes');

  const app = express();
  app.use(rejectDataPaths);
  app.use(express.json());
  const account = await provisionStaff(app);
  app.set('outputDir', outputDir);
  app.set('documentsRoot', path.join(directory, 'documents'));
  app.set('loginMaxAttempts', 2);
  app.set('loginWindowMs', 60_000);
  app.set('scanReportsDir', path.join(directory, 'reports'));
  app.set('guestFullAccess', guestFullAccess);
  useAuthRoutes(app);
  app.use('/api/notices', noticeRoutes);
  app.use('/api/scan', scanRoutes);
  const server = await listen(app);
  return { directory, server, account, authDir: account.authDir, app };
}

test('the first staff command refuses a second account and keeps the password out of the file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-staff-'));
  const password = `Phrase-${randomBytes(8).toString('hex')}`;
  const created = await createFirstStaff({ directory, username: 'Ada', password });
  assert.equal(created.username, 'ada');
  await assert.rejects(
    () => createFirstStaff({ directory, username: 'Bea', password: `${password}x` }),
    /already exists/,
  );
  const stored = await readFile(path.join(directory, 'users.json'), 'utf8');
  assert.equal(stored.includes(password), false);
  assert.match(stored, /passwordHash/);
  const added = await addStaffAccount({
    directory,
    username: 'bea',
    password: `${password}-more`,
  });
  assert.equal(added.username, 'bea');
  await rm(directory, { recursive: true, force: true });
});

test('--create-staff rejects credentials passed as arguments', async () => {
  const child = spawn(process.execPath, ['src/index.js', '--create-staff', 'not-a-password'], {
    cwd: root,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 1);
  assert.match(output, /Do not pass the username or password/);
});

test('guest and staff authorization, sessions, and CSRF', async () => {
  const { directory, server, account, authDir } = await appWithNotice();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const open = await fetch(`${base}/api/notices`);
    assert.equal(open.status, 401);

    const guestResponse = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
    assert.equal(guestResponse.status, 200);
    const guestCookie = guestResponse.headers.get('set-cookie') || '';
    assert.match(guestCookie, /HttpOnly/i);
    assert.match(guestCookie, /SameSite=Lax/i);
    assert.doesNotMatch(guestCookie, /Secure/i);
    const guest = await guestResponse.json();
    assert.equal(guest.role, 'guest');
    assert.equal(guest.fullAccess, false);
    const guestHeaders = { cookie: guestCookie.split(';')[0], 'x-csrf-token': guest.csrfToken };

    const list = await fetch(`${base}/api/notices`, { headers: guestHeaders });
    assert.equal(list.status, 200);
    const notices = await list.json();
    assert.equal(notices[0].referenceNumber, '96036');
    assert.equal(notices[0].procurementMode, 'Small Value Procurement');
    assert.equal(Object.hasOwn(notices[0], 'classification'), false);
    assert.equal(Object.hasOwn(notices[0], 'workStatus'), false);

    const detail = await fetch(`${base}/api/notices/96036`, { headers: guestHeaders });
    const detailBody = await detail.json();
    assert.equal(detailBody.notice.title, 'Blood bank equipment');
    assert.equal(detailBody.classification, undefined);
    assert.equal(detailBody.extractedRequirements, undefined);
    assert.equal(detailBody.procurementDocument, undefined);

    assert.equal((await fetch(`${base}/api/scan`, { method: 'POST', headers: guestHeaders })).status, 403);
    assert.equal((await fetch(`${base}/api/scan/reports`, { headers: guestHeaders })).status, 403);
    assert.equal((await fetch(`${base}/api/notices/96036/documents`, { headers: guestHeaders })).status, 403);
    assert.equal((await fetch(`${base}/api/notices/96036/documents/quote.pdf`, { headers: guestHeaders })).status, 403);
    const guestPatch = await fetch(`${base}/api/notices/96036/classification`, {
      method: 'PATCH',
      headers: { ...guestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 'software' }),
    });
    assert.equal(guestPatch.status, 403);

    const staff = await loginStaff(port, account);
    assert.equal(await sessionFileContains(authDir, staff.cookie.split('=')[1]), false);
    const blocked = await fetch(`${base}/api/notices/96036/work-status`, {
      method: 'PATCH',
      headers: { cookie: staff.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workStatus: 'done' }),
    });
    assert.equal(blocked.status, 403);

    const changed = await fetch(`${base}/api/notices/96036/work-status`, {
      method: 'PATCH',
      headers: staffHeaders(staff, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ workStatus: 'done' }),
    });
    assert.equal(changed.status, 200);
    const file = await fetch(`${base}/api/notices/96036/documents/quote.pdf`, {
      headers: { cookie: staff.cookie },
    });
    assert.equal(file.status, 200);
    assert.equal(await file.text(), 'pdf-bytes');

    const hidden = await fetch(`${base}/data/auth/users.json`);
    assert.equal(hidden.status, 404);

    const wrong = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account.username, password: 'not-the-password' }),
    });
    assert.equal(wrong.status, 401);
    await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account.username, password: 'still-wrong-pass' }),
    });
    const limited = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account.username, password: 'still-wrong-pass' }),
    });
    assert.equal(limited.status, 429);

    const loggedOut = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: staffHeaders(staff),
    });
    assert.equal(loggedOut.status, 204);
    const after = await fetch(`${base}/api/notices`, { headers: { cookie: staff.cookie } });
    assert.equal(after.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('elevated guest access requires an explicit flag and a permitted non-production environment', () => {
  const cases = [
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'development', GUEST_FULL_ACCESS: 'false' }, false],
    [{ NODE_ENV: 'development', GUEST_FULL_ACCESS: 'true' }, true],
    [{ NODE_ENV: 'demo', GUEST_FULL_ACCESS: 'true' }, true],
    [{ GUEST_FULL_ACCESS: 'true' }, false],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production', GUEST_FULL_ACCESS: 'false' }, false],
    [{ NODE_ENV: 'production', GUEST_FULL_ACCESS: 'true' }, false],
    [{ NODE_ENV: 'test', GUEST_FULL_ACCESS: 'true' }, false],
    [{ NODE_ENV: 'staging', GUEST_FULL_ACCESS: 'true' }, false],
    [{ NODE_ENV: 'development', GUEST_FULL_ACCESS: 'TRUE' }, false],
    [{ NODE_ENV: 'development', GUEST_FULL_ACCESS: '1' }, false],
  ];
  for (const [env, expected] of cases) {
    assert.equal(guestFullAccessEnabled(env), expected, JSON.stringify(env));
  }

  const forced = { app: { get: () => true } };
  assert.equal(requestHasGuestFullAccess(forced, { NODE_ENV: 'production', GUEST_FULL_ACCESS: 'true' }), false);
  assert.equal(requestHasGuestFullAccess(forced, { NODE_ENV: 'development' }), true);
  assert.equal(requestHasGuestFullAccess({ app: { get: () => undefined } }, { NODE_ENV: 'development', GUEST_FULL_ACCESS: 'true' }), true);
  assert.equal(requestHasGuestFullAccess({ app: { get: () => undefined } }, { GUEST_FULL_ACCESS: 'true' }), false);
});

test('a local guest can use the same notice, document, classification, work status, and scan routes', async () => {
  const { directory, server, app } = await appWithNotice({ guestFullAccess: true });
  app.set('runScan', async () => ({ rows: [] }));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const guestResponse = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
    const guest = await guestResponse.json();
    assert.equal(guest.role, 'guest');
    assert.equal(guest.fullAccess, true);
    const guestHeaders = {
      cookie: (guestResponse.headers.get('set-cookie') || '').split(';')[0],
      'x-csrf-token': guest.csrfToken,
    };

    const guestList = await fetch(`${base}/api/notices`, { headers: guestHeaders });
    assert.equal(guestList.status, 200);
    const notices = await guestList.json();
    assert.equal(notices[0].referenceNumber, '96036');
    assert.equal(notices[0].classification, 'not relevant');
    assert.equal(notices[0].workStatus, 'new');

    const guestDetail = await fetch(`${base}/api/notices/96036`, { headers: guestHeaders });
    assert.equal(guestDetail.status, 200);
    const detail = await guestDetail.json();
    assert.equal(detail.classification, 'not relevant');
    assert.equal(detail.procurementDocument.awarding, 'internal schedule line');

    const documents = await fetch(`${base}/api/notices/96036/documents`, { headers: guestHeaders });
    assert.equal(documents.status, 200);
    const file = await fetch(`${base}/api/notices/96036/documents/quote.pdf`, { headers: guestHeaders });
    assert.equal(file.status, 200);
    assert.equal(await file.text(), 'pdf-bytes');

    const missingToken = await fetch(`${base}/api/notices/96036/classification`, {
      method: 'PATCH',
      headers: { cookie: guestHeaders.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 'software' }),
    });
    assert.equal(missingToken.status, 403);

    const classified = await fetch(`${base}/api/notices/96036/classification`, {
      method: 'PATCH',
      headers: { ...guestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 'review' }),
    });
    assert.equal(classified.status, 200);
    const status = await fetch(`${base}/api/notices/96036/work-status`, {
      method: 'PATCH',
      headers: { ...guestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workStatus: 'in-progress' }),
    });
    assert.equal(status.status, 200);
    const saved = JSON.parse(await readFile(path.join(directory, 'output', '96036.json'), 'utf8'));
    assert.equal(saved.classification, 'review');
    assert.equal(saved.workStatus, 'in-progress');

    assert.equal((await fetch(`${base}/api/scan/status`, { headers: guestHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/scan/reports`, { headers: guestHeaders })).status, 200);
    const started = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: guestHeaders,
    });
    assert.equal(started.status, 202);
    assert.equal((await fetch(`${base}/api/notices`)).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('an expired session is rejected', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-expire-'));
  const app = express();
  app.use(express.json());
  app.set('sessionTtlMs', 30);
  const account = await provisionStaff(app);
  app.set('outputDir', directory);
  useAuthRoutes(app);
  app.use('/api/notices', noticeRoutes);
  const server = await listen(app);
  try {
    const staff = await loginStaff(server.address().port, account);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notices`, {
      headers: { cookie: staff.cookie },
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    await rm(account.authDir, { recursive: true, force: true });
  }
});
