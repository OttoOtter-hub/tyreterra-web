import { parsePartialSize } from '@tyreterra/tire-size';
import { sizeRawPrefix, toSuggestion, usableCandidates, MIN_CANDIDATE_CONFIDENCE } from './size-search';

describe('size-search helpers', () => {
  describe('sizeRawPrefix()', () => {
    it.each([
      ['315/80R22.5', '315/80R22.5%'],
      ['315/80 R', '315/80R%'],
      ['10.00-20', '10.00-20%'],
      ['19.5L-', '19.5L-%'],
    ])('%s → %s', (q, expected) => expect(sizeRawPrefix(q)).toBe(expected));

    it.each(['', '   ', "315' OR '1'='1", '315%', '31_5', '315\\', '315;DROP', 'ABC'])(
      'refuses %j (nothing that could act as SQL or a LIKE wildcard)',
      (q) => expect(sizeRawPrefix(q)).toBeNull(),
    );
  });

  it('usableCandidates() drops low-confidence readings and readings without a width', () => {
    const parsed = parsePartialSize('3158022');
    const usable = usableCandidates(parsed);
    expect(usable.length).toBeGreaterThan(0);
    for (const c of usable) {
      expect(c.width).toBeDefined();
      expect(c.confidence).toBeGreaterThanOrEqual(MIN_CANDIDATE_CONFIDENCE);
    }
    expect(usableCandidates(parsePartialSize('abc'))).toEqual([]);
  });

  it('toSuggestion() keeps only size fields and converts numeric strings', () => {
    const s = toSuggestion({
      size: '315/80R22.5', width: '315.00', aspect: '80.0', construction: 'R', rim: '22.5', count: '3',
      price_internal_encrypted: 'x', company_id: 'y', id: 'z',
    });
    expect(s).toEqual({ size: '315/80R22.5', width: 315, aspect: 80, construction: 'R', rim: 22.5, diameter: null, count: 3 });
    expect(toSuggestion({ size: '10.00-20', width: '10', aspect: null, construction: '-', rim: '20', count: '1' }).aspect)
      .toBeNull();
  });
});
