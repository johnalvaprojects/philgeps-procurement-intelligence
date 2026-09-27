import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

export function workbookCellText(workbook) {
  const parts = [];

  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets?.[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const lines = [];

    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const cells = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);
      if (cells.length > 0) lines.push(cells.join(' '));
    }

    if (lines.length === 0) continue;
    parts.push(name);
    parts.push(...lines);
  }

  return parts.join('\n');
}

export async function extractXlsxText(filePath) {
  const bytes = await readFile(filePath);
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const text = workbookCellText(workbook);
  const letters = text.match(/[A-Za-z]/g);

  return {
    text,
    hasUsableText: (letters?.length ?? 0) > 0,
    usedOcr: false,
  };
}
