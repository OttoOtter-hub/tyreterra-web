import { ParsedTireSize } from './strict';

// The strict parser checks the spelling, not the numbers: "999/99R99" reads
// fine. These bounds cover every tyre on the market, from 3.00-4 wheelbarrow
// tyres to 59/80R63 mining tyres, and reject what no tyre can be.
const RIM = { min: 4, max: 63 };
// Width is in inches or in mm, whatever the format ("59/80R63", "440/80-28")
const MM_WIDTH = { min: 100, max: 1600 };
const INCH_WIDTH = { min: 2, max: 60 };
const ASPECT = { min: 20, max: 110 };

/** Why a parsed size cannot be a real tyre, or null */
export function implausibleSize(p: ParsedTireSize): string | null {
  const rim = Number(p.size_rim);
  const width = Number(p.size_width);
  const aspect = p.size_aspect_ratio === null ? null : Number(p.size_aspect_ratio);
  if (rim < RIM.min || rim > RIM.max) return `${p.size_raw}: rim ${rim}" is not a tyre rim size`;
  const inRange = (r: { min: number; max: number }) => width >= r.min && width <= r.max;
  if (!inRange(MM_WIDTH) && !inRange(INCH_WIDTH)) return `${p.size_raw}: width ${width} is out of range`;
  if (aspect !== null && (aspect < ASPECT.min || aspect > ASPECT.max)) return `${p.size_raw}: profile ${aspect} is out of range`;
  return null;
}
