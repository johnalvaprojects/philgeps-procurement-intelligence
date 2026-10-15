import fs from "fs/promises";
import path from "path";
import { projectRoot } from "../../project-root.js";
import { readSavedSoftwareRequirements } from "../../extraction/extract-software-requirements.js";
import { decideSavedNotice } from "../../review/decision.js";
import { publicWorkStatus, setSavedWorkStatus } from "../../review/work-status.js";
import { publicNoticeFields } from "../../auth/public-notice.js";
import { requestHasGuestFullAccess } from "../../auth/access.js";
import {
  documentsRequireLogin,
  isSafeStorageId,
  portalFromPacket,
  storageIdFromFilename,
} from "../../notice-source.js";
import { isUnread, loadNoticeReads, recordNoticeRead } from "../../notice-reads/store.js";

const OUTPUT_DIR = path.join(projectRoot, "data", "output");
const DOCUMENTS_DIR = path.join(projectRoot, "data", "documents");

function outputDirectory(req) {
  return req.app.get("outputDir") || OUTPUT_DIR;
}

function documentsDirectory(req) {
  return req.app.get("documentsRoot") || DOCUMENTS_DIR;
}

function readsDirectory(req) {
  return req.app.get("noticeReadsDir");
}

function noticeFilePath(directory, id) {
  if (!isSafeStorageId(id)) return null
  const root = path.resolve(directory)
  const filePath = path.resolve(directory, `${id}.json`)
  if (filePath !== path.join(root, `${id}.json`)) return null
  return filePath
}

function noticeSummary(data, storageId) {
  const portal = portalFromPacket(data, storageId)
  return {
    referenceNumber: data.notice?.referenceNumber,
    storageId,
    title: data.notice?.title,
    organization: data.notice?.organization,
    postedDate: data.notice?.postedDate,
    deadline: data.notice?.deadline,
    abc: data.notice?.abc,
    classification: data.classification,
    classificationSource: data.classificationSource,
    reviewed: data.reviewed,
    workStatus: publicWorkStatus(data),
    source: portal.id,
    sourceLabel: portal.label,
    documentsLoginRequired: documentsRequireLogin(data),
  }
}

// Get all saved notices
export async function getNotices(req, res, next) {
  try {
    const directory = outputDirectory(req);
    const files = await fs.readdir(directory);

    const noticeFiles = files.filter((file) => storageIdFromFilename(file));
    const storageIds = noticeFiles.map((file) => storageIdFromFilename(file));
    const reads = await loadNoticeReads(readsDirectory(req), directory, storageIds);

    const notices = await Promise.all(
      noticeFiles.map(async (file) => {
        const storageId = storageIdFromFilename(file);
        const filePath = path.join(directory, file);
        const content = await fs.readFile(filePath, "utf8");
        const data = JSON.parse(content);
        const summary = noticeSummary(data, storageId);
        const unread = isUnread(reads, storageId);

        if (req.auth?.role === "guest" && !requestHasGuestFullAccess(req)) {
          return {
            ...publicNoticeFields(data),
            storageId,
            source: summary.source,
            sourceLabel: summary.sourceLabel,
            documentsLoginRequired: summary.documentsLoginRequired,
            unread,
          };
        }

        return { ...summary, unread };
      })
    );

    res.json(notices);
  } catch (error) {
    next(error);
  }
}

export async function markNoticeRead(req, res, next) {
  try {
    const id = String(req.params.id || "");
    const directory = outputDirectory(req);
    const filePath = noticeFilePath(directory, id);
    if (!filePath) {
      res.status(400).json({ error: "Invalid notice id" });
      return;
    }

    try {
      await fs.access(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        res.status(404).json({ error: "Notice not found" });
        return;
      }
      throw error;
    }

    const result = await recordNoticeRead(readsDirectory(req), directory, id);
    res.json(result);
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
}

// Get one notice by ID
export async function getNoticeById(req, res, next) {
  try {
    const { id } = req.params;
    const directory = outputDirectory(req);
    const filePath = noticeFilePath(directory, id);
    if (!filePath) {
      return res.status(400).json({ error: "Invalid notice id" });
    }

    const content = await fs.readFile(filePath, "utf8");
    const notice = JSON.parse(content);
    const portal = portalFromPacket(notice, id);
    const documentsLoginRequired = documentsRequireLogin(notice);
    if (req.auth?.role === "guest" && !requestHasGuestFullAccess(req)) {
      res.json({ notice: publicNoticeFields(notice), portal, documentsLoginRequired });
      return;
    }
    const extractedRequirements = await readSavedSoftwareRequirements(id, { outputDir: directory });
    if (extractedRequirements) {
      notice.extractedRequirements = extractedRequirements;
    }

    res.json({ ...notice, portal, documentsLoginRequired });
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
    if (!isSafeStorageId(id)) {
      return res.status(400).json({ error: "Invalid notice id" });
    }

    const documentsDir = path.join(documentsDirectory(req), id);

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
    if (!isSafeStorageId(id)) {
      return res.status(400).json({ error: "Invalid notice id" });
    }

    const documentsDir = path.join(documentsDirectory(req), id);
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
      outputDir: outputDirectory(req),
      documentsRoot: documentsDirectory(req),
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
      outputDir: outputDirectory(req),
      documentsRoot: documentsDirectory(req),
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