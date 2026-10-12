import { delay } from '../../../src/log.js';
import { parseAwardDetail, parseAwardList, selectExactAwards } from './parse.js';

const SEARCH_PATH = '/Indexes/getAwardNotices/';

function searchUrl(baseUrl) {
  return `${String(baseUrl).replace(/\/$/, '')}${SEARCH_PATH}`;
}

function cookieHeader(response) {
  const lines = typeof response.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return lines.map((line) => String(line).split(';')[0]).filter(Boolean).join('; ');
}

function formToken(html) {
  return String(html).match(/name="_csrfToken"[^>]*value="([^"]+)"/)?.[1]
    || String(html).match(/value="([^"]+)"[^>]*name="_csrfToken"/)?.[1]
    || '';
}

async function readHtml(response) {
  if (!response?.ok) {
    const error = new Error('The public award search did not respond.');
    error.code = 'HTTP';
    throw error;
  }
  return response.text();
}

async function fetchSearchHtml(reference, { fetchImpl, baseUrl, timeoutMs }) {
  const url = searchUrl(baseUrl);
  const headers = {
    Accept: 'text/html',
    'User-Agent': process.env.USER_AGENT || 'PhilGEPS-Procurement-Intelligence',
  };
  const page = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const html = await readHtml(page);
  const token = formToken(html);
  if (!token) {
    const error = new Error('The public award page could not be read.');
    error.code = 'MALFORMED';
    throw error;
  }
  const body = new URLSearchParams({
    _csrfToken: token,
    searchAwardNoticeNo: '',
    searchRefNo: reference,
    searchLineItem: '',
    searchAwardee: '',
    searchAwardDateFrom: '',
    searchAwardDateTo: '',
  });
  const cookie = cookieHeader(page);
  const posted = await fetchImpl(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: url,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return readHtml(posted);
}

async function fetchDetailHtml(awardNumber, { fetchImpl, baseUrl, timeoutMs }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/Indexes/viewAwardNotice/${awardNumber}`;
  const response = await fetchImpl(url, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return readHtml(response);
}

export async function retrieveAwards(reference, options) {
  const wanted = String(reference);
  try {
    const html = await fetchSearchHtml(wanted, options);
    const parsed = parseAwardList(html);
    const selected = selectExactAwards(parsed.rows, wanted);
    const awards = [];
    const conflicts = [];
    for (const [index, row] of selected.rows.entries()) {
      if (index > 0 && options.delayMs > 0) await delay(options.delayMs);
      let detail;
      try {
        const detailHtml = await fetchDetailHtml(row.awardNumber, options);
        detail = parseAwardDetail(detailHtml, options);
      } catch (error) {
        if (error.code === 'MALFORMED') {
          return { ok: false, referenceNumber: wanted, error: 'The award detail page could not be read.' };
        }
        return { ok: false, referenceNumber: wanted, error: 'The public award search did not respond.' };
      }
      if (detail.awardNumber !== row.awardNumber || detail.bidReference !== wanted) {
        conflicts.push({
          awardNumber: row.awardNumber,
          bidReference: detail.bidReference,
          sourceUrl: detail.sourceUrl,
          reason: 'The public award detail did not match this bid reference.',
        });
        continue;
      }
      awards.push({
        awardNumber: detail.awardNumber,
        bidReference: wanted,
        title: detail.title || row.title,
        supplier: detail.supplier || row.supplier,
        contractAmount: detail.contractAmount,
        awardDate: detail.awardDate || row.awardDate,
        publishedDate: detail.publishedDate,
        status: detail.status,
        sourceUrl: detail.sourceUrl,
      });
    }
    return {
      ok: true,
      referenceNumber: wanted,
      awards,
      conflicts,
      truncated: parsed.truncated || selected.truncated,
    };
  } catch (error) {
    if (error.code === 'MALFORMED') {
      return { ok: false, referenceNumber: wanted, error: 'The public award page could not be read.' };
    }
    return { ok: false, referenceNumber: wanted, error: 'The public award search did not respond.' };
  }
}
