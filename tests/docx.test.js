import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { classifyText } from '../src/classification/relevance.js';
import { extractDocumentText } from '../src/extraction/extract.js';
import { extractDocxText } from '../src/extraction/docx.js';
import { saveTemporaryInspection } from '../src/philgeps/documents.js';
import { inspectTemporaryFile } from '../src/process-notice.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function buildDocx(lines) {
  const body = lines.map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('a DOCX procurement is classified from its text and a bad file is reviewed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-docx-'));
  const softwarePath = path.join(directory, 'software.docx');
  const suppliesPath = path.join(directory, 'supplies.docx');
  const brokenPath = path.join(directory, 'broken.docx');
  try {
    await writeFile(softwarePath, await buildDocx([
      'Supply and Delivery of Productivity and Project Management Software',
    ]));
    await writeFile(suppliesPath, await buildDocx([
      'Supply of Electrical Equipment and Supplies',
      'Electrical Tape',
    ]));
    await writeFile(brokenPath, Buffer.from('this is not a docx'));

    const softwareText = await extractDocxText(softwarePath);
    const software = classifyText(softwareText.text, rules);
    assert.equal(softwareText.usedOcr, false);
    assert.equal(software.isRelevant, true);
    assert.equal(software.category, 'software');

    const suppliesText = await extractDocumentText(suppliesPath);
    const supplies = classifyText(suppliesText.text, rules);
    assert.equal(supplies.isRelevant, false);
    assert.equal(supplies.needsReview, false);

    await assert.rejects(() => extractDocxText(brokenPath), (error) => error.code === 'UNREADABLE_DOCUMENT');

    const temporary = await saveTemporaryInspection('broken.docx', Buffer.from('this is not a docx'));
    const inspection = await inspectTemporaryFile(temporary, '100', () => extractDocumentText(temporary.filePath));
    assert.equal(inspection.outcome, 'unclear');
    assert.equal(inspection.relevance.needsReview, true);
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(temporary.filePath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
