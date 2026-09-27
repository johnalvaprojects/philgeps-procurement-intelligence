import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { activeScan } from '../src/server/controllers/scan-controller.js';
import scanRoutes from '../src/server/routes/scan-routes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function startApp(run) {
  const app = express();
  app.use(express.json());
  app.set('runScan', run);
  app.use('/api/scan', scanRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function postScan(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/scan`, { method: 'POST' });
  return { status: response.status, body: await response.json() };
}

async function getStatus(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/scan/status`);
  return { status: response.status, body: await response.json() };
}

test('CLI --scan and POST /api/scan share runScan', () => {
  const indexSource = readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
  const scanSource = readFileSync(path.join(root, 'src', 'scan.js'), 'utf8');
  const controllerSource = readFileSync(path.join(root, 'src', 'server', 'controllers', 'scan-controller.js'), 'utf8');

  assert.match(indexSource, /import \{ processCollectedNotices, runScan, writeReviewList \} from '\.\/scan\.js'/);
  assert.match(indexSource, /runScan\(\)/);
  assert.doesNotMatch(indexSource, /function runScan\(/);
  assert.match(indexSource, /if \(result\.failed\) process\.exitCode = 1/);
  assert.match(controllerSource, /import \{ runScan \} from "\.\.\/\.\.\/scan\.js"/);
  assert.match(controllerSource, /req\.app\.get\("runScan"\) \|\| runScan/);
  assert.match(scanSource, /export async function runScan\(/);
  assert.doesNotMatch(scanSource, /process\.argv/);
  assert.doesNotMatch(scanSource, /process\.exitCode/);
  assert.doesNotMatch(scanSource, /process\.exit\(/);
});

describe('scan API lock', { concurrency: false }, () => {
test('POST /api/scan starts one scan and releases the lock', async () => {
  const gate = deferred();
  let run = () => {
    calls += 1;
    return gate.promise;
  };
  let calls = 0;
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  const logged = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logged.push(args.join(' '));
  };
  process.on('unhandledRejection', onUnhandled);
  const server = await startApp(() => run());

  try {
    const port = server.address().port;
    const started = await postScan(port);
    assert.equal(started.status, 202);
    assert.deepEqual(started.body, { status: 'started' });
    assert.equal(calls, 1);

    const conflict = await postScan(port);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { error: 'A scan is already running' });
    assert.equal(calls, 1);

    gate.resolve({ failed: false });
    await activeScan();
    const again = await postScan(port);
    assert.equal(again.status, 202);
    assert.equal(calls, 2);
    await activeScan();

    run = async () => {
      calls += 1;
      throw new Error('scan failed');
    };
    const failedStart = await postScan(port);
    assert.equal(failedStart.status, 202);
    await activeScan();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(unhandled.length, 0);
    assert.equal(server.listening, true);
    assert.ok(logged.some((line) => line.includes('[ERROR] scan failed')));

    const afterFailure = await postScan(port);
    assert.equal(afterFailure.status, 202);
    await activeScan();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(unhandled.length, 0);
    assert.equal(server.listening, true);
  } finally {
    gate.resolve();
    await activeScan();
    process.off('unhandledRejection', onUnhandled);
    console.log = originalLog;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/scan/status reads the existing running flag', async () => {
  const gate = deferred();
  let failGate;
  let run = () => gate.promise;
  const originalLog = console.log;
  console.log = () => {};
  const server = await startApp(() => run());

  try {
    const port = server.address().port;
    const idle = await getStatus(port);
    assert.equal(idle.status, 200);
    assert.deepEqual(idle.body, { running: false });

    const started = await postScan(port);
    assert.equal(started.status, 202);
    const active = await getStatus(port);
    assert.equal(active.status, 200);
    assert.deepEqual(active.body, { running: true });

    gate.resolve({ failed: false });
    await activeScan();
    assert.deepEqual((await getStatus(port)).body, { running: false });

    failGate = deferred();
    run = () => failGate.promise.then(() => {
      throw new Error('scan failed');
    });
    const failedStart = await postScan(port);
    assert.equal(failedStart.status, 202);
    assert.deepEqual((await getStatus(port)).body, { running: true });
    failGate.resolve();
    await activeScan();
    assert.deepEqual((await getStatus(port)).body, { running: false });
  } finally {
    gate.resolve();
    failGate?.resolve();
    await activeScan();
    console.log = originalLog;
    await new Promise((resolve) => server.close(resolve));
  }
});
});
