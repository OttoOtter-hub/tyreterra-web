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
import { DataSource, Repository } from 'typeorm';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../app.module';
import { User, UserRole, UserStatus } from '../auth/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { Listing } from '../listings/entities/listing.entity';
import { EncryptionService } from '../common/encryption.service';

// Integration tests against a real, disposable database (e.g. the local
// docker-compose Postgres), never staging or production. The schema is built
// by running the migrations (synchronize is off everywhere), then:
//   npm test
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

    // Same path as production: build the schema with migrations, not synchronize
    await moduleRef.get(DataSource).runMigrations();

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
  async function makeActiveUser(opts: { contactEmail?: string; country?: string; role?: UserRole } = {}) {
    const company = await companyRepo.save(
      companyRepo.create({
        name: `Test Co ${randomUUID()}`,
        country: opts.country ?? 'DE',
        contact_email_encrypted: opts.contactEmail ? encryption.encrypt(opts.contactEmail) : null,
      }),
    );
    createdCompanyIds.push(company.id);

    const user = await userRepo.save(
      userRepo.create({
        email: `test-${randomUUID()}@example.com`,
        password_hash: await bcrypt.hash('TestPass123!', 4),
        role: opts.role ?? UserRole.DEALER,
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

  // ── 5. Listing visibility ─────────────────────────────────────────────────
  // One rule (listing-visibility.ts) for the catalogue, GET /listings/:id,
  // owner actions and creating a request; a hidden listing is always 404.
  describe('Listing visibility', () => {
    const brand = `Visibility-${randomUUID().slice(0, 8)}`;

    async function listingOf(seller: { token: string }, extra: Record<string, unknown> = {}) {
      const res = await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ ...baseListing, brand, ...extra })
        .expect(201);
      createdListingIds.push(res.body.id);
      return res.body.id as string;
    }

    const get = (token: string, id: string) =>
      request(httpServer).get(`/api/listings/${id}`).set('Authorization', `Bearer ${token}`);
    const inCatalogue = async (token: string, id: string) =>
      (await request(httpServer).get('/api/listings').query({ brand, limit: 100 })
        .set('Authorization', `Bearer ${token}`).expect(200)).body.data.some((r: { id: string }) => r.id === id);
    const requestFor = (token: string, id: string) =>
      request(httpServer).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ listing_id: id, qty_requested: 1 });

    // Hidden from `viewer` everywhere, while the owner keeps it
    async function expectHidden(owner: { token: string }, viewer: { token: string }, id: string) {
      await get(viewer.token, id).expect(404);
      expect(await inCatalogue(viewer.token, id)).toBe(false);
      await requestFor(viewer.token, id).expect(404);
      await request(httpServer).patch(`/api/listings/${id}`).set('Authorization', `Bearer ${viewer.token}`).send({ qty: 1 }).expect(404);
      await request(httpServer).post(`/api/listings/${id}/deactivate`).set('Authorization', `Bearer ${viewer.token}`).expect(404);
      await request(httpServer).delete(`/api/listings/${id}`).set('Authorization', `Bearer ${viewer.token}`).expect(404);
      await get(owner.token, id).expect(200);
    }

    async function expectVisible(viewer: { token: string }, id: string) {
      await get(viewer.token, id).expect(200);
      expect(await inCatalogue(viewer.token, id)).toBe(true);
    }

    it('hides a listing from companies in the seller country when exclude_own_region is set', async () => {
      const seller = await makeActiveUser({ country: 'DE' });
      const id = await listingOf(seller, { exclude_own_region: true });
      await expectHidden(seller, await makeActiveUser({ country: 'DE' }), id);
      await expectVisible(await makeActiveUser({ country: 'PL' }), id);
    });

    it('limits a listing to visible_regions', async () => {
      const seller = await makeActiveUser({ country: 'DE' });
      const id = await listingOf(seller, { visible_regions: ['PL', 'CZ'] });
      await expectHidden(seller, await makeActiveUser({ country: 'FR' }), id);
      await expectVisible(await makeActiveUser({ country: 'CZ' }), id);
      await requestFor((await makeActiveUser({ country: 'PL' })).token, id).expect(201);
    });

    it('limits a listing to allowed_roles', async () => {
      const seller = await makeActiveUser();
      const id = await listingOf(seller, { allowed_roles: 'distributor' });
      await expectHidden(seller, await makeActiveUser({ role: UserRole.DEALER }), id);
      await expectVisible(await makeActiveUser({ role: UserRole.DISTRIBUTOR }), id);
    });

    it('shows an inactive or expired listing to its owner only', async () => {
      const seller = await makeActiveUser();
      const inactive = await listingOf(seller);
      await request(httpServer).post(`/api/listings/${inactive}/deactivate`).set('Authorization', `Bearer ${seller.token}`).expect(201);
      await expectHidden(seller, await makeActiveUser(), inactive);

      const expired = await listingOf(seller);
      await listingRepo.update(expired, { expires_at: new Date(Date.now() - 60_000) });
      await expectHidden(seller, await makeActiveUser(), expired);

      // The owner can still act on them
      await request(httpServer).post(`/api/listings/${inactive}/activate`).set('Authorization', `Bearer ${seller.token}`).expect(201);
      await request(httpServer).post(`/api/listings/${expired}/renew`).set('Authorization', `Bearer ${seller.token}`).expect(201);
      await expectVisible(await makeActiveUser(), inactive);
      await expectVisible(await makeActiveUser(), expired);
    });

    it('answers 404 for an unknown id and 403 only for a visible listing that is not yours', async () => {
      const seller = await makeActiveUser();
      const other = await makeActiveUser({ country: 'PL' });
      await get(other.token, randomUUID()).expect(404);
      const id = await listingOf(seller);
      await request(httpServer).patch(`/api/listings/${id}`).set('Authorization', `Bearer ${other.token}`).send({ qty: 1 }).expect(403);
    });

    it('never returns the seller company to others, only its country', async () => {
      const seller = await makeActiveUser({ country: 'DE' });
      const id = await listingOf(seller);
      const res = await get((await makeActiveUser({ country: 'PL' })).token, id).expect(200);
      expect(res.body.company).toBeUndefined();
      expect(res.body.seller_country).toBe('DE');
      expect(JSON.stringify(res.body)).not.toContain(seller.company.name);
      expect((await get(seller.token, id).expect(200)).body.company.name).toBe(seller.company.name);
    });

    it('keeps an existing request, offer and deal readable for both parties after the listing is hidden', async () => {
      const seller = await makeActiveUser({ country: 'DE' });
      const buyer = await makeActiveUser({ country: 'PL' });
      const id = await listingOf(seller);
      const req = await requestFor(buyer.token, id).expect(201);
      await request(httpServer).post(`/api/requests/${req.body.id}/offer`).set('Authorization', `Bearer ${seller.token}`)
        .send({ price: 100, currency: 'EUR' }).expect(201);

      await request(httpServer).post(`/api/listings/${id}/deactivate`).set('Authorization', `Bearer ${seller.token}`).expect(201);
      await get(buyer.token, id).expect(404);
      for (const t of [buyer.token, seller.token]) {
        const r = await request(httpServer).get(`/api/requests/${req.body.id}`).set('Authorization', `Bearer ${t}`).expect(200);
        expect(r.body.listing.id).toBe(id);
      }
      // A stranger still cannot read the request
      await request(httpServer).get(`/api/requests/${req.body.id}`)
        .set('Authorization', `Bearer ${(await makeActiveUser()).token}`).expect(403);
    });
  });

  // ── 6. Rate limiting ──────────────────────────────────────────────────────
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
