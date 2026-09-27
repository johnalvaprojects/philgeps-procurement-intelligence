import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classifyDocumentForNotice, classifyText, downloadDecision } from '../src/classification/relevance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

const shared = `
1. Purchase Request No. : PR-A
Contract Name : Computer Aided Design and Drafting (CADD) Software (Subscription Licenses)
2. Purchase Request No. : PR-B
Contract Name : Supply of Electrical Equipment and Supplies
3. Purchase Request No. : PR-C
Contract Name : Stainless Signage with Logo and Letters
`;

test('an accommodation procurement is not software when another sentence mentions software', () => {
  const result = classifyDocumentForNotice(
    `Accommodation (October 17-18, 2026)
Function Hall
Sound System
Projector Screen
Snacks
Lunch
Dinner
Breakfast
The template mentions a Project Management Information System for another office.`,
    rules,
    'Capacity building program and integration into the Project Management Information System',
  );
  assert.equal(result.isRelevant, false);
  assert.equal(result.needsReview, false);
  assert.equal(downloadDecision(classifyText(
    'Capacity building program and integration into the Project Management Information System',
    rules,
  )), 'inspect');
});

test('a shared document is classified from the current purchase request', () => {
  const electrical = classifyDocumentForNotice(
    shared,
    rules,
    'Purchase Request No. PR-B Supply of Electrical Equipment and Supplies',
  );
  assert.equal(electrical.isRelevant, false);
  assert.equal(electrical.needsReview, false);
  assert.match(electrical.notes.join(' '), /PR-B/);
  assert.match(electrical.notes.join(' '), /PR-A/);

  const software = classifyDocumentForNotice(
    shared,
    rules,
    'Purchase Request No. PR-A Computer Aided Design and Drafting (CADD) Software',
  );
  assert.equal(software.isRelevant, true);
  assert.equal(software.category, 'software');
  assert.equal(software.needsReview, false);
});

test('security products are not software even when they mention subscription or maintenance', () => {
  const firewall = classifyText('Renewal of Subscription for Cloud-based Web Application Firewall', rules);
  assert.equal(firewall.isRelevant, false);
  assert.equal(firewall.needsReview, false);
  assert.match(firewall.notes.join(' '), /Web Application Firewall/);

  const casb = classifyText('Subscription, Software Maintenance and Support of Cloud Security Solution (CASB)', rules);
  assert.equal(casb.isRelevant, false);
  assert.equal(casb.needsReview, false);
  assert.match(casb.notes.join(' '), /CASB|cloud security/);
});

test('software subscriptions and licenses stay software', () => {
  const samples = [
    'PROCUREMENT OF ENTERPRISE AI PRODUCTIVITY ASSISTANT SUBSCRIPTION',
    'Computer Aided Design and Drafting (CADD) Software (Subscription Licenses)',
    'Procurement of Microsoft Azure License Subscription through Cloud Service Provider (CSP)',
    'Supply and Delivery of Productivity and Project Management Software',
  ];
  for (const title of samples) {
    const result = classifyText(title, rules);
    assert.equal(result.isRelevant, true, title);
    assert.equal(result.category, 'software', title);
    assert.equal(result.needsReview, false, title);
  }
});

test('a clear physical procurement is not relevant from the title', () => {
  const titles = [
    'BUILDING AND OTHER STRUCTURE SCHOOL BUILDINGS',
    'Fencing of Lot of PCSO Negros Occidental Branch Office',
    'Supplies/Deliveries of Safety Gears and Survey Supplies for field inspection',
    'RM ICT EQUIPMENT',
    'One (1) Lot Network Infrastructure (Switches and Cabling)',
    'Purchase of 15 unit All in one Personal Computers',
    'CATERING SERVICES: MEALS AND SNACKS FOR FAMILY WEEK CELEBRATION',
    'Purchase of Janitorial Supplies',
    'Supply and Delivery of Laboratory Supplies',
    'Procurement of 20TB external hard drives',
    'Supply and Delivery of Projector and Smart TV',
    'Nutritious Food Packs for the school-based feeding program',
    'Supply and delivery of bond paper and trash bags',
    'Supply and Delivery of Medicines',
  ];
  for (const title of titles) {
    const result = classifyText(title, rules);
    assert.equal(result.isRelevant, false, title);
    assert.equal(result.needsReview, false, title);
    assert.equal(downloadDecision(result), 'skip', title);
  }
});

test('a scientific field tool without an approved physical phrase stays review', () => {
  const result = classifyText(
    'Procurement of Plankton Net and Sedgewick rafter chamber to be used for the Cap Build for HAB Monitoring',
    rules,
  );
  assert.equal(result.isRelevant, false);
  assert.equal(result.needsReview, true);
  assert.equal(downloadDecision(result), 'inspect');
});

test('a physical phrase does not override an explicit software procurement', () => {
  const construction = classifyText('Software subscription for construction project management', rules);
  assert.equal(construction.isRelevant, true);
  assert.equal(construction.category, 'software');
  assert.equal(construction.needsReview, false);

  const mixed = classifyText('Software subscription for classroom scheduling and meals and snacks', rules);
  assert.equal(mixed.isRelevant, false);
  assert.equal(mixed.needsReview, true);
  assert.notEqual(downloadDecision(mixed), 'skip');

  const shared = `
1. Purchase Request No. : PR-SOFT
Contract Name : Productivity and Project Management Software Subscription
2. Purchase Request No. : PR-FOOD
Contract Name : Catering, meals and snacks, and food packs
`;
  const software = classifyDocumentForNotice(
    shared,
    rules,
    'Purchase Request No. PR-SOFT Productivity and Project Management Software',
  );
  assert.equal(software.isRelevant, true);
  assert.equal(software.category, 'software');

  const catering = classifyDocumentForNotice(
    shared,
    rules,
    'Purchase Request No. PR-FOOD Catering and meals and snacks',
  );
  assert.equal(catering.isRelevant, false);
  assert.equal(catering.needsReview, false);
});

test('broad words alone do not exclude a notice', () => {
  const titles = [
    'ICT services for the regional office',
    'Supply of technology equipment',
    'Computer system maintenance training',
    'Cloud application support',
    'Projector Screen for the function',
  ];
  for (const title of titles) {
    const result = classifyText(title, rules);
    assert.equal(downloadDecision(result) === 'skip' && result.category === 'not relevant', false, title);
  }
});

test('internet subscription and incidental software mentions are not software', () => {
  const internet = classifyText('Internet Subscription', rules);
  assert.equal(internet.isRelevant, false);
  assert.equal(internet.needsReview, false);

  const none = classifyDocumentForNotice(
    'Plug And Play (No Software Required). Procurement of IT Equipment and laptop.',
    rules,
    'Supply and delivery of ICT Equipment',
  );
  assert.notEqual(none.category, 'software');

  const supplierTools = classifyDocumentForNotice(
    'The provider will use editing software / tools and equipment to produce the presentation.',
    rules,
    'Services for the production of an audio-visual presentation',
  );
  assert.equal(supplierTools.isRelevant, false);
  assert.notEqual(supplierTools.category, 'software');
});
