import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { noticeScanPlan } from './classification/cache.js';
import { formatIsoDay } from './documents/metadata.js';
import { requestDelayMs } from './philgeps/client.js';
import { fetchSvpInWindow, formatCalendarDate, reachedBatchLimit } from './philgeps/search.js';
import { processNotice } from './process-notice.js';
import { projectRoot, useProjectRoot } from './project-root.js';
import { packetsToRows, renderReviewList } from './review/list.js';
import { countScanRows, formatScanSummary, formatWindowLabel } from './review/summary.js';
import { resolveScanPublicationWindow } from './scan-range.js';
import { finishScanProgress, getScanProgress, resetScanProgress, updateScanProgress } from './scan-progress.js';
import { delay, log, startScanLog, writeLogBlock } from './log.js';

const outputDir = path.join(projectRoot, 'data', 'output');

function savedNotice(referenceNumber) {
  const outputPath = path.join(outputDir, `${referenceNumber}.json`);
  if (!existsSync(outputPath)) return null;
  const saved = JSON.parse(readFileSync(outputPath, 'utf8'));
  if (!saved.requirements || !saved.relevance) return null;
  const relativePath = path.join('data', 'output', `${referenceNumber}.json`);
  return {
    result: saved,
    outputPath: relativePath.split(path.sep).join('/'),
    failedDownload: false,
  };
}

function summaryRow(referenceNumber, processed, error, extras = {}) {
  if (error) {
    return {
      referenceNumber,
      title: null,
      organization: null,
      isRelevant: null,
      needsReview: true,
      category: null,
      outputPath: null,
      error: error.message,
      alreadyProcessed: false,
      downloadedCount: 0,
    };
  }

  return {
    referenceNumber: processed.result.notice.referenceNumber,
    title: processed.result.notice.title,
    organization: processed.result.notice.organization,
    isRelevant: processed.result.relevance.isRelevant,
    needsReview: processed.result.relevance.needsReview,
    category: processed.result.relevance.category,
    outputPath: processed.outputPath,
    error: null,
    alreadyProcessed: extras.alreadyProcessed === true,
    downloadedCount: extras.alreadyProcessed ? 0 : (processed.downloadedCount || 0),
  };
}

export async function writeReviewList() {
  await mkdir(outputDir, { recursive: true });
  const names = await readdir(outputDir);
  const packets = [];

  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    packets.push(JSON.parse(await readFile(path.join(outputDir, name), 'utf8')));
  }

  const listPath = path.join(outputDir, 'review.html');
  await writeFile(listPath, renderReviewList(packetsToRows(packets)));
  log('INFO', 'Saved review list data/output/review.html');
}

export async function processCollectedNotices(notices, limit, {
  mode = 'scan',
  windowLabel = '',
  pagination = null,
} = {}) {
  const started = Date.now();
  updateScanProgress({
    noticesDiscovered: Array.isArray(notices) ? notices.length : 0,
    noticesProcessed: 0,
    softwareCount: 0,
    reviewCount: 0,
    notRelevantCount: 0,
    alreadyProcessedCount: 0,
    errorCount: 0,
    documentsDownloaded: 0,
  });

  const rules = JSON.parse(readFileSync(path.join(projectRoot, 'config', 'relevance.json'), 'utf8'));
  const rows = [];
  let failed = false;
  let processedCount = 0;

  for (const notice of notices) {
    if (reachedBatchLimit(processedCount, limit)) break;
    processedCount += 1;
    updateScanProgress({
      noticesProcessed: processedCount,
      currentReferenceNumber: notice.referenceNumber || null,
    });

    const alreadySaved = savedNotice(notice.referenceNumber);
    const plan = noticeScanPlan(notice, rules, alreadySaved?.result);
    if (plan.action === 'skip') {
      log('INFO', `Processing notice ${notice.referenceNumber}`);
      log('INFO', 'Classification: hardware');
      log('INFO', 'Skipped without downloading attachments');
      log('INFO', `Skipped notice ${notice.referenceNumber}. The title is hardware, so documents were not downloaded.`);
      rows.push({
        referenceNumber: notice.referenceNumber,
        title: notice.title,
        organization: notice.organization,
        isRelevant: false,
        needsReview: false,
        category: 'hardware',
        outputPath: null,
        error: null,
      });
      updateScanProgress({ notRelevantCount: (getCount('notRelevantCount') + 1) });
      continue;
    }

    if (plan.action === 'reuse') {
      log('INFO', `Processing notice ${notice.referenceNumber}`);
      log('INFO', `Notice ${notice.referenceNumber} already has a cached classification: ${plan.label}`);
      log('INFO', `Notice ${notice.referenceNumber} was already saved`);
      rows.push(summaryRow(notice.referenceNumber, alreadySaved, null, { alreadyProcessed: true }));
      updateScanProgress({ alreadyProcessedCount: getCount('alreadyProcessedCount') + 1 });
      continue;
    }

    await delay(requestDelayMs());

    try {
      const processed = await processNotice(notice.referenceNumber);
      const row = summaryRow(notice.referenceNumber, processed);
      rows.push(row);
      if (processed.failedDownload) failed = true;
      bumpResultCounts(row);
    } catch (error) {
      failed = true;
      log('ERROR', `Notice ${notice.referenceNumber} failed: ${error.message}`);
      rows.push(summaryRow(notice.referenceNumber, null, error));
      updateScanProgress({ errorCount: getCount('errorCount') + 1 });
    }
  }

  if (reachedBatchLimit(processedCount, limit)) {
    log('INFO', `SVP test limit reached: ${limit} notices processed`);
  }

  const counts = countScanRows(rows);
  const complete = pagination ? pagination.complete === true : true;
  const completionReason = pagination?.completionReason
    || (complete ? 'date-boundary' : 'error');

  finishScanProgress({
    noticesProcessed: counts.processed,
    softwareCount: counts.software,
    reviewCount: counts.review,
    notRelevantCount: counts.notRelevant,
    alreadyProcessedCount: counts.alreadyProcessed,
    errorCount: counts.errors,
    documentsDownloaded: counts.documentsDownloaded,
    complete,
    completionReason,
  });

  log('INFO', 'Scan completed');
  writeLogBlock(formatScanSummary({
    mode,
    limit,
    windowLabel,
    counts,
    durationMs: Date.now() - started,
  }));

  const summary = {
    createdAt: new Date().toISOString(),
    limit,
    notices: rows,
    pagination: pagination || null,
  };
  const summaryPath = path.join(outputDir, 'svp-batch.json');
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  log('INFO', 'Saved result data/output/svp-batch.json');
  await writeReviewList();

  console.log('');
  console.log('Reference   Result        Title');
  for (const row of rows) {
    const relevance = row.error ? 'error' : row.needsReview ? 'review' : row.isRelevant ? 'relevant' : 'not relevant';
    const title = (row.title || row.error || '').replace(/\s+/g, ' ').slice(0, 70);
    console.log(`${row.referenceNumber.padEnd(12)}${relevance.padEnd(14)}${title}`);
  }

  return { failed, counts, pagination: pagination || null };
}

function getCount(key) {
  return Number(getScanProgress()[key]) || 0;
}

function bumpResultCounts(row) {
  const patch = { documentsDownloaded: getCount('documentsDownloaded') + (Number(row.downloadedCount) || 0) };
  if (row.error) patch.errorCount = getCount('errorCount') + 1;
  else if (row.needsReview) patch.reviewCount = getCount('reviewCount') + 1;
  else if (row.isRelevant) patch.softwareCount = getCount('softwareCount') + 1;
  else patch.notRelevantCount = getCount('notRelevantCount') + 1;
  updateScanProgress(patch);
}

export async function runScan(options = {}) {
  useProjectRoot();
  startScanLog(new Date(), path.join(projectRoot, 'data', 'logs'));
  log('INFO', 'Scan started');
  const window = resolveScanPublicationWindow(options);
  const start = formatCalendarDate(window.start);
  const end = formatCalendarDate(window.end);
  const from = formatIsoDay(window.start);
  const to = formatIsoDay(window.end);
  resetScanProgress({
    running: true,
    from,
    to,
    complete: null,
    completionReason: null,
  });
  log('INFO', `Date window: ${from} to ${to}`);
  log('INFO', `Scanning Small Value Procurement notices published ${start} through ${end}`);
  let notices;
  try {
    notices = await fetchSvpInWindow(window);
  } catch (error) {
    finishScanProgress({
      complete: false,
      completionReason: 'error',
    });
    throw error;
  }
  const pagination = notices.pagination || null;
  updateScanProgress({
    noticesDiscovered: notices.length,
    complete: pagination ? pagination.complete : null,
    completionReason: pagination?.completionReason || null,
  });
  log('INFO', `Found ${notices.length} Small Value Procurement notice${notices.length === 1 ? '' : 's'} in that window`);
  return processCollectedNotices(notices, null, {
    mode: 'scan',
    windowLabel: formatWindowLabel(window.start, window.end),
    pagination,
  });
}
