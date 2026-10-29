import { parseTireSize } from './strict';
import { implausibleSize, SIZE_BOUNDS } from './plausible';
import { resolveSize } from './cell';

const REAL = [
  // Mining / OTR giants
  '59/80R63', '53/80R63', '55/80R63', '46/90R57', '40.00R57', '24.00R35',
  '1800R25', '1400R25', '36.00R51', '80/80R57',
  // Everyday sizes at both ends
  '315/80R22.5', '440/80-28', '3.00-4', '710/70R42', '12.5/80-18', '295/25R20',
];
const IMPOSSIBLE = ['999/99R99', '0/0R0', '5/5R5', '315/80R2', '80/10R22.5'];

describe('implausibleSize', () => {
  it.each(REAL)('%s is a real size', (s) => expect(implausibleSize(parseTireSize(s))).toBeNull());
  it.each(IMPOSSIBLE)('%s is rejected', (s) => expect(implausibleSize(parseTireSize(s))).not.toBeNull());

  it('says which number is wrong', () => {
    expect(implausibleSize(parseTireSize('999/99R99'))).toMatch(/rim 99/);
    expect(implausibleSize(parseTireSize('5/5R5'))).toMatch(/profile 5/);
  });

  it('a dot-less inch width is stored in inches, so the bounds see 18, not 1800', () => {
    expect(parseTireSize('1800R25').size_width).toBe(18);
    expect(SIZE_BOUNDS.width.max).toBeLessThan(1800); // 1800 mm is not a width
  });
});

describe('import uses the same bounds', () => {
  it.each(REAL)('%s is resolved from a cell', (s) => expect(resolveSize(s)).not.toBeNull());
  it.each(IMPOSSIBLE)('%s is not', (s) => expect(resolveSize(s)).toBeNull());
});
