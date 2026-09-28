import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classificationLabel } from '../classification/cache.js';
import { attachWorkStatus } from './work-status.js';
import { updateMetadataDecision } from '../documents/metadata.js';
import { parseNoticeId } from '../philgeps/notices.js';
import { log } from '../log.js';
import { packetsToRows, renderReviewList } from './list.js';

const MANUAL_REASON = /^A person (marked this notice|kept this notice)/;

export function normalizeDecision(decision) {
  const value = String(decision || '').trim().toLowerCase().replaceAll(' ', '-');
  if (value === 'software') return 'software';
  if (value === 'not-relevant' || value === 'notrelevant') return 'not-relevant';
  if (value === 'review' || value === 'keep-for-review') return 'review';
  throw new Error('Decision must be software, not-relevant, or review.');
}

export function classificationFields(relevance, review) {
  return {
    classification: classificationLabel(relevance) || 'review',
    classificationSource: 'automatic',
    reviewed: review?.status === 'reviewed',
    reviewedAt: review?.reviewedAt || null,
  };
}

export function applyManualDecision(packet, decision, reviewedAt = new Date()) {
  if (!packet?.notice?.referenceNumber) {
    throw new Error('This file is not a saved notice.');
  }

  const choice = normalizeDecision(decision);
  const timestamp = reviewedAt instanceof Date ? reviewedAt.toISOString() : String(reviewedAt);
  const relevance = { ...(packet.relevance || {}) };
  const reasons = (Array.isArray(relevance.reasons) ? relevance.reasons : []).filter((reason) => !MANUAL_REASON.test(reason));
  let classification;

  if (choice === 'software') {
    classification = 'software';
    relevance.isRelevant = true;
    relevance.needsReview = false;
    relevance.category = 'software';
    reasons.push('A person marked this notice as software.');
  } else if (choice === 'not-relevant') {
    classification = 'not relevant';
    relevance.isRelevant = false;
    relevance.needsReview = false;
    relevance.category = 'hardware';
    reasons.push('A person marked this notice as not relevant.');
  } else {
    classification = 'review';
    relevance.isRelevant = false;
    relevance.needsReview = true;
    if (relevance.category === 'software' || relevance.category === 'hardware') relevance.category = 'unknown';
    reasons.push('A person kept this notice for review.');
  }

  relevance.reasons = reasons;
  return attachWorkStatus({
    ...packet,
    classification,
    classificationSource: 'manual',
    reviewed: true,
    reviewedAt: timestamp,
    relevance,
    review: { status: 'reviewed', reviewedAt: timestamp, source: 'manual' },
  }, packet);
}

export async function saveManualDecision(noticeId, decision, {
  outputDir = path.join('data', 'output'),
  documentsRoot = path.join('data', 'documents'),
  reviewedAt = new Date(),
} = {}) {
  const outputPath = path.join(outputDir, `${noticeId}.json`);
  const packet = JSON.parse(await readFile(outputPath, 'utf8'));
  const updated = applyManualDecision(packet, decision, reviewedAt);
  await writeFile(outputPath, `${JSON.stringify(updated, null, 2)}\n`);
  await updateMetadataDecision(noticeId, updated, documentsRoot);
  return updated;
}

async function rebuildReviewList(outputDir) {
  await mkdir(outputDir, { recursive: true });
  const names = await readdir(outputDir);
  const packets = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    packets.push(JSON.parse(await readFile(path.join(outputDir, name), 'utf8')));
  }
  await writeFile(path.join(outputDir, 'review.html'), renderReviewList(packetsToRows(packets)));
}

export async function decideSavedNotice(referenceInput, decisionInput, {
  outputDir = path.join('data', 'output'),
  documentsRoot = path.join('data', 'documents'),
  reviewedAt = new Date(),
} = {}) {
  let noticeId;
  try {
    noticeId = parseNoticeId(referenceInput);
  } catch (error) {
    error.code = 'INVALID_NOTICE_ID';
    throw error;
  }

  let decision;
  try {
    decision = normalizeDecision(decisionInput);
  } catch (error) {
    error.code = 'INVALID_DECISION';
    throw error;
  }

  const outputPath = path.join(outputDir, `${noticeId}.json`);
  if (!existsSync(outputPath)) {
    const error = new Error(`No saved notice ${noticeId}. Run that notice before choosing a decision.`);
    error.code = 'NOTICE_NOT_FOUND';
    throw error;
  }

  const updated = await saveManualDecision(noticeId, decision, { outputDir, documentsRoot, reviewedAt });
  log('INFO', `Saved manual decision for notice ${noticeId}: ${decision}`);
  await rebuildReviewList(outputDir);
  log('INFO', 'Saved review list data/output/review.html');
  return updated;
}
