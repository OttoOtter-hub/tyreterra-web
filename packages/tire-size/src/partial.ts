// Lenient parser for size *queries*: anything a user may type into a search
// box, complete or not. Unlike parseTireSize() (strict, used to store
// listings) it never throws. It returns every plausible reading as a
// candidate with a confidence instead of silently guessing one.
//
//   315/80R22.5 · 315 80 22,5 · 31580R225 · 38565225 · 315/80R · 315 ·
//   12.5/80-18 · 10.00-20 · 750-16 · 14.9R28 · 11R22.5 · 19.5L-24 · 1100R20

import type { TireSizeFormat } from './strict';

export type Construction = 'R' | '-';

// 'inch'    — width + rim in inches, radial or diagonal not stated (e.g. "14.9 28")
// 'partial' — rim not typed yet
export type PartialFormat = TireSizeFormat | 'inch' | 'partial';

export interface SizeCandidate {
  width?: number;
  aspect?: number;
  construction?: Construction;
  rim?: number;
  format: PartialFormat;
  /** 0..1; the candidates of one query add up to 1 */
  confidence: number;
  /** width and rim are both known */
  complete: boolean;
  /** canonical text, e.g. "315/80R22.5"; "…" marks the part still missing */
  label: string;
}

export interface PartialSize {
  width?: number;
  aspect?: number;
  construction?: Construction;
  rim?: number;
  format: PartialFormat | 'unknown';
  confidence: number;
  candidates: SizeCandidate[];
}

const MAX_INPUT_LENGTH = 40;
const MAX_CANDIDATES = 5;

const EMPTY: PartialSize = Object.freeze({ format: 'unknown', confidence: 0, candidates: [] }) as PartialSize;

// ── Value ranges ──────────────────────────────────────────────────────────

function isMetricWidth(v: number): boolean {
  return Number.isInteger(v) && v >= 100 && v <= 1300;
}

function isInchWidth(v: number): boolean {
  return v >= 4 && v <= 60;
}

// Profiles in steps of 5 are what real sizes use; a glued string ("31580225")
// only accepts those, an explicitly separated one ("315/82") any integer.
function isAspect(v: number, glued: boolean): boolean {
  if (!Number.isInteger(v) || v < 25 || v > 95) return false;
  return !glued || v % 5 === 0;
}

// Half-inch rims that exist (truck, trailer, industrial); "225" means 22.5
const HALF_RIMS = new Set([14.5, 15.5, 16.5, 17.5, 19.5, 22.5, 24.5]);

function isRim(v: number): boolean {
  return v >= 8 && v <= 57 && Math.round(v * 10) === v * 10;
}

// Could `text` be the first digits of a valid value for `slot` that the user
// is still typing? Only asked for the very last thing typed.
function couldBePrefix(slot: Slot, text: string): boolean {
  if (!/^[1-9]$/.test(text)) return false;
  const d = Number(text);
  if (slot === 'W') return d < 4; // 1–3 can start 100–399
  if (slot === 'A') return d >= 2; // 25–95
  return d <= 5; // rims 10–57
}

// ── Tokenizer ─────────────────────────────────────────────────────────────

type Sep = '/' | '-' | 'R' | 'L' | ' ';
type Slot = 'W' | 'A' | 'Rm';

interface Lexed {
  nums: string[];
  seps: Sep[]; // seps[i] sits between nums[i] and nums[i + 1]
  trailing?: Sep; // marker typed after the last number, e.g. "315/80R"
}

// Spaces next to a real separator do not count ("315 / 80 R 22.5")
function combineSeps(raw: string[]): Sep | null {
  const real = raw.filter((s) => s !== ' ');
  if (real.length === 0) return ' ';
  if (real.length === 1) return real[0] as Sep;
  if (real.length === 2 && real[0] === 'L' && real[1] === '-') return 'L';
  return null;
}

function lex(input: string): Lexed | null {
  const nums: string[] = [];
  const seps: Sep[] = [];
  let pending: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i;
      while (j < input.length && ((input[j] >= '0' && input[j] <= '9') || input[j] === '.')) j++;
      const num = input.slice(i, j);
      if (!/^\d+(\.\d*)?$/.test(num)) return null;
      if (nums.length === 0) {
        if (combineSeps(pending) !== ' ') return null; // leading "/80", "R22.5"
      } else {
        const sep = combineSeps(pending);
        if (!sep) return null;
        seps.push(sep);
      }
      nums.push(num.endsWith('.') ? num.slice(0, -1) : num);
      pending = [];
      i = j;
      continue;
    }
    if (ch === '/' || ch === '-' || ch === 'R' || ch === 'L') pending.push(ch);
    else if (ch === ' ' || ch === 'X' || ch === '*') pending.push(' ');
    else return null;
    i++;
  }
  if (nums.length === 0) return null;
  const trailing = combineSeps(pending);
  if (!trailing) return null;
  return { nums, seps, trailing: trailing === ' ' ? undefined : trailing };
}

// ── Reading numbers into slots ────────────────────────────────────────────

interface Piece {
  slot: Slot;
  value: number;
  text: string;
  glued: boolean; // came from splitting a run of digits
  prefix: boolean; // incomplete last digits, to be dropped
  weight: number;
}

function rimValue(text: string): { value: number; weight: number } {
  // "225" → 22.5 (three digits ending in 5 are a half-inch rim)
  if (/^\d{3}$/.test(text) && HALF_RIMS.has(Number(text) / 10)) {
    return { value: Number(text) / 10, weight: 0.95 };
  }
  return { value: Number(text), weight: 1 };
}

function piece(slot: Slot, text: string, glued: boolean, typing: boolean): Piece[] {
  if (slot === 'Rm') {
    const out: Piece[] = [];
    const { value, weight } = rimValue(text);
    out.push({ slot, value, text, glued, prefix: false, weight });
    // "3158022" while typing may still become 22.5
    if (glued && typing && /^\d{2}$/.test(text) && HALF_RIMS.has(Number(text) + 0.5)) {
      out.push({ slot, value: Number(text) + 0.5, text: `${text}.5`, glued, prefix: false, weight: 0.5 });
    }
    if (typing && couldBePrefix(slot, text)) out.push({ slot, value: Number(text), text, glued, prefix: true, weight: 0.95 });
    return out;
  }
  const out: Piece[] = [{ slot, value: Number(text), text, glued, prefix: false, weight: 1 }];
  if (typing && couldBePrefix(slot, text)) out.push({ slot, value: Number(text), text, glued, prefix: true, weight: 0.95 });
  return out;
}

// All ways to read one number token as the given consecutive slots
function readToken(text: string, slots: Slot[], typing: boolean): Piece[][] {
  if (slots.length === 1) return piece(slots[0], text, false, typing).map((p) => [p]);

  // Glued: only plain digits, with an optional decimal tail on the last slot
  const m = /^(\d+)(\.\d+)?$/.exec(text);
  if (!m) return [];
  const [, digits, frac = ''] = m;
  const results: Piece[][] = [];

  const walk = (pos: number, idx: number, acc: Piece[][]) => {
    const slot = slots[idx];
    const last = idx === slots.length - 1;
    if (last) {
      const rest = digits.slice(pos);
      const len = rest.length;
      const ok = slot === 'Rm'
        ? (frac ? len === 2 : len === 2 || len === 3 || (typing && len === 1))
        : len === 2 || (typing && len === 1 && !frac);
      if (!ok) return;
      for (const p of piece(slot, rest + frac, true, typing && !frac)) {
        if (len === 1 && !p.prefix) continue; // a lone digit is only ever a typing prefix
        for (const head of acc.length ? cartesian(acc) : [[]]) results.push([...head, p]);
      }
      return;
    }
    const lengths = slot === 'W' ? [3, 4] : [2];
    for (const len of lengths) {
      if (pos + len >= digits.length) continue;
      const part = digits.slice(pos, pos + len);
      walk(pos + len, idx + 1, [...acc, [{ slot, value: Number(part), text: part, glued: true, prefix: false, weight: 1 }]]);
    }
  };
  walk(0, 0, []);
  return results;
}

function cartesian(lists: Piece[][]): Piece[][] {
  return lists.reduce<Piece[][]>((acc, list) => acc.flatMap((a) => list.map((p) => [...a, p])), [[]]);
}

// ── Interpretation ────────────────────────────────────────────────────────

const PATHS: Slot[][] = [['W', 'A', 'Rm'], ['W', 'Rm']];

interface Reading {
  pieces: Piece[];
  joins: { sep: Sep; prev: Slot; cur: Slot }[];
}

function readings(lexed: Lexed): Reading[] {
  const out: Reading[] = [];
  const { nums, seps, trailing } = lexed;
  for (const path of PATHS) {
    const rec = (ti: number, si: number, pieces: Piece[], joins: Reading['joins']) => {
      if (ti === nums.length) {
        out.push({ pieces, joins });
        return;
      }
      const lastToken = ti === nums.length - 1;
      // The last number is still being typed unless a separator follows it
      const typing = lastToken && !trailing;
      for (let k = 1; k <= Math.min(3, path.length - si); k++) {
        for (const alt of readToken(nums[ti], path.slice(si, si + k), typing)) {
          const next = ti > 0 ? [...joins, { sep: seps[ti - 1], prev: pieces[pieces.length - 1].slot, cur: alt[0].slot }] : joins;
          rec(ti + 1, si + k, [...pieces, ...alt], next);
        }
      }
    };
    rec(0, 0, [], []);
  }
  return out;
}

function interpret(r: Reading, trailing: Sep | undefined): SizeCandidate | null {
  let weight = r.pieces.reduce((w, p) => w * p.weight, 1);
  if (r.pieces.some((p) => p.glued)) weight *= 0.9;

  // A typing prefix is dropped; it only narrows nothing
  const kept = r.pieces.filter((p) => !p.prefix);
  const prefixDropped = kept.length !== r.pieces.length;
  if (!kept.length) return null;

  const get = (slot: Slot) => kept.find((p) => p.slot === slot);
  const w = get('W')!;
  const a = get('A');
  const rm = get('Rm');

  let construction: Construction | undefined;
  let lSeries = false;
  let slashBeforeAspect = false;
  let dashBeforeAspect = false;

  for (const { sep, prev, cur } of r.joins) {
    switch (sep) {
      case ' ':
        break;
      case '/':
        if (prev === 'W' && cur === 'A') slashBeforeAspect = true;
        else if (prev === 'A' && cur === 'Rm') weight *= 0.9; // "315/80/22.5"
        else return null;
        break;
      case 'R':
        if (cur !== 'Rm') return null;
        construction = 'R';
        break;
      case '-':
        if (prev === 'W' && cur === 'A') dashBeforeAspect = true; // "315-80-22.5": just a separator
        else if (cur === 'Rm' && ((prev === 'A' && slashBeforeAspect) || prev === 'W')) construction = '-';
        // otherwise a plain separator
        break;
      case 'L':
        if (prev !== 'W' || cur !== 'Rm') return null;
        construction = '-';
        lSeries = true;
        break;
    }
  }

  const lastKept = kept[kept.length - 1].slot;
  if (trailing && !prefixDropped) {
    switch (trailing) {
      case '/':
        if (lastKept !== 'W') return null;
        break;
      case 'R':
        if (lastKept === 'Rm') return null;
        construction = 'R';
        break;
      case '-':
        if (lastKept === 'Rm') return null;
        if ((lastKept === 'A' && slashBeforeAspect) || (lastKept === 'W' && !isMetricWidth(w.value))) construction = '-';
        break;
      case 'L':
        if (lastKept !== 'W') return null;
        construction = '-';
        lSeries = true;
        break;
    }
  }

  // ── Range checks ──
  let width = w.value;
  let widthText = w.text;
  const metric = isMetricWidth(width);
  if (!metric && !isInchWidth(width)) return null;

  if (a) {
    if (!isAspect(a.value, a.glued)) return null;
    // inch width + profile only as "12.5/80" or "10.0/75"
    if (!metric && (!slashBeforeAspect || !w.text.includes('.'))) return null;
    if (!metric && dashBeforeAspect) return null;
    if (a.value % 5 !== 0) weight *= 0.8;
  }
  if (rm && !isRim(rm.value)) return null;
  if (lSeries && metric) return null;

  // "1100R20", "750-16": an inch width written without its decimal point
  if (metric && !a && rm) {
    const inch = width / 100;
    if (width % 25 !== 0 || !isInchWidth(inch) || inch > 30) return null;
    width = inch;
    widthText = inch.toFixed(2);
    weight *= 0.85;
  }
  if (prefixDropped) weight *= 0.95;

  const aspect = a?.value;
  const rim = rm?.value;
  let format: PartialFormat;
  if (rim === undefined) format = 'partial';
  else if (aspect !== undefined) format = construction === '-' ? 'slash_diagonal' : width >= 500 ? 'flotation' : 'metric';
  else format = construction === 'R' ? 'radial_inch' : construction === '-' ? 'diagonal_inch' : 'inch';

  const label = makeLabel(widthText, lSeries, aspect, construction, rm?.text, rim);
  return {
    ...(width !== undefined && { width }),
    ...(aspect !== undefined && { aspect }),
    ...(construction && { construction }),
    ...(rim !== undefined && { rim }),
    format,
    confidence: weight,
    complete: rim !== undefined,
    label,
  };
}

function makeLabel(
  widthText: string,
  lSeries: boolean,
  aspect: number | undefined,
  construction: Construction | undefined,
  rimText: string | undefined,
  rim: number | undefined,
): string {
  let s = widthText.replace(/^0+(?=\d)/, '') + (lSeries ? 'L' : '');
  if (aspect !== undefined) s += `/${aspect}`;
  const c = construction === 'R' ? 'R' : construction === '-' ? '-' : rim !== undefined ? ' ' : '';
  if (rim === undefined) return `${s}${c}…`;
  const shown = rimText && /^\d+(\.\d+)?$/.test(rimText) && Number(rimText) === rim ? rimText : String(rim);
  return `${s}${c}${shown}`;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Uppercase, comma → dot, trimmed, inner whitespace collapsed. */
export function normaliseSizeQuery(q: string): string {
  return q.toUpperCase().replace(/,/g, '.').replace(/\s+/g, ' ').trim();
}

export function parsePartialSize(q: string | null | undefined): PartialSize {
  if (typeof q !== 'string') return { ...EMPTY, candidates: [] };
  const input = normaliseSizeQuery(q);
  if (!input || input.length > MAX_INPUT_LENGTH) return { ...EMPTY, candidates: [] };

  const lexed = lex(input);
  if (!lexed) return { ...EMPTY, candidates: [] };

  const byKey = new Map<string, SizeCandidate>();
  for (const r of readings(lexed)) {
    const c = interpret(r, lexed.trailing);
    if (!c) continue;
    const key = `${c.width}|${c.aspect}|${c.construction}|${c.rim}`;
    const existing = byKey.get(key);
    if (!existing || existing.confidence < c.confidence) byKey.set(key, c);
  }

  let candidates = [...byKey.values()]
    .sort((x, y) => y.confidence - x.confidence || Number(y.complete) - Number(x.complete))
    .slice(0, MAX_CANDIDATES);
  const total = candidates.reduce((s, c) => s + c.confidence, 0);
  candidates = candidates.map((c) => ({ ...c, confidence: Math.round((c.confidence / total) * 100) / 100 }));
  if (!candidates.length) return { ...EMPTY, candidates: [] };

  const best = candidates[0];
  return {
    ...(best.width !== undefined && { width: best.width }),
    ...(best.aspect !== undefined && { aspect: best.aspect }),
    ...(best.construction && { construction: best.construction }),
    ...(best.rim !== undefined && { rim: best.rim }),
    format: best.format,
    confidence: best.confidence,
    candidates,
  };
}
