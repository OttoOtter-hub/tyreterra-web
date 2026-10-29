import { Segment } from '@tyreterra/tire-size';
import { FieldType, guessColumns, guessHeaderRow, guessSheet, headerSignature } from './columns';
import { readCsv, decodeText, detectFileType, FileReadError, cellText } from './file-reader';
import { csvSafe, toCsv } from './csv';
import { assertSafeZip, ZipGuardError } from './zip-guard';
import { deflateRawSync } from 'zlib';

// Synthetic price lists: different header languages, a title block above the
// table, glued cells, junk rows. Each states the column types we expect.
interface Sample {
  name: string;
  segment: Segment;
  rows: string[][];
  headerRow: number;
  types: FieldType[];
  glued?: number[];
}

const SAMPLES: Sample[] = [
  {
    name: 'English, clean',
    segment: 'TBR',
    headerRow: 1,
    rows: [
      ['Size', 'Brand', 'Pattern', 'Qty', 'DOT', 'Price', 'Currency', 'SKU'],
      ['315/80R22.5', 'Michelin', 'X Multi D', '12', '2024', '250.5', 'EUR', 'MI-1'],
      ['385/65R22.5', 'Bridgestone', 'R168', '4', '2023', '199', 'EUR', 'BR-2'],
      ['295/80R22.5', 'Continental', 'HDR2', '6', '2022', '210', 'EUR', 'CO-3'],
    ],
    types: ['size', 'brand', 'pattern', 'qty', 'dot_year', 'price', 'currency', 'sku'],
  },
  {
    name: 'Russian, title block above the table',
    segment: 'TBR',
    headerRow: 4,
    rows: [
      ['ООО «Шина-Опт»'],
      ['Прайс-лист на 01.10.2026'],
      [],
      ['Типоразмер', 'Производитель', 'Модель', 'Остаток', 'Год выпуска', 'Цена, руб', 'Страна'],
      ['315/80R22.5', 'Кама', 'NF202', '10', '2025', '18500', 'Россия'],
      ['385/65R22.5', 'Michelin', 'X Multi T', '2', '2024', '41000', 'Франция'],
      ['295/80R22.5', 'Cordiant', 'TR-1', '8', '2025', '17000', 'Россия'],
    ],
    types: ['size', 'brand', 'pattern', 'qty', 'dot_year', 'price', 'country'],
  },
  {
    name: 'German',
    segment: 'PCR',
    headerRow: 1,
    rows: [
      ['Dimension', 'Hersteller', 'Profil', 'Menge', 'Zustand', 'Lagerort', 'Preis'],
      ['205/55R16', 'Continental', 'PremiumContact 6', '4', 'Neu', 'DE', '89,90'],
      ['225/45R17', 'Michelin', 'Pilot Sport 4', '8', 'Neu', 'DE', '120,00'],
      ['195/65R15', 'Dunlop', 'BluResponse', '2', 'gebraucht', 'AT', '45,00'],
    ],
    types: ['size', 'brand', 'pattern', 'qty', 'condition', 'country', 'price'],
  },
  {
    name: 'Polish',
    segment: 'AGRI',
    headerRow: 1,
    rows: [
      ['Rozmiar', 'Marka', 'Bieżnik', 'Ilość', 'Indeks nośności', 'Kraj produkcji'],
      ['710/70R42', 'Michelin', 'AxioBib 2', '2', '173D/176A8', 'Francja'],
      ['650/85R38', 'Trelleborg', 'TM900', '4', '173D/176A8', 'Szwecja'],
      ['16.9-28', 'Mitas', 'TI-05', '6', '12PR', 'Czechy'],
    ],
    types: ['size', 'brand', 'pattern', 'qty', 'load_index', 'origin_country'],
  },
  {
    name: 'French and Italian mix',
    segment: 'OTR',
    headerRow: 1,
    rows: [
      ['Dimensione', 'Marque', 'Quantité', 'Prezzo', 'Remarque'],
      ['23.5R25', 'Michelin', '2', '3500', 'stock Milano'],
      ['26.5R25', 'Bridgestone', '1', '5200', 'pronta consegna'],
      ['17.5-25', 'BKT', '4', '1100', ''],
    ],
    types: ['size', 'brand', 'qty', 'price', 'comment'],
  },
  {
    name: 'Glued description, no headers that help',
    segment: 'TBR',
    headerRow: 1,
    rows: [
      ['Article', 'Description', 'Stock'],
      ['A1', '315/80R22.5 Michelin X Multi D 156/150L', '12'],
      ['A2', 'Bridgestone R168 385/65R22.5 160K', '4'],
      ['A3', '295/80R22.5 Continental HDR2 152/148M', '6'],
      ['A4', '12R22.5 Triangle TR668 18PR', '10'],
    ],
    types: ['sku', 'size', 'qty'],
    glued: [1],
  },
  {
    name: 'No header row at all',
    segment: 'TBR',
    headerRow: 0,
    rows: [
      ['315/80R22.5', 'Michelin', '12', '2024'],
      ['385/65R22.5', 'Bridgestone', '4', '2023'],
      ['295/80R22.5', 'Continental', '6', '2022'],
      ['12R22.5', 'Triangle', '10', '2025'],
    ],
    types: ['size', 'brand', 'qty', 'dot_year'],
  },
  {
    name: 'Junk rows, totals and an empty column',
    segment: 'TBR',
    headerRow: 2,
    rows: [
      ['STOCK LIST — CALL +49 000 000'],
      ['Size', '', 'Brand', 'Qty', 'Notes'],
      ['315/80R22.5', '', 'Michelin', '12', 'new arrival'],
      ['--- TRUCK ---', '', '', '', ''],
      ['385/65R22.5', '', 'Bridgestone', '4', ''],
      ['295/80R22.5', '', 'Continental', '6', 'last pieces'],
      ['Total', '', '', '22', ''],
    ],
    types: ['size', 'ignore', 'brand', 'qty', 'comment'],
  },
  {
    name: 'Two size columns (main and alternative)',
    segment: 'AGRI',
    headerRow: 1,
    rows: [
      ['Size', 'Alt size', 'Brand', 'Qty'],
      ['16.9-28', '440/80-28', 'Mitas', '2'],
      ['18.4-38', '460/85-38', 'Alliance', '4'],
      ['12.4-24', '320/85-24', 'BKT', '6'],
    ],
    types: ['size', 'size', 'brand', 'qty'],
  },
];

describe('column detection', () => {
  it('has at least 8 sample files', () => expect(SAMPLES.length).toBeGreaterThanOrEqual(8));

  it.each(SAMPLES.map((s) => [s.name, s] as const))('%s', (_name, s) => {
    expect(guessHeaderRow(s.rows)).toBe(s.headerRow);
    const width = Math.max(...s.rows.map((r) => r.length));
    const header = Array.from({ length: width }, (_, i) => (s.headerRow ? s.rows[s.headerRow - 1][i] ?? '' : ''));
    const guesses = guessColumns(header, s.rows.slice(s.headerRow), s.segment);
    expect(guesses.map((g) => g.type)).toEqual(s.types);
    for (const g of guesses) {
      expect(g.confidence).toBeGreaterThanOrEqual(0);
      expect(g.confidence).toBeLessThanOrEqual(1);
      expect(g.samples.length).toBeLessThanOrEqual(5);
    }
    for (const i of s.glued ?? []) expect(guesses[i].glued).toBe(true);
  });

  it('picks the sheet that holds the sizes', () => {
    const sheets = [
      { name: 'Cover', rows: [['Price list'], ['Valid until 31.12']] },
      { name: 'Stock', rows: SAMPLES[0].rows },
    ];
    expect(guessSheet(sheets)).toBe('Stock');
  });

  it('gives the same signature to headers that differ in case and spacing only', () => {
    expect(headerSignature(['Size', 'Brand ', 'QTY'])).toBe(headerSignature(['size', 'brand', 'qty']));
    expect(headerSignature(['Size', 'Brand'])).not.toBe(headerSignature(['Brand', 'Size']));
  });
});

describe('file reading', () => {
  it('reads CSV with ; and quoted fields', () => {
    const { rows } = readCsv('Size;Brand;Note\n315/80R22.5;Michelin;"a; b ""quoted"""\n');
    expect(rows).toEqual([['Size', 'Brand', 'Note'], ['315/80R22.5', 'Michelin', 'a; b "quoted"']]);
  });

  it('decodes Windows-1251 CSV', () => {
    const cp1251 = Buffer.from([0xd0, 0xe0, 0xe7, 0xec, 0xe5, 0xf0]); // "Размер"
    expect(decodeText(cp1251)).toBe('Размер');
  });

  it('checks the signature against name and type', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(detectFileType(zip, 'a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
    expect(() => detectFileType(zip, 'a.csv', 'text/csv')).toThrow(FileReadError);
    expect(() => detectFileType(Buffer.from('a,b\n'), 'a.exe', 'application/x-msdownload')).toThrow(FileReadError);
    expect(() => detectFileType(Buffer.from([0x61, 0, 0x62]), 'a.csv', 'text/csv')).toThrow(FileReadError);
  });

  it('takes the saved result of a formula and never the formula', () => {
    expect(cellText({ formula: 'SUM(A1:A3)', result: 12 } as never)).toBe('12');
    expect(cellText({ formula: 'NOW()' } as never)).toBe('');
    expect(cellText({ richText: [{ text: '315/80' }, { text: 'R22.5' }] } as never)).toBe('315/80R22.5');
  });
});

describe('zip guard', () => {
  function zipOf(content: Buffer, declared = content.length): Buffer {
    const data = deflateRawSync(content);
    const name = Buffer.from('a.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + name.length, 12);
    eocd.writeUInt32LE(30 + name.length + data.length, 16);
    return Buffer.concat([local, name, data, central, name, eocd]);
  }

  it('accepts an ordinary archive', () => {
    expect(() => assertSafeZip(zipOf(Buffer.from('<x>hello</x>'.repeat(50))))).not.toThrow();
  });

  it('refuses an entry that expands too much', () => {
    expect(() => assertSafeZip(zipOf(Buffer.alloc(10 * 1024 * 1024)))).toThrow(ZipGuardError);
  });

  it('refuses an entry that lies about its size', () => {
    const random = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251));
    expect(() => assertSafeZip(zipOf(random, 100))).toThrow(ZipGuardError);
  });

  it('refuses garbage', () => {
    expect(() => assertSafeZip(Buffer.from('not a zip at all, just text'))).toThrow(ZipGuardError);
  });
});

describe('CSV injection', () => {
  it.each(['=1+1', '+49 30', '-5', '@SUM(A1)', '\tx', '\rx'])('escapes %p', (v) => expect(csvSafe(v)).toBe(`'${v}`));
  it.each(['315/80R22.5', '16.9-28', 'Michelin', ''])('leaves %p alone', (v) => expect(csvSafe(v)).toBe(v));
  it('quotes separators and keeps a BOM for Excel', () => {
    expect(toCsv([['a,b', 'c"d', '=x']])).toBe('﻿"a,b","c""d",\'=x\r\n');
  });
});
