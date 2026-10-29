import { MigrationInterface, QueryRunner } from 'typeorm';

// Smart import: one batch per committed file (for the report and undo), the
// listings it created / updated / deactivated with a snapshot taken before
// each change, and each company's saved column mapping per header layout.
export class AddImportBatchesAndMappings1750000000011 implements MigrationInterface {
  name = 'AddImportBatchesAndMappings1750000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE import_batches (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id  UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
        segment     VARCHAR(10)  NOT NULL,
        status      VARCHAR(20)  NOT NULL DEFAULT 'completed',
        counts      JSONB        NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        undone_at   TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_import_batches_company ON import_batches(company_id, created_at)`);

    await queryRunner.query(`
      CREATE TABLE import_batch_items (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id    UUID         NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        listing_id  UUID         NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        action      VARCHAR(20)  NOT NULL,
        snapshot    JSONB
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_import_batch_items_batch ON import_batch_items(batch_id)`);

    await queryRunner.query(`
      CREATE TABLE import_mappings (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id        UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        header_signature  VARCHAR(64)  NOT NULL,
        mapping           JSONB        NOT NULL,
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT uq_import_mappings_company_signature UNIQUE (company_id, header_signature)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS import_mappings`);
    await queryRunner.query(`DROP TABLE IF EXISTS import_batch_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS import_batches`);
  }
}
