import assert from 'node:assert/strict';
import test from 'node:test';
import { filterDayTime, padCount, publishTime } from '../frontend/src/format.js';
import {
  countClassifications,
  filterNotices,
  noticesInPublishedRange,
} from '../frontend/src/notices.js';

const sample = [
  {
    referenceNumber: '1',
    title: 'Alpha software',
    organization: 'Agency A',
    postedDate: '20-Sep-2026',
    classification: 'software',
    workStatus: 'new',
  },
  {
    referenceNumber: '2',
    title: 'Beta review',
    organization: 'Agency B',
    postedDate: '25-Sep-2026',
    classification: 'review',
  },
  {
    referenceNumber: '3',
    title: 'Gamma goods',
    organization: 'Agency C',
    postedDate: '29-Sep-2026',
    classification: 'not relevant',
  },
  {
    referenceNumber: '4',
    title: 'Broken date',
    organization: 'Agency D',
    postedDate: 'not-a-date',
    classification: 'software',
    workStatus: 'new',
  },
];

function ids(notices) {
  return notices.map((notice) => notice.referenceNumber);
}

test('filterDayTime and publishTime compare the same calendar day', () => {
  assert.equal(filterDayTime('2026-09-25'), publishTime('25-Sep-2026'));
  assert.equal(filterDayTime('2026-09-25'), publishTime('25-Sep-2026 12:00 AM'));
  assert.equal(filterDayTime('not-a-date'), null);
});

test('no published date filter keeps previous filter behavior', () => {
  assert.deepEqual(ids(filterNotices(sample, { query: '', classification: 'all' })), ['1', '2', '3', '4']);
  assert.deepEqual(ids(filterNotices(sample, { query: 'Beta', classification: 'all' })), ['2']);
});

test('FROM only keeps notices on or after that day', () => {
  assert.deepEqual(
    ids(filterNotices(sample, { query: '', classification: 'all', publishedFrom: '2026-09-25' })),
    ['2', '3'],
  );
});

test('TO only keeps notices on or before that day', () => {
  assert.deepEqual(
    ids(filterNotices(sample, { query: '', classification: 'all', publishedTo: '2026-09-25' })),
    ['1', '2'],
  );
});

test('FROM and TO are inclusive and exclude unparseable dates', () => {
  assert.deepEqual(
    ids(filterNotices(sample, {
      query: '',
      classification: 'all',
      publishedFrom: '2026-09-20',
      publishedTo: '2026-09-25',
    })),
    ['1', '2'],
  );
});

test('published date filter works with classification and search', () => {
  assert.deepEqual(
    ids(filterNotices(sample, {
      query: '',
      classification: 'software',
      publishedFrom: '2026-09-20',
      publishedTo: '2026-09-29',
    })),
    ['1'],
  );
  assert.deepEqual(
    ids(filterNotices(sample, {
      query: 'Gamma',
      classification: 'not relevant',
      publishedFrom: '2026-09-29',
    })),
    ['3'],
  );
  assert.deepEqual(
    ids(filterNotices(sample, {
      query: '',
      classification: 'review',
      publishedTo: '2026-09-24',
    })),
    [],
  );
});

test('summary counts use all stored notices when no published date filter', () => {
  const counts = countClassifications(noticesInPublishedRange(sample));
  assert.deepEqual(counts, {
    all: 4,
    software: 2,
    review: 1,
    notRelevant: 1,
  });
  assert.equal(padCount(counts.software), '002');
});

test('summary counts follow published date filter only', () => {
  const scoped = noticesInPublishedRange(sample, '2026-09-25', '2026-09-29');
  const counts = countClassifications(scoped);
  assert.deepEqual(counts, {
    all: 2,
    software: 0,
    review: 1,
    notRelevant: 1,
  });
  assert.equal(padCount(counts.software), '000');
});

test('search and classification do not redefine published-range summary counts', () => {
  const summary = countClassifications(noticesInPublishedRange(sample, '2026-09-20', '2026-09-29'));
  const list = filterNotices(sample, {
    query: 'Alpha',
    classification: 'software',
    publishedFrom: '2026-09-20',
    publishedTo: '2026-09-29',
  });
  assert.equal(summary.all, 3);
  assert.equal(summary.software, 1);
  assert.equal(list.length, 1);
  assert.notEqual(summary.all, list.length);
});
