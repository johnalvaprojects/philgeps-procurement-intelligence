import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WINDOW_SAFETY_MAX_PAGES,
  fetchSvpInWindow,
  pageIsBeforeWindow,
  pageReferenceFingerprint,
} from '../src/philgeps/search.js';

const window = {
  start: new Date(2026, 8, 25), // 25-Sep-2026
  end: new Date(2026, 9, 1), // 01-Oct-2026
};

function listHtml(items) {
  return `<table>${items.map((item) => `
  <tr>
    <td><a href="/Indexes/viewLiveTenderDetails/${item.id}">${item.id}</a></td>
    <td data-label="Control Number"><span>${item.title || 'Notice'}</span></td>
    <td data-label="Mode of Procurement"><span>Small Value Procurement</span></td>
    <td data-label="Agency Name"><span>EXAMPLE AGENCY</span></td>
    <td data-label="Publish Date"><span>${item.date}</span></td>
    <td data-label="Closing date"><span>10-Oct-2026 09:00 AM</span></td>
  </tr>`).join('')}</table>`;
}

function captureLogs(run) {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  return Promise.resolve()
    .then(run)
    .finally(() => {
      console.log = original;
    })
    .then((result) => ({ result, lines }));
}

test('pageIsBeforeWindow is false when the page is still on the inclusive FROM day', () => {
  const rows = [
    { postedDate: '25-Sep-2026' },
    { postedDate: '25-Sep-2026 08:00 AM' },
  ];
  assert.equal(pageIsBeforeWindow(rows, window), false);
});

test('pageIsBeforeWindow is true only when every parseable date is before FROM', () => {
  assert.equal(
    pageIsBeforeWindow([{ postedDate: '24-Sep-2026' }, { postedDate: '23-Sep-2026' }], window),
    true,
  );
  assert.equal(
    pageIsBeforeWindow([{ postedDate: '25-Sep-2026' }, { postedDate: '24-Sep-2026' }], window),
    false,
  );
  assert.equal(pageIsBeforeWindow([{ postedDate: '' }], window), false);
});

test('fetchSvpInWindow continues past page 40 while dates remain in the window', async () => {
  const requested = [];
  const { result, lines } = await captureLogs(() => fetchSvpInWindow(window, {
    delay: async () => {},
    getHtml: async (page) => {
      requested.push(page);
      if (page <= 40) {
        return listHtml([{ id: String(1000 + page), date: '01-Oct-2026' }]);
      }
      if (page === 41) {
        return listHtml([{ id: '1041', date: '25-Sep-2026' }]);
      }
      return listHtml([{ id: '1042', date: '24-Sep-2026' }]);
    },
  }));

  assert.ok(requested.includes(41), 'page 41 must be requested after the old 40-page cap');
  assert.ok(requested.includes(42), 'page 42 must be requested while page 41 is still on FROM');
  assert.deepEqual(requested.at(-1), 42);
  assert.equal(result.some((row) => row.referenceNumber === '1041'), true);
  assert.equal(result.some((row) => row.referenceNumber === '1042'), false);
  assert.match(lines.join('\n'), /Reached notices older than requested FROM date/);
  assert.match(lines.join('\n'), /Pagination complete after 42 pages/);
});

test('fetchSvpInWindow stops after a page moves completely before FROM', async () => {
  const requested = [];
  const { result, lines } = await captureLogs(() => fetchSvpInWindow(window, {
    delay: async () => {},
    getHtml: async (page) => {
      requested.push(page);
      if (page === 1) return listHtml([{ id: '1', date: '01-Oct-2026' }]);
      if (page === 2) return listHtml([{ id: '2', date: '25-Sep-2026' }]);
      if (page === 3) return listHtml([{ id: '3', date: '24-Sep-2026' }]);
      throw new Error(`unexpected page ${page}`);
    },
  }));

  assert.deepEqual(requested, [1, 2, 3]);
  assert.deepEqual(result.map((row) => row.referenceNumber), ['1', '2']);
  assert.match(lines.join('\n'), /Reached notices older than requested FROM date/);
  assert.match(lines.join('\n'), /Pagination complete after 3 pages/);
});

test('fetchSvpInWindow keeps inclusive FROM-day notices', async () => {
  const { result } = await captureLogs(() => fetchSvpInWindow(window, {
    delay: async () => {},
    getHtml: async (page) => {
      if (page === 1) return listHtml([{ id: '10', date: '25-Sep-2026' }]);
      if (page === 2) return listHtml([{ id: '11', date: '24-Sep-2026' }]);
      throw new Error(`unexpected page ${page}`);
    },
  }));

  assert.deepEqual(result.map((row) => row.referenceNumber), ['10']);
});

test('a small date window stops naturally without approaching the safety cap', async () => {
  const requested = [];
  const { lines } = await captureLogs(() => fetchSvpInWindow(window, {
    delay: async () => {},
    getHtml: async (page) => {
      requested.push(page);
      if (page === 1) return listHtml([{ id: '21', date: '30-Sep-2026' }]);
      if (page === 2) return listHtml([{ id: '22', date: '24-Sep-2026' }]);
      throw new Error(`unexpected page ${page}`);
    },
  }));

  assert.deepEqual(requested, [1, 2]);
  assert.ok(requested.length < WINDOW_SAFETY_MAX_PAGES);
  assert.match(lines.join('\n'), /Pagination complete after 2 pages/);
  assert.equal(lines.some((line) => /Emergency pagination safety limit/.test(line)), false);
});

test('fetchSvpInWindow stops cleanly on an empty page', async () => {
  const requested = [];
  const { result, lines } = await captureLogs(() => fetchSvpInWindow(window, {
    delay: async () => {},
    getHtml: async (page) => {
      requested.push(page);
      if (page === 1) return listHtml([{ id: '31', date: '01-Oct-2026' }]);
      return '<table></table>';
    },
  }));

  assert.deepEqual(requested, [1, 2]);
  assert.deepEqual(result.map((row) => row.referenceNumber), ['31']);
  assert.match(lines.join('\n'), /No notices returned on this page/);
  assert.match(lines.join('\n'), /Pagination complete after 2 pages/);
});

test('emergency safety limit stops when pages never become older than FROM', async () => {
  const requested = [];
  const safetyLimit = 5;
  const { result, lines } = await captureLogs(() => fetchSvpInWindow(window, {
    maxPages: safetyLimit,
    delay: async () => {},
    getHtml: async (page) => {
      requested.push(page);
      return listHtml([{ id: String(2000 + page), date: '01-Oct-2026' }]);
    },
  }));

  assert.deepEqual(requested, [1, 2, 3, 4, 5]);
  assert.equal(result.length, 5);
  assert.match(lines.join('\n'), /Emergency pagination safety limit reached at page 5/);
  assert.match(lines.join('\n'), /Requested date window may be incomplete/);
  assert.equal(lines.some((line) => /Pagination complete/.test(line)), false);
});

test('repeated consecutive page IDs stop pagination without looping forever', async () => {
  const requested = [];
  const { lines } = await captureLogs(() => fetchSvpInWindow(window, {
    delay: async () => {},
    getHtml: async (page) => {
      requested.push(page);
      return listHtml([{ id: '99', date: '01-Oct-2026' }]);
    },
  }));

  assert.deepEqual(requested, [1, 2]);
  assert.match(lines.join('\n'), /repeated the same notice IDs/);
  assert.match(lines.join('\n'), /Requested date window may be incomplete/);
});

test('pageReferenceFingerprint is stable for the same notice IDs', () => {
  assert.equal(
    pageReferenceFingerprint([{ referenceNumber: '1' }, { referenceNumber: '2' }]),
    pageReferenceFingerprint([{ referenceNumber: '1' }, { referenceNumber: '2' }]),
  );
  assert.notEqual(
    pageReferenceFingerprint([{ referenceNumber: '1' }]),
    pageReferenceFingerprint([{ referenceNumber: '2' }]),
  );
});

test('default emergency safety limit is high enough to replace the old 40-page cap', () => {
  assert.equal(WINDOW_SAFETY_MAX_PAGES, 200);
  assert.ok(WINDOW_SAFETY_MAX_PAGES > 40);
});
