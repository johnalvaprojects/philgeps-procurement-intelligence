import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDocumentForNotice, classifyText, downloadDecision, inspectionDecision, shouldDownloadAll } from './classification/relevance.js';
import { extractDocumentText } from './extraction/extract.js';
import { buildRequirements, procurementPortion, toProcurementDocument } from './extraction/requirements.js';
import { get, requestDelayMs } from './philgeps/client.js';
import {
  chooseOriginalFilename,
  fallbackAttachmentName,
  parseDocumentLinks,
  removeNoticeDownloads,
  removeTemporaryInspection,
  saveDocument,
  saveTemporaryInspection,
} from './philgeps/documents.js';
import { noticeUrl, parseNoticeHtml, parseNoticeId } from './philgeps/notices.js';
import { buildNoticeMetadata, savedNoticeFiles, writeNoticeMetadata } from './documents/metadata.js';
import { classificationFields } from './review/decision.js';
import { attachWorkStatus } from './review/work-status.js';
import { keepReview } from './review/status.js';
import { delay, log } from './log.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSavedPacket(noticeId) {
  const outputPath = path.join('data', 'output', `${noticeId}.json`);
  if (!existsSync(outputPath)) return null;
  try {
    return JSON.parse(readFileSync(outputPath, 'utf8'));
  } catch {
    return null;
  }
}

function savedReview(noticeId) {
  const saved = readSavedPacket(noticeId);
  if (!saved) return { status: 'pending' };
  return keepReview(saved.review);
}

function savedManual(noticeId) {
  const saved = readSavedPacket(noticeId);
  if (saved?.classificationSource !== 'manual') return null;
  return saved;
}

export async function processNotice(input) {
  const noticeId = parseNoticeId(input);
  const url = noticeUrl(noticeId);

  log('INFO', `Processing notice ${noticeId}`);
  const noticeHtml = await get(url);
  const parsed = parseNoticeHtml(noticeHtml, url);

  if (!parsed.notice.referenceNumber) {
    throw new Error('The page did not look like a PhilGEPS notice. No reference number was found.');
  }

  const rules = JSON.parse(readFileSync(path.join(root, 'config', 'relevance.json'), 'utf8'));
  const titleRelevance = classifyText(parsed.notice.title || '', rules);
  logRelevanceNotes(titleRelevance);
  const decision = downloadDecision(titleRelevance);

  if (decision === 'skip') {
    log('INFO', 'Classification: hardware');
    log('INFO', 'Skipped without downloading attachments');
    log('INFO', `Skipped notice ${noticeId}. The title is hardware, so documents were not downloaded.`);
    await discardNoticeDownloads(noticeId);
    return saveResult({
      noticeId,
      notice: parsed.notice,
      documents: [],
      relevance: titleRelevance,
      text: '',
      documentName: null,
    });
  }

  const links = await loadDocumentLinks(parsed, url);
  let relevance = titleRelevance;

  if (decision === 'inspect') {
    const inspection = await confirmVagueNotice(links, rules, noticeId, parsed.notice.title);
    if (shouldDownloadAll(decision, inspection.outcome === 'software')) {
      relevance = { ...titleRelevance, isRelevant: true, needsReview: false, category: 'software' };
      log('INFO', `Notice ${noticeId} is software. Downloading every public attachment.`);
    } else if (inspection.outcome === 'skip') {
      await discardNoticeDownloads(noticeId);
      log('INFO', 'Classification: hardware');
      log('INFO', 'Skipped without downloading attachments');
      log('INFO', `Skipped notice ${noticeId}. The document is not a software purchase.`);
      return saveResult({
        noticeId,
        notice: parsed.notice,
        documents: [],
        relevance: inspection.relevance,
        text: '',
        documentName: null,
      });
    } else {
      await discardNoticeDownloads(noticeId);
      log('INFO', 'Classification: review');
      log('INFO', `Notice ${noticeId} marked for review`);
      log('INFO', `Notice ${noticeId} is still unclear. Marked for review.`);
      return saveResult({
        noticeId,
        notice: parsed.notice,
        documents: [],
        relevance: inspection.relevance,
        text: '',
        documentName: null,
      });
    }
  } else {
    log('INFO', `Notice ${noticeId} title is software. Downloading every public attachment.`);
  }

  const documents = await downloadAllAttachments(noticeId, links);
  const savedFiles = documents.filter((document) => document.localPath);
  log('INFO', 'Classification: software');
  log('INFO', `Downloaded ${savedFiles.length} attachment${savedFiles.length === 1 ? '' : 's'}`);
  const extractedParts = await readSavedDocuments(documents);
  const combinedText = extractedParts.map((part) => part.text).join('\n');
  const sourceName = extractedParts.map((part) => part.filename).join(', ');

  return saveResult({
    noticeId,
    notice: parsed.notice,
    documents,
    relevance,
    text: combinedText,
    documentName: sourceName || null,
    extractedParts,
  });
}

export async function loadDocumentLinks(parsed, noticePageUrl) {
  if (!parsed.documentListPath) {
    log('INFO', 'Found 0 attachments');
    return [];
  }

  await delay(requestDelayMs());
  const documentListUrl = new URL(parsed.documentListPath, noticePageUrl).href;
  log('INFO', 'Opening the public document list');
  const documentHtml = await get(documentListUrl, { ajax: true, referer: noticePageUrl });
  const links = parseDocumentLinks(documentHtml);
  log('INFO', `Found ${links.length} attachment${links.length === 1 ? '' : 's'}`);
  return links;
}

function logRelevanceNotes(relevance) {
  for (const note of relevance?.notes || []) log('INFO', note);
}

function unclearRelevance(reason) {
  return {
    isRelevant: false,
    needsReview: true,
    confidence: 0.35,
    category: 'unknown',
    reasons: [reason],
  };
}

export function inspectionOutcomeFromError(error) {
  if (error?.code === 'OCR_TIMEOUT') {
    return {
      timedOut: true,
      outcome: 'unclear',
      relevance: unclearRelevance('OCR timed out before the document could be classified.'),
    };
  }

  return {
    timedOut: false,
    outcome: 'unclear',
    relevance: unclearRelevance('The attached document could not be read, so a person should review the notice.'),
  };
}

export async function inspectTemporaryFile(temporary, noticeId, task) {
  try {
    return await task();
  } catch (error) {
    const inspection = inspectionOutcomeFromError(error);
    if (inspection.timedOut) {
      const seconds = Math.max(1, Math.round((error.timeoutMs || 15000) / 1000));
      log('WARN', `Notice ${noticeId} OCR timed out after ${seconds} seconds`);
      log('INFO', `Notice ${noticeId} marked for review`);
      log('WARN', `OCR timed out while inspecting notice ${noticeId}. Marked for review.`);
    } else {
      log('INFO', `Could not classify the temporary file: ${error.message}`);
    }
    return { outcome: inspection.outcome, relevance: inspection.relevance };
  } finally {
    if (temporary) {
      try {
        await removeTemporaryInspection(temporary.directory);
        log('INFO', 'Removed the temporary inspection file');
      } catch (cleanupError) {
        log('ERROR', `Could not remove the temporary inspection file: ${cleanupError.message}`);
      }
    }
  }
}

export async function confirmVagueNotice(links, rules, noticeId, noticeTitle) {
  if (links.length === 0) {
    return {
      outcome: 'unclear',
      relevance: unclearRelevance('No public attachment was available to inspect.'),
    };
  }

  await delay(requestDelayMs());
  log('INFO', `Temporarily reading ${links[0].filename} to check the vague title`);
  const bytes = await get(links[0].url, { as: 'buffer' });
  const temporary = await saveTemporaryInspection(links[0].filename, bytes);

  return inspectTemporaryFile(temporary, noticeId, async () => {
    const extracted = await extractDocumentText(temporary.filePath);
    if (!extracted.hasUsableText) {
      return {
        outcome: 'unclear',
        relevance: unclearRelevance('The attached document did not provide enough text to classify the notice.'),
      };
    }
    const documentText = procurementPortion(extracted.text).slice(0, 4000);
    const relevance = classifyDocumentForNotice(documentText, rules, noticeTitle);
    logRelevanceNotes(relevance);
    return { outcome: inspectionDecision(relevance), relevance };
  });
}

export async function downloadAllAttachments(noticeId, links) {
  const documents = [];
  const usedNames = new Set();

  for (let index = 0; index < links.length; index += 1) {
    const document = links[index];
    await delay(requestDelayMs());
    try {
      const downloaded = await get(document.url, { as: 'buffer', includeHeaders: true });
      const bytes = downloaded.bytes;
      const original = chooseOriginalFilename({
        linkText: document.linkText || document.filename,
        contentDisposition: downloaded.contentDisposition,
        url: downloaded.finalUrl || document.url,
      });
      const extension = path.extname(original || document.urlName || document.filename || '');
      document.originalFilename = original || fallbackAttachmentName(noticeId, index, extension || '.pdf');
      if (original) {
        log('INFO', `Original attachment filename: ${original}`);
      } else {
        log('WARN', `Original attachment filename unavailable. Using fallback filename: ${document.originalFilename}`);
      }
      const saved = await saveDocument(noticeId, document.originalFilename, bytes, usedNames);
      document.filename = saved.savedName;
      document.localPath = saved.localPath;
      document.alreadySaved = saved.alreadySaved;
      documents.push(document);
      log('INFO', saved.alreadySaved ? `Already had ${document.localPath}` : `Saved attachment: ${saved.localPath}`);
    } catch (error) {
      document.downloadFailed = true;
      log('ERROR', `Could not download ${document.originalFilename || document.filename}: ${error.message}`);
      documents.push(document);
    }
  }

  return documents;
}

async function readSavedDocuments(documents) {
  const extractedParts = [];

  for (const document of documents) {
    if (!document.localPath) continue;
    try {
      const extracted = await extractDocumentText(document.localPath);
      document.hasUsableText = extracted.hasUsableText;
      document.usedOcr = extracted.usedOcr === true;
      if (extracted.hasUsableText) {
        extractedParts.push({ filename: document.filename, text: extracted.text });
      }
    } catch (error) {
      document.hasUsableText = false;
      if (error.code === 'UNSUPPORTED_DOCUMENT') {
        log('INFO', error.message);
      } else {
        log('ERROR', `Could not read ${document.filename}: ${error.message}`);
      }
    }
  }

  return extractedParts;
}

async function discardNoticeDownloads(noticeId, documents = []) {
  const removed = await removeNoticeDownloads(noticeId);
  for (const document of documents) {
    document.localPath = null;
    document.notKept = true;
  }
  if (removed) {
    log('INFO', `Removed downloaded files for notice ${noticeId} because it is not software`);
  }
}

async function saveResult({ noticeId, notice, documents, relevance, text, documentName, extractedParts = [] }) {
  const requirements = buildRequirements({
    notice,
    documentName,
    text,
  });
  if (text) {
    log('INFO', `Found ${requirements.items.length} line item${requirements.items.length === 1 ? '' : 's'}`);
  }

  if (extractedParts.length > 0) {
    const textPath = path.join('data', 'output', `${noticeId}.extracted.txt`);
    const body = extractedParts.map((part) => `Source: ${part.filename}\n\n${part.text}`).join('\n\n');
    await mkdir(path.join('data', 'output'), { recursive: true });
    await writeFile(textPath, body);
    for (const document of documents) {
      if (document.hasUsableText && document.localPath) {
        document.extractedTextPath = textPath.split(path.sep).join('/');
      }
    }
  }

  const manual = savedManual(noticeId);
  const review = manual?.review || savedReview(noticeId);
  const storedRelevance = manual?.relevance || relevance;
  const fields = manual
    ? {
      classification: manual.classification,
      classificationSource: 'manual',
      reviewed: true,
      reviewedAt: manual.reviewedAt || review.reviewedAt || null,
    }
    : classificationFields(storedRelevance, review);
  const withWork = attachWorkStatus(fields, readSavedPacket(noticeId));
  const fileNames = savedNoticeFiles(documents);
  if (fileNames.length > 0) {
    await writeNoticeMetadata(buildNoticeMetadata({
      noticeId,
      title: notice.title,
      publishDate: notice.postedDate,
      classification: fields.classification,
      classificationSource: fields.classificationSource,
      reviewed: fields.reviewed,
      reviewedAt: fields.reviewedAt,
      files: fileNames,
    }));
  }

  const result = {
    notice,
    procurementDocument: toProcurementDocument(requirements),
    sourceDocuments: requirements.sourceDocuments,
    documents,
    relevance: storedRelevance,
    requirements,
    review,
    ...withWork,
  };

  const outputPath = path.join('data', 'output', `${noticeId}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  const relativeOutput = outputPath.split(path.sep).join('/');
  log('INFO', `Saved result ${relativeOutput}`);

  return {
    result,
    outputPath: relativeOutput,
    failedDownload: documents.some((document) => document.downloadFailed === true),
    downloadedCount: documents.filter((document) => document.localPath && document.alreadySaved !== true).length,
  };
}
