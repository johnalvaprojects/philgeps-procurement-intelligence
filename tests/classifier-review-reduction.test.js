import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyDocumentForNotice,
  classifyText,
  downloadDecision,
} from '../src/classification/relevance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));

function labelOf(result) {
  if (result?.category === 'software' && result.isRelevant === true) return 'software';
  if (result?.isRelevant === false && result?.needsReview === false) return 'not relevant';
  return 'review';
}

function assertSoftware(title) {
  const result = classifyText(title, rules);
  assert.equal(labelOf(result), 'software', title);
  assert.equal(downloadDecision(result), 'download', title);
  return result;
}

function assertNotRelevant(title) {
  const result = classifyText(title, rules);
  assert.equal(labelOf(result), 'not relevant', title);
  assert.equal(downloadDecision(result), 'skip', title);
  return result;
}

function assertReview(title) {
  const result = classifyText(title, rules);
  assert.equal(labelOf(result), 'review', title);
  assert.equal(downloadDecision(result), 'inspect', title);
  return result;
}

test('PROCUREMENT OF VIDEO EDITING SOFTWARE is Software', () => {
  assertSoftware('PROCUREMENT OF VIDEO EDITING SOFTWARE');
});

test('facility repair / renovation / labor-and-materials / construction are Not Relevant', () => {
  assertNotRelevant('Repair and Maintenance of Staff House 2 for 4th Quarter CY-2026');
  assertNotRelevant('Renovation of the Office of the Government Corporate Counsel (OGCC)');
  assertNotRelevant('Procurement of Labor and Materials for Repair and Rehabilitation of Knowledge Management Center');
  assertNotRelevant('Construction of MHARSMC Waste Holding Area Materials Recovery Facility MRF');
});

test('meals / packed meals / food for are Not Relevant', () => {
  assertNotRelevant('Meals for Campus-Based CSC Anniversary Family Day Celebration');
  assertNotRelevant('Packed Meals for Teachers Day Celebration 2026 under project 3Ms');
  assertNotRelevant('Procurement of Food for the Conduct of Empowered Educators Training');
});

test('printing and promotional physical goods are Not Relevant', () => {
  assertNotRelevant('Printing and Delivery of Yearbook');
  assertNotRelevant('Tokens and Awards');
  assertNotRelevant('Procurement of Tarpaulin to be used in the Healthy Learning Institution (HLI)');
  assertNotRelevant('Procurement of Plaque for 126th Philippine Civil Service Anniversary Culmination');
});

test('agricultural and fuel procurement are Not Relevant', () => {
  assertNotRelevant('Supply and Delivery of Fifty-Two (52) Bags Hybrid Sorghum Seeds');
  assertNotRelevant('Agricultural and Marine Supplies');
  assertNotRelevant('Supply and Delivery of Diesel Fuel and Premium Gasoline');
});

test('air-conditioning unit procurement is Not Relevant', () => {
  assertNotRelevant('Supply and Delivery of Brand New Airconditioning Units ( Wall-Mounted Type) Including Installation');
  assertNotRelevant('Procurement for the Supply and Installation of Air Conditioning Unit for BatStateU Integrated School');
});

test('license plus application/database context is Software', () => {
  assertSoftware('Procurement of 35 Licenses of Cross Platform Relational Database Application');
});

test('named SaaS / productivity subscription lists are Software', () => {
  assertSoftware(
    'Canva Pro, Zoom Workplace Pro, Capcut Pro, Google Drive, Claude Max 5x, Facebook Verified Badge, Anycase .AI Pro, Padlet Team, Nitro PDF Standard Subscription',
  );
});

test('web application security tools are Not Relevant, not Software', () => {
  assertNotRelevant('PR No, 2026-09-345 Web Application Security Tool');
  assertNotRelevant('PR No. 2026-09-345 Web Application Security Tool');
});

test('ordinary web application development stays Software', () => {
  assertSoftware('Procurement of Web Application Development Services');
});

test('mixed hardware plus licensed software stays Review', () => {
  assertReview('SVP-D 26-10-0334 One (1) Lot Laptop with Licensed Softwares');
  assertReview('26GME0096 - Supply & Delivery of IT Equipment (with Office Software) for Administrative use');
});

test('document scanner specs mentioning Software CD are Not Relevant', () => {
  const title = 'Procurement of Document Scanner To Support the Daily Operations of the DILG Regional and Field Offices';
  assertNotRelevant(title);
  const fromDoc = classifyDocumentForNotice(
    'Scanner Main Unit + 1x USB 3.0 Cable + 1x AC Adapter + 1x Power Cord + 1x Software CD + 1x Setup Guide',
    rules,
    title,
  );
  assert.equal(labelOf(fromDoc), 'not relevant');
  assert.notEqual(fromDoc.category, 'software');
});

test('scientific device specs mentioning calibration software are Not Relevant', () => {
  const title = 'WQ Multiparameter';
  assertNotRelevant(title);
  const fromDoc = classifyDocumentForNotice(
    'Shall also support USB communication with Windows-based computers. Software shall provide calibration records and downloadable monitoring data.',
    rules,
    title,
  );
  assert.equal(labelOf(fromDoc), 'not relevant');
  assert.notEqual(fromDoc.category, 'software');
});

test('pharmaceutical tablets are not treated as ICT tablet hardware', () => {
  const result = classifyText('Supply and Delivery of Deworming (Albendazole 400mg) Tablets SY 2026-2027', rules);
  assert.notEqual(result.category, 'hardware');
  assert.equal(result.isRelevant, false);
});

test('AV production incidental editing-software wording stays non-software', () => {
  const production = classifyDocumentForNotice(
    'Digital non-linear audio editing on sound forge software. Animation and editing software / tools and equipment. Professional Editing Software and equipment.',
    rules,
    'SERVICES FOR THE PRODUCTION OF AUDIO-VISUAL PRESENTATION',
  );
  assert.equal(production.isRelevant, false);
  assert.notEqual(production.category, 'software');
});

test('obvious physical and non-software titles are Not Relevant without download', () => {
  for (const title of [
    'Epson Ink',
    'Aircooler',
    'First Aid Kits',
    '60,000 Bangus Fingerlings',
    'Plastic Pallet, Sacks, and Crates',
    'Supply and Delivery of Walking-Type Agricultural Tractors (Multicultivators)',
    'Supply and delivery of various Tires (tubeless, with inner tube) for the use of EMS',
    'Pipettors (Single Channel)',
    'LIDOCAINE SPRAY 10% 50ML (HCL)',
    'Training services for barangay officials',
    'Architectural Design Services',
    'PROCUREMENT OF COMMERCIAL MILK',
  ]) {
    assertNotRelevant(title);
  }
});

test('AutoCAD and named software licenses stay Software', () => {
  assertSoftware('Procurement of AutoCAD Software License');
  assertSoftware('Microsoft Office 365 Family License');
  assertSoftware('Statistical Software Subscription');
  assertSoftware('IT Helpdesk Software Subscription');
  assertSoftware('Cloud-Based Learning Management System Subscription');
});

test('IT Equipment/Software/Peripherals stays Review, not automatic Software', () => {
  assertReview('IT Equipment/Software/Peripherals');
});

test('ambiguous architectural design title stays inspect; Autodesk evidence is Software', () => {
  const title = 'CY2026 Procurement of Architectural Design for RAED Division under PMED-ICT';
  assert.equal(downloadDecision(classifyText(title, rules)), 'inspect');
  const fromDoc = classifyDocumentForNotice(
    '2 Unit Autodesk Civil 3D Latest Edition - Genuine Software from autodesk.com with at least 1-year subscription',
    rules,
    title,
  );
  assert.equal(labelOf(fromDoc), 'software');
});

test('PhilGEPS Aircraft business category with no software product is Not Relevant', () => {
  const structured = [
    'Title: for the use of NW109E Helicopter',
    'Business Category: Aircraft',
    'Lot Name: Aircraft maintenance parts',
  ].join('\n');
  assert.equal(
    labelOf(classifyDocumentForNotice(structured, rules, 'for the use of NW109E Helicopter')),
    'not relevant',
  );
});
