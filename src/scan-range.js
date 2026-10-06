import { formatIsoDay } from './documents/metadata.js';
import { manilaToday, publicationWindow } from './philgeps/search.js';

function calendarDay(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

/** Parse YYYY-MM-DD into a local calendar Date, or null if invalid/impossible. */
export function parseIsoCalendarDay(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

function present(value) {
  return value != null && String(value).trim() !== '';
}

/**
 * Validate optional scan body `{ from, to }`.
 * Returns `{ ok: true, window: null }` when no range (use default).
 * Returns `{ ok: true, window, from, to }` for a custom range.
 * Returns `{ ok: false, error }` for invalid input.
 */
export function parseScanRangeBody(body = {}) {
  const rawFrom = body?.from;
  const rawTo = body?.to;
  const hasFrom = present(rawFrom);
  const hasTo = present(rawTo);

  if (!hasFrom && !hasTo) {
    return { ok: true, window: null };
  }

  if (hasFrom !== hasTo) {
    return { ok: false, error: 'Both from and to are required' };
  }

  const start = parseIsoCalendarDay(String(rawFrom).trim());
  const end = parseIsoCalendarDay(String(rawTo).trim());
  if (!start || !end) {
    return { ok: false, error: 'from and to must be valid YYYY-MM-DD dates' };
  }

  if (calendarDay(start) > calendarDay(end)) {
    return { ok: false, error: 'from must be on or before to' };
  }

  return {
    ok: true,
    window: { start, end },
    from: formatIsoDay(start),
    to: formatIsoDay(end),
  };
}

/** Resolve the publication window for a scan: custom window or default 3-day lookback. */
export function resolveScanPublicationWindow(options = {}) {
  if (options.window?.start && options.window?.end) {
    return options.window;
  }
  return publicationWindow(manilaToday(), 3);
}
