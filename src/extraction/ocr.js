import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { log } from '../log.js';

const MAX_OCR_PAGES = 6;
const DEFAULT_OCR_TIMEOUT_MS = 15000;

export function ocrTimeoutMs(env = process.env) {
  const raw = env.OCR_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === '') return DEFAULT_OCR_TIMEOUT_MS;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) return DEFAULT_OCR_TIMEOUT_MS;
  return number;
}

export function ocrTimeoutError(timeoutMs = ocrTimeoutMs()) {
  const error = new Error('OCR timed out');
  error.code = 'OCR_TIMEOUT';
  error.timeoutMs = timeoutMs;
  return error;
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
      await Promise.resolve(onTimeout?.()).catch(() => {});
      throw winner.error;
    }
    if (winner.result.ignored) throw ocrTimeoutError(timeoutMs);
    return winner.result.value;
  } finally {
    clearTimeout(timer);
  }
}

function pageScale(width, height) {
  const longestSide = Math.max(width, height);
  return Math.min(2, 2200 / longestSide);
}

async function pageToPng(page) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.max(1, pageScale(base.width, base.height)) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toBuffer('image/png');
}

async function recognizePdfPages(document, state) {
  const pageCount = Math.min(document.numPages, MAX_OCR_PAGES);
  if (document.numPages > MAX_OCR_PAGES) {
    log('INFO', `OCR will read the first ${MAX_OCR_PAGES} of ${document.numPages} pages`);
  }

  state.worker = await createWorker('eng');
  if (state.cancel) throw ocrTimeoutError();
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (state.cancel) throw ocrTimeoutError();
      log('INFO', `Reading scanned page ${pageNumber} of ${pageCount}`);
      try {
        const page = await document.getPage(pageNumber);
        const png = await pageToPng(page);
        const result = await state.worker.recognize(png);
        pages.push(result.data.text || '');
      } catch (error) {
        if (state.cancel || error.code === 'OCR_TIMEOUT') throw ocrTimeoutError();
        log('ERROR', `Could not read scanned page ${pageNumber}: ${error.message}`);
      }
    }
    if (state.cancel) throw ocrTimeoutError();
  } finally {
    if (state.worker) {
      await state.worker.terminate().catch(() => {});
      state.worker = null;
    }
  }

  return pages.join('\n');
}

export async function ocrPdfPages(document, { timeoutMs = ocrTimeoutMs() } = {}) {
  const state = { worker: null, cancel: false };

  return withOcrTimeout(() => recognizePdfPages(document, state), {
    timeoutMs,
    onTimeout: async () => {
      state.cancel = true;
      if (state.worker) await state.worker.terminate().catch(() => {});
    },
  });
}
