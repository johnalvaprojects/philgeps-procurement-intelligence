import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  planTitleReclassify,
  runTitleReclassify,
  storedClassification,
} from '../src/reclassify-title.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));
const moduleSource = readFileSync(path.join(root, 'src', 'reclassify-title.js'), 'utf8');

function packet(overrides = {}) {
  return {
    notice: {
      referenceNumber: '100',
      title: 'Supply and delivery of various requirements for the activity',
      postedDate: '25-Sep-2026 12:00 AM',
      organization: 'Example Agency',
      url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/100',
      approvedBudget: '100000',
      ...overrides.notice,
    },
    documents: overrides.documents || [{ filename: 'keep.pdf', localPath: 'data/documents/100/keep.pdf' }],
    relevance: {
      isRelevant: false,
      needsReview: true,
      category: 'unknown',
      reasons: ['old review reason'],
      ...(overrides.relevance || {}),
    },
    requirements: { items: [{ name: 'keep this requirement' }] },
    procurementDocument: { productOrService: 'keep this notice' },
    agencyNote: 'keep agency note',
    review: { status: 'pending' },
    classification: 'review',
    classificationSource: 'automatic',
    ...overrides,
    notice: {
      referenceNumber: '100',
      title: 'Supply and delivery of various requirements for the activity',
      postedDate: '25-Sep-2026 12:00 AM',
      organization: 'Example Agency',
      url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/100',
      approvedBudget: '100000',
      ...overrides.notice,
    },
  };
}

async function withFixture(files, run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'philgeps-title-reclass-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      await writeFile(path.join(directory, name), `${JSON.stringify(body, null, 2)}\n`);
    }
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('title-only module structurally avoids PhilGEPS inspection and extraction imports', () => {
  assert.equal(moduleSource.includes("from './reclassify.js'"), false);
  assert.equal(moduleSource.includes("from './process-notice.js'"), false);
  assert.equal(moduleSource.includes("from './philgeps/client.js'"), false);
  assert.equal(moduleSource.includes('confirmVagueNotice'), false);
  assert.equal(moduleSource.includes('inspectTemporary'), false);
  assert.equal(moduleSource.includes('downloadAllAttachments'), false);
  assert.equal(moduleSource.includes("from './extraction/"), false);
  assert.equal(moduleSource.includes('ocrPdfPages'), false);
});

test('clear Review title becomes Software', () => {
  const plan = planTitleReclassify(packet({
    notice: { title: 'PROCUREMENT OF VIDEO EDITING SOFTWARE' },
    classification: 'review',
  }), rules);
  assert.equal(plan.action, 'update');
  assert.equal(plan.from, 'review');
  assert.equal(plan.to, 'software');
  assert.equal(plan.packet.classification, 'software');
  assert.equal(plan.packet.classificationSource, 'automatic');
  assert.equal(plan.packet.relevance.isRelevant, true);
  assert.equal(plan.packet.agencyNote, 'keep agency note');
  assert.equal(plan.packet.requirements.items[0].name, 'keep this requirement');
});

test('clear Review title becomes Not Relevant', () => {
  const plan = planTitleReclassify(packet({
    notice: { title: 'Repair and Maintenance of Staff House 2 for 4th Quarter CY-2026' },
    classification: 'review',
  }), rules);
  assert.equal(plan.action, 'update');
  assert.equal(plan.from, 'review');
  assert.equal(plan.to, 'not relevant');
  assert.equal(plan.packet.classification, 'not relevant');
  assert.equal(plan.packet.classificationSource, 'automatic');
  assert.equal(plan.packet.relevance.needsReview, false);
});

test('ambiguous Review remains unchanged', () => {
  const saved = packet({
    notice: { title: 'Supply and Delivery of IT Solution' },
    classification: 'review',
    relevance: {
      isRelevant: false,
      needsReview: true,
      category: 'unknown',
      reasons: ['No configured software or hardware terms were found.'],
    },
  });
  const plan = planTitleReclassify(saved, rules);
  assert.equal(plan.action, 'keep');
  assert.equal(plan.to, 'review');
  assert.equal(plan.packet, saved);
  assert.deepEqual(plan.packet.relevance.reasons, saved.relevance.reasons);
});

test('ambiguous existing Software remains Software', () => {
  const saved = packet({
    notice: { title: 'Supply and Delivery of IT Solution' },
    classification: 'software',
    relevance: {
      isRelevant: true,
      needsReview: false,
      category: 'software',
      reasons: ['document evidence software'],
    },
  });
  const plan = planTitleReclassify(saved, rules);
  assert.equal(plan.action, 'keep');
  assert.equal(storedClassification(plan.packet), 'software');
  assert.equal(plan.packet.relevance.reasons[0], 'document evidence software');
});

test('ambiguous existing Not Relevant remains Not Relevant', () => {
  const saved = packet({
    notice: { title: 'Supply and Delivery of IT Solution' },
    classification: 'not relevant',
    relevance: {
      isRelevant: false,
      needsReview: false,
      category: 'hardware',
      reasons: ['document evidence not relevant'],
    },
  });
  const plan = planTitleReclassify(saved, rules);
  assert.equal(plan.action, 'keep');
  assert.equal(storedClassification(plan.packet), 'not relevant');
  assert.equal(plan.packet.relevance.reasons[0], 'document evidence not relevant');
});

test('manual classifications remain untouched', () => {
  for (const classification of ['software', 'review', 'not relevant']) {
    const saved = packet({
      notice: { title: 'PROCUREMENT OF VIDEO EDITING SOFTWARE' },
      classification,
      classificationSource: 'manual',
      relevance: {
        isRelevant: classification === 'software',
        needsReview: classification === 'review',
        category: classification === 'not relevant' ? 'hardware' : classification === 'software' ? 'software' : 'unknown',
        reasons: ['A person marked this notice.'],
      },
    });
    const plan = planTitleReclassify(saved, rules);
    assert.equal(plan.action, 'skip-manual', classification);
    assert.equal(plan.packet, saved, classification);
    assert.equal(plan.packet.classificationSource, 'manual', classification);
    assert.equal(plan.packet.classification, classification, classification);
  }
});

test('dry-run modifies no JSON files', async () => {
  await withFixture({
    '87918.json': packet({
      notice: { referenceNumber: '87918', title: 'PROCUREMENT OF VIDEO EDITING SOFTWARE' },
      classification: 'review',
    }),
    '86542.json': packet({
      notice: { referenceNumber: '86542', title: 'Repair and Maintenance of Staff House 2 for 4th Quarter CY-2026' },
      classification: 'review',
    }),
    '86431.json': packet({
      notice: { referenceNumber: '86431', title: 'Supply and Delivery of IT Solution' },
      classification: 'review',
    }),
  }, async (directory) => {
    const before87918 = await readFile(path.join(directory, '87918.json'), 'utf8');
    const before86542 = await readFile(path.join(directory, '86542.json'), 'utf8');
    const before86431 = await readFile(path.join(directory, '86431.json'), 'utf8');

    const report = await runTitleReclassify({
      outputDir: directory,
      rules,
      dryRun: true,
      refreshReviewList: async () => {
        throw new Error('review list should not rebuild on dry-run');
      },
    });

    assert.equal(report.dryRun, true);
    assert.equal(report.updated, 2);
    assert.equal(report.kept, 1);
    assert.equal(await readFile(path.join(directory, '87918.json'), 'utf8'), before87918);
    assert.equal(await readFile(path.join(directory, '86542.json'), 'utf8'), before86542);
    assert.equal(await readFile(path.join(directory, '86431.json'), 'utf8'), before86431);
  });
});

test('actual mode updates only eligible JSON and preserves unrelated fields', async () => {
  let reviewListBuilds = 0;
  await withFixture({
    '87918.json': packet({
      notice: { referenceNumber: '87918', title: 'PROCUREMENT OF VIDEO EDITING SOFTWARE' },
      classification: 'review',
      agencyNote: 'preserve me',
      documents: [{ filename: 'none-yet.pdf' }],
    }),
    '86542.json': packet({
      notice: { referenceNumber: '86542', title: 'Repair and Maintenance of Staff House 2 for 4th Quarter CY-2026' },
      classification: 'review',
    }),
    '86431.json': packet({
      notice: { referenceNumber: '86431', title: 'Supply and Delivery of IT Solution' },
      classification: 'review',
      relevance: {
        isRelevant: false,
        needsReview: true,
        category: 'unknown',
        reasons: ['keep old ambiguous reason'],
      },
    }),
    '87000.json': packet({
      notice: { referenceNumber: '87000', title: 'PROCUREMENT OF VIDEO EDITING SOFTWARE' },
      classification: 'software',
      classificationSource: 'manual',
      relevance: {
        isRelevant: true,
        needsReview: false,
        category: 'software',
        reasons: ['A person marked this notice as software.'],
      },
    }),
  }, async (directory) => {
    const report = await runTitleReclassify({
      outputDir: directory,
      rules,
      dryRun: false,
      refreshReviewList: async () => {
        reviewListBuilds += 1;
      },
    });

    assert.equal(report.updated, 2);
    assert.equal(report.kept, 1);
    assert.equal(report.manual, 1);
    assert.equal(reviewListBuilds, 1);

    const software = JSON.parse(await readFile(path.join(directory, '87918.json'), 'utf8'));
    assert.equal(software.classification, 'software');
    assert.equal(software.classificationSource, 'automatic');
    assert.equal(software.agencyNote, 'preserve me');
    assert.equal(software.documents[0].filename, 'none-yet.pdf');
    assert.equal(software.notice.approvedBudget, '100000');
    assert.match(software.relevance.reasons.join(' '), /software/i);

    const notRelevant = JSON.parse(await readFile(path.join(directory, '86542.json'), 'utf8'));
    assert.equal(notRelevant.classification, 'not relevant');
    assert.equal(notRelevant.relevance.needsReview, false);

    const kept = JSON.parse(await readFile(path.join(directory, '86431.json'), 'utf8'));
    assert.equal(kept.classification, 'review');
    assert.deepEqual(kept.relevance.reasons, ['keep old ambiguous reason']);

    const manual = JSON.parse(await readFile(path.join(directory, '87000.json'), 'utf8'));
    assert.equal(manual.classificationSource, 'manual');
    assert.equal(manual.classification, 'software');
  });
});
