import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import scanRoutes from '../src/server/routes/scan-routes.js';
import { loginStaff, provisionStaff, useAuthRoutes } from './http-auth.js';
import { attachCurrentClassifications } from '../src/scan-reports.js';
import {
  buildWeeklyReport,
  manilaWeekContaining,
  manilaWeekForCalendarDay,
  resolveManilaWeek,
} from '../src/weekly-report.js';

const SUNDAY_END = Date.UTC(2026, 9, 11, 15, 59, 59, 999);
const MONDAY_START = Date.UTC(2026, 9, 11, 16, 0, 0, 0);

function weekOfOctober5() {
  return manilaWeekForCalendarDay(2026, 10, 11);
}

function snapshot(startedAt, extras = {}) {
  return {
    id: String(startedAt),
    startedAt,
    complete: true,
    completionReason: 'date-boundary',
    counts: { review: 0, notRelevant: 0 },
    softwareOpportunities: [],
    errors: [],
    ...extras,
  };
}

test('Manila week runs Monday through Sunday and splits at midnight', () => {
  const sunday = manilaWeekContaining(SUNDAY_END);
  assert.equal(sunday.from, '2026-10-05');
  assert.equal(sunday.to, '2026-10-11');
  assert.equal(sunday.endMs, SUNDAY_END);

  const monday = manilaWeekContaining(MONDAY_START);
  assert.equal(monday.from, '2026-10-12');
  assert.equal(monday.to, '2026-10-18');
  assert.equal(monday.startMs, MONDAY_START);

  const resolved = resolveManilaWeek('2026-10-07');
  assert.equal(resolved.week.from, '2026-10-05');
  assert.equal(resolved.week.to, '2026-10-11');
  assert.equal(resolveManilaWeek('2026-02-31').error, 'from must be a valid YYYY-MM-DD date');
});

test('weekly software rows are deduplicated and missing saved flags stay unknown', () => {
  const week = weekOfOctober5();
  const first = snapshot(week.startMs, {
    counts: { review: 2, notRelevant: 3 },
    softwareOpportunities: [
      { referenceNumber: '96036', title: 'Blood bank', organization: 'Hospital', previouslySaved: false },
      { referenceNumber: '100', title: 'Saved license', organization: 'Agency', previouslySaved: true },
      { referenceNumber: '200', title: 'Unmarked software', organization: 'Office' },
    ],
  });
  const second = snapshot(week.endMs, {
    counts: { review: 1, notRelevant: 4 },
    softwareOpportunities: [
      { referenceNumber: '96036', title: 'Blood bank again', organization: 'Hospital', previouslySaved: true },
      { referenceNumber: '100', title: 'Saved license', organization: 'Agency', previouslySaved: true },
    ],
    errors: [{ referenceNumber: '300', message: 'The notice page timed out' }],
  });
  const outside = snapshot(MONDAY_START, {
    counts: { review: 9, notRelevant: 9 },
    softwareOpportunities: [
      { referenceNumber: '400', title: 'Next week', previouslySaved: false },
    ],
  });

  const packets = new Map([
    ['96036', {
      classification: 'software',
      notice: { abc: '', deadline: null, closingDate: null },
    }],
  ]);
  const requirements = new Map([
    ['96036', { extractionStatus: 'partial' }],
  ]);

  const report = buildWeeklyReport({
    week,
    reports: [second, outside, first],
    packets,
    requirements,
    generatedAt: new Date('2026-10-12T00:00:00.000Z'),
  });

  assert.equal(report.scans.total, 2);
  assert.equal(report.software.newlyIdentified, 1);
  assert.equal(report.software.previouslySaved, 1);
  assert.equal(report.software.unknownRecord, 1);
  assert.equal(report.opportunities.length, 1);
  assert.equal(report.opportunities[0].referenceNumber, '96036');
  assert.equal(report.opportunities[0].title, 'Blood bank');
  assert.equal(report.opportunities[0].abc, null);
  assert.equal(report.opportunities[0].deadline, null);
  assert.equal(report.opportunities[0].workStatus, null);
  assert.equal(report.opportunities[0].extractionStatus, 'partial');
  assert.equal(report.opportunities[0].scanClassification, 'software');
  assert.equal(report.opportunities[0].classification, 'software');
  assert.equal(report.opportunities[0].packetFound, true);
  assert.equal(report.workStatus.notRecorded, 1);
  assert.equal(report.workStatus.new, 0);
  assert.equal(report.classificationEvents.review.total, 3);
  assert.equal(report.classificationEvents.notRelevant.total, 7);
  assert.equal(report.classificationEvents.uniqueNoticeDiscovery, null);
  assert.equal(report.errors.length, 1);
  assert.equal(report.scans.incomplete, 0);
  assert.equal(report.previouslySaved[0].referenceNumber, '100');
  assert.equal(report.unknownSoftware[0].referenceNumber, '200');
});

test('incomplete scans stay separate from notice errors and extraction status', () => {
  const week = weekOfOctober5();
  const report = buildWeeklyReport({
    week,
    reports: [
      snapshot(week.startMs, {
        complete: false,
        completionReason: 'safety-limit',
        counts: { review: null, notRelevant: 1 },
        softwareOpportunities: [
          { referenceNumber: '500', title: 'License', previouslySaved: false },
        ],
        errors: [{ referenceNumber: null, message: 'Pagination stopped' }],
      }),
    ],
    packets: new Map([
      ['500', {
        classification: 'software',
        workStatus: 'in-progress',
        notice: { abc: '760,000.00', deadline: '12-Oct-2026 10:00 AM' },
      }],
    ]),
    requirements: new Map([
      ['500', { extractionStatus: 'needs_review' }],
    ]),
  });

  assert.equal(report.scans.completed, 0);
  assert.equal(report.scans.incomplete, 1);
  assert.equal(report.scans.incompleteRuns[0].completionReason, 'safety-limit');
  assert.equal(report.errors[0].message, 'Pagination stopped');
  assert.equal(report.opportunities[0].workStatus, 'in-progress');
  assert.equal(report.opportunities[0].abc, '760,000.00');
  assert.equal(report.opportunities[0].extractionStatus, 'needs_review');
  assert.equal(report.workStatus.inProgress, 1);
  assert.equal(report.classificationEvents.review.missingScans, 1);
  assert.equal(report.classificationEvents.review.total, 0);
  assert.equal(report.classificationEvents.notRelevant.total, 1);
});

test('weekly route is registered before the daily report id route', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-weekly-'));
  const reportsDir = path.join(directory, 'scan-reports');
  const outputDir = path.join(directory, 'output');
  await mkdir(reportsDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const startedAt = weekOfOctober5().startMs;
  const snapshotBody = `${JSON.stringify(snapshot(startedAt, {
    softwareOpportunities: [
      { referenceNumber: '96036', title: 'Blood bank', previouslySaved: false },
    ],
  }), null, 2)}\n`;
  const snapshotPath = path.join(reportsDir, `${startedAt}.json`);
  await writeFile(snapshotPath, snapshotBody);
  await writeFile(path.join(outputDir, '96036.json'), `${JSON.stringify({
    classification: 'not relevant',
    notice: { referenceNumber: '96036', title: 'Blood bank', abc: null, deadline: null },
  })}\n`);

  const app = express();
  app.use(express.json());
  const account = await provisionStaff(app);
  app.set('scanReportsDir', reportsDir);
  app.set('outputDir', outputDir);
  useAuthRoutes(app);
  app.use('/api/scan', scanRoutes);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const port = server.address().port;
    const auth = await loginStaff(port, account);
    const weekly = await fetch(`http://127.0.0.1:${port}/api/scan/reports/weekly?from=2026-10-11`, {
      headers: { cookie: auth.cookie },
    });
    assert.equal(weekly.status, 200);
    const body = await weekly.json();
    assert.equal(body.period.from, '2026-10-05');
    assert.equal(body.period.to, '2026-10-11');
    assert.equal(body.software.newlyIdentified, 1);
    assert.equal(body.opportunities[0].abc, null);
    assert.equal(body.opportunities[0].workStatus, null);
    assert.equal(body.opportunities[0].scanClassification, 'software');
    assert.equal(body.opportunities[0].classification, 'not relevant');
    assert.equal(body.opportunities[0].packetFound, true);

    const daily = await fetch(`http://127.0.0.1:${port}/api/scan/reports/${startedAt}`, {
      headers: { cookie: auth.cookie },
    });
    assert.equal(daily.status, 200);
    const dailyBody = await daily.json();
    assert.equal(dailyBody.id, String(startedAt));
    assert.equal(dailyBody.softwareOpportunities.length, 1);
    assert.equal(dailyBody.softwareOpportunities[0].scanClassification, 'software');
    assert.equal(dailyBody.softwareOpportunities[0].currentClassification, 'not relevant');
    assert.equal(dailyBody.softwareOpportunities[0].packetFound, true);

    const invalid = await fetch(`http://127.0.0.1:${port}/api/scan/reports/weekly?from=2026-02-31`, {
      headers: { cookie: auth.cookie },
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'from must be a valid YYYY-MM-DD date');

    assert.equal(await readFile(snapshotPath, 'utf8'), snapshotBody);
    const missing = attachCurrentClassifications({
      softwareOpportunities: [{ referenceNumber: '1', title: 'Missing packet' }],
    }, new Map([['1', null]]));
    assert.equal(missing.softwareOpportunities[0].packetFound, false);
    assert.equal(missing.softwareOpportunities[0].currentClassification, null);
    assert.equal(missing.softwareOpportunities[0].scanClassification, 'software');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(directory, { recursive: true, force: true });
  }
});
