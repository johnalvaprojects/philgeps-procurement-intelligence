import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DATE_SOURCE_ISO,
  DATE_SOURCE_PHILGEPS,
  formatCompactDate,
  formatDetailDate,
  formatLongDate,
  isCalendarDay,
  parseKnownCalendarDate,
} from '../frontend/src/format.js';

test('PhilGEPS DD-Mon-YYYY displays month-first without shifting the calendar day', () => {
  assert.equal(formatCompactDate('06-Oct-2026'), '10/06/2026');
  assert.equal(formatLongDate('06-Oct-2026'), 'October 06, 2026');
  assert.deepEqual(parseKnownCalendarDate('6-Oct-2026'), {
    year: 2026,
    month: 10,
    day: 6,
    timeText: null,
  });
});

test('known ISO calendar days format only when the source is explicit', () => {
  assert.equal(formatCompactDate('2026-10-06', DATE_SOURCE_ISO), '10/06/2026');
  assert.equal(formatLongDate('2026-10-06', DATE_SOURCE_ISO), 'October 06, 2026');
  assert.equal(formatCompactDate('2026-10-06'), '2026-10-06');
  assert.equal(formatCompactDate('2026-10-06', DATE_SOURCE_PHILGEPS), '2026-10-06');
});

test('numeric slash dates are not inferred', () => {
  assert.equal(formatCompactDate('08/10/2026'), '08/10/2026');
  assert.equal(formatLongDate('10/08/2026', DATE_SOURCE_ISO), '10/08/2026');
  assert.equal(formatDetailDate('08/10/2026'), '08/10/2026');
  assert.equal(parseKnownCalendarDate('08/10/2026', 'slash'), null);
});

test('original clock time is preserved and the date is not moved', () => {
  assert.equal(formatCompactDate('06-Oct-2026 1:00 PM'), '10/06/2026 1:00 PM');
  assert.equal(formatLongDate('06-Oct-2026 12:00 AM'), 'October 06, 2026 12:00 AM');
  assert.equal(formatCompactDate('2026-10-06 00:00', DATE_SOURCE_ISO), '10/06/2026 00:00');
  assert.equal(formatDetailDate('2026-10-06T00:00:00.000Z'), '2026-10-06T00:00:00.000Z');
});

test('leap days are accepted and invalid calendar days stay unchanged', () => {
  assert.equal(isCalendarDay(2024, 2, 29), true);
  assert.equal(isCalendarDay(2023, 2, 29), false);
  assert.equal(isCalendarDay(2024, 2, 30), false);
  assert.equal(formatCompactDate('29-Feb-2024'), '02/29/2024');
  assert.equal(formatLongDate('29-Feb-2024'), 'February 29, 2024');
  assert.equal(formatCompactDate('29-Feb-2023'), '29-Feb-2023');
  assert.equal(formatCompactDate('31-Feb-2026'), '31-Feb-2026');
  assert.equal(formatCompactDate('2024-02-29', DATE_SOURCE_ISO), '02/29/2024');
  assert.equal(formatCompactDate('2023-02-29', DATE_SOURCE_ISO), '2023-02-29');
});

test('missing dates and unrecognized prose are not invented', () => {
  assert.equal(formatCompactDate(null), '—');
  assert.equal(formatLongDate(''), '—');
  assert.equal(formatDetailDate('not-a-date'), 'not-a-date');
  assert.equal(formatDetailDate('on or before 15 October 2026'), 'on or before 15 October 2026');
  assert.equal(formatDetailDate('06-Oct-2026'), 'October 06, 2026');
  assert.equal(formatDetailDate('2026-09-25'), 'September 25, 2026');
});
