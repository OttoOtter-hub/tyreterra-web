import { ConflictException } from '@nestjs/common';
import { ParsedTireSize } from '@tyreterra/tire-size';

// Rules shared by the listing form (create / update) and the smart import,
// so both accept and warn about exactly the same things.

/**
 * All sizes of one tyre must sit on the same rim; width and profile are the
 * seller's business (no equivalence table). Returns the problem, or null.
 */
export function rimMismatch(sizes: ParsedTireSize[]): string | null {
  const rims = [...new Set(sizes.map((s) => Number(s.size_rim)))];
  if (rims.length <= 1) return null;
  return `Rim diameters differ: ${sizes.map((s) => `${s.size_raw} (${Number(s.size_rim)}")`).join(', ')}`;
}

/** Form / API: a rim mismatch is an error the seller can confirm (409 → resend with confirm_rim_mismatch) */
export function assertRimsOrConfirmed(sizes: ParsedTireSize[], confirmed?: boolean): void {
  const problem = rimMismatch(sizes);
  if (problem && !confirmed) {
    throw new ConflictException(`${problem}. Check the sizes or confirm to save anyway.`);
  }
}
