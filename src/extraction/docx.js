import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';

export async function extractDocxText(filePath) {
  try {
    const buffer = await readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    const text = String(result?.value || '');
    const letters = text.match(/[A-Za-z]/g);
    return {
      text,
      hasUsableText: (letters?.length ?? 0) > 0,
      usedOcr: false,
    };
  } catch (error) {
    const unreadable = new Error(`Could not read the DOCX file: ${error.message}`);
    unreadable.code = 'UNREADABLE_DOCUMENT';
    throw unreadable;
  }
}
