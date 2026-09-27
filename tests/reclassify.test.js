import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ocrTimeoutError } from '../src/extraction/ocr.js';
import { saveTemporaryInspection } from '../src/philgeps/documents.js';
import { inspectTemporaryFile } from '../src/process-notice.js';
import {
  applyAutomaticClassification,
  classifySavedDocument,
  firstExtractedSection,
  reclassifyNotice,
  runReclassify,
} from '../src/reclassify.js';
import { formatReclassifySummary } from '../src/review/summary.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

function packet(overrides = {}) {
  return {
    notice: {
      referenceNumber: '100',
      title: 'Supply and delivery of various requirements for the activity',
      postedDate: '25-Sep-2026 12:00 AM',
      organization: 'Example Agency',
      url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/100',
      ...overrides.notice,
    },
    documents: overrides.documents || [],
    relevance: {
      isRelevant: true,
      needsReview: false,
      category: 'software',
      reasons: ['old classification'],
    },
    requirements: { items: [{ name: 'keep this requirement' }] },
    procurementDocument: { productOrService: 'keep this notice' },
    review: { status: 'pending' },
    classification: 'software',
    agencyNote: 'keep',
    ...overrides,
    notice: {
      referenceNumber: '100',
      title: 'Supply and delivery of various requirements for the activity',
      postedDate: '25-Sep-2026 12:00 AM',
      organization: 'Example Agency',
      url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/100',
      ...overrides.notice,
    },
  };
}

function usable(text) {
  let body = text;
  while ((body.match(/[A-Za-z]/g) || []).length < 200) {
    body += ' Meals and snacks for the venue.';
  }
  return body;
}

function deps(extra = {}) {
  return {
    rules,
    hasLocalFiles: false,
    readSavedText: async () => null,
    inspectTemporary: async () => {
      throw new Error('inspection was not expected');
    },
    downloadAll: async () => {
      throw new Error('download was not expected');
    },
    ...extra,
  };
}

test('first extracted section is the saved text for that notice', () => {
  const text = firstExtractedSection('Source: first.pdf\n\nMeals for this notice\n\nSource: second.pdf\n\nArchitectural software subscription');
  assert.match(text, /Meals for this notice/);
  assert.doesNotMatch(text, /Architectural software/);
});

test('a manual classification is preserved', async () => {
  const saved = packet({
    classificationSource: 'manual',
    classification: 'review',
    reviewed: true,
  });
  const result = await reclassifyNotice(saved, deps());
  assert.equal(result.manual, true);
  assert.equal(result.reclassified, false);
  assert.equal(result.packet, saved);
  assert.equal(result.packet.classificationSource, 'manual');
  assert.equal(result.packet.classification, 'review');
});

test('old records with no classificationSource are treated as automatic', async () => {
  const saved = packet({
    notice: { title: 'Procurement of Various IT Equipment for PCSO Cebu Branch' },
  });
  delete saved.classificationSource;
  const result = await reclassifyNotice(saved, deps());
  assert.equal(result.reclassified, true);
  assert.equal(result.packet.classificationSource, 'automatic');
  assert.equal(result.packet.classification, 'not relevant');
  assert.equal(result.packet.isRelevant, undefined);
  assert.equal(result.packet.relevance.isRelevant, false);
  assert.equal(result.packet.requirements.items[0].name, 'keep this requirement');
  assert.equal(result.packet.agencyNote, 'keep');
  assert.deepEqual(result.packet.documents, []);
});

test('a clear not-relevant title does not download', async () => {
  let downloaded = false;
  const result = await reclassifyNotice(packet({
    notice: { title: 'Procurement of Various IT Equipment for PCSO Cebu Branch' },
    documents: [{ filename: 'keep.pdf', localPath: 'data/documents/100/keep.pdf' }],
  }), deps({
    downloadAll: async () => {
      downloaded = true;
      return [];
    },
  }));
  assert.equal(downloaded, false);
  assert.equal(result.fullDownload, false);
  assert.equal(result.packet.classification, 'not relevant');
  assert.equal(result.packet.documents[0].filename, 'keep.pdf');
});

test('a clear software title updates the classification and does not redownload existing files', async () => {
  let downloaded = false;
  const result = await reclassifyNotice(packet({
    notice: { title: 'Adobe Framemaker (1-year Subscription)' },
    classification: 'review',
    documents: [{ filename: 'rfq.pdf', localPath: 'data/documents/100/rfq.pdf' }],
  }), deps({
    hasLocalFiles: true,
    downloadAll: async () => {
      downloaded = true;
      return [];
    },
  }));
  assert.equal(downloaded, false);
  assert.equal(result.packet.classification, 'software');
  assert.equal(result.packet.classificationSource, 'automatic');
  assert.equal(result.packet.relevance.isRelevant, true);
  assert.equal(result.packet.documents[0].localPath, 'data/documents/100/rfq.pdf');
  assert.equal(result.packet.procurementDocument.productOrService, 'keep this notice');
});

test('a clear software title with no files downloads the full attachment set', async () => {
  let downloads = 0;
  const result = await reclassifyNotice(packet({
    notice: { title: 'Adobe Acrobat Pro (3-year subscription)' },
    classification: 'review',
  }), deps({
    downloadAll: async () => {
      downloads += 1;
      return [{ filename: 'rfq.pdf', localPath: 'data/documents/100/rfq.pdf', alreadySaved: false }];
    },
  }));
  assert.equal(downloads, 1);
  assert.equal(result.fullDownload, true);
  assert.equal(result.packet.classification, 'software');
  assert.equal(result.packet.documents.length, 1);
});

test('a vague title with saved text does not download', async () => {
  let inspected = 0;
  let downloaded = 0;
  const result = await reclassifyNotice(packet(), deps({
    readSavedText: async () => usable('All documented information printed from the Quality Management Information System (QMIS) are deemed uncontrolled.'),
    inspectTemporary: async () => {
      inspected += 1;
      return { outcome: 'unclear', relevance: packet().relevance };
    },
    downloadAll: async () => {
      downloaded += 1;
      return [];
    },
  }));
  assert.equal(inspected, 0);
  assert.equal(downloaded, 0);
  assert.equal(result.packet.classificationSource, 'automatic');
  assert.equal(result.packet.relevance.isRelevant, false);
  assert.notEqual(result.packet.classification, 'software');
});

test('a vague title without saved text inspects one temporary document and does not download when it is not software', async () => {
  let inspected = 0;
  let downloaded = 0;
  const result = await reclassifyNotice(packet(), deps({
    inspectTemporary: async () => {
      inspected += 1;
      return {
        outcome: 'unclear',
        inspectedFile: true,
        relevance: {
          isRelevant: false,
          needsReview: true,
          confidence: 0.3,
          category: 'unknown',
          reasons: ['No configured software or hardware terms were found.'],
        },
      };
    },
    downloadAll: async () => {
      downloaded += 1;
      return [];
    },
  }));
  assert.equal(inspected, 1);
  assert.equal(downloaded, 0);
  assert.equal(result.temporaryInspection, true);
  assert.equal(result.fullDownload, false);
  assert.equal(result.packet.classification, 'review');
  assert.equal(result.packet.classificationSource, 'automatic');
});

test('a software inspection downloads the full attachment set', async () => {
  let downloaded = 0;
  const result = await reclassifyNotice(packet(), deps({
    inspectTemporary: async () => ({
      outcome: 'software',
      inspectedFile: true,
      relevance: {
        isRelevant: true,
        needsReview: false,
        confidence: 0.75,
        category: 'software',
        reasons: ['The text includes "software".'],
      },
    }),
    downloadAll: async () => {
      downloaded += 1;
      return [{ filename: 'one.pdf', localPath: 'data/documents/100/one.pdf' }];
    },
  }));
  assert.equal(downloaded, 1);
  assert.equal(result.packet.classification, 'software');
  assert.equal(result.packet.documents[0].filename, 'one.pdf');
});

test('a non-software inspection does not download the full attachment set', async () => {
  let downloaded = 0;
  const result = await reclassifyNotice(packet(), deps({
    inspectTemporary: async () => ({
      outcome: 'skip',
      inspectedFile: true,
      relevance: {
        isRelevant: false,
        needsReview: false,
        confidence: 0.9,
        category: 'hardware',
        reasons: ['The text includes hardware term "laptop".'],
      },
    }),
    downloadAll: async () => {
      downloaded += 1;
      return [];
    },
  }));
  assert.equal(downloaded, 0);
  assert.equal(result.packet.classification, 'not relevant');
  assert.equal(result.packet.classificationSource, 'automatic');
});

test('an OCR timeout marks the notice for review and removes the temporary file', async () => {
  const temporary = await saveTemporaryInspection('scan.pdf', Buffer.from('scan'));
  const result = await reclassifyNotice(packet(), deps({
    inspectTemporary: () => inspectTemporaryFile(temporary, '100', async () => {
      throw ocrTimeoutError(15000);
    }),
  }));
  assert.equal(existsSync(temporary.directory), false);
  assert.equal(result.packet.classification, 'review');
  assert.equal(result.packet.classificationSource, 'automatic');
  assert.equal(result.temporaryInspection, true);
  assert.equal(result.fullDownload, false);
});

test('reclassify keeps existing files and metadata, refreshes the review list, and leaves a failed notice in place', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'philgeps-reclassify-'));
  const documentsRoot = await mkdtemp(path.join(tmpdir(), 'philgeps-reclassify-docs-'));
  try {
    const attachment = path.join(documentsRoot, '88', 'quote.pdf');
    await mkdir(path.dirname(attachment), { recursive: true });
    await writeFile(attachment, 'original-bytes');
    await mkdir(path.join(documentsRoot, '77'), { recursive: true });
    await writeFile(path.join(documentsRoot, '77', 'metadata.json'), `${JSON.stringify({
      noticeId: '77',
      title: 'Procurement of Various IT Equipment',
      classification: 'software',
      files: ['keep.pdf'],
      attachmentCount: 1,
      note: 'keep-me',
      downloadedAt: '2026-01-01T00:00:00.000Z',
    }, null, 2)}\n`);

    const manual = packet({
      classificationSource: 'manual',
      classification: 'review',
      notice: { referenceNumber: '61', title: 'Internet Subscription for OWWA Central Office (Secondary)' },
    });
    const manualBody = `${JSON.stringify(manual, null, 2)}\n`;
    await writeFile(path.join(outputDir, '61.json'), manualBody);

    const equipment = packet({
      notice: { referenceNumber: '77', title: 'Procurement of Various IT Equipment for PCSO Cebu Branch' },
    });
    delete equipment.classificationSource;
    await writeFile(path.join(outputDir, '77.json'), `${JSON.stringify(equipment, null, 2)}\n`);

    const software = packet({
      notice: { referenceNumber: '88', title: 'Adobe Framemaker (1-year Subscription)' },
      documents: [{ filename: 'quote.pdf', localPath: attachment }],
    });
    await writeFile(path.join(outputDir, '88.json'), `${JSON.stringify(software, null, 2)}\n`);

    const failing = packet({
      notice: { referenceNumber: '99', title: 'Supply and delivery of various requirements for the activity' },
    });
    const failingBody = `${JSON.stringify(failing, null, 2)}\n`;
    await writeFile(path.join(outputDir, '99.json'), failingBody);

    let refreshed = 0;
    let downloads = 0;
    const outcome = await runReclassify({
      outputDir,
      documentsRoot,
      rules,
      refreshReviewList: async () => {
        refreshed += 1;
      },
      readSavedText: async () => null,
      inspectTemporary: async () => {
        throw new Error('network down');
      },
      downloadAll: async () => {
        downloads += 1;
        return [];
      },
    });

    assert.equal(await readFile(path.join(outputDir, '61.json'), 'utf8'), manualBody);
    assert.equal(await readFile(attachment, 'utf8'), 'original-bytes');
    assert.equal(downloads, 0);
    const metadata = JSON.parse(await readFile(path.join(documentsRoot, '77', 'metadata.json'), 'utf8'));
    assert.equal(metadata.note, 'keep-me');
    assert.equal(metadata.downloadedAt, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(metadata.files, ['keep.pdf']);
    assert.equal(metadata.classification, 'not relevant');
    assert.equal(metadata.classificationSource, 'automatic');
    const equipmentSaved = JSON.parse(await readFile(path.join(outputDir, '77.json'), 'utf8'));
    assert.equal(equipmentSaved.classificationSource, 'automatic');
    assert.equal(equipmentSaved.requirements.items[0].name, 'keep this requirement');
    const softwareSaved = JSON.parse(await readFile(path.join(outputDir, '88.json'), 'utf8'));
    assert.equal(softwareSaved.classification, 'software');
    assert.equal(softwareSaved.classificationSource, 'automatic');
    assert.equal(softwareSaved.documents[0].localPath, attachment);
    assert.equal(await readFile(path.join(outputDir, '99.json'), 'utf8'), failingBody);
    assert.equal(existsSync(path.join(outputDir, '99.json')), true);
    assert.equal(refreshed, 1);
    assert.equal(outcome.counts.examined, 4);
    assert.equal(outcome.counts.manual, 1);
    assert.equal(outcome.counts.reclassified, 2);
    assert.equal(outcome.counts.errors, 1);
    assert.equal(outcome.counts.software, 1);
    assert.equal(outcome.counts.notRelevant, 1);
    assert.match(formatReclassifySummary(outcome), /Saved notices examined:\s+4/);
    assert.match(formatReclassifySummary(outcome), /Manual\/skipped:\s+1/);
    assert.match(formatReclassifySummary(outcome), /PHILGEPS RECLASSIFY SUMMARY/);
    const manualStat = await stat(path.join(outputDir, '61.json'));
    assert.equal(manualStat.size, Buffer.byteLength(manualBody));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(documentsRoot, { recursive: true, force: true });
  }
});

test('saved document text is classified without treating a later section as this notice', () => {
  const relevance = classifySavedDocument(
    usable('Source: meals.pdf\n\nMeals and snacks for the venue. Quality Management Information System appears in the footer only after this line is long enough.'),
    rules,
    'Supply and delivery of meals and snacks',
  );
  assert.equal(relevance.isRelevant, false);
  const updated = applyAutomaticClassification(packet(), relevance);
  assert.equal(updated.classificationSource, 'automatic');
  assert.notEqual(updated.classification, 'software');
});
