// CSV writing for files users download and open in Excel. A cell starting with
// = + - @ (or tab / CR) would run as a formula there (CSV injection), so such
// values get a leading apostrophe, which Excel shows as plain text.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvSafe(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return FORMULA_START.test(s) ? `'${s}` : s;
}

export function toCsv(rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = csvSafe(v);
    return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens UTF-8 (Cyrillic etc.) correctly
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
