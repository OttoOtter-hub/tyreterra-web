import { createHash } from 'crypto';
import {
  Segment,
  countryCode,
  findBrand,
  knownBrand,
  parseCondition,
  parseGluedCell,
  parseLoadIndex,
  parsePrice,
  parseQty,
  parseTireType,
  parseYear,
  resolveSize,
} from '@tyreterra/tire-size';

// What a column of an uploaded price list holds, guessed from its header
// (synonyms in EN/RU/DE/PL/FR/IT) and from its values; both are combined
// into one confidence.

export const FIELD_TYPES = [
  'size', 'brand', 'pattern', 'qty', 'dot_year', 'condition', 'country', 'region', 'price',
  'currency', 'sku', 'load_index', 'origin_country', 'tire_type', 'comment', 'ignore',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Types a file may map to more than one column (sizes: main + alternative; comments are joined) */
export const MULTI_COLUMN_TYPES: FieldType[] = ['size', 'comment', 'ignore'];

const HEADERS: Record<Exclude<FieldType, 'ignore'>, string[]> = {
  size: [
    'size', 'tyre size', 'tire size', 'dimension', 'dimensions', 'alt size', 'alternative size', 'second size',
    'размер', 'типоразмер', 'размерность', 'доп размер', 'abmessung', 'abmessungen', 'größe', 'grosse', 'reifengröße', 'dimension',
    'rozmiar', 'wymiar', 'dimensione', 'misura', 'taille',
  ],
  brand: [
    'brand', 'make', 'manufacturer', 'марка', 'бренд', 'производитель', 'hersteller', 'marke', 'marka', 'producent',
    'marca', 'marque', 'fabricant', 'produttore',
  ],
  pattern: [
    'pattern', 'tread', 'tread pattern', 'model', 'рисунок', 'модель', 'протектор', 'рисунок протектора', 'profil',
    'profilbezeichnung', 'bieżnik', 'wzór', 'wzor', 'battistrada', 'disegno', 'modello', 'sculpture', 'modèle',
  ],
  qty: [
    'qty', 'quantity', 'pcs', 'pieces', 'stock', 'count', 'количество', 'кол-во', 'кол во', 'шт', 'остаток', 'наличие',
    'menge', 'anzahl', 'bestand', 'stück', 'ilość', 'ilosc', 'szt', 'sztuk', 'stan magazynowy', 'quantità', 'quantita',
    'qtà', 'pezzi', 'quantité', 'quantite',
  ],
  dot_year: [
    'dot', 'year', 'dot year', 'production year', 'prod year', 'manufacture year', 'год', 'год выпуска',
    'дата производства', 'год производства', 'baujahr', 'jahr', 'produktionsjahr', 'rok', 'rok produkcji', 'anno',
    'anno di produzione', 'année', 'annee',
  ],
  condition: [
    'condition', 'state', 'new used', 'состояние', 'новая бу', 'zustand', 'stan techniczny', 'kondycja', 'condizione',
    'stato', 'état', 'etat',
  ],
  country: [
    'country', 'location', 'location country', 'warehouse', 'stock location', 'страна', 'местонахождение', 'склад',
    'страна склада', 'land', 'standort', 'lager', 'kraj', 'lokalizacja', 'magazyn', 'paese', 'pays', 'magasin',
  ],
  region: [
    'region', 'city', 'area', 'регион', 'город', 'область', 'stadt', 'ort', 'bundesland', 'województwo', 'wojewodztwo',
    'miasto', 'regione', 'città', 'citta', 'ville',
  ],
  price: [
    'price', 'unit price', 'net price', 'price eur', 'price usd', 'цена', 'стоимость', 'цена за шт', 'preis',
    'einzelpreis', 'nettopreis', 'cena', 'cena netto', 'prezzo', 'prix',
  ],
  currency: ['currency', 'cur', 'ccy', 'валюта', 'währung', 'wahrung', 'waluta', 'valuta', 'devise', 'monnaie'],
  sku: [
    'sku', 'article', 'art', 'art no', 'article number', 'item', 'item code', 'code', 'part number', 'ean', 'артикул',
    'код', 'код товара', 'artikel', 'artikelnummer', 'artnr', 'indeks', 'kod', 'kod produktu', 'codice', 'référence',
    'reference', 'ref',
  ],
  load_index: [
    'load index', 'li', 'li si', 'load speed', 'load speed index', 'ply', 'pr', 'ply rating', 'индекс нагрузки',
    'индекс', 'ин', 'ин ис', 'нагрузка', 'слойность', 'нс', 'lastindex', 'tragfähigkeit', 'tragfahigkeit',
    'indeks nośności', 'indeks nosnosci', 'nośność', 'indice di carico', 'indice de charge',
  ],
  origin_country: [
    'origin', 'country of origin', 'made in', 'origin country', 'производство', 'страна производства',
    'страна происхождения', 'страна производитель', 'herkunft', 'herkunftsland', 'kraj pochodzenia', 'produkcja',
    'origine', 'paese di origine', "pays d'origine", 'kraj produkcji', 'country of manufacture', 'manufactured in',
    'produced in', 'страна изготовления', 'страна-производитель', 'produktionsland', 'hergestellt in', 'pays de fabrication',
    'paese di produzione',
  ],
  tire_type: [
    'type', 'tyre type', 'tire type', 'axle', 'position', 'season', 'тип', 'применение', 'ось', 'сезон', 'сезонность',
    'achse', 'typ', 'saison', 'oś', 'os', 'sezon', 'tipo', 'asse', 'stagione',
  ],
  comment: [
    'comment', 'comments', 'note', 'notes', 'remark', 'remarks', 'примечание', 'комментарий', 'bemerkung', 'anmerkung',
    'kommentar', 'uwagi', 'uwaga', 'commento', 'remarque',
  ],
};

// Headers of a free-text description column: the content decides whether it
// is a glued size cell or just a comment
const DESCRIPTION_HEADERS = [
  'description', 'name', 'product', 'product name', 'item name', 'goods', 'описание', 'наименование', 'название',
  'товар', 'номенклатура', 'bezeichnung', 'beschreibung', 'artikelbezeichnung', 'nazwa', 'opis', 'descrizione',
  'désignation', 'designation', 'libellé',
];

/** Lower-case, accents removed, punctuation → spaces */
export function normaliseHeader(h: string): string {
  return String(h ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const HEADER_INDEX: { type: Exclude<FieldType, 'ignore'>; key: string }[] = Object.entries(HEADERS).flatMap(
  ([type, words]) => words.map((w) => ({ type: type as Exclude<FieldType, 'ignore'>, key: normaliseHeader(w) })),
);
const DESCRIPTION_KEYS = DESCRIPTION_HEADERS.map(normaliseHeader);

/** Header score per type: 1 exact synonym, 0.8 synonym as a whole word inside it */
export function headerScores(header: string): Partial<Record<FieldType, number>> {
  const h = normaliseHeader(header);
  const out: Partial<Record<FieldType, number>> = {};
  if (!h) return out;
  for (const { type, key } of HEADER_INDEX) {
    let s = 0;
    if (h === key) s = 1;
    else if (key.length >= 3 && ` ${h} `.includes(` ${key} `)) s = 0.8;
    if (s > (out[type] ?? 0)) out[type] = s;
  }
  // "Price, EUR" also names the currency of the column; the price wins
  if (out.price && out.currency) delete out.currency;
  // "Country of origin" contains "country"
  if (out.origin_country && out.country && out.origin_country >= out.country) delete out.country;
  return out;
}

function isDescriptionHeader(header: string): boolean {
  const h = normaliseHeader(header);
  return DESCRIPTION_KEYS.some((k) => h === k || ` ${h} `.includes(` ${k} `));
}

export interface ColumnGuess {
  index: number;
  header: string;
  type: FieldType;
  confidence: number;
  samples: string[];
  /** Cells hold more than a size (brand, qty, load index…) that will be read out of them */
  glued: boolean;
  alternatives: { type: FieldType; confidence: number }[];
}

// Share of sample values each type's reader accepts
function contentScores(values: string[], segment?: Segment): { scores: Partial<Record<FieldType, number>>; glued: boolean } {
  const n = values.length;
  if (!n) return { scores: {}, glued: false };
  const share = (f: (v: string) => boolean) => values.filter(f).length / n;
  let gluedHits = 0;
  let sizeHits = 0;
  for (const v of values) {
    const g = parseGluedCell(v, segment);
    if (!g.sizes.length && !g.unreadSizes.length) continue;
    sizeHits++;
    if (g.brand || g.qty !== null || g.loadText || g.pattern || g.unrecognized) gluedHits++;
  }
  const unique = new Set(values).size / n;
  const scores: Partial<Record<FieldType, number>> = {
    size: sizeHits / n,
    brand: share((v) => !!knownBrand(v) || findBrand(v)?.start === 0),
    qty: share((v) => {
      const q = parseQty(v);
      return q !== null && q <= 100_000 && !/^(19|20)\d{2}$/.test(v.trim());
    }),
    dot_year: share((v) => /^(?:dot\s*)?\d{2,4}(?:[.,]0+)?$/i.test(v.trim()) && parseYear(v) !== null),
    condition: share((v) => parseCondition(v) !== null),
    country: share((v) => countryCode(v) !== null),
    origin_country: share((v) => countryCode(v) !== null) * 0.8,
    currency: share((v) => /^(EUR|USD|PLN|GBP|RUB|CHF|CZK|UAH|TRY|€|\$|£|zł|руб\.?)$/i.test(v.trim())),
    price: share((v) => {
      const p = parsePrice(v);
      return p !== null && (p.currency !== null || /[.,]\d{1,2}$/.test(v.trim()) || +v > 20);
    }) * 0.9,
    load_index: share((v) => parseLoadIndex(v).complete),
    tire_type: segment ? share((v) => parseTireType(v, segment) !== null) : 0,
    sku: share((v) => /^[A-Z0-9][A-Z0-9\-_./]{3,}$/i.test(v.trim()) && /\d/.test(v) && !resolveSize(v)) * (unique > 0.8 ? 1 : 0.4),
  };
  return { scores, glued: sizeHits > 0 && gluedHits / sizeHits >= 0.3 };
}

// Types whose content we cannot recognise; a header match alone counts more
const HEADER_ONLY: FieldType[] = ['region', 'pattern', 'comment', 'sku'];

export function guessColumns(header: string[], data: string[][], segment?: Segment): ColumnGuess[] {
  const width = Math.max(header.length, ...data.slice(0, 200).map((r) => r.length), 0);
  const raw: { index: number; header: string; samples: string[]; conf: Partial<Record<FieldType, number>>; glued: boolean }[] = [];

  for (let c = 0; c < width; c++) {
    const values = data.map((r) => (r[c] ?? '').trim()).filter(Boolean).slice(0, 100);
    const h = headerScores(header[c] ?? '');
    const { scores, glued } = contentScores(values, segment);
    const conf: Partial<Record<FieldType, number>> = {};
    for (const t of FIELD_TYPES) {
      if (t === 'ignore') continue;
      const hs = h[t] ?? 0;
      const cs = scores[t] ?? 0;
      conf[t] = hs > 0
        ? Math.min(1, 0.45 * hs + 0.55 * (HEADER_ONLY.includes(t) ? Math.max(cs, 0.6) : cs) + (hs === 1 ? 0.1 : 0))
        : 0.8 * cs;
    }
    // A description column with sizes inside is a glued size column
    if (isDescriptionHeader(header[c] ?? '')) {
      conf.size = Math.max(conf.size ?? 0, (scores.size ?? 0) * 0.95);
      conf.comment = Math.max(conf.comment ?? 0, (scores.size ?? 0) < 0.3 ? 0.6 : 0.2);
    }
    if (!values.length) for (const t of Object.keys(conf) as FieldType[]) conf[t] = Math.min(conf[t] ?? 0, 0.3);
    raw.push({ index: c, header: header[c] ?? '', samples: [...new Set(values)].slice(0, 5), conf, glued });
  }

  // Greedy: the most confident (column, type) pairs first; one column per
  // type except sizes (main + alternative) and comments
  const pairs = raw.flatMap((col) =>
    (Object.entries(col.conf) as [FieldType, number][]).map(([type, c]) => ({ col: col.index, type, c })),
  ).sort((a, b) => b.c - a.c);
  const chosen = new Map<number, { type: FieldType; c: number }>();
  const used = new Map<FieldType, number>();
  for (const p of pairs) {
    if (p.c < 0.35 || chosen.has(p.col)) continue;
    const count = used.get(p.type) ?? 0;
    if (count >= (p.type === 'size' ? 2 : MULTI_COLUMN_TYPES.includes(p.type) ? 99 : 1)) continue;
    // a second size column needs good evidence of its own
    if (p.type === 'size' && count === 1 && p.c < 0.6) continue;
    chosen.set(p.col, { type: p.type, c: p.c });
    used.set(p.type, count + 1);
  }

  return raw.map((col) => {
    const pick = chosen.get(col.index);
    const ranked = (Object.entries(col.conf) as [FieldType, number][])
      .filter(([, c]) => c >= 0.2)
      .sort((a, b) => b[1] - a[1]);
    const type: FieldType = pick?.type ?? 'ignore';
    const confidence = pick ? round(pick.c) : round(1 - (ranked[0]?.[1] ?? 0));
    return {
      index: col.index,
      header: col.header,
      type,
      confidence,
      samples: col.samples,
      glued: type === 'size' && col.glued,
      alternatives: ranked.filter(([t]) => t !== type).slice(0, 3).map(([t, c]) => ({ type: t, confidence: round(c) })),
    };
  });
}

const round = (x: number) => Math.round(x * 100) / 100;

/**
 * 1-based header row: the row among the first 30 that names the most known
 * columns. Without one, the row above the first row with a size, if it looks
 * like text labels; 0 means "no header row".
 */
export function guessHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = 1;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const score = rows[r].filter((c) => Object.values(headerScores(c)).some((s) => (s ?? 0) >= 0.8) || isDescriptionHeader(c)).length;
    if (score > bestScore) { bestScore = score; best = r + 1; }
  }
  if (best) return best;
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    if (rows[r].some((c) => parseGluedCell(c).sizes.length > 0)) {
      const above = r > 0 ? rows[r - 1] : null;
      const labels = above?.filter((c) => c.trim() && !/\d/.test(c)).length ?? 0;
      return above && labels >= 2 ? r : 0;
    }
  }
  return 0;
}

/** The sheet with the most size cells among its first rows */
export function guessSheet(sheets: { name: string; rows: string[][] }[]): string {
  let best = sheets[0].name;
  let bestHits = -1;
  for (const s of sheets) {
    let hits = 0;
    for (const row of s.rows.slice(0, 200)) for (const c of row) if (c && resolveSize(c)) hits++;
    if (hits > bestHits) { bestHits = hits; best = s.name; }
  }
  return best;
}

/** Identifies a header layout, to find the company's saved mapping for it */
export function headerSignature(header: string[]): string {
  return createHash('sha256').update(JSON.stringify(header.map(normaliseHeader))).digest('hex');
}
