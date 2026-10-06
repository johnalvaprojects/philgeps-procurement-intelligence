import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractSoftwareRequirements, isIncompleteRequirement, splitMergedRequirements } from '../src/extraction/software-requirements.js';
import {
  durationField,
  fieldValue,
  looksLikeSuspiciousEmail,
  parseDurationPhrase,
  sourced,
} from '../src/extraction/sourced-field.js';
import { classifyText } from '../src/classification/relevance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(path.join(root, 'config/relevance.json'), 'utf8'));

function noticeStub(overrides = {}) {
  return {
    referenceNumber: '90000',
    title: 'Procurement of Software License',
    organization: 'TEST AGENCY',
    abc: '100,000.00',
    deadline: '09-Oct-2026 10:00 AM',
    procurementMode: 'Small Value Procurement',
    controlNumber: 'RFQ-1',
    deliveryPeriod: '30',
    lineItems: [],
    ...overrides,
  };
}

test('equivalent deadline formats do not create a false conflict', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({
      deadline: '09-Oct-2026 10:00 AM',
      closingDate: '09-Oct-2026 10:00 AM',
    }),
    sources: [{
      filename: 'RBAC.pdf',
      text: 'Deadline of Submission of Quotation: October 09, 2026, 10:00AM\n1. 10 License Microsoft office 365 Family License',
    }],
  });
  assert.equal(
    result.conflicts.some((item) => item.field === 'submission.quotationDeadline'),
    false,
  );
});

test('ABC extraction uses PhilGEPS structured value with provenance', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({ abc: '400,000.00' }),
    sources: [],
  });
  assert.equal(fieldValue(result.financial.abc), '400,000.00');
  assert.equal(result.financial.abc.source, 'philgeps-structured');
  assert.equal(fieldValue(result.financial.currency), 'PHP');
});

test('preserves minimum-duration qualifier (at least 1-year)', () => {
  const parsed = parseDurationPhrase('at least 1-year subscription');
  assert.equal(parsed.constraint, 'minimum');
  assert.equal(parsed.quantity, 1);
  assert.equal(parsed.unit, 'year');
  assert.equal(parsed.originalText, 'at least 1-year subscription');

  const field = durationField('at least 1-year subscription', 'RFQ.pdf');
  assert.equal(field.value, 'at least 1-year subscription');
  assert.equal(field.constraint, 'minimum');
  assert.equal(field.quantity, 1);
  assert.equal(field.unit, 'year');

  const result = extractSoftwareRequirements({
    notice: noticeStub({
      referenceNumber: '92301',
      title: 'CY2026 Procurement of Architectural Design for RAED Division under PMED-ICT',
      abc: '400,000.00',
    }),
    sources: [{
      filename: 'RFQ_Autodesk.pdf',
      text: `Item no. Qty Unit ITEM'S SPECIFICATION
1 2 Unit Autodesk Civil 3D Latest Edition
-Genuine Software from autodesk.com, with Admin Login from Autodesk and at least 1-year subscription
Deadline for Submission: on or before October 9, 2026 / 8:30am
Delivery Period: 30 calendar days`,
    }],
  });
  assert.equal(result.items.length, 1);
  assert.equal(fieldValue(result.items[0].quantity), 2);
  assert.equal(fieldValue(result.items[0].subscriptionDuration), 'at least 1-year subscription');
  assert.equal(result.items[0].subscriptionDuration.constraint, 'minimum');
  assert.equal(result.items[0].subscriptionDuration.quantity, 1);
  assert.equal(result.items[0].subscriptionDuration.unit, 'year');
  const licenseText = result.technical.licenseRequirements.map((item) => item.value).join(' ');
  assert.match(licenseText, /Admin Login from Autodesk/i);
  assert.match(licenseText, /at least 1-year subscription/i);
  assert.equal(result.delivery.deliveryLocation, null);
});

test('Office 365 extracts 10 licenses without inventing duration', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({ title: 'Microsoft Office 365 Family License', abc: '55,000.00' }),
    sources: [{
      filename: 'RBAC.pdf',
      text: '1. 10 License Microsoft office 365 Family License\nDelivery Schedule: 20 Calendar Days upon receipt of the Notice to Proceed\nDeadline of Submission of Quotation: October 09, 2026, 10:00AM',
    }],
  });
  assert.equal(fieldValue(result.items[0].licenses), 10);
  assert.equal(result.items[0].subscriptionDuration, null);
  assert.match(String(fieldValue(result.delivery.deliveryPeriod)), /20 Calendar Days/i);
});

test('bare PhilGEPS delivery number yields to explicit document delivery', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({
      title: 'IT Helpdesk Subscription',
      deliveryPeriod: '12',
      abc: '1,050,000.00',
    }),
    sources: [{
      filename: 'RFP.pdf',
      text: `Helpdesk software license (license to be provided must be compatible w/ the existing IPOPHL Helpdesk System)
24 Lic. 12 months
2 Warranty and Support
1 Lot Throughout the duration of the subscription
The delivery or loading of the software licenses shall be within ten (10) calendar days upon receipt of the Notice to Proceed (NTP) but not later than 19 November 2026.
Software licenses shall have a valid subscription period of twelve (12) months upon activation.`,
    }],
  });
  assert.match(String(fieldValue(result.delivery.deliveryPeriod)), /ten \(10\) calendar days|within ten/i);
  assert.notEqual(fieldValue(result.delivery.deliveryPeriod), '12');
  assert.equal(result.delivery.deliveryPeriod.confidence, 'high');
  assert.equal(fieldValue(result.items[0].licenses), 24);
  assert.equal(fieldValue(result.items[0].subscriptionDuration), '12 months');
  assert.equal(result.items.length, 2);
  assert.equal(fieldValue(result.items[1].description), 'Warranty and Support');
  assert.equal(fieldValue(result.items[1].quantity), 1);
  assert.equal(fieldValue(result.items[1].unitOfMeasure), 'Lot');
  assert.match(String(fieldValue(result.items[1].subscriptionDuration)), /Throughout the duration/i);
  const compat = result.technical.compatibilityRequirements.map((item) => item.value).join(' ');
  assert.match(compat, /compatible w\/?\s*the existing IPOPHL Helpdesk/i);
});

test('bare PhilGEPS delivery is kept at low confidence when no document delivery exists', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({ deliveryPeriod: '12', title: 'Software Tool' }),
    sources: [{ filename: 'thin.pdf', text: 'Request for Quotation only. No delivery clause.' }],
  });
  assert.equal(fieldValue(result.delivery.deliveryPeriod), '12');
  assert.equal(result.delivery.deliveryPeriod.confidence, 'low');
  assert.equal(result.delivery.deliveryPeriod.scope, 'philgeps_bare_number');
});

test('financial scope keeps item ABC preferred and header ABC as conflict context', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({
      abc: '55,000.00',
      controlNumber: '09862',
      title: 'Supply and Delivery of Microsoft Office 365 Family License for Create',
    }),
    sources: [{
      filename: 'RBAC.pdf',
      text: `Request for Quotation
Date: October 05, 2026 RFQ No.: RBAC II-09-862-A
P.R No. 26-08-1279 Approved Budget for the Contract: Php 1,127,120.00
HARVEY FRANZ M. GATLABAYAN
Librarian I
RBAC II Secretariat Head
TECHNICAL REQUIREMENTS:
FINANCIAL OFFER:
1. 10 License Microsoft office 365 Family License
Delivery Schedule: 20 Calendar Days upon receipt of the Notice to Proceed
Deadline of Submission of Quotation: October 09, 2026, 10:00AM
Supply and Delivery of
Microsoft Office 365 Family
License for Create Unit
5,500.00 55,000.00
Fifty Five Thousand
Pesos`,
    }],
  });
  assert.equal(fieldValue(result.financial.abc), '55,000.00');
  assert.match(String(result.financial.abcScope), /philgeps|item/i);
  assert.ok(result.conflicts.some((item) => item.field === 'financial.abc'));
  assert.ok(result.financial.otherFinancialLimits.some((item) => fieldValue(item) === '1,127,120.00'));
  assert.equal(fieldValue(result.identification.controlNumber), '09862');
  assert.equal(fieldValue(result.identification.rfqOrSolicitationNumber), 'RBAC II-09-862-A');
  // Control vs RFQ are distinct — not auto-conflicted solely for format difference.
  assert.equal(
    result.conflicts.some((item) => item.field === 'identification.rfqOrSolicitationNumber'),
    false,
  );
  assert.equal(result.submission.contactPerson, null);
});

test('section headings are rejected as contact persons', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub(),
    sources: [{
      filename: 'x.pdf',
      text: 'TECHNICAL REQUIREMENTS:\nFINANCIAL OFFER:\nPlease contact TECHNICAL REQUIREMENTS of the office',
    }],
  });
  assert.equal(result.submission.contactPerson, null);
});

test('boilerplate and OCR artifacts rejected as delivery locations', () => {
  const permit = extractSoftwareRequirements({
    notice: noticeStub({ referenceNumber: '92301' }),
    sources: [{
      filename: 'a.pdf',
      text: `Delivery Site:
In case of recently expired Mayor’s/Business permit, it shall be accepted together with its official receipt
1 2 Unit Autodesk Civil 3D Latest Edition
-Genuine Software from autodesk.com, with Admin Login from Autodesk and at least 1-year subscription`,
    }],
  });
  assert.equal(permit.delivery.deliveryLocation, null);

  const copyright = extractSoftwareRequirements({
    notice: noticeStub({ referenceNumber: '92597' }),
    sources: [{
      filename: 'b.pdf',
      text: 'Location © Department of Justice\nPadre Faura Street, Ermita, Manila\nDelivery Period Five (5) days upon receipt of Notice to Proceed',
    }],
  });
  assert.equal(copyright.delivery.deliveryLocation, null);
});

test('OCR-corrupted email is not promoted as preferred contact', () => {
  assert.equal(looksLikeSuspiciousEmail('secretariai@amail.com'), true);
  assert.equal(looksLikeSuspiciousEmail('procurement@dof.gov.ph'), false);

  const result = extractSoftwareRequirements({
    notice: noticeStub({ referenceNumber: '92597' }),
    sources: [{
      filename: 'rfq.pdf',
      usedOcr: true,
      text: 'submitted electronically to rfabac secretariai@amail.com copy furnished',
    }],
  });
  assert.equal(result.submission.contactEmail, null);
  assert.ok(result.submission.contactEmailCandidates.length >= 1);
  assert.ok(result.fieldsNeedingReview.includes('submission.contactEmail'));
});

test('statistical software extracts multiple line items and one-year term', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({ title: 'Procurement of Statistical Software Subscription for One (1) Year' }),
    sources: [{
      filename: 'RFQ_STATA.pdf',
      text: `STATA MP2 V19 (2-CORE) ANNUAL LICENSE
New Account - One (1) License
STATA MP2 V19 (2-CORE) ANNUAL LICENSE
For Renewal - Ten (10) Licenses
DELIVERY PERIOD: 30CD upon receipt of the Purchase Order (PO)`,
    }],
  });
  assert.equal(result.items.length, 2);
  assert.equal(fieldValue(result.items[0].licenses), 1);
  assert.equal(fieldValue(result.items[1].licenses), 10);
  assert.match(String(fieldValue(result.items[0].subscriptionDuration)), /One \(1\) Year/i);
  assert.match(String(fieldValue(result.delivery.deliveryPeriod)), /30CD/i);
});

test('LMS deadline conflict PhilGEPS 09:00 vs RFQ 10:00 is recorded', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({
      referenceNumber: '92597',
      title: 'Cloud-Based Learning Management System Subscription',
      abc: '800,000.00',
      controlNumber: '202609179',
      deadline: '12-Oct-2026 09:00 AM',
      closingDate: '12-Oct-2026 09:00 AM',
      deliveryPeriod: '1',
    }),
    sources: [{
      filename: 'RFQ_LMS.pdf',
      text: `REQUEST FOR QUOTATION
(SVP2026-09-179)
Approved Budget for the Contract: 800,000.00
Delivery Period Five (5) days upon receipt of Notice to Proceed
Submission of Proposal/Price Quotation | Until October 12, 2026 at 10:00 a.m
1. One (1) year subscription of a cloud-based LMS with the operation, maintenance, consultancy, technical and user support, and customization services;
6. Integration and Compatibility: Ensure that the new LMS can seamlessly integrate with existing systems and supports the current training content without requiring extensive modifications;
LMS uptime shall be 99%, except for advance notification of system maintenance
Fully secure (SSL)`,
    }],
  });
  assert.equal(fieldValue(result.financial.abc), '800,000.00');
  assert.equal(result.items[0].usersOrSeats, null);
  assert.match(String(fieldValue(result.delivery.deliveryPeriod)), /Five \(5\) days/i);
  assert.match(String(fieldValue(result.submission.quotationDeadline)), /10:00/i);
  assert.ok(result.conflicts.some((item) => item.field === 'submission.quotationDeadline'));
  assert.ok(result.fieldsNeedingReview.includes('submission.quotationDeadline'));
  assert.equal(fieldValue(result.identification.controlNumber), '202609179');
  assert.equal(fieldValue(result.identification.rfqOrSolicitationNumber), 'SVP2026-09-179');
  assert.equal(
    result.conflicts.some((item) => item.field === 'identification.rfqOrSolicitationNumber'),
    false,
  );
  const tech = [
    ...result.technical.compatibilityRequirements,
    ...result.technical.minimumSpecifications,
    ...result.technical.requiredFeatures,
    ...result.technical.deploymentRequirements,
  ].map((item) => item.value).join(' | ');
  assert.match(tech, /integrate with existing systems/i);
  assert.match(tech, /uptime shall be 99%/i);
});

test('missing fields stay null and are listed; no invented defaults', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({ abc: null, deadline: null, deliveryPeriod: null, title: 'Software Tool' }),
    sources: [{ filename: 'thin.pdf', text: 'Request for Quotation only.' }],
  });
  assert.equal(result.financial.abc, null);
  assert.equal(result.financial.vatWording, null);
  assert.equal(result.delivery.startDate, null);
  assert.equal(result.delivery.endDate, null);
  assert.ok(result.missingFields.includes('financial.abc'));
  assert.equal(JSON.stringify(result).includes('"value":1,"source":null'), false);
});

test('conflicting ABC values are recorded for review', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({ abc: '55,000.00' }),
    sources: [{
      filename: 'RFQ.pdf',
      text: 'Approved Budget for the Contract (ABC): Php 1,127,120.00',
    }],
  });
  assert.equal(result.extractionStatus, 'needs_review');
  assert.ok(result.conflicts.some((item) => item.field === 'financial.abc'));
  assert.ok(result.fieldsNeedingReview.includes('financial.abc'));
});

test('identical technical text is not duplicated across categories', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub(),
    sources: [{
      filename: 'RFQ.pdf',
      text: `-Genuine Software from autodesk.com, with Admin Login from Autodesk and at least 1-year subscription
1 2 Unit Autodesk Civil 3D Latest Edition`,
    }],
  });
  const all = [
    ...result.technical.licenseRequirements,
    ...result.technical.minimumSpecifications,
    ...result.technical.requiredFeatures,
  ].map((item) => item.value);
  const genuine = all.filter((value) => /Genuine Software from autodesk/i.test(value));
  assert.equal(genuine.length, 1);
});

test('provenance helper stores source and confidence', () => {
  const field = sourced(2, 'RFQ.pdf', { page: 1, confidence: 'high' });
  assert.deepEqual(field, {
    value: 2,
    source: 'RFQ.pdf',
    page: 1,
    confidence: 'high',
  });
});

test('requirement extraction does not change classification labels', () => {
  assert.equal(classifyText('Procurement of Statistical Software Subscription for One (1) Year', rules).category, 'software');
  assert.equal(classifyText('Catering Services', rules).isRelevant, false);
});

test('multiple attachments contribute source documents list', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub(),
    sources: [
      { filename: 'RFQ.pdf', text: 'Approved Budget for the Contract (ABC): Php 800,000.00' },
      { filename: 'PQF.pdf', text: '1. One (1) year subscription of a cloud-based LMS with support' },
    ],
  });
  assert.deepEqual(result.sourceDocuments, ['RFQ.pdf', 'PQF.pdf']);
  assert.equal(result.items[0].description.source, 'PQF.pdf');
});

test('BAC Secretariat may remain as weak contact office', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub(),
    sources: [{
      filename: 'dof.pdf',
      text: 'For any clarification, you may contact the BAC Secretariat at (02) 5317-6363\nEmail Address: procurement@dof.gov.ph',
    }],
  });
  assert.equal(fieldValue(result.submission.contactPerson), 'the BAC Secretariat');
  assert.equal(result.submission.contactPerson.confidence, 'low');
  assert.equal(result.submission.contactPerson.role, 'contact_office');
  assert.equal(fieldValue(result.submission.contactEmail), 'procurement@dof.gov.ph');
});

test('incomplete trailing technical-spec fragments are rejected', () => {
  assert.equal(isIncompleteRequirement('Software license certificate or'), true);
  assert.equal(isIncompleteRequirement('Ad-hoc backup shall be conducted at 12:00 midnight every'), true);
  assert.equal(isIncompleteRequirement('Scalable storage and processing speed,'), true);
  assert.equal(isIncompleteRequirement('Ability to operate successfully using various connections (i.'), true);
  assert.equal(
    isIncompleteRequirement('Genuine Software from autodesk.com, with Admin Login from Autodesk and at least 1-year subscription'),
    false,
  );

  const result = extractSoftwareRequirements({
    notice: noticeStub({ title: 'IT Helpdesk Subscription', abc: '1,050,000.00' }),
    sources: [{
      filename: 'RFP.pdf',
      text: `Helpdesk software license compatible w/ the existing IPOPHL Helpdesk System
24 Lic. 12 months
Documentation:
• Software license certificate or
• Invoice & Delivery Receipt
Deadline of Submission of Quotation: October 09, 2026, 10:00AM
Delivery Schedule: 10 Calendar Days upon receipt of the Notice to Proceed`,
    }],
  });
  const allTech = [
    ...result.technical.licenseRequirements,
    ...result.technical.minimumSpecifications,
    ...result.technical.compatibilityRequirements,
  ].map((item) => item.value);
  assert.equal(allTech.some((value) => /Software license certificate or$/i.test(value)), false);
  assert.ok(allTech.some((value) => /IPOPHL Helpdesk/i.test(value)));
});

test('large multi-requirement OCR blocks are split on strong structure', () => {
  const mega = `The LMS shall have a user-oriented functionality to ensure ease of use and seamless learning curve for the end-users. D.1. DETAILED SCOPE OF WORK: = Specestion EE Fully hosted and maintained | = Capacity for at least cloud-based system, with 10,000 enterprise-level security for «Fully secure (SSL) data in transit and at REST. « Enterprise-grade firewall «Ad-hoc backup shall be conducted at 12:00 midnight every day`;
  const parts = splitMergedRequirements(mega);
  assert.ok(parts.length >= 1);
  assert.ok(parts.every((part) => !isIncompleteRequirement(part)));
  assert.ok(parts.every((part) => !/D\.1\. DETAILED SCOPE/i.test(part)));
  assert.ok(parts.some((part) => /user-oriented functionality/i.test(part)));

  const result = extractSoftwareRequirements({
    notice: noticeStub({
      abc: '800,000.00',
      title: 'Cloud-Based Learning Management System Subscription',
      deadline: '12-Oct-2026 09:00 AM',
    }),
    sources: [{
      filename: 'PQF.pdf',
      text: `1. One (1) year subscription of a cloud-based LMS with the operation, maintenance, consultancy, technical and user support, and customization services;
11. The LMS shall have a user-oriented functionality to ensure ease of use and seamless learning curve for the end-users.
D.1. DETAILED SCOPE OF WORK:
= Specestion EE
Fully hosted and maintained | Capacity placeholder
«Fully secure (SSL)
« Enterprise-grade firewall
«Ad-hoc backup shall be conducted at 12:00 midnight every day
LMS uptime shall be 99%, except for advance notification of system maintenance.
Deadline of Submission of Quotation: Until October 12, 2026 at 10:00 a.m
Delivery Period: Five (5) days upon receipt of Notice to Proceed`,
    }],
  });
  const tech = [
    ...result.technical.requiredFeatures,
    ...result.technical.minimumSpecifications,
    ...result.technical.supportRequirements,
    ...result.technical.deploymentRequirements,
    ...result.technical.licenseRequirements,
  ].map((item) => item.value);
  assert.equal(tech.some((value) => value.length > 500 && /uptime[\s\S]*CDN[\s\S]*backup/i.test(value)), false);
  assert.ok(tech.some((value) => /Fully secure \(SSL\)/i.test(value)));
  assert.ok(tech.some((value) => /uptime shall be 99%/i.test(value)));
});

test('legitimate single long requirements are not split', () => {
  const longOne = 'Integration and Compatibility: Ensure that the new LMS can seamlessly integrate with existing systems and supports the current training content without requiring extensive modifications;';
  assert.deepEqual(splitMergedRequirements(longOne), [cleanJoin(longOne)]);

  const result = extractSoftwareRequirements({
    notice: noticeStub({ abc: '800,000.00', deadline: '12-Oct-2026 10:00 AM' }),
    sources: [{
      filename: 'PQF.pdf',
      text: `6. ${longOne}
1. One (1) year subscription of a cloud-based LMS with support
Deadline of Submission of Quotation: October 12, 2026 at 10:00 a.m
Delivery Period: Five (5) days upon receipt of Notice to Proceed`,
    }],
  });
  const tech = [
    ...result.technical.compatibilityRequirements,
    ...result.technical.minimumSpecifications,
    ...result.technical.requiredFeatures,
  ].map((item) => item.value);
  assert.ok(tech.some((value) => /seamlessly integrate with existing systems/i.test(value)));
  assert.equal(tech.filter((value) => /Integration and Compatibility/i.test(value)).length, 1);
});

function cleanJoin(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

test('no technical specifications stay empty without invention', () => {
  const result = extractSoftwareRequirements({
    notice: noticeStub({
      title: 'Procurement of Statistical Software Subscription for One (1) Year',
      abc: '1,184,888.28',
    }),
    sources: [{
      filename: 'RFQ_STATA.pdf',
      text: `STATA MP2 V19 (2-CORE) ANNUAL LICENSE
New Account - One (1) License
For Renewal - Ten (10) Licenses
DELIVERY PERIOD: 30CD upon receipt of the Purchase Order (PO)
Deadline of Submission of Quotation: October 09, 2026, 5:00PM
NOTES: Please refer to the attached Technical Specifications for the detailed requirements`,
    }],
  });
  assert.equal(result.items.length, 2);
  const techCount = [
    ...result.technical.requiredFeatures,
    ...result.technical.minimumSpecifications,
    ...result.technical.compatibilityRequirements,
    ...result.technical.licenseRequirements,
  ].length;
  assert.equal(techCount, 0);
});

test('extraction status is needs_review for material conflicts, not merely finished', () => {
  const conflicted = extractSoftwareRequirements({
    notice: noticeStub({ abc: '55,000.00', deadline: '09-Oct-2026 10:00 AM' }),
    sources: [{
      filename: 'RFQ.pdf',
      text: 'Approved Budget for the Contract: Php 1,127,120.00\n1. 10 License Microsoft office 365 Family License\nDeadline of Submission of Quotation: October 09, 2026, 10:00AM\nDelivery Schedule: 20 Calendar Days upon receipt of the Notice to Proceed',
    }],
  });
  assert.equal(conflicted.extractionStatus, 'needs_review');

  const clean = extractSoftwareRequirements({
    notice: noticeStub({
      referenceNumber: '92301',
      abc: '400,000.00',
      deadline: '09-Oct-2026 08:30 AM',
    }),
    sources: [{
      filename: 'RFQ_Autodesk.pdf',
      text: `1 2 Unit Autodesk Civil 3D Latest Edition
-Genuine Software from autodesk.com, with Admin Login from Autodesk and at least 1-year subscription
Deadline for Submission: on or before October 9, 2026 / 8:30am
Delivery Period: 30 calendar days`,
    }],
  });
  assert.equal(clean.extractionStatus, 'complete');
  assert.equal(fieldValue(clean.items[0].subscriptionDuration), 'at least 1-year subscription');
});
