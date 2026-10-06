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
import { noticeScanPlan } from '../src/classification/cache.js';
import { applyAutomaticClassification, reclassifyNotice } from '../src/reclassify.js';
import { structuredEvidenceText } from '../src/philgeps/notices.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

function labelOf(result) {
  if (result?.category === 'software' && result.isRelevant === true) return 'software';
  if (result?.isRelevant === false && result?.needsReview === false) return 'not relevant';
  return 'review';
}

test('IT Helpdesk title stays inspect; helpdesk software evidence is Software', () => {
  const title = 'IT Helpdesk Subscription';
  const fromTitle = classifyText(title, rules);
  assert.equal(labelOf(fromTitle), 'review');
  assert.equal(downloadDecision(fromTitle), 'inspect');

  const fromDoc = classifyDocumentForNotice(
    '1 Lot Subscription to IT Helpdesk Software. Helpdesk software license compatible with existing IPOPHL Helpdesk.',
    rules,
    title,
  );
  assert.equal(labelOf(fromDoc), 'software');
  assert.equal(inspectionDecision(fromDoc), 'software');
});

test('Statistical Software Subscription / STATA wording is Software', () => {
  const title = 'Procurement of Statistical Software Subscription for One (1) Year';
  assert.equal(labelOf(classifyText(title, rules)), 'software');
  const fromDoc = classifyDocumentForNotice(
    'Product: STATA MP2 V19 (2-CORE). New Account: One (1) license. Renewal: Ten (10) licenses.',
    rules,
    title,
  );
  assert.equal(labelOf(fromDoc), 'software');
});

test('Autodesk Civil 3D license evidence is Software', () => {
  const title = 'CY2026 Procurement of Architectural Design for RAED Division under PMED-ICT';
  assert.equal(downloadDecision(classifyText(title, rules)), 'inspect');
  const fromDoc = classifyDocumentForNotice(
    '2 Unit Autodesk Civil 3D Latest Edition - Genuine Software from autodesk.com, with Admin Login from Autodesk and at least 1-year subscription',
    rules,
    title,
  );
  assert.equal(labelOf(fromDoc), 'software');
});

test('satellite internet mini kits are Not Relevant even with software subscriptions wording', () => {
  const title =
    'Procurement of Satellite-Based Internet Mini Kits with 1-Year Service Subscription, and Visual Content Creation Software Subscriptions, (Satellite, Internet Kits & Data Service, and Digital Media Design Subscriptions) for DOLE RO8';
  assert.equal(labelOf(classifyText(title, rules)), 'not relevant');
  assert.equal(downloadDecision(classifyText(title, rules)), 'skip');

  const fromDoc = classifyDocumentForNotice(
    'Mobile Satellite Internet Terminal Kit (Starlink Kit / Starlink Mini or equivalent). Satellite Antenna / Dish Unit. Integrated Wi-Fi Router. RJ45/Ethernet. Carrying case. Internet/data service.',
    rules,
    title,
  );
  assert.equal(labelOf(fromDoc), 'not relevant');
});

test('workshop title with system development + catering evidence is Not Relevant', () => {
  const title =
    'NATIONAL CONSULTATION WORKSHOP ON THE FB PAGBABAGO LIVELIHOOD DEVELOPMENT PROGRAM WEBSITE AND SYSTEM DEVELOPMENT - CLUSTER II';
  assert.equal(labelOf(classifyText(title, rules)), 'not relevant');

  const fromDoc = classifyDocumentForNotice(
    'Catering Services for National Consultation Workshop Cluster II. LOT 1 50 Pax. See attached Menu for Reference.',
    rules,
    title,
  );
  assert.equal(labelOf(fromDoc), 'not relevant');
});

test('Catering Services and menu text are Not Relevant', () => {
  assert.equal(labelOf(classifyText('Catering Services', rules)), 'not relevant');
  assert.equal(
    labelOf(classifyDocumentForNotice('See attached Menu for Reference. Breakfast and lunch for 50 pax.', rules, 'Workshop')),
    'not relevant',
  );
});

test('Internet Subscription and Internet Connectivity Services are Not Relevant', () => {
  assert.equal(labelOf(classifyText('Internet Subscription', rules)), 'not relevant');
  assert.equal(labelOf(classifyText('Provision of Internet Connectivity Services', rules)), 'not relevant');
});

test('obvious hardware procurement is Not Relevant', () => {
  for (const title of [
    'Supply and Delivery of Fire Extinguishers',
    'Procurement of Laptop Computers',
    'Supply of Desktop Computer Sets',
    'Procurement of Printers and CCTV',
    'ICT Equipment for the regional office',
  ]) {
    assert.equal(labelOf(classifyText(title, rules)), 'not relevant', title);
    assert.equal(downloadDecision(classifyText(title, rules)), 'skip', title);
  }
});

test('software license and contextual software subscription stay Software', () => {
  assert.equal(labelOf(classifyText('Procurement of Software Licenses for Office Productivity', rules)), 'software');
  assert.equal(
    labelOf(classifyText('Procurement of Microsoft 365 Software Subscription for One Year', rules)),
    'software',
  );
});

test('generic subscription/cloud/system/service/support/maintenance alone are not Software', () => {
  for (const title of [
    'Annual Subscription',
    'Cloud Service Renewal',
    'System Support and Maintenance',
    'IT Support Services',
    'Maintenance Service Agreement',
  ]) {
    const result = classifyText(title, rules);
    assert.notEqual(labelOf(result), 'software', title);
  }
});

test('unresolved mixed laptop with software stays Review', () => {
  const result = classifyText('One (1) Lot Laptop with Licensed Softwares', rules);
  assert.equal(labelOf(result), 'review');
});

test('structured evidence text includes business category and line items', () => {
  const text = structuredEvidenceText({
    title: 'IT Helpdesk Subscription',
    businessCategory: 'Software',
    procurementMode: 'Small Value Procurement',
    lineItems: [{ lotName: 'Helpdesk licenses', quantity: '24', unitOfMeasure: 'lot', unspsc: '43230000' }],
  });
  assert.match(text, /Business Category: Software/);
  assert.match(text, /Lot Name: Helpdesk licenses/);
  assert.match(text, /UNSPSC: 43230000/);
});

test('manual classification is never overwritten by automatic reclassify', async () => {
  const manual = {
    notice: { referenceNumber: '99901', title: 'Internet Subscription' },
    documents: [],
    requirements: { items: [] },
    relevance: {
      isRelevant: true,
      needsReview: false,
      category: 'software',
      reasons: ['A person marked this notice as software.'],
    },
    classification: 'software',
    classificationSource: 'manual',
    reviewed: true,
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

  const plan = noticeScanPlan(manual.notice, rules, manual);
  assert.equal(plan.action, 'reuse');
  assert.equal(plan.label, 'software');

  const applied = applyAutomaticClassification(
    { ...manual, classificationSource: 'automatic' },
    classifyText(manual.notice.title, rules),
  );
  assert.equal(applied.classificationSource, 'automatic');
  assert.equal(applied.classification, 'not relevant');
});

test('third-party market research with software lot UNSPSC is Not Relevant', () => {
  const title =
    'Hiring of Third Party Service Provider for Market Research on an AI-driven Industry Intelligence Website and MSME Profiling Platform';
  assert.notEqual(labelOf(classifyText(title, rules)), 'software');

  const structured = structuredEvidenceText({
    title,
    businessCategory: 'Information Technology Service Delivery',
    procurementMode: 'Small Value Procurement',
    lineItems: [{
      lotName: 'Software application administration service',
      lotDescription: 'Software application administration service',
      unspsc: '81161501',
      quantity: '1',
      unitOfMeasure: 'Lot',
    }],
  });
  assert.equal(labelOf(classifyDocumentForNotice(structured, rules, title)), 'not relevant');
});

test('consultancy / market-research service titles are not automatically Software', () => {
  assert.equal(
    labelOf(classifyText('Consultancy Services for Development of Information System', rules)),
    'not relevant',
  );
  assert.equal(
    labelOf(classifyText('Market Research and Analytics Platform Development', rules)),
    'not relevant',
  );

  const marketResearchStructured = structuredEvidenceText({
    title: 'Market Research and Analytics Platform Development',
    businessCategory: 'Information Technology Service Delivery',
    lineItems: [{
      lotName: 'Software application administration service',
      lotDescription: 'Software application administration service',
      unspsc: '81161501',
      quantity: '1',
      unitOfMeasure: 'Lot',
    }],
  });
  assert.equal(
    labelOf(classifyDocumentForNotice(
      marketResearchStructured,
      rules,
      'Market Research and Analytics Platform Development',
    )),
    'not relevant',
  );
});

test('confirmed software product procurements stay Software', () => {
  assert.equal(labelOf(classifyText('Microsoft Office 365 Family License', rules)), 'software');
  assert.equal(
    labelOf(classifyDocumentForNotice(
      structuredEvidenceText({
        title: 'Supply and Delivery of Microsoft Office 365 Family License for Create',
        businessCategory: 'Computer services',
        lineItems: [{
          lotName: 'Computer software licensing service',
          lotDescription: 'Computer software licensing service',
          unspsc: '81112501',
          quantity: '10',
          unitOfMeasure: 'License',
        }],
      }),
      rules,
      'Supply and Delivery of Microsoft Office 365 Family License for Create',
    )),
    'software',
  );

  assert.equal(
    labelOf(classifyDocumentForNotice(
      structuredEvidenceText({
        title: 'Procurement of Cloud-Based Learning Management System Subscription for the Department of Justice (DOJ) - National Prosecution Service (NPS)',
        businessCategory: 'Information Technology Service Delivery',
        lineItems: [{
          lotName: 'Software application administration service',
          lotDescription: 'Software application administration service',
          unspsc: '81161501',
          quantity: '1',
          unitOfMeasure: 'Lot',
        }],
      }),
      rules,
      'Procurement of Cloud-Based Learning Management System Subscription for the Department of Justice (DOJ) - National Prosecution Service (NPS)',
    )),
    'software',
  );

  assert.equal(labelOf(classifyText('Autodesk Civil 3D License', rules)), 'software');
  assert.equal(labelOf(classifyText('IT Helpdesk Software Subscription', rules)), 'software');
  assert.equal(labelOf(classifyText('Statistical Software Subscription', rules)), 'software');
});

test('consulting engagement mixed with separate software license purchase is Review', () => {
  const title =
    'Hiring of Third Party Service Provider for Market Research and Procurement of Microsoft 365 Software Licenses';
  assert.equal(labelOf(classifyText(title, rules)), 'review');
});
