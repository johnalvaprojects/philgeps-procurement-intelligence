import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cachedClassification, noticeScanPlan } from '../src/classification/cache.js';
import { ocrTimeoutError, ocrTimeoutMs, withOcrTimeout } from '../src/extraction/ocr.js';
import { saveTemporaryInspection } from '../src/philgeps/documents.js';
import { reachedBatchLimit } from '../src/philgeps/search.js';
import { inspectionOutcomeFromError, inspectTemporaryFile } from '../src/process-notice.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

function savedPacket(relevance, review = { status: 'pending' }) {
  return {
    requirements: { items: [] },
    relevance,
    review,
    documents: [{ localPath: 'data/documents/87081/87081.pdf' }],
  };
}

test('ocrTimeoutMs defaults to 15 seconds and can be configured', () => {
  assert.equal(ocrTimeoutMs({}), 15000);
  assert.equal(ocrTimeoutMs({ OCR_TIMEOUT_MS: '15000' }), 15000);
  assert.equal(ocrTimeoutMs({ OCR_TIMEOUT_MS: '20000' }), 20000);
  assert.equal(ocrTimeoutMs({ OCR_TIMEOUT_MS: '0' }), 15000);
  assert.equal(ocrTimeoutMs({ OCR_TIMEOUT_MS: 'fast' }), 15000);
});

test('OCR timeout cancels the operation', async () => {
  let cancelled = false;
  await assert.rejects(
    () => withOcrTimeout(
      () => new Promise(() => {}),
      {
        timeoutMs: 20,
        onTimeout: () => {
          cancelled = true;
        },
      },
    ),
    (error) => error.code === 'OCR_TIMEOUT',
  );
  assert.equal(cancelled, true);
});

test('OCR still returns text when it finishes within the timeout', async () => {
  let cancelled = false;
  const text = await withOcrTimeout(
    async () => 'software license',
    {
      timeoutMs: 200,
      onTimeout: () => {
        cancelled = true;
      },
    },
  );
  assert.equal(text, 'software license');
  assert.equal(cancelled, false);
});

test('an OCR timeout is marked for review', () => {
  const result = inspectionOutcomeFromError(ocrTimeoutError());
  assert.equal(result.timedOut, true);
  assert.equal(result.outcome, 'unclear');
  assert.equal(result.relevance.needsReview, true);
  assert.equal(result.relevance.isRelevant, false);
});

test('a timeout marks the notice for review, removes the temporary file, and the next notice still runs', async () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);

  const first = await saveTemporaryInspection('scan.pdf', Buffer.from('scan'));
  const second = await saveTemporaryInspection('next.pdf', Buffer.from('next'));
  let inspections = 0;

  try {
    const notices = ['87081', '87082'];
    const outcomes = [];

    for (const noticeId of notices) {
      const temporary = noticeId === '87081' ? first : second;
      outcomes.push(await inspectTemporaryFile(temporary, noticeId, async () => {
        inspections += 1;
        if (noticeId === '87081') throw ocrTimeoutError();
        return {
          outcome: 'skip',
          relevance: { isRelevant: false, needsReview: false, category: 'hardware' },
        };
      }));
    }

    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0].outcome, 'unclear');
    assert.equal(outcomes[0].relevance.needsReview, true);
    assert.equal(outcomes[1].outcome, 'skip');
    assert.equal(inspections, 2);
    assert.equal(existsSync(first.filePath), false);
    assert.equal(existsSync(second.filePath), false);
    assert.equal(lines.includes('[WARN] OCR timed out while inspecting notice 87081. Marked for review.'), true);
  } finally {
    console.log = original;
  }
});

test('a cached classification is reused and the notice is not inspected again', () => {
  const packet = savedPacket(
    { isRelevant: false, needsReview: true, category: 'unknown' },
    { status: 'reviewed', reviewedAt: '2026-09-25T15:25:36.740Z' },
  );
  let inspections = 0;
  const plan = noticeScanPlan(
    { title: 'Supply and Delivery of IT Solution', referenceNumber: '87081' },
    rules,
    packet,
  );

  if (plan.action === 'process') inspections += 1;

  assert.equal(plan.action, 'reuse');
  assert.equal(plan.label, 'review');
  assert.equal(inspections, 0);
  assert.equal(packet.review.status, 'reviewed');
  assert.equal(packet.review.reviewedAt, '2026-09-25T15:25:36.740Z');
  assert.equal(packet.documents[0].localPath, 'data/documents/87081/87081.pdf');
  assert.deepEqual(cachedClassification(packet), { label: 'review' });
  assert.equal(cachedClassification({ relevance: packet.relevance }), null);
});

test('cached software and not-relevant results are reused, and a hardware title is still skipped first', () => {
  const software = noticeScanPlan(
    { title: 'Supply and Delivery of Mapping Software' },
    rules,
    savedPacket({ isRelevant: true, needsReview: false, category: 'software' }),
  );
  const hardwareDocument = noticeScanPlan(
    { title: 'Supply and Delivery of IT Solution' },
    rules,
    savedPacket({ isRelevant: false, needsReview: false, category: 'hardware' }),
  );
  const hardwareTitle = noticeScanPlan(
    { title: 'Supply and Delivery of IT Equipment' },
    rules,
    savedPacket({ isRelevant: true, needsReview: false, category: 'software' }),
  );

  assert.equal(software.action, 'reuse');
  assert.equal(software.label, 'software');
  assert.equal(hardwareDocument.action, 'reuse');
  assert.equal(hardwareDocument.label, 'not relevant');
  assert.equal(hardwareTitle.action, 'skip');
});

test('--svp 10 counts every notice and stops at 10', () => {
  const notices = [
    'saved',
    'hardware',
    'software',
    'unclear',
    'error',
    'saved',
    'hardware',
    'software',
    'unclear',
    'error',
    'extra',
    'extra',
  ];
  const limit = 10;
  let processedCount = 0;
  const processed = [];

  for (const notice of notices) {
    if (reachedBatchLimit(processedCount, limit)) break;
    processedCount += 1;
    processed.push(notice);
  }

  assert.equal(processed.length, 10);
  assert.deepEqual(processed, notices.slice(0, 10));
  assert.equal(reachedBatchLimit(processedCount, limit), true);
  assert.equal(reachedBatchLimit(processedCount, null), false);
});
