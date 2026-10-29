import { ConflictException } from '@nestjs/common';
import { ParsedTireSize, ParsedLoadIndex, parseLoadIndex } from '@tyreterra/tire-size';

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

/**
 * Parsed load index / speed / ply columns for a load_index text. Unreadable
 * text is kept as it is in load_index; the parsed columns are null then.
 */
export function loadIndexColumns(text: string | null | undefined): { columns: ParsedLoadIndex; warnings: string[] } {
  const p = parseLoadIndex(text);
  return {
    columns: {
      load_index_single: p.load_index_single,
      speed_single: p.speed_single,
      load_index_dual: p.load_index_dual,
      speed_dual: p.speed_dual,
      ply_rating: p.ply_rating,
    },
    warnings: p.warnings,
  };
}
