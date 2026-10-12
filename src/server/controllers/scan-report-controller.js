import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../../project-root.js";
import { attachCurrentClassifications, listScanReports, readScanReport, SCAN_REPORTS_DIR } from "../../scan-reports.js";
import { readWeeklyReport } from "../../weekly-report.js";

function reportsDirectory(req) {
  return req.app.get("scanReportsDir") || SCAN_REPORTS_DIR;
}

export async function getScanReports(req, res, next) {
  try {
    const reports = await listScanReports(reportsDirectory(req));
    res.json(reports);
  } catch (error) {
    next(error);
  }
}

export async function getWeeklyScanReport(req, res, next) {
  try {
    const from = req.query?.from;
    const result = await readWeeklyReport({
      from: from == null || String(from).trim() === "" ? undefined : String(from),
      reportsDir: reportsDirectory(req),
      outputDir: req.app.get("outputDir") || path.join(projectRoot, "data", "output"),
    });
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result.report);
  } catch (error) {
    next(error);
  }
}

export async function getScanReportById(req, res, next) {
  try {
    const report = await readScanReport(req.params.id, reportsDirectory(req));
    if (!report) {
      return res.status(404).json({ error: "Scan report not found" });
    }
    const outputDir = req.app.get("outputDir") || path.join(projectRoot, "data", "output");
    const packets = new Map();
    for (const row of report.softwareOpportunities || []) {
      const id = row?.referenceNumber ? String(row.referenceNumber) : "";
      if (!/^\d+$/.test(id) || packets.has(id)) continue;
      try {
        packets.set(id, JSON.parse(await readFile(path.join(outputDir, `${id}.json`), "utf8")));
      } catch {
        packets.set(id, null);
      }
    }
    res.json(attachCurrentClassifications(report, packets));
  } catch (error) {
    next(error);
  }
}
