import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDealStatus1750000000005 implements MigrationInterface {
  name = 'AddDealStatus1750000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS status       VARCHAR(20) NOT NULL DEFAULT 'pending_pickup',
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
        DROP COLUMN IF EXISTS status,
        DROP COLUMN IF EXISTS completed_at;
    `);
  }
}
