import { manilaToday, parsePhilgepsDate } from '../../../src/philgeps/search.js';

export const DEFAULT_BATCH_LIMIT = 8;
export const MAX_BATCH_LIMIT = 15;

function dayValue(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function deadlineValue(deadline) {
  const date = parsePhilgepsDate(deadline);
  return date ? dayValue(date) : null;
}

function byCheckOrder(left, right) {
  const leftNever = left.outcome === 'never' ? 0 : 1;
  const rightNever = right.outcome === 'never' ? 0 : 1;
  if (leftNever !== rightNever) return leftNever - rightNever;
  return String(left.lastCheckedAt || '').localeCompare(String(right.lastCheckedAt || ''));
}

export function selectBatch(notices, storedByReference, {
  limit = DEFAULT_BATCH_LIMIT,
  now = new Date(),
  classification = null,
} = {}) {
  const today = dayValue(manilaToday(now));
  const past = [];
  const later = [];
  for (const notice of notices) {
    if (classification && notice.classification !== classification) continue;
    const referenceNumber = String(notice.referenceNumber || '');
    const stored = storedByReference.get(referenceNumber);
    const item = {
      referenceNumber,
      deadline: notice.deadline || null,
      outcome: stored?.outcome || 'never',
      lastCheckedAt: stored?.lastCheckedAt || null,
    };
    const deadline = deadlineValue(item.deadline);
    if (deadline != null && deadline < today) past.push(item);
    else later.push(item);
  }
  past.sort(byCheckOrder);
  later.sort(byCheckOrder);
  return [...past, ...later].slice(0, limit).map((item) => item.referenceNumber);
}
