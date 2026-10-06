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

async function postScan(port, body) {
  const init = { method: 'POST' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/scan`, init);
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
    assert.equal(idle.body.running, false);

    const started = await postScan(port);
    assert.equal(started.status, 202);
    const active = await getStatus(port);
    assert.equal(active.status, 200);
    assert.equal(active.body.running, true);

    gate.resolve({ failed: false });
    await activeScan();
    assert.equal((await getStatus(port)).body.running, false);

    failGate = deferred();
    run = () => failGate.promise.then(() => {
      throw new Error('scan failed');
    });
    const failedStart = await postScan(port);
    assert.equal(failedStart.status, 202);
    assert.equal((await getStatus(port)).body.running, true);
    failGate.resolve();
    await activeScan();
    const afterFail = await getStatus(port);
    assert.equal(afterFail.body.running, false);
    assert.equal(afterFail.body.complete, false);
    assert.equal(afterFail.body.completionReason, 'error');
  } finally {
    gate.resolve();
    failGate?.resolve();
    await activeScan();
    console.log = originalLog;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/scan accepts a valid custom range and passes the window to runScan', async () => {
  const seen = [];
  const server = await startApp(async (options) => {
    seen.push(options);
    return { failed: false };
  });

  try {
    const port = server.address().port;
    const started = await postScan(port, { from: '2026-09-28', to: '2026-09-30' });
    assert.equal(started.status, 202);
    assert.deepEqual(started.body, {
      status: 'started',
      from: '2026-09-28',
      to: '2026-09-30',
    });
    await activeScan();
    assert.equal(seen.length, 1);
    assert.ok(seen[0].window);
    assert.equal(seen[0].window.start.getFullYear(), 2026);
    assert.equal(seen[0].window.start.getMonth(), 8);
    assert.equal(seen[0].window.start.getDate(), 28);
    assert.equal(seen[0].window.end.getDate(), 30);

    const sameDay = await postScan(port, { from: '2026-09-28', to: '2026-09-28' });
    assert.equal(sameDay.status, 202);
    await activeScan();
    assert.equal(seen[1].window.start.getDate(), 28);
    assert.equal(seen[1].window.end.getDate(), 28);
  } finally {
    await activeScan();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/scan with no range keeps default runScan options', async () => {
  const seen = [];
  const server = await startApp(async (options) => {
    seen.push(options);
    return { failed: false };
  });

  try {
    const port = server.address().port;
    const started = await postScan(port);
    assert.equal(started.status, 202);
    assert.deepEqual(started.body, { status: 'started' });
    await activeScan();
    assert.deepEqual(seen[0], {});
  } finally {
    await activeScan();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/scan rejects invalid custom ranges with 400', async () => {
  let calls = 0;
  const server = await startApp(async () => {
    calls += 1;
    return { failed: false };
  });

  try {
    const port = server.address().port;
    const cases = [
      { from: '2026-09-30', to: '2026-09-28' },
      { from: 'not-a-date', to: '2026-09-30' },
      { from: '2026-02-31', to: '2026-03-01' },
      { from: '2026-09-28' },
      { to: '2026-09-30' },
    ];

    for (const body of cases) {
      const response = await postScan(port, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(typeof response.body.error, 'string');
    }
    assert.equal(calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/scan still returns 409 while a custom-range scan is running', async () => {
  const gate = deferred();
  const server = await startApp(() => gate.promise);

  try {
    const port = server.address().port;
    const started = await postScan(port, { from: '2026-09-28', to: '2026-09-30' });
    assert.equal(started.status, 202);

    const status = await getStatus(port);
    assert.equal(status.body.running, true);
    assert.equal(status.body.from, '2026-09-28');
    assert.equal(status.body.to, '2026-09-30');

    const conflict = await postScan(port, { from: '2026-09-01', to: '2026-09-02' });
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { error: 'A scan is already running' });

    gate.resolve({ failed: false });
    await activeScan();
    assert.equal((await getStatus(port)).body.running, false);
  } finally {
    gate.resolve();
    await activeScan();
    await new Promise((resolve) => server.close(resolve));
  }
});
});
