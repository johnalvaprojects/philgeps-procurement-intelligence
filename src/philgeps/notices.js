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

  return {
    notice: {
      title,
      referenceNumber: labelValue($, 'Notice Reference Number'),
      organization: labelValue($, 'Client Agency'),
      postedDate: labelValue($, 'Published Date'),
      deadline: labelValue($, 'Closing Date'),
      abc: labelValue($, 'Approved Budget of the Contract'),
      url,
    },
    documentListPath: $('a[href_path*="tender_doc_view"]').attr('href_path') || null,
  };
}
