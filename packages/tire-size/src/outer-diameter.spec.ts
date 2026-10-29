import { parseTireSize } from './strict';
import { parsePartialSize } from './partial';
import { implausibleSize } from './plausible';
import { resolveSize } from './cell';

// "x" sizes: outer diameter x width (R or -) rim — forklift, ATV, LT, garden
const STRICT: [string, { raw: string; d: number; w: number; c: 'R' | '-'; rim: number }][] = [
  ['28x9-15', { raw: '28x9-15', d: 28, w: 9, c: '-', rim: 15 }],
  ['28X9-15', { raw: '28x9-15', d: 28, w: 9, c: '-', rim: 15 }],
  ['28×9-15', { raw: '28x9-15', d: 28, w: 9, c: '-', rim: 15 }],
  ['28 x 9 - 15', { raw: '28x9-15', d: 28, w: 9, c: '-', rim: 15 }],
  ['28 X 9-15', { raw: '28x9-15', d: 28, w: 9, c: '-', rim: 15 }],
  [' 28x9 -15 ', { raw: '28x9-15', d: 28, w: 9, c: '-', rim: 15 }],
  ['18x7-8', { raw: '18x7-8', d: 18, w: 7, c: '-', rim: 8 }],
  ['16x6-8', { raw: '16x6-8', d: 16, w: 6, c: '-', rim: 8 }],
  ['21x8-9', { raw: '21x8-9', d: 21, w: 8, c: '-', rim: 9 }],
  ['23x9-10', { raw: '23x9-10', d: 23, w: 9, c: '-', rim: 10 }],
  ['27x10-12', { raw: '27x10-12', d: 27, w: 10, c: '-', rim: 12 }],
  ['31x10.50R15', { raw: '31x10.50R15', d: 31, w: 10.5, c: 'R', rim: 15 }],
  ['31 x 10.50 R 15', { raw: '31x10.50R15', d: 31, w: 10.5, c: 'R', rim: 15 }],
  ['33X12.50R15', { raw: '33x12.50R15', d: 33, w: 12.5, c: 'R', rim: 15 }],
  ['35x12.50R20', { raw: '35x12.50R20', d: 35, w: 12.5, c: 'R', rim: 20 }],
  ['23x10.50-12', { raw: '23x10.50-12', d: 23, w: 10.5, c: '-', rim: 12 }],
  ['25x8-12', { raw: '25x8-12', d: 25, w: 8, c: '-', rim: 12 }],
  ['26.5x14-12', { raw: '26.5x14-12', d: 26.5, w: 14, c: '-', rim: 12 }],
];

describe('"x" sizes, strict parser', () => {
  it.each(STRICT)('%s', (input, e) => {
    const p = parseTireSize(input);
    expect(p).toMatchObject({
      format: 'outer_diameter',
      size_raw: e.raw,
      size_outer_diameter: e.d,
      size_width: e.w,
      size_aspect_ratio: null,
      size_construction: e.c,
      size_rim: e.rim,
    });
    expect(implausibleSize(p)).toBeNull();
  });

  it.each(['28x9', 'x9-15', '28x-15', '28xx9-15', '28x9/15'])('%s is not a size', (s) =>
    expect(() => parseTireSize(s)).toThrow());

  it.each(['15x9-15', '5x3-4', '99x9-15', '28x90-15'])('%s is implausible', (s) =>
    expect(implausibleSize(parseTireSize(s))).not.toBeNull());

  it('other formats carry no diameter', () => {
    expect(parseTireSize('315/80R22.5').size_outer_diameter).toBeUndefined();
    expect(parseTireSize('9.00-15').size_outer_diameter).toBeUndefined();
  });
});

describe('"x" sizes, search parser', () => {
  it.each(STRICT)('%s reads like the strict parser', (input, e) => {
    const p = parsePartialSize(input);
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]).toMatchObject({
      diameter: e.d, width: e.w, construction: e.c, rim: e.rim, format: 'outer_diameter', complete: true, label: e.raw,
    });
  });

  it('reads the parts typed so far', () => {
    expect(parsePartialSize('28x').candidates[0]).toMatchObject({ diameter: 28, format: 'partial', label: '28x…' });
    expect(parsePartialSize('28x9').candidates[0]).toMatchObject({ diameter: 28, width: 9, complete: false, label: '28x9…' });
    expect(parsePartialSize('28 x 9 -').candidates[0]).toMatchObject({ diameter: 28, width: 9, construction: '-', complete: false });
    // No construction typed: any
    const any = parsePartialSize('28 x 9 15').candidates[0];
    expect(any).toMatchObject({ diameter: 28, width: 9, rim: 15, complete: true });
    expect(any.construction).toBeUndefined();
  });

  it('a plain size has no diameter, and "x" between metric numbers is still a separator', () => {
    expect(parsePartialSize('9-15').candidates.every((c) => c.diameter === undefined)).toBe(true);
    const metric = parsePartialSize('315x80R22.5');
    expect(metric.candidates[0]).toMatchObject({ width: 315, aspect: 80, rim: 22.5 });
    expect(metric.candidates[0].diameter).toBeUndefined();
  });

  it('impossible "x" sizes give no reading', () => {
    expect(parsePartialSize('15x9-15').candidates).toEqual([]);
    expect(parsePartialSize('99x9-15').candidates).toEqual([]);
  });
});

describe('"x" sizes, import cell reader', () => {
  it.each([['28x9-15'], ['28 x 9 - 15'], ['28*9-15'], ['28×9-15']])('%s', (s) =>
    expect(resolveSize(s, 'MH')?.size).toMatchObject({ size_raw: '28x9-15', size_outer_diameter: 28, size_width: 9, size_rim: 15 }));
});
