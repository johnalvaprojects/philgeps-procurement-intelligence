import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { classifyText } from '../src/classification/relevance.js';
import { extractDocumentText } from '../src/extraction/extract.js';
import {
  XLSX_MAX_CELLS,
  XLSX_MAX_COLS,
  XLSX_MAX_ROWS,
  XLSX_MAX_TEXT_CHARS,
  extractXlsxText,
  populatedSheetBounds,
  resolveSafeSheetRange,
  workbookCellText,
} from '../src/extraction/xlsx.js';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

function workbookFromRows(rows, sheetName = 'RFQ') {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return workbook;
}

function pathologicalInflatedWorkbook() {
  const sheet = {
    '!ref': 'A2:ALY1048569',
    A2: { t: 's', v: 'UPR Hall of Flags CMOC Admin Building' },
    B3: { t: 's', v: 'Software license subscription for mapping' },
    C4: { t: 's', v: 'Qty 1' },
  };
  const workbook = XLSX.utils.book_new();
  workbook.SheetNames = ['PhP315, 130.00'];
  workbook.Sheets = { 'PhP315, 130.00': sheet };
  return workbook;
}

test('workbookCellText keeps cell text from each sheet', () => {
  const workbook = workbookFromRows([
    ['Item', 'Description'],
    ['1', 'Software license for the mapping application'],
    ['', ''],
  ]);
  const text = workbookCellText(workbook);
  assert.match(text, /RFQ/);
  assert.match(text, /Software license for the mapping application/);
  assert.equal(text.includes('undefined'), false);
});

test('extractXlsxText reads an xlsx file without changing it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-xlsx-'));
  const filePath = path.join(directory, '1790349488_RFQ.xlsx');
  const workbook = workbookFromRows([
    ['Supply and Delivery of Mapping Software'],
    ['Software license'],
  ]);
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  await writeFile(filePath, bytes);

  try {
    const extracted = await extractXlsxText(filePath);
    const again = await extractDocumentText(filePath);
    const saved = await readFile(filePath);

    assert.equal(extracted.hasUsableText, true);
    assert.equal(extracted.usedOcr, false);
    assert.match(extracted.text, /Mapping Software/);
    assert.match(again.text, /Software license/);
    assert.deepEqual(saved, Buffer.from(bytes));
    assert.equal(classifyText(extracted.text, rules).category, 'software');
    assert.equal(filePath.includes(`${path.sep}data${path.sep}documents${path.sep}`), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an empty workbook does not count as readable text', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-xlsx-'));
  const filePath = path.join(directory, 'empty.xlsx');
  const workbook = workbookFromRows([['', ''], []]);
  await writeFile(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

  try {
    const extracted = await extractXlsxText(filePath);
    assert.equal(extracted.hasUsableText, false);
    assert.equal(extracted.text, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pathological inflated !ref extracts real cells quickly without densifying billions of cells', () => {
  const workbook = pathologicalInflatedWorkbook();
  const started = Date.now();
  const text = workbookCellText(workbook);
  const elapsedMs = Date.now() - started;

  assert.ok(elapsedMs < 1000, `extraction took too long: ${elapsedMs}ms`);
  assert.match(text, /Hall of Flags/);
  assert.match(text, /Software license subscription for mapping/);
  assert.match(text, /PhP315/);
  assert.ok(text.length <= XLSX_MAX_TEXT_CHARS);
  assert.equal(text.includes('undefined'), false);
});

test('safe range ignores pathological !ref and stays within extraction caps', () => {
  const sheet = pathologicalInflatedWorkbook().Sheets['PhP315, 130.00'];
  const bounds = populatedSheetBounds(sheet);
  const safe = resolveSafeSheetRange(sheet);

  assert.equal(bounds.populated, 3);
  assert.notEqual(safe.rangeText, 'A2:ALY1048569');
  assert.match(safe.rangeText, /^[A-Z]+\d+:[A-Z]+\d+$/);

  const rows = safe.range.e.r - safe.range.s.r + 1;
  const cols = safe.range.e.c - safe.range.s.c + 1;
  assert.ok(rows <= XLSX_MAX_ROWS);
  assert.ok(cols <= XLSX_MAX_COLS);
  assert.ok(rows * cols <= XLSX_MAX_CELLS);
  assert.ok(rows * cols < 1000, 'sparse real content should yield a tiny conversion window');
});

test('sheet_to_json receives an explicitly bounded range, not the pathological !ref', () => {
  const workbook = pathologicalInflatedWorkbook();
  const calls = [];

  workbookCellText(workbook, {
    sheetToJson: (sheet, options) => {
      calls.push(options);
      return XLSX.utils.sheet_to_json(sheet, options);
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].range, 'string');
  assert.notEqual(calls[0].range, 'A2:ALY1048569');
  assert.equal(Object.hasOwn(calls[0], 'defval'), false);

  const decoded = XLSX.utils.decode_range(calls[0].range);
  const cells = (decoded.e.r - decoded.s.r + 1) * (decoded.e.c - decoded.s.c + 1);
  assert.ok(cells <= XLSX_MAX_CELLS);
  assert.ok(cells < 1000);
});

test('large declared range with sparse cells does not emit millions of empty rows', () => {
  const sheet = {
    '!ref': 'A1:ZZ1000000',
    A1: { t: 's', v: 'Only' },
    B2: { t: 's', v: 'real' },
    C3: { t: 's', v: 'cells' },
  };
  const workbook = {
    SheetNames: ['Sparse'],
    Sheets: { Sparse: sheet },
  };

  const text = workbookCellText(workbook);
  const lines = text.split('\n').filter(Boolean);
  assert.ok(lines.length < 20, `unexpected line explosion: ${lines.length}`);
  assert.match(text, /Only/);
  assert.match(text, /real/);
  assert.match(text, /cells/);
  assert.equal(/\n{5,}/.test(text), false);
});

test('workbook with no useful cells returns empty text safely', () => {
  const workbook = {
    SheetNames: ['Empty'],
    Sheets: {
      Empty: {
        '!ref': 'A1:XFD1048576',
      },
    },
  };
  const text = workbookCellText(workbook);
  assert.equal(text, '');
  assert.equal(resolveSafeSheetRange(workbook.Sheets.Empty), null);
});

test('multiple sheets respect the overall extracted-text character cap', () => {
  const workbook = XLSX.utils.book_new();
  for (let i = 0; i < 5; i += 1) {
    const rows = Array.from({ length: 80 }, (_, row) => [
      `Sheet${i} row ${row} ${'software license subscription '.repeat(8)}`,
    ]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), `S${i}`);
  }

  const text = workbookCellText(workbook);
  assert.ok(text.length <= XLSX_MAX_TEXT_CHARS);
  assert.match(text, /S0/);
  assert.match(text, /software license subscription/);
});

test('absurdly spread sparse cells are clamped instead of densified', () => {
  const sheet = {
    '!ref': 'A1:ALY1048569',
    A1: { t: 's', v: 'near origin' },
    ALY1048569: { t: 's', v: 'far outlier that must not expand the dense window' },
  };
  const safe = resolveSafeSheetRange(sheet);
  const rows = safe.range.e.r - safe.range.s.r + 1;
  const cols = safe.range.e.c - safe.range.s.c + 1;
  assert.ok(rows <= XLSX_MAX_ROWS);
  assert.ok(cols <= XLSX_MAX_COLS);
  assert.ok(rows * cols <= XLSX_MAX_CELLS);

  const text = workbookCellText({
    SheetNames: ['Spread'],
    Sheets: { Spread: sheet },
  });
  assert.match(text, /near origin/);
  assert.ok(text.length <= XLSX_MAX_TEXT_CHARS);
});

test('local notice 86589 inspect.xlsx extracts safely when present', async (t) => {
  const candidates = [
    path.join(tmpdir(), 'philgeps-inspect-1NcFtC', 'inspect.xlsx'),
    path.join(tmpdir(), 'philgeps-inspect-LFY9js', 'inspect.xlsx'),
  ];
  const filePath = candidates.find((candidate) => existsSync(candidate));
  if (!filePath) {
    t.skip('local 86589 temp XLSX not present');
    return;
  }

  const before = process.memoryUsage();
  const started = Date.now();
  const extracted = await extractXlsxText(filePath);
  const elapsedMs = Date.now() - started;
  const after = process.memoryUsage();

  assert.ok(elapsedMs < 5000, `local extraction too slow: ${elapsedMs}ms`);
  assert.ok(extracted.text.length <= XLSX_MAX_TEXT_CHARS);
  assert.equal(typeof extracted.hasUsableText, 'boolean');
  assert.ok(after.heapUsed - before.heapUsed < 200 * 1024 * 1024, 'unexpected multi-hundred-MB spike');
  if (extracted.hasUsableText) {
    assert.match(extracted.text, /[A-Za-z]{3,}/);
  }
});
