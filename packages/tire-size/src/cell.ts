// Reading tyre data out of spreadsheet cells for the smart import: a "glued"
// description cell ("Michelin X Multi D 315/80R22.5 156/150L 14pcs DOT2523")
// is split into sizes, quantity, year, load index / ply, condition, origin
// country, brand and pattern. Nothing is dropped silently: what is not
// understood comes back in `unrecognized`, uncertain readings as warnings.
import { parseTireSize, ParsedTireSize, TireSizeFormat } from './strict';
import { parsePartialSize, SizeCandidate } from './partial';
import { implausibleSize } from './plausible';
import { findLoadIndexes, mergeLoadIndexes, ParsedLoadIndex } from './load-index';
import { BrandMatch, findBrand } from './brands';
import { COUNTRY_NAMES, countryCode } from './countries';

export type Segment = 'TBR' | 'PCR' | 'OTR' | 'AGRI' | 'MH';
export type Condition = 'new' | 'used' | 'retreaded';

export const SEGMENTS: Segment[] = ['TBR', 'PCR', 'OTR', 'AGRI', 'MH'];

// ── Sizes ────────────────────────────────────────────────────────────────────

export interface ResolvedSize {
  /** As written in the cell */
  input: string;
  size: ParsedTireSize;
  /** 1 for an unambiguous size, lower when glued digits had several readings */
  confidence: number;
  /** Other strict spellings the input could mean */
  alternatives: string[];
  /** Why the reading is not literal, e.g. 'read "31580R225" as 315/80R22.5' */
  note?: string;
}

// Construction to assume when the input has none: metric sizes with a
// profile are radial in practice; inch sizes depend on the segment.
function defaultConstruction(c: SizeCandidate, segment?: Segment): 'R' | '-' {
  if (c.aspect !== undefined && c.width !== undefined && c.width >= 100) return 'R';
  return segment === 'TBR' || segment === 'PCR' ? 'R' : '-';
}

// A strict spelling for a complete partial reading, adding R/- when missing
function strictLabel(c: SizeCandidate, segment?: Segment): { label: string; assumed: boolean } | null {
  if (!c.complete) return null;
  let label = c.label;
  let assumed = false;
  if (!c.construction) {
    const k = defaultConstruction(c, segment);
    label = label.replace(/\s+(?=[\d.]+$)/, k);
    assumed = true;
  }
  try {
    return { label: parseTireSize(label).size_raw, assumed };
  } catch {
    return null;
  }
}

// One size written in any common way (comma decimals, spaces, LT/ZR, glued
// digits) → a strict size, or null when it is not a size we can store.
export function resolveSize(input: string, segment?: Segment): ResolvedSize | null {
  const norm = String(input ?? '')
    .toUpperCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, '')
    .replace(/^(?:LT|ST|P)(?=\d)/, '')
    .replace(/ZR/, 'R')
    .replace(/[×*]/g, 'X');
  if (!norm) return null;

  let strict: ParsedTireSize | null = null;
  try { strict = parseTireSize(norm); } catch { /* not a strict spelling */ }
  if (strict && implausibleSize(strict)) strict = null;

  const readings: { label: string; confidence: number; assumed: boolean }[] = [];
  for (const c of parsePartialSize(norm).candidates) {
    const s = strictLabel(c, segment);
    if (s && !implausibleSize(parseTireSize(s.label)) && !readings.some((r) => r.label === s.label)) readings.push({ ...s, confidence: c.confidence });
  }

  const same = (a: ParsedTireSize, label: string) => {
    const b = parseTireSize(label);
    return a.size_width === b.size_width && a.size_rim === b.size_rim;
  };
  // The strict parser accepts glued nonsense ("31580R225" → width 31580); a
  // partial reading with other numbers wins over it then
  if (strict && (!readings.length || same(strict, readings[0].label))) {
    return {
      input,
      size: strict,
      confidence: 1,
      alternatives: readings.map((r) => r.label).filter((l) => l !== strict!.size_raw),
    };
  }
  if (readings.length) {
    const [best, ...rest] = readings;
    const notes: string[] = [];
    if (best.label.replace(/[^\dR.-]/g, '') !== norm.replace(/[^\dR.-]/g, '')) notes.push(`read "${input.trim()}" as ${best.label}`);
    if (best.assumed) notes.push(`assumed ${best.label.includes('R') ? 'radial (R)' : 'diagonal (-)'}`);
    return {
      input,
      size: parseTireSize(best.label),
      confidence: rest.length ? best.confidence : Math.max(best.confidence, 0.9),
      alternatives: rest.map((r) => r.label),
      note: notes.length ? notes.join('; ') : undefined,
    };
  }
  return null;
}

// Size formats usual for each segment; others get a warning, never an error
const SEGMENT_FORMATS: Record<Segment, TireSizeFormat[]> = {
  TBR: ['metric', 'radial_inch', 'diagonal_inch'],
  PCR: ['metric', 'outer_diameter'],
  OTR: ['metric', 'flotation', 'radial_inch', 'diagonal_inch', 'slash_diagonal'],
  AGRI: ['metric', 'flotation', 'radial_inch', 'diagonal_inch', 'slash_diagonal', 'outer_diameter'],
  MH: ['diagonal_inch', 'slash_diagonal', 'metric', 'outer_diameter'],
};
const TRUCK_RIMS = [17.5, 19.5, 22.5, 24.5];

/** Why a size looks out of place in the chosen segment, or null */
export function sizeSegmentWarning(size: ParsedTireSize, segment: Segment): string | null {
  const rim = Number(size.size_rim);
  if (!SEGMENT_FORMATS[segment].includes(size.format)) {
    return `${size.size_raw} is an unusual size format for ${segment}`;
  }
  if (segment === 'PCR' && TRUCK_RIMS.includes(rim)) return `${size.size_raw} looks like a truck size, not ${segment}`;
  if (segment === 'TBR' && rim < 15) return `${size.size_raw} has a small rim for ${segment}`;
  if (segment === 'MH' && rim > 25) return `${size.size_raw} has a large rim for ${segment}`;
  return null;
}

// ── Single fields ───────────────────────────────────────────────────────────

/** Whole quantity from "14", 14, "14 pcs", "14,0", "x14", "qty 14"; null if not one (0 is kept: out of stock) */
export function parseQty(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  const t = String(value ?? '').trim().toUpperCase();
  if (!t) return null;
  const m = /^(?:(?:QTY|Q-TY|КОЛ-?ВО|ILOŚĆ|ILOSC|MENGE)\s*[:=.]?\s*)?(?:[X×]\s*)?(\d{1,6})(?:[.,]0+)?\s*(?:PCS|PC|PIECES?|ШТ|SZT|STK|STÜCK|ST|UNITS?|KS|EA)?\.?$/u.exec(t);
  return m ? parseInt(m[1], 10) : null;
}

const THIS_YEAR = new Date().getFullYear();

/** Production year "20xx" from "2023", 2023, "DOT 2523" (week 25 of 2023), "23", a date */
export function parseYear(value: unknown): string | null {
  if (value instanceof Date) return yearOk(value.getFullYear());
  const t = String(value ?? '').trim().toUpperCase();
  if (!t) return null;
  const dot = /^DOT\s*[:#№]?\s*(\d{2})(\d{2})?$/.exec(t);
  if (dot) return dot[2] ? yearFromDot(dot[1] + dot[2]) : yearOk(2000 + +dot[1]);
  const y4 = /^(\d{4})(?:[.,]0+)?(?:\s*(?:Г\.?|ГОД|YEAR))?$/u.exec(t);
  if (y4) return yearOk(+y4[1]) ?? yearFromDot(y4[1]);
  const date = /^(\d{4})-\d{2}-\d{2}/.exec(t) ?? /^\d{1,2}[./]\d{1,2}[./](\d{4})$/.exec(t);
  if (date) return yearOk(+date[1]);
  if (/^\d{2}$/.test(t)) return yearOk(2000 + +t);
  return null;
}

function yearOk(y: number): string | null {
  return y >= 2000 && y <= THIS_YEAR + 1 ? String(y) : null;
}

// DOT date code WWYY: week 01–53, year 20YY
function yearFromDot(code: string): string | null {
  const week = +code.slice(0, 2);
  return week >= 1 && week <= 53 ? yearOk(2000 + +code.slice(2)) : null;
}

const CONDITION_WORDS: [Condition, RegExp][] = [
  ['retreaded', /^(?:RETREAD(?:ED|S)?|REMOULD(?:ED)?|ВОССТАНОВЛ\p{L}*|RUNDERNEUERT|BIEŻNIKOWAN\p{L}*|BIEZNIKOWAN\p{L}*|RICOSTRUIT\p{L}*|RECHAP\p{L}*)$/u],
  ['used', /^(?:USED|Б\/У|Б\.У\.?|БУ|Б\/У\.|ПОДЕРЖАНН\p{L}*|GEBRAUCHT|UŻYWAN\p{L}*|UZYWAN\p{L}*|USAT\p{L}|OCCASION)$/u],
  ['new', /^(?:NEW|NEU|NOW[EAY]|NUOV[OAIE]|NEUF|НОВ\p{L}*)$/u],
];

/** new / used / retreaded from a word in EN/RU/DE/PL/IT/FR, else null */
export function parseCondition(value: unknown): Condition | null {
  const t = String(value ?? '').trim().toUpperCase();
  for (const [c, re] of CONDITION_WORDS) if (re.test(t)) return c;
  return null;
}

const CURRENCIES: [RegExp, string][] = [
  [/€|\bEUR\b|\bEURO?S?\b|ЕВРО/u, 'EUR'],
  [/\$|\bUSD\b|ДОЛЛ\p{L}*/u, 'USD'],
  [/£|\bGBP\b/u, 'GBP'],
  [/ZŁ|\bPLN\b/u, 'PLN'],
  [/₽|\bRUB\b|РУБ\p{L}*\.?/u, 'RUB'],
  [/\bCHF\b/u, 'CHF'],
  [/\bCZK\b|KČ/u, 'CZK'],
  [/\bUAH\b|₴|ГРН/u, 'UAH'],
  [/\bTRY\b|₺/u, 'TRY'],
  [/\bCNY\b|¥/u, 'CNY'],
];

export interface ParsedPrice {
  amount: number;
  currency: string | null;
  /** Set when "1,234" could be 1.234 or 1234 */
  ambiguous?: number;
}

// Price with comma or dot decimals, thousands separators and a currency sign
// or code: "1 234,56 €", "€1,234.56", "USD 99", "99,5". Comma is a decimal
// separator unless a dot follows it.
export function parsePrice(value: unknown): ParsedPrice | null {
  if (typeof value === 'number') return value > 0 ? { amount: Math.round(value * 100) / 100, currency: null } : null;
  let t = String(value ?? '').trim().toUpperCase();
  if (!t) return null;
  let currency: string | null = null;
  for (const [re, code] of CURRENCIES) {
    if (re.test(t)) { currency = code; t = t.replace(re, ' '); break; }
  }
  t = t.replace(/[\s'’ ]/g, '');
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let ambiguous: number | undefined;
  let num: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // the later one is the decimal separator
    num = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    if ((t.match(/,/g) ?? []).length > 1) num = t.replace(/,/g, '');
    else {
      num = t.replace(',', '.');
      if (/^\d{1,3},\d{3}$/.test(t)) ambiguous = +t.replace(',', '');
    }
  } else if ((t.match(/\./g) ?? []).length > 1) {
    num = t.replace(/\./g, '');
  } else {
    num = t;
  }
  const amount = Math.round(parseFloat(num) * 100) / 100;
  if (!isFinite(amount) || amount <= 0) return null;
  return ambiguous !== undefined ? { amount, currency, ambiguous } : { amount, currency };
}

// Tyre types per segment with words people use for them
export const TIRE_TYPES: Partial<Record<Segment, { value: string; label: string; words: string[] }[]>> = {
  TBR: [
    { value: 'steer', label: 'Steer', words: ['steer', 's', 'рулевая', 'рулевые', 'рулевой', 'руль', 'lenk', 'lenkachse', 'prowadząca', 'prowadzaca', 'kierownicza', 'direzionale', 'directionnel'] },
    { value: 'drive', label: 'Drive', words: ['drive', 'd', 'ведущая', 'ведущие', 'ведущий', 'antrieb', 'napędowa', 'napedowa', 'trazione', 'motrice'] },
    { value: 'trailer', label: 'Trailer', words: ['trailer', 't', 'прицеп', 'прицепная', 'прицепные', 'auflieger', 'anhänger', 'naczepa', 'naczepowa', 'rimorchio', 'remorque'] },
    { value: 'all_position', label: 'All Position', words: ['all position', 'all-position', 'allposition', 'ap', 'универсальная', 'универсальные', 'mixed', 'regional', 'uniwersalna'] },
  ],
  PCR: [
    { value: 'summer', label: 'Summer', words: ['summer', 'летняя', 'летние', 'лето', 'sommer', 'letnia', 'letnie', 'estiva', 'estive', 'été'] },
    { value: 'winter_friction', label: 'Winter Friction', words: ['winter', 'winter friction', 'friction', 'зимняя', 'зимние', 'зима', 'нешипованная', 'липучка', 'zimowa', 'zimowe', 'invernale', 'hiver'] },
    { value: 'winter_stud', label: 'Winter Stud', words: ['stud', 'studded', 'winter stud', 'шип', 'шипованная', 'шипованные', 'spikes', 'kolce'] },
    { value: 'all_season', label: 'All Season', words: ['all season', 'all-season', 'allseason', '4 season', 'всесезонная', 'всесезонные', 'ganzjahres', 'ganzjahresreifen', 'całoroczna', 'całoroczne', 'caloroczne', '4 stagioni'] },
  ],
  MH: [
    { value: 'pneumatic', label: 'Pneumatic', words: ['pneumatic', 'пневматическая', 'пневматические', 'пневмо', 'luft', 'pneumatyczna'] },
    { value: 'solid', label: 'Solid', words: ['solid', 'superelastic', 'суперэластик', 'суперэластичная', 'суперэластичные', 'цельнолитая', 'vollgummi', 'pełna', 'pełne', 'pelne'] },
  ],
};

/** A tyre type value for the segment from a word, else null */
export function parseTireType(value: unknown, segment: Segment): string | null {
  const t = String(value ?? '').trim().toLowerCase().replace(/[_]+/g, ' ');
  if (!t) return null;
  for (const type of TIRE_TYPES[segment] ?? []) {
    if (t === type.value.replace(/_/g, ' ') || type.words.includes(t)) return type.value;
  }
  return null;
}

// ── Glued cells ─────────────────────────────────────────────────────────────

export interface GluedCell {
  sizes: ResolvedSize[];
  /** Size-like text that could not be read as a size we support */
  unreadSizes: string[];
  qty: number | null;
  year: string | null;
  load: ParsedLoadIndex;
  /** The load index / ply tokens as written, for the load_index field */
  loadText: string | null;
  condition: Condition | null;
  /** Tyre type of the segment named in the text ("stud", "solid", "рулевая") */
  tire_type: string | null;
  /** ISO code of a country named in the text (taken as origin) */
  origin_country: string | null;
  brand: BrandMatch | null;
  pattern: string | null;
  unrecognized: string | null;
  warnings: string[];
}

// Size spellings, most specific first. Each runs on the text with already
// taken parts blanked out.
const SIZE_RES: { re: RegExp; supported: boolean }[] = [
  // 315/80R22.5, 315/80 R 22,5, LT215/85R16, 12.5/80-18, 315/80 22.5
  { re: /(?<![\w./])(?:LT|ST|P)?\d{2,3}(?:[.,]\d{1,2})?\s?\/\s?\d{2,3}(?:[.,]\d)?(?:\s*(?:Z?R|-)\s*|\s+)\d{2}(?:[.,]\d)?(?![\w/]|[.,]\d)/g, supported: true },
  // 31x10.50R15, 28x9-15, 18x7-8, 27x10-12 (outer diameter x width: MH / ATV / LT)
  { re: /(?<![\w./])\d{1,2}(?:[.,]\d{1,2})?\s?[X×*]\s?\d{1,2}(?:[.,]\d{1,2})?\s?(?:R|-)?\s?\d{1,2}(?![\w/]|[.,]\d)/g, supported: true },
  // glued metric: 31580R225, 38565R22.5
  { re: /(?<![\w./])\d{5}\s?(?:Z?R|-)\s?\d{2,3}(?:[.,]\d)?(?![\w/]|[.,]\d)/g, supported: true },
  // inch: 11R22.5, 12.00R20, 10.00-20, 16.9-28, 17.5L-24, 23.5R25, 1100R20
  { re: /(?<![\w./])\d{1,4}(?:[.,]\d{1,2})?\s?(?:L?-|R)\s?\d{2}(?:[.,]5)?(?![\w/]|[.,]\d)/g, supported: true },
  // small industrial rims: 5.00-8, 4.00-8, 300-4 (decimals or three digits, so "12-8" is no size)
  { re: /(?<![\w./])(?:\d{1,2}[.,]\d{1,2}|\d{3})\s?-\s?\d(?![\w/.,])/g, supported: true },
  // glued digits only: 31580225
  { re: /(?<![\w.,/])\d{7,8}(?![\w.,/])/g, supported: true },
];

const QTY_RES: RegExp[] = [
  /(?<![\w.,])(\d{1,5})\s*(?:PCS|PC|PIECES?|ШТ|SZT|STK|STÜCK|ST|UNITS?|KS|EA)\.?(?![\p{L}\p{N}])/gu,
  /(?:QTY|Q-TY|КОЛ-?ВО|КОЛИЧЕСТВО|ILOŚĆ|ILOSC|MENGE|ANZ\.?)\s*[:=.]?\s*(\d{1,5})(?!\d)/gu,
  /(?<![\w.,])[X×]\s?(\d{1,5})(?![\w.,])/gu,
];

const YEAR_RES: RegExp[] = [
  /DOT\s*[:#№]?\s*(\d{4}|\d{2})(?!\d)/gu,
  /(?<![\w.,/])(20\d{2})(?:\s*(?:Г\.?|ГОД|YEAR))?(?![\w.,/])/gu,
];

const CONDITION_RE = /(?<![\p{L}\p{N}])(RETREAD(?:ED)?|REMOULD(?:ED)?|ВОССТАНОВЛ\p{L}*|RUNDERNEUERT|BIEŻNIKOWAN\p{L}*|USED|Б\/У|Б\.У\.?|GEBRAUCHT|UŻYWAN\p{L}*|USAT[OAIE]|NEW|NEU|NOWE|NUOV[OAIE]|NEUF|НОВ(?:АЯ|ЫЕ|ЫЙ|ОЕ))(?![\p{L}\p{N}])/gu;

// Separators and brackets that carry no meaning on their own
const FILLER_CHARS = /^[\s()[\]{},;:/+&|*#№.-]*$/;

function toUpperSameLength(s: string): string {
  let out = '';
  for (const ch of s) {
    const u = ch.toUpperCase();
    out += u.length === ch.length ? u : ch;
  }
  return out;
}

export function parseGluedCell(text: string, segment?: Segment): GluedCell {
  const src = String(text ?? '').replace(/[   \t\r\n]/g, ' ');
  const upper = toUpperSameLength(src);
  const taken: boolean[] = new Array(src.length).fill(false);
  const visible = () => upper.split('').map((c, i) => (taken[i] ? ' ' : c)).join('');
  const isFree = (s: number, e: number) => !taken.slice(s, e).some(Boolean);
  const take = (s: number, e: number) => { for (let i = s; i < e; i++) taken[i] = true; };

  const out: GluedCell = {
    sizes: [], unreadSizes: [], qty: null, year: null,
    load: { load_index_single: null, speed_single: null, load_index_dual: null, speed_dual: null, ply_rating: null },
    loadText: null, condition: null, tire_type: null, origin_country: null, brand: null, pattern: null, unrecognized: null, warnings: [],
  };

  // 1. sizes, in the order written (the first one is the main size)
  const found: { start: number; end: number; resolved: ResolvedSize | null; raw: string; supported: boolean }[] = [];
  for (const { re, supported } of SIZE_RES) {
    re.lastIndex = 0;
    const v = visible();
    let m: RegExpExecArray | null;
    while ((m = re.exec(v))) {
      const start = m.index, end = start + m[0].length;
      if (!isFree(start, end)) continue;
      const raw = src.slice(start, end);
      const resolved = supported ? resolveSize(raw, segment) : null;
      // Glued digits are only a size when they read as a complete one
      if (supported && !resolved && /^\d+$/.test(raw.trim())) continue;
      if (supported && !resolved && /^\d{3,4}\s?-\s?\d{2}$/.test(raw.trim())) continue; // "2023-05"
      take(start, end);
      found.push({ start, end, resolved, raw: raw.trim(), supported });
    }
  }
  for (const f of found.sort((a, b) => a.start - b.start)) {
    if (f.resolved) {
      if (!out.sizes.some((s) => s.size.size_raw === f.resolved!.size.size_raw)) out.sizes.push(f.resolved);
      if (f.resolved.note) out.warnings.push(`Size: ${f.resolved.note}`);
      if (f.resolved.alternatives.length) out.warnings.push(`Size ${f.resolved.size.size_raw} could also be ${f.resolved.alternatives.join(', ')}`);
    } else {
      out.unreadSizes.push(f.raw);
      out.warnings.push(f.supported ? `Could not read size "${f.raw}"` : `Size format "${f.raw}" is not supported yet`);
    }
  }

  // 2. year / DOT
  for (const re of YEAR_RES) {
    re.lastIndex = 0;
    const v = visible();
    let m: RegExpExecArray | null;
    while ((m = re.exec(v))) {
      const y = m[0].startsWith('DOT') ? parseYear(m[0]) : yearOk(+m[1]);
      if (!y) continue;
      take(m.index, m.index + m[0].length);
      if (!out.year) out.year = y;
      else if (out.year !== y) out.warnings.push(`Several years; kept ${out.year}, ignored ${y}`);
    }
  }

  // 3. quantity
  for (const re of QTY_RES) {
    re.lastIndex = 0;
    const v = visible();
    let m: RegExpExecArray | null;
    while ((m = re.exec(v))) {
      take(m.index, m.index + m[0].length);
      const q = parseInt(m[1], 10);
      if (out.qty === null) out.qty = q;
      else if (out.qty !== q) out.warnings.push(`Several quantities; kept ${out.qty}, ignored ${q}`);
    }
  }

  // 4. load index and ply rating
  const lis = findLoadIndexes(visible());
  if (lis.length) {
    for (const m of lis) take(m.start, m.end);
    const merged = mergeLoadIndexes(lis);
    out.load = merged.value;
    out.loadText = lis.map((m) => src.slice(m.start, m.end).trim()).join(' ');
    out.warnings.push(...merged.warnings);
  }

  // 5. condition
  CONDITION_RE.lastIndex = 0;
  {
    const v = visible();
    let m: RegExpExecArray | null;
    while ((m = CONDITION_RE.exec(v))) {
      const c = parseCondition(m[1]);
      if (!c) continue;
      take(m.index, m.index + m[0].length);
      if (!out.condition) out.condition = c;
      else if (out.condition !== c) out.warnings.push(`Both "${out.condition}" and "${c}" in the text; kept ${out.condition}`);
    }
  }

  // 5b. tyre type words of the segment (single letters like "s"/"d" only in their own column)
  if (segment) {
    const lower = visible().toLowerCase();
    outer: for (const type of TIRE_TYPES[segment] ?? []) {
      for (const w of [...type.words].sort((a, b) => b.length - a.length)) {
        if (w.length < 3) continue;
        const at = findWord(lower, w);
        if (at < 0) continue;
        take(at, at + w.length);
        out.tire_type = type.value;
        break outer;
      }
    }
  }

  // 6. country (names only, or "made in XX"), taken as country of origin
  {
    const lower = visible().toLowerCase();
    const madeIn = /(?:made\s+in|origin|произв(?:одство)?\.?|herkunft|kraj)\s*[:\-]?\s*([a-z]{2})(?![a-z])/i.exec(lower);
    if (madeIn && countryCode(madeIn[1])) {
      out.origin_country = countryCode(madeIn[1]);
      take(madeIn.index, madeIn.index + madeIn[0].length);
    } else {
      for (const [name, code] of COUNTRY_NAMES) {
        const at = findWord(lower, name);
        if (at < 0) continue;
        out.origin_country = code;
        // also take a "made in" right before the name
        const before = /(?:made\s+in|origin|произв(?:одство)?\.?|herkunft)\s*[:\-]?\s*$/i.exec(lower.slice(0, at));
        take(before ? before.index : at, at + name.length);
        break;
      }
    }
  }

  // 7. brand, and the pattern written next to it
  const v = visible();
  out.brand = findBrand(v);
  if (out.brand) {
    out.brand.original = src.slice(out.brand.start, out.brand.end);
    if (!out.brand.exact) out.warnings.push(`Brand "${out.brand.original.trim()}" read as ${out.brand.brand}`);
    // the free run of text around the brand, between taken parts
    let s = out.brand.start, e = out.brand.end;
    while (s > 0 && !taken[s - 1]) s--;
    while (e < src.length && !taken[e]) e++;
    out.pattern = cleanPattern(src.slice(s, out.brand.start) + ' ' + src.slice(out.brand.end, e));
    take(s, e);
    // "Mitas 480/70R38 145A8/142B AC70": no text next to the brand, so the
    // next free text after it is probably the pattern — a guess, so say so
    if (!out.pattern) {
      let a = e;
      while (a < src.length && (taken[a] || /\s/.test(src[a]))) a++;
      let b = a;
      while (b < src.length && !taken[b]) b++;
      const next = cleanPattern(src.slice(a, b));
      if (next) {
        out.pattern = next;
        take(a, b);
        out.warnings.push(`Pattern "${next}" taken from the text after the brand`);
      }
    }
  }

  // 8. whatever is left
  const rest = src.split('')
    .map((c, i) => (taken[i] ? '\u0000' : c))
    .join('')
    .split('\u0000')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && !FILLER_CHARS.test(p));
  out.unrecognized = rest.length ? rest.join(' … ') : null;

  return out;
}

function cleanPattern(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').replace(/^[\s,;:/|()-]+|[\s,;:/|(-]+$/g, '').trim();
  return t && !FILLER_CHARS.test(t) ? t : null;
}

// Index of `word` in `text` at word boundaries (letters/digits), or -1
function findWord(text: string, word: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at < 0) return -1;
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + word.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return at;
    from = at + 1;
  }
}
