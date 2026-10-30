import { MigrationInterface, QueryRunner } from 'typeorm';

// Refresh tokens, stored only as a SHA-256 hash, one row per rotation step.
// users.token_version is carried in the access token: bumping it ends every
// access token of the user at once, without waiting for them to expire.
export class AddRefreshTokens1750000000013 implements MigrationInterface {
  name = 'AddRefreshTokens1750000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  VARCHAR(64)  NOT NULL,
        expires_at  TIMESTAMPTZ  NOT NULL,
        used_at     TIMESTAMPTZ,
        revoked_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id)`);
    await queryRunner.query(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS token_version`);
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens`);
  }
}
