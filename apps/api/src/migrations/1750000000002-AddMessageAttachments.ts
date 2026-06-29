import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageAttachments1750000000002 implements MigrationInterface {
  name = 'AddMessageAttachments1750000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
        ALTER COLUMN body DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS file_url  VARCHAR(500),
        ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
        ALTER COLUMN body SET NOT NULL,
        DROP COLUMN IF EXISTS file_url,
        DROP COLUMN IF EXISTS file_name;
    `);
  }
}
