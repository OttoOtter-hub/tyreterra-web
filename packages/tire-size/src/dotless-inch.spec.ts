import { parseTireSize, dotlessInchWidth } from './strict';
import { parsePartialSize } from './partial';
import { resolveSize } from './cell';

// "1800R25" and "18.00R25" are one tyre: both store width 18. The text
// (size_raw) stays as the seller wrote it.
const PAIRS: [string, string][] = [
  ['1800R25', '18.00R25'],
  ['1400R25', '14.00R25'],
  ['2100R35', '21.00R35'],
  ['4000R57', '40.00R57'],
  ['2650R25', '26.50R25'],
  ['1100R20', '11.00R20'],
  ['1200R24', '12.00R24'],
  ['825R20', '8.25R20'],
  ['1400-24', '14.00-24'],
  ['1000-20', '10.00-20'],
  ['750-16', '7.50-16'],
  ['650-10', '6.50-10'],
  ['300-15', '3.00-15'],
];

const parts = (s: string) => {
  const p = parseTireSize(s);
  return [p.format, p.size_width, p.size_aspect_ratio, p.size_construction, p.size_rim];
};

describe('dot-less inch widths', () => {
  it.each(PAIRS)('%s has the same components as %s', (dotless, dotted) => {
    expect(parts(dotless)).toEqual(parts(dotted));
    expect(parseTireSize(dotless).size_raw).toBe(dotless);
  });

  it.each(PAIRS.filter(([, d]) => Number(d.split(/[R-]/)[0]) >= 4))(
    'search reads %s and %s alike', (dotless, dotted) => {
      const a = parsePartialSize(dotless).candidates[0];
      const b = parsePartialSize(dotted).candidates[0];
      expect([a.width, a.construction, a.rim]).toEqual([b.width, b.construction, b.rim]);
    });

  it.each([
    ['1050/50R32', 1050], ['800/65R32', 800], ['710/70R42', 710], // slash sizes: mm, untouched
    ['175R14', 175], ['205R16', 205], ['225R15', 225], // old metric car sizes: mm, not 1.75"
    ['19.5L-24', 19.5], ['16.9-28', 16.9], ['23.5R25', 23.5], // written with a dot already
    ['1690-28', 1690], // not a quarter-inch step: left as written
  ])('%s keeps width %s', (s, w) => expect(parseTireSize(s).size_width).toBe(w));

  it('the rule itself', () => {
    expect(dotlessInchWidth('1800', 'R')).toBe(18);
    expect(dotlessInchWidth('300', '-')).toBe(3);
    expect(dotlessInchWidth('300', 'R')).toBeNull();
    expect(dotlessInchWidth('18.00', 'R')).toBeNull();
    expect(dotlessInchWidth('6025', 'R')).toBeNull();
  });

  it('the import keeps what the seller wrote and stores inches', () => {
    expect(resolveSize('1800R25', 'OTR')?.size).toMatchObject({ size_raw: '1800R25', size_width: 18 });
    expect(resolveSize('1800 R 25', 'OTR')?.size).toMatchObject({ size_raw: '1800R25', size_width: 18 });
  });
});
