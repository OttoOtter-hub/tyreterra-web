import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { implausibleSize, parseTireSize, ParsedTireSize, TireSizeParseError } from '@tyreterra/tire-size';
import { Listing } from './entities/listing.entity';
import { ListingSize } from './entities/listing-size.entity';

/** Additional sizes a listing may carry besides the main one */
export const MAX_ADDITIONAL_SIZES = 3;

// Strictly parses the main size and the additional ones (same rules as a
// listing's size). Blank and repeated sizes are dropped; the main size is
// always first. Throws BadRequestException naming the bad size.
export function parseListingSizes(main: string, additional: string[] = []): ParsedTireSize[] {
  const out: ParsedTireSize[] = [];
  for (const [i, raw] of [main, ...additional].entries()) {
    if (i > 0 && !raw?.trim()) continue;
    let parsed: ParsedTireSize;
    try {
      parsed = parseTireSize(raw);
    } catch (e) {
      if (e instanceof TireSizeParseError) {
        throw new BadRequestException(i === 0 ? e.message : `Additional size "${raw}": ${e.message}`);
      }
      throw e;
    }
    const wrong = implausibleSize(parsed);
    if (wrong) throw new BadRequestException(i === 0 ? wrong : `Additional size ${wrong}`);
    if (!out.some((p) => p.size_raw === parsed.size_raw)) out.push(parsed);
  }
  if (out.length > MAX_ADDITIONAL_SIZES + 1) {
    throw new BadRequestException(`At most ${MAX_ADDITIONAL_SIZES} additional sizes per listing`);
  }
  return out;
}

/** The listing's own size columns, taken from its main size */
export type SizeColumns = Pick<
  Listing,
  'size_format' | 'size_width' | 'size_aspect_ratio' | 'size_construction' | 'size_rim' | 'size_raw'
>;

export function mainSizeColumns(p: ParsedTireSize): SizeColumns {
  return {
    size_format: p.format,
    size_width: p.size_width,
    size_aspect_ratio: p.size_aspect_ratio,
    size_construction: p.size_construction,
    size_rim: p.size_rim,
    size_raw: p.size_raw,
  };
}

// Replaces a listing's rows in listing_sizes. Call inside the same
// transaction that writes the listing, so the two never disagree.
export async function writeListingSizes(
  manager: EntityManager,
  listingId: string,
  sizes: ParsedTireSize[],
): Promise<void> {
  await manager.delete(ListingSize, { listing_id: listingId });
  await manager.insert(ListingSize, sizeRows(listingId, sizes));
}

/** listing_sizes rows for a listing, main size at position 0 */
export function sizeRows(listingId: string, sizes: ParsedTireSize[]) {
  return sizes.map((p, position) => ({ listing_id: listingId, position, ...mainSizeColumns(p) }));
}

/** size_raw of the additional sizes (position > 0), in order */
export function additionalSizesOf(sizes: ListingSize[] | undefined): string[] {
  return (sizes ?? [])
    .filter((s) => s.position > 0)
    .sort((a, b) => a.position - b.position)
    .map((s) => s.size_raw);
}
