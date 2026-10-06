import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { log } from '../log.js';
import { ocrPdfPages } from './ocr.js';

const require = createRequire(import.meta.url);

// pdf.js expects a file URL here. A Windows path is rejected.
GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;

const MIN_LETTERS = 200;

export function hasUsableText(text) {
  const letters = String(text ?? '').match(/[A-Za-z]/g);
  return (letters?.length ?? 0) >= MIN_LETTERS;
}

function itemsToLines(items) {
  let line = '';
  let lastY = null;
  let output = '';

  for (const item of items) {
    const y = item.transform ? item.transform[5] : null;
    if (lastY != null && y != null && Math.abs(y - lastY) > 2) {
      output += `${line.trimEnd()}\n`;
      line = '';
    }
    line += item.str;
    if (item.hasEOL) {
      output += `${line.trimEnd()}\n`;
      line = '';
    }
    lastY = y;
  }

  return output + line.trimEnd();
}

function releasePdfPage(page) {
  if (!page || typeof page.cleanup !== 'function') return;
  try {
    page.cleanup();
  } catch {
    // cleanup must never mask extraction errors
  }
}

async function destroyPdfDocument(document) {
  if (!document || typeof document.destroy !== 'function') return;
  try {
    await document.destroy();
  } catch {
    // cleanup must never mask extraction errors
  }
}

export async function extractPdfText(filePath, {
  getDocumentFn = getDocument,
  readFileFn = readFile,
  ocrPdfPagesFn = ocrPdfPages,
  ocrShouldContinue,
  ocrMode = 'classification',
  maxOcrPages,
} = {}) {
  const data = new Uint8Array(await readFileFn(filePath));
  let document;

  try {
    document = await getDocumentFn({ data, verbosity: 0 }).promise;
    const pageCount = document.numPages;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      let page;
      try {
        page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(itemsToLines(content.items));
      } finally {
        releasePdfPage(page);
      }
    }

    const directText = pages.join('\n');
    if (hasUsableText(directText)) {
      return {
        text: directText,
        pageCount,
        hasUsableText: true,
        usedOcr: false,
      };
    }

    log('INFO', 'PDF has no usable text. Running progressive OCR.');
    const ocrText = await ocrPdfPagesFn(document, {
      shouldContinue: typeof ocrShouldContinue === 'function' ? ocrShouldContinue : undefined,
      mode: ocrMode === 'extraction' ? 'extraction' : 'classification',
      maxPages: maxOcrPages,
    });
    return {
      text: ocrText,
      pageCount,
      hasUsableText: hasUsableText(ocrText),
      usedOcr: true,
    };
  } finally {
    await destroyPdfDocument(document);
  }
}
