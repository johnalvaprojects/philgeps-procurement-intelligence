import express from "express";
import { getScanStatus, startScan } from "../controllers/scan-controller.js";

const router = express.Router();

router.get("/status", getScanStatus);
router.post("/", startScan);

export default router;
