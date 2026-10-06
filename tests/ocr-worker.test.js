import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupOcrWorker,
  createOcrRunState,
  isNearBlankCanvas,
  ocrPdfPages,
  ocrTimeoutError,
  ocrTimeoutMs,
  pageScale,
  recognizePdfPages,
  withOcrTimeout,
} from '../src/extraction/ocr.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settlesWithin(promise, ms, label) {
  let timedOut = false;
  const result = await Promise.race([
    promise.then(
      (value) => ({ kind: 'ok', value }),
      (error) => ({ kind: 'err', error }),
    ),
    delay(ms).then(() => {
      timedOut = true;
      return { kind: 'timeout' };
    }),
  ]);
  assert.equal(timedOut, false, `${label} remained pending longer than ${ms}ms`);
  return result;
}

function mockDocument(pageCount, { renderDelayMs = 0, onCleanup, blank = false } = {}) {
  const pages = [];
  return {
    numPages: pageCount,
    pages,
    async getPage() {
      const page = {
        cleanups: 0,
        getViewport({ scale }) {
          return { width: 100 * scale, height: 100 * scale };
        },
        render({ canvasContext, viewport }) {
          let cancelled = false;
          return {
            cancel() {
              cancelled = true;
            },
            promise: renderDelayMs
              ? new Promise((resolve, reject) => {
                setTimeout(() => {
                  if (cancelled) {
                    const error = new Error('Rendering cancelled');
                    error.name = 'RenderingCancelledException';
                    reject(error);
                    return;
                  }
                  if (!blank && canvasContext && viewport) {
                    canvasContext.fillStyle = '#000000';
                    canvasContext.fillRect(4, 4, Math.max(1, viewport.width - 8), Math.max(1, viewport.height - 8));
                  }
                  resolve();
                }, renderDelayMs);
              })
              : Promise.resolve().then(() => {
                if (!blank && canvasContext && viewport) {
                  canvasContext.fillStyle = '#000000';
                  canvasContext.fillRect(4, 4, Math.max(1, viewport.width - 8), Math.max(1, viewport.height - 8));
                }
              }),
          };
        },
        cleanup() {
          this.cleanups += 1;
          onCleanup?.(this);
        },
      };
      pages.push(page);
      return page;
    },
  };
}

function mockWorker({
  recognizeImpl,
  terminateImpl,
  recognizeDelayMs = 0,
} = {}) {
  const calls = {
    recognize: 0,
    terminate: 0,
    alive: true,
  };

  const worker = {
    async recognize(png) {
      calls.recognize += 1;
      if (!calls.alive) {
        throw new TypeError("Cannot read properties of null (reading 'postMessage')");
      }
      if (recognizeImpl) return recognizeImpl(png, calls);
      if (recognizeDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, recognizeDelayMs));
      }
      if (!calls.alive) {
        throw new TypeError("Cannot read properties of null (reading 'postMessage')");
      }
      return { data: { text: `page-${calls.recognize}` } };
    },
    async terminate() {
      calls.terminate += 1;
      calls.alive = false;
      if (terminateImpl) return terminateImpl(calls);
    },
  };

  return { worker, calls };
}

test('OCR succeeds normally across multiple pages', async () => {
  const { worker, calls } = mockWorker();
  const text = await ocrPdfPages(mockDocument(2), {
    timeoutMs: 2000,
    createWorker: async () => worker,
  });
  assert.match(text, /page-1/);
  assert.match(text, /page-2/);
  assert.equal(calls.recognize, 2);
  assert.equal(calls.terminate, 1);
  assert.equal(calls.alive, false);
});

test('OCR timeout returns a controlled timeout and cleans up the worker', async () => {
  const { worker, calls } = mockWorker({ recognizeDelayMs: 80 });
  await assert.rejects(
    () => ocrPdfPages(mockDocument(3), {
      timeoutMs: 25,
      createWorker: async () => worker,
    }),
    (error) => error.code === 'OCR_TIMEOUT',
  );
  assert.equal(calls.terminate, 1);
  assert.equal(calls.alive, false);
});

test('never-settling recognize after terminate still yields OCR_TIMEOUT in bounded time', async () => {
  const { worker, calls } = mockWorker({
    // Production failure: terminate does not settle recognize().
    recognizeImpl: () => new Promise(() => {}),
    terminateImpl: async () => {},
  });

  const started = Date.now();
  const settled = await settlesWithin(
    ocrPdfPages(mockDocument(3), {
      timeoutMs: 40,
      createWorker: async () => worker,
    }).then(
      () => {
        throw new Error('expected OCR_TIMEOUT');
      },
      (error) => error,
    ),
    500,
    'never-settling OCR timeout',
  );

  assert.equal(settled.kind, 'ok');
  assert.equal(settled.value.code, 'OCR_TIMEOUT');
  assert.ok(Date.now() - started < 500);
  assert.equal(calls.terminate, 1);
  assert.equal(calls.alive, false);
  // Only the page that was in recognize when timeout hit.
  assert.equal(calls.recognize, 1);
});

test('timeout cleanup does not await a permanently unresolved recognize Promise', async () => {
  const { worker, calls } = mockWorker({
    recognizeImpl: () => new Promise(() => {}),
  });

  const started = Date.now();
  await assert.rejects(
    () => ocrPdfPages(mockDocument(1), {
      timeoutMs: 30,
      createWorker: async () => worker,
    }),
    (error) => error.code === 'OCR_TIMEOUT',
  );

  assert.ok(Date.now() - started < 300, 'cleanup awaited unresolved recognize');
  assert.equal(calls.terminate, 1);
  assert.equal(calls.alive, false);
});

test('cleanupOcrWorker finishes even when inFlight never settles', async () => {
  const state = createOcrRunState();
  state.inFlight = new Promise(() => {});
  state.worker = {
    async terminate() {},
  };

  const settled = await settlesWithin(
    cleanupOcrWorker(state).then(() => 'done'),
    200,
    'cleanup with permanent inFlight',
  );
  assert.equal(settled.kind, 'ok');
  assert.equal(settled.value, 'done');
  assert.equal(state.worker, null);
  assert.equal(state.cleaned, true);
  assert.equal(state.cancel, true);

  // Second call remains idempotent and fast.
  const again = await settlesWithin(
    cleanupOcrWorker(state).then(() => 'again'),
    100,
    'idempotent cleanup',
  );
  assert.equal(again.kind, 'ok');
  assert.equal(again.value, 'again');
});

test('timeout while processing a multi-page PDF does not start the next page', async () => {
  let recognizeStarts = 0;
  const { worker, calls } = mockWorker({
    recognizeImpl: async () => {
      recognizeStarts += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { data: { text: 'slow' } };
    },
  });

  await assert.rejects(
    () => ocrPdfPages(mockDocument(4), {
      timeoutMs: 30,
      createWorker: async () => worker,
    }),
    (error) => error.code === 'OCR_TIMEOUT',
  );

  await delay(150);
  assert.equal(recognizeStarts, 1);
  assert.equal(calls.recognize, 1);
  assert.equal(calls.terminate, 1);
});

test('late recognize rejection after cancellation does not crash', async () => {
  let rejectRecognize;
  const { worker, calls } = mockWorker({
    recognizeImpl: () => new Promise((_, reject) => {
      rejectRecognize = reject;
    }),
  });

  await assert.rejects(
    () => ocrPdfPages(mockDocument(2), {
      timeoutMs: 30,
      createWorker: async () => worker,
    }),
    (error) => error.code === 'OCR_TIMEOUT',
  );

  rejectRecognize(new TypeError("Cannot read properties of null (reading 'postMessage')"));
  await delay(30);
  assert.equal(calls.terminate, 1);
});

test('late Tesseract rejection after timeout is sunk and does not become unhandled', async () => {
  let rejectRecognize;
  const { worker, calls } = mockWorker({
    recognizeImpl: () => new Promise((_, reject) => {
      rejectRecognize = reject;
    }),
  });

  await assert.rejects(
    () => ocrPdfPages(mockDocument(1), {
      timeoutMs: 25,
      createWorker: async () => worker,
    }),
    (error) => error.code === 'OCR_TIMEOUT',
  );

  let unhandled = null;
  const onUnhandled = (error) => {
    unhandled = error;
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    rejectRecognize(new Error('late tesseract failure'));
    await delay(40);
    assert.equal(unhandled, null);
    assert.equal(calls.terminate, 1);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('multi-page OCR cleans up each page and only accumulates text strings', async () => {
  const received = [];
  const { worker, calls } = mockWorker({
    recognizeImpl: async (png) => {
      received.push(png);
      return { data: { text: `page-text-${received.length}` } };
    },
  });
  const document = mockDocument(3);
  const text = await ocrPdfPages(document, {
    timeoutMs: 2000,
    createWorker: async () => worker,
  });

  assert.match(text, /page-text-1/);
  assert.match(text, /page-text-2/);
  assert.match(text, /page-text-3/);
  assert.equal(document.pages.length, 3);
  assert.ok(document.pages.every((page) => page.cleanups === 1));
  assert.equal(calls.terminate, 1);
  // Application result is joined text only — not an array of retained PNG buffers.
  assert.equal(typeof text, 'string');
  assert.equal(Buffer.isBuffer(text), false);
});

test('OCR run state does not retain image buffer fields after success or timeout', async () => {
  const successState = createOcrRunState();
  const { worker: successWorker } = mockWorker();
  await recognizePdfPages(mockDocument(2), successState, async () => successWorker);
  assert.equal(successState.worker, null);
  assert.equal(successState.inFlight, null);
  assert.ok(!('png' in successState));
  assert.ok(!('images' in successState));
  assert.ok(!('pageBuffers' in successState));

  const timeoutState = createOcrRunState();
  const { worker: timeoutWorker } = mockWorker({
    recognizeImpl: () => new Promise(() => {}),
  });
  await assert.rejects(
    () => withOcrTimeout(
      () => recognizePdfPages(mockDocument(1), timeoutState, async () => timeoutWorker),
      {
        timeoutMs: 25,
        onTimeout: () => cleanupOcrWorker(timeoutState),
      },
    ),
    (error) => error.code === 'OCR_TIMEOUT',
  );
  assert.equal(timeoutState.worker, null);
  assert.equal(timeoutState.inFlight, null);
  assert.ok(!('png' in timeoutState));
  assert.ok(!('images' in timeoutState));
});

test('repeated mock OCR runs terminate once per run and clean up every page', async () => {
  let terminateTotal = 0;
  let cleanupTotal = 0;
  const iterations = 15;

  for (let i = 0; i < iterations; i += 1) {
    const { worker, calls } = mockWorker();
    const document = mockDocument(2, {
      onCleanup: () => {
        cleanupTotal += 1;
      },
    });
    await ocrPdfPages(document, {
      timeoutMs: 2000,
      createWorker: async () => worker,
    });
    terminateTotal += calls.terminate;
    assert.equal(calls.terminate, 1);
  }

  assert.equal(terminateTotal, iterations);
  assert.equal(cleanupTotal, iterations * 2);
});

test('worker recognize rejection becomes a controlled failure the caller can treat as review', async () => {
  const { worker } = mockWorker({
    recognizeImpl: async () => {
      throw new Error('recognize failed');
    },
  });

  const text = await ocrPdfPages(mockDocument(1), {
    timeoutMs: 1000,
    createWorker: async () => worker,
  });
  assert.equal(text, '');
});

test('dead-worker postMessage errors after terminate become OCR_TIMEOUT', async () => {
  const state = createOcrRunState();
  const { worker, calls } = mockWorker({
    recognizeImpl: async () => {
      calls.alive = false;
      throw new TypeError("Cannot read properties of null (reading 'postMessage')");
    },
  });

  await assert.rejects(
    () => recognizePdfPages(mockDocument(2), state, async () => worker),
    (error) => error.code === 'OCR_TIMEOUT',
  );
  assert.equal(calls.terminate, 1);
});

test('terminate cleanup failure does not crash OCR cleanup', async () => {
  const state = createOcrRunState();
  state.worker = {
    async terminate() {
      throw new Error('terminate exploded');
    },
  };
  await cleanupOcrWorker(state);
  await cleanupOcrWorker(state);
  assert.equal(state.worker, null);
  assert.equal(state.cleaned, true);
  assert.equal(state.cancel, true);
});

test('withOcrTimeout sinks late task rejections after timeout so Node does not crash', async () => {
  let rejectLate;
  const late = new Promise((_, reject) => {
    rejectLate = reject;
  });

  await assert.rejects(
    () => withOcrTimeout(
      () => late,
      { timeoutMs: 20 },
    ),
    (error) => error.code === 'OCR_TIMEOUT',
  );

  rejectLate(new TypeError("Cannot read properties of null (reading 'postMessage')"));
  await delay(20);
});

test('cancellation gate lets recognize unwind without waiting for Tesseract', async () => {
  const state = createOcrRunState();
  const never = new Promise(() => {});
  state.worker = {
    recognize: () => never,
    async terminate() {},
  };

  const recognize = recognizePdfPages(
    mockDocument(1),
    state,
    async () => state.worker,
  );

  // Start recognize, then cancel via cleanup (as timeout would).
  await delay(10);
  const cleanup = cleanupOcrWorker(state);
  const cleanupResult = await settlesWithin(cleanup.then(() => 'cleaned'), 200, 'cancel cleanup');
  assert.equal(cleanupResult.kind, 'ok');
  assert.equal(cleanupResult.value, 'cleaned');

  const recognizeResult = await settlesWithin(
    recognize.then(
      () => ({ status: 'ok' }),
      (error) => ({ status: 'err', error }),
    ),
    200,
    'cancelled recognize',
  );
  assert.equal(recognizeResult.kind, 'ok');
  assert.equal(recognizeResult.value.status, 'err');
  assert.equal(recognizeResult.value.error.code, 'OCR_TIMEOUT');
});

test('default OCR timeout remains 15 seconds', () => {
  assert.equal(ocrTimeoutMs({}), 15000);
  const error = ocrTimeoutError(15000);
  assert.equal(error.code, 'OCR_TIMEOUT');
  assert.equal(error.timeoutMs, 15000);
});

test('pageScale downscales large pages instead of forcing scale >= 1', () => {
  assert.ok(pageScale(3000, 4000) < 1);
  assert.ok(pageScale(3000, 4000) * 4000 <= 1400 + 1);
  assert.ok(pageScale(400, 500) <= 1.25);
});

test('near-blank canvases are detected for skip', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const blank = createCanvas(200, 200);
  const blankCtx = blank.getContext('2d');
  blankCtx.fillStyle = '#ffffff';
  blankCtx.fillRect(0, 0, 200, 200);
  assert.equal(isNearBlankCanvas(blankCtx, 200, 200), true);

  const inked = createCanvas(200, 200);
  const inkedCtx = inked.getContext('2d');
  inkedCtx.fillStyle = '#ffffff';
  inkedCtx.fillRect(0, 0, 200, 200);
  inkedCtx.fillStyle = '#000000';
  inkedCtx.fillRect(20, 20, 80, 80);
  assert.equal(isNearBlankCanvas(inkedCtx, 200, 200), false);
});

test('blank OCR pages are skipped without calling recognize', async () => {
  const { worker, calls } = mockWorker();
  const text = await ocrPdfPages(mockDocument(2, { blank: true }), {
    timeoutMs: 2000,
    createWorker: async () => worker,
  });
  assert.equal(text, '');
  assert.equal(calls.recognize, 0);
  assert.equal(calls.terminate, 1);
});

test('progressive OCR stops once shouldContinue returns false', async () => {
  const { worker, calls } = mockWorker();
  const seen = [];
  const text = await ocrPdfPages(mockDocument(4), {
    timeoutMs: 2000,
    createWorker: async () => worker,
    shouldContinue: (soFar, pageNumber) => {
      seen.push(pageNumber);
      return pageNumber < 2;
    },
  });
  assert.match(text, /page-1/);
  assert.match(text, /page-2/);
  assert.equal(calls.recognize, 2);
  assert.deepEqual(seen, [1, 2]);
});

test('overall timeout after a completed page returns partial text', async () => {
  let recognizeStarts = 0;
  const { worker, calls } = mockWorker({
    recognizeImpl: async () => {
      recognizeStarts += 1;
      if (recognizeStarts === 1) return { data: { text: 'partial software license page' } };
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { data: { text: 'late page' } };
    },
  });

  const text = await ocrPdfPages(mockDocument(3), {
    timeoutMs: 120,
    pageTimeoutMs: 2000,
    createWorker: async () => worker,
  });
  assert.match(text, /partial software license page/);
  assert.equal(calls.terminate, 1);
  assert.ok(recognizeStarts >= 1);
});

test('page timeout with no text becomes OCR_TIMEOUT', async () => {
  const { worker, calls } = mockWorker({
    recognizeImpl: () => new Promise(() => {}),
  });
  await assert.rejects(
    () => ocrPdfPages(mockDocument(2), {
      timeoutMs: 2000,
      pageTimeoutMs: 40,
      createWorker: async () => worker,
    }),
    (error) => error.code === 'OCR_TIMEOUT',
  );
  assert.equal(calls.terminate, 1);
});

test('page timeout after partial text returns the completed pages', async () => {
  let recognizeStarts = 0;
  const { worker, calls } = mockWorker({
    recognizeImpl: async () => {
      recognizeStarts += 1;
      if (recognizeStarts === 1) return { data: { text: 'page one evidence' } };
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { data: { text: 'page two' } };
    },
  });
  const text = await ocrPdfPages(mockDocument(3), {
    timeoutMs: 5000,
    pageTimeoutMs: 80,
    createWorker: async () => worker,
  });
  assert.match(text, /page one evidence/);
  assert.equal(calls.terminate, 1);
});
