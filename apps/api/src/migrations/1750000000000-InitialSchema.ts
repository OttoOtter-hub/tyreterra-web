import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1750000000000 implements MigrationInterface {
  name = 'InitialSchema1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── ENUMS ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE user_role     AS ENUM ('dealer', 'distributor', 'admin');
      CREATE TYPE user_status   AS ENUM ('pending', 'active', 'blocked');
      CREATE TYPE tire_segment  AS ENUM ('TBR', 'OTR', 'AGRI');
      CREATE TYPE tire_condition AS ENUM ('new', 'used', 'retreaded');
      CREATE TYPE listing_status AS ENUM ('active', 'inactive', 'expired');
      CREATE TYPE allowed_roles  AS ENUM ('all', 'dealer', 'distributor');
      CREATE TYPE request_status AS ENUM ('pending', 'offered', 'accepted', 'rejected', 'cancelled');
      CREATE TYPE offer_status   AS ENUM ('pending', 'accepted', 'rejected');
    `);

    // ── COMPANIES ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE companies (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                    VARCHAR(255) NOT NULL,
        country                 CHAR(2)      NOT NULL,
        vat_number              VARCHAR(30),
        vat_verified            BOOLEAN      NOT NULL DEFAULT false,
        vat_verified_at         TIMESTAMPTZ,
        short_description       VARCHAR(300),
        contact_email_encrypted TEXT,
        contact_phone_encrypted TEXT,
        created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ── USERS ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE users (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email           VARCHAR(255) NOT NULL UNIQUE,
        password_hash   TEXT         NOT NULL,
        role            user_role    NOT NULL DEFAULT 'dealer',
        status          user_status  NOT NULL DEFAULT 'pending',
        company_id      UUID         REFERENCES companies(id) ON DELETE SET NULL,
        gdpr_consent    BOOLEAN      NOT NULL DEFAULT false,
        gdpr_consent_at TIMESTAMPTZ,
        tos_accepted_at TIMESTAMPTZ,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_users_email      ON users(email);
      CREATE INDEX idx_users_company_id ON users(company_id);
      CREATE INDEX idx_users_status     ON users(status);
    `);

    // ── LISTINGS ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE listings (
        id                       UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id               UUID           NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        segment                  tire_segment   NOT NULL,
        brand                    VARCHAR(100)   NOT NULL,

        -- Parsed size fields (§4.2)
        size_format              VARCHAR(20)    NOT NULL,
        size_width               NUMERIC(8,2)   NOT NULL,
        size_aspect_ratio        NUMERIC(5,1),
        size_construction        CHAR(1)        NOT NULL,
        size_rim                 NUMERIC(5,1)   NOT NULL,
        size_raw                 VARCHAR(30)    NOT NULL,

        pattern                  VARCHAR(100),
        qty                      INTEGER        NOT NULL CHECK (qty >= 1),
        dot_code                 CHAR(4),
        location_country         CHAR(2)        NOT NULL,
        location_region          VARCHAR(100),
        condition                tire_condition NOT NULL,
        price_internal_encrypted TEXT,
        price_currency           CHAR(3),

        -- Visibility (§5.2)
        visible_regions          TEXT[],
        exclude_own_region       BOOLEAN        NOT NULL DEFAULT false,
        allowed_roles            allowed_roles  NOT NULL DEFAULT 'all',

        status                   listing_status NOT NULL DEFAULT 'active',
        expires_at               TIMESTAMPTZ    NOT NULL,
        created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      );

      -- Search indices (§4.4 — query on parsed components, not raw string)
      CREATE INDEX idx_listings_size    ON listings(size_width, size_rim, size_construction);
      CREATE INDEX idx_listings_segment ON listings(segment);
      CREATE INDEX idx_listings_brand   ON listings(brand);
      CREATE INDEX idx_listings_company ON listings(company_id);
      CREATE INDEX idx_listings_status  ON listings(status);
      CREATE INDEX idx_listings_expires ON listings(expires_at);
    `);

    // ── REQUESTS ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE requests (
        id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
        listing_id       UUID           NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        buyer_company_id UUID           NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        qty_requested    INTEGER        NOT NULL CHECK (qty_requested >= 1),
        comment          TEXT,
        status           request_status NOT NULL DEFAULT 'pending',
        created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_requests_listing ON requests(listing_id);
      CREATE INDEX idx_requests_buyer   ON requests(buyer_company_id);
      CREATE INDEX idx_requests_status  ON requests(status);
    `);

    // ── OFFERS ───────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE offers (
        id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id      UUID         NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
        price_encrypted TEXT         NOT NULL,
        currency        CHAR(3)      NOT NULL DEFAULT 'EUR',
        terms_text      TEXT,
        status          offer_status NOT NULL DEFAULT 'pending',
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ── DEALS ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE deals (
        id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        offer_id            UUID        NOT NULL UNIQUE REFERENCES offers(id) ON DELETE CASCADE,
        accepted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        contact_revealed_at TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── MESSAGES ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE messages (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id           UUID        NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        sender_company_id UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        body              TEXT        NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_messages_deal ON messages(deal_id, created_at);
    `);

    // ── RATINGS ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE ratings (
        id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id        UUID           NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
        response_rate     NUMERIC(5,4)   NOT NULL DEFAULT 0,
        accept_rate       NUMERIC(5,4)   NOT NULL DEFAULT 0,
        cancel_rate       NUMERIC(5,4)   NOT NULL DEFAULT 0,
        interaction_count INTEGER        NOT NULL DEFAULT 0,
        score             NUMERIC(3,1),
        calculated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      );
    `);

    // ── AUDIT LOG ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type  VARCHAR(100) NOT NULL,
        actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
        target_id   UUID,
        target_type VARCHAR(50),
        payload     JSONB       NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_audit_event_type  ON audit_log(event_type);
      CREATE INDEX idx_audit_actor       ON audit_log(actor_id);
      CREATE INDEX idx_audit_target      ON audit_log(target_id);
      CREATE INDEX idx_audit_created_at  ON audit_log(created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS audit_log   CASCADE;
      DROP TABLE IF EXISTS ratings     CASCADE;
      DROP TABLE IF EXISTS messages    CASCADE;
      DROP TABLE IF EXISTS deals       CASCADE;
      DROP TABLE IF EXISTS offers      CASCADE;
      DROP TABLE IF EXISTS requests    CASCADE;
      DROP TABLE IF EXISTS listings    CASCADE;
      DROP TABLE IF EXISTS users       CASCADE;
      DROP TABLE IF EXISTS companies   CASCADE;

      DROP TYPE IF EXISTS offer_status   CASCADE;
      DROP TYPE IF EXISTS request_status CASCADE;
      DROP TYPE IF EXISTS allowed_roles  CASCADE;
      DROP TYPE IF EXISTS listing_status CASCADE;
      DROP TYPE IF EXISTS tire_condition CASCADE;
      DROP TYPE IF EXISTS tire_segment   CASCADE;
      DROP TYPE IF EXISTS user_status    CASCADE;
      DROP TYPE IF EXISTS user_role      CASCADE;
    `);
  }
}
