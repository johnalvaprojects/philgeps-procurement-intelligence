import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPdfText, hasUsableText } from '../src/extraction/pdf.js';

function usablePageText() {
  return `${'software license subscription automation '.repeat(20)}\n`;
}

function createMockPdfDocument({
  pageCount = 2,
  pageText = usablePageText(),
  getPageImpl,
  destroyImpl,
} = {}) {
  const pages = [];
  const calls = {
    getPage: 0,
    cleanup: 0,
    destroy: 0,
  };

  const document = {
    numPages: pageCount,
    async getPage(pageNumber) {
      calls.getPage += 1;
      if (getPageImpl) return getPageImpl(pageNumber, calls);
      const page = {
        async getTextContent() {
          return {
            items: [{ str: pageText, transform: [1, 0, 0, 1, 0, 0], hasEOL: true }],
          };
        },
        cleanup() {
          calls.cleanup += 1;
          this.cleaned = true;
        },
      };
      pages.push(page);
      return page;
    },
    async destroy() {
      calls.destroy += 1;
      if (destroyImpl) return destroyImpl(calls);
    },
  };

  return { document, pages, calls };
}

test('PDF document.destroy is called after successful text extraction', async () => {
  const { document, calls } = createMockPdfDocument({ pageCount: 2 });

  const result = await extractPdfText('unused.pdf', {
    readFileFn: async () => Buffer.from('%PDF-mock'),
    getDocumentFn: () => ({ promise: Promise.resolve(document) }),
    ocrPdfPagesFn: async () => {
      throw new Error('OCR should not run when text is usable');
    },
  });

  assert.equal(result.usedOcr, false);
  assert.equal(result.hasUsableText, true);
  assert.ok(hasUsableText(result.text));
  assert.equal(calls.destroy, 1);
  assert.equal(calls.cleanup, 2);
  assert.equal(calls.getPage, 2);
});

test('PDF document.destroy is called when extraction throws', async () => {
  const { document, calls } = createMockPdfDocument({
    pageCount: 1,
    getPageImpl: async () => {
      throw new Error('getPage failed');
    },
  });

  await assert.rejects(
    () => extractPdfText('unused.pdf', {
      readFileFn: async () => Buffer.from('%PDF-mock'),
      getDocumentFn: () => ({ promise: Promise.resolve(document) }),
    }),
    /getPage failed/,
  );

  assert.equal(calls.destroy, 1);
});

test('PDF page.cleanup is called after each page is processed', async () => {
  const { document, pages, calls } = createMockPdfDocument({ pageCount: 3 });

  await extractPdfText('unused.pdf', {
    readFileFn: async () => Buffer.from('%PDF-mock'),
    getDocumentFn: () => ({ promise: Promise.resolve(document) }),
    ocrPdfPagesFn: async () => '',
  });

  assert.equal(calls.cleanup, 3);
  assert.ok(pages.every((page) => page.cleaned === true));
});

test('destroy failures do not replace the original extraction error', async () => {
  const { document, calls } = createMockPdfDocument({
    pageCount: 1,
    getPageImpl: async () => {
      throw new Error('original failure');
    },
    destroyImpl: async () => {
      throw new Error('destroy failed');
    },
  });

  await assert.rejects(
    () => extractPdfText('unused.pdf', {
      readFileFn: async () => Buffer.from('%PDF-mock'),
      getDocumentFn: () => ({ promise: Promise.resolve(document) }),
    }),
    (error) => error.message === 'original failure',
  );

  assert.equal(calls.destroy, 1);
});

test('document.destroy still runs after OCR path completes', async () => {
  const { document, calls } = createMockPdfDocument({
    pageCount: 1,
    pageText: 'abc', // not enough letters for usable text
  });

  let ocrSawDocument = false;
  const result = await extractPdfText('unused.pdf', {
    readFileFn: async () => Buffer.from('%PDF-mock'),
    getDocumentFn: () => ({ promise: Promise.resolve(document) }),
    ocrPdfPagesFn: async (doc) => {
      ocrSawDocument = doc === document;
      return `${'software license subscription automation '.repeat(20)}`;
    },
  });

  assert.equal(ocrSawDocument, true);
  assert.equal(result.usedOcr, true);
  assert.equal(calls.destroy, 1);
  assert.equal(calls.cleanup, 1);
});
