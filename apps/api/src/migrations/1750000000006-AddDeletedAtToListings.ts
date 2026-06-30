import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeletedAtToListings1750000000006 implements MigrationInterface {
  name = 'AddDeletedAtToListings1750000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_listings_deleted_at ON listings(deleted_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_listings_deleted_at`);
    await queryRunner.query(`ALTER TABLE listings DROP COLUMN IF EXISTS deleted_at`);
  }
}
