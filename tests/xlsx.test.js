import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { classifyText } from '../src/classification/relevance.js';
import { extractDocumentText } from '../src/extraction/extract.js';
import { extractXlsxText, workbookCellText } from '../src/extraction/xlsx.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

function workbookFromRows(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'RFQ');
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
