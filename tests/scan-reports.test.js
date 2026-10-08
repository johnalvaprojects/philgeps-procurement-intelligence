import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildScanReport, listScanReports, noticeReportIdentity, readScanReport, writeScanReport } from '../src/scan-reports.js';
import { buildCaseReport } from '../frontend/src/reports/case-report.js';
import { formatManilaTimestamp } from '../frontend/src/reports/report-format.js';

test('scan report keeps recorded counts and does not invent software rows', () => {
  const report = buildScanReport({
    progress: {
      startedAt: 1000,
      from: '2026-10-06',
      to: '2026-10-08',
      elapsedMs: 12500,
      complete: true,
      completionReason: 'date-boundary',
      noticesDiscovered: 4,
      noticesProcessed: 4,
      softwareCount: 1,
      reviewCount: 1,
      notRelevantCount: 1,
      alreadyProcessedCount: 0,
      errorCount: 1,
      documentsDownloaded: 2,
    },
    rows: [
      {
        referenceNumber: '10',
        title: 'Software license',
        organization: 'Agency',
        isRelevant: true,
        needsReview: false,
        alreadyProcessed: false,
        classificationSource: 'automatic',
        reviewed: false,
      },
      {
        referenceNumber: '11',
        title: 'Already saved software',
        isRelevant: true,
        needsReview: false,
        alreadyProcessed: true,
        classificationSource: 'manual',
        reviewed: true,
      },
      {
        referenceNumber: '12',
        title: 'Unclear',
        isRelevant: false,
        needsReview: true,
      },
      {
        referenceNumber: '13',
        error: 'The notice page timed out',
      },
    ],
    mode: 'scan',
  });

  assert.equal(report.counts.software, 1);
  assert.equal(report.counts.review, 1);
  assert.equal(report.counts.notRelevant, 1);
  assert.equal(report.counts.documentsDownloaded, 2);
  assert.equal(report.durationMs, 12500);
  assert.equal(report.complete, true);
  assert.equal(report.counts.matchingSoftware, report.softwareOpportunities.length);
  assert.deepEqual(report.softwareOpportunities, [{
    referenceNumber: '10',
    title: 'Software license',
    organization: 'Agency',
    source: 'automatic',
    reviewStatus: 'pending',
    previouslySaved: false,
  }, {
    referenceNumber: '11',
    title: 'Already saved software',
    organization: null,
    source: 'manual',
    reviewStatus: 'reviewed',
    previouslySaved: true,
  }]);
  assert.deepEqual(report.errors, [{
    referenceNumber: '13',
    message: 'The notice page timed out',
  }]);
});

test('an interrupted scan records the error and does not mark itself complete', () => {
  const report = buildScanReport({
    progress: {
      startedAt: 2000,
      complete: false,
      completionReason: 'error',
      elapsedMs: 400,
      noticesDiscovered: 0,
    },
    rows: [],
    errorMessage: 'PhilGEPS did not respond',
  });

  assert.equal(report.complete, false);
  assert.equal(report.completionReason, 'error');
  assert.deepEqual(report.errors, [{ referenceNumber: null, message: 'PhilGEPS did not respond' }]);
  assert.deepEqual(report.softwareOpportunities, []);
  assert.equal(report.counts.software, null);
  assert.equal(report.counts.matchingSoftware, 0);
});

test('a first scan lists only newly identified software', () => {
  const report = buildScanReport({
    progress: {
      startedAt: 5000,
      from: '2026-10-06',
      to: '2026-10-08',
      softwareCount: 1,
      alreadyProcessedCount: 0,
      noticesDiscovered: 1,
      noticesProcessed: 1,
    },
    rows: [{
      referenceNumber: '30',
      title: 'New license',
      organization: 'Agency',
      isRelevant: true,
      needsReview: false,
      alreadyProcessed: false,
      classificationSource: 'automatic',
      reviewed: false,
    }],
    finishedAt: '2026-10-08T10:00:00.000Z',
  });

  assert.equal(report.counts.software, 1);
  assert.equal(report.counts.alreadyProcessed, 0);
  assert.equal(report.counts.matchingSoftware, 1);
  assert.equal(report.softwareOpportunities[0].previouslySaved, false);
  assert.equal(report.from, '2026-10-06');
  assert.equal(report.finishedAt, '2026-10-08T10:00:00.000Z');
  assert.equal(formatManilaTimestamp(report.startedAt), 'January 01, 1970, 8:00 AM PHT');
  assert.equal(formatManilaTimestamp(report.finishedAt), 'October 08, 2026, 6:00 PM PHT');
});

test('a repeated scan keeps saved software in the date-range list without counting it as new', () => {
  const report = buildScanReport({
    progress: {
      startedAt: 6000,
      from: '2026-10-06',
      to: '2026-10-08',
      softwareCount: 0,
      alreadyProcessedCount: 2,
      noticesDiscovered: 2,
      noticesProcessed: 2,
    },
    rows: [
      {
        referenceNumber: '40',
        title: 'Saved license',
        organization: 'Agency A',
        isRelevant: true,
        needsReview: false,
        alreadyProcessed: true,
        classificationSource: 'automatic',
        reviewed: false,
      },
      {
        referenceNumber: '41',
        title: 'Saved manual software',
        organization: 'Agency B',
        isRelevant: true,
        needsReview: false,
        alreadyProcessed: true,
        classificationSource: 'manual',
        reviewed: true,
      },
    ],
  });

  assert.equal(report.counts.software, 0);
  assert.equal(report.counts.alreadyProcessed, 2);
  assert.equal(report.counts.matchingSoftware, 2);
  assert.deepEqual(report.softwareOpportunities.map((row) => row.referenceNumber), ['40', '41']);
  assert.equal(report.softwareOpportunities.every((row) => row.previouslySaved === true), true);
  assert.equal(report.softwareOpportunities[1].source, 'manual');
});

test('a mixed scan lists new and previously saved software once', () => {
  const report = buildScanReport({
    progress: {
      startedAt: 7000,
      softwareCount: 1,
      alreadyProcessedCount: 2,
    },
    rows: [
      {
        referenceNumber: '50',
        title: 'New',
        isRelevant: true,
        needsReview: false,
        alreadyProcessed: false,
        classificationSource: 'automatic',
        reviewed: false,
      },
      {
        referenceNumber: '51',
        title: 'Saved software',
        isRelevant: true,
        needsReview: false,
        alreadyProcessed: true,
        classificationSource: 'automatic',
        reviewed: false,
      },
      {
        referenceNumber: '51',
        title: 'Duplicate saved software',
        isRelevant: true,
        needsReview: false,
        alreadyProcessed: true,
        classificationSource: 'manual',
        reviewed: true,
      },
      {
        identity: 'source:legacy-9',
        referenceNumber: '90',
        title: 'Same canonical notice',
        isRelevant: true,
        needsReview: false,
      },
      {
        identity: 'source:legacy-9',
        referenceNumber: '91',
        title: 'Repeated canonical notice',
        isRelevant: true,
        needsReview: false,
      },
      {
        referenceNumber: '52',
        title: 'Saved review',
        isRelevant: false,
        needsReview: true,
        alreadyProcessed: true,
      },
    ],
  });

  assert.equal(noticeReportIdentity({ identity: 'source:legacy-9', referenceNumber: '90' }), 'source:legacy-9');
  assert.equal(noticeReportIdentity({ referenceNumber: '50' }), '50');
  assert.equal(report.counts.software, 1);
  assert.equal(report.counts.alreadyProcessed, 2);
  assert.equal(report.counts.matchingSoftware, report.softwareOpportunities.length);
  assert.deepEqual(report.softwareOpportunities.map((row) => row.referenceNumber), ['50', '51', '90']);
  assert.equal(report.softwareOpportunities[1].title, 'Saved software');
  assert.equal(report.softwareOpportunities[1].source, 'automatic');
});

test('scan summaries are written atomically and a later save does not replace the first', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'scan-reports-'));
  try {
    const first = buildScanReport({
      progress: {
        startedAt: 3000,
        complete: true,
        completionReason: 'date-boundary',
        softwareCount: 2,
        elapsedMs: 1000,
      },
      rows: [{
        referenceNumber: '20',
        title: 'First run',
        isRelevant: true,
        needsReview: false,
        classificationSource: 'automatic',
        reviewed: false,
      }],
    });
    const saved = await writeScanReport(directory, first);
    assert.equal(saved.saved, true);
    assert.equal(saved.id, '3000');

    const second = buildScanReport({
      progress: { startedAt: 3000, complete: false, completionReason: 'error', softwareCount: 99 },
      rows: [],
      errorMessage: 'should not replace',
    });
    const skipped = await writeScanReport(directory, second);
    assert.equal(skipped.saved, false);
    assert.equal(skipped.reason, 'exists');

    const stored = JSON.parse(await readFile(path.join(directory, '3000.json'), 'utf8'));
    assert.equal(stored.counts.software, 2);
    assert.equal(stored.softwareOpportunities[0].title, 'First run');
    assert.equal(stored.counts.matchingSoftware, 1);
    assert.equal(typeof stored.generatedAt, 'string');
    assert.equal(stored.finishedAt, saved.report.finishedAt);
    assert.equal(await readScanReport('3000', directory).then((report) => report.id), '3000');
    assert.equal(await readScanReport('../3000', directory), null);

    const later = buildScanReport({
      progress: { startedAt: 4000, complete: true, from: '2026-10-01', to: '2026-10-03', softwareCount: 0 },
      rows: [],
    });
    await writeScanReport(directory, later);
    const listed = await listScanReports(directory);
    assert.deepEqual(listed.map((report) => report.id), ['4000', '3000']);
    assert.equal(listed[1].counts.software, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('case report uses stored requirements and leaves missing fields empty', () => {
  const report = buildCaseReport({
    classification: 'software',
    classificationSource: 'automatic',
    reviewed: false,
    notice: {
      referenceNumber: '92301',
      title: 'A very long procurement title that must stay intact and must not be shortened by the report model',
      organization: 'Department of Example',
      url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/92301',
      postedDate: '06-Oct-2026',
      deadline: '20-Oct-2026 1:00 PM',
      abc: '100000',
    },
    documents: [{ filename: 'rfq.pdf' }],
    extractedRequirements: {
      extractionStatus: 'needs_review',
      financial: {
        abc: { value: '80000', source: 'rfq.pdf', confidence: 'high', scope: 'item_table' },
        abcScope: 'item_table',
        otherFinancialLimits: [
          { value: '120000', source: 'rfq.pdf', confidence: 'medium', role: 'document_header_abc' },
        ],
      },
      items: [
        {
          description: { value: 'Named software', source: 'rfq.pdf', confidence: 'high' },
          quantity: { value: '2', source: 'rfq.pdf', confidence: 'high' },
          unitOfMeasure: { value: 'license', source: 'rfq.pdf', confidence: 'high' },
          subscriptionDuration: { value: '1 year', source: 'rfq.pdf', confidence: 'high', constraint: 'minimum' },
        },
      ],
      technical: {
        requiredFeatures: [],
        minimumSpecifications: [{ value: 'Runs on Windows', source: 'rfq.pdf', confidence: 'medium' }],
      },
      delivery: { deliveryPeriod: null, deliveryLocation: null },
      submission: {
        quotationDeadline: { value: '19-Oct-2026', source: 'rfq.pdf', confidence: 'high' },
      },
      conflicts: [{
        field: 'financial.abc',
        values: [
          { value: '80000', source: 'rfq.pdf' },
          { value: '120000', source: 'rfq.pdf' },
        ],
      }],
      fieldsNeedingReview: ['financial.abc'],
      sourceDocuments: ['rfq.pdf'],
    },
  });

  assert.equal(report.title.includes('must stay intact'), true);
  assert.equal(report.sourceLabel, 'philgeps.gov.ph');
  assert.equal(report.items[0].duration.constraint, 'minimum');
  assert.equal(report.items[0].duration.value, '1 year');
  assert.equal(report.deliveryPeriod, null);
  assert.equal(report.deliveryLocation, null);
  assert.equal(report.extractedClauseCount, 1);
  assert.equal(report.technicalFacts.some((fact) => fact.value === 'Runs on Windows'), false);
  assert.equal(report.technicalFacts.some((fact) => fact.value === 'Named software'), false);
  assert.equal(report.technicalFacts.find((fact) => fact.label === 'Subscription duration').constraint, 'minimum');
  assert.equal(report.conflicts.length, 1);
  assert.deepEqual(report.documents, ['rfq.pdf']);
  assert.equal(report.noticeAbc, '100000');
  assert.equal(report.financialAbc.value, '80000');

  const empty = buildCaseReport({
    notice: { referenceNumber: '1', title: 'No documents' },
  });
  assert.equal(empty.requirementsPresent, false);
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.technicalFacts, []);
  assert.equal(empty.extractedClauseCount, 0);
  assert.deepEqual(empty.conflicts, []);
  assert.equal(empty.financialAbc, null);
  assert.equal(empty.sourceLabel, null);
});
