import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyDocumentForNotice, classifyText, classifyWithoutDocument, downloadDecision, inspectionDecision, shouldDownloadAll } from '../src/classification/relevance.js';
import { buildRequirements, parseLineItems, toProcurementDocument } from '../src/extraction/requirements.js';
import { hasUsableText } from '../src/extraction/pdf.js';

const rules = JSON.parse(readFileSync(new URL('../config/relevance.json', import.meta.url), 'utf8'));
const rfq = readFileSync(new URL('./fixtures/rfq-excerpt.txt', import.meta.url), 'utf8');

const notice = {
  title: 'Supply and Delivery of Mapping Software',
  deadline: '29-Sep-2026 12:00 PM',
  abc: '1,070,000.00',
  url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/85876',
};

test('hasUsableText rejects a nearly empty scan and accepts a real RFQ', () => {
  assert.equal(hasUsableText('Page 1'), false);
  assert.equal(hasUsableText(rfq), true);
});

test('parseLineItems reads both software lines from the RFQ table', () => {
  const items = parseLineItems(rfq);

  assert.equal(items.length, 2);
  assert.equal(items[0].itemNumber, '1');
  assert.equal(items[0].itemReference, '2026-05-0913-GSITD-LFP-DAP');
  assert.equal(items[0].name, 'Photogrammetry Software - Agisoft Metashape Professional (Perpetual)');
  assert.equal(items[0].quantity, 1);
  assert.equal(items[0].unit, 'unit');
  assert.equal(items[0].licenseDuration, 'Perpetual');
  assert.equal(items[0].abcUnitCost, '320,000.00');
  assert.equal(items[1].itemNumber, '2');
  assert.equal(items[1].itemReference, '2026-06-1219-WRMD-LFP-SPIS-CONT.');
  assert.equal(items[1].name, 'Civil 3D engineering software (1 Year Subscription)');
  assert.equal(items[1].quantity, 5);
  assert.equal(items[1].licenseDuration, '1 Year Subscription');
  assert.equal(items[1].abcUnitCost, '150,000.00');
});

test('buildRequirements keeps only details written in the document', () => {
  const requirements = buildRequirements({
    notice,
    documentName: 'mapping-software.pdf',
    text: rfq,
  });

  assert.equal(requirements.productOrService, 'Supply and Delivery of Mapping Software');
  assert.equal(requirements.description, null);
  assert.equal(requirements.rfqControlNumber, '2026-RFQ-0313');
  assert.notEqual(requirements.rfqControlNumber, requirements.items[0].itemReference);
  assert.equal(requirements.abc, '1,070,000.00');
  assert.equal(requirements.deadline, 'September 29, 2026, 12:00:00 PM');
  assert.equal(requirements.delivery.place, 'BSWM, Quezon City');
  assert.equal(requirements.delivery.period, '30 Calendar days upon receipt of PO/JO');
  assert.equal(requirements.awarding, 'PER LINE ITEM');
  assert.match(requirements.paymentTerms, /Upon completion of delivery\/services/);
  assert.equal(requirements.technicalSpecifications.length, 0);
  assert.equal(requirements.items[0].technicalSpecifications.length, 0);
  assert.equal(requirements.requiredFeatures.length, 0);
  assert.equal(requirements.supportRequirements.length, 0);
  assert.equal(requirements.maintenanceRequirements.length, 0);
  assert.deepEqual(
    requirements.requiredDocuments.map((item) => item.text),
    [
      'Mayor’s Permit',
      'PhilGEPS Registration',
      'Notarized Omnibus Sworn Statement (for 50k above)',
      'Income Tax Return (for ABC 500k above)',
    ]
  );
  assert.equal(requirements.deliveryRequirements[0].text, 'Place of Delivery: BSWM, Quezon City');
  assert.equal(requirements.deliveryRequirements[1].text, '30 Calendar days upon receipt of PO/JO');
  assert.equal(requirements.sourceNoticeUrl, notice.url);
  assert.equal(requirements.items[0].sourceQuote.includes('Agisoft'), true);
  assert.equal(
    JSON.stringify(requirements).includes('Name of Company'),
    false
  );
  assert.equal(
    JSON.stringify(requirements.requirements).includes('PhilGEPS Registration Number'),
    false
  );

  const document = toProcurementDocument(requirements);
  assert.equal(document.rfqControlNumber, '2026-RFQ-0313');
  assert.deepEqual(
    document.lineItems.map((item) => item.itemReference),
    ['2026-05-0913-GSITD-LFP-DAP', '2026-06-1219-WRMD-LFP-SPIS-CONT.']
  );
  assert.equal(document.lineItems[0].quantity, 1);
  assert.equal(document.lineItems[1].abcUnitCost, '150,000.00');
});

test('bidder form fields are not stored as procurement requirements', () => {
  const requirements = buildRequirements({
    notice,
    documentName: 'mapping-software.pdf',
    text: `${rfq}\nReceiver Name\nReceiver Account No.\nSignature over Printed Name\nPosition/Designation\n`,
  });
  const saved = JSON.stringify({
    requiredDocuments: requirements.requiredDocuments,
    requirements: requirements.requirements,
    items: requirements.items,
  });
  assert.equal(saved.includes('Receiver Name'), false);
  assert.equal(saved.includes('Receiver Account No.'), false);
  assert.equal(saved.includes('Signature over Printed Name'), false);
  assert.equal(saved.includes('Position/Designation'), false);
});

test('classifyText marks software, hardware, and mixed notices differently', () => {
  const software = classifyText(rfq, rules);
  assert.equal(software.isRelevant, true);
  assert.equal(software.category, 'software');
  assert.equal(software.needsReview, false);

  const hardware = classifyText('Supply and delivery of laptop computers and printers', rules);
  assert.equal(hardware.isRelevant, false);
  assert.equal(hardware.category, 'hardware');

  const itEquipment = classifyText('Procurement Project: Procurement of IT Equipment for CY 2026', rules);
  assert.equal(itEquipment.isRelevant, false);
  assert.equal(itEquipment.category, 'hardware');

  const mixed = classifyText('Software subscription and laptop computers', rules);
  assert.equal(mixed.isRelevant, false);
  assert.equal(mixed.needsReview, true);
  assert.equal(mixed.category, 'mixed');

  const unknown = classifyText('Supply and Delivery of IT Solution', rules);
  assert.equal(unknown.category, 'unknown');
  assert.equal(unknown.needsReview, true);

  const catering = classifyText('Catering for the training workshop', rules);
  assert.equal(catering.isRelevant, false);
  assert.equal(catering.needsReview, false);
});

test('downloadDecision keeps software titles, skips hardware, and inspects unclear titles', () => {
  const software = downloadDecision(classifyText('Supply and Delivery of Mapping Software', rules));
  const hardware = downloadDecision(classifyText('Supply and Delivery of IT Equipment', rules));
  const computers = downloadDecision(classifyText('Desktop Computers', rules));
  const unclear = downloadDecision(classifyText('Supply and Delivery of IT Solution', rules));

  assert.equal(software, 'download');
  assert.equal(hardware, 'skip');
  assert.equal(computers, 'skip');
  assert.equal(unclear, 'inspect');
  assert.equal(classifyText('Supply of technology equipment', rules).isRelevant, false);
  assert.equal(shouldDownloadAll('download', false), true);
  assert.equal(shouldDownloadAll('inspect', true), true);
  assert.equal(shouldDownloadAll('inspect', false), false);
  assert.equal(shouldDownloadAll('skip', true), false);
  assert.equal(inspectionDecision(classifyText('Supply and Delivery of Mapping Software', rules)), 'software');
  assert.equal(inspectionDecision(classifyText('Supply and Delivery of IT Equipment', rules)), 'skip');
  assert.equal(inspectionDecision(classifyText('Catering for the training workshop', rules)), 'skip');
  assert.equal(inspectionDecision(classifyText('Software subscription and laptop computers', rules)), 'unclear');

  const internet = classifyText('INTERNET SUBSCRIPTION EXPENSE', rules);
  assert.equal(internet.isRelevant, false);
  assert.equal(internet.needsReview, false);
  assert.equal(downloadDecision(internet), 'skip');
  assert.equal(classifyText('Adobe Framemaker (1-year Subscription)', rules).isRelevant, true);
  assert.equal(classifyText('PROCUREMENT OF ONE (1) LOT PDF EDITING STANDARD SUBSCRIPTION', rules).isRelevant, true);
  assert.equal(classifyText('Antivirus for Desktop/Laptop and Servers (Endpoint Security)', rules).isRelevant, false);
});

test('a vague document counts software only when it describes that notice', () => {
  const meals = classifyDocumentForNotice(
    'All documented information printed from the Quality Management Information System (QMIS) are deemed uncontrolled. Meals and snacks for the venue.',
    rules,
    'Supply and delivery of meals and snacks and Lease of venue and accomodation'
  );
  assert.equal(meals.isRelevant, false);

  const electrical = classifyDocumentForNotice(
    'Procurement of various Architectural and Engineering Design (A&E) Software (Subscription Based). Supply of common electrical equipment and supplies.',
    rules,
    'Supply and delivery of Common Electrical Equipment and Supplies'
  );
  assert.equal(electrical.isRelevant, false);

  const production = classifyDocumentForNotice(
    'Digital non-linear audio editing on sound forge software. Animation and editing software / tools and equipment. Professional Editing Software and equipment.',
    rules,
    'SERVICES FOR THE PRODUCTION OF AUDIO-VISUAL PRESENTATION'
  );
  assert.equal(production.isRelevant, false);

  const hardDrive = classifyDocumentForNotice(
    'Plug And Play (No Software Required). Procurement of IT Equipment and laptop.',
    rules,
    'Supply and delivery of ICT Equipment'
  );
  assert.notEqual(hardDrive.category, 'software');

  const mapping = classifyDocumentForNotice(
    'Supply and Delivery of Mapping Software for the planning section.',
    rules,
    'Supply and Delivery of Mapping Software'
  );
  assert.equal(mapping.isRelevant, true);
  assert.equal(mapping.category, 'software');
});

test('a title match is not treated as relevant when the document could not be read', () => {
  const result = classifyWithoutDocument(
    'Capacity building and integration into the Project Management Information System',
    rules
  );
  assert.equal(result.isRelevant, false);
  assert.equal(result.needsReview, true);
  assert.match(result.reasons[0], /no readable text/i);
});
