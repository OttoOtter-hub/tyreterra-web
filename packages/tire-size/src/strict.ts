export type TireSizeFormat = 'metric' | 'flotation' | 'diagonal_inch' | 'radial_inch' | 'slash_diagonal';

export interface ParsedTireSize {
  format: TireSizeFormat;
  size_width: number;
  size_aspect_ratio: number | null;
  size_construction: 'R' | '-';
  size_rim: number;
  size_raw: string;
}

export class TireSizeParseError extends Error {
  constructor(input: string) {
    super(
      `Unrecognised tire size: "${input}". ` +
        'Supported formats:\n' +
        '  Metric radial:      315/80R22.5\n' +
        '  Flotation/wide:     710/70R42\n' +
        '  Diagonal inch:      10.00-20\n' +
        '  Radial inch:        14.9R28  or  23.5R25\n' +
        '  Slash diagonal:     12.5/80-18\n' +
        '  L-series diagonal:  19.5L-24',
    );
    this.name = 'TireSizeParseError';
  }
}

// Strip all whitespace and uppercase so "315/80 R 22.5" → "315/80R22.5"
function normalise(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

// WIDTH/ASPECT_RATIO R RIM  — metric and flotation (R construction)
const SLASH_RADIAL = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)R(\d+(?:\.\d+)?)$/;

// WIDTH/ASPECT_RATIO - RIM  — diagonal with aspect ratio, e.g. 12.5/80-18
const SLASH_DIAGONAL = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/;

// WIDTH - RIM  — diagonal inch, no aspect ratio, e.g. 10.00-20
const DIAGONAL = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/;

// WIDTHL - RIM  — L-series diagonal (agri/industrial), e.g. 19.5L-24
const L_DIAGONAL = /^(\d+(?:\.\d+)?)L-(\d+(?:\.\d+)?)$/;

// WIDTH R RIM  — radial inch / large OTR, no slash, no aspect ratio
const RADIAL_INCH = /^(\d+(?:\.\d+)?)R(\d+(?:\.\d+)?)$/;

export function parseTireSize(raw: string): ParsedTireSize {
  if (!raw || !raw.trim()) {
    throw new TireSizeParseError(raw ?? '');
  }

  const norm = normalise(raw);
  const size_raw = norm;

  let m: RegExpMatchArray | null;

  // 315/80R22.5 or 710/70R42
  m = norm.match(SLASH_RADIAL);
  if (m) {
    const width = parseFloat(m[1]);
    const aspect = parseFloat(m[2]);
    const rim = parseFloat(m[3]);
    return {
      format: width >= 500 ? 'flotation' : 'metric',
      size_width: width,
      size_aspect_ratio: aspect,
      size_construction: 'R',
      size_rim: rim,
      size_raw,
    };
  }

  // 12.5/80-18
  m = norm.match(SLASH_DIAGONAL);
  if (m) {
    return {
      format: 'slash_diagonal',
      size_width: parseFloat(m[1]),
      size_aspect_ratio: parseFloat(m[2]),
      size_construction: '-',
      size_rim: parseFloat(m[3]),
      size_raw,
    };
  }

  // 19.5L-24  (L stripped from width for numeric indexing)
  m = norm.match(L_DIAGONAL);
  if (m) {
    return {
      format: 'diagonal_inch',
      size_width: parseFloat(m[1]),
      size_aspect_ratio: null,
      size_construction: '-',
      size_rim: parseFloat(m[2]),
      size_raw,
    };
  }

  // 10.00-20
  m = norm.match(DIAGONAL);
  if (m) {
    return {
      format: 'diagonal_inch',
      size_width: parseFloat(m[1]),
      size_aspect_ratio: null,
      size_construction: '-',
      size_rim: parseFloat(m[2]),
      size_raw,
    };
  }

  // 14.9R28 or 23.5R25
  m = norm.match(RADIAL_INCH);
  if (m) {
    return {
      format: 'radial_inch',
      size_width: parseFloat(m[1]),
      size_aspect_ratio: null,
      size_construction: 'R',
      size_rim: parseFloat(m[2]),
      size_raw,
    };
  }

  throw new TireSizeParseError(raw);
}
