import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkuToListings1750000000004 implements MigrationInterface {
  name = 'AddSkuToListings1750000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS sku VARCHAR(100)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE listings DROP COLUMN IF EXISTS sku`);
  }
}
