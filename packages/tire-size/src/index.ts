export { parseTireSize, TireSizeParseError } from './strict';
export type { ParsedTireSize, TireSizeFormat } from './strict';
export { implausibleSize } from './plausible';
export { parsePartialSize, normaliseSizeQuery } from './partial';
export type { PartialSize, SizeCandidate, PartialFormat, Construction } from './partial';
export { parseLoadIndex, findLoadIndexes, mergeLoadIndexes, formatLoadIndex } from './load-index';
export type { ParsedLoadIndex, LoadIndexResult, LoadIndexMatch } from './load-index';

export const FORMAT_LABELS: Record<import('./partial').PartialFormat, string> = {
  metric: 'Metric radial',
  flotation: 'Flotation / Wide',
  diagonal_inch: 'Diagonal inch',
  radial_inch: 'Radial inch',
  slash_diagonal: 'Slash diagonal',
  inch: 'Inch (radial or diagonal)',
  partial: 'Incomplete',
};
