import { Brackets, ObjectLiteral, SelectQueryBuilder, WhereExpressionBuilder } from 'typeorm';
import { SizeCandidate, PartialSize } from '@tyreterra/tire-size';
import { ListingSize } from './entities/listing-size.entity';

// Readings below this share of confidence are shown to the user as
// alternatives but not used to filter.
export const MIN_CANDIDATE_CONFIDENCE = 0.15;

/** One size in the suggestion / "nearest sizes" lists — no listing, price or company data. */
export interface SizeSuggestion {
  size: string;
  width: number;
  aspect: number | null;
  construction: string;
  rim: number;
  /** Outer diameter of an "x" size (28x9-15), else null */
  diameter: number | null;
  count: number;
}

export function usableCandidates(parsed: PartialSize): SizeCandidate[] {
  return parsed.candidates.filter((c) => c.width !== undefined && c.confidence >= MIN_CANDIDATE_CONFIDENCE);
}

// WHERE (candidate 1) OR (candidate 2) … — each candidate constrains only the
// components it knows; an unknown component does not restrict. An "x" query
// (28x9-15) matches only "x" sizes with that diameter, any other query only
// sizes without one: "9-15" is not 28x9-15.
export function whereAnyCandidate(
  qb: WhereExpressionBuilder,
  alias: string,
  candidates: SizeCandidate[],
): void {
  qb.andWhere(
    new Brackets((or) => {
      candidates.forEach((c, i) => {
        or.orWhere(
          new Brackets((and) => {
            and.where(`${alias}.size_width = :sw${i}`, { [`sw${i}`]: c.width });
            if (c.diameter !== undefined) and.andWhere(`${alias}.size_outer_diameter = :sd${i}`, { [`sd${i}`]: c.diameter });
            else and.andWhere(`${alias}.size_outer_diameter IS NULL`);
            if (c.aspect !== undefined) and.andWhere(`${alias}.size_aspect_ratio = :sa${i}`, { [`sa${i}`]: c.aspect });
            if (c.construction) and.andWhere(`${alias}.size_construction = :sc${i}`, { [`sc${i}`]: c.construction });
            if (c.rim !== undefined) and.andWhere(`${alias}.size_rim = :sr${i}`, { [`sr${i}`]: c.rim });
          }),
        );
      });
    }),
  );
}

// Plain prefix of size_raw for LIKE — only the characters a size can contain,
// with LIKE wildcards escaped anyway. "x" sizes are stored with a lower-case x.
export function sizeRawPrefix(normalisedQuery: string): string | null {
  const compact = normalisedQuery.replace(/\s+/g, '').replace(/[X×]/g, 'x');
  if (!compact || !/^[0-9./\-RLx]+$/.test(compact)) return null;
  return compact.replace(/[\\%_]/g, (ch) => `\\${ch}`) + '%';
}

export function toSuggestion(row: Record<string, unknown>): SizeSuggestion {
  return {
    size: String(row.size),
    width: Number(row.width),
    aspect: row.aspect === null || row.aspect === undefined ? null : Number(row.aspect),
    construction: String(row.construction),
    rim: Number(row.rim),
    diameter: row.diameter === null || row.diameter === undefined ? null : Number(row.diameter),
    count: Number(row.count),
  };
}

/** Adds size conditions for a size table alias (e.g. `ls`) */
export type SizeMatcher = (qb: WhereExpressionBuilder, sizeAlias: string) => void;

export function candidateMatcher(candidates: SizeCandidate[]): SizeMatcher {
  return (qb, sizeAlias) => whereAnyCandidate(qb, sizeAlias, candidates);
}

// Keeps listings that have at least one size (main or additional) matching,
// as EXISTS, so a listing with two matching sizes still appears once.
export function whereHasSize<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string, match: SizeMatcher): void {
  const sub = qb.subQuery().select('1').from(ListingSize, 'lsx').where(`lsx.listing_id = ${alias}.id`);
  match(sub, 'lsx');
  qb.andWhere(`EXISTS ${sub.getQuery()}`, sub.getParameters());
}
