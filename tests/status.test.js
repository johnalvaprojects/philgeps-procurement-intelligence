import assert from 'node:assert/strict';
import test from 'node:test';
import { keepReview, markReviewed } from '../src/review/status.js';

const packet = {
  notice: { referenceNumber: '85876', title: 'Supply and Delivery of Mapping Software' },
  review: { status: 'pending' },
};

test('markReviewed records that a person checked the notice', () => {
  const updated = markReviewed(packet, new Date('2026-09-25T15:23:00.000Z'));
  assert.equal(updated.review.status, 'reviewed');
  assert.equal(updated.review.reviewedAt, '2026-09-25T15:23:00.000Z');
  assert.equal(updated.alreadyReviewed, false);
  assert.equal(updated.notice.title, 'Supply and Delivery of Mapping Software');
});

test('markReviewed keeps the first reviewed time', () => {
  const reviewed = {
    ...packet,
    review: { status: 'reviewed', reviewedAt: '2026-09-25T15:23:00.000Z' },
  };
  const updated = markReviewed(reviewed, new Date('2026-09-26T01:00:00.000Z'));
  assert.equal(updated.alreadyReviewed, true);
  assert.equal(updated.review.reviewedAt, '2026-09-25T15:23:00.000Z');
});

test('keepReview leaves a pending notice pending', () => {
  assert.deepEqual(keepReview({ status: 'pending' }), { status: 'pending' });
  assert.deepEqual(keepReview(undefined), { status: 'pending' });
});

test('markReviewed rejects a file that is not a notice', () => {
  assert.throws(() => markReviewed({}), /not a saved notice/);
});
