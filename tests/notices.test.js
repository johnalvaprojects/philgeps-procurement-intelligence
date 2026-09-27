import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNoticeHtml, parseNoticeId } from '../src/philgeps/notices.js';

const noticeHtml = `
<label>Notice Reference Number :85876</label>
<label>Approved Budget of the Contract: </label></br>
1,070,000.00</br>
<label>Client Agency: </label></br>BUREAU OF SOILS AND WATER MANAGEMENT</br>
<label>Published Date: </label></br>25-Sep-2026 12:00 AM  </br>
<label>Closing Date:</label></br>  29-Sep-2026 12:00 PM </br>
<center class="verdhana_fourteenpx">
  <b>Supply and Delivery of Mapping Software</b>
</center>
<label>Documents:</label>
<a href_path="/Tenders/tender_doc_view/85876/85876">Preview</a>
`;

test('parseNoticeId accepts a number or a notice URL', () => {
  assert.equal(parseNoticeId('85876'), '85876');
  assert.equal(
    parseNoticeId('https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/85876'),
    '85876'
  );
  assert.throws(() => parseNoticeId('not-a-notice'), /notice number/);
});

test('parseNoticeHtml reads the public notice fields', () => {
  const parsed = parseNoticeHtml(noticeHtml, 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/85876');

  assert.deepEqual(parsed.notice, {
    title: 'Supply and Delivery of Mapping Software',
    referenceNumber: '85876',
    organization: 'BUREAU OF SOILS AND WATER MANAGEMENT',
    postedDate: '25-Sep-2026 12:00 AM',
    deadline: '29-Sep-2026 12:00 PM',
    abc: '1,070,000.00',
    url: 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/85876',
  });
  assert.equal(parsed.documentListPath, '/Tenders/tender_doc_view/85876/85876');
});

test('parseNoticeHtml leaves missing fields empty', () => {
  const parsed = parseNoticeHtml('<html></html>', 'https://philgeps.gov.ph/Indexes/viewLiveTenderDetails/1');

  assert.equal(parsed.notice.title, null);
  assert.equal(parsed.notice.referenceNumber, null);
  assert.equal(parsed.notice.abc, null);
  assert.equal(parsed.documentListPath, null);
});
