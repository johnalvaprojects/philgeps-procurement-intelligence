import path from 'node:path';
import { extractDocxText } from './docx.js';
import { extractPdfText } from './pdf.js';
import { extractXlsxText } from './xlsx.js';

export async function extractDocumentText(filePath, options = {}) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.pdf') {
    return extractPdfText(filePath, options);
  }

  if (extension === '.xlsx') {
    return extractXlsxText(filePath);
  }

  if (extension === '.docx') {
    return extractDocxText(filePath);
  }

  const error = new Error(`Unsupported document type: ${extension || 'unknown'}`);
  error.code = 'UNSUPPORTED_DOCUMENT';
  throw error;
}
