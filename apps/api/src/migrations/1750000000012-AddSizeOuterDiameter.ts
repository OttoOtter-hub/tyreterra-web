import { MigrationInterface, QueryRunner } from 'typeorm';
import { parseTireSize } from '@tyreterra/tire-size';

const TABLES = ['listings', 'listing_sizes'];

// Outer diameter for "x" sizes (28x9-15), NULL for every other format. And
// inch widths written without the dot ("1800R25", "750-16"), stored so far
// as written (1800, 750), become inches (18, 7.5) like "18.00R25": a search
// for either spelling finds both. Existing sizes are re-read with the same
// shared parser the app uses (dotlessInchWidth); size_raw is kept.
export class AddSizeOuterDiameter1750000000012 implements MigrationInterface {
  name = 'AddSizeOuterDiameter1750000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const t of TABLES) {
      await queryRunner.query(`ALTER TABLE ${t} ADD COLUMN size_outer_diameter NUMERIC(5,2)`);

      // Only digits before R / "-" can be a dot-less width
      const rows: { id: string; size_raw: string; size_width: string }[] = await queryRunner.query(
        `SELECT id, size_raw, size_width FROM ${t}
         WHERE size_format IN ('radial_inch', 'diagonal_inch') AND size_raw ~ '^[0-9]+(R|-)'`,
      );
      for (const r of rows) {
        let width: number;
        try {
          width = parseTireSize(r.size_raw).size_width;
        } catch {
          continue;
        }
        if (width !== Number(r.size_width)) {
          await queryRunner.query(`UPDATE ${t} SET size_width = $1 WHERE id = $2`, [width, r.id]);
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of TABLES) {
      // Back to the width as written: the digits before R / "-" in size_raw
      await queryRunner.query(`
        UPDATE ${t} SET size_width = substring(size_raw from '^([0-9]+)(?:R|-)')::numeric
        WHERE size_format IN ('radial_inch', 'diagonal_inch') AND size_raw ~ '^[0-9]+(R|-)'
          AND size_width <> substring(size_raw from '^([0-9]+)(?:R|-)')::numeric`);
      await queryRunner.query(`ALTER TABLE ${t} DROP COLUMN size_outer_diameter`);
    }
  }
}
