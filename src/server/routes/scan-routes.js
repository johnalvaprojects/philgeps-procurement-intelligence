import express from "express";
import { getScanStatus, startScan } from "../controllers/scan-controller.js";
import { getScanReportById, getScanReports } from "../controllers/scan-report-controller.js";

const router = express.Router();

router.get("/status", getScanStatus);
router.get("/reports", getScanReports);
router.get("/reports/:id", getScanReportById);
router.post("/", startScan);

export default router;
