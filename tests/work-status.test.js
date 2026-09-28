import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { buildNoticeMetadata, writeNoticeMetadata } from '../src/documents/metadata.js';
import { applyManualDecision, classificationFields } from '../src/review/decision.js';
import { applyAutomaticClassification } from '../src/reclassify.js';
import {
  attachWorkStatus,
  publicWorkStatus,
  setSavedWorkStatus,
} from '../src/review/work-status.js';
import noticeRoutes from '../src/server/routes/notice-routes.js';

const softwareRelevance = {
  isRelevant: true,
  needsReview: false,
  category: 'software',
  reasons: ['Matched a software term.'],
};

function packet(extra = {}) {
  return {
    notice: {
      referenceNumber: '87086',
      title: 'Supply and delivery of accounting software',
      postedDate: '25-Sep-2026 12:00 AM',
    },
    documents: [],
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
    keeper: 'leave this alone',
    ...extra,
  };
}

async function fixture(body = packet()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-work-'));
  const outputDir = path.join(directory, 'output');
  const documentsRoot = path.join(directory, 'documents');
  const noticeDir = path.join(documentsRoot, '87086');
  await mkdir(outputDir, { recursive: true });
  await mkdir(noticeDir, { recursive: true });
  await writeNoticeMetadata(buildNoticeMetadata({
    noticeId: '87086',
    title: body.notice.title,
    publishDate: '25-Sep-2026',
    classification: body.classification,
    files: [],
  }), documentsRoot);
  await writeFile(path.join(outputDir, '87086.json'), `${JSON.stringify(body, null, 2)}\n`);
  return { directory, outputDir, documentsRoot };
}

function startApp(outputDir, documentsRoot) {
  const app = express();
  app.use(express.json());
  app.set('outputDir', outputDir);
  app.set('documentsRoot', documentsRoot);
  app.use('/api/notices', noticeRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('a newly classified software opportunity defaults to work status new', () => {
  const saved = attachWorkStatus(classificationFields(softwareRelevance, { status: 'pending' }), null);
  assert.equal(saved.classification, 'software');
  assert.equal(saved.workStatus, 'new');
});

test('an existing software record without workStatus is treated as new', () => {
  const stored = packet({
    classification: 'software',
    relevance: softwareRelevance,
  });
  delete stored.workStatus;
  assert.equal(publicWorkStatus(stored), 'new');
  assert.equal(stored.workStatus, undefined);
});

test('changing a review opportunity to software initializes work status new', () => {
  const updated = applyManualDecision(packet(), 'software', new Date('2026-09-27T00:00:00.000Z'));
  assert.equal(updated.classification, 'software');
  assert.equal(updated.workStatus, 'new');
  assert.equal(updated.keeper, 'leave this alone');
});

test('changing software to review keeps an existing work status', () => {
  const updated = applyManualDecision(packet({
    classification: 'software',
    workStatus: 'done',
    relevance: softwareRelevance,
  }), 'review', new Date('2026-09-27T00:00:00.000Z'));
  assert.equal(updated.classification, 'review');
  assert.equal(updated.workStatus, 'done');
  assert.equal(updated.keeper, 'leave this alone');
});

test('a later automatic classification keeps a saved work status', () => {
  const saved = packet({
    classification: 'software',
    workStatus: 'done',
    relevance: softwareRelevance,
  });
  const rescanned = applyAutomaticClassification(saved, softwareRelevance);
  assert.equal(rescanned.classification, 'software');
  assert.equal(rescanned.classificationSource, 'automatic');
  assert.equal(rescanned.workStatus, 'done');
  assert.equal(rescanned.keeper, 'leave this alone');

  const rebuilt = attachWorkStatus(classificationFields(softwareRelevance, saved.review), saved);
  assert.equal(rebuilt.workStatus, 'done');
});

test('work status can be changed and rejects invalid or missing notices', async () => {
  const { directory, outputDir, documentsRoot } = await fixture(packet({
    classification: 'software',
    workStatus: 'new',
    relevance: softwareRelevance,
  }));
  const server = await startApp(outputDir, documentsRoot);
  try {
    const port = server.address().port;
    const changed = await fetch(`http://127.0.0.1:${port}/api/notices/87086/work-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workStatus: 'done' }),
    });
    assert.equal(changed.status, 200);
    const body = await changed.json();
    assert.equal(body.workStatus, 'done');
    assert.equal(body.classification, 'software');

    const stored = JSON.parse(await readFile(path.join(outputDir, '87086.json'), 'utf8'));
    assert.equal(stored.workStatus, 'done');
    assert.equal(stored.classification, 'software');
    assert.equal(stored.keeper, 'leave this alone');
    const metadata = JSON.parse(await readFile(path.join(documentsRoot, '87086', 'metadata.json'), 'utf8'));
    assert.equal(metadata.workStatus, 'done');
    assert.equal(metadata.classification, 'software');

    const invalid = await fetch(`http://127.0.0.1:${port}/api/notices/87086/work-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workStatus: 'archived' }),
    });
    assert.equal(invalid.status, 400);
    const afterInvalid = JSON.parse(await readFile(path.join(outputDir, '87086.json'), 'utf8'));
    assert.equal(afterInvalid.workStatus, 'done');

    const missing = await fetch(`http://127.0.0.1:${port}/api/notices/424242/work-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workStatus: 'new' }),
    });
    assert.equal(missing.status, 404);

    const progressed = await setSavedWorkStatus('87086', 'in-progress', { outputDir, documentsRoot });
    assert.equal(progressed.workStatus, 'in-progress');
    assert.equal(progressed.classification, 'software');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
