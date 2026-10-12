import * as cheerio from 'cheerio';

const LIST_REFERENCE = 'Bid Notice Reference number';
const MAX_DETAIL_PAGES = 25;

export function normalizeReference(value) {
  const text = String(value ?? '').trim();
  return /^\d{3,12}$/.test(text) ? text : '';
}

function clean(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function cells($, row) {
  return $(row).find('th,td').map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get();
}

function labelNode($, name) {
  const wanted = name.toLowerCase();
  return $('label').filter((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
    return text === wanted || text.startsWith(`${wanted}:`) || text.startsWith(`${wanted} :`);
  }).first();
}

function valueAfterLabel($, name) {
  const label = labelNode($, name);
  if (!label.length) return null;
  let node = label[0].nextSibling;
  while (node) {
    if (node.type === 'tag' && node.name === 'br') {
      node = node.nextSibling;
      continue;
    }
    const text = clean($(node).text());
    if (node.type === 'tag' && node.name === 'label') return text;
    if (text) return text;
    node = node.nextSibling;
  }
  return null;
}

export function parseAwardList(html) {
  const source = String(html ?? '');
  const $ = cheerio.load(source);
  let table = null;
  $('table').each((_, candidate) => {
    const labels = cells($, $(candidate).find('tr').first());
    if (labels.includes(LIST_REFERENCE)) table = candidate;
  });
  if (!table) {
    if (/No Records Found/i.test($.root().text())) return { rows: [], truncated: false };
    const error = new Error('The public award page could not be read.');
    error.code = 'MALFORMED';
    throw error;
  }

  const header = cells($, $(table).find('tr').first());
  const index = new Map(header.map((label, position) => [label, position]));
  const rows = [];
  $(table).find('tr').slice(1).each((_, row) => {
    const values = cells($, row);
    if (values.every((value) => !value)) return;
    rows.push({
      awardNumber: normalizeReference(values[index.get('Award Notice Number')]),
      bidReference: normalizeReference(values[index.get(LIST_REFERENCE)]),
      title: clean(values[index.get('Award Title')]),
      supplier: clean(values[index.get('Awardee')]),
      awardDate: clean(values[index.get('Award Date')]),
    });
  });
  return { rows, truncated: false };
}

export function selectExactAwards(rows, reference) {
  const wanted = normalizeReference(reference);
  const seen = new Set();
  const matches = [];
  for (const row of rows) {
    if (!wanted || row.bidReference !== wanted || !row.awardNumber) continue;
    if (seen.has(row.awardNumber)) continue;
    seen.add(row.awardNumber);
    matches.push(row);
  }
  return {
    rows: matches.slice(0, MAX_DETAIL_PAGES),
    truncated: matches.length > MAX_DETAIL_PAGES,
  };
}

export function officialAwardUrl(baseUrl, awardNumber) {
  const number = normalizeReference(awardNumber);
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!number || !base) return null;
  return `${base}/Indexes/viewAwardNotice/${number}`;
}

export function parseAwardDetail(html, { baseUrl } = {}) {
  const $ = cheerio.load(String(html ?? ''));
  const heading = labelNode($, 'Award Notice Number').text();
  const awardNumber = normalizeReference(heading.match(/\d+/)?.[0]);
  if (!awardNumber) {
    const error = new Error('The award detail page could not be read.');
    error.code = 'MALFORMED';
    throw error;
  }
  return {
    awardNumber,
    bidReference: normalizeReference(valueAfterLabel($, 'Notice Reference Number')) || null,
    title: clean($('.wrapped-long-string').first().text()),
    supplier: valueAfterLabel($, 'Awardee'),
    contractAmount: valueAfterLabel($, 'Contract Amount'),
    awardDate: valueAfterLabel($, 'Award Date'),
    publishedDate: valueAfterLabel($, 'Published Date'),
    status: valueAfterLabel($, 'Status'),
    sourceUrl: officialAwardUrl(baseUrl, awardNumber),
  };
}
