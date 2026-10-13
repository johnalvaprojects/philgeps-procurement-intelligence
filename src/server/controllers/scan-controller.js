import path from "node:path";
import { log } from "../../log.js";
import { projectRoot } from "../../project-root.js";
import { assertLegacyPageLimit, runLegacyScan } from "../../philgeps-legacy/scan.js";
import { runScan } from "../../scan.js";
import { parseScanRangeBody } from "../../scan-range.js";
import { finishScanProgress, getScanProgress, resetScanProgress, updateScanProgress } from "../../scan-progress.js";
import { persistFinishedScanReport } from "../../scan-reports.js";

let running = false;
let finished = Promise.resolve();
let activeRange = null;

export function activeScan() {
  return finished;
}

export function beginApiScan(run, { reportsDir } = {}) {
  if (running) return false;
  running = true;
  finished = Promise.resolve()
    .then(() => run())
    .catch(async (error) => {
      log("ERROR", error.message);
      const progress = getScanProgress();
      resetScanProgress({
        ...progress,
        running: false,
        complete: false,
        completionReason: progress.completionReason || "error",
        startedAt: progress.startedAt,
      });
      try {
        await persistFinishedScanReport({
          mode: "scan",
          rows: [],
          errorMessage: error.message,
          directory: reportsDir,
        });
      } catch (reportError) {
        log("WARN", `Scan report was not saved: ${reportError.message}`);
      }
    })
    .finally(() => {
      running = false;
      activeRange = null;
    });
  finished.catch((error) => {
    log("ERROR", error.message);
    running = false;
    activeRange = null;
  });
  return true;
}

export function startScan(req, res) {
  const run = req.app.get("runScan") || runScan;
  const parsed = parseScanRangeBody(req.body || {});
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  const options = parsed.window ? { window: parsed.window } : {};
  if (!beginApiScan(() => run(options), { reportsDir: req.app.get("scanReportsDir") || undefined })) {
    return res.status(409).json({ error: "A scan is already running" });
  }

  activeRange = parsed.window
    ? { from: parsed.from, to: parsed.to }
    : null;

  resetScanProgress({
    running: true,
    from: activeRange?.from || null,
    to: activeRange?.to || null,
    complete: null,
    completionReason: null,
  });

  const body = { status: "started" };
  if (activeRange) {
    body.from = activeRange.from;
    body.to = activeRange.to;
  }
  res.status(202).json(body);
}

function legacyProgressFields(snapshot = {}) {
  const errors = Array.isArray(snapshot.errors) ? snapshot.errors : [];
  return {
    noticesDiscovered: snapshot.noticesInspected ?? 0,
    noticesProcessed: snapshot.noticesClassified ?? 0,
    softwareCount: snapshot.softwareCount ?? 0,
    reviewCount: snapshot.reviewCount ?? 0,
    notRelevantCount: snapshot.notRelevantCount ?? 0,
    alreadyProcessedCount: snapshot.alreadySaved ?? 0,
    errorCount: errors.length,
    documentsDownloaded: 0,
    pagesVisited: snapshot.pagesVisited ?? 0,
    noticesInspected: snapshot.noticesInspected ?? 0,
    smallValueFound: snapshot.smallValueFound ?? 0,
    noticesSaved: snapshot.noticesSaved ?? 0,
    duplicatesSkipped: snapshot.duplicatesSkipped ?? 0,
    legacyErrors: errors,
  };
}

export function startLegacyScan(req, res) {
  let pageLimit;
  try {
    assertLegacyPageLimit(req.body?.pageLimit);
    pageLimit = req.body.pageLimit;
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const outputDir = req.app.get("outputDir") || path.join(projectRoot, "data", "output");
  const reportsDir = req.app.get("scanReportsDir") || undefined;
  const run = req.app.get("runLegacyScan") || runLegacyScan;
  if (!beginApiScan(async () => {
    const result = await run({
      pageLimit,
      outputDir,
      onProgress: (snapshot) => {
        updateScanProgress({
          running: true,
          portal: "legacy",
          sourceLabel: "Old PhilGEPS",
          pageLimit,
          ...legacyProgressFields(snapshot),
        });
      },
    });
    finishScanProgress({
      portal: "legacy",
      sourceLabel: "Old PhilGEPS",
      pageLimit,
      complete: result?.stopped !== true,
      completionReason: result?.stopped ? (result.stopReason || "error") : "complete",
      ...legacyProgressFields(result),
    });
    try {
      await persistFinishedScanReport({
        mode: "legacy",
        rows: [],
        directory: reportsDir,
      });
    } catch (reportError) {
      log("WARN", `Scan report was not saved: ${reportError.message}`);
    }
    return result;
  }, { reportsDir })) {
    return res.status(409).json({ error: "A scan is already running" });
  }

  resetScanProgress({
    running: true,
    portal: "legacy",
    sourceLabel: "Old PhilGEPS",
    pageLimit,
  });
  res.status(202).json({ status: "started", portal: "legacy", pageLimit });
}

export function getScanStatus(req, res) {
  const progress = getScanProgress();
  const body = {
    ...progress,
    running,
  };
  if (running && activeRange) {
    body.from = activeRange.from;
    body.to = activeRange.to;
  }
  res.json(body);
}
