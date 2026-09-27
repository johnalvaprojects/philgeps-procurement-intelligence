import { classifyText, downloadDecision } from './relevance.js';

export function classificationLabel(relevance) {
  if (!relevance || typeof relevance !== 'object') return null;
  if (relevance.needsReview === true) return 'review';
  if (relevance.isRelevant === true) return 'software';
  if (relevance.isRelevant === false) return 'not relevant';
  return null;
}

export function cachedClassification(packet) {
  if (!packet?.requirements || !packet?.relevance) return null;
  const label = classificationLabel(packet.relevance);
  if (!label) return null;
  return { label };
}

export function noticeScanPlan(notice, rules, packet) {
  const decision = downloadDecision(classifyText(notice?.title || '', rules));
  if (decision === 'skip') return { action: 'skip' };
  const cached = cachedClassification(packet);
  if (cached) return { action: 'reuse', label: cached.label };
  return { action: 'process' };
}
