import { baseUrl } from '../philgeps/client.js';

export function publicNoticeUrl(referenceNumber, storedUrl) {
  const reference = String(referenceNumber || '').trim();
  const stored = String(storedUrl || '').trim();
  if (stored.startsWith(`${baseUrl()}/Indexes/viewLiveTenderDetails/`)) return stored;
  if (!reference) return null;
  return `${baseUrl()}/Indexes/viewLiveTenderDetails/${reference}`;
}

export function publicNoticeFields(packet) {
  const notice = packet?.notice || {};
  return {
    referenceNumber: notice.referenceNumber ?? null,
    title: notice.title ?? null,
    organization: notice.organization ?? null,
    postedDate: notice.postedDate ?? null,
    deadline: notice.deadline ?? null,
    abc: notice.abc ?? null,
    procurementMode: notice.procurementMode ?? null,
    url: publicNoticeUrl(notice.referenceNumber, notice.url || notice.noticeUrl),
  };
}
