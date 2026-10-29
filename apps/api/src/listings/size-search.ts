import { Brackets, WhereExpressionBuilder } from 'typeorm';
import { SizeCandidate, PartialSize } from '@tyreterra/tire-size';

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
  count: number;
}

export function usableCandidates(parsed: PartialSize): SizeCandidate[] {
  return parsed.candidates.filter((c) => c.width !== undefined && c.confidence >= MIN_CANDIDATE_CONFIDENCE);
}

// WHERE (candidate 1) OR (candidate 2) … — each candidate constrains only the
// components it knows; an unknown component does not restrict.
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
// with LIKE wildcards escaped anyway.
export function sizeRawPrefix(normalisedQuery: string): string | null {
  const compact = normalisedQuery.replace(/\s+/g, '');
  if (!compact || !/^[0-9./\-RL]+$/.test(compact)) return null;
  return compact.replace(/[\\%_]/g, (ch) => `\\${ch}`) + '%';
}

export function toSuggestion(row: Record<string, unknown>): SizeSuggestion {
  return {
    size: String(row.size),
    width: Number(row.width),
    aspect: row.aspect === null || row.aspect === undefined ? null : Number(row.aspect),
    construction: String(row.construction),
    rim: Number(row.rim),
    count: Number(row.count),
  };
}
