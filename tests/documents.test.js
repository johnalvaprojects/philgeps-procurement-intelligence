import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { attachmentFileName, chooseOriginalFilename, fallbackAttachmentName, filenameFromContentDisposition, parseDocumentLinks, removeNoticeDownloads, removeTemporaryInspection, sanitizeAttachmentName, saveDocument, saveTemporaryInspection } from '../src/philgeps/documents.js';

const documentHtml = `
<table>
  <tr>
    <td>1</td>
    <td>
      <a target="_blank" href="https://philgeps.gov.ph/portal_documents/bid_notice_documents/bid_notice_85876/bid_notice_document/1790235684_313___Supply_and_Delivery_of_Mapping_Software___GSITD___WRMD.pdf">
        1790235684_313___Supply_and_Delivery_of_Mapping_Software___GSITD___WRMD.pdf
      </a>
    </td>
  </tr>
</table>
<a href="https://philgeps.gov.ph/Indexes/index">Bulletin Board</a>
`;

test('parseDocumentLinks keeps public procurement files only', () => {
  const documents = parseDocumentLinks(documentHtml);

  assert.equal(documents.length, 1);
  assert.equal(
    documents[0].filename,
    '1790235684_313___Supply_and_Delivery_of_Mapping_Software___GSITD___WRMD.pdf'
  );
  assert.equal(
    documents[0].url,
    'https://philgeps.gov.ph/portal_documents/bid_notice_documents/bid_notice_85876/bid_notice_document/1790235684_313___Supply_and_Delivery_of_Mapping_Software___GSITD___WRMD.pdf'
  );
  assert.equal(documents[0].localPath, null);
});

test('removeNoticeDownloads deletes a non-software notice folder and leaves other notices', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'philgeps-documents-'));
  const softwareDir = path.join(root, '85876');
  const otherDir = path.join(root, '86774');
  await mkdir(softwareDir, { recursive: true });
  await mkdir(otherDir, { recursive: true });
  await writeFile(path.join(otherDir, '86774.pdf'), 'temporary');
  await writeFile(path.join(otherDir, 'original-rfq.pdf'), 'older download');
  await writeFile(path.join(softwareDir, '85876.pdf'), 'software');

  const removed = await removeNoticeDownloads('86774', root);

  assert.equal(removed, true);
  assert.equal(existsSync(otherDir), false);
  assert.equal(existsSync(path.join(softwareDir, '85876.pdf')), true);
  assert.equal(await removeNoticeDownloads('86969', root), false);
});

test('a temporary inspection file is not stored in data/documents', async () => {
  const temporary = await saveTemporaryInspection('2026-RFQ-0313.pdf', Buffer.from('%PDF-1.7'));
  assert.equal(temporary.filePath.includes(`${path.sep}data${path.sep}documents${path.sep}`), false);
  assert.equal(existsSync(temporary.filePath), true);
  await removeTemporaryInspection(temporary.directory);
  assert.equal(existsSync(temporary.filePath), false);
});

test('downloaded attachments keep the original PhilGEPS filename', async () => {
  const usedNames = new Set();
  assert.equal(attachmentFileName('Request for Quotation.pdf', usedNames), 'Request for Quotation.pdf');
  assert.equal(attachmentFileName('Technical Specifications.pdf', usedNames), 'Technical Specifications.pdf');
  assert.equal(attachmentFileName('specs.PDF', usedNames), 'specs.PDF');
  assert.equal(sanitizeAttachmentName('folder/Terms: and Conditions?.pdf'), 'Terms_ and Conditions_.pdf');
  assert.equal(attachmentFileName('RFQ.pdf', usedNames), 'RFQ.pdf');
  assert.equal(attachmentFileName('RFQ.pdf', usedNames), 'RFQ_1.pdf');
  assert.equal(attachmentFileName('rfq.PDF', usedNames), 'rfq_2.PDF');

  const root = await mkdtemp(path.join(tmpdir(), 'philgeps-save-'));
  const names = new Set();
  const first = await saveDocument('86970', 'Request for Quotation.pdf', Buffer.from('first'), names, root);
  const second = await saveDocument('86970', 'Request for Quotation.pdf', Buffer.from('second'), names, root);
  const again = await saveDocument('86970', 'Request for Quotation.pdf', Buffer.from('third'), new Set(), root);

  assert.equal(first.savedName, 'Request for Quotation.pdf');
  assert.equal(first.localPath.endsWith('86970/Request for Quotation.pdf'), true);
  assert.equal(second.savedName, 'Request for Quotation_1.pdf');
  assert.equal(again.alreadySaved, true);
  assert.equal(await readFile(path.join(root, '86970', 'Request for Quotation.pdf'), 'utf8'), 'first');
  assert.equal(await readFile(path.join(root, '86970', 'Request for Quotation_1.pdf'), 'utf8'), 'second');
});

test('an available original PhilGEPS filename is preserved', () => {
  const name = '1790325785_PR_NO.__2026_07_071__RFQ_NO._2026_12_057___1page_.pdf';
  const chosen = chooseOriginalFilename({
    linkText: name,
    url: 'https://philgeps.gov.ph/portal_documents/download',
  });
  assert.equal(chosen, name);
  assert.equal(sanitizeAttachmentName(chosen), name);
  assert.notEqual(chosen, '86970_02.pdf');
});

test('duplicate original filenames get a numeric suffix', () => {
  const usedNames = new Set();
  assert.equal(attachmentFileName('RFQ.pdf', usedNames), 'RFQ.pdf');
  assert.equal(attachmentFileName('RFQ.pdf', usedNames), 'RFQ_1.pdf');
});

test('a missing original filename uses the notice fallback', () => {
  const chosen = chooseOriginalFilename({
    linkText: 'Download',
    contentDisposition: '',
    url: 'https://philgeps.gov.ph/portal_documents/download',
  });
  assert.equal(chosen, '');
  assert.equal(fallbackAttachmentName('86970', 1, '.pdf'), '86970_02.pdf');
  assert.equal(
    filenameFromContentDisposition("attachment; filename*=UTF-8''1790325785_PR_NO.pdf"),
    '1790325785_PR_NO.pdf',
  );
});

test('parseDocumentLinks turns a relative file link into a full URL', () => {
  const documents = parseDocumentLinks(
    '<a href="/portal_documents/bid_notice_documents/bid_notice_1/bid_notice_document/rfq.pdf">rfq.pdf</a>'
  );

  assert.equal(documents.length, 1);
  assert.equal(documents[0].filename, 'rfq.pdf');
  assert.equal(
    documents[0].url,
    'https://philgeps.gov.ph/portal_documents/bid_notice_documents/bid_notice_1/bid_notice_document/rfq.pdf'
  );
});
