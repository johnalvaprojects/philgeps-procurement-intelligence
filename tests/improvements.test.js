import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildNoticeMetadata, savedNoticeFiles, writeNoticeMetadata } from '../src/documents/metadata.js';
import { log, redactSecrets, startScanLog, stopScanLog } from '../src/log.js';
import { applyManualDecision, classificationFields, saveManualDecision } from '../src/review/decision.js';
import { renderReviewList } from '../src/review/list.js';
import { startReviewServer } from '../src/review/server.js';
import { countScanRows, formatDuration, formatScanSummary, formatWindowLabel } from '../src/review/summary.js';

function reviewPacket() {
  return {
    notice: {
      referenceNumber: '87086',
      title: 'Example title',
      postedDate: '25-Sep-2026 12:00 AM',
    },
    documents: [
      { filename: '87086_01.pdf', localPath: 'data/documents/87086/87086_01.pdf' },
    ],
    relevance: {
      isRelevant: false,
      needsReview: true,
      category: 'unknown',
      reasons: ['No configured software or hardware terms were found.'],
    },
    requirements: { items: [] },
    review: { status: 'pending' },
    classification: 'review',
    classificationSource: 'automatic',
    reviewed: false,
  };
}

test('metadata.json records the notice id and downloaded files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-meta-'));
  try {
    const metadata = buildNoticeMetadata({
      noticeId: '87086',
      title: 'Example title',
      publishDate: '25-Sep-2026 12:00 AM',
      classification: 'software',
      files: ['87086_01.pdf', '87086_02.pdf', '87086_03.pdf', '87086_04.docx'],
      downloadedAt: new Date('2026-09-26T01:30:00.000Z'),
    });
    assert.equal(metadata.noticeId, '87086');
    assert.equal(metadata.publishDate, '2026-09-25');
    assert.equal(metadata.attachmentCount, 4);
    assert.deepEqual(metadata.files, ['87086_01.pdf', '87086_02.pdf', '87086_03.pdf', '87086_04.docx']);

    await writeNoticeMetadata(metadata, directory);
    const updated = await writeNoticeMetadata({ ...metadata, title: 'Updated title' }, directory);
    const saved = JSON.parse(await readFile(path.join(directory, '87086', 'metadata.json'), 'utf8'));
    assert.equal(updated.noticeId, '87086');
    assert.equal(saved.title, 'Updated title');
    assert.deepEqual(saved.files, metadata.files);
    assert.equal(saved.attachmentCount, 4);

    const names = await readFile(path.join(directory, '87086', 'metadata.json'), 'utf8');
    assert.equal(names.match(/"noticeId"/g).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('temporary inspection files are not listed as downloaded documents', () => {
  assert.deepEqual(savedNoticeFiles([
    { filename: 'inspect.pdf', localPath: 'C:/Users/temp/philgeps-inspect-abc/inspect.pdf' },
    { filename: 'metadata.json', localPath: 'data/documents/87086/metadata.json' },
    { filename: '87086_01.pdf', localPath: 'data/documents/87086/87086_01.pdf' },
  ]), ['87086_01.pdf']);
});

test('review page shows the notice, status, and actions', () => {
  const html = renderReviewList([
    {
      referenceNumber: '87086',
      title: 'Example title',
      postedDate: '25-Sep-2026',
      result: 'review',
      organization: 'Example Agency',
      deadline: '29-Sep-2026',
      noticeUrl: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/87086',
      files: [{ label: '87086_01.pdf', href: '../documents/87086/87086_01.pdf' }],
      attachmentCount: 1,
      reviewStatus: 'pending',
      classificationSource: 'automatic',
    },
  ], new Date('2026-09-26T01:30:00.000Z'));

  assert.match(html, /Notice 87086/);
  assert.match(html, /Example title/);
  assert.match(html, /25-Sep-2026/);
  assert.match(html, /Review/);
  assert.match(html, /1 attachment/);
  assert.match(html, /pending/);
  assert.match(html, /Open Documents/);
  assert.match(html, /Mark Software/);
  assert.match(html, /Mark Not Relevant/);
  assert.match(html, /Keep for Review/);
  assert.match(html, /automatic/);
});

test('manual software and not-relevant decisions are saved and files stay in place', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-decide-'));
  const outputDir = path.join(directory, 'output');
  const documentsRoot = path.join(directory, 'documents');
  const noticeDir = path.join(documentsRoot, '87086');
  await mkdir(outputDir, { recursive: true });
  await mkdir(noticeDir, { recursive: true });
  const pdfPath = path.join(noticeDir, '87086_01.pdf');
  await writeFile(pdfPath, 'pdf');
  await writeNoticeMetadata(buildNoticeMetadata({
    noticeId: '87086',
    title: 'Example title',
    publishDate: '25-Sep-2026',
    classification: 'review',
    files: ['87086_01.pdf'],
  }), documentsRoot);
  await writeFile(path.join(outputDir, '87086.json'), `${JSON.stringify(reviewPacket(), null, 2)}\n`);

  try {
    const software = await saveManualDecision('87086', 'software', {
      outputDir,
      documentsRoot,
      reviewedAt: new Date('2026-09-26T02:00:00.000Z'),
    });
    assert.equal(software.classification, 'software');
    assert.equal(software.classificationSource, 'manual');
    assert.equal(software.reviewed, true);
    assert.equal(software.reviewedAt, '2026-09-26T02:00:00.000Z');
    assert.equal(software.relevance.isRelevant, true);
    assert.equal(software.documents[0].filename, '87086_01.pdf');
    assert.equal(existsSync(pdfPath), true);

    const notRelevant = await saveManualDecision('87086', 'not-relevant', {
      outputDir,
      documentsRoot,
      reviewedAt: new Date('2026-09-26T02:05:00.000Z'),
    });
    assert.equal(notRelevant.classification, 'not relevant');
    assert.equal(notRelevant.classificationSource, 'manual');
    assert.equal(notRelevant.reviewed, true);
    assert.equal(notRelevant.relevance.needsReview, false);
    assert.equal(existsSync(pdfPath), true);

    const kept = applyManualDecision(reviewPacket(), 'review', new Date('2026-09-26T02:10:00.000Z'));
    assert.equal(kept.classification, 'review');
    assert.equal(kept.classificationSource, 'manual');
    assert.equal(kept.relevance.needsReview, true);
    assert.equal(kept.review.status, 'reviewed');
    assert.notEqual(kept.classificationSource, classificationFields(reviewPacket().relevance, reviewPacket().review).classificationSource);

    const metadata = JSON.parse(await readFile(path.join(noticeDir, 'metadata.json'), 'utf8'));
    assert.equal(metadata.noticeId, '87086');
    assert.equal(metadata.classification, 'not relevant');
    assert.equal(metadata.classificationSource, 'manual');
    assert.equal(metadata.reviewed, true);
    assert.deepEqual(metadata.files, ['87086_01.pdf']);

    const stored = JSON.parse(await readFile(path.join(outputDir, '87086.json'), 'utf8'));
    assert.equal(stored.classificationSource, 'manual');
    assert.equal(stored.reviewed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the scan summary counts each notice once', () => {
  const rows = [
    { referenceNumber: '1', isRelevant: true, needsReview: false, downloadedCount: 4 },
    { referenceNumber: '1', isRelevant: true, needsReview: false, downloadedCount: 4 },
    { referenceNumber: '2', isRelevant: false, needsReview: false },
    { referenceNumber: '3', needsReview: true },
    { referenceNumber: '4', alreadyProcessed: true, isRelevant: true, downloadedCount: 9 },
    { referenceNumber: '5', error: 'failed' },
  ];
  const counts = countScanRows(rows);
  assert.equal(counts.processed, 5);
  assert.equal(counts.software, 1);
  assert.equal(counts.notRelevant, 1);
  assert.equal(counts.review, 1);
  assert.equal(counts.alreadyProcessed, 1);
  assert.equal(counts.errors, 1);
  assert.equal(counts.documentsDownloaded, 4);
  assert.equal(
    counts.software + counts.notRelevant + counts.review + counts.alreadyProcessed + counts.errors,
    counts.processed,
  );

  const scan = formatScanSummary({
    mode: 'scan',
    windowLabel: formatWindowLabel(new Date(2026, 8, 23), new Date(2026, 8, 26)),
    counts: { ...counts, processed: 84, software: 7, notRelevant: 42, review: 5, alreadyProcessed: 28, errors: 2, documentsDownloaded: 19 },
    durationMs: 154000,
  });
  assert.match(scan, /PHILGEPS SCAN SUMMARY/);
  assert.match(scan, /Date window:\s+Sep 23 - Sep 26, 2026/);
  assert.match(scan, /Notices processed:\s+84/);
  assert.match(scan, /Software:\s+7/);
  assert.match(scan, /Documents downloaded:\s+19/);
  assert.equal(formatDuration(154000), '2m 34s');

  const svp = formatScanSummary({
    mode: 'svp',
    limit: 10,
    counts: { processed: 10, software: 2, notRelevant: 3, review: 1, alreadyProcessed: 3, errors: 1, documentsDownloaded: 0 },
    durationMs: 1000,
  });
  assert.match(svp, /Mode: SVP test/);
  assert.match(svp, /Limit: 10 notices/);
  assert.match(svp, /Processed: 10/);
});

test('a scan log file is created without secrets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-log-'));
  try {
    const filePath = startScanLog(new Date('2026-09-26T01:17:00.000Z'), directory);
    log('INFO', 'Scan started');
    log('INFO', 'password=hunter2 cookie=abc123');
    const text = await readFile(filePath, 'utf8');
    assert.match(path.basename(filePath), /^scan-2026-09-26/);
    assert.match(text, /\[INFO\] Scan started/);
    assert.match(text, /password=\[redacted\]/);
    assert.match(text, /cookie=\[redacted\]/);
    assert.equal(text.includes('hunter2'), false);
    assert.equal(text.includes('abc123'), false);
    assert.equal(redactSecrets('authorization: Bearer-secret'), 'authorization=[redacted]');
  } finally {
    stopScanLog();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the review server stores a manual software decision', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-review-'));
  const outputDir = path.join(directory, 'output');
  const documentsRoot = path.join(directory, 'documents');
  await mkdir(outputDir, { recursive: true });
  await mkdir(path.join(documentsRoot, '87086'), { recursive: true });
  await writeFile(path.join(documentsRoot, '87086', '87086_01.pdf'), 'pdf');
  await writeFile(path.join(outputDir, '87086.json'), `${JSON.stringify(reviewPacket(), null, 2)}\n`);
  await writeFile(path.join(outputDir, 'review.html'), '<p>Notice 87086</p>');

  const server = await startReviewServer({
    port: 0,
    outputDir,
    documentsRoot,
    onDecide: (noticeId, decision) => saveManualDecision(noticeId, decision, { outputDir, documentsRoot }),
  });

  try {
    const port = server.address().port;
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Notice 87086/);

    const response = await fetch(`http://127.0.0.1:${port}/api/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeId: '87086', decision: 'software' }),
    });
    assert.equal(response.status, 200);
    const stored = JSON.parse(await readFile(path.join(outputDir, '87086.json'), 'utf8'));
    assert.equal(stored.classification, 'software');
    assert.equal(stored.classificationSource, 'manual');
    assert.equal(existsSync(path.join(documentsRoot, '87086', '87086_01.pdf')), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
