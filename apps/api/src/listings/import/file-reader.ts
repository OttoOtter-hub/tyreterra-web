import * as ExcelJS from 'exceljs';
import { assertSafeZip, ZipGuardError } from './zip-guard';

// Reads an uploaded .xlsx / .csv into plain text grids, in memory only (the
// upload is never written to disk). Formulas are never evaluated: a formula
// cell yields the value Excel saved with it, or nothing.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 5_000;
export const MAX_COLUMNS = 60;
/** Rows read per sheet: data rows plus room for a title block above the header */
const MAX_READ_ROWS = MAX_DATA_ROWS + 100;
const MAX_CELL_CHARS = 1_000;

export interface SheetGrid {
  name: string;
  rows: string[][];
  /** The sheet has more rows than were read */
  truncated: boolean;
}

export interface SpreadsheetFile {
  type: 'xlsx' | 'csv';
  sheets: SheetGrid[];
}

export class FileReadError extends Error {}

const XLSX_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
];
const CSV_MIME = ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream', 'text/x-csv'];

// File type from its first bytes (signature), cross-checked with the name and
// the MIME type the browser sent. Old binary .xls is refused with a hint.
export function detectFileType(buf: Buffer, filename: string, mimetype: string): 'xlsx' | 'csv' {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    if (ext !== 'xlsx' || !XLSX_MIME.includes(mimetype)) throw new FileReadError('The file content does not match its name or type');
    return 'xlsx';
  }
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0) {
    throw new FileReadError('Old Excel .xls files are not supported — save the file as .xlsx or .csv');
  }
  if (!['csv', 'txt'].includes(ext) || !CSV_MIME.includes(mimetype)) {
    throw new FileReadError('Upload an .xlsx or .csv file');
  }
  if (buf.subarray(0, 8192).includes(0)) throw new FileReadError('The file is not a text CSV');
  return 'csv';
}

export async function readSpreadsheet(buf: Buffer, filename: string, mimetype: string): Promise<SpreadsheetFile> {
  if (buf.length > MAX_FILE_BYTES) throw new FileReadError('The file is larger than 5 MB');
  const type = detectFileType(buf, filename, mimetype);
  if (type === 'csv') return { type, sheets: [{ name: 'CSV', ...readCsv(decodeText(buf)) }] };

  try {
    assertSafeZip(buf);
  } catch (e) {
    if (e instanceof ZipGuardError) throw new FileReadError(e.message);
    throw e;
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new FileReadError('Could not read the .xlsx file');
  }
  const sheets: SheetGrid[] = [];
  wb.eachSheet((ws) => {
    const rowCount = ws.rowCount;
    const colCount = Math.min(ws.columnCount, MAX_COLUMNS);
    const rows: string[][] = [];
    for (let r = 1; r <= Math.min(rowCount, MAX_READ_ROWS); r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    }
    sheets.push({ name: ws.name, rows: trimGrid(rows), truncated: rowCount > MAX_READ_ROWS });
  });
  if (!sheets.length) throw new FileReadError('The workbook has no sheets');
  return { type, sheets };
}

// Text of an ExcelJS cell value; formula cells give their saved result only
export function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return clip(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return clip(v.richText.map((t) => t.text).join(''));
    if ('formula' in v || 'sharedFormula' in v) return cellText((v as { result?: ExcelJS.CellValue }).result);
    if ('text' in v) return cellText((v as { text: ExcelJS.CellValue }).text);
    if ('error' in v) return '';
  }
  return '';
}

function clip(s: string): string {
  return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS) : s;
}

// Drops trailing empty rows and columns
function trimGrid(rows: string[][]): string[][] {
  let last = rows.length;
  while (last > 0 && rows[last - 1].every((c) => !c.trim())) last--;
  const kept = rows.slice(0, last);
  let width = 0;
  for (const r of kept) for (let c = r.length; c > width; c--) if (r[c - 1]?.trim()) { width = c; break; }
  return kept.map((r) => r.slice(0, width));
}

// UTF-8 (with or without BOM); otherwise a Windows code page — Cyrillic 1251
// when high bytes look like Cyrillic letters, else Western 1252
export function decodeText(buf: Buffer): string {
  let b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    let high = 0, cyr = 0;
    for (const x of b.subarray(0, 65536)) {
      if (x >= 0x80) high++;
      if (x >= 0xc0) cyr++;
    }
    return new TextDecoder(high && cyr / high > 0.6 ? 'windows-1251' : 'windows-1252').decode(b);
  }
}

// RFC 4180 CSV with the delimiter guessed from the first lines (; , tab |)
export function readCsv(text: string): { rows: string[][]; truncated: boolean } {
  const delimiter = guessDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let truncated = false;
  const pushRow = () => {
    row.push(clip(field));
    if (row.length > MAX_COLUMNS) row = row.slice(0, MAX_COLUMNS);
    rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(clip(field));
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      if (rows.length >= MAX_READ_ROWS) { truncated = i < text.length - 1; break; }
    } else field += ch;
  }
  if (!truncated && (field !== '' || row.length)) pushRow();
  return { rows: trimGrid(rows), truncated };
}

function guessDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',';
  let bestScore = 0;
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => l.replace(/"[^"]*"/g, '').split(d).length - 1);
    const nonZero = counts.filter((c) => c > 0);
    if (!nonZero.length) continue;
    // many columns, on most lines, and the same number of them
    const mode = nonZero.sort((a, b) => nonZero.filter((x) => x === b).length - nonZero.filter((x) => x === a).length)[0];
    const score = mode * (nonZero.filter((c) => c === mode).length / lines.length);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
