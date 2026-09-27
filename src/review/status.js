export function keepReview(review) {
  if (review?.status === 'reviewed' && review.reviewedAt) {
    return { status: 'reviewed', reviewedAt: review.reviewedAt };
  }
  return { status: 'pending' };
}

export function markReviewed(packet, reviewedAt = new Date()) {
  if (!packet?.notice?.referenceNumber) {
    throw new Error('This file is not a saved notice.');
  }

  const kept = keepReview(packet.review);
  if (kept.status === 'reviewed') {
    return { ...packet, review: kept, alreadyReviewed: true };
  }

  const timestamp = reviewedAt instanceof Date ? reviewedAt.toISOString() : String(reviewedAt);
  return {
    ...packet,
    review: { status: 'reviewed', reviewedAt: timestamp },
    alreadyReviewed: false,
  };
}
