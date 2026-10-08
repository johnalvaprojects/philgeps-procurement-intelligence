import { listScanReports, readScanReport } from "../../scan-reports.js";

export async function getScanReports(req, res, next) {
  try {
    const reports = await listScanReports();
    res.json(reports);
  } catch (error) {
    next(error);
  }
}

export async function getScanReportById(req, res, next) {
  try {
    const report = await readScanReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: "Scan report not found" });
    }
    res.json(report);
  } catch (error) {
    next(error);
  }
}
