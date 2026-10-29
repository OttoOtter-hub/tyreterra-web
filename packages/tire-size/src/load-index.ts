// Load index, speed symbol and ply rating as written on tyres and in price
// lists: "160K", "156/150L", "160K/164J", "173D/178A8", "16PR", "PR16",
// "16 ply", "16PR (132B)", "132B 16PR". One parser for the import, the
// listing form and search filters. Case and spaces don't matter.

export interface ParsedLoadIndex {
  load_index_single: number | null;
  speed_single: string | null;
  load_index_dual: number | null;
  speed_dual: string | null;
  ply_rating: number | null;
}

export interface LoadIndexResult extends ParsedLoadIndex {
  /** True when the whole input was read (nothing left over) */
  complete: boolean;
  /** Text that was not understood, '' when complete */
  rest: string;
  /** Something was read, but not everything, or it was ambiguous */
  warnings: string[];
}

/** A load index / ply token found inside free text, with its position */
export interface LoadIndexMatch {
  start: number;
  end: number;
  text: string;
  value: Partial<ParsedLoadIndex>;
}

// Speed symbols (ETRTO): A1–A8 for slow-moving tyres, then B…Y (no I, O, X)
const SPEED = '(?:A[1-8]|[BCDEFGJKLMNPQRSTUHVWY])';
const LI = '(\\d{2,3})';

// Order matters: the most specific forms first
const PATTERNS: { re: RegExp; read: (m: RegExpExecArray) => Partial<ParsedLoadIndex> | null }[] = [
  // 160K/164J, 173D/178A8, 156/150L (one speed symbol at the end applies to both)
  {
    re: new RegExp(`(?<![\\w/.])${LI}(?:\\s?(${SPEED}))?\\s*/\\s*${LI}\\s?(${SPEED})(?![\\w/])`, 'g'),
    read: (m) => li({
      load_index_single: +m[1],
      speed_single: m[2] ?? m[4],
      load_index_dual: +m[3],
      speed_dual: m[4],
    }),
  },
  // 160K, 160 K, (132B)
  {
    re: new RegExp(`(?<![\\w/.])${LI}\\s?(${SPEED})(?![\\w/])`, 'g'),
    read: (m) => li({ load_index_single: +m[1], speed_single: m[2] }),
  },
  // 16PR, 16 PR, 16P.R., 16 ply, 16 нс (Russian "норма слойности")
  {
    re: /(?<![\w.])(\d{1,2})\s*(?:P\.?R\.?|PLY|НС)(?![\wА-ЯЁ])/giu,
    read: (m) => ply(+m[1]),
  },
  // PR16, PR 16, PLY 16
  {
    re: /(?<![\w.])(?:PR|PLY)\s*(\d{1,2})(?![\w.])/gi,
    read: (m) => ply(+m[1]),
  },
];

function li(v: Partial<ParsedLoadIndex>): Partial<ParsedLoadIndex> | null {
  // Load indexes in use run from about 50 (small MH) to 280 (large OTR)
  for (const n of [v.load_index_single, v.load_index_dual]) {
    if (n !== undefined && n !== null && (n < 20 || n > 280)) return null;
  }
  return v;
}

function ply(n: number): Partial<ParsedLoadIndex> | null {
  return n >= 2 && n <= 40 ? { ply_rating: n } : null;
}

/** Every load index / ply token in `text`, left to right, non-overlapping */
export function findLoadIndexes(text: string): LoadIndexMatch[] {
  const upper = String(text ?? '').toUpperCase();
  const taken: boolean[] = new Array(upper.length).fill(false);
  const out: LoadIndexMatch[] = [];
  for (const { re, read } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(upper))) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.slice(start, end).some(Boolean)) continue;
      const value = read(m);
      if (!value) continue;
      for (let i = start; i < end; i++) taken[i] = true;
      out.push({ start, end, text: String(text).slice(start, end), value });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const EMPTY: ParsedLoadIndex = {
  load_index_single: null,
  speed_single: null,
  load_index_dual: null,
  speed_dual: null,
  ply_rating: null,
};

/** Merges found tokens; the first of each kind wins, later ones are reported */
export function mergeLoadIndexes(matches: LoadIndexMatch[]): { value: ParsedLoadIndex; warnings: string[] } {
  const value: ParsedLoadIndex = { ...EMPTY };
  const warnings: string[] = [];
  let haveLi = false;
  for (const m of matches) {
    if (m.value.ply_rating !== undefined) {
      if (value.ply_rating === null) value.ply_rating = m.value.ply_rating ?? null;
      else warnings.push(`Several ply ratings; kept ${value.ply_rating}PR, ignored "${m.text}"`);
      continue;
    }
    if (haveLi) {
      warnings.push(`Several load indexes; kept the first, ignored "${m.text}"`);
      continue;
    }
    haveLi = true;
    Object.assign(value, {
      load_index_single: m.value.load_index_single ?? null,
      speed_single: m.value.speed_single ?? null,
      load_index_dual: m.value.load_index_dual ?? null,
      speed_dual: m.value.speed_dual ?? null,
    });
  }
  return { value, warnings };
}

// Brackets, commas and similar separators left between tokens
const FILLER = /^[\s()[\]{},;:/+&|-]*$/;

// Reads a load index field. Never throws: what is not understood stays in
// `rest` with a warning, and the parsed fields are null for it.
export function parseLoadIndex(input: string | null | undefined): LoadIndexResult {
  const text = String(input ?? '').trim();
  if (!text) return { ...EMPTY, complete: true, rest: '', warnings: [] };

  const matches = findLoadIndexes(text);
  let rest = '';
  let pos = 0;
  for (const m of matches) {
    rest += text.slice(pos, m.start) + ' ';
    pos = m.end;
  }
  rest += text.slice(pos);
  const leftover = FILLER.test(rest) ? '' : rest.replace(/\s+/g, ' ').trim();

  const { value, warnings } = mergeLoadIndexes(matches);
  if (!matches.length) warnings.push(`Could not read load index "${text}"`);
  else if (leftover) warnings.push(`Load index: could not read "${leftover}"`);
  return { ...value, complete: matches.length > 0 && !leftover, rest: leftover, warnings };
}

/** "156/150L 16PR" style label of parsed values, for display */
export function formatLoadIndex(v: ParsedLoadIndex): string {
  const parts: string[] = [];
  if (v.load_index_single !== null) {
    let li = String(v.load_index_single);
    if (v.load_index_dual !== null) {
      li += v.speed_single && v.speed_single !== v.speed_dual ? `${v.speed_single}/${v.load_index_dual}` : `/${v.load_index_dual}`;
      li += v.speed_dual ?? '';
    } else {
      li += v.speed_single ?? '';
    }
    parts.push(li);
  }
  if (v.ply_rating !== null) parts.push(`${v.ply_rating}PR`);
  return parts.join(' ');
}
