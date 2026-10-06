import { createCanvas } from '@napi-rs/canvas';
import { createWorker as defaultCreateWorker } from 'tesseract.js';
import { log } from '../log.js';

const DEFAULT_MAX_OCR_PAGES = 6;
/** Higher cap only for full-document requirement extraction (classification keeps the default). */
const EXTRACTION_MAX_OCR_PAGES = 20;
const DEFAULT_OCR_TIMEOUT_MS = 15000;
const DEFAULT_OCR_PAGE_TIMEOUT_MS = 8000;
/** Cap rendered longest edge so Tesseract is not fed multi-megapixel page images. */
const MAX_OCR_EDGE = 1400;
const MAX_OCR_SCALE = 1.25;
const MIN_OCR_SCALE = 0.35;
/** Near-white pages are skipped (sampled). */
const BLANK_PAGE_WHITE_RATIO = 0.992;

export function ocrTimeoutMs(env = process.env) {
  const raw = env.OCR_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === '') return DEFAULT_OCR_TIMEOUT_MS;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) return DEFAULT_OCR_TIMEOUT_MS;
  return number;
}

export function ocrPageTimeoutMs(env = process.env) {
  const raw = env.OCR_PAGE_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === '') {
    return Math.min(DEFAULT_OCR_PAGE_TIMEOUT_MS, ocrTimeoutMs(env));
  }
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) {
    return Math.min(DEFAULT_OCR_PAGE_TIMEOUT_MS, ocrTimeoutMs(env));
  }
  return number;
}

export function ocrTimeoutError(timeoutMs = ocrTimeoutMs()) {
  const error = new Error('OCR timed out');
  error.code = 'OCR_TIMEOUT';
  error.timeoutMs = timeoutMs;
  return error;
}

function ocrPageTimeoutError(timeoutMs = ocrPageTimeoutMs()) {
  const error = new Error('OCR page timed out');
  error.code = 'OCR_PAGE_TIMEOUT';
  error.timeoutMs = timeoutMs;
  return error;
}

function isDeadWorkerError(error) {
  const message = String(error?.message || error || '');
  return /postMessage/i.test(message) || /Cannot read properties of null/i.test(message);
}

function isRenderCancelledError(error) {
  const message = String(error?.message || error || '');
  const name = String(error?.name || '');
  return /cancel/i.test(message) || /RenderingCancelled/i.test(name);
}

function sinkPromise(promise) {
  if (!promise) return;
  Promise.resolve(promise).then(() => {}, () => {});
}

function releasePdfPage(page) {
  if (!page || typeof page.cleanup !== 'function') return;
  try {
    page.cleanup();
  } catch {
    // cleanup must never mask OCR errors
  }
}

export function createOcrRunState() {
  return {
    worker: null,
    cancel: false,
    inFlight: null,
    cancelRecognize: null,
    cancelRender: null,
    cleaned: false,
    pageTexts: [],
  };
}

/** Idempotent: cancel gate, sink in-flight recognize, terminate worker once. Never awaits Tesseract. */
export async function cleanupOcrWorker(state) {
  state.cancel = true;
  if (typeof state.cancelRender === 'function') {
    try {
      state.cancelRender();
    } catch {
      // ignore cancel failures
    }
    state.cancelRender = null;
  }
  if (typeof state.cancelRecognize === 'function') {
    try {
      state.cancelRecognize();
    } catch {
      // ignore double-reject
    }
    state.cancelRecognize = null;
  }

  if (state.cleaned) return;
  state.cleaned = true;

  const inFlight = state.inFlight;
  state.inFlight = null;
  const worker = state.worker;
  state.worker = null;

  // Late settlement must not become unhandled, but must not block cleanup.
  sinkPromise(inFlight);

  if (worker) {
    try {
      await worker.terminate();
    } catch {
      // terminate failures must not abort reclassify / scan
    }
  }
}

export async function withOcrTimeout(task, { timeoutMs = ocrTimeoutMs(), onTimeout } = {}) {
  const state = { timedOut: false };
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      state.timedOut = true;
      resolve(ocrTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  const work = Promise.resolve().then(task).then(
    (value) => ({ value }),
    (error) => {
      if (state.timedOut) return { ignored: true };
      throw error;
    },
  );

  try {
    const winner = await Promise.race([
      work.then((result) => ({ kind: 'work', result })),
      timeout.then((error) => ({ kind: 'timeout', error })),
    ]);

    if (winner.kind === 'timeout') {
      // Keep listening so a late task rejection cannot become unhandled.
      work.then(() => {}, () => {});
      await Promise.resolve(onTimeout?.()).catch(() => {});
      throw winner.error;
    }
    if (winner.result.ignored) throw ocrTimeoutError(timeoutMs);
    return winner.result.value;
  } finally {
    clearTimeout(timer);
  }
}

/** Allow downscaling large PDF pages (do not force scale >= 1). */
export function pageScale(width, height) {
  const longestSide = Math.max(width, height) || 1;
  const scale = Math.min(MAX_OCR_SCALE, MAX_OCR_EDGE / longestSide);
  return Math.max(MIN_OCR_SCALE, scale);
}

/** Sample canvas pixels; near-blank pages are skipped before Tesseract. */
export function isNearBlankCanvas(context, width, height) {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  if (w < 2 || h < 2) return true;
  const stepX = Math.max(1, Math.floor(w / 48));
  const stepY = Math.max(1, Math.floor(h / 48));
  let samples = 0;
  let white = 0;
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const pixel = context.getImageData(x, y, 1, 1).data;
      samples += 1;
      if (pixel[0] >= 250 && pixel[1] >= 250 && pixel[2] >= 250) white += 1;
    }
  }
  if (samples === 0) return true;
  return white / samples >= BLANK_PAGE_WHITE_RATIO;
}

function toGrayscalePng(sourceCanvas) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  ctx.putImageData(image, 0, 0);
  return out.toBuffer('image/png');
}

async function pageToPng(page, state) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: pageScale(base.width, base.height) });
  let canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({ canvasContext: context, viewport });
  if (state) {
    state.cancelRender = () => {
      try {
        renderTask.cancel?.();
      } catch {
        // ignore
      }
    };
  }

  try {
    if (state?.cancel) throw ocrTimeoutError();
    await renderTask.promise;
    if (state?.cancel) throw ocrTimeoutError();
    if (isNearBlankCanvas(context, canvas.width, canvas.height)) {
      return { blank: true, png: null };
    }
    return { blank: false, png: toGrayscalePng(canvas) };
  } catch (error) {
    try {
      renderTask.cancel?.();
    } catch {
      // ignore
    }
    if (state?.cancel || error?.code === 'OCR_TIMEOUT' || isDeadWorkerError(error) || isRenderCancelledError(error)) {
      throw ocrTimeoutError();
    }
    throw error;
  } finally {
    if (state && state.cancelRender) state.cancelRender = null;
    canvas = null;
  }
}

async function recognizeWithWorker(state, png) {
  if (state.cancel || !state.worker) throw ocrTimeoutError();
  const worker = state.worker;
  // Const binding for the in-flight job only. Do not null this while recognize
  // may still start — that would race the worker. Callers drop their own refs;
  // Tesseract may still retain the buffer if recognize() never settles.
  const imageForWorker = png;

  let rejectCancel;
  const cancelGate = new Promise((_, reject) => {
    rejectCancel = reject;
  });
  state.cancelRecognize = () => {
    rejectCancel(ocrTimeoutError());
  };

  const job = Promise.resolve().then(() => worker.recognize(imageForWorker));
  state.inFlight = job;
  // Always sink the raw Tesseract promise so a late reject after we abandon it is safe.
  sinkPromise(job);

  try {
    const result = await Promise.race([job, cancelGate]);
    if (state.cancel || !state.worker) throw ocrTimeoutError();
    return result;
  } catch (error) {
    if (state.cancel || error?.code === 'OCR_TIMEOUT' || isDeadWorkerError(error)) {
      throw ocrTimeoutError();
    }
    throw error;
  } finally {
    state.cancelRecognize = null;
    if (state.inFlight === job) state.inFlight = null;
  }
}

async function runWithPageTimeout(work, pageTimeoutMs, state) {
  let timer;
  let timedOut = false;
  const workPromise = Promise.resolve()
    .then(work)
    .then(
      (value) => ({ kind: 'work', value }),
      (error) => ({ kind: 'work-error', error }),
    );

  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        state.cancelRender?.();
      } catch {
        // ignore
      }
      // Abandon the page job without flipping the whole-run cancel gate to OCR_TIMEOUT.
      if (state.inFlight) {
        sinkPromise(state.inFlight);
        state.inFlight = null;
      }
      state.cancelRecognize = null;
      resolve({ kind: 'timeout', error: ocrPageTimeoutError(pageTimeoutMs) });
    }, pageTimeoutMs);
  });

  try {
    const winner = await Promise.race([workPromise, timeoutPromise]);
    if (winner.kind === 'timeout') {
      // Late page settlement must not become unhandled.
      workPromise.then(() => {}, () => {});
      throw winner.error;
    }
    if (timedOut) throw ocrPageTimeoutError(pageTimeoutMs);
    if (winner.kind === 'work-error') throw winner.error;
    return winner.value;
  } finally {
    clearTimeout(timer);
  }
}

export function maxOcrPagesForMode(mode = 'classification') {
  return mode === 'extraction' ? EXTRACTION_MAX_OCR_PAGES : DEFAULT_MAX_OCR_PAGES;
}

export async function recognizePdfPages(document, state, createWorker = defaultCreateWorker, {
  shouldContinue,
  pageTimeoutMs = ocrPageTimeoutMs(),
  maxPages = DEFAULT_MAX_OCR_PAGES,
} = {}) {
  const pageLimit = Number.isInteger(maxPages) && maxPages > 0 ? maxPages : DEFAULT_MAX_OCR_PAGES;
  const pageCount = Math.min(document.numPages, pageLimit);
  if (document.numPages > pageLimit) {
    log('INFO', `OCR will read up to ${pageLimit} of ${document.numPages} pages`);
  }

  if (state.cancel) throw ocrTimeoutError();
  state.worker = await createWorker('eng');
  if (state.cancel) throw ocrTimeoutError();

  // Text only — never accumulate rendered page image buffers here.
  state.pageTexts = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (state.cancel || !state.worker) throw ocrTimeoutError();
      log('INFO', `Reading scanned page ${pageNumber} of ${pageCount}`);

      let page = null;
      let png = null;
      try {
        await runWithPageTimeout(async () => {
          page = await document.getPage(pageNumber);
          if (state.cancel || !state.worker) throw ocrTimeoutError();
          const rendered = await pageToPng(page, state);
          releasePdfPage(page);
          page = null;
          if (rendered.blank) {
            log('INFO', `Skipping near-blank OCR page ${pageNumber}`);
            return;
          }
          png = rendered.png;
          if (state.cancel || !state.worker) throw ocrTimeoutError();
          const result = await recognizeWithWorker(state, png);
          png = null;
          state.pageTexts.push(result.data?.text || '');
        }, pageTimeoutMs, state);
      } catch (error) {
        if (error?.code === 'OCR_PAGE_TIMEOUT') {
          log('WARN', `OCR page ${pageNumber} timed out after ${Math.round(pageTimeoutMs / 1000)}s; keeping partial text`);
          if (state.pageTexts.length === 0) {
            throw ocrTimeoutError();
          }
          break;
        }
        if (state.cancel || error?.code === 'OCR_TIMEOUT' || isDeadWorkerError(error)) {
          throw ocrTimeoutError();
        }
        log('ERROR', `Could not read scanned page ${pageNumber}: ${error.message}`);
      } finally {
        png = null;
        releasePdfPage(page);
        page = null;
      }

      const soFar = state.pageTexts.join('\n');
      if (typeof shouldContinue === 'function') {
        let keepGoing = true;
        try {
          keepGoing = shouldContinue(soFar, pageNumber) !== false;
        } catch (error) {
          log('WARN', `OCR early-stop check failed: ${error.message}`);
          keepGoing = true;
        }
        if (!keepGoing) {
          log('INFO', `Stopped OCR after page ${pageNumber}; enough classification evidence`);
          break;
        }
      }
    }
    if (state.cancel || !state.worker) throw ocrTimeoutError();
  } finally {
    await cleanupOcrWorker(state);
  }

  return state.pageTexts.join('\n');
}

function partialOcrText(state) {
  const parts = Array.isArray(state?.pageTexts) ? state.pageTexts : [];
  return parts.join('\n');
}

export async function ocrPdfPages(document, {
  timeoutMs = ocrTimeoutMs(),
  pageTimeoutMs = ocrPageTimeoutMs(),
  createWorker = defaultCreateWorker,
  shouldContinue,
  maxPages = DEFAULT_MAX_OCR_PAGES,
  mode = 'classification',
} = {}) {
  const state = createOcrRunState();
  const pageLimit = maxPages == null
    ? (mode === 'extraction' ? EXTRACTION_MAX_OCR_PAGES : DEFAULT_MAX_OCR_PAGES)
    : maxPages;

  try {
    return await withOcrTimeout(
      () => recognizePdfPages(document, state, createWorker, {
        shouldContinue,
        pageTimeoutMs,
        maxPages: pageLimit,
      }),
      {
        timeoutMs,
        onTimeout: () => cleanupOcrWorker(state),
      },
    );
  } catch (error) {
    if (error?.code === 'OCR_TIMEOUT') {
      const partial = partialOcrText(state).trim();
      if (partial) {
        log(
          'WARN',
          `OCR timed out after ${Math.round(timeoutMs / 1000)}s; using partial text from ${state.pageTexts.length} page(s)`,
        );
        return partialOcrText(state);
      }
    }
    throw error;
  }
}
