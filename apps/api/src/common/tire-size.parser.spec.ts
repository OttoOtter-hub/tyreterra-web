import { parseTireSize, TireSizeParseError } from './tire-size.parser';

describe('parseTireSize', () => {
  // ─── §4.1 Format: Metric radial ──────────────────────────────────────────
  describe('metric radial (TBR / AGRI)', () => {
    it('parses 315/80R22.5', () => {
      expect(parseTireSize('315/80R22.5')).toMatchObject({
        format: 'metric',
        size_width: 315,
        size_aspect_ratio: 80,
        size_construction: 'R',
        size_rim: 22.5,
        size_raw: '315/80R22.5',
      });
    });

    it('parses 285/75R24.5', () => {
      expect(parseTireSize('285/75R24.5')).toMatchObject({
        format: 'metric',
        size_width: 285,
        size_aspect_ratio: 75,
        size_construction: 'R',
        size_rim: 24.5,
      });
    });

    it('parses 385/65R22.5', () => {
      expect(parseTireSize('385/65R22.5')).toMatchObject({
        format: 'metric',
        size_width: 385,
        size_aspect_ratio: 65,
        size_construction: 'R',
        size_rim: 22.5,
      });
    });

    it('parses integer rim 315/80R22 (no decimal)', () => {
      expect(parseTireSize('315/80R22')).toMatchObject({
        format: 'metric',
        size_rim: 22,
      });
    });
  });

  // ─── §4.1 Format: Flotation / Wide ───────────────────────────────────────
  describe('flotation / wide (AGRI)', () => {
    it('parses 710/70R42', () => {
      expect(parseTireSize('710/70R42')).toMatchObject({
        format: 'flotation',
        size_width: 710,
        size_aspect_ratio: 70,
        size_construction: 'R',
        size_rim: 42,
        size_raw: '710/70R42',
      });
    });

    it('parses 600/65R38', () => {
      expect(parseTireSize('600/65R38')).toMatchObject({
        format: 'flotation',
        size_width: 600,
        size_aspect_ratio: 65,
        size_rim: 38,
      });
    });

    it('parses 800/70R32', () => {
      expect(parseTireSize('800/70R32')).toMatchObject({
        format: 'flotation',
        size_width: 800,
      });
    });
  });

  // ─── §4.1 Format: Diagonal inch ──────────────────────────────────────────
  describe('diagonal inch (TBR old fleet / OTR)', () => {
    it('parses 10.00-20', () => {
      expect(parseTireSize('10.00-20')).toMatchObject({
        format: 'diagonal_inch',
        size_width: 10,
        size_aspect_ratio: null,
        size_construction: '-',
        size_rim: 20,
        size_raw: '10.00-20',
      });
    });

    it('parses 9.00-20', () => {
      expect(parseTireSize('9.00-20')).toMatchObject({
        format: 'diagonal_inch',
        size_width: 9,
        size_aspect_ratio: null,
        size_construction: '-',
        size_rim: 20,
      });
    });

    it('parses 11.00-22', () => {
      expect(parseTireSize('11.00-22')).toMatchObject({
        format: 'diagonal_inch',
        size_width: 11,
        size_rim: 22,
      });
    });

    it('parses integer width 12-20', () => {
      expect(parseTireSize('12-20')).toMatchObject({
        format: 'diagonal_inch',
        size_width: 12,
        size_rim: 20,
      });
    });
  });

  // ─── §4.1 Format: Radial inch ────────────────────────────────────────────
  describe('radial inch (AGRI)', () => {
    it('parses 14.9R28', () => {
      expect(parseTireSize('14.9R28')).toMatchObject({
        format: 'radial_inch',
        size_width: 14.9,
        size_aspect_ratio: null,
        size_construction: 'R',
        size_rim: 28,
        size_raw: '14.9R28',
      });
    });

    it('parses 12.4R28', () => {
      expect(parseTireSize('12.4R28')).toMatchObject({
        format: 'radial_inch',
        size_width: 12.4,
        size_rim: 28,
      });
    });
  });

  // ─── §4.1 Format: Large OTR ──────────────────────────────────────────────
  describe('large OTR (classified as radial_inch)', () => {
    it('parses 23.5R25', () => {
      expect(parseTireSize('23.5R25')).toMatchObject({
        format: 'radial_inch',
        size_width: 23.5,
        size_aspect_ratio: null,
        size_construction: 'R',
        size_rim: 25,
        size_raw: '23.5R25',
      });
    });

    it('parses 29.5R25', () => {
      expect(parseTireSize('29.5R25')).toMatchObject({
        format: 'radial_inch',
        size_width: 29.5,
        size_rim: 25,
      });
    });
  });

  // ─── §4.3 Spacing normalisation ──────────────────────────────────────────
  describe('spacing normalisation', () => {
    it('strips space between aspect ratio and R: "315/80 R22.5"', () => {
      expect(parseTireSize('315/80 R22.5')).toMatchObject({
        format: 'metric',
        size_width: 315,
        size_rim: 22.5,
        size_raw: '315/80R22.5',
      });
    });

    it('strips multiple spaces: "315/80 R 22.5"', () => {
      expect(parseTireSize('315/80 R 22.5')).toMatchObject({
        format: 'metric',
        size_raw: '315/80R22.5',
      });
    });

    it('handles leading/trailing whitespace', () => {
      expect(parseTireSize('  14.9R28  ')).toMatchObject({
        format: 'radial_inch',
        size_width: 14.9,
      });
    });

    it('is case-insensitive for R: "315/80r22.5"', () => {
      expect(parseTireSize('315/80r22.5')).toMatchObject({
        format: 'metric',
        size_construction: 'R',
      });
    });
  });

  // ─── Invalid input ────────────────────────────────────────────────────────
  describe('invalid input', () => {
    it('throws TireSizeParseError for arbitrary string', () => {
      expect(() => parseTireSize('not-a-tire')).toThrow(TireSizeParseError);
    });

    it('throws for empty string', () => {
      expect(() => parseTireSize('')).toThrow(TireSizeParseError);
    });

    it('throws for whitespace-only string', () => {
      expect(() => parseTireSize('   ')).toThrow(TireSizeParseError);
    });

    it('throws for partial metric format "315/R22.5" (missing aspect)', () => {
      expect(() => parseTireSize('315/R22.5')).toThrow(TireSizeParseError);
    });

    it('error message lists supported formats', () => {
      try {
        parseTireSize('abc');
      } catch (e) {
        expect(e).toBeInstanceOf(TireSizeParseError);
        expect((e as Error).message).toContain('315/80R22.5');
        expect((e as Error).message).toContain('10.00-20');
      }
    });
  });
});
