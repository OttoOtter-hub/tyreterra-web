import { ParsedTireSize } from './strict';

// The strict parser checks the spelling, not the numbers: "999/99R99" reads
// fine. These bounds reject what no tyre can be and keep every size sold,
// from wheelbarrow tyres to the largest mining tyres. They are deliberately
// loose: a wrong size the seller can see is better than a real one refused.
export const SIZE_BOUNDS = {
  // Rim diameter, inches. Smallest: 4" (3.00-4, 4.00-4 wheelbarrow / MH).
  // Largest: 63" (59/80R63, 55/80R63, 53/80R63 ultra-class mining tyres;
  // 57" for 46/90R57, 40.00R57, 80/80R57; 51" for 36.00R51)
  rim: { min: 4, max: 63 },
  // Section width, as written: inches (2.50-4 … 59/80R63, 40.00R57) or mm
  // (70/90-17 motorcycle … 1600 for the widest flotation tyres). The two
  // overlap (80/80R57, 80/90-21), so it is one range.
  width: { min: 2, max: 1600 },
  // Inch widths written without the dot: "1800R25" = 18.00R25,
  // "1400R25" = 14.00R25; read as hundredths of an inch
  inchWidthHundredths: { min: 200, max: 6000 },
  // Profile (aspect ratio), %. Lowest series on sale: 20 (car 20-series);
  // highest: 110 (high-flotation / some MH and old AGRI series)
  aspect: { min: 20, max: 110 },
} as const;

const INCH_FORMATS: ReadonlySet<string> = new Set(['radial_inch', 'diagonal_inch']);

const within = (v: number, r: { min: number; max: number }) => v >= r.min && v <= r.max;

/** Why a parsed size cannot be a real tyre, or null */
export function implausibleSize(p: ParsedTireSize): string | null {
  const rim = Number(p.size_rim);
  const width = Number(p.size_width);
  const aspect = p.size_aspect_ratio === null ? null : Number(p.size_aspect_ratio);
  if (!within(rim, SIZE_BOUNDS.rim)) return `${p.size_raw}: rim ${rim}" is not a tyre rim size`;
  const widthOk = within(width, SIZE_BOUNDS.width)
    || (INCH_FORMATS.has(p.format) && within(width, SIZE_BOUNDS.inchWidthHundredths));
  if (!widthOk) return `${p.size_raw}: width ${width} is out of range`;
  if (aspect !== null && !within(aspect, SIZE_BOUNDS.aspect)) return `${p.size_raw}: profile ${aspect} is out of range`;
  return null;
}
