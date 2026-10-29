export { parseTireSize, TireSizeParseError } from './strict';
export type { ParsedTireSize, TireSizeFormat } from './strict';
export { implausibleSize } from './plausible';
export { parsePartialSize, normaliseSizeQuery } from './partial';
export type { PartialSize, SizeCandidate, PartialFormat, Construction } from './partial';
export { parseLoadIndex, findLoadIndexes, mergeLoadIndexes, formatLoadIndex } from './load-index';
export type { ParsedLoadIndex, LoadIndexResult, LoadIndexMatch } from './load-index';
export { BRANDS, OTHER_BRAND, findBrand, knownBrand, fuzzyBrand, brandKey } from './brands';
export type { BrandMatch } from './brands';
export { COUNTRIES, countryByCode, codeByName, countryCode, COUNTRY_NAMES } from './countries';
export {
  SEGMENTS,
  TIRE_TYPES,
  resolveSize,
  sizeSegmentWarning,
  parseQty,
  parseYear,
  parseCondition,
  parsePrice,
  parseTireType,
  parseGluedCell,
} from './cell';
export type { Segment, Condition, ResolvedSize, ParsedPrice, GluedCell } from './cell';

export const FORMAT_LABELS: Record<import('./partial').PartialFormat, string> = {
  metric: 'Metric radial',
  flotation: 'Flotation / Wide',
  diagonal_inch: 'Diagonal inch',
  radial_inch: 'Radial inch',
  slash_diagonal: 'Slash diagonal',
  inch: 'Inch (radial or diagonal)',
  partial: 'Incomplete',
};
