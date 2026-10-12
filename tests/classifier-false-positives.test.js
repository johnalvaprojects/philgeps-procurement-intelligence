import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyDocumentForNotice,
  classifyStructuredEvidence,
  classifyText,
  downloadDecision,
  inspectionDecision,
} from '../src/classification/relevance.js';
import { structuredEvidenceText } from '../src/philgeps/notices.js';
import { preAttachmentDecision } from '../src/process-notice.js';
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

const bloodBankNotice = {
  title: 'PROCUREMENT OF BLOOD BANK EQUIPMENT',
  businessCategory: 'Patient exam and monitoring products',
  lineItems: [
    {
      lotName: 'BRANDNEW ELECTRONIC / AUTOMATED BLOOD BAG HAND STRIPPER',
      lotDescription: 'BRANDNEW ELECTRONIC / AUTOMATED BLOOD BAG HAND STRIPPER',
      quantity: '2',
      unitOfMeasure: 'UNIT',
    },
    {
      lotName: 'BRANDNEW PLASMA THAW BATH (PLASMA THAWER',
      lotDescription: 'BRANDNEW PLASMA THAW BATH (PLASMA THAWER',
      quantity: '1',
      unitOfMeasure: 'PIECE',
    },
    {
      lotName: 'Routine software updates should be provided',
      lotDescription: 'Routine software updates should be provided',
    },
    {
      lotName: 'Software / Hardware upgrade availability',
      lotDescription: 'Software / Hardware upgrade availability',
    },
  ],
};

test('notice 96036 equipment-maintenance software wording is not a software purchase', () => {
  const title = classifyText(bloodBankNotice.title, rules);
  assert.equal(downloadDecision(title), 'inspect');
  assert.notEqual(title.category, 'software');

  const structured = classifyStructuredEvidence(
    structuredEvidenceText(bloodBankNotice),
    rules,
    bloodBankNotice.title,
  );
  assert.notEqual(structured.category, 'software');
  assert.equal(structured.isRelevant, false);
  assert.notEqual(structured.confidence, 0.9);
  assert.equal(downloadDecision(structured), 'inspect');

  const rfq = [
    'PROCUREMENT OF BLOOD BANK EQUIPMENT',
    'medical equipment',
    '2 electronic/automated blood bag hand strippers',
    '1 plasma thaw bath',
    'Software / Hardware',
    'upgrade availability',
    'Routine software updates should be provided',
  ].join('\n');
  const document = classifyDocumentForNotice(rfq, rules, bloodBankNotice.title);
  assert.equal(document.isRelevant, false);
  assert.equal(document.needsReview, false);
  assert.notEqual(document.category, 'software');
  assert.equal(inspectionDecision(document), 'skip');
  assert.match(document.notes.join(' '), /medical or imaging equipment/);
});

test('notice 96036 reaches attachment inspection instead of a structured software download', () => {
  const plan = preAttachmentDecision(bloodBankNotice, rules);
  assert.equal(plan.phase, 'inspect');
  assert.equal(plan.decision, 'inspect');
  assert.equal(plan.reachesAttachmentInspection, true);
  assert.notEqual(plan.relevance.category, 'software');
  assert.equal(plan.relevance.isRelevant, false);
});

test('a generic software mention in a structured lot does not skip attachment inspection', () => {
  const notice = {
    title: 'Supply and Delivery of IT Solution',
    lineItems: [{ lotName: 'The unit includes software', lotDescription: 'The unit includes software' }],
  };
  const structured = classifyStructuredEvidence(structuredEvidenceText(notice), rules, notice.title);
  assert.notEqual(structured.category, 'software');
  assert.equal(structured.isRelevant, false);
  assert.equal(structured.needsReview, true);
  assert.notEqual(structured.confidence, 0.9);
  assert.equal(downloadDecision(structured), 'inspect');

  const plan = preAttachmentDecision(notice, rules);
  assert.equal(plan.reachesAttachmentInspection, true);
  assert.equal(plan.decision, 'inspect');
});

test('named software products, licenses, and subscriptions still download', () => {
  for (const title of [
    'Supply and Delivery of Mapping Software',
    'Procurement of Software Licenses for Office Productivity',
    'Procurement of Microsoft 365 Software Subscription for One Year',
    'IT Helpdesk Software Subscription',
    'Procurement of Software Maintenance',
  ]) {
    const result = classifyText(title, rules);
    assert.equal(result.category, 'software', title);
    assert.equal(result.isRelevant, true, title);
    assert.equal(downloadDecision(result), 'download', title);
  }

  const fromLots = {
    title: 'Supply and Delivery of IT Solution',
    lineItems: [{
      lotName: 'Adobe Acrobat software license',
      lotDescription: 'Adobe Acrobat software license',
    }],
  };
  const structured = classifyStructuredEvidence(structuredEvidenceText(fromLots), rules, fromLots.title);
  assert.equal(structured.category, 'software');
  assert.equal(structured.isRelevant, true);
  assert.equal(downloadDecision(structured), 'download');
  const plan = preAttachmentDecision(fromLots, rules);
  assert.equal(plan.phase, 'structured-download');
  assert.equal(plan.reachesAttachmentInspection, false);
});

test('consulting mixed with a software license purchase stays Review', () => {
  const title = 'Hiring of Third Party Service Provider for Market Research and Procurement of Microsoft 365 Software Licenses';
  const result = classifyText(title, rules);
  assert.equal(result.needsReview, true);
  assert.equal(result.isRelevant, false);
  assert.notEqual(result.category, 'software');
  assert.equal(downloadDecision(result), 'inspect');

  const plan = preAttachmentDecision({ title, lineItems: [] }, rules);
  assert.equal(plan.reachesAttachmentInspection, true);
  assert.notEqual(plan.relevance.category, 'software');
});
