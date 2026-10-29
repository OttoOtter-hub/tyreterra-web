import { parseCondition, parseGluedCell, parsePrice, parseQty, parseTireType, parseYear, resolveSize, Segment } from './cell';
import { BRANDS, findBrand, fuzzyBrand, knownBrand } from './brands';
import { COUNTRIES, COUNTRY_NAMES, countryCode } from './countries';

interface Expect {
  sizes: string[];
  brand?: string | null;
  pattern?: string | null;
  qty?: number | null;
  year?: string | null;
  load?: string | null;
  condition?: string | null;
  type?: string | null;
  origin?: string | null;
  /** Text left over for the user to place; null = everything was read */
  rest?: string | null;
  unread?: string[];
  warns?: number;
}

// Cells as sellers write them: different brands, field orders, two sizes,
// metric and inch, every load index form, brand typos, junk
const GLUED: [Segment, string, Expect][] = [
  ['TBR', '315/80R22.5 Michelin X Multi D 156/150L 12pcs', { sizes: ['315/80R22.5'], brand: 'Michelin', pattern: 'X Multi D', load: '156/150L', qty: 12, rest: null }],
  ['TBR', 'Bridgestone R168 385/65R22.5 160K x4 DOT 2023', { sizes: ['385/65R22.5'], brand: 'Bridgestone', pattern: 'R168', load: '160K', qty: 4, year: '2023', rest: null }],
  ['TBR', '295/80 R 22,5 Continental HDR2 152/148M qty 6', { sizes: ['295/80R22.5'], brand: 'Continental', pattern: 'HDR2', load: '152/148M', qty: 6 }],
  ['TBR', 'Hankook AH31 315/70R22.5 154/150L (152/148M) 8 шт', { sizes: ['315/70R22.5'], brand: 'Hankook', qty: 8, load: '154/150L 152/148M', warns: 1 }],
  ['TBR', 'Goodyar KMAX S 385/55R22.5 160K 2024', { sizes: ['385/55R22.5'], brand: 'Goodyear', pattern: 'KMAX S', year: '2024', warns: 1 }],
  ['TBR', '31580R225 Kama NF202 10 pcs', { sizes: ['315/80R22.5'], brand: 'Kama', pattern: 'NF202', qty: 10, warns: 1 }],
  ['TBR', '12R22.5 Triangle TR668 18PR 152/149K', { sizes: ['12R22.5'], brand: 'Triangle', load: '18PR 152/149K' }],
  ['TBR', '11.00R20 Aeolus 16PR new', { sizes: ['11.00R20'], brand: 'Aeolus', load: '16PR', condition: 'new', rest: null }],
  ['TBR', 'Michelin XZE 2 275/70R22.5 148/145M made in France', { sizes: ['275/70R22.5'], brand: 'Michelin', pattern: 'XZE 2', origin: 'FR', rest: null }],
  ['TBR', 'Dunlop SP346 315/80R22.5 156/150L used 50%', { sizes: ['315/80R22.5'], brand: 'Dunlop', condition: 'used', rest: '50%' }],
  ['TBR', 'Pirelli FH01 315/60R22.5 152/148L', { sizes: ['315/60R22.5'], brand: 'Pirelli', pattern: 'FH01', rest: null }],
  ['TBR', 'Firestone FS422+ 315/80R22.5 156/150L', { sizes: ['315/80R22.5'], brand: 'Firestone', pattern: 'FS422+' }],
  ['TBR', 'Matador DHR4 295/80R22.5 x 20', { sizes: ['295/80R22.5'], brand: 'Matador', qty: 20 }],
  ['TBR', 'Sailun S696 445/45R19.5 160J trailer', { sizes: ['445/45R19.5'], brand: 'Sailun', type: 'trailer', load: '160J' }],
  ['TBR', 'Kumho KRS03 215/75R17.5 126/124M steer', { sizes: ['215/75R17.5'], brand: 'Kumho', type: 'steer' }],
  ['TBR', '315/80R22.5 & 295/80R22.5 Westlake', { sizes: ['315/80R22.5', '295/80R22.5'], brand: 'Westlake' }],
  ['TBR', '315/80R22.5 156/150L 16 ply Linglong', { sizes: ['315/80R22.5'], brand: 'Linglong', load: '156/150L 16 ply' }],
  ['TBR', '16PR (132B) 9.5R17.5 Sava', { sizes: ['9.5R17.5'], brand: 'Sava', load: '16PR 132B' }],
  ['TBR', '132B 16PR 9.5R17.5 Goodride', { sizes: ['9.5R17.5'], brand: 'Goodride', load: '132B 16PR' }],
  ['TBR', '12 PR 10R22.5 Double Coin', { sizes: ['10R22.5'], brand: 'Double Coin', load: '12 PR' }],
  ['TBR', '385/65R22.5 160 K Aeolus', { sizes: ['385/65R22.5'], brand: 'Aeolus', load: '160 K' }],
  ['PCR', '205/55R16 91V Michelin Primacy 4 4шт', { sizes: ['205/55R16'], brand: 'Michelin', pattern: 'Primacy 4', load: '91V', qty: 4 }],
  ['PCR', 'Continental WinterContact TS870 225/45 R17 94V XL 2022', { sizes: ['225/45R17'], brand: 'Continental', year: '2022', rest: 'XL' }],
  ['PCR', 'Nokian Hakkapeliitta 10 215/60R16 99T stud', { sizes: ['215/60R16'], brand: 'Nokian', type: 'winter_stud' }],
  ['PCR', 'LT215/85R16 BFGoodrich KO2 115/112S', { sizes: ['215/85R16'], brand: 'BFGoodrich', pattern: 'KO2', load: '115/112S' }],
  ['PCR', 'Yokohama BluEarth 195/65R15 91H x2', { sizes: ['195/65R15'], brand: 'Yokohama', qty: 2 }],
  ['PCR', '255/35ZR19 Pirelli P Zero 96Y', { sizes: ['255/35R19'], brand: 'Pirelli', pattern: 'P Zero' }],
  ['PCR', 'мишлен 205/55 R16 летние 4 шт', { sizes: ['205/55R16'], brand: 'Michelin', type: 'summer', qty: 4, rest: null }],
  ['OTR', '23.5R25 Michelin XHA2 L3', { sizes: ['23.5R25'], brand: 'Michelin', pattern: 'XHA2 L3' }],
  ['OTR', '17.5-25 Bridgestone 16PR VSW L2', { sizes: ['17.5-25'], brand: 'Bridgestone', load: '16PR' }],
  ['OTR', '26.5R25 Techking ETOT 209A2/193B', { sizes: ['26.5R25'], brand: null, load: '209A2/193B', rest: 'Techking ETOT' }],
  ['OTR', '29.5R25 BKT 2*', { sizes: ['29.5R25'], brand: 'BKT' }],
  ['OTR', 'Titan 20.5-25 20PR (177A2)', { sizes: ['20.5-25'], brand: 'Titan', load: '20PR 177A2' }],
  ['AGRI', '16.9-28 (440/80-28) Mitas TI-05 12PR', { sizes: ['16.9-28', '440/80-28'], brand: 'Mitas', pattern: 'TI-05', load: '12PR' }],
  ['AGRI', '710/70R42 173D/176A8 Michelin AxioBib 2', { sizes: ['710/70R42'], brand: 'Michelin', load: '173D/176A8' }],
  ['AGRI', 'Trelleborg TM900 650/85R38 173D/176A8', { sizes: ['650/85R38'], brand: 'Trelleborg', pattern: 'TM900' }],
  ['AGRI', '18.4R38 Alliance 146A8/143B x2', { sizes: ['18.4R38'], brand: 'Alliance', load: '146A8/143B', qty: 2 }],
  ['AGRI', '480/70R28 140D BKT Agrimax RT765', { sizes: ['480/70R28'], brand: 'BKT', pattern: 'Agrimax RT765' }],
  ['AGRI', '11.2-24 8PR Ceat', { sizes: ['11.2-24'], brand: 'Ceat', load: '8PR' }],
  ['AGRI', 'Kleber Topker 380/70R24 125D', { sizes: ['380/70R24'], brand: 'Kleber', pattern: 'Topker' }],
  ['MH', '6.50-10 Solideal solid 2pcs', { sizes: ['6.50-10'], brand: 'Solideal', type: 'solid', qty: 2 }],
  ['MH', '7.00-12 12PR Mitas FL-08 pneumatic', { sizes: ['7.00-12'], brand: 'Mitas', type: 'pneumatic' }],
  ['MH', '300-15 Nexen 20PR', { sizes: ['300-15'], brand: 'Nexen', load: '20PR' }],
  ['MH', '5.00-8 10 PR Starco', { sizes: ['5.00-8'], load: '10 PR', rest: 'Starco' }],
  ['MH', '250-15 PR16 Galaxy', { sizes: ['250-15'], brand: 'Galaxy', load: 'PR16' }],
  // not readable as a size we store: reported, never dropped
  ['MH', '28x9-15 Continental SC20', { sizes: [], unread: ['28x9-15'], brand: 'Continental', warns: 1 }],
  ['TBR', 'call for price!!!', { sizes: [], rest: 'call for price!!!' }],
  ['TBR', 'Brand XYZ 999/99R99', { sizes: [], unread: ['999/99R99'], rest: 'Brand XYZ' }],
  ['TBR', '12-8 call', { sizes: [], rest: '12-8 call' }],
];

describe('parseGluedCell', () => {
  it('covers at least 40 strings', () => expect(GLUED.length).toBeGreaterThanOrEqual(40));

  it.each(GLUED)('%s: %s', (segment, text, e) => {
    const g = parseGluedCell(text, segment);
    expect(g.sizes.map((s) => s.size.size_raw)).toEqual(e.sizes);
    if (e.brand !== undefined) expect(g.brand?.brand ?? null).toBe(e.brand);
    if (e.pattern !== undefined) expect(g.pattern).toBe(e.pattern);
    if (e.qty !== undefined) expect(g.qty).toBe(e.qty);
    if (e.year !== undefined) expect(g.year).toBe(e.year);
    if (e.load !== undefined) expect(g.loadText).toBe(e.load);
    if (e.condition !== undefined) expect(g.condition).toBe(e.condition);
    if (e.type !== undefined) expect(g.tire_type).toBe(e.type);
    if (e.origin !== undefined) expect(g.origin_country).toBe(e.origin);
    if (e.rest !== undefined) expect(g.unrecognized).toBe(e.rest);
    if (e.unread !== undefined) expect(g.unreadSizes).toEqual(e.unread);
    if (e.warns !== undefined) expect(g.warnings).toHaveLength(e.warns);
  });

});

describe('resolveSize', () => {
  it.each([
    ['315/80 R 22,5', '315/80R22.5'],
    ['LT215/85R16', '215/85R16'],
    ['255/35ZR19', '255/35R19'],
    ['31580R225', '315/80R22.5'],
    ['5.00-8', '5.00-8'],
  ])('%s → %s', (input, out) => expect(resolveSize(input, 'TBR')?.size.size_raw).toBe(out));

  it('rejects numbers no tyre has', () => {
    expect(resolveSize('999/99R99')).toBeNull();
  });
});

describe('single fields', () => {
  it.each([
    ['14pcs', 14], ['x14', 14], ['14 шт', 14], ['qty 14', 14], ['14', 14], ['14.0', 14], ['0', 0], ['abc', null], ['1.5', null],
  ])('qty %s → %s', (v, out) => expect(parseQty(v)).toBe(out));

  it.each([
    ['2023', '2023'], [2024, '2024'], ['DOT 0423', '2023'], ['DOT2219', '2019'], ['1999', null], ['2099', null], ['', null],
  ])('year %s → %s', (v, out) => expect(parseYear(v)).toBe(out));

  it.each([
    ['new', 'new'], ['Новая', 'new'], ['neu', 'new'], ['used', 'used'], ['б/у', 'used'], ['retread', 'retreaded'], ['?', null],
  ])('condition %s → %s', (v, out) => expect(parseCondition(v)).toBe(out));

  it.each([
    ['250,50 €', 250.5, 'EUR'],
    ['€1,234.56', 1234.56, 'EUR'],
    ['USD 99', 99, 'USD'],
    ['$ 120', 120, 'USD'],
    ['1 234,5', 1234.5, null],
    ['99,5', 99.5, null],
  ])('price %s → %s %s', (v, amount, currency) => expect(parsePrice(v)).toMatchObject({ amount, currency }));

  it('flags "1,234" as ambiguous', () => {
    const p = parsePrice('1,234');
    expect(p?.ambiguous).toBeDefined();
  });

  it.each([['', null], ['free', null], ['-5', null]])('price %s → %s', (v, out) => expect(parsePrice(v)).toBe(out));

  it.each([
    ['TBR', 'steer', 'steer'], ['TBR', 'рулевая', 'steer'], ['TBR', 'Antrieb', 'drive'], ['PCR', 'winter stud', 'winter_stud'],
    ['MH', 'Superelastic', 'solid'], ['PCR', 'trailer', null],
  ] as [Segment, string, string | null][])('%s type %s → %s', (segment, v, out) => expect(parseTireType(v, segment)).toBe(out));
});

describe('brands', () => {
  it('knows names, aliases and case', () => {
    expect(knownBrand('MICHELIN')).toBe('Michelin');
    expect(knownBrand('мишлен')).toBe('Michelin');
    expect(knownBrand('Double coin')).toBe('Double Coin');
  });

  it.each([['Goodyar', 'Goodyear'], ['Bridgestnoe', 'Bridgestone'], ['Contintal', 'Continental'], ['Michelln', 'Michelin']])(
    'fixes the typo %s → %s', (typo, brand) => expect(fuzzyBrand(typo)).toBe(brand));

  it('does not guess short or distant words', () => {
    expect(fuzzyBrand('BTK')).toBeNull(); // too short to fix
    expect(fuzzyBrand('Mercedes')).toBeNull();
  });

  it('finds a brand inside text and marks typo matches as inexact', () => {
    expect(findBrand('385/65R22.5 Goodyar KMAX')).toMatchObject({ brand: 'Goodyear', original: 'Goodyar', exact: false });
    expect(findBrand('Double Coin RR202')).toMatchObject({ brand: 'Double Coin', exact: true });
  });

  it('has no duplicate names', () => {
    const names = BRANDS.map((b) => b.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('countries', () => {
  it('maps every alias and name to a code from the country list', () => {
    const codes = new Set(COUNTRIES.map((c) => c.code));
    for (const [, code] of COUNTRY_NAMES) expect(codes).toContain(code);
  });

  it.each([['DE', 'DE'], ['de', 'DE'], ['Germany', 'DE'], ['Deutschland', 'DE'], ['Германия', 'DE'], ['Polska', 'PL'], ['Niemcy', 'DE'], ['Xx', null]])(
    '%s → %s', (v, out) => expect(countryCode(v)).toBe(out));
});
