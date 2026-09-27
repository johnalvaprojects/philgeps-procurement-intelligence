import * as cheerio from 'cheerio';
import { baseUrl, get, requestDelayMs } from './client.js';
import { delay, log } from '../log.js';

const MAX_LIST_PAGES = 10;
const WINDOW_MAX_PAGES = 40;
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function parsePhilgepsDate(value) {
  const match = String(value || '').trim().match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (month == null) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

function calendarDay(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function manilaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year').value);
  const month = Number(parts.find((part) => part.type === 'month').value);
  const day = Number(parts.find((part) => part.type === 'day').value);
  return new Date(year, month - 1, day);
}

export function publicationWindow(today = new Date(), daysBefore = 3) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - daysBefore);
  return { start, end };
}

export function formatCalendarDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

export function isPublishedInWindow(postedDate, window) {
  const published = parsePhilgepsDate(postedDate);
  if (!published) return false;
  const day = calendarDay(published);
  return day >= calendarDay(window.start) && day <= calendarDay(window.end);
}

export function pageIsBeforeWindow(rows, window) {
  const dates = rows.map((row) => parsePhilgepsDate(row.postedDate)).filter(Boolean);
  if (dates.length === 0) return false;
  return dates.every((date) => calendarDay(date) < calendarDay(window.start));
}

function cellText($, row, label) {
  return $(row).find(`td[data-label="${label}"]`).text().replace(/\s+/g, ' ').trim();
}

export function parseOpportunityRows(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('tr').each((_, row) => {
    const link = $(row).find('a[href*="viewLiveTenderDetails/"]').first();
    const href = link.attr('href') || '';
    const referenceNumber = href.match(/viewLiveTenderDetails\/(\d+)/)?.[1];
    if (!referenceNumber) return;

    rows.push({
      referenceNumber,
      title: cellText($, row, 'Control Number'),
      mode: cellText($, row, 'Mode of Procurement'),
      organization: cellText($, row, 'Agency Name'),
      postedDate: cellText($, row, 'Publish Date'),
      deadline: cellText($, row, 'Closing date'),
      url: `${baseUrl()}/Indexes/viewLiveTenderDetails/${referenceNumber}`,
    });
  });

  return rows;
}

export function selectLatestSvp(rows, limit) {
  const selected = [];

  for (const row of rows) {
    if (!/small value procurement/i.test(row.mode)) continue;
    if (selected.some((item) => item.referenceNumber === row.referenceNumber)) continue;
    selected.push(row);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function reachedBatchLimit(processedCount, limit) {
  return limit != null && processedCount >= limit;
}

export function batchLimit(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error('The batch size must be a whole number, for example 5.');
  }
  return number;
}

export function selectSvpInWindow(rows, window) {
  const selected = [];

  for (const row of rows) {
    if (!/small value procurement/i.test(row.mode || '')) continue;
    if (!isPublishedInWindow(row.postedDate, window)) continue;
    if (selected.some((item) => item.referenceNumber === row.referenceNumber)) continue;
    selected.push(row);
  }

  return selected;
}

export async function fetchSvpInWindow(window, maxPages = WINDOW_MAX_PAGES) {
  const selected = [];
  let coveredWindow = false;

  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1) await delay(requestDelayMs());
    const url = `${baseUrl()}/indexes/view-more-open-tenders?page=${page}&direction=Tenders.id+desc`;
    log('INFO', `Reading open notices, page ${page}`);
    const html = await get(url);
    const rows = parseOpportunityRows(html);
    if (rows.length === 0) {
      coveredWindow = true;
      break;
    }

    for (const row of selectSvpInWindow(rows, window)) {
      if (!selected.some((item) => item.referenceNumber === row.referenceNumber)) selected.push(row);
    }

    if (pageIsBeforeWindow(rows, window)) {
      log('INFO', 'Publish dates on this page are before the scan window');
      coveredWindow = true;
      break;
    }
  }

  if (!coveredWindow) {
    log('WARN', `Stopped after ${maxPages} list pages before the publish dates moved fully before the scan window.`);
  }

  return selected;
}

export async function fetchLatestSvp(limit) {
  const selected = [];

  for (let page = 1; page <= MAX_LIST_PAGES && selected.length < limit; page += 1) {
    if (page > 1) await delay(requestDelayMs());
    const url = `${baseUrl()}/indexes/view-more-open-tenders?page=${page}&direction=Tenders.id+desc`;
    log('INFO', `Reading open notices, page ${page}`);
    const html = await get(url);
    const pageRows = selectLatestSvp(parseOpportunityRows(html), limit - selected.length);
    selected.push(...pageRows.filter((row) => !selected.some((item) => item.referenceNumber === row.referenceNumber)));
  }

  if (selected.length === 0) {
    throw new Error('No Small Value Procurement notices were found on the public list.');
  }

  return selected.slice(0, limit);
}
