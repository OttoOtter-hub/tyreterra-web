import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListingExpiryNotices1750000000008 implements MigrationInterface {
  name = 'AddListingExpiryNotices1750000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings
        ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS expired_notice_sent_at  TIMESTAMPTZ;

      -- Listings that expired before notifications existed are marked as
      -- already notified, so the first nightly run does not mail old news.
      UPDATE listings
         SET expiry_reminder_sent_at = NOW(),
             expired_notice_sent_at  = NOW()
       WHERE expires_at <= NOW();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings
        DROP COLUMN IF EXISTS expired_notice_sent_at,
        DROP COLUMN IF EXISTS expiry_reminder_sent_at;
    `);
  }
}
