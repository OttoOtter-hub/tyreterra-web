import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoadIndexOriginCountry1750000000001 implements MigrationInterface {
  name = 'AddLoadIndexOriginCountry1750000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings
        ADD COLUMN IF NOT EXISTS load_index     VARCHAR(30),
        ADD COLUMN IF NOT EXISTS origin_country VARCHAR(100);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings
        DROP COLUMN IF EXISTS load_index,
        DROP COLUMN IF EXISTS origin_country;
    `);
  }
}
