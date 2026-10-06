import { readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classificationLabel } from './classification/cache.js';
import { classifyText, downloadDecision } from './classification/relevance.js';
import { classificationFields } from './review/decision.js';
import { attachWorkStatus } from './review/work-status.js';
import { log } from './log.js';

/**
 * Offline title-only reclassification.
 *
 * Intentionally does NOT import PhilGEPS clients, process-notice inspection,
 * attachment downloaders, or document extractors. Clear title decisions only.
 */

export function storedClassification(packet) {
  return packet?.classification || classificationLabel(packet?.relevance) || 'review';
}

export function titleDecisionLabel(titleRelevance) {
  const decision = downloadDecision(titleRelevance);
  if (decision === 'download') return 'software';
  if (decision === 'skip') return 'not relevant';
  return null;
}

export function applyTitleClassification(packet, titleRelevance) {
  return attachWorkStatus({
    ...packet,
    relevance: titleRelevance,
    ...classificationFields(titleRelevance, packet?.review),
  }, packet);
}

export function planTitleReclassify(packet, rules) {
  if (packet?.classificationSource === 'manual') {
    return {
      action: 'skip-manual',
      from: storedClassification(packet),
      to: storedClassification(packet),
      packet,
      titleRelevance: null,
    };
  }

  const title = packet?.notice?.title || '';
  const titleRelevance = classifyText(title, rules);
  const clearLabel = titleDecisionLabel(titleRelevance);
  const from = storedClassification(packet);

  if (!clearLabel) {
    return {
      action: 'keep',
      from,
      to: from,
      packet,
      titleRelevance,
    };
  }

  if (clearLabel === from) {
    // Still refresh automatic classification fields from the current title result.
    return {
      action: 'refresh',
      from,
      to: clearLabel,
      packet: applyTitleClassification(packet, titleRelevance),
      titleRelevance,
    };
  }

  return {
    action: 'update',
    from,
    to: clearLabel,
    packet: applyTitleClassification(packet, titleRelevance),
    titleRelevance,
  };
}

function emptyCounts() {
  return {
    software: 0,
    review: 0,
    'not relevant': 0,
  };
}

function bump(counts, label) {
  const key = label === 'not relevant' ? 'not relevant' : label;
  if (key in counts) counts[key] += 1;
  else counts.review += 1;
}

function emptyTransitions() {
  return {
    'review->software': [],
    'review->not relevant': [],
    'software->review': [],
    'software->not relevant': [],
    'not relevant->software': [],
    'not relevant->review': [],
  };
}

export function formatTitleReclassifyReport({
  dryRun,
  examined,
  updated,
  kept,
  manual,
  refreshed,
  current,
  predicted,
  transitions,
}) {
  const lines = [
    '========================================',
    dryRun ? 'PHILGEPS TITLE RECLASSIFY (DRY RUN)' : 'PHILGEPS TITLE RECLASSIFY',
    '========================================',
    '',
    'CURRENT COUNTS',
    `Software:      ${current.software}`,
    `Review:        ${current.review}`,
    `Not Relevant:  ${current['not relevant']}`,
    `Total:         ${current.software + current.review + current['not relevant']}`,
    '',
    'PREDICTED COUNTS',
    `Software:      ${predicted.software}`,
    `Review:        ${predicted.review}`,
    `Not Relevant:  ${predicted['not relevant']}`,
    `Total:         ${predicted.software + predicted.review + predicted['not relevant']}`,
    '',
    'TRANSITIONS',
    `Review → Software:       ${transitions['review->software'].length}`,
    `Review → Not Relevant:   ${transitions['review->not relevant'].length}`,
    `Software → Not Relevant: ${transitions['software->not relevant'].length}`,
    `Software → Review:       ${transitions['software->review'].length}`,
    `Not Relevant → Software: ${transitions['not relevant->software'].length}`,
    `Not Relevant → Review:   ${transitions['not relevant->review'].length}`,
    '',
    `Examined: ${examined}`,
    `Would update / updated: ${updated}`,
    `Refreshed same label: ${refreshed}`,
    `Kept unresolved: ${kept}`,
    `Manual skipped: ${manual}`,
    '',
    'SOFTWARE-INVOLVING TRANSITIONS',
  ];

  const softwareTransitions = [
    ...transitions['review->software'].map((row) => ({ kind: 'review->software', ...row })),
    ...transitions['software->not relevant'].map((row) => ({ kind: 'software->not relevant', ...row })),
    ...transitions['software->review'].map((row) => ({ kind: 'software->review', ...row })),
    ...transitions['not relevant->software'].map((row) => ({ kind: 'not relevant->software', ...row })),
  ];

  if (softwareTransitions.length === 0) {
    lines.push('(none)');
  } else {
    for (const row of softwareTransitions) {
      lines.push(`${row.kind}  ${row.id}  ${row.title}`);
    }
  }

  lines.push('========================================');
  return lines.join('\n');
}

export async function runTitleReclassify({
  outputDir = path.join('data', 'output'),
  rules,
  dryRun = false,
  refreshReviewList = async () => {},
} = {}) {
  if (!rules) {
    throw new Error('rules are required for title reclassification');
  }

  const names = (await readdir(outputDir)).filter((name) => /^\d+\.json$/.test(name)).sort();
  const current = emptyCounts();
  const predicted = emptyCounts();
  const transitions = emptyTransitions();
  let examined = 0;
  let updated = 0;
  let kept = 0;
  let manual = 0;
  let refreshed = 0;

  for (const name of names) {
    const noticeId = name.replace(/\.json$/, '');
    const outputPath = path.join(outputDir, name);
    const packet = JSON.parse(await readFile(outputPath, 'utf8'));
    examined += 1;

    const from = storedClassification(packet);
    bump(current, from);

    const plan = planTitleReclassify(packet, rules);
    bump(predicted, plan.to);

    if (plan.action === 'skip-manual') {
      manual += 1;
      continue;
    }

    if (plan.action === 'keep') {
      kept += 1;
      continue;
    }

    if (plan.from !== plan.to) {
      const key = `${plan.from}->${plan.to}`;
      if (transitions[key]) {
        transitions[key].push({
          id: noticeId,
          title: String(packet?.notice?.title || '').slice(0, 160),
          reason: plan.titleRelevance?.reasons?.[0] || '',
        });
      }
    }

    if (plan.action === 'refresh') {
      refreshed += 1;
      // Same clear label — no write needed to preserve stored evidence/reasons unless mutating.
      // Keep stored packet as-is when label is unchanged.
      continue;
    }

    // action === 'update'
    updated += 1;
    if (!dryRun) {
      await writeFile(outputPath, `${JSON.stringify(plan.packet, null, 2)}\n`);
      log('INFO', `Title reclassified notice ${noticeId}: ${plan.from} → ${plan.to}`);
    }
  }

  if (!dryRun && updated > 0) {
    await refreshReviewList();
  }

  const report = {
    dryRun,
    examined,
    updated,
    kept,
    manual,
    refreshed,
    current,
    predicted,
    transitions,
  };

  const text = formatTitleReclassifyReport(report);
  console.log(text);
  return report;
}

export function loadRelevanceRules(projectRoot = process.cwd()) {
  return JSON.parse(readFileSync(path.join(projectRoot, 'config', 'relevance.json'), 'utf8'));
}
