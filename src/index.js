import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { batchLimit, fetchLatestSvp } from './philgeps/search.js';
import { processNotice } from './process-notice.js';
import { projectRoot, useProjectRoot } from './project-root.js';
import { runReclassify } from './reclassify.js';
import { loadRelevanceRules, runTitleReclassify } from './reclassify-title.js';
import { decideSavedNotice, normalizeDecision, saveManualDecision } from './review/decision.js';
import { startReviewServer } from './review/server.js';
import { markReviewed } from './review/status.js';
import { parseNoticeId } from './philgeps/notices.js';
import { log, startScanLog } from './log.js';
import { processCollectedNotices, runScan, writeReviewList } from './scan.js';
import { extractAndSaveSoftwareRequirements } from './extraction/extract-software-requirements.js';

useProjectRoot();

async function runBatch(limit) {
  startScanLog();
  log('INFO', 'Scan started');
  log('INFO', 'Mode: SVP test');
  log('INFO', `Limit: ${limit} notices`);
  log('INFO', `Processing at most ${limit} Small Value Procurement notices`);
  const notices = await fetchLatestSvp(limit);
  const result = await processCollectedNotices(notices, limit, { mode: 'svp' });
  if (result.failed) process.exitCode = 1;
}

async function runReclassifyCommand() {
  startScanLog();
  log('INFO', 'Reclassify started');
  const rules = JSON.parse(readFileSync(path.join(projectRoot, 'config', 'relevance.json'), 'utf8'));
  await runReclassify({
    outputDir: path.join('data', 'output'),
    documentsRoot: path.join('data', 'documents'),
    rules,
    refreshReviewList: writeReviewList,
  });
}

async function runTitleReclassifyCommand({ dryRun = false } = {}) {
  if (!dryRun) {
    startScanLog();
    log('INFO', 'Title-only reclassify started');
  } else {
    log('INFO', 'Title-only reclassify dry-run started');
  }
  await runTitleReclassify({
    outputDir: path.join(projectRoot, 'data', 'output'),
    rules: loadRelevanceRules(projectRoot),
    dryRun,
    refreshReviewList: writeReviewList,
  });
}

async function decideNotice(referenceInput, decisionInput) {
  await decideSavedNotice(referenceInput, decisionInput);
}

async function openReviewPage() {
  await writeReviewList();
  const server = await startReviewServer({
    outputDir: path.join('data', 'output'),
    documentsRoot: path.join('data', 'documents'),
    onDecide: async (noticeId, decision) => {
      const referenceNumber = parseNoticeId(noticeId);
      await saveManualDecision(referenceNumber, decision);
      await writeReviewList();
      log('INFO', `Saved manual decision for notice ${referenceNumber}: ${normalizeDecision(decision)}`);
    },
  });
  const address = server.address();
  log('INFO', `Review page: http://127.0.0.1:${address.port}/`);
}

async function markNoticeReviewed(input) {
  const referenceNumber = parseNoticeId(input);
  const outputPath = path.join('data', 'output', `${referenceNumber}.json`);
  if (!existsSync(outputPath)) {
    throw new Error(`No saved notice ${referenceNumber}. Run that notice before marking it reviewed.`);
  }

  const packet = JSON.parse(await readFile(outputPath, 'utf8'));
  const updated = markReviewed(packet);
  const { alreadyReviewed, ...saved } = updated;
  await writeFile(outputPath, `${JSON.stringify(saved, null, 2)}\n`);
  log('INFO', alreadyReviewed
    ? `Notice ${referenceNumber} was already reviewed`
    : `Marked notice ${referenceNumber} as reviewed`);
  await writeReviewList();
}

const args = process.argv.slice(2);

if (args[0] === '--reviewed') {
  if (!args[1]) {
    log('ERROR', 'Give the notice number to mark as reviewed. Example: node src/index.js --reviewed 85876');
    process.exitCode = 1;
  } else {
    markNoticeReviewed(args[1]).catch((error) => {
      log('ERROR', error.message);
      process.exitCode = 1;
    });
  }
} else if (args[0] === '--decide') {
  if (!args[1] || !args[2]) {
    log('ERROR', 'Give a notice number and a decision. Example: node src/index.js --decide 87086 software');
    process.exitCode = 1;
  } else {
    decideNotice(args[1], args[2]).catch((error) => {
      log('ERROR', error.message);
      process.exitCode = 1;
    });
  }
} else if (args[0] === '--review') {
  openReviewPage().catch((error) => {
    log('ERROR', error.message);
    process.exitCode = 1;
  });
} else if (args[0] === '--list') {
  writeReviewList().catch((error) => {
    log('ERROR', error.message);
    process.exitCode = 1;
  });
} else if (args[0] === '--reclassify') {
  runReclassifyCommand().catch((error) => {
    log('ERROR', error.message);
    process.exitCode = 1;
  });
} else if (args[0] === '--reclassify-title') {
  const dryRun = args.includes('--dry-run');
  runTitleReclassifyCommand({ dryRun }).catch((error) => {
    log('ERROR', error.message);
    process.exitCode = 1;
  });
} else if (args[0] === '--extract-requirements') {
  (async () => {
    const outputDir = path.join(projectRoot, 'data', 'output');
    const documentsRoot = path.join(projectRoot, 'data', 'documents');
    const onlyId = args[1] && /^\d+$/.test(args[1]) ? args[1] : null;
    const names = onlyId
      ? [`${onlyId}.json`]
      : (await readdir(outputDir)).filter((name) => /^\d+\.json$/.test(name));
    let count = 0;
    for (const name of names) {
      const packet = JSON.parse(await readFile(path.join(outputDir, name), 'utf8'));
      if (packet.classification !== 'software') continue;
      const noticeId = packet.notice?.referenceNumber || name.replace(/\.json$/, '');
      await extractAndSaveSoftwareRequirements({
        notice: packet.notice,
        documents: packet.documents || [],
        noticeId,
        outputDir,
        documentsRoot,
        preferExtracted: true,
      });
      count += 1;
    }
    log('INFO', `Extracted requirements for ${count} software notice${count === 1 ? '' : 's'}`);
  })().catch((error) => {
    log('ERROR', error.message);
    process.exitCode = 1;
  });
} else if (args[0] === '--scan') {
  runScan()
    .then((result) => {
      if (result.failed) process.exitCode = 1;
    })
    .catch((error) => {
      log('ERROR', error.message);
      process.exitCode = 1;
    });
} else if (args[0] === '--svp') {
  try {
    const limit = batchLimit(args[1] || 5);
    runBatch(limit).catch((error) => {
      log('ERROR', error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    log('ERROR', error.message);
    process.exitCode = 1;
  }
} else if (args[0]) {
  processNotice(args[0])
    .then(async (processed) => {
      console.log(JSON.stringify(processed.result, null, 2));
      await writeReviewList();
      if (processed.failedDownload) process.exitCode = 1;
    })
    .catch((error) => {
      log('ERROR', error.message);
      process.exitCode = 1;
    });
} else {
  console.error('Usage: node src/index.js <notice number or URL>');
  console.error('       node src/index.js --scan');
  console.error('       node src/index.js --reclassify');
  console.error('       node src/index.js --reclassify-title [--dry-run]');
  console.error('       node src/index.js --extract-requirements [noticeId]');
  console.error('       node src/index.js --svp 5');
  console.error('       node src/index.js --list');
  console.error('       node src/index.js --review');
  console.error('       node src/index.js --decide 87086 software');
  console.error('       node src/index.js --reviewed 85876');
  console.error('Example: node src/index.js 85876');
  process.exitCode = 1;
}
