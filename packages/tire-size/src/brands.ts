// Tyre brand directory for reading import files: canonical name + aliases
// (other spellings, Cyrillic, abbreviations). It is a fixed list — the import
// never adds to it; an unknown brand is offered as OTHER_BRAND instead.

export const OTHER_BRAND = 'Other';

export const BRANDS: { name: string; aliases?: string[] }[] = [
  { name: 'Michelin', aliases: ['мишлен', 'мишелин'] },
  { name: 'Bridgestone', aliases: ['бриджстоун', 'bridgstone'] },
  { name: 'Continental', aliases: ['континенталь', 'conti'] },
  { name: 'Goodyear', aliases: ['good year', 'гудиер', 'гудьир'] },
  { name: 'Pirelli', aliases: ['пирелли'] },
  { name: 'Dunlop', aliases: ['данлоп'] },
  { name: 'Hankook', aliases: ['ханкук'] },
  { name: 'Yokohama', aliases: ['йокогама', 'йокохама'] },
  { name: 'Toyo', aliases: ['тойо'] },
  { name: 'Kumho', aliases: ['кумхо'] },
  { name: 'Nokian', aliases: ['нокиан', 'nokian tyres', 'nokian heavy tyres'] },
  { name: 'Falken' },
  { name: 'BFGoodrich', aliases: ['bf goodrich', 'bfg', 'b.f. goodrich'] },
  { name: 'Firestone', aliases: ['файрстоун'] },
  { name: 'General Tire', aliases: ['general'] },
  { name: 'Uniroyal' },
  { name: 'Semperit' },
  { name: 'Barum' },
  { name: 'Matador', aliases: ['матадор'] },
  { name: 'Gislaved' },
  { name: 'Kleber' },
  { name: 'Kormoran' },
  { name: 'Tigar' },
  { name: 'Riken' },
  { name: 'Taurus' },
  { name: 'Sava' },
  { name: 'Fulda' },
  { name: 'Debica', aliases: ['dębica'] },
  { name: 'Vredestein' },
  { name: 'Apollo' },
  { name: 'Nexen' },
  { name: 'Maxxis' },
  { name: 'Cooper' },
  { name: 'Laufenn' },
  { name: 'GT Radial', aliases: ['gtradial'] },
  { name: 'Giti' },
  { name: 'Triangle', aliases: ['триангл'] },
  { name: 'Linglong', aliases: ['ling long'] },
  { name: 'Sailun', aliases: ['сайлун'] },
  { name: 'Double Coin', aliases: ['doublecoin'] },
  { name: 'Aeolus', aliases: ['эолус'] },
  { name: 'Advance' },
  { name: 'Samson' },
  { name: 'Westlake' },
  { name: 'Goodride' },
  { name: 'Chaoyang' },
  { name: 'Doublestar', aliases: ['double star'] },
  { name: 'Hifly', aliases: ['hi fly'] },
  { name: 'Annaite' },
  { name: 'Aufine' },
  { name: 'Roadlux' },
  { name: 'Kapsen' },
  { name: 'Austone' },
  { name: 'Jinyu' },
  { name: 'Long March', aliases: ['longmarch'] },
  { name: 'Boto' },
  { name: 'Fortune' },
  { name: 'Leao' },
  { name: 'Windpower' },
  { name: 'Wanli' },
  { name: 'Sunfull' },
  { name: 'Firemax' },
  { name: 'Torque' },
  { name: 'Lassa' },
  { name: 'Petlas' },
  { name: 'Starmaxx' },
  { name: 'Kama', aliases: ['кама', 'nizhnekamskshina', 'нижнекамскшина'] },
  { name: 'Cordiant', aliases: ['кордиант'] },
  { name: 'Tunga', aliases: ['тунга'] },
  { name: 'Belshina', aliases: ['белшина', 'bel shina'] },
  { name: 'Altai', aliases: ['алтайшина', 'altaishina'] },
  { name: 'Omskshina', aliases: ['омскшина'] },
  { name: 'Voltyre', aliases: ['волтайр', 'voltyre-prom'] },
  { name: 'Rosava', aliases: ['росава'] },
  { name: 'Titan' },
  { name: 'Alliance' },
  { name: 'BKT', aliases: ['balkrishna'] },
  { name: 'Mitas' },
  { name: 'Trelleborg' },
  { name: 'Ceat' },
  { name: 'MRF' },
  { name: 'JK Tyre', aliases: ['jk tyres', 'jk'] },
  { name: 'Eurogrip', aliases: ['tvs eurogrip', 'tvs'] },
  { name: 'Galaxy' },
  { name: 'Solideal' },
  { name: 'Camso' },
  { name: 'Magna' },
  { name: 'Armour' },
  { name: 'Ascenso' },
  { name: 'Seha' },
  { name: 'Ozka' },
  { name: 'Taishan' },
  { name: 'GRI', aliases: ['global rubber industries'] },
  { name: 'Marangoni' },
  { name: 'Bandag' },
  { name: 'Vipal' },
  { name: 'Kingrun' },
  { name: 'Kenda' },
  { name: 'Deestone' },
  { name: 'Kelly' },
  { name: 'Hercules' },
  { name: 'Mastercraft' },
  { name: 'Landspider' },
  { name: 'Ovation' },
  { name: 'Tracmax' },
  { name: 'Prinx' },
  { name: 'Otani' },
  { name: 'Infinity' },
];

export interface BrandMatch {
  /** Canonical brand name from the directory */
  brand: string;
  /** The words as written in the text */
  original: string;
  start: number;
  end: number;
  /** False when matched with a typo (edit distance ≥ 1) */
  exact: boolean;
}

/** Lower-case, letters and digits only (keeps Cyrillic and accents) */
export function brandKey(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

let index: Map<string, string> | null = null;
function brandIndex(): Map<string, string> {
  if (!index) {
    index = new Map();
    for (const b of BRANDS) {
      for (const n of [b.name, ...(b.aliases ?? [])]) index.set(brandKey(n), b.name);
    }
  }
  return index;
}

/** Canonical name for an exact (normalised) brand or alias, else null */
export function knownBrand(text: string): string | null {
  return brandIndex().get(brandKey(text)) ?? null;
}

// Damerau–Levenshtein distance (with adjacent transpositions), capped
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Closest directory brand to a word with a typo, or null (short words: none) */
export function fuzzyBrand(text: string): string | null {
  const key = brandKey(text);
  if (key.length < 5 || /^\d+$/.test(key)) return null;
  const cap = key.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = cap + 1;
  for (const [k, name] of brandIndex()) {
    if (k.length < 4) continue;
    const dd = distance(key, k, cap);
    if (dd < bestD) { bestD = dd; best = name; }
  }
  return bestD <= cap ? best : null;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}.'&-]*/gu;

// Finds the first brand in free text: 3-, 2- and 1-word phrases are tried
// exactly first, then single words with a typo. Positions refer to `text`.
export function findBrand(text: string): BrandMatch | null {
  const words = [...String(text ?? '').matchAll(WORD)].map((m) => ({ w: m[0], start: m.index!, end: m.index! + m[0].length }));
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const span = words.slice(i, i + n);
      const original = text.slice(span[0].start, span[n - 1].end);
      const brand = knownBrand(original);
      if (brand) return { brand, original, start: span[0].start, end: span[n - 1].end, exact: true };
    }
  }
  for (const { w, start, end } of words) {
    if (!/\p{L}/u.test(w)) continue;
    const brand = fuzzyBrand(w);
    if (brand) return { brand, original: w, start, end, exact: false };
  }
  return null;
}
