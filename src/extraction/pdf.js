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

export async function extractPdfText(filePath) {
  const data = new Uint8Array(await readFile(filePath));
  const document = await getDocument({ data, verbosity: 0 }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items));
  }

  const directText = pages.join('\n');
  if (hasUsableText(directText)) {
    return {
      text: directText,
      pageCount: document.numPages,
      hasUsableText: true,
      usedOcr: false,
    };
  }

  log('INFO', 'PDF has no usable text. Running OCR.');
  const ocrText = await ocrPdfPages(document);
  return {
    text: ocrText,
    pageCount: document.numPages,
    hasUsableText: hasUsableText(ocrText),
    usedOcr: true,
  };
}
