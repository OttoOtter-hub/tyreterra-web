import { parsePartialSize, normaliseSizeQuery, SizeCandidate } from './partial';
import { parseTireSize } from './strict';

type Expect = Partial<Pick<SizeCandidate, 'width' | 'aspect' | 'construction' | 'rim' | 'format' | 'label'>>;

// [input, best candidate, number of candidates]
const cases: [string, Expect, number][] = [
  // ── Metric radial, every common spelling ──
  ['315/80R22.5', { width: 315, aspect: 80, construction: 'R', rim: 22.5, format: 'metric', label: '315/80R22.5' }, 1],
  ['315/80r22.5', { width: 315, aspect: 80, construction: 'R', rim: 22.5 }, 1],
  ['315/80 R 22.5', { width: 315, aspect: 80, construction: 'R', rim: 22.5 }, 1],
  [' 315 / 80 R 22.5 ', { width: 315, aspect: 80, construction: 'R', rim: 22.5 }, 1],
  ['315/80R22,5', { width: 315, aspect: 80, construction: 'R', rim: 22.5 }, 1],
  ['315/80 r 22,5', { width: 315, aspect: 80, construction: 'R', rim: 22.5 }, 1],
  ['385/65R22.5', { width: 385, aspect: 65, construction: 'R', rim: 22.5 }, 1],
  ['295/80R22.5', { width: 295, aspect: 80, construction: 'R', rim: 22.5 }, 1],
  ['205/55R16', { width: 205, aspect: 55, construction: 'R', rim: 16, format: 'metric' }, 1],
  ['245/35R19', { width: 245, aspect: 35, construction: 'R', rim: 19 }, 1],
  ['315/80R225', { width: 315, aspect: 80, construction: 'R', rim: 22.5, label: '315/80R22.5' }, 1],
  // ── Missing R / other separators: construction left open ──
  ['315/80 22.5', { width: 315, aspect: 80, construction: undefined, rim: 22.5, format: 'metric' }, 1],
  ['315 80 22.5', { width: 315, aspect: 80, construction: undefined, rim: 22.5 }, 1],
  ['315 80 22,5', { width: 315, aspect: 80, rim: 22.5 }, 1],
  ['315x80x22.5', { width: 315, aspect: 80, rim: 22.5 }, 1],
  ['315X80X22.5', { width: 315, aspect: 80, rim: 22.5 }, 1],
  ['315*80*22.5', { width: 315, aspect: 80, rim: 22.5 }, 1],
  ['315-80-22.5', { width: 315, aspect: 80, construction: undefined, rim: 22.5 }, 1],
  ['315/80/22.5', { width: 315, aspect: 80, rim: 22.5 }, 1],
  ['315/80-22.5', { width: 315, aspect: 80, construction: '-', rim: 22.5, format: 'slash_diagonal' }, 1],
  // ── Glued digits ──
  ['31580R225', { width: 315, aspect: 80, construction: 'R', rim: 22.5 }, 1],
  ['31580r22.5', { width: 315, aspect: 80, construction: 'R', rim: 22.5 }, 1],
  ['31580225', { width: 315, aspect: 80, rim: 22.5, label: '315/80 22.5' }, 1],
  ['38565225', { width: 385, aspect: 65, rim: 22.5 }, 1],
  ['29580225', { width: 295, aspect: 80, rim: 22.5 }, 1],
  ['3158022.5', { width: 315, aspect: 80, rim: 22.5 }, 1],
  ['31580/225', { width: 315, aspect: 80, rim: 22.5 }, 1],
  ['315/80225', { width: 315, aspect: 80, rim: 22.5 }, 1],
  ['10505032', { width: 1050, aspect: 50, rim: 32 }, 1], // no 32.5 rim exists,
  ['3158022', { width: 315, aspect: 80, rim: 22 }, 2], // or 22.5 still being typed
  ['2055516', { width: 205, aspect: 55, rim: 16 }, 2],
  // ── Partial input, in typing order ──
  ['3', {}, 0],
  ['31', { width: 31, format: 'partial' }, 1],
  ['315', { width: 315, aspect: undefined, rim: undefined, format: 'partial', label: '315…' }, 1],
  ['3158', { width: 315, aspect: undefined }, 1],
  ['31580', { width: 315, aspect: 80, format: 'partial' }, 1],
  ['315802', { width: 315, aspect: 80, rim: undefined }, 1],
  ['315/', { width: 315, aspect: undefined, format: 'partial' }, 1],
  ['315/8', { width: 315, aspect: undefined }, 1],
  ['315/80', { width: 315, aspect: 80, construction: undefined, label: '315/80…' }, 1],
  ['315/80R', { width: 315, aspect: 80, construction: 'R', rim: undefined, label: '315/80R…' }, 1],
  ['315/80 R', { width: 315, aspect: 80, construction: 'R' }, 1],
  ['315/80R2', { width: 315, aspect: 80, construction: 'R', rim: undefined }, 1],
  ['315/80R22', { width: 315, aspect: 80, construction: 'R', rim: 22, format: 'metric' }, 1],
  ['315/80R22.', { width: 315, aspect: 80, construction: 'R', rim: 22 }, 1],
  ['315 80', { width: 315, aspect: 80 }, 1],
  ['315-80', { width: 315, aspect: 80 }, 1],
  // ── Flotation ──
  ['710/70R42', { width: 710, aspect: 70, construction: 'R', rim: 42, format: 'flotation' }, 1],
  ['1050/50R32', { width: 1050, aspect: 50, construction: 'R', rim: 32, format: 'flotation' }, 1],
  ['600/65 r 28', { width: 600, aspect: 65, construction: 'R', rim: 28, format: 'flotation' }, 1],
  // ── Diagonal inch ──
  ['10.00-20', { width: 10, construction: '-', rim: 20, format: 'diagonal_inch', label: '10.00-20' }, 1],
  ['10,00-20', { width: 10, construction: '-', rim: 20 }, 1],
  ['7.50-16', { width: 7.5, construction: '-', rim: 16, format: 'diagonal_inch' }, 1],
  ['750-16', { width: 7.5, construction: '-', rim: 16, label: '7.50-16' }, 1],
  ['1200-24', { width: 12, construction: '-', rim: 24 }, 1],
  ['10.00-', { width: 10, construction: '-', rim: undefined }, 1],
  ['10.00 20', { width: 10, construction: undefined, rim: 20, format: 'inch' }, 1],
  // ── Radial inch ──
  ['14.9R28', { width: 14.9, construction: 'R', rim: 28, format: 'radial_inch' }, 1],
  ['23.5R25', { width: 23.5, construction: 'R', rim: 25, format: 'radial_inch' }, 1],
  ['11R22.5', { width: 11, construction: 'R', rim: 22.5, format: 'radial_inch' }, 1],
  ['12 R 22,5', { width: 12, construction: 'R', rim: 22.5 }, 1],
  ['1100R20', { width: 11, construction: 'R', rim: 20, label: '11.00R20' }, 1],
  ['14.9 28', { width: 14.9, rim: 28, format: 'inch' }, 1],
  ['14.9R', { width: 14.9, construction: 'R', rim: undefined }, 1],
  // ── Slash diagonal ──
  ['12.5/80-18', { width: 12.5, aspect: 80, construction: '-', rim: 18, format: 'slash_diagonal' }, 1],
  ['12,5/80-18', { width: 12.5, aspect: 80, construction: '-', rim: 18 }, 1],
  ['12.5/80', { width: 12.5, aspect: 80, rim: undefined }, 1],
  ['10.0/75-15.3', { width: 10, aspect: 75, construction: '-', rim: 15.3 }, 1],
  // ── L-series ──
  ['19.5L-24', { width: 19.5, construction: '-', rim: 24, format: 'diagonal_inch', label: '19.5L-24' }, 1],
  ['19.5l-24', { width: 19.5, construction: '-', rim: 24 }, 1],
  ['19.5L24', { width: 19.5, construction: '-', rim: 24 }, 1],
  ['19.5L', { width: 19.5, construction: '-', rim: undefined }, 1],
  // ── Empty, garbage, injection-like ──
  ['', {}, 0],
  ['   ', {}, 0],
  ['abc', {}, 0],
  ['R22.5', {}, 0],
  ['/80', {}, 0],
  ['315//80', {}, 0],
  ['315/-80', {}, 0],
  ['1.2.3', {}, 0],
  ['0', {}, 0],
  ['99999999999', {}, 0],
  ['315/80R99', {}, 0],
  ['315/10R22.5', {}, 0],
  ['5/80R22.5', {}, 0],
  ["'; DROP TABLE listings;--", {}, 0],
  ['315/80R22.5\'', {}, 0],
  ["315' OR '1'='1", {}, 0],
  ['315%', {}, 0],
  ['315_80', {}, 0],
  ['<script>', {}, 0],
  ['315/80R22.5 ' + '9'.repeat(40), {}, 0],
];

describe('parsePartialSize — table', () => {
  it('has at least 60 cases', () => expect(cases.length).toBeGreaterThanOrEqual(60));

  it.each(cases)('%j', (input, best, count) => {
    const r = parsePartialSize(input);
    expect(r.candidates).toHaveLength(count);
    if (count === 0) {
      expect(r.format).toBe('unknown');
      expect(r.confidence).toBe(0);
      return;
    }
    const top = r.candidates[0];
    for (const [k, v] of Object.entries(best)) {
      expect({ [k]: top[k as keyof SizeCandidate] }).toEqual({ [k]: v });
    }
    // Top-level fields mirror the best candidate
    expect([r.width, r.aspect, r.construction, r.rim]).toEqual([top.width, top.aspect, top.construction, top.rim]);
    expect(r.confidence).toBe(top.confidence);
  });
});

describe('parsePartialSize — behaviour', () => {
  it('returns every reading of an ambiguous glued string, with confidences adding up to 1', () => {
    const r = parsePartialSize('3158022');
    expect(r.candidates.map((c) => c.rim)).toEqual([22, 22.5]);
    const sum = r.candidates.reduce((s, c) => s + c.confidence, 0);
    expect(sum).toBeCloseTo(1, 1);
    expect(r.candidates[0].confidence).toBeGreaterThan(r.candidates[1].confidence);
  });

  it('marks complete only when width and rim are known', () => {
    expect(parsePartialSize('315/80R22.5').candidates[0].complete).toBe(true);
    expect(parsePartialSize('315/80R').candidates[0].complete).toBe(false);
  });

  it('accepts non-string input without throwing', () => {
    expect(parsePartialSize(undefined).candidates).toEqual([]);
    expect(parsePartialSize(null).candidates).toEqual([]);
  });

  it('never throws on random input', () => {
    const alphabet = '0123456789./-xXrRlL ,*';
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 2000; i++) {
      const len = Math.floor(rnd() * 14);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(() => parsePartialSize(s)).not.toThrow();
      for (const c of parsePartialSize(s).candidates) {
        expect(c.confidence).toBeGreaterThan(0);
        expect(c.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  // Every size the strict parser accepts reads the same way when searched for
  it.each(['315/80R22.5', '710/70R42', '10.00-20', '14.9R28', '23.5R25', '12.5/80-18', '19.5L-24'])(
    'agrees with parseTireSize on %s',
    (s) => {
      const strict = parseTireSize(s);
      const top = parsePartialSize(s).candidates[0];
      expect(top.width).toBe(strict.size_width);
      expect(top.aspect ?? null).toBe(strict.size_aspect_ratio);
      expect(top.construction).toBe(strict.size_construction);
      expect(top.rim).toBe(strict.size_rim);
      expect(top.format).toBe(strict.format);
    },
  );

  it('normaliseSizeQuery uppercases, turns commas into dots and collapses spaces', () => {
    expect(normaliseSizeQuery('  315/80  r 22,5 ')).toBe('315/80 R 22.5');
  });
});
