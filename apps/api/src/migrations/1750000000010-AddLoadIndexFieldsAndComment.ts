import { MigrationInterface, QueryRunner } from 'typeorm';
import { parseLoadIndex } from '@tyreterra/tire-size';

// Parsed load index / speed / ply next to the free-text load_index (kept for
// display), and a seller comment. Existing load_index values are parsed with
// the same shared parser the app uses; what it cannot read stays null.
export class AddLoadIndexFieldsAndComment1750000000010 implements MigrationInterface {
  name = 'AddLoadIndexFieldsAndComment1750000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings
        ADD COLUMN IF NOT EXISTS load_index_single SMALLINT,
        ADD COLUMN IF NOT EXISTS speed_single      VARCHAR(3),
        ADD COLUMN IF NOT EXISTS load_index_dual   SMALLINT,
        ADD COLUMN IF NOT EXISTS speed_dual        VARCHAR(3),
        ADD COLUMN IF NOT EXISTS ply_rating        SMALLINT,
        ADD COLUMN IF NOT EXISTS comment           VARCHAR(500)
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_listings_ply ON listings(ply_rating)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_listings_load_single ON listings(load_index_single)`);

    const rows: { id: string; load_index: string }[] = await queryRunner.query(
      `SELECT id, load_index FROM listings WHERE load_index IS NOT NULL AND load_index <> ''`,
    );
    for (const { id, load_index } of rows) {
      const p = parseLoadIndex(load_index);
      await queryRunner.query(
        `UPDATE listings SET load_index_single = $2, speed_single = $3, load_index_dual = $4, speed_dual = $5, ply_rating = $6 WHERE id = $1`,
        [id, p.load_index_single, p.speed_single, p.load_index_dual, p.speed_dual, p.ply_rating],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_listings_load_single`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_listings_ply`);
    await queryRunner.query(`
      ALTER TABLE listings
        DROP COLUMN IF EXISTS comment,
        DROP COLUMN IF EXISTS ply_rating,
        DROP COLUMN IF EXISTS speed_dual,
        DROP COLUMN IF EXISTS load_index_dual,
        DROP COLUMN IF EXISTS speed_single,
        DROP COLUMN IF EXISTS load_index_single
    `);
  }
}
