import { log } from "../../log.js";
import { runScan } from "../../scan.js";
import { parseScanRangeBody } from "../../scan-range.js";
import { getScanProgress, resetScanProgress } from "../../scan-progress.js";

let running = false;
let finished = Promise.resolve();
let activeRange = null;

export function activeScan() {
  return finished;
}

export function beginApiScan(run) {
  if (running) return false;
  running = true;
  finished = Promise.resolve()
    .then(() => run())
    .catch((error) => {
      log("ERROR", error.message);
      const progress = getScanProgress();
      resetScanProgress({
        ...progress,
        running: false,
        complete: false,
        completionReason: progress.completionReason || "error",
        startedAt: progress.startedAt,
      });
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
  if (!beginApiScan(() => run(options))) {
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
