import assert from 'node:assert/strict';
import test from 'node:test';
import { fileHref, packetFromRequirements, packetsToRows, renderReviewList, resultLabel, rowFromPacket } from '../src/review/list.js';

test('resultLabel matches the batch table', () => {
  assert.equal(resultLabel({ isRelevant: true, needsReview: false }), 'relevant');
  assert.equal(resultLabel({ isRelevant: false, needsReview: false }), 'not relevant');
  assert.equal(resultLabel({ isRelevant: false, needsReview: true }), 'review');
  assert.equal(resultLabel(null), 'review');
});

test('fileHref points from the review page to saved files', () => {
  assert.equal(
    fileHref('data/documents/85876/mapping software.pdf'),
    '../documents/85876/mapping%20software.pdf',
  );
  assert.equal(fileHref('data/output/85876.extracted.txt'), '85876.extracted.txt');
  assert.equal(fileHref('https://philgeps.gov.ph/file.pdf'), '');
});

test('rowFromPacket keeps notice fields and local file links', () => {
  const row = rowFromPacket({
    notice: {
      referenceNumber: '85876',
      organization: 'BUREAU OF SOILS AND WATER MANAGEMENT',
      title: 'Supply and Delivery of Mapping Software',
      deadline: '29-Sep-2026 12:00 PM',
      url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/85876',
    },
    documents: [
      {
        filename: 'mapping.pdf',
        localPath: 'data/documents/85876/mapping.pdf',
        extractedTextPath: 'data/output/85876.extracted.txt',
      },
      {
        filename: 'copy.pdf',
        localPath: 'data/documents/85876/copy.pdf',
        extractedTextPath: 'data/output/85876.extracted.txt',
      },
    ],
    relevance: { isRelevant: true, needsReview: false },
  });

  assert.equal(row.result, 'relevant');
  assert.equal(row.deadline, '29-Sep-2026 12:00 PM');
  assert.equal(row.files.length, 3);
  assert.equal(row.files[0].href, '../documents/85876/mapping.pdf');
  assert.equal(row.files[2].label, 'extracted text');
});

test('packetFromRequirements keeps written requirements and leaves the rest empty', () => {
  const packet = packetFromRequirements({
    productOrService: 'Supply and Delivery of Mapping Software',
    items: [
      {
        name: 'Photogrammetry Software <Agisoft>',
        quantity: 1,
        unit: 'unit',
        licenseDuration: 'Perpetual',
        abcUnitCost: '320,000.00',
      },
    ],
    deliveryRequirements: [{ text: 'Place of Delivery: BSWM, Quezon City' }],
    certifications: [{ text: 'PhilGEPS Registration' }],
    technicalSpecifications: [],
    abc: '1,070,000.00',
    otherRequirements: [{ text: 'AWARDING: PER LINE ITEM' }],
  });

  assert.equal(packet.productOrService, 'Supply and Delivery of Mapping Software');
  assert.equal(packet.items[0].quantity, 1);
  assert.equal(packet.items[0].licenseDuration, 'Perpetual');
  assert.deepEqual(packet.technicalSpecifications, []);
  assert.deepEqual(packet.requiredFeatures, []);
  assert.deepEqual(packet.scopeOfWork, []);
  assert.equal(packet.deliveryRequirements[0], 'Place of Delivery: BSWM, Quezon City');
  assert.equal(packet.abc, '1,070,000.00');
});

test('packetsToRows sorts newest reference first and skips a packet with no reference', () => {
  const rows = packetsToRows([
    { notice: { referenceNumber: '85876' }, relevance: { isRelevant: true, needsReview: false } },
    { notice: {} },
    { notice: { referenceNumber: '86969' }, relevance: { needsReview: true } },
  ]);
  assert.deepEqual(rows.map((row) => row.referenceNumber), ['86969', '85876']);
});

test('renderReviewList escapes title text and links the notice', () => {
  const html = renderReviewList([
    {
      referenceNumber: '86774',
      organization: 'PCSO',
      title: 'IT <Equipment> & "hardware"',
      result: 'not relevant',
      deadline: '05-Oct-2026 12:00 PM',
      noticeUrl: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/86774',
      files: [{ label: 'rfq.pdf', href: '../documents/86774/rfq.pdf' }],
    },
  ], new Date('2026-09-25T14:41:00.000Z'));

  assert.match(html, /IT &lt;Equipment&gt; &amp; &quot;hardware&quot;/);
  assert.doesNotMatch(html, /IT <Equipment>/);
  assert.match(html, /href="https:\/\/philgeps.gov.ph\/Indexes\/viewLiveTenderDetails\/86774"/);
  assert.match(html, /href="\.\.\/documents\/86774\/rfq\.pdf"/);
  assert.match(html, /Not Relevant/);
  assert.match(html, /2026-09-25T14:41:00.000Z/);
  assert.match(html, /No line items were read from this document/);
  assert.match(html, /pending/);
});

test('renderReviewList shows saved line items and skips empty requirement sections', () => {
  const html = renderReviewList([
    {
      referenceNumber: '85876',
      organization: 'BSWM',
      title: 'Supply and Delivery of Mapping Software',
      result: 'relevant',
      deadline: '29-Sep-2026 12:00 PM',
      noticeUrl: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/85876',
      files: [],
      reviewStatus: 'reviewed',
      packet: packetFromRequirements({
        productOrService: 'Supply and Delivery of Mapping Software',
        abc: '1,070,000.00',
        items: [
          {
            name: 'Photogrammetry Software <Agisoft>',
            quantity: 1,
            unit: 'unit',
            licenseDuration: 'Perpetual',
            abcUnitCost: '320,000.00',
          },
        ],
        deliveryRequirements: [{ text: 'Place of Delivery: BSWM, Quezon City' }],
        technicalSpecifications: [],
        supportRequirements: [],
      }),
    },
  ], new Date('2026-09-25T15:17:00.000Z'));

  assert.match(html, /Photogrammetry Software &lt;Agisoft&gt;/);
  assert.match(html, /class="reviewed">reviewed/);
  assert.match(html, /Perpetual/);
  assert.match(html, /320,000.00/);
  assert.match(html, /Place of Delivery: BSWM, Quezon City/);
  assert.doesNotMatch(html, /Technical specifications/);
  assert.doesNotMatch(html, /Support/);
});
