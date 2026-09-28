import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classifyDocumentForNotice, classifyText, downloadDecision } from './classification/relevance.js';
import { buildNoticeMetadata, savedNoticeFiles, updateMetadataClassification, writeNoticeMetadata } from './documents/metadata.js';
import { extractDocumentText } from './extraction/extract.js';
import { hasUsableText } from './extraction/pdf.js';
import { procurementPortion } from './extraction/requirements.js';
import { get, requestDelayMs } from './philgeps/client.js';
import { noticeUrl, parseNoticeHtml } from './philgeps/notices.js';
import { confirmVagueNotice, downloadAllAttachments, loadDocumentLinks } from './process-notice.js';
import { classificationFields } from './review/decision.js';
import { attachWorkStatus } from './review/work-status.js';
import { addReclassifyResult, emptyReclassifyCounts, formatReclassifySummary } from './review/summary.js';
import { delay, log, writeLogBlock } from './log.js';

function unclearRelevance(reason) {
  return {
    isRelevant: false,
    needsReview: true,
    confidence: 0.35,
    category: 'unknown',
    reasons: [reason],
  };
}

export function firstExtractedSection(body) {
  const text = String(body || '');
  const parts = text.split(/\n(?=Source: )/);
  return parts[0].replace(/^Source:[^\n]*\n*/, '');
}

export function classifySavedDocument(text, rules, title) {
  if (!hasUsableText(text)) {
    return unclearRelevance('The attached document did not provide enough text to classify the notice.');
  }
  const portion = procurementPortion(text).slice(0, 4000);
  return classifyDocumentForNotice(portion, rules, title);
}

export function applyAutomaticClassification(packet, relevance) {
  return attachWorkStatus({
    ...packet,
    relevance,
    ...classificationFields(relevance, packet?.review),
  }, packet);
}

export function packetHasLocalFiles(packet) {
  return (packet?.documents || []).some((document) => document?.localPath && existsSync(document.localPath));
}

export async function readSavedInspectionText(noticeId, packet, outputDir) {
  const extractedPath = path.join(outputDir, `${noticeId}.extracted.txt`);
  if (existsSync(extractedPath)) {
    return firstExtractedSection(await readFile(extractedPath, 'utf8'));
  }

  const local = (packet?.documents || []).find((document) => document?.localPath && existsSync(document.localPath));
  if (!local) return null;

  try {
    const extracted = await extractDocumentText(local.localPath);
    return extracted.hasUsableText ? extracted.text : '';
  } catch (error) {
    if (error?.code === 'OCR_TIMEOUT' || error?.code === 'UNSUPPORTED_DOCUMENT' || error?.code === 'UNREADABLE_DOCUMENT') return '';
    throw error;
  }
}

async function inspectOnePublicAttachment(noticeId, title, rules) {
  await delay(requestDelayMs());
  const url = noticeUrl(noticeId);
  const parsed = parseNoticeHtml(await get(url), url);
  const links = await loadDocumentLinks(parsed, url);
  if (links.length === 0) {
    return {
      outcome: 'unclear',
      relevance: unclearRelevance('No public attachment was available to inspect.'),
      inspectedFile: false,
    };
  }
  const inspection = await confirmVagueNotice(links, rules, noticeId, title);
  return { ...inspection, inspectedFile: true };
}

async function downloadFullAttachmentSet(noticeId) {
  const url = noticeUrl(noticeId);
  const parsed = parseNoticeHtml(await get(url), url);
  const links = await loadDocumentLinks(parsed, url);
  return downloadAllAttachments(noticeId, links);
}

export async function reclassifyNotice(packet, {
  rules,
  readSavedText,
  inspectTemporary,
  downloadAll,
  hasLocalFiles = packetHasLocalFiles(packet),
} = {}) {
  if (packet?.classificationSource === 'manual') {
    return {
      packet,
      manual: true,
      reclassified: false,
      temporaryInspection: false,
      fullDownload: false,
      isRelevant: packet?.relevance?.isRelevant,
      needsReview: packet?.relevance?.needsReview,
    };
  }

  const title = packet?.notice?.title || '';
  const titleRelevance = classifyText(title, rules);
  const decision = downloadDecision(titleRelevance);

  if (decision === 'skip') {
    const next = applyAutomaticClassification(packet, titleRelevance);
    return {
      packet: next,
      manual: false,
      reclassified: true,
      temporaryInspection: false,
      fullDownload: false,
      isRelevant: next.relevance.isRelevant,
      needsReview: next.relevance.needsReview,
    };
  }

  if (decision === 'download') {
    let next = applyAutomaticClassification(packet, titleRelevance);
    let fullDownload = false;
    if (!hasLocalFiles) {
      const documents = await downloadAll();
      next = { ...next, documents: [...(packet.documents || []), ...documents] };
      fullDownload = true;
    }
    return {
      packet: next,
      manual: false,
      reclassified: true,
      temporaryInspection: false,
      fullDownload,
      isRelevant: next.relevance.isRelevant,
      needsReview: next.relevance.needsReview,
    };
  }

  const savedText = await readSavedText();
  if (typeof savedText === 'string') {
    const next = applyAutomaticClassification(packet, classifySavedDocument(savedText, rules, title));
    return {
      packet: next,
      manual: false,
      reclassified: true,
      temporaryInspection: false,
      fullDownload: false,
      isRelevant: next.relevance.isRelevant,
      needsReview: next.relevance.needsReview,
    };
  }

  const inspection = await inspectTemporary();
  let next = applyAutomaticClassification(packet, inspection.relevance);
  let fullDownload = false;
  if (inspection.outcome === 'software') {
    const documents = await downloadAll();
    next = { ...next, documents: [...(packet.documents || []), ...documents] };
    fullDownload = true;
  }
  return {
    packet: next,
    manual: false,
    reclassified: true,
    temporaryInspection: inspection.inspectedFile !== false,
    fullDownload,
    isRelevant: next.relevance.isRelevant,
    needsReview: next.relevance.needsReview,
  };
}

async function saveReclassifiedPacket(outputDir, noticeId, packet) {
  const outputPath = path.join(outputDir, `${noticeId}.json`);
  await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
  return outputPath.split(path.sep).join('/');
}

async function updateSavedMetadata(noticeId, packet, documentsRoot, { files = null } = {}) {
  const fileList = Array.isArray(files) && files.length > 0 ? files : undefined;
  const existing = await updateMetadataClassification(noticeId, packet, documentsRoot, { files: fileList });
  if (existing || !fileList) return existing;
  return writeNoticeMetadata(buildNoticeMetadata({
    noticeId,
    title: packet.notice?.title,
    publishDate: packet.notice?.postedDate,
    classification: packet.classification,
    classificationSource: packet.classificationSource,
    reviewed: packet.reviewed,
    reviewedAt: packet.reviewedAt,
    files: fileList,
  }), documentsRoot);
}

export async function runReclassify({
  outputDir = path.join('data', 'output'),
  documentsRoot = path.join('data', 'documents'),
  rules,
  refreshReviewList = async () => {},
  readSavedText = (noticeId, packet) => readSavedInspectionText(noticeId, packet, outputDir),
  inspectTemporary = (noticeId, packet) => inspectOnePublicAttachment(noticeId, packet?.notice?.title || '', rules),
  downloadAll = (noticeId) => downloadFullAttachmentSet(noticeId),
  hasLocalFiles = packetHasLocalFiles,
} = {}) {
  const started = Date.now();
  const names = (await readdir(outputDir)).filter((name) => /^\d+\.json$/.test(name)).sort();
  const counts = emptyReclassifyCounts();

  for (const name of names) {
    const noticeId = name.replace(/\.json$/, '');
    const outputPath = path.join(outputDir, name);
    log('INFO', `Reclassifying notice ${noticeId}`);
    try {
      const packet = JSON.parse(await readFile(outputPath, 'utf8'));
      const result = await reclassifyNotice(packet, {
        rules,
        hasLocalFiles: hasLocalFiles(packet),
        readSavedText: () => readSavedText(noticeId, packet),
        inspectTemporary: () => inspectTemporary(noticeId, packet),
        downloadAll: () => downloadAll(noticeId, packet),
      });
      if (result.manual) {
        log('INFO', `Notice ${noticeId} has a manual classification. Left unchanged.`);
      } else {
        await saveReclassifiedPacket(outputDir, noticeId, result.packet);
        const newFiles = result.fullDownload ? savedNoticeFiles(result.packet.documents) : null;
        await updateSavedMetadata(noticeId, result.packet, documentsRoot, { files: newFiles });
        for (const note of result.packet.relevance?.notes || []) log('INFO', note);
        log('INFO', `Classification: ${result.packet.classification}`);
        log('INFO', `Saved result ${outputPath.split(path.sep).join('/')}`);
      }
      addReclassifyResult(counts, result);
    } catch (error) {
      log('ERROR', `Notice ${noticeId} failed: ${error.message}`);
      addReclassifyResult(counts, { error: error.message });
    }
  }

  const durationMs = Date.now() - started;
  log('INFO', 'Reclassify completed');
  writeLogBlock(formatReclassifySummary({ counts, durationMs }));
  await refreshReviewList();
  return { counts, durationMs };
}
