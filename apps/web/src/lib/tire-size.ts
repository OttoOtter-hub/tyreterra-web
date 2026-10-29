// Tire size parsing lives in the shared @tyreterra/tire-size package, used by
// the API too — one source of truth, no copy here.
export {
  parseTireSize,
  parsePartialSize,
  normaliseSizeQuery,
  FORMAT_LABELS,
  parseLoadIndex,
  formatLoadIndex,
} from '@tyreterra/tire-size';
export type {
  ParsedTireSize,
  TireSizeFormat,
  PartialSize,
  SizeCandidate,
  PartialFormat,
  ParsedLoadIndex,
} from '@tyreterra/tire-size';
