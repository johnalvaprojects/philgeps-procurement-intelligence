import express from "express";
import { attachAuth, requireCsrf, requireRoles } from "../../auth/middleware.js";
import { getScanStatus, startLegacyScan, startScan } from "../controllers/scan-controller.js";
import { getScanReportById, getScanReports, getWeeklyScanReport } from "../controllers/scan-report-controller.js";

const router = express.Router();
const staff = requireRoles("staff");

router.use(attachAuth);
router.get("/status", staff, getScanStatus);
router.get("/reports/weekly", staff, getWeeklyScanReport);
router.get("/reports", staff, getScanReports);
router.get("/reports/:id", staff, getScanReportById);
router.post("/", staff, requireCsrf, startScan);
router.post("/legacy", staff, requireCsrf, startLegacyScan);

export default router;
