// Tire size parsing lives in the shared @tyreterra/tire-size package, used by
// the API too — one source of truth, no copy here.
export {
  parseTireSize,
  parsePartialSize,
  normaliseSizeQuery,
  FORMAT_LABELS,
  TIRE_TYPES,
  SEGMENTS,
  parseLoadIndex,
  formatLoadIndex,
} from '@tyreterra/tire-size';
export type {
  ParsedTireSize,
  TireSizeFormat,
  PartialSize,
  SizeCandidate,
  PartialFormat,
  Segment,
  ParsedLoadIndex,
} from '@tyreterra/tire-size';
