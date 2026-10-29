import {
  GluedCell,
  OTHER_BRAND,
  ResolvedSize,
  Segment,
  countryCode,
  findBrand,
  parseCondition,
  parseGluedCell,
  parseLoadIndex,
  parsePrice,
  parseQty,
  parseTireType,
  parseYear,
} from '@tyreterra/tire-size';
import { FieldType } from './columns';
import { MAX_ADDITIONAL_SIZES } from '../listing-sizes';

// Turns the rows of a sheet into listings in our model, using the column
// mapping, the glued-cell reader and the defaults. A field's own column wins
// over what is read out of a glued cell, which wins over the default.

/** Listing fields an import row may carry (everything else is rejected) */
export const IMPORT_FIELDS = [
  'brand', 'size', 'additional_sizes', 'pattern', 'qty', 'dot_code', 'condition', 'location_country',
  'location_region', 'price', 'currency', 'sku', 'load_index', 'origin_country', 'tire_type', 'comment',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export interface ImportRowData {
  brand?: string;
  size?: string;
  additional_sizes?: string[];
  pattern?: string;
  qty?: number;
  dot_code?: string;
  condition?: string;
  location_country?: string;
  location_region?: string;
  price?: number;
  currency?: string;
  sku?: string;
  load_index?: string;
  origin_country?: string;
  tire_type?: string;
  comment?: string;
}

export interface RowMessage {
  level: 'warning' | 'error';
  field?: string;
  text: string;
}

/** Another reading the user can pick in the preview */
export interface RowAlternative {
  field: 'size' | 'price';
  value: string;
  label: string;
}

export interface BuiltRow {
  /** Row number in the sheet (1-based) */
  row: number;
  data: ImportRowData;
  messages: RowMessage[];
  /** Text nobody understood; the user sends it to pattern, comment or ignores it */
  unrecognized: string | null;
  alternatives: RowAlternative[];
}

export interface ImportDefaults {
  condition?: string;
  location_country?: string;
  location_region?: string;
  tire_type?: string;
}

export interface BuildOptions {
  segment: Segment;
  /** column index → field type */
  mapping: Record<number, FieldType>;
  /** 1-based header row, 0 = none */
  headerRow: number;
  defaults: ImportDefaults;
}

export function buildRows(sheetRows: string[][], opts: BuildOptions): { rows: BuiltRow[]; skippedEmpty: number } {
  const columnsOf = (t: FieldType) =>
    Object.entries(opts.mapping).filter(([, type]) => type === t).map(([i]) => +i).sort((a, b) => a - b);
  const mapped = Object.entries(opts.mapping).filter(([, t]) => t !== 'ignore').map(([i]) => +i);

  const out: BuiltRow[] = [];
  let skippedEmpty = 0;
  for (let r = opts.headerRow; r < sheetRows.length; r++) {
    const cells = sheetRows[r];
    if (mapped.every((c) => !(cells[c] ?? '').trim())) { skippedEmpty++; continue; }
    out.push(buildRow(r + 1, cells, columnsOf, opts));
  }
  return { rows: out, skippedEmpty };
}

function buildRow(
  rowNumber: number,
  cells: string[],
  columnsOf: (t: FieldType) => number[],
  opts: BuildOptions,
): BuiltRow {
  const { segment, defaults } = opts;
  const messages: RowMessage[] = [];
  const alternatives: RowAlternative[] = [];
  const unrecognized: string[] = [];
  const d: ImportRowData = {};
  const warn = (text: string, field?: string) => messages.push({ level: 'warning', field, text });
  const fail = (text: string, field?: string) => messages.push({ level: 'error', field, text });
  const first = (t: FieldType) => {
    for (const c of columnsOf(t)) {
      const v = (cells[c] ?? '').trim();
      if (v) return v;
    }
    return '';
  };

  // Sizes (and everything glued into the size cells)
  const sizes: ResolvedSize[] = [];
  const glued: GluedCell[] = [];
  for (const c of columnsOf('size')) {
    const v = (cells[c] ?? '').trim();
    if (!v) continue;
    const g = parseGluedCell(v, segment);
    glued.push(g);
    for (const s of g.sizes) if (!sizes.some((x) => x.size.size_raw === s.size.size_raw)) sizes.push(s);
    for (const w of g.warnings) warn(w);
    if (g.unrecognized) unrecognized.push(g.unrecognized);
  }
  const fromCell = <K extends keyof GluedCell>(k: K): GluedCell[K] | null => {
    for (const g of glued) {
      const v = g[k];
      if (v !== null && v !== undefined && !(typeof v === 'string' && !v)) return v;
    }
    return null;
  };

  if (!sizes.length) {
    fail(glued.some((g) => g.unreadSizes.length) ? 'No size we can store was found' : 'No tyre size found', 'size');
  } else {
    d.size = sizes[0].size.size_raw;
    const extra = sizes.slice(1, 1 + MAX_ADDITIONAL_SIZES).map((s) => s.size.size_raw);
    if (extra.length) d.additional_sizes = extra;
    if (sizes.length > 1 + MAX_ADDITIONAL_SIZES) {
      warn(`Only ${1 + MAX_ADDITIONAL_SIZES} sizes per listing; left out ${sizes.slice(1 + MAX_ADDITIONAL_SIZES).map((s) => s.size.size_raw).join(', ')}`, 'size');
    }
    for (const alt of sizes[0].alternatives) alternatives.push({ field: 'size', value: alt, label: alt });
  }

  // Brand, and the pattern written after it in the brand cell
  const brandCell = first('brand');
  let patternFromBrandCell: string | null = null;
  if (brandCell) {
    const m = findBrand(brandCell);
    if (m) {
      d.brand = m.brand;
      if (!m.exact) warn(`Brand "${m.original}" read as ${m.brand}`, 'brand');
      const rest = (brandCell.slice(0, m.start) + ' ' + brandCell.slice(m.end)).replace(/\s+/g, ' ').trim();
      if (rest) patternFromBrandCell = rest;
    } else {
      d.brand = OTHER_BRAND;
      warn(`Unknown brand "${brandCell}" — set to ${OTHER_BRAND}. Pick a brand, or keep ${OTHER_BRAND} and move the name to pattern or comment`, 'brand');
      unrecognized.unshift(brandCell);
    }
  } else {
    const b = fromCell('brand');
    if (b) d.brand = b.brand;
    else {
      d.brand = OTHER_BRAND;
      warn(`No known brand found — set to ${OTHER_BRAND}`, 'brand');
    }
  }

  // Pattern
  const patternCell = first('pattern');
  if (patternCell) {
    d.pattern = patternCell;
    if (patternFromBrandCell) unrecognized.push(patternFromBrandCell);
  } else {
    const p = patternFromBrandCell ?? fromCell('pattern');
    if (p) d.pattern = p;
  }

  // Quantity
  const qtyCell = first('qty');
  const cellQty = fromCell('qty');
  if (qtyCell) {
    const q = parseQty(qtyCell);
    if (q === null) fail(`Quantity "${qtyCell}" is not a whole number`, 'qty');
    else {
      d.qty = q;
      if (cellQty !== null && cellQty !== q) warn(`Quantity column says ${q}, the description says ${cellQty}; kept ${q}`, 'qty');
    }
  } else if (cellQty !== null) d.qty = cellQty;
  else fail('Quantity missing', 'qty');

  // Production year
  const yearCell = first('dot_year');
  if (yearCell) {
    const y = parseYear(yearCell);
    if (y) d.dot_code = y;
    else warn(`Could not read the year "${yearCell}"`, 'dot_code');
  } else {
    const y = fromCell('year');
    if (y) d.dot_code = y;
  }

  // Condition
  const condCell = first('condition');
  const cond = condCell ? parseCondition(condCell) : null;
  if (condCell && !cond) warn(`Unknown condition "${condCell}"${defaults.condition ? `; used the default (${defaults.condition})` : ''}`, 'condition');
  d.condition = cond ?? fromCell('condition') ?? defaults.condition;
  if (!d.condition) fail('Condition missing (new / used / retreaded)', 'condition');

  // Stock location
  const countryCell = first('country');
  const code = countryCell ? countryCode(countryCell) : null;
  if (countryCell && !code) warn(`Unknown country "${countryCell}"${defaults.location_country ? `; used the default (${defaults.location_country})` : ''}`, 'location_country');
  d.location_country = code ?? defaults.location_country?.toUpperCase();
  if (!d.location_country) fail('Location country missing', 'location_country');
  const region = first('region') || defaults.location_region;
  if (region) d.location_region = region;

  // Price and currency
  const priceCell = first('price');
  if (priceCell) {
    const p = parsePrice(priceCell);
    if (!p) warn(`Could not read the price "${priceCell}"; left empty`, 'price');
    else {
      d.price = p.amount;
      if (p.currency) d.currency = p.currency;
      if (p.ambiguous !== undefined) {
        warn(`Price "${priceCell}" read as ${p.amount}; it could also be ${p.ambiguous}`, 'price');
        alternatives.push({ field: 'price', value: String(p.ambiguous), label: String(p.ambiguous) });
      }
    }
  }
  const currencyCell = first('currency');
  if (currencyCell) {
    const c = parsePrice(`1 ${currencyCell}`)?.currency ?? (/^[A-Za-z]{3}$/.test(currencyCell) ? currencyCell.toUpperCase() : null);
    if (c) d.currency = c;
    else warn(`Unknown currency "${currencyCell}"`, 'currency');
  }
  if (d.price === undefined) delete d.currency;

  // Seller's article number
  const sku = first('sku');
  if (sku) d.sku = sku;

  // Load index / ply: kept as written, parsed when stored
  const liCell = first('load_index');
  if (liCell) {
    d.load_index = liCell;
    for (const w of parseLoadIndex(liCell).warnings) warn(w, 'load_index');
  } else {
    const t = fromCell('loadText');
    if (t) d.load_index = t;
  }

  // Country of manufacture: an ISO code like the form's country picker stores;
  // text that is no known country is kept as written
  const originCell = first('origin_country');
  if (originCell) d.origin_country = countryCode(originCell) ?? originCell;
  else {
    const oc = fromCell('origin_country');
    if (oc) d.origin_country = oc;
  }

  // Tyre type of the segment
  const typeCell = first('tire_type');
  const type = typeCell ? parseTireType(typeCell, segment) : null;
  if (typeCell && !type) warn(`Unknown type "${typeCell}" for ${segment}`, 'tire_type');
  const tireType = type ?? fromCell('tire_type') ?? defaults.tire_type;
  if (tireType) d.tire_type = tireType;

  // Comments: every comment column, joined
  const comments = columnsOf('comment').map((c) => (cells[c] ?? '').trim()).filter(Boolean);
  if (comments.length) d.comment = comments.join(' | ');

  return {
    row: rowNumber,
    data: d,
    messages,
    unrecognized: unrecognized.length ? unrecognized.join(' … ') : null,
    alternatives,
  };
}
