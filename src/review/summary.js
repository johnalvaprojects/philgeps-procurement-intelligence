export function formatWindowLabel(start, end) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const left = `${months[start.getMonth()]} ${start.getDate()}`;
  const right = `${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  if (start.getFullYear() !== end.getFullYear()) {
    return `${left}, ${start.getFullYear()} - ${right}`;
  }
  return `${left} - ${right}`;
}

export function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function countScanRows(rows) {
  const counts = {
    processed: 0,
    software: 0,
    notRelevant: 0,
    review: 0,
    alreadyProcessed: 0,
    errors: 0,
    documentsDownloaded: 0,
  };
  const seen = new Set();

  for (const row of rows || []) {
    const id = String(row?.referenceNumber || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    counts.processed += 1;
    if (!row.alreadyProcessed) counts.documentsDownloaded += Number(row.downloadedCount) || 0;
    if (row.error) {
      counts.errors += 1;
      continue;
    }
    if (row.alreadyProcessed) {
      counts.alreadyProcessed += 1;
      continue;
    }
    if (row.needsReview) counts.review += 1;
    else if (row.isRelevant) counts.software += 1;
    else counts.notRelevant += 1;
  }

  return counts;
}

function countLine(label, value, width = 22) {
  return `${String(label).padEnd(width)}${value}`;
}

export function emptyReclassifyCounts() {
  return {
    examined: 0,
    reclassified: 0,
    manual: 0,
    software: 0,
    notRelevant: 0,
    review: 0,
    errors: 0,
    temporaryInspections: 0,
    fullDownloads: 0,
  };
}

export function addReclassifyResult(counts, result) {
  counts.examined += 1;
  if (result?.temporaryInspection) counts.temporaryInspections += 1;
  if (result?.fullDownload) counts.fullDownloads += 1;
  if (result?.error) {
    counts.errors += 1;
    return counts;
  }
  if (result?.manual) {
    counts.manual += 1;
    return counts;
  }
  counts.reclassified += 1;
  if (result?.needsReview) counts.review += 1;
  else if (result?.isRelevant) counts.software += 1;
  else counts.notRelevant += 1;
  return counts;
}

export function formatReclassifySummary({ counts, durationMs }) {
  const width = 36;
  const lines = [
    '========================================',
    'PHILGEPS RECLASSIFY SUMMARY',
    '========================================',
    '',
    countLine('Saved notices examined:', counts.examined, width),
    countLine('Reclassified:', counts.reclassified, width),
    countLine('Manual/skipped:', counts.manual, width),
    '',
    countLine('Software:', counts.software, width),
    countLine('Not Relevant:', counts.notRelevant, width),
    countLine('Review:', counts.review, width),
    countLine('Errors:', counts.errors, width),
    '',
    countLine('Temporary documents inspected:', counts.temporaryInspections, width),
    countLine('Full attachment sets downloaded:', counts.fullDownloads, width),
    '',
    countLine('Duration:', formatDuration(durationMs), width),
    '========================================',
  ];
  return lines.join('\n');
}

export function formatScanSummary({ mode, limit, windowLabel, counts, durationMs }) {
  const lines = [
    '========================================',
    'PHILGEPS SCAN SUMMARY',
    '========================================',
    '',
  ];

  if (mode === 'svp') {
    lines.push('Mode: SVP test');
    lines.push(`Limit: ${limit} notices`);
    lines.push(`Processed: ${counts.processed}`);
  } else {
    lines.push(countLine('Date window:', windowLabel || ''));
    lines.push(countLine('Notices processed:', counts.processed));
  }

  lines.push('');
  lines.push(countLine('Software:', counts.software));
  lines.push(countLine('Not Relevant:', counts.notRelevant));
  lines.push(countLine('Review:', counts.review));
  lines.push(countLine('Already Processed:', counts.alreadyProcessed));
  lines.push(countLine('Errors:', counts.errors));
  lines.push('');
  lines.push(countLine('Documents downloaded:', counts.documentsDownloaded));
  lines.push('');
  lines.push(countLine('Scan duration:', formatDuration(durationMs)));
  lines.push('========================================');
  return lines.join('\n');
}
