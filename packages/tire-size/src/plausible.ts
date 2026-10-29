import { ParsedTireSize } from './strict';

// The strict parser checks the spelling, not the numbers: "999/99R99" reads
// fine. These bounds reject what no tyre can be and keep every size sold,
// from wheelbarrow tyres to the largest mining tyres. They are deliberately
// loose: a wrong size the seller can see is better than a real one refused.
// Dot-less inch widths ("1800R25") are already inches here: the parser
// stores them as 18.00 (see dotlessInchWidth).
export const SIZE_BOUNDS = {
  // Rim diameter, inches. Smallest: 4" (3.00-4, 4.00-4 wheelbarrow / MH).
  // Largest: 63" (59/80R63, 55/80R63, 53/80R63 ultra-class mining tyres;
  // 57" for 46/90R57, 40.00R57, 80/80R57; 51" for 36.00R51)
  rim: { min: 4, max: 63 },
  // Section width, as written: inches (2.50-4 … 59/80R63, 40.00R57) or mm
  // (70/90-17 motorcycle … 1600 for the widest flotation tyres). The two
  // overlap (80/80R57, 80/90-21), so it is one range.
  width: { min: 2, max: 1600 },
  // Profile (aspect ratio), %. Lowest series on sale: 20 (car 20-series);
  // highest: 110 (high-flotation / some MH and old AGRI series)
  aspect: { min: 20, max: 110 },
  // "x" sizes (28x9-15): outer diameter, inches. Smallest around 8"
  // (8x3.00-4 castors, 9x3.50-4 mowers); large flotation / LT up to ~54";
  // 80 leaves room. Width is in inches there: 3 … 20 in practice.
  outerDiameter: { min: 8, max: 80 },
  outerDiameterWidth: { min: 2, max: 60 },
} as const;

const within = (v: number, r: { min: number; max: number }) => v >= r.min && v <= r.max;

/** Why a parsed size cannot be a real tyre, or null */
export function implausibleSize(p: ParsedTireSize): string | null {
  const rim = Number(p.size_rim);
  const width = Number(p.size_width);
  const aspect = p.size_aspect_ratio === null ? null : Number(p.size_aspect_ratio);
  if (!within(rim, SIZE_BOUNDS.rim)) return `${p.size_raw}: rim ${rim}" is not a tyre rim size`;
  if (p.size_outer_diameter !== undefined) {
    const d = Number(p.size_outer_diameter);
    if (!within(d, SIZE_BOUNDS.outerDiameter) || d <= rim) return `${p.size_raw}: outer diameter ${d}" is out of range`;
    if (!within(width, SIZE_BOUNDS.outerDiameterWidth)) return `${p.size_raw}: width ${width} is out of range`;
    return null;
  }
  if (!within(width, SIZE_BOUNDS.width)) return `${p.size_raw}: width ${width} is out of range`;
  if (aspect !== null && !within(aspect, SIZE_BOUNDS.aspect)) return `${p.size_raw}: profile ${aspect} is out of range`;
  return null;
}
