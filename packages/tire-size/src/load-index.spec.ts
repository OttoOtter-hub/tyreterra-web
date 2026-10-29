import { formatLoadIndex, parseLoadIndex } from './load-index';

const EMPTY = { load_index_single: null, speed_single: null, load_index_dual: null, speed_dual: null, ply_rating: null };

describe('parseLoadIndex', () => {
  it.each([
    ['160K', { load_index_single: 160, speed_single: 'K' }],
    ['160 k', { load_index_single: 160, speed_single: 'K' }],
    ['160K/164J', { load_index_single: 160, speed_single: 'K', load_index_dual: 164, speed_dual: 'J' }],
    ['156/150L', { load_index_single: 156, speed_single: 'L', load_index_dual: 150, speed_dual: 'L' }],
    ['156 / 150 l', { load_index_single: 156, speed_single: 'L', load_index_dual: 150, speed_dual: 'L' }],
    ['173D/178A8', { load_index_single: 173, speed_single: 'D', load_index_dual: 178, speed_dual: 'A8' }],
    ['146A8/143B', { load_index_single: 146, speed_single: 'A8', load_index_dual: 143, speed_dual: 'B' }],
    ['209A2/193B', { load_index_single: 209, speed_single: 'A2', load_index_dual: 193, speed_dual: 'B' }],
    ['16PR', { ply_rating: 16 }],
    ['16pr', { ply_rating: 16 }],
    ['12 PR', { ply_rating: 12 }],
    ['PR16', { ply_rating: 16 }],
    ['16 ply', { ply_rating: 16 }],
    ['16PR (132B)', { ply_rating: 16, load_index_single: 132, speed_single: 'B' }],
    ['16PR 132B', { ply_rating: 16, load_index_single: 132, speed_single: 'B' }],
    ['132B 16PR', { ply_rating: 16, load_index_single: 132, speed_single: 'B' }],
    ['18PR 152/149K', { ply_rating: 18, load_index_single: 152, speed_single: 'K', load_index_dual: 149, speed_dual: 'K' }],
    ['177A2', { load_index_single: 177, speed_single: 'A2' }],
  ])('%s', (input, expected) => {
    const r = parseLoadIndex(input);
    expect(r).toMatchObject({ ...EMPTY, ...expected });
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it.each(['', '   ', null, undefined])('empty input %p gives nothing and no warning', (input) => {
    expect(parseLoadIndex(input)).toMatchObject({ ...EMPTY, complete: true, warnings: [] });
  });

  it.each([
    ['heavy duty', 'heavy duty'],
    ['TL', 'TL'],
    ['999Z', '999Z'], // index out of range
    ['0PR', '0PR'], // ply out of range
  ])('keeps unrecognised text "%s" with a warning and null fields', (input, rest) => {
    const r = parseLoadIndex(input);
    expect(r).toMatchObject({ ...EMPTY, complete: false, rest });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('reads what it can and warns about the rest', () => {
    const r = parseLoadIndex('160K TL');
    expect(r).toMatchObject({ load_index_single: 160, speed_single: 'K', complete: false, rest: 'TL' });
    expect(r.warnings).toHaveLength(1);
  });

  it('keeps the first of several load indexes, with a warning', () => {
    const r = parseLoadIndex('154/150L 152/148M');
    expect(r).toMatchObject({ load_index_single: 154, load_index_dual: 150, speed_single: 'L' });
    expect(r.warnings).toHaveLength(1);
  });

  it('formats parsed values back', () => {
    expect(formatLoadIndex(parseLoadIndex('156/150L'))).toBe('156/150L');
    expect(formatLoadIndex(parseLoadIndex('173D/178A8'))).toBe('173D/178A8');
    expect(formatLoadIndex(parseLoadIndex('132B 16PR'))).toBe('132B 16PR');
    expect(formatLoadIndex(EMPTY)).toBe('');
  });
});
