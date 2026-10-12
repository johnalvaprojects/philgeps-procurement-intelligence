import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { selectBatch } from '../backend/batch.js';
import { parseAwardDetail, parseAwardList, selectExactAwards } from '../backend/parse.js';
import { retrieveAwards } from '../backend/retrieve.js';
import { readAward } from '../backend/store.js';
import { batchStatus, checkSavedNotice } from '../backend/service.js';
import awardRoutes from '../server/award-routes.js';
import { delay } from '../../../src/log.js';
import { loginStaff, provisionStaff, staffHeaders, useAuthRoutes } from '../../../tests/http-auth.js';

const BASE = 'https://philgeps.gov.ph';

function searchPage() {
  return '<form><input type="hidden" name="_csrfToken" value="public-form-token"></form>';
}

function listPage(rows, { empty = false, more = false } = {}) {
  if (empty) return '<div>No Records Found</div>';
  const body = rows.map((row) => (
    `<tr><td>${row.awardNumber}</td><td>${row.bidReference}</td><td>${row.title}</td><td>${row.supplier}</td><td>${row.awardDate}</td></tr>`
  )).join('');
  const moreLink = more ? '<a href="https://philgeps.gov.ph/Indexes/viewMoreAward">View More</a>' : '';
  return `<table><tr><th>Award Notice Number</th><th>Bid Notice Reference number</th><th>Award Title</th><th>Awardee</th><th>Award Date</th></tr>${body}</table>${moreLink}`;
}

function detailPage(award) {
  return `
    <label>Award Notice Number :${award.awardNumber} </label>
    <label>Status :</label> ${award.status || 'Published'}
    <label>Notice Reference Number:</label><br>${award.bidReference}
    <div class="wrapped-long-string"><b>${award.title}</b></div>
    <label>Awardee:</label><label> ${award.supplier}</label>
    <label>Contract Amount:</label><br>${award.contractAmount}
    <label>Award Date:</label><br>${award.awardDate}
    <label>Published Date:</label><br>${award.publishedDate}
    <label>Date Last Updated:</label> 09-Oct-2026
  `;
}

function htmlResponse(text, cookies = ['publicSearch=1']) {
  return {
    ok: true,
    status: 200,
    headers: { getSetCookie: () => cookies },
    async text() { return text; },
  };
}

function fetchFor({ lists, details, fail = false, malformed = false, hang = null }) {
  return async (url, options = {}) => {
    const address = String(url);
    if (address.includes('getAwardNotices') && options.method !== 'POST') return htmlResponse(searchPage());
    if (options.method === 'POST') {
      if (hang) await hang.promise;
      if (fail) throw new Error('network down');
      if (!options.headers.Cookie) throw new Error('missing public form cookie');
      if (malformed) return htmlResponse('<html>not a result page</html>');
      const reference = new URLSearchParams(options.body).get('searchRefNo');
      return htmlResponse(lists[reference] || listPage([], { empty: true }));
    }
    const awardNumber = address.split('/').pop();
    if (!details[awardNumber]) return htmlResponse('<html>missing detail</html>');
    return htmlResponse(details[awardNumber]);
  };
}

async function noticeDir() {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-awards-'));
  const outputDir = path.join(directory, 'output');
  const awardsDir = path.join(directory, 'awards');
  await mkdir(outputDir);
  return { directory, outputDir, awardsDir };
}

async function writeNotice(outputDir, notice) {
  const packet = {
    notice,
    classification: 'software',
    procurementDocument: { awarding: 'RFQ line that must stay' },
  };
  await writeFile(path.join(outputDir, `${notice.referenceNumber}.json`), `${JSON.stringify(packet)}\n`);
  return packet;
}

test('exact reference matching ignores partial bid numbers', () => {
  const parsed = parseAwardList(listPage([
    { awardNumber: '36881', bidReference: '49742', title: 'VMWare', supplier: 'EQUICOM, INC.', awardDate: '09-Oct-2026' },
    { awardNumber: '11111', bidReference: '449742', title: 'Other', supplier: 'OTHER', awardDate: '01-Oct-2026' },
    { awardNumber: '22222', bidReference: '24974', title: 'Partial', supplier: 'PARTIAL', awardDate: '02-Oct-2026' },
  ]));
  const selected = selectExactAwards(parsed.rows, '49742');
  assert.deepEqual(selected.rows.map((row) => row.awardNumber), ['36881']);
  assert.deepEqual(selectExactAwards(parsed.rows, '4974').rows, []);
});

test('one bid can keep several awards, including the same supplier', async () => {
  const details = {
    36711: detailPage({
      awardNumber: '36711', bidReference: '66490', title: 'Lot A', supplier: 'INNOVE COMMUNICATIONS, INC.',
      contractAmount: 'PHP 10.00', awardDate: '01-Oct-2026', publishedDate: '02-Oct-2026',
    }),
    36719: detailPage({
      awardNumber: '36719', bidReference: '66490', title: 'Lot B', supplier: 'INNOVE COMMUNICATIONS, INC.',
      contractAmount: 'PHP 20.00', awardDate: '01-Oct-2026', publishedDate: '03-Oct-2026',
    }),
  };
  const result = await retrieveAwards('66490', {
    fetchImpl: fetchFor({
      lists: { 66490: listPage([
        { awardNumber: '36711', bidReference: '66490', title: 'Lot A', supplier: 'INNOVE COMMUNICATIONS, INC.', awardDate: '01-Oct-2026' },
        { awardNumber: '36711', bidReference: '66490', title: 'Lot A', supplier: 'INNOVE COMMUNICATIONS, INC.', awardDate: '01-Oct-2026' },
        { awardNumber: '36719', bidReference: '66490', title: 'Lot B', supplier: 'INNOVE COMMUNICATIONS, INC.', awardDate: '01-Oct-2026' },
      ]) },
      details,
    }),
    baseUrl: BASE,
    delayMs: 0,
    timeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.awards.map((award) => award.awardNumber), ['36711', '36719']);
  assert.equal(result.awards[0].supplier, result.awards[1].supplier);
  assert.equal(result.awards[0].contractAmount, 'PHP 10.00');
  assert.equal(result.awards[1].contractAmount, 'PHP 20.00');
});

test('no records, malformed pages, conflicts, and failed refreshes', async () => {
  const { outputDir, awardsDir } = await noticeDir();
  await writeNotice(outputDir, {
    referenceNumber: '96036', title: 'Saved notice', organization: 'Agency', deadline: '01-Sep-2026',
  });
  const settings = {
    outputDir,
    awardsDir,
    baseUrl: BASE,
    delayMs: 0,
    timeoutMs: 1000,
    fetchImpl: fetchFor({ lists: { 96036: listPage([], { empty: true }) }, details: {} }),
  };
  const empty = await checkSavedNotice('96036', settings);
  assert.equal(empty.outcome, 'none');
  assert.deepEqual(empty.awards, []);

  settings.fetchImpl = fetchFor({
    lists: { 96036: listPage([{ awardNumber: '22316', bidReference: '96036', title: 'Licenses', supplier: 'TRUSTERA SOLUTIONS INC.', awardDate: '12-Aug-2026' }]) },
    details: { 22316: detailPage({
      awardNumber: '22316', bidReference: '96036', title: 'Licenses', supplier: 'TRUSTERA SOLUTIONS INC.',
      contractAmount: 'PHP 211,423.62', awardDate: '12-Aug-2026', publishedDate: '19-Aug-2026',
    }) },
  });
  const published = await checkSavedNotice('96036', settings);
  assert.equal(published.outcome, 'published');
  assert.equal(published.awards[0].sourceUrl, 'https://philgeps.gov.ph/Indexes/viewAwardNotice/22316');

  settings.fetchImpl = fetchFor({ lists: {}, details: {}, fail: true });
  const failed = await checkSavedNotice('96036', settings);
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.awards[0].awardNumber, '22316');
  const stored = await readAward(awardsDir, '96036');
  assert.equal(stored.awards[0].supplier, 'TRUSTERA SOLUTIONS INC.');
  const raw = await readFile(path.join(awardsDir, '96036.json'), 'utf8');
  assert.equal(raw.includes('public-form-token'), false);
  assert.equal(raw.includes('publicSearch'), false);

  settings.fetchImpl = fetchFor({ lists: {}, details: {}, malformed: true });
  const malformed = await checkSavedNotice('96036', settings);
  assert.equal(malformed.outcome, 'failed');
  assert.equal(malformed.awards.length, 1);

  settings.fetchImpl = fetchFor({
    lists: { 96036: listPage([{ awardNumber: '99999', bidReference: '96036', title: 'Wrong', supplier: 'SOMEONE', awardDate: '01-Jan-2026' }]) },
    details: { 99999: detailPage({
      awardNumber: '99999', bidReference: '11111', title: 'Wrong', supplier: 'SOMEONE',
      contractAmount: 'PHP 1.00', awardDate: '01-Jan-2026', publishedDate: '02-Jan-2026',
    }) },
  });
  const conflict = await checkSavedNotice('96036', settings);
  assert.equal(conflict.outcome, 'conflict');
  assert.equal(conflict.awards[0].awardNumber, '22316');
  assert.equal(conflict.conflicts[0].bidReference, '11111');
  const noticeRaw = await readFile(path.join(outputDir, '96036.json'), 'utf8');
  assert.equal(noticeRaw.includes('RFQ line that must stay'), true);
  assert.equal(noticeRaw.includes('22316'), false);
});

test('detail fields are read from the public award page', () => {
  const detail = parseAwardDetail(detailPage({
    awardNumber: '36881', bidReference: '49742', title: 'VMWare renewal', supplier: 'EQUICOM, INC.',
    contractAmount: 'PHP 17,536,526.56', awardDate: '09-Oct-2026', publishedDate: '09-Oct-2026',
  }), { baseUrl: BASE });
  assert.equal(detail.supplier, 'EQUICOM, INC.');
  assert.equal(detail.contractAmount, 'PHP 17,536,526.56');
  assert.equal(detail.publishedDate, '09-Oct-2026');
  assert.equal(detail.status, 'Published');
});

test('batch checks prefer past deadlines and stay within the limit', () => {
  const notices = [
    { referenceNumber: '10001', deadline: '20-Oct-2026' },
    { referenceNumber: '10002', deadline: '01-Oct-2026' },
    { referenceNumber: '10003', deadline: '02-Oct-2026' },
  ];
  const stored = new Map([
    ['10002', { outcome: 'none', lastCheckedAt: '2026-10-01T00:00:00.000Z' }],
  ]);
  const selected = selectBatch(notices, stored, { limit: 2, now: new Date('2026-10-11T00:00:00.000Z') });
  assert.deepEqual(selected, ['10003', '10002']);
  assert.equal(selectBatch(notices, stored, { limit: 1, now: new Date('2026-10-11T00:00:00.000Z') })[0], '10003');
  const classified = [
    { referenceNumber: '20001', deadline: '01-Sep-2026', classification: 'not relevant' },
    { referenceNumber: '20002', deadline: '20-Oct-2026', classification: 'software' },
    { referenceNumber: '20003', deadline: '01-Oct-2026', classification: 'software' },
  ];
  assert.deepEqual(
    selectBatch(classified, new Map(), { limit: 1, now: new Date('2026-10-11T00:00:00.000Z'), classification: 'software' }),
    ['20003'],
  );
});

async function startServer(outputDir, awardsDir, fetchImpl) {
  const app = express();
  app.use(express.json());
  const account = await provisionStaff(app);
  app.set('outputDir', outputDir);
  app.set('awardsDir', awardsDir);
  app.set('guestFullAccess', false);
  app.set('awardFetch', fetchImpl);
  app.set('awardBaseUrl', BASE);
  app.set('awardDelayMs', 0);
  useAuthRoutes(app);
  app.use('/api/awards', awardRoutes);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  server.auth = await loginStaff(server.address().port, account);
  const guest = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/guest`, { method: 'POST' });
  server.guestCookie = (guest.headers.get('set-cookie') || '').split(';')[0];
  return server;
}

test('staff can check awards and guests can only read stored public fields', async () => {
  const { outputDir, awardsDir } = await noticeDir();
  await writeNotice(outputDir, {
    referenceNumber: '49742', title: 'VMWare renewal', organization: 'Agency', deadline: '01-Oct-2026', postedDate: '01-Sep-2026',
  });
  const fetchImpl = fetchFor({
    lists: { 49742: listPage([{ awardNumber: '36881', bidReference: '49742', title: 'VMWare renewal', supplier: 'EQUICOM, INC.', awardDate: '09-Oct-2026' }]) },
    details: { 36881: detailPage({
      awardNumber: '36881', bidReference: '49742', title: 'VMWare renewal', supplier: 'EQUICOM, INC.',
      contractAmount: 'PHP 17,536,526.56', awardDate: '09-Oct-2026', publishedDate: '09-Oct-2026',
    }) },
  });
  const server = await startServer(outputDir, awardsDir, fetchImpl);
  try {
    const port = server.address().port;
    const denied = await fetch(`http://127.0.0.1:${port}/api/awards/49742/check`, {
      method: 'POST',
      headers: { cookie: server.guestCookie, 'x-csrf-token': 'nope' },
    });
    assert.equal(denied.status, 403);
    const guestBatch = await fetch(`http://127.0.0.1:${port}/api/awards/batch`, {
      method: 'POST',
      headers: { cookie: server.guestCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    });
    assert.equal(guestBatch.status, 403);

    const checked = await fetch(`http://127.0.0.1:${port}/api/awards/49742/check`, {
      method: 'POST',
      headers: staffHeaders(server.auth, { 'Content-Type': 'application/json' }),
    });
    const staffBody = await checked.json();
    assert.equal(checked.status, 200);
    assert.equal(staffBody.outcome, 'published');
    assert.equal(staffBody.error, null);

    const guest = await fetch(`http://127.0.0.1:${port}/api/awards/49742`, { headers: { cookie: server.guestCookie } });
    const guestBody = await guest.json();
    assert.equal(guest.status, 200);
    assert.equal(guestBody.awards[0].supplier, 'EQUICOM, INC.');
    assert.equal(Object.hasOwn(guestBody, 'error'), false);

    const anonymous = await fetch(`http://127.0.0.1:${port}/api/awards`);
    assert.equal(anonymous.status, 401);

    const tooMany = await fetch(`http://127.0.0.1:${port}/api/awards/batch`, {
      method: 'POST',
      headers: staffHeaders(server.auth, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ limit: 843 }),
    });
    assert.equal(tooMany.status, 400);

    const batch = await fetch(`http://127.0.0.1:${port}/api/awards/batch`, {
      method: 'POST',
      headers: staffHeaders(server.auth, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ limit: 1 }),
    });
    assert.equal(batch.status, 202);
    let status = await batch.json();
    for (let attempt = 0; attempt < 20 && status.running; attempt += 1) {
      await delay(15);
      const follow = await fetch(`http://127.0.0.1:${port}/api/awards/batch`, { headers: staffHeaders(server.auth) });
      status = await follow.json();
    }
    assert.equal(status.running, false);
    assert.equal(status.total, 1);
    assert.equal(status.results[0].referenceNumber, '49742');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a second check for the same notice is refused while the first is running', async () => {
  const { outputDir, awardsDir } = await noticeDir();
  await writeNotice(outputDir, { referenceNumber: '50850', title: 'Licenses', deadline: '01-Aug-2026' });
  let release;
  const hang = { promise: new Promise((resolve) => { release = resolve; }) };
  const settings = {
    outputDir,
    awardsDir,
    baseUrl: BASE,
    delayMs: 0,
    timeoutMs: 1000,
    fetchImpl: fetchFor({
      lists: { 50850: listPage([], { empty: true }) },
      details: {},
      hang,
    }),
  };
  const first = checkSavedNotice('50850', settings);
  await delay(20);
  await assert.rejects(checkSavedNotice('50850', settings), (error) => error.code === 'BUSY');
  release();
  const finished = await first;
  assert.equal(finished.outcome, 'none');
  assert.equal(batchStatus(awardsDir).running, false);
});
