import { MigrationInterface, QueryRunner } from 'typeorm';

// A listing can carry several sizes (e.g. "16.9-28 (440/80-28)"). Position 0
// is the main size and stays duplicated in listings.size_* for existing
// queries; search and suggestions read this table. (…0008 is taken by the
// paused feature/resend-email branch.)
export class AddListingSizes1750000000009 implements MigrationInterface {
  name = 'AddListingSizes1750000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE listing_sizes (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        listing_id        UUID         NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        position          SMALLINT     NOT NULL DEFAULT 0,
        size_raw          VARCHAR(30)  NOT NULL,
        size_format       VARCHAR(20)  NOT NULL,
        size_width        NUMERIC(8,2) NOT NULL,
        size_aspect_ratio NUMERIC(5,1),
        size_construction VARCHAR(1)   NOT NULL,
        size_rim          NUMERIC(5,1) NOT NULL,
        CONSTRAINT uq_listing_sizes_position UNIQUE (listing_id, position)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_listing_sizes_size ON listing_sizes(size_width, size_rim, size_construction)`);
    await queryRunner.query(`CREATE INDEX idx_listing_sizes_listing ON listing_sizes(listing_id)`);
    await queryRunner.query(`
      INSERT INTO listing_sizes (listing_id, position, size_raw, size_format, size_width, size_aspect_ratio, size_construction, size_rim)
      SELECT id, 0, size_raw, size_format, size_width, size_aspect_ratio, size_construction, size_rim
      FROM listings
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS listing_sizes`);
  }
}
