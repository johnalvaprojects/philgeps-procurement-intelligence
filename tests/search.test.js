import assert from 'node:assert/strict';
import test from 'node:test';
import {
  batchLimit,
  isPublishedInWindow,
  parseOpportunityRows,
  publicationWindow,
  selectLatestSvp,
  selectSvpInWindow,
} from '../src/philgeps/search.js';

const html = `
<table>
  <tr>
    <td><a href="https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/86969/OPEN_MORE">86969</a></td>
    <td data-label="Control Number"><span>Supply and Delivery of Mapping Software</span></td>
    <td data-label="Mode of Procurement"><span>Small Value Procurement</span></td>
    <td data-label="Agency Name"><span>BUREAU OF SOILS AND WATER MANAGEMENT</span></td>
    <td data-label="Publish Date"><span>26-Sep-2026</span></td>
    <td data-label="Closing date"><span>01-Oct-2026 09:00 AM</span></td>
  </tr>
  <tr>
    <td><a href="/Indexes/viewLiveTenderDetails/86900">86900</a></td>
    <td data-label="Control Number"><span>Construction of a classroom</span></td>
    <td data-label="Mode of Procurement"><span>Competitive Bidding (Public Bidding)</span></td>
    <td data-label="Agency Name"><span>EXAMPLE AGENCY</span></td>
    <td data-label="Publish Date"><span>26-Sep-2026</span></td>
    <td data-label="Closing date"><span>16-Oct-2026 09:00 AM</span></td>
  </tr>
  <tr>
    <td><a href="https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/86880">86880</a></td>
    <td data-label="Control Number"><span>Supply of office chairs</span></td>
    <td data-label="Mode of Procurement"><span>Small Value Procurement</span></td>
    <td data-label="Agency Name"><span>EXAMPLE SCHOOL</span></td>
    <td data-label="Publish Date"><span>25-Sep-2026</span></td>
    <td data-label="Closing date"><span>30-Sep-2026 10:00 AM</span></td>
  </tr>
</table>
`;

test('parseOpportunityRows reads the public listing columns', () => {
  const rows = parseOpportunityRows(html);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].referenceNumber, '86969');
  assert.equal(rows[0].title, 'Supply and Delivery of Mapping Software');
  assert.equal(rows[0].mode, 'Small Value Procurement');
  assert.equal(rows[0].organization, 'BUREAU OF SOILS AND WATER MANAGEMENT');
  assert.equal(rows[0].url, 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/86969');
});

test('selectLatestSvp keeps Small Value Procurement notices in list order', () => {
  const selected = selectLatestSvp(parseOpportunityRows(html), 1);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].referenceNumber, '86969');
  assert.deepEqual(
    selectLatestSvp(parseOpportunityRows(html), 5).map((row) => row.referenceNumber),
    ['86969', '86880']
  );
});

test('batchLimit uses the whole number passed to --svp', () => {
  assert.equal(batchLimit('5'), 5);
  assert.equal(batchLimit(10), 10);
  assert.equal(batchLimit('20'), 20);
  assert.equal(batchLimit(50), 50);
  assert.throws(() => batchLimit(0), /whole number/);
  assert.throws(() => batchLimit('many'), /whole number/);
});

test('the scan window is three days before today through today', () => {
  const today = new Date(2026, 8, 26);
  const window = publicationWindow(today, 3);
  assert.equal(isPublishedInWindow('23-Sep-2026', window), true);
  assert.equal(isPublishedInWindow('24-Sep-2026', window), true);
  assert.equal(isPublishedInWindow('25-Sep-2026 12:00 AM', window), true);
  assert.equal(isPublishedInWindow('26-Sep-2026', window), true);
  assert.equal(isPublishedInWindow('22-Sep-2026', window), false);
  assert.equal(isPublishedInWindow('27-Sep-2026', window), false);
  assert.equal(isPublishedInWindow('', window), false);
});

test('selectSvpInWindow uses the publish date and ignores other procurement modes', () => {
  const window = publicationWindow(new Date(2026, 8, 26), 3);
  const selected = selectSvpInWindow(parseOpportunityRows(html), window);
  assert.deepEqual(selected.map((row) => row.referenceNumber), ['86969', '86880']);
});
