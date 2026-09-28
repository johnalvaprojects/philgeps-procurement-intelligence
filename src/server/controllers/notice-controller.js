import fs from "fs/promises";
import path from "path";
import { projectRoot } from "../../project-root.js";
import { decideSavedNotice } from "../../review/decision.js";
import { publicWorkStatus, setSavedWorkStatus } from "../../review/work-status.js";

const OUTPUT_DIR = path.join(projectRoot, "data", "output");
const DOCUMENTS_DIR = path.join(projectRoot, "data", "documents");

// Get all saved notices
export async function getNotices(req, res, next) {
  try {
    const files = await fs.readdir(OUTPUT_DIR);

    const noticeFiles = files.filter(
      (file) => file.endsWith(".json") && /^\d+\.json$/.test(file)
    );

    const notices = await Promise.all(
      noticeFiles.map(async (file) => {
        const filePath = path.join(OUTPUT_DIR, file);
        const content = await fs.readFile(filePath, "utf8");
        const data = JSON.parse(content);

        return {
          referenceNumber: data.notice?.referenceNumber,
          title: data.notice?.title,
          organization: data.notice?.organization,
          postedDate: data.notice?.postedDate,
          deadline: data.notice?.deadline,
          abc: data.notice?.abc,
          classification: data.classification,
          classificationSource: data.classificationSource,
          reviewed: data.reviewed,
          workStatus: publicWorkStatus(data),
        };
      })
    );

    res.json(notices);
  } catch (error) {
    next(error);
  }
}

// Get one notice by ID
export async function getNoticeById(req, res, next) {
  try {
    const { id } = req.params;

    const filePath = path.join(OUTPUT_DIR, `${id}.json`);

    const content = await fs.readFile(filePath, "utf8");
    const notice = JSON.parse(content);

    res.json(notice);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({
        error: "Notice not found",
      });
    }

    next(error);
  }
}

// Get all downloaded documents for one notice
export async function getNoticeDocuments(req, res, next) {
  try {
    const { id } = req.params;

    const documentsDir = path.join(projectRoot, "data", "documents", id);

    const files = (await fs.readdir(documentsDir)).filter(
      (filename) => filename !== "metadata.json"
    );

    const documents = files.map((filename) => ({
      filename,
      url: `/api/notices/${id}/documents/${encodeURIComponent(filename)}`,
    }));

    res.json(documents);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({
        error: "No documents found for this notice",
      });
    }

    next(error);
  }
}

// Open/download one document from a notice
export async function getNoticeDocument(req, res, next) {
  try {
    const { id, filename } = req.params;

    const documentsDir = path.join(projectRoot, "data", "documents", id);
    const filePath = path.resolve(documentsDir, filename);

    // Prevent accessing files outside the notice's document folder
    if (!filePath.startsWith(documentsDir + path.sep)) {
      return res.status(400).json({
        error: "Invalid document path",
      });
    }

    await fs.access(filePath);

    res.sendFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({
        error: "Document not found",
      });
    }

    next(error);
  }
}

export async function updateNoticeClassification(req, res, next) {
  try {
    const updated = await decideSavedNotice(req.params.id, req.body?.classification, {
      outputDir: req.app.get("outputDir") || OUTPUT_DIR,
      documentsRoot: req.app.get("documentsRoot") || DOCUMENTS_DIR,
    });
    res.json({
      referenceNumber: updated.notice?.referenceNumber,
      classification: updated.classification,
      classificationSource: updated.classificationSource,
      reviewed: updated.reviewed,
      reviewedAt: updated.reviewedAt,
      review: updated.review,
      relevance: updated.relevance,
      workStatus: publicWorkStatus(updated),
    });
  } catch (error) {
    if (error.code === "NOTICE_NOT_FOUND") {
      return res.status(404).json({ error: error.message });
    }
    if (error.code === "INVALID_DECISION" || error.code === "INVALID_NOTICE_ID") {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
}

export async function updateNoticeWorkStatus(req, res, next) {
  try {
    const updated = await setSavedWorkStatus(req.params.id, req.body?.workStatus, {
      outputDir: req.app.get("outputDir") || OUTPUT_DIR,
      documentsRoot: req.app.get("documentsRoot") || DOCUMENTS_DIR,
    });
    res.json({
      referenceNumber: updated.notice?.referenceNumber,
      classification: updated.classification,
      classificationSource: updated.classificationSource,
      reviewed: updated.reviewed,
      workStatus: publicWorkStatus(updated),
    });
  } catch (error) {
    if (error.code === "NOTICE_NOT_FOUND") {
      return res.status(404).json({ error: error.message });
    }
    if (error.code === "INVALID_WORK_STATUS" || error.code === "INVALID_NOTICE_ID") {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
}