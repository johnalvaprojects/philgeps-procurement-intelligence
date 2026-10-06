import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

// Classification only needs a short procurement excerpt (caller uses ~4k chars).
// These caps prevent densifying pathological Excel !ref values like A2:ALY1048569.
export const XLSX_MAX_ROWS = 2000;
export const XLSX_MAX_COLS = 64;
export const XLSX_MAX_CELLS = 50_000;
export const XLSX_MAX_TEXT_CHARS = 20_000;

function cellHasValue(cell) {
  if (cell == null || typeof cell !== 'object') return false;
  if (cell.t === 'z') return false;
  return cell.v != null || cell.w != null;
}

/** Bounds from real sparse cell addresses only (ignores !metadata and empty cells). */
export function populatedSheetBounds(sheet) {
  if (!sheet || typeof sheet !== 'object') return null;

  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;
  let populated = 0;

  for (const key of Object.keys(sheet)) {
    if (!key || key.charAt(0) === '!') continue;
    if (!cellHasValue(sheet[key])) continue;

    let decoded;
    try {
      decoded = XLSX.utils.decode_cell(key);
    } catch {
      continue;
    }
    if (!Number.isFinite(decoded.r) || !Number.isFinite(decoded.c)) continue;
    if (decoded.r < 0 || decoded.c < 0) continue;

    populated += 1;
    if (decoded.r < minR) minR = decoded.r;
    if (decoded.r > maxR) maxR = decoded.r;
    if (decoded.c < minC) minC = decoded.c;
    if (decoded.c > maxC) maxC = decoded.c;
  }

  if (populated === 0) return null;
  return {
    s: { r: minR, c: minC },
    e: { r: maxR, c: maxC },
    populated,
  };
}

function clampExtractionRange(range) {
  const startR = range.s.r;
  const startC = range.s.c;
  let endR = range.e.r;
  let endC = range.e.c;

  if (endC > startC + XLSX_MAX_COLS - 1) {
    endC = startC + XLSX_MAX_COLS - 1;
  }
  if (endR > startR + XLSX_MAX_ROWS - 1) {
    endR = startR + XLSX_MAX_ROWS - 1;
  }

  while ((endR - startR + 1) * (endC - startC + 1) > XLSX_MAX_CELLS && endR > startR) {
    endR -= 1;
  }
  while ((endR - startR + 1) * (endC - startC + 1) > XLSX_MAX_CELLS && endC > startC) {
    endC -= 1;
  }

  return {
    s: { r: startR, c: startC },
    e: { r: endR, c: endC },
  };
}

/**
 * Safe conversion window for sheet_to_json.
 * Prefer sparse populated bounds; never fall back to a pathological declared !ref.
 */
export function resolveSafeSheetRange(sheet) {
  const populated = populatedSheetBounds(sheet);
  if (!populated) return null;

  const clamped = clampExtractionRange(populated);
  const rows = clamped.e.r - clamped.s.r + 1;
  const cols = clamped.e.c - clamped.s.c + 1;
  if (rows < 1 || cols < 1) return null;
  if (rows * cols > XLSX_MAX_CELLS) return null;

  return {
    range: clamped,
    rangeText: XLSX.utils.encode_range(clamped),
    populated,
  };
}

function appendCapped(parts, chunk, budget) {
  if (budget.remaining <= 0) return;
  if (!chunk) return;
  if (chunk.length <= budget.remaining) {
    parts.push(chunk);
    budget.remaining -= chunk.length;
    return;
  }
  parts.push(chunk.slice(0, budget.remaining));
  budget.remaining = 0;
}

export function workbookCellText(workbook, {
  sheetToJson = (...args) => XLSX.utils.sheet_to_json(...args),
} = {}) {
  const parts = [];
  const budget = { remaining: XLSX_MAX_TEXT_CHARS };

  for (const name of workbook.SheetNames || []) {
    if (budget.remaining <= 0) break;

    const sheet = workbook.Sheets?.[name];
    if (!sheet) continue;

    const safe = resolveSafeSheetRange(sheet);
    if (!safe) continue;

    // Explicit bounded range only — never the original pathological !ref.
    // No defval: avoid materializing empty cells inside the window.
    const rows = sheetToJson(sheet, {
      header: 1,
      raw: false,
      range: safe.rangeText,
      blankrows: false,
    });

    const lines = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const cells = row
        .map((cell) => String(cell ?? '').trim())
        .filter(Boolean);
      if (cells.length > 0) lines.push(cells.join(' '));
    }

    if (lines.length === 0) continue;

    if (parts.length > 0) appendCapped(parts, '\n', budget);
    appendCapped(parts, String(name), budget);
    for (const line of lines) {
      if (budget.remaining <= 0) break;
      appendCapped(parts, '\n', budget);
      appendCapped(parts, line, budget);
    }
  }

  return parts.join('');
}

export async function extractXlsxText(filePath) {
  const bytes = await readFile(filePath);
  // sheetRows is an extra parse-time guard; conversion still uses sparse+clamped ranges.
  const workbook = XLSX.read(bytes, {
    type: 'buffer',
    sheetRows: XLSX_MAX_ROWS,
    cellStyles: false,
    cellHTML: false,
    cellFormula: false,
  });
  const text = workbookCellText(workbook);
  const letters = text.match(/[A-Za-z]/g);

  return {
    text,
    hasUsableText: (letters?.length ?? 0) > 0,
    usedOcr: false,
  };
}
