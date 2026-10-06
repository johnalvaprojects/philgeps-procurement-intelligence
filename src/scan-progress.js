const EMPTY = {
  running: false,
  from: null,
  to: null,
  noticesDiscovered: 0,
  noticesProcessed: 0,
  currentReferenceNumber: null,
  softwareCount: 0,
  reviewCount: 0,
  notRelevantCount: 0,
  alreadyProcessedCount: 0,
  errorCount: 0,
  documentsDownloaded: 0,
  elapsedMs: 0,
  complete: null,
  completionReason: null,
  startedAt: null,
};

let state = { ...EMPTY };

export function resetScanProgress(partial = {}) {
  state = {
    ...EMPTY,
    ...partial,
    startedAt: partial.startedAt || Date.now(),
  };
  return getScanProgress();
}

export function updateScanProgress(partial = {}) {
  state = {
    ...state,
    ...partial,
    elapsedMs: state.startedAt ? Date.now() - state.startedAt : partial.elapsedMs || 0,
  };
  return getScanProgress();
}

export function finishScanProgress(partial = {}) {
  state = {
    ...state,
    ...partial,
    running: false,
    currentReferenceNumber: null,
    elapsedMs: state.startedAt ? Date.now() - state.startedAt : state.elapsedMs,
  };
  return getScanProgress();
}

export function getScanProgress() {
  return {
    ...state,
    elapsedMs: state.running && state.startedAt ? Date.now() - state.startedAt : state.elapsedMs,
  };
}
