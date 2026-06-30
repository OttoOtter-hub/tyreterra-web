// Must run before AppModule is imported below: JwtModule.register() in
// auth.module.ts reads process.env.JWT_SECRET synchronously at import time
// (unlike JwtStrategy's constructor, which reads it later at DI-instantiation
// time, after ConfigModule has loaded the env file). Without pre-loading the
// right env file here ourselves — exactly like main.ts does — the two would
// observe different env states and sign/verify with mismatched secrets.
import * as dotenv from 'dotenv';
const envFile = process.env.APP_ENV === 'staging' ? '.env.staging' : '.env';
dotenv.config({ path: envFile });

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../app.module';
import { User, UserRole, UserStatus } from '../auth/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { Listing } from '../listings/entities/listing.entity';
import { EncryptionService } from '../common/encryption.service';

// Integration tests against a real (staging) database — run with:
//   APP_ENV=staging npm test
// Covers the highest-blast-radius regressions: price leaking to non-owners,
// soft delete not filtering, auth bypass, contact info leaking pre-deal,
// and the auth rate limiter from the hardening sprint.
jest.setTimeout(30_000);

describe('Critical paths (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let jwt: JwtService;
  let userRepo: Repository<User>;
  let companyRepo: Repository<Company>;
  let listingRepo: Repository<Listing>;
  let encryption: EncryptionService;

  const createdUserIds: string[] = [];
  const createdCompanyIds: string[] = [];
  const createdListingIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    httpServer = app.getHttpServer();

    jwt = moduleRef.get(JwtService);
    userRepo = moduleRef.get(getRepositoryToken(User));
    companyRepo = moduleRef.get(getRepositoryToken(Company));
    listingRepo = moduleRef.get(getRepositoryToken(Listing));
    encryption = moduleRef.get(EncryptionService);
  });

  afterAll(async () => {
    if (createdListingIds.length) await listingRepo.delete(createdListingIds);
    if (createdUserIds.length) await userRepo.delete(createdUserIds);
    if (createdCompanyIds.length) await companyRepo.delete(createdCompanyIds);
    await app.close();
  });

  // Creates an ACTIVE user + company directly via the repository (bypasses
  // /auth/register and the admin approval queue — and crucially does NOT
  // touch the throttled /auth/login endpoint, so test setup never eats into
  // the rate-limit budget the last test deliberately exhausts).
  async function makeActiveUser(opts: { contactEmail?: string } = {}) {
    const company = await companyRepo.save(
      companyRepo.create({
        name: `Test Co ${randomUUID()}`,
        country: 'DE',
        contact_email_encrypted: opts.contactEmail ? encryption.encrypt(opts.contactEmail) : null,
      }),
    );
    createdCompanyIds.push(company.id);

    const user = await userRepo.save(
      userRepo.create({
        email: `test-${randomUUID()}@example.com`,
        password_hash: await bcrypt.hash('TestPass123!', 4),
        role: UserRole.DEALER,
        status: UserStatus.ACTIVE,
        company_id: company.id,
        gdpr_consent: true,
        gdpr_consent_at: new Date(),
        tos_accepted_at: new Date(),
      }),
    );
    createdUserIds.push(user.id);

    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { user, company, token };
  }

  const baseListing = {
    segment: 'TBR',
    brand: 'CriticalPathTest',
    size: '315/80R22.5',
    qty: 10,
    condition: 'new',
    location_country: 'DE',
  };

  // ── 1. Price encryption/visibility ────────────────────────────────────────
  describe('Price visibility', () => {
    it('never returns price fields to a non-owner in search or single-listing responses', async () => {
      const seller = await makeActiveUser();
      const buyer = await makeActiveUser();

      const createRes = await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ ...baseListing, price: 999.99, currency: 'EUR' })
        .expect(201);

      const listingId = createRes.body.id;
      createdListingIds.push(listingId);

      const searchRes = await request(httpServer)
        .get('/api/listings')
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      const searchBody = JSON.stringify(searchRes.body);
      expect(searchBody).not.toContain('price_internal_encrypted');
      expect(searchBody).not.toContain('999.99');

      const oneRes = await request(httpServer)
        .get(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      const oneBody = JSON.stringify(oneRes.body);
      expect(oneBody).not.toContain('price_internal_encrypted');
      expect(oneBody).not.toContain('999.99');
    });
  });

  // ── 2. Soft delete ─────────────────────────────────────────────────────────
  describe('Soft delete', () => {
    it('sets deleted_at + status=inactive instead of removing the row, and hides it from all reads', async () => {
      const seller = await makeActiveUser();

      const createRes = await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send(baseListing)
        .expect(201);
      const listingId = createRes.body.id;
      createdListingIds.push(listingId);

      await request(httpServer)
        .delete(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);

      const row = await listingRepo.findOneBy({ id: listingId });
      expect(row).not.toBeNull();
      expect(row!.deleted_at).not.toBeNull();
      expect(row!.status).toBe('inactive');

      const mineRes = await request(httpServer)
        .get('/api/listings/mine')
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);
      expect(mineRes.body.find((l: { id: string }) => l.id === listingId)).toBeUndefined();

      const searchRes = await request(httpServer)
        .get('/api/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);
      expect(searchRes.body.data.find((l: { id: string }) => l.id === listingId)).toBeUndefined();

      await request(httpServer)
        .get(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(404);
    });
  });

  // ── 3. Auth ─────────────────────────────────────────────────────────────────
  describe('Auth guards', () => {
    it('rejects an unauthenticated POST /listings with 401', async () => {
      await request(httpServer)
        .post('/api/listings')
        .send(baseListing)
        .expect(401);
    });

    it('rejects login for a pending account without issuing a JWT', async () => {
      const company = await companyRepo.save(
        companyRepo.create({ name: `Pending Co ${randomUUID()}`, country: 'DE' }),
      );
      createdCompanyIds.push(company.id);
      const email = `pending-${randomUUID()}@example.com`;
      const user = await userRepo.save(
        userRepo.create({
          email,
          password_hash: await bcrypt.hash('TestPass123!', 4),
          role: UserRole.DEALER,
          status: UserStatus.PENDING,
          company_id: company.id,
          gdpr_consent: true,
          gdpr_consent_at: new Date(),
          tos_accepted_at: new Date(),
        }),
      );
      createdUserIds.push(user.id);

      const res = await request(httpServer)
        .post('/api/auth/login')
        .send({ email, password: 'TestPass123!' });

      expect(res.status).toBe(403);
      expect(res.body.access_token).toBeUndefined();
    });

    it('rejects login for a blocked account without issuing a JWT', async () => {
      const company = await companyRepo.save(
        companyRepo.create({ name: `Blocked Co ${randomUUID()}`, country: 'DE' }),
      );
      createdCompanyIds.push(company.id);
      const email = `blocked-${randomUUID()}@example.com`;
      const user = await userRepo.save(
        userRepo.create({
          email,
          password_hash: await bcrypt.hash('TestPass123!', 4),
          role: UserRole.DEALER,
          status: UserStatus.BLOCKED,
          company_id: company.id,
          gdpr_consent: true,
          gdpr_consent_at: new Date(),
          tos_accepted_at: new Date(),
        }),
      );
      createdUserIds.push(user.id);

      const res = await request(httpServer)
        .post('/api/auth/login')
        .send({ email, password: 'TestPass123!' });

      expect(res.status).toBe(403);
      expect(res.body.access_token).toBeUndefined();
    });
  });

  // ── 4. Deal contact reveal ────────────────────────────────────────────────
  describe('Deal contact reveal', () => {
    it('hides company contact details until the deal is accepted, then reveals them', async () => {
      const seller = await makeActiveUser({ contactEmail: 'seller-contact@example.com' });
      const buyer = await makeActiveUser({ contactEmail: 'buyer-contact@example.com' });

      const listingRes = await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send(baseListing)
        .expect(201);
      const listingId = listingRes.body.id;
      createdListingIds.push(listingId);

      const reqRes = await request(httpServer)
        .post('/api/requests')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ listing_id: listingId, qty_requested: 5 })
        .expect(201);
      const requestId = reqRes.body.id;

      // Before any offer exists
      const beforeRes = await request(httpServer)
        .get(`/api/requests/${requestId}`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      expect(JSON.stringify(beforeRes.body)).not.toContain('seller-contact@example.com');

      // Seller sends an offer
      await request(httpServer)
        .post(`/api/requests/${requestId}/offer`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ price: 500, currency: 'EUR' })
        .expect(201);

      // Offer exists but not yet accepted — still hidden
      const offeredRes = await request(httpServer)
        .get(`/api/requests/${requestId}`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      expect(JSON.stringify(offeredRes.body)).not.toContain('seller-contact@example.com');

      // Buyer accepts — contacts are revealed in the accept response
      const acceptRes = await request(httpServer)
        .post(`/api/requests/${requestId}/offer/accept`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(201);

      expect(acceptRes.body.seller.email).toBe('seller-contact@example.com');
      expect(acceptRes.body.buyer.email).toBe('buyer-contact@example.com');
    });
  });

  // ── 5. Rate limiting ──────────────────────────────────────────────────────
  // Runs last and in isolation: every prior test in this file authenticates
  // via signed JWTs (see makeActiveUser), never via POST /auth/login, so
  // nothing here has already spent part of the per-IP login quota.
  describe('Rate limiting', () => {
    it('returns 429 after exceeding the login attempt threshold (5 / 15 min)', async () => {
      const email = `ratelimit-${randomUUID()}@example.com`;
      let last: request.Response | undefined;
      for (let i = 0; i < 6; i++) {
        last = await request(httpServer)
          .post('/api/auth/login')
          .send({ email, password: 'WrongPassword1' });
      }
      expect(last!.status).toBe(429);
    });
  });
});
