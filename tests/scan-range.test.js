import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatIsoDay } from '../src/documents/metadata.js';
import { manilaToday, publicationWindow } from '../src/philgeps/search.js';
import {
  parseIsoCalendarDay,
  parseScanRangeBody,
  resolveScanPublicationWindow,
} from '../src/scan-range.js';
import { validateScanRange, formatScanRangeLabel } from '../frontend/src/scan-range.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function dayKey(date) {
  return formatIsoDay(date);
}

test('parseIsoCalendarDay accepts real days and rejects impossible ones', () => {
  assert.equal(dayKey(parseIsoCalendarDay('2026-09-28')), '2026-09-28');
  assert.equal(parseIsoCalendarDay('2026-02-31'), null);
  assert.equal(parseIsoCalendarDay('2026-13-01'), null);
  assert.equal(parseIsoCalendarDay('09-28-2026'), null);
  assert.equal(parseIsoCalendarDay(''), null);
});

test('parseScanRangeBody accepts valid and same-day ranges', () => {
  const range = parseScanRangeBody({ from: '2026-09-28', to: '2026-09-30' });
  assert.equal(range.ok, true);
  assert.equal(range.from, '2026-09-28');
  assert.equal(range.to, '2026-09-30');
  assert.equal(dayKey(range.window.start), '2026-09-28');
  assert.equal(dayKey(range.window.end), '2026-09-30');

  const same = parseScanRangeBody({ from: '2026-09-28', to: '2026-09-28' });
  assert.equal(same.ok, true);
  assert.equal(dayKey(same.window.start), dayKey(same.window.end));
});

test('parseScanRangeBody rejects inverted, incomplete, and malformed ranges', () => {
  assert.equal(parseScanRangeBody({ from: '2026-09-30', to: '2026-09-28' }).ok, false);
  assert.match(parseScanRangeBody({ from: '2026-09-30', to: '2026-09-28' }).error, /on or before/i);

  assert.equal(parseScanRangeBody({ from: '2026-09-28' }).ok, false);
  assert.equal(parseScanRangeBody({ to: '2026-09-30' }).ok, false);
  assert.equal(parseScanRangeBody({ from: 'not-a-date', to: '2026-09-30' }).ok, false);
  assert.equal(parseScanRangeBody({ from: '2026-02-31', to: '2026-03-01' }).ok, false);
});

test('parseScanRangeBody with no range uses default behavior marker', () => {
  const empty = parseScanRangeBody({});
  assert.deepEqual(empty, { ok: true, window: null });
  assert.deepEqual(parseScanRangeBody(undefined), { ok: true, window: null });
});

test('resolveScanPublicationWindow keeps the default 3-day lookback', () => {
  const expected = publicationWindow(manilaToday(), 3);
  const resolved = resolveScanPublicationWindow({});
  assert.equal(dayKey(resolved.start), dayKey(expected.start));
  assert.equal(dayKey(resolved.end), dayKey(expected.end));
});

test('resolveScanPublicationWindow keeps a custom window unchanged', () => {
  const window = {
    start: new Date(2026, 8, 28),
    end: new Date(2026, 8, 30),
  };
  assert.equal(resolveScanPublicationWindow({ window }), window);
});

test('runScan resolves a window then passes it to fetchSvpInWindow', () => {
  const scanSource = readFileSync(path.join(root, 'src', 'scan.js'), 'utf8');
  assert.match(scanSource, /resolveScanPublicationWindow\(options\)/);
  assert.match(scanSource, /fetchSvpInWindow\(window\)/);
  assert.match(scanSource, /export async function runScan\(options = \{\}\)/);
});

test('frontend validateScanRange covers valid, same-day, inverted, and incomplete ranges', () => {
  assert.deepEqual(validateScanRange('', ''), { ok: true, payload: null });
  assert.deepEqual(
    validateScanRange('2026-09-28', '2026-09-30'),
    { ok: true, payload: { from: '2026-09-28', to: '2026-09-30' } },
  );
  assert.deepEqual(
    validateScanRange('2026-09-28', '2026-09-28'),
    { ok: true, payload: { from: '2026-09-28', to: '2026-09-28' } },
  );
  assert.equal(validateScanRange('2026-09-30', '2026-09-28').ok, false);
  assert.equal(validateScanRange('2026-09-28', '').ok, false);
  assert.equal(validateScanRange('', '2026-09-30').ok, false);
  assert.equal(validateScanRange('2026-02-31', '2026-03-01').ok, false);
  assert.equal(formatScanRangeLabel('2026-09-28', '2026-09-30'), 'SEP 28 — SEP 30');
});
