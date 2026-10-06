import * as cheerio from 'cheerio';
import { baseUrl } from './client.js';

function clean(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

// PhilGEPS puts some values inside the label ("Notice Reference Number :85876")
// and others in the text node after the label and a <br>.
function labelValue($, labelName) {
  const label = $('label')
    .filter((_, element) => {
      const text = $(element).text().replace(/\s+/g, ' ').trim().toLowerCase();
      return text.startsWith(labelName.toLowerCase());
    })
    .first();

  if (!label.length) return null;

  const ownText = label.text().replace(/\s+/g, ' ').trim();
  const colon = ownText.indexOf(':');
  if (colon !== -1) {
    const inline = clean(ownText.slice(colon + 1));
    if (inline) return inline;
  }

  let node = label.get(0).nextSibling;
  while (node) {
    if (node.type === 'tag' && node.name === 'label') break;
    if (node.type === 'text') {
      const text = clean(node.data);
      if (text) return text;
    }
    node = node.nextSibling;
  }

  return null;
}

function firstLabel($, names) {
  for (const name of names) {
    const value = labelValue($, name);
    if (value) return value;
  }
  return null;
}

function parseLineItems($) {
  const items = [];
  $('table').each((_, table) => {
    const headers = $(table)
      .find('tr')
      .first()
      .find('th, td')
      .map((__, cell) => clean($(cell).text())?.toLowerCase() || '')
      .get();
    if (headers.length === 0) return;

    const indexOf = (patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
    const lotNameIdx = indexOf([/lot\s*name/, /item\s*name/, /description/, /goods/]);
    const qtyIdx = indexOf([/^qty$/, /quantity/]);
    const unitIdx = indexOf([/^uom$/, /unit\s*of\s*measure/, /^unit$/]);
    const unspscIdx = indexOf([/unspsc/]);
    if (lotNameIdx < 0 && unspscIdx < 0) return;

    $(table)
      .find('tr')
      .slice(1)
      .each((__, row) => {
        const cells = $(row)
          .find('td')
          .map((___, cell) => clean($(cell).text()))
          .get();
        if (cells.length === 0) return;
        const lotName = lotNameIdx >= 0 ? cells[lotNameIdx] : null;
        const lotDescription = lotName;
        const quantity = qtyIdx >= 0 ? cells[qtyIdx] : null;
        const unitOfMeasure = unitIdx >= 0 ? cells[unitIdx] : null;
        const unspsc = unspscIdx >= 0 ? cells[unspscIdx] : null;
        if (!lotName && !unspsc && !quantity) return;
        items.push({
          unspsc: unspsc || null,
          lotName: lotName || null,
          lotDescription: lotDescription || null,
          quantity: quantity || null,
          unitOfMeasure: unitOfMeasure || null,
        });
      });
  });
  return items;
}

/** Flatten structured PhilGEPS fields into classification evidence text. */
export function structuredEvidenceText(notice = {}) {
  const parts = [];
  const push = (label, value) => {
    const text = clean(value);
    if (text) parts.push(`${label}: ${text}`);
  };
  push('Title', notice.title || notice.projectTitle);
  push('Business Category', notice.businessCategory);
  push('Procurement Mode', notice.procurementMode);
  push('Description', notice.description);
  push('Lot Type', notice.lotType);
  push('Delivery Period', notice.deliveryPeriod);
  for (const item of notice.lineItems || []) {
    push('Lot Name', item.lotName);
    push('Lot Description', item.lotDescription);
    push('UNSPSC', item.unspsc);
    push('Quantity', item.quantity);
    push('Unit', item.unitOfMeasure);
  }
  return parts.join('\n');
}

export function parseNoticeId(input) {
  const value = String(input ?? '').trim();
  if (/^\d+$/.test(value)) return value;

  const match = value.match(/viewLiveTenderDetails\/(\d+)/i);
  if (match) return match[1];

  throw new Error(
    'Give a PhilGEPS notice number or a viewLiveTenderDetails URL. Example: 85876'
  );
}

export function noticeUrl(noticeId) {
  return `${baseUrl()}/Indexes/viewLiveTenderDetails/${noticeId}`;
}

export function parseNoticeHtml(html, url) {
  const $ = cheerio.load(html);
  const title =
    clean($('center.verdhana_fourteenpx b').first().text()) ||
    clean($('b:contains("Project Name")').parent().text().replace(/Project Name:\s*/i, ''));

  const referenceNumber = firstLabel($, ['Notice Reference Number', 'Reference Number']);
  const controlNumber = firstLabel($, ['Control Number', 'PhilGEPS Control Number', 'Solicitation Number']);
  const organization = firstLabel($, ['Client Agency', 'Government Entity', 'Procuring Entity', 'Agency Name']);
  const postedDate = firstLabel($, ['Published Date', 'Publish Date', 'Date Published']);
  const deadline = firstLabel($, ['Closing Date', 'Close Date', 'Deadline']);
  const abc = firstLabel($, ['Approved Budget of the Contract', 'Approved Budget', 'ABC']);
  const procurementMode = firstLabel($, ['Procurement Mode', 'Mode of Procurement']);
  const businessCategory = firstLabel($, ['Business Category', 'Business / Product Category', 'Product Category', 'Category']);
  const deliveryPeriod = firstLabel($, ['Delivery Period', 'Delivery Schedule']);
  const lotType = firstLabel($, ['Lot Type', 'Type of Contract']);
  const bidValidityPeriod = firstLabel($, ['Bid Validity Period', 'Bid Validity']);
  const description = firstLabel($, ['Description', 'Project Description', 'Abstract']);
  const lineItems = parseLineItems($);

  return {
    notice: {
      title,
      projectTitle: title,
      referenceNumber,
      controlNumber,
      organization,
      governmentEntity: organization,
      postedDate,
      publishedDate: postedDate,
      deadline,
      closingDate: deadline,
      abc,
      procurementMode,
      businessCategory,
      deliveryPeriod,
      lotType,
      bidValidityPeriod,
      description,
      lineItems,
      url,
      noticeUrl: url,
    },
    documentListPath: $('a[href_path*="tender_doc_view"]').attr('href_path') || null,
  };
}
