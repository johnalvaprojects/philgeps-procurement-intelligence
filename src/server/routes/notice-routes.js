import express from "express";
import {
  getNotices,
  getNoticeById,
  getNoticeDocuments,
  getNoticeDocument,
  updateNoticeClassification,
} from "../controllers/notice-controller.js";

const router = express.Router();

router.get("/", getNotices);

// List documents belonging to a notice
router.get("/:id/documents", getNoticeDocuments);

// Open a specific document
router.get("/:id/documents/:filename", getNoticeDocument);

// Get one notice
router.get("/:id", getNoticeById);

router.patch("/:id/classification", updateNoticeClassification);

export default router;