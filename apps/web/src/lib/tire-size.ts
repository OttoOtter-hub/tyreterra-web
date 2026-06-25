export type TireSizeFormat = 'metric' | 'flotation' | 'diagonal_inch' | 'radial_inch';

export interface ParsedTireSize {
  format: TireSizeFormat;
  size_width: number;
  size_aspect_ratio: number | null;
  size_construction: 'R' | '-';
  size_rim: number;
  size_raw: string;
}

const SLASH_RADIAL = /^(\d+)\/(\d+)R(\d+(?:\.\d+)?)$/;
const DIAGONAL = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/;
const RADIAL_INCH = /^(\d+(?:\.\d+)?)R(\d+(?:\.\d+)?)$/;

function normalise(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

export function parseTireSize(raw: string): ParsedTireSize {
  if (!raw?.trim()) throw new Error('Size is required');
  const norm = normalise(raw);

  let m = norm.match(SLASH_RADIAL);
  if (m) {
    const width = parseFloat(m[1]);
    return {
      format: width >= 500 ? 'flotation' : 'metric',
      size_width: width,
      size_aspect_ratio: parseFloat(m[2]),
      size_construction: 'R',
      size_rim: parseFloat(m[3]),
      size_raw: norm,
    };
  }

  m = norm.match(DIAGONAL);
  if (m) {
    return {
      format: 'diagonal_inch',
      size_width: parseFloat(m[1]),
      size_aspect_ratio: null,
      size_construction: '-',
      size_rim: parseFloat(m[2]),
      size_raw: norm,
    };
  }

  m = norm.match(RADIAL_INCH);
  if (m) {
    return {
      format: 'radial_inch',
      size_width: parseFloat(m[1]),
      size_aspect_ratio: null,
      size_construction: 'R',
      size_rim: parseFloat(m[2]),
      size_raw: norm,
    };
  }

  throw new Error(
    `Unrecognised format: "${raw}". Examples: 315/80R22.5 · 710/70R42 · 10.00-20 · 14.9R28`,
  );
}

export const FORMAT_LABELS: Record<TireSizeFormat, string> = {
  metric: 'Metric radial',
  flotation: 'Flotation / Wide',
  diagonal_inch: 'Diagonal inch',
  radial_inch: 'Radial inch',
};
