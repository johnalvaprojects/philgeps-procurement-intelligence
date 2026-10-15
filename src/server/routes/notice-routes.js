import express from "express";
import { attachAuth, requireCsrf, requireRoles } from "../../auth/middleware.js";
import {
  getNotices,
  getNoticeById,
  getNoticeDocuments,
  getNoticeDocument,
  markNoticeRead,
  updateNoticeClassification,
  updateNoticeWorkStatus,
} from "../controllers/notice-controller.js";

const router = express.Router();
const staff = requireRoles("staff");
const reader = requireRoles("guest", "staff");

router.use(attachAuth);
router.get("/", reader, getNotices);
router.get("/:id/documents", staff, getNoticeDocuments);
router.get("/:id/documents/:filename", staff, getNoticeDocument);
router.get("/:id", reader, getNoticeById);
router.post("/:id/read", reader, requireCsrf, markNoticeRead);
router.patch("/:id/classification", staff, requireCsrf, updateNoticeClassification);
router.patch("/:id/work-status", staff, requireCsrf, updateNoticeWorkStatus);

export default router;