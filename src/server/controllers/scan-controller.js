import { log } from "../../log.js";
import { runScan } from "../../scan.js";

let running = false;
let finished = Promise.resolve();

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
    })
    .finally(() => {
      running = false;
    });
  finished.catch((error) => {
    log("ERROR", error.message);
    running = false;
  });
  return true;
}

export function startScan(req, res) {
  const run = req.app.get("runScan") || runScan;
  if (!beginApiScan(run)) {
    return res.status(409).json({ error: "A scan is already running" });
  }
  res.status(202).json({ status: "started" });
}

export function getScanStatus(req, res) {
  res.json({ running });
}
