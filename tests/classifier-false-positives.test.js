import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyDocumentForNotice,
  classifyText,
  downloadDecision,
  inspectionDecision,
} from '../src/classification/relevance.js';
import { applyAutomaticClassification, reclassifyNotice } from '../src/reclassify.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

function assertNotSoftware(title) {
  const result = classifyText(title, rules);
  assert.notEqual(result.category, 'software', title);
  assert.equal(result.isRelevant, false, title);
  assert.equal(downloadDecision(result) === 'download', false, title);
  return result;
}

test('clear physical and telecom titles are not software', () => {
  const ultrasound = assertNotSoftware('VETERINARY ULTRASOUND FOR LIVESTOCK');
  assert.equal(ultrasound.needsReview, false);
  assert.equal(downloadDecision(ultrasound), 'skip');

  const poe = assertNotSoftware('PROCUREMENT OF THE SUPPLY AND DELIVERY OF POE+ SWITCH');
  assert.equal(poe.needsReview, false);
  assert.equal(downloadDecision(poe), 'skip');

  const network = assertNotSoftware('Procurement of network switch for the regional office');
  assert.equal(network.needsReview, false);
  assert.equal(downloadDecision(network), 'skip');

  for (const title of [
    'Internet Subscription',
    'Mobile data subscription',
    'Broadband subscription',
    'Telecommunications subscription',
    'SIM card data subscription',
  ]) {
    const result = assertNotSoftware(title);
    assert.equal(result.needsReview, false, title);
    assert.equal(downloadDecision(result), 'skip', title);
  }
});

test('bare mobile subscription is ambiguous and is inspected, not downloaded as software', () => {
  const result = classifyText('PROCUREMENT OF NACC MOBILE SUBSCRIPTION', rules);
  assert.equal(result.isRelevant, false);
  assert.equal(result.needsReview, true);
  assert.equal(downloadDecision(result), 'inspect');
  assert.notEqual(result.category, 'software');
});

test('clear software titles stay software', () => {
  const titles = [
    'Adobe Acrobat Pro (3-year subscription)',
    'Procurement of One (1) Year Subscription of EViews License',
    'SquashTM Subscription',
    'Procurement of System Development Services',
    'Procurement of Enterprise AI Productivity Assistant Subscription',
    'Procurement of Microsoft Azure License Subscription through Cloud Service Provider (CSP)',
    'Supply and Delivery of Productivity and Project Management Software',
    'Procurement of Development Tools Subscription',
    'PROCUREMENT OF ONE (1) LOT PDF EDITING STANDARD SUBSCRIPTION',
    'PROCUREMENT OF VIDEO EDITING SOFTWARE',
  ];
  for (const title of titles) {
    const result = classifyText(title, rules);
    assert.equal(result.isRelevant, true, title);
    assert.equal(result.category, 'software', title);
    assert.equal(result.needsReview, false, title);
    assert.equal(downloadDecision(result), 'download', title);
  }
});

test('incidental software wording in device documents does not become software', () => {
  const ultrasound = classifyDocumentForNotice(
    'Transducer: 7.5 Mhz linear, USB/SD supported and software to transfer images to PC. Accessories: Bovine scan curve.',
    rules,
    'VETERINARY ULTRASOUND FOR LIVESTOCK',
  );
  assert.equal(ultrasound.isRelevant, false);
  assert.notEqual(ultrasound.category, 'software');
  assert.equal(inspectionDecision(ultrasound), 'skip');

  const poe = classifyDocumentForNotice(
    'PoE+ Switch. Ports: 24 x Gigabit Ethernet with PoE+. Software Feature Set: Enterprise-grade network operating system with baseline routing.',
    rules,
    'PROCUREMENT OF THE SUPPLY AND DELIVERY OF POE+ SWITCH',
  );
  assert.equal(poe.isRelevant, false);
  assert.notEqual(poe.category, 'software');
  assert.equal(inspectionDecision(poe), 'skip');
});

test('inspection relevance is kept when a vague title becomes software from the document', () => {
  const title = 'Supply and Delivery of IT Solution';
  const titleRelevance = classifyText(title, rules);
  assert.equal(downloadDecision(titleRelevance), 'inspect');

  const inspectionRelevance = classifyDocumentForNotice(
    'Contract Name: Productivity and Project Management Software Subscription for the regional office.',
    rules,
    title,
  );
  assert.equal(inspectionDecision(inspectionRelevance), 'software');

  // Mirrors process-notice: persist inspection.relevance, not title flags.
  const saved = inspectionRelevance;
  assert.equal(saved.isRelevant, true);
  assert.equal(saved.category, 'software');
  assert.match(saved.reasons.join(' '), /software|subscription/i);
  assert.equal(saved.reasons.join(' ').includes('No configured software or hardware terms were found.'), false);
});

test('reclassify updates automatic records and leaves manual records untouched', async () => {
  const automatic = {
    notice: { referenceNumber: '88036', title: 'VETERINARY ULTRASOUND FOR LIVESTOCK' },
    documents: [],
    requirements: { items: [] },
    relevance: {
      isRelevant: true,
      needsReview: false,
      category: 'software',
      reasons: ['No configured software or hardware terms were found.'],
    },
    classification: 'software',
    classificationSource: 'automatic',
    reviewed: false,
    review: { status: 'pending' },
  };
  const updated = await reclassifyNotice(automatic, {
    rules,
    readSavedText: async () => null,
    inspectTemporary: async () => ({ outcome: 'unclear', relevance: classifyText(automatic.notice.title, rules) }),
    downloadAll: async () => [],
    hasLocalFiles: false,
  });
  assert.equal(updated.manual, false);
  assert.equal(updated.reclassified, true);
  assert.equal(updated.packet.classification, 'not relevant');
  assert.equal(updated.packet.classificationSource, 'automatic');
  assert.equal(updated.packet.relevance.isRelevant, false);

  const manual = {
    ...automatic,
    notice: { referenceNumber: '88094', title: 'PROCUREMENT OF NACC MOBILE SUBSCRIPTION' },
    classification: 'software',
    classificationSource: 'manual',
    reviewed: true,
    relevance: {
      isRelevant: true,
      needsReview: false,
      category: 'software',
      reasons: ['A person marked this notice as software.'],
    },
    review: { status: 'reviewed', source: 'manual' },
  };
  const kept = await reclassifyNotice(manual, {
    rules,
    readSavedText: async () => null,
    inspectTemporary: async () => ({ outcome: 'unclear', relevance: classifyText(manual.notice.title, rules) }),
    downloadAll: async () => [],
    hasLocalFiles: false,
  });
  assert.equal(kept.manual, true);
  assert.equal(kept.reclassified, false);
  assert.equal(kept.packet.classification, 'software');
  assert.equal(kept.packet.classificationSource, 'manual');

  const applied = applyAutomaticClassification(automatic, classifyText(automatic.notice.title, rules));
  assert.equal(applied.classification, 'not relevant');
});
