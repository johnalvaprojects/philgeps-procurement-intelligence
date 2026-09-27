import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { buildNoticeMetadata, writeNoticeMetadata } from '../src/documents/metadata.js';
import { decideSavedNotice } from '../src/review/decision.js';
import noticeRoutes from '../src/server/routes/notice-routes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function packet() {
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

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-api-'));
  const outputDir = path.join(directory, 'output');
  const documentsRoot = path.join(directory, 'documents');
  const noticeDir = path.join(documentsRoot, '87086');
  await mkdir(outputDir, { recursive: true });
  await mkdir(noticeDir, { recursive: true });
  await writeFile(path.join(noticeDir, '87086_01.pdf'), 'pdf');
  await writeNoticeMetadata(buildNoticeMetadata({
    noticeId: '87086',
    title: 'Example title',
    publishDate: '25-Sep-2026',
    classification: 'review',
    files: ['87086_01.pdf'],
  }), documentsRoot);
  await writeFile(path.join(outputDir, '87086.json'), `${JSON.stringify(packet(), null, 2)}\n`);
  return { directory, outputDir, documentsRoot, noticeDir };
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

test('the CLI and API share decideSavedNotice for a manual classification', async () => {
  const { directory, outputDir, documentsRoot, noticeDir } = await fixture();
  const server = await startApp(outputDir, documentsRoot);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/notices/87086/classification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 'software' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.classification, 'software');
    assert.equal(body.classificationSource, 'manual');
    assert.equal(body.reviewed, true);
    assert.equal(body.review.status, 'reviewed');
    assert.equal(body.review.source, 'manual');
    assert.equal(body.relevance.isRelevant, true);
    assert.equal(body.relevance.needsReview, false);

    const stored = JSON.parse(await readFile(path.join(outputDir, '87086.json'), 'utf8'));
    assert.equal(stored.classificationSource, 'manual');
    assert.equal(stored.documents[0].filename, '87086_01.pdf');
    assert.equal(await readFile(path.join(noticeDir, '87086_01.pdf'), 'utf8'), 'pdf');
    const metadata = JSON.parse(await readFile(path.join(noticeDir, 'metadata.json'), 'utf8'));
    assert.equal(metadata.classification, 'software');
    assert.equal(metadata.classificationSource, 'manual');
    assert.equal(metadata.reviewed, true);
    assert.deepEqual(metadata.files, ['87086_01.pdf']);
    const reviewList = await readFile(path.join(outputDir, 'review.html'), 'utf8');
    assert.match(reviewList, /87086/);
    assert.match(reviewList, /manual/);

    const reviewed = await decideSavedNotice('87086', 'review', {
      outputDir,
      documentsRoot,
      reviewedAt: new Date('2026-09-26T03:00:00.000Z'),
    });
    assert.equal(reviewed.classification, 'review');
    assert.equal(reviewed.classificationSource, 'manual');
    assert.equal(reviewed.relevance.needsReview, true);
    assert.equal(reviewed.review.status, 'reviewed');

    const notRelevant = await fetch(`http://127.0.0.1:${port}/api/notices/87086/classification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 'not-relevant' }),
    });
    assert.equal(notRelevant.status, 200);
    assert.equal((await notRelevant.json()).classification, 'not relevant');
    assert.equal(await readFile(path.join(noticeDir, '87086_01.pdf'), 'utf8'), 'pdf');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('classification updates reject a missing notice, a bad value, and a bad id', async () => {
  const { directory, outputDir, documentsRoot } = await fixture();
  const server = await startApp(outputDir, documentsRoot);
  try {
    const port = server.address().port;
    const missing = await fetch(`http://127.0.0.1:${port}/api/notices/424242/classification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 'software' }),
    });
    assert.equal(missing.status, 404);

    const badValue = await fetch(`http://127.0.0.1:${port}/api/notices/87086/classification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 'hardware' }),
    });
    assert.equal(badValue.status, 400);

    const badId = await fetch(`http://127.0.0.1:${port}/api/notices/not-a-notice/classification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 'software' }),
    });
    assert.equal(badId.status, 400);

    const stored = JSON.parse(await readFile(path.join(outputDir, '87086.json'), 'utf8'));
    assert.equal(stored.classificationSource, 'automatic');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('the CLI --decide command reports a missing notice without writing', async () => {
  const missingId = '424242424242';
  assert.equal(existsSync(path.join(root, 'data', 'output', `${missingId}.json`)), false);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/index.js', '--decide', missingId, 'software'], {
      cwd: root,
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /No saved notice 424242424242/);
  assert.equal(existsSync(path.join(root, 'data', 'output', `${missingId}.json`)), false);
});
