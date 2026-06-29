import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPcrMhSegmentsAndTireType1750000000003 implements MigrationInterface {
  name = 'AddPcrMhSegmentsAndTireType1750000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new enum values (Postgres requires adding one at a time)
    await queryRunner.query(`ALTER TYPE tire_segment ADD VALUE IF NOT EXISTS 'PCR'`);
    await queryRunner.query(`ALTER TYPE tire_segment ADD VALUE IF NOT EXISTS 'MH'`);

    await queryRunner.query(`
      ALTER TABLE listings
        ADD COLUMN IF NOT EXISTS tire_type VARCHAR(30);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE listings DROP COLUMN IF EXISTS tire_type`);
    // Note: Postgres does not support removing enum values without recreating the type
  }
}
