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
import { DataSource, IsNull, Repository } from 'typeorm';
import * as request from 'supertest';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../app.module';
import { User, UserRole, UserStatus } from '../auth/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ListingSize } from '../listings/entities/listing-size.entity';
import { EncryptionService } from '../common/encryption.service';
import { SECRET_FIELDS } from '../common/serializers';
import { applyBodyLimits } from '../body-limits';
import { corsOptions } from '../cors';
import { ImportBatch } from '../listings/import/import.entities';
import { SessionsService } from '../auth/sessions.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';
import { REFRESH_COOKIE } from '../auth/refresh-cookie';
import { deflateRawSync } from 'zlib';
import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';

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
  let sizeRepo: Repository<ListingSize>;
  let batchRepo: Repository<ImportBatch>;
  let encryption: EncryptionService;
  let sessions: SessionsService;

  const createdUserIds: string[] = [];
  const createdCompanyIds: string[] = [];
  const createdListingIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Same path as production: build the schema with migrations, not synchronize
    await moduleRef.get(DataSource).runMigrations();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix('api');
    applyBodyLimits(app);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.enableCors(corsOptions());
    await app.init();
    httpServer = app.getHttpServer();

    jwt = moduleRef.get(JwtService);
    userRepo = moduleRef.get(getRepositoryToken(User));
    companyRepo = moduleRef.get(getRepositoryToken(Company));
    listingRepo = moduleRef.get(getRepositoryToken(Listing));
    sizeRepo = moduleRef.get(getRepositoryToken(ListingSize));
    batchRepo = moduleRef.get(getRepositoryToken(ImportBatch));
    encryption = moduleRef.get(EncryptionService);
    sessions = moduleRef.get(SessionsService);
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
  async function makeActiveUser(opts: { contactEmail?: string; contactPhone?: string; country?: string; role?: UserRole } = {}) {
    const company = await companyRepo.save(
      companyRepo.create({
        name: `Test Co ${randomUUID()}`,
        country: opts.country ?? 'DE',
        contact_email_encrypted: opts.contactEmail ? encryption.encrypt(opts.contactEmail) : null,
        contact_phone_encrypted: opts.contactPhone ? encryption.encrypt(opts.contactPhone) : null,
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

  // ── 6. Secret fields in responses ─────────────────────────────────────────
  // Every endpoint that returns a listing (or a request, offer, deal or
  // company around it) goes through common/serializers.ts. None may carry a
  // SECRET_FIELDS key or a ciphertext value; the internal price reaches only
  // the listing owner, the offer price only the two parties, contacts only
  // the accept response.
  describe('Secret fields in responses', () => {
    const CIPHERTEXT = /[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+/;
    const PRICE = 777.77;
    const OFFER_PRICE = 555.55;
    const CONTACTS = ['seller-secret@example.com', '+49 111 222', 'buyer-secret@example.com', '+48 333 444'];

    function secretKeys(value: unknown, path = '$'): string[] {
      if (Array.isArray(value)) return value.flatMap((v, i) => secretKeys(v, `${path}[${i}]`));
      if (!value || typeof value !== 'object') return [];
      return Object.entries(value).flatMap(([k, v]) => [
        ...((SECRET_FIELDS as readonly string[]).includes(k) || k.endsWith('_encrypted') ? [`${path}.${k}`] : []),
        ...secretKeys(v, `${path}.${k}`),
      ]);
    }

    type Check = { label: string; res: request.Response; ownerPrice?: boolean; offerPrice?: boolean; contacts?: boolean };

    function expectClean({ label, res, ownerPrice = false, offerPrice = false, contacts = false }: Check) {
      expect({ label, ok: res.status < 300 }).toEqual({ label, ok: true });
      const text = JSON.stringify(res.body);
      expect({ label, keys: secretKeys(res.body) }).toEqual({ label, keys: [] });
      expect({ label, ciphertext: CIPHERTEXT.test(text) }).toEqual({ label, ciphertext: false });
      if (!ownerPrice) expect({ label, price: text.includes(String(PRICE)) }).toEqual({ label, price: false });
      if (!offerPrice) expect({ label, offer: text.includes(String(OFFER_PRICE)) }).toEqual({ label, offer: false });
      if (!contacts) {
        for (const c of CONTACTS) expect({ label, contact: text.includes(c) }).toEqual({ label, contact: false });
      }
    }

    it('keeps ciphertext, the internal price and contacts out of every listing-returning endpoint', async () => {
      const seller = await makeActiveUser({ country: 'DE', contactEmail: CONTACTS[0], contactPhone: CONTACTS[1] });
      const buyer = await makeActiveUser({ country: 'PL', contactEmail: CONTACTS[2], contactPhone: CONTACTS[3] });
      const admin = await makeActiveUser({ role: UserRole.ADMIN });
      const as = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
      const brand = `Secrets-${randomUUID().slice(0, 8)}`;
      const checks: Check[] = [];

      const newListing = async () => {
        const res = await request(httpServer).post('/api/listings').set(as(seller))
          .send({ ...baseListing, brand, price: PRICE, currency: 'USD' });
        createdListingIds.push(res.body.id);
        return res;
      };
      const created = await newListing();
      checks.push({ label: 'POST /listings (owner)', res: created, ownerPrice: true });
      const id = created.body.id as string;

      // The owner gets the internal price decrypted, as price / currency
      const ownerOne = await request(httpServer).get(`/api/listings/${id}`).set(as(seller));
      expect(ownerOne.body.price).toBe(PRICE);
      expect(ownerOne.body.currency).toBe('USD');
      checks.push(
        { label: 'GET /listings/:id (owner)', res: ownerOne, ownerPrice: true },
        { label: 'GET /listings/mine', res: await request(httpServer).get('/api/listings/mine').set(as(seller)), ownerPrice: true },
        { label: 'PATCH /listings/:id (owner)', res: await request(httpServer).patch(`/api/listings/${id}`).set(as(seller)).send({ qty: 12 }), ownerPrice: true },
        { label: 'POST /listings/:id/renew', res: await request(httpServer).post(`/api/listings/${id}/renew`).set(as(seller)), ownerPrice: true },
        { label: 'GET /listings (owner)', res: await request(httpServer).get('/api/listings').query({ brand }).set(as(seller)) },
        { label: 'GET /listings (buyer)', res: await request(httpServer).get('/api/listings').query({ brand }).set(as(buyer)) },
        { label: 'GET /listings/:id (buyer)', res: await request(httpServer).get(`/api/listings/${id}`).set(as(buyer)) },
        { label: 'GET /listings/:id (admin)', res: await request(httpServer).get(`/api/listings/${id}`).set(as(admin)) },
      );

      // Request → offer → accept → deal
      const req = await request(httpServer).post('/api/requests').set(as(buyer)).send({ listing_id: id, qty_requested: 2 });
      checks.push({ label: 'POST /requests', res: req });
      const requestId = req.body.id as string;
      checks.push(
        { label: 'POST /requests/:id/offer (seller)', res: await request(httpServer).post(`/api/requests/${requestId}/offer`).set(as(seller)).send({ price: OFFER_PRICE, currency: 'EUR' }), offerPrice: true },
        { label: 'GET /requests/:id/offer (buyer)', res: await request(httpServer).get(`/api/requests/${requestId}/offer`).set(as(buyer)), offerPrice: true },
        { label: 'GET /requests/outgoing (buyer)', res: await request(httpServer).get('/api/requests/outgoing').set(as(buyer)), offerPrice: true },
        { label: 'GET /requests/incoming (seller)', res: await request(httpServer).get('/api/requests/incoming').set(as(seller)), ownerPrice: true },
        { label: 'GET /requests/:id (buyer)', res: await request(httpServer).get(`/api/requests/${requestId}`).set(as(buyer)), offerPrice: true },
      );
      const sellerRequest = await request(httpServer).get(`/api/requests/${requestId}`).set(as(seller));
      expect(sellerRequest.body.listing_price).toBe(PRICE);
      checks.push({ label: 'GET /requests/:id (seller)', res: sellerRequest, ownerPrice: true, offerPrice: true });

      // Contacts are revealed by accepting, and only there
      const accept = await request(httpServer).post(`/api/requests/${requestId}/offer/accept`).set(as(buyer));
      expect(accept.body.seller.email).toBe(CONTACTS[0]);
      checks.push({ label: 'POST /requests/:id/offer/accept', res: accept, contacts: true });
      const dealId = accept.body.deal_id as string;

      for (const [who, user] of [['buyer', buyer], ['seller', seller]] as const) {
        const deals = await request(httpServer).get('/api/deals').set(as(user));
        expect(deals.body.find((d: { id: string }) => d.id === dealId).offer.price).toBe(OFFER_PRICE);
        checks.push(
          { label: `GET /deals (${who})`, res: deals, offerPrice: true, ownerPrice: who === 'seller' },
          { label: `GET /deals/:id (${who})`, res: await request(httpServer).get(`/api/deals/${dealId}`).set(as(user)), offerPrice: true, ownerPrice: who === 'seller' },
        );
      }
      checks.push({ label: 'POST /deals/:id/confirm-receipt', res: await request(httpServer).post(`/api/deals/${dealId}/confirm-receipt`).set(as(buyer)), offerPrice: true });

      // A second request, declined by the seller (the response carries the listing)
      const id2 = (await newListing()).body.id as string;
      const req2 = await request(httpServer).post('/api/requests').set(as(buyer)).send({ listing_id: id2, qty_requested: 1 });
      checks.push({ label: 'POST /requests/:id/decline', res: await request(httpServer).post(`/api/requests/${req2.body.id}/decline`).set(as(seller)), ownerPrice: true });

      // Companies on their own
      checks.push({ label: 'GET /auth/me', res: await request(httpServer).get('/api/auth/me').set(as(seller)) });
      await userRepo.update(buyer.user.id, { status: UserStatus.PENDING });
      checks.push(
        { label: 'GET /admin/users/pending', res: await request(httpServer).get('/api/admin/users/pending').set(as(admin)) },
        { label: 'POST /admin/companies/:id/vat-verify', res: await request(httpServer).post(`/api/admin/companies/${seller.company.id}/vat-verify`).set(as(admin)) },
      );
      await userRepo.update(buyer.user.id, { status: UserStatus.ACTIVE });

      for (const check of checks) expectClean(check);
    });
  });

  // ── 7. Size search and suggestions ───────────────────────────────────────
  // Uses unusual 455/xxR22.5 sizes so other tests' listings do not interfere.
  describe('Size search and suggestions', () => {
    const SUGGESTION_KEYS = ['aspect', 'construction', 'count', 'diameter', 'rim', 'size', 'width'];

    async function createListing(token: string, extra: Record<string, unknown>) {
      const res = await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseListing, ...extra })
        .expect(201);
      createdListingIds.push(res.body.id);
      return res.body.id as string;
    }

    function suggest(token: string, q: string) {
      return request(httpServer)
        .get('/api/listings/size-suggest')
        .query({ q })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }

    const sizes = (body: { size: string }[]) => body.map((s) => s.size);

    it('requires a valid JWT', async () => {
      await request(httpServer).get('/api/listings/size-suggest').query({ q: '455' }).expect(401);
      await request(httpServer)
        .get('/api/listings/size-suggest')
        .query({ q: '455' })
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('returns sizes and counts only — no prices, companies or listing ids', async () => {
      const seller = await makeActiveUser({ country: 'DE' });
      const buyer = await makeActiveUser({ country: 'PL' });
      const id = await createListing(seller.token, { size: '455/40R22.5', price: 777.77, currency: 'EUR' });

      const res = await suggest(buyer.token, '45540');
      expect(sizes(res.body)).toContain('455/40R22.5');
      for (const s of res.body) expect(Object.keys(s).sort()).toEqual(SUGGESTION_KEYS);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('777.77');
      expect(body).not.toContain(id);
      expect(body).not.toContain(seller.company.id);
      expect(body).not.toContain(seller.company.name);
    });

    it("does not show another company's listing hidden from the viewer's country", async () => {
      const seller = await makeActiveUser({ country: 'DE' });
      const buyerSameCountry = await makeActiveUser({ country: 'DE' });
      const buyerAbroad = await makeActiveUser({ country: 'PL' });
      await createListing(seller.token, { size: '455/50R22.5', exclude_own_region: true });

      expect(sizes((await suggest(buyerSameCountry.token, '455/50')).body)).not.toContain('455/50R22.5');
      expect(sizes((await suggest(buyerAbroad.token, '455/50')).body)).toContain('455/50R22.5');
      expect(sizes((await suggest(seller.token, '455/50')).body)).toContain('455/50R22.5'); // own listing

      const search = await request(httpServer)
        .get('/api/listings')
        .query({ q: '455/50R22.5' })
        .set('Authorization', `Bearer ${buyerSameCountry.token}`)
        .expect(200);
      expect(search.body.total).toBe(0);
    });

    it('does not suggest sizes of deleted listings', async () => {
      const seller = await makeActiveUser({ country: 'DE' });
      const buyer = await makeActiveUser({ country: 'PL' });
      const id = await createListing(seller.token, { size: '455/55R22.5' });
      await request(httpServer)
        .delete(`/api/listings/${id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);

      expect(sizes((await suggest(buyer.token, '455/55R')).body)).not.toContain('455/55R22.5');
    });

    it('searches q by components, keeps size_raw working, and offers nearest sizes when empty', async () => {
      const seller = await makeActiveUser({ country: 'DE' });
      const buyer = await makeActiveUser({ country: 'PL' });
      const id = await createListing(seller.token, { size: '455/40R22.5' });

      for (const q of ['45540R225', '455 40 22,5', '455/40r22.5']) {
        const res = await request(httpServer)
          .get('/api/listings')
          .query({ q })
          .set('Authorization', `Bearer ${buyer.token}`)
          .expect(200);
        expect(res.body.data.map((l: { id: string }) => l.id)).toContain(id);
      }

      const legacy = await request(httpServer)
        .get('/api/listings')
        .query({ size_raw: '455/40R22.5' })
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      expect(legacy.body.data.map((l: { id: string }) => l.id)).toContain(id);
      expect(legacy.body.nearest).toBeUndefined();

      const empty = await request(httpServer)
        .get('/api/listings')
        .query({ q: '455/45R22.5' })
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      expect(empty.body.total).toBe(0);
      expect(empty.body.data).toEqual([]);
      expect(sizes(empty.body.nearest)).toContain('455/40R22.5');
      for (const s of empty.body.nearest) expect(Object.keys(s).sort()).toEqual(SUGGESTION_KEYS);
    });
  });

  // ── 8. Several sizes per listing ──────────────────────────────────────────
  describe('Several sizes per listing', () => {
    const agri = { ...baseListing, segment: 'AGRI', brand: `MultiSize-${randomUUID().slice(0, 8)}` };

    async function create(token: string, extra: Record<string, unknown>) {
      const res = await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...agri, ...extra })
        .expect(201);
      createdListingIds.push(res.body.id);
      return res.body as { id: string; size_raw: string; additional_sizes: string[] };
    }

    const rowsOf = async (listingId: string) =>
      (await sizeRepo.find({ where: { listing_id: listingId }, order: { position: 'ASC' } }))
        .map((s) => [s.position, s.size_raw]);

    function search(token: string, query: Record<string, string>) {
      return request(httpServer)
        .get('/api/listings')
        .query({ ...query, brand: agri.brand })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }

    it('writes every size to listing_sizes on create, main size first, and returns them', async () => {
      const seller = await makeActiveUser();
      const l = await create(seller.token, { size: '16.9-28', additional_sizes: ['440/80-28', ' ', '16.9-28'] });

      expect(l.size_raw).toBe('16.9-28');
      expect(l.additional_sizes).toEqual(['440/80-28']); // blank and repeated main size dropped
      expect(await rowsOf(l.id)).toEqual([[0, '16.9-28'], [1, '440/80-28']]);

      const one = await request(httpServer)
        .get(`/api/listings/${l.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);
      expect(one.body.additional_sizes).toEqual(['440/80-28']);
      expect(one.body.sizes).toBeUndefined();
    });

    it('finds a listing by its additional size, once, and says which size matched', async () => {
      const seller = await makeActiveUser();
      const buyer = await makeActiveUser({ country: 'PL' });
      // Both sizes read as 440/80 28 — a query without construction matches both
      const l = await create(seller.token, { size: '440/80R28', additional_sizes: ['440/80-28', '16.9R28'] });

      const byAlt = await search(buyer.token, { q: '16.9R28' });
      expect(byAlt.body.data.map((r: { id: string }) => r.id)).toEqual([l.id]);
      expect(byAlt.body.data[0].matched_size).toBe('16.9R28');
      expect(byAlt.body.data[0].additional_sizes).toEqual(['440/80-28', '16.9R28']);

      // Two of its sizes match; it still appears once (other listings of this
      // brand from earlier tests may match too, each once as well)
      const both = await search(buyer.token, { q: '440 80 28' });
      const ids: string[] = both.body.data.map((r: { id: string }) => r.id);
      expect(ids.filter((id) => id === l.id)).toHaveLength(1);
      expect(new Set(ids).size).toBe(ids.length);
      expect(both.body.total).toBe(ids.length);
      const hit = both.body.data.find((r: { id: string }) => r.id === l.id);
      expect(hit.matched_size).toBe('440/80R28'); // lowest position wins

      const legacy = await search(buyer.token, { size_raw: '440/80-28' });
      expect(legacy.body.data.find((r: { id: string }) => r.id === l.id)?.matched_size).toBe('440/80-28');

      const sug = await request(httpServer)
        .get('/api/listings/size-suggest')
        .query({ q: '16.9R2' })
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      expect(sug.body.find((s: { size: string }) => s.size === '16.9R28')?.count).toBeGreaterThanOrEqual(1);
    });

    it('keeps listing_sizes in step on update, and rejects a bad size without changing anything', async () => {
      const seller = await makeActiveUser();
      const l = await create(seller.token, { size: '18.4-30', additional_sizes: ['480/80-30'] });
      const patch = (body: Record<string, unknown>, status = 200) =>
        request(httpServer)
          .patch(`/api/listings/${l.id}`)
          .set('Authorization', `Bearer ${seller.token}`)
          .send(body)
          .expect(status);

      await patch({ size: '18.4R30' }); // main size only: extras kept
      expect(await rowsOf(l.id)).toEqual([[0, '18.4R30'], [1, '480/80-30']]);
      expect((await listingRepo.findOneByOrFail({ id: l.id })).size_raw).toBe('18.4R30');

      await patch({ additional_sizes: ['480/80R30', '18.4-30'] });
      expect(await rowsOf(l.id)).toEqual([[0, '18.4R30'], [1, '480/80R30'], [2, '18.4-30']]);

      await patch({ additional_sizes: ['not a size'], qty: 99 }, 400);
      expect(await rowsOf(l.id)).toEqual([[0, '18.4R30'], [1, '480/80R30'], [2, '18.4-30']]);
      expect((await listingRepo.findOneByOrFail({ id: l.id })).qty).toBe(baseListing.qty);

      // four valid sizes: over the limit of three
      await patch({ additional_sizes: ['480/80R30', '18.4-30', '480/80-30', '18.4R28'] }, 400);

      await patch({ additional_sizes: [] });
      expect(await rowsOf(l.id)).toEqual([[0, '18.4R30']]);
    });

    it('legacy template import reads "Alt size" and writes listing_sizes', async () => {
      const seller = await makeActiveUser();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Listings');
      ws.addRow(['Segment', 'Brand', 'Size', 'Alt size', 'Qty', 'Condition', 'Location']);
      ws.addRow(['AGRI', agri.brand, '20.8-38', '520/85-38; 20.8R38', 4, 'new', 'DE']);
      const buf = Buffer.from(await wb.xlsx.writeBuffer());

      const res = await request(httpServer)
        .post('/api/listings/import')
        .set('Authorization', `Bearer ${seller.token}`)
        .attach('file', buf, 'listings.xlsx')
        .expect(201);
      expect(res.body.imported).toBe(1);

      const created = await listingRepo.findOneByOrFail({ company_id: seller.company.id });
      createdListingIds.push(created.id);
      expect(await rowsOf(created.id)).toEqual([[0, '20.8-38'], [1, '520/85-38'], [2, '20.8R38']]);
    });

    it('deleting a listing row removes its sizes (ON DELETE CASCADE)', async () => {
      const seller = await makeActiveUser();
      const l = await create(seller.token, { size: '12.4-24', additional_sizes: ['320/85-24'] });
      await listingRepo.delete(l.id);
      expect(await sizeRepo.countBy({ listing_id: l.id })).toBe(0);
    });

    it('asks to confirm sizes on different rims (409), saves once confirmed', async () => {
      const seller = await makeActiveUser();
      const form = { ...agri, size: '16.9-28', additional_sizes: ['440/80-30'] };
      await request(httpServer).post('/api/listings').set('Authorization', `Bearer ${seller.token}`).send(form).expect(409);
      const l = await create(seller.token, { size: form.size, additional_sizes: form.additional_sizes, confirm_rim_mismatch: true });
      expect(await rowsOf(l.id)).toEqual([[0, '16.9-28'], [1, '440/80-30']]);
    });

    it('accepts the largest real sizes and refuses impossible ones', async () => {
      const seller = await makeActiveUser();
      const l = await create(seller.token, { segment: 'OTR', size: '80/80R57', additional_sizes: ['46/90R57'] });
      expect(await rowsOf(l.id)).toEqual([[0, '80/80R57'], [1, '46/90R57']]);
      await create(seller.token, { segment: 'OTR', size: '1800R25' });
      for (const size of ['999/99R99', '0/0R0', '5/5R5']) {
        await request(httpServer).post('/api/listings').set('Authorization', `Bearer ${seller.token}`)
          .send({ ...agri, size }).expect(400);
      }
    });
  });

  // ── 9. Load index and comment ─────────────────────────────────────────────
  describe('Load index and comment', () => {
    it('parses load_index into columns on create and update, and filters by ply / load index', async () => {
      const seller = await makeActiveUser();
      const buyer = await makeActiveUser({ country: 'PL' });
      const brand = `LoadIdx-${randomUUID().slice(0, 8)}`;
      const post = async (body: Record<string, unknown>) => {
        const res = await request(httpServer)
          .post('/api/listings')
          .set('Authorization', `Bearer ${seller.token}`)
          .send({ ...baseListing, brand, ...body })
          .expect(201);
        createdListingIds.push(res.body.id);
        return res.body.id as string;
      };
      const heavy = await post({ load_index: '156/150L 18PR', comment: 'Ready to ship' });
      const light = await post({ load_index: '132B 16PR' });

      expect(await listingRepo.findOneByOrFail({ id: heavy })).toMatchObject({
        load_index: '156/150L 18PR', load_index_single: 156, speed_single: 'L',
        load_index_dual: 150, ply_rating: 18, comment: 'Ready to ship',
      });

      const find = async (query: Record<string, string>) =>
        (await request(httpServer).get('/api/listings').query({ brand, ...query })
          .set('Authorization', `Bearer ${buyer.token}`).expect(200)).body.data.map((r: { id: string }) => r.id);
      expect(await find({ ply_rating: '16' })).toEqual([light]);
      expect(await find({ load_index_min: '150' })).toEqual([heavy]);

      const one = await request(httpServer).get(`/api/listings/${heavy}`)
        .set('Authorization', `Bearer ${buyer.token}`).expect(200);
      expect(one.body.comment).toBe('Ready to ship');

      // Unreadable text is kept, the parsed columns are cleared
      await request(httpServer).patch(`/api/listings/${heavy}`)
        .set('Authorization', `Bearer ${seller.token}`).send({ load_index: 'see photo' }).expect(200);
      expect(await listingRepo.findOneByOrFail({ id: heavy })).toMatchObject({
        load_index: 'see photo', load_index_single: null, ply_rating: null,
      });
    });
  });

  // ── 10. Smart import ───────────────────────────────────────────────────────
  describe('Smart import', () => {
    const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    async function xlsxOf(rows: unknown[][], tweak?: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Stock');
      for (const r of rows) ws.addRow(r);
      tweak?.(ws);
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    function analyze(token: string, file: Buffer, name = 'stock.xlsx', type = XLSX, segment = 'TBR') {
      return request(httpServer)
        .post('/api/listings/import/analyze')
        .set('Authorization', `Bearer ${token}`)
        .field('segment', segment)
        .attach('file', file, { filename: name, contentType: type });
    }

    function preview(token: string, file: Buffer, options: Record<string, unknown>, name = 'stock.xlsx', type = XLSX) {
      return request(httpServer)
        .post('/api/listings/import/preview')
        .set('Authorization', `Bearer ${token}`)
        .field('options', JSON.stringify({ update_mode: 'update', defaults: { condition: 'new', location_country: 'DE' }, ...options }))
        .attach('file', file, { filename: name, contentType: type });
    }

    function commit(token: string, body: Record<string, unknown>) {
      return request(httpServer)
        .post('/api/listings/import/commit')
        .set('Authorization', `Bearer ${token}`)
        .send({ segment: 'TBR', update_mode: 'update', ...body });
    }

    const rowsForCommit = (rows: { row: number; data: unknown; unrecognized: string | null }[]) =>
      rows.map(({ row, data, unrecognized }) => ({ row, data, unrecognized }));
    const liveListings = (companyId: string) =>
      listingRepo.find({ where: { company_id: companyId, deleted_at: IsNull() }, order: { size_raw: 'ASC' } });

    // A price list as sellers send it: a title above the table, Russian
    // headers, a size cell with the load index glued on, a row without a size
    const stock = [
      ['Остатки на складе, октябрь 2026'],
      [],
      ['Размер', 'Бренд', 'Модель', 'Кол-во', 'Год', 'Цена'],
      ['315/80R22.5 156/150L', 'Michelin', 'X Multi D', 12, 2024, '250,50 €'],
      ['385/65 R22,5 160K', 'Bridgestnoe', 'R168', 4, 2023, ''],
      ['295/80R22.5 (13R22.5) 152/148M', 'Continental', 'HDR2', 2, '', ''],
      ['see attachment', 'Continental', 'HSR', 5, '', ''],
    ];

    async function analyzedPreview(token: string, file: Buffer) {
      const a = await analyze(token, file).expect(200);
      const mapping = Object.fromEntries(a.body.columns.map((c: { index: number; type: string }) => [c.index, c.type]));
      const p = await preview(token, file, { segment: 'TBR', sheet: a.body.sheet, header_row: a.body.header_row, mapping }).expect(200);
      return { a, p };
    }

    it('reads a messy sheet, previews without writing, imports valid rows and skips the bad one', async () => {
      const seller = await makeActiveUser();
      const file = await xlsxOf(stock);
      const { a, p } = await analyzedPreview(seller.token, file);

      expect(a.body.header_row).toBe(3);
      expect(a.body.columns.map((c: { type: string }) => c.type)).toEqual(['size', 'brand', 'pattern', 'qty', 'dot_year', 'price']);
      expect(a.body.columns[0].glued).toBe(true);

      const rows = p.body.rows;
      expect(rows).toHaveLength(4);
      expect(rows[0].data).toMatchObject({ size: '315/80R22.5', brand: 'Michelin', load_index: '156/150L', qty: 12, dot_code: '2024', price: 250.5, currency: 'EUR' });
      expect(rows[1].data).toMatchObject({ size: '385/65R22.5', brand: 'Bridgestone', load_index: '160K' });
      expect(rows[1].status).toBe('warning'); // brand typo corrected
      expect(rows[2].data.additional_sizes).toEqual(['13R22.5']);
      expect(rows[3].status).toBe('error');
      expect(rows.slice(0, 3).map((r: { action: string }) => r.action)).toEqual(['new', 'new', 'new']);
      expect(await liveListings(seller.company.id)).toHaveLength(0); // nothing written before commit

      const c = await commit(seller.token, { rows: rowsForCommit(rows) }).expect(200);
      expect(c.body.counts).toMatchObject({ created: 3, skipped: 1 });
      expect(c.body.errors).toEqual([{ row: 7, messages: expect.any(Array) }]);
      expect(c.body.errors_csv).toContain('see attachment');

      const saved = await liveListings(seller.company.id);
      expect(saved.map((l) => l.size_raw)).toEqual(['295/80R22.5', '315/80R22.5', '385/65R22.5']);
      const michelin = saved.find((l) => l.brand === 'Michelin')!;
      expect(michelin).toMatchObject({ load_index_single: 156, load_index_dual: 150, speed_single: 'L', segment: 'TBR' });
      expect(encryption.decrypt(michelin.price_internal_encrypted!)).toBe('250.5');
      const conti = saved.find((l) => l.brand === 'Continental')!;
      expect((await sizeRepo.find({ where: { listing_id: conti.id }, order: { position: 'ASC' } })).map((s) => s.size_raw))
        .toEqual(['295/80R22.5', '13R22.5']);
    });

    it('updates by key on re-upload instead of duplicating, and undo puts everything back', async () => {
      const seller = await makeActiveUser();
      const file = await xlsxOf(stock);
      const first = await analyzedPreview(seller.token, file);
      const created = await commit(seller.token, { rows: rowsForCommit(first.p.body.rows) }).expect(200);

      // Same file again: everything unchanged, nothing new
      const again = await analyzedPreview(seller.token, file);
      expect(again.p.body.summary).toMatchObject({ new: 0, update: 0, unchanged: 3, errors: 1 });
      const same = await commit(seller.token, { rows: rowsForCommit(again.p.body.rows) }).expect(200);
      expect(same.body.counts).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
      expect(await liveListings(seller.company.id)).toHaveLength(3);

      // A new quantity is an update of the same listing
      const changed = stock.map((r) => [...r]);
      changed[3][3] = 7;
      const third = await analyzedPreview(seller.token, await xlsxOf(changed));
      expect(third.p.body.rows[0].action).toBe('update');
      const upd = await commit(seller.token, { rows: rowsForCommit(third.p.body.rows) }).expect(200);
      expect(upd.body.counts).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
      const michelin = () => listingRepo.findOneByOrFail({ company_id: seller.company.id, brand: 'Michelin' });
      expect((await michelin()).qty).toBe(7);

      // The older import cannot be undone over the newer one
      await request(httpServer)
        .post(`/api/listings/import/batches/${created.body.batch_id}/undo`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(409);

      // Someone else's import cannot be undone at all
      const other = await makeActiveUser();
      await request(httpServer)
        .post(`/api/listings/import/batches/${upd.body.batch_id}/undo`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404);

      await request(httpServer)
        .post(`/api/listings/import/batches/${upd.body.batch_id}/undo`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);
      expect((await michelin()).qty).toBe(12);

      await request(httpServer)
        .post(`/api/listings/import/batches/${created.body.batch_id}/undo`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);
      expect(await liveListings(seller.company.id)).toHaveLength(0);
      expect(await listingRepo.countBy({ company_id: seller.company.id })).toBe(3); // soft deleted, kept
      expect((await batchRepo.findOneByOrFail({ id: created.body.batch_id })).status).toBe('undone');
    });

    it('re-checks every row on commit and rejects forged data', async () => {
      const seller = await makeActiveUser();
      const victim = await makeActiveUser();
      const good = { brand: 'Michelin', size: '315/70R22.5', qty: 3, condition: 'new', location_country: 'DE' };

      const res = await commit(seller.token, {
        rows: [
          { row: 1, data: good },
          { row: 2, data: { ...good, size: '999/99R99', pattern: 'a' } },
          { row: 3, data: { ...good, qty: 0, pattern: 'b' } },
          { row: 4, data: { ...good, company_id: victim.company.id, pattern: 'c' } },
          { row: 5, data: { ...good, status: 'inactive', pattern: 'd' } },
          { row: 6, data: { ...good, additional_sizes: ['1', '2', '3', '4'], pattern: 'e' } },
          { row: 7, data: { ...good } }, // same key as row 1
        ],
      }).expect(200);
      expect(res.body.counts).toMatchObject({ created: 1, skipped: 6 });
      expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4, 5, 6, 7]);
      expect(await listingRepo.countBy({ company_id: victim.company.id })).toBe(0);

      // Unknown fields around the rows are refused outright
      await commit(seller.token, { rows: [{ row: 1, data: good, company_id: victim.company.id }] }).expect(400);
      await commit(seller.token, { rows: [], segment: 'XXX' }).expect(400);
    });

    it('deactivates listings missing from the file only with the confirmed count', async () => {
      const seller = await makeActiveUser();
      const base = { brand: 'Michelin', qty: 3, condition: 'new', location_country: 'DE' };
      await commit(seller.token, { rows: [{ row: 1, data: { ...base, size: '315/80R22.5' } }, { row: 2, data: { ...base, size: '315/70R22.5' } }] }).expect(200);

      const next = { rows: [{ row: 1, data: { ...base, size: '315/80R22.5' } }], deactivate_missing: true };
      const dry = await commit(seller.token, { ...next, dry_run: true }).expect(200);
      expect(dry.body.summary.missing).toBe(1);
      await commit(seller.token, { ...next, expected_deactivate: 0 }).expect(409);
      const done = await commit(seller.token, { ...next, expected_deactivate: 1 }).expect(200);
      expect(done.body.counts.deactivated).toBe(1);
      const l = await listingRepo.findOneByOrFail({ company_id: seller.company.id, size_raw: '315/70R22.5' });
      expect(l.status).toBe('inactive');

      // By default listings missing from a file are left alone
      const keep = await commit(seller.token, { rows: [{ row: 1, data: { ...base, size: '385/65R22.5' } }] }).expect(200);
      expect(keep.body.counts.deactivated).toBe(0);
      expect((await listingRepo.findOneByOrFail({ id: l.id })).status).toBe('inactive');
    });

    it('finds an imported listing by its second size, once', async () => {
      const seller = await makeActiveUser();
      const buyer = await makeActiveUser({ country: 'PL' });
      const brand = 'Mitas';
      const pattern = `P-${randomUUID().slice(0, 8)}`;
      await commit(seller.token, {
        segment: 'AGRI',
        rows: [{ row: 1, data: { brand, pattern, size: '16.9-28', additional_sizes: ['440/80-28'], qty: 2, condition: 'new', location_country: 'DE' } }],
      }).expect(200);
      const res = await request(httpServer)
        .get('/api/listings')
        .query({ q: '440/80-28', brand })
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      const hits = res.body.data.filter((r: { pattern: string }) => r.pattern === pattern);
      expect(hits).toHaveLength(1);
      expect(hits[0].matched_size).toBe('440/80-28');
    });

    it('warns about different rims in an import, but the form asks for confirmation', async () => {
      const seller = await makeActiveUser();
      const res = await commit(seller.token, {
        segment: 'AGRI',
        rows: [{ row: 1, data: { brand: 'Mitas', size: '16.9-28', additional_sizes: ['440/80-30'], qty: 2, condition: 'new', location_country: 'DE' } }],
        dry_run: true,
      }).expect(200);
      expect(res.body.counts.created).toBe(1);
      expect(res.body.summary.warnings).toBe(1);

      const form = { ...baseListing, segment: 'AGRI', size: '16.9-28', additional_sizes: ['440/80-30'] };
      await request(httpServer).post('/api/listings').set('Authorization', `Bearer ${seller.token}`).send(form).expect(409);
      const ok = await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ ...form, confirm_rim_mismatch: true })
        .expect(201);
      createdListingIds.push(ok.body.id);
    });

    it('takes formula results without evaluating, and survives hostile files', async () => {
      const seller = await makeActiveUser();
      const withFormula = await xlsxOf(
        [['Size', 'Brand', 'Qty'], ['315/80R22.5', 'Michelin', 1]],
        (ws) => { ws.getCell('C2').value = { formula: 'HYPERLINK("http://evil","x")*0+4', result: 4 } as ExcelJS.CellFormulaValue; },
      );
      const { p } = await analyzedPreview(seller.token, withFormula);
      expect(p.body.rows[0].data.qty).toBe(4);

      // > 5 MB
      await analyze(seller.token, Buffer.alloc(6 * 1024 * 1024, 0x41), 'big.csv', 'text/csv').expect(413);
      // Old .xls, and a renamed binary
      await analyze(seller.token, Buffer.from('d0cf11e0a1b11ae1000000000000', 'hex'), 'old.xls', 'application/vnd.ms-excel').expect(400);
      await analyze(seller.token, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'x.csv', 'text/csv').expect(400);
      // Zip bomb: 50 MB of zeros packed into a few kB
      await analyze(seller.token, zipOf('xl/worksheets/sheet1.xml', Buffer.alloc(50 * 1024 * 1024)), 'bomb.xlsx').expect(400);
      // Server still answers
      await analyze(seller.token, withFormula).expect(200);
    });

    it('limits request bodies outside the import commit', async () => {
      const seller = await makeActiveUser();
      await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ ...baseListing, comment: 'x'.repeat(200 * 1024) })
        .expect(413);
    });
  });

  // Minimal one-entry ZIP (deflate), enough for the zip-bomb guard to inspect
  function zipOf(name: string, content: Buffer): Buffer {
    const data = deflateRawSync(content, { level: 9 });
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(0, 42);
    const cdOffset = local.length + n.length + data.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + n.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    return Buffer.concat([local, n, data, central, n, eocd]);
  }

  // ── 11. "x" sizes and dot-less inch widths ─────────────────────────────────
  describe('"x" sizes and dot-less inch widths', () => {
    const brand = `XSize-${randomUUID().slice(0, 8)}`;
    const mh = { ...baseListing, segment: 'MH', brand };

    async function post(token: string, body: Record<string, unknown>, status = 201) {
      const res = await request(httpServer)
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...mh, ...body })
        .expect(status);
      if (status === 201) createdListingIds.push(res.body.id);
      return res.body as { id: string };
    }

    const find = async (token: string, q: string) =>
      (await request(httpServer).get('/api/listings').query({ brand, q })
        .set('Authorization', `Bearer ${token}`).expect(200)).body.data.map((r: { id: string }) => r.id).sort();

    it('stores an "x" size with its diameter and finds it only by an "x" query', async () => {
      const seller = await makeActiveUser();
      const buyer = await makeActiveUser({ country: 'PL' });
      const x = await post(seller.token, { size: '28 X 9 - 15' });
      const plain = await post(seller.token, { size: '9-15' });

      expect(await listingRepo.findOneByOrFail({ id: x.id })).toMatchObject({
        size_raw: '28x9-15', size_format: 'outer_diameter', size_construction: '-',
      });
      const row = await listingRepo.findOneByOrFail({ id: x.id });
      expect([Number(row.size_outer_diameter), Number(row.size_width), Number(row.size_rim)]).toEqual([28, 9, 15]);
      expect((await sizeRepo.findOneByOrFail({ listing_id: x.id })).size_outer_diameter).not.toBeNull();

      for (const q of ['28x9-15', '28X9-15', '28 x 9 - 15', '28×9-15', '28x9']) expect(await find(buyer.token, q)).toEqual([x.id]);
      expect(await find(buyer.token, '9-15')).toEqual([plain.id]); // "9-15" is not 28x9-15
      expect(await find(buyer.token, '28x9R15')).toEqual([]); // R asked, the tyre is diagonal

      const sug = await request(httpServer).get('/api/listings/size-suggest').query({ q: '28x9' })
        .set('Authorization', `Bearer ${buyer.token}`).expect(200);
      expect(sug.body.find((s: { size: string }) => s.size === '28x9-15')).toMatchObject({ diameter: 28, width: 9, rim: 15 });
    });

    it('checks rims between an "x" main size and its additional sizes', async () => {
      const seller = await makeActiveUser();
      await post(seller.token, { size: '28x9-15', additional_sizes: ['8.15-15'] });
      await post(seller.token, { size: '28x9-15', additional_sizes: ['6.50-10'] }, 409);
      await post(seller.token, { size: '31x10.50R15', additional_sizes: ['6.50-10'], confirm_rim_mismatch: true });
      await post(seller.token, { size: '15x9-15' }, 400); // diameter not above the rim
    });

    it('imports a glued cell with an "x" size', async () => {
      const seller = await makeActiveUser();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Stock');
      ws.addRow(['Description', 'Brand', 'Qty']);
      ws.addRow(['28 x 9 - 15 SC20 10PR', brand, 4]);
      const file = Buffer.from(await wb.xlsx.writeBuffer());
      const xlsx = { filename: 'stock.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

      const a = await request(httpServer).post('/api/listings/import/analyze')
        .set('Authorization', `Bearer ${seller.token}`).field('segment', 'MH').attach('file', file, xlsx).expect(200);
      const mapping = Object.fromEntries(a.body.columns.map((c: { index: number; type: string }) => [c.index, c.type]));
      const p = await request(httpServer).post('/api/listings/import/preview')
        .set('Authorization', `Bearer ${seller.token}`)
        .field('options', JSON.stringify({
          segment: 'MH', sheet: a.body.sheet, header_row: a.body.header_row, mapping,
          update_mode: 'update', defaults: { condition: 'new', location_country: 'DE' },
        }))
        .attach('file', file, xlsx).expect(200);
      expect(p.body.rows[0].data).toMatchObject({ size: '28x9-15', qty: 4 });

      const rows = p.body.rows.map((r: { row: number; data: unknown; unrecognized: string | null }) => ({ row: r.row, data: r.data, unrecognized: r.unrecognized }));
      await request(httpServer).post('/api/listings/import/commit')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ segment: 'MH', update_mode: 'update', rows }).expect(200);
      const created = await listingRepo.findOneByOrFail({ company_id: seller.company.id });
      createdListingIds.push(created.id);
      expect(created).toMatchObject({ size_raw: '28x9-15', size_format: 'outer_diameter' });
      expect(Number(created.size_outer_diameter)).toBe(28);
    });

    it('stores 1800R25 like 18.00R25, keeps the spelling, and a search for either finds both', async () => {
      const seller = await makeActiveUser();
      const buyer = await makeActiveUser({ country: 'PL' });
      const dotless = await post(seller.token, { segment: 'OTR', size: '1800R25' });
      const dotted = await post(seller.token, { segment: 'OTR', size: '18.00R25' });
      const metric = await post(seller.token, { segment: 'OTR', size: '1050/50R32' });

      const width = async (id: string) => Number((await listingRepo.findOneByOrFail({ id })).size_width);
      expect(await width(dotless.id)).toBe(18);
      expect(await width(dotted.id)).toBe(18);
      expect(await width(metric.id)).toBe(1050); // slash sizes are mm, untouched
      expect((await listingRepo.findOneByOrFail({ id: dotless.id })).size_raw).toBe('1800R25');

      const both = [dotless.id, dotted.id].sort();
      expect(await find(buyer.token, '1800R25')).toEqual(both);
      expect(await find(buyer.token, '18.00R25')).toEqual(both);
      expect(await find(buyer.token, '18.00 25')).toEqual(both);
    });

    it('migration 0012 converts dot-less widths stored before it, and back', async () => {
      const seller = await makeActiveUser();
      const l = await post(seller.token, { segment: 'OTR', size: '1400-24', additional_sizes: ['1400R24'] });
      const ds = app.get(DataSource);
      // Plain SQL: while 0012 is undone the entities name a missing column
      const widths = async () => [
        ...(await ds.query('SELECT size_width FROM listings WHERE id = $1', [l.id])),
        ...(await ds.query('SELECT size_width FROM listing_sizes WHERE listing_id = $1 ORDER BY position', [l.id])),
      ].map((r: { size_width: string }) => Number(r.size_width));

      await ds.undoLastMigration(); // 0013 down: it sits on top of 0012
      await ds.undoLastMigration(); // 0012 down: widths as written
      expect(await widths()).toEqual([1400, 1400, 1400]);
      await ds.runMigrations(); // 0012 and 0013 up
      expect(await widths()).toEqual([14, 14, 14]);
    });
  });

  // ── 12. Session refresh ───────────────────────────────────────────────────
  // Sessions start through SessionsService.issue, not /auth/login, which keeps
  // the login quota for the rate limit test below (one real login here).
  describe('Session refresh', () => {
    const hash = (t: string) => createHash('sha256').update(t).digest('hex');
    const tokenRepo = () => app.get(DataSource).getRepository(RefreshToken);

    const refresh = (token: string) =>
      request(httpServer).post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE}=${token}`);
    const me = (access: string) =>
      request(httpServer).get('/api/auth/me').set('Authorization', `Bearer ${access}`);
    const newCookie = (res: request.Response): string =>
      [res.headers['set-cookie']].flat().join(';').match(new RegExp(`${REFRESH_COOKIE}=([0-9a-f]+)`))?.[1] ?? '';

    it('login sets the cookie and keeps the refresh token out of the body', async () => {
      const { user } = await makeActiveUser();

      const res = await request(httpServer)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'TestPass123!' })
        .expect(201);

      expect(Object.keys(res.body)).toEqual(['access_token']);
      const cookie = [res.headers['set-cookie']].flat()[0];
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/api/auth/refresh');
      expect(cookie).toContain(`Max-Age=${14 * 24 * 60 * 60}`);
      expect(cookie).not.toContain('Secure'); // NODE_ENV is not production here

      const raw = newCookie(res);
      const rows = await tokenRepo().findBy({ user_id: user.id });
      expect(rows.map(r => r.token_hash)).toEqual([hash(raw)]);
    });

    it('issues a 20-minute access token', async () => {
      const { user } = await makeActiveUser();
      const { access_token } = await sessions.issue(user.id);
      const { iat, exp } = jwt.decode(access_token) as { iat: number; exp: number };
      expect(exp - iat).toBe(20 * 60);
    });

    it('allows the credentials the local web app needs', async () => {
      const res = await request(httpServer)
        .options('/api/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    it('exchanges a refresh token for a new pair', async () => {
      const { user } = await makeActiveUser();
      const first = await sessions.issue(user.id);

      const res = await refresh(first.refresh_token).expect(200);

      expect(Object.keys(res.body)).toEqual(['access_token']);
      expect(newCookie(res)).toMatch(/^[0-9a-f]{64}$/);
      expect(newCookie(res)).not.toBe(first.refresh_token);
      await me(res.body.access_token).expect(200);
      const used = await tokenRepo().findOneByOrFail({ token_hash: hash(first.refresh_token) });
      expect(used.used_at).not.toBeNull();
    });

    it('rejects a missing, unknown or expired refresh token', async () => {
      const { user } = await makeActiveUser();
      const { refresh_token } = await sessions.issue(user.id);
      await tokenRepo().update({ token_hash: hash(refresh_token) }, { expires_at: new Date(Date.now() - 1000) });

      await request(httpServer).post('/api/auth/refresh').expect(401);
      await refresh('0'.repeat(64)).expect(401);
      const res = await refresh(refresh_token).expect(401);
      expect([res.headers['set-cookie']].flat()[0]).toContain(`${REFRESH_COOKIE}=;`);
    });

    it('on reuse rejects the token and signs the user out everywhere', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      const { user } = await makeActiveUser();
      const otherDevice = await sessions.issue(user.id);
      const stolen = await sessions.issue(user.id);
      const rotated = await refresh(stolen.refresh_token).expect(200);

      await refresh(stolen.refresh_token).expect(401);

      await refresh(newCookie(rotated)).expect(401);
      await refresh(otherDevice.refresh_token).expect(401);
      await me(rotated.body.access_token).expect(401);
      const logged = warn.mock.calls.flat().join(' ');
      warn.mockRestore();
      expect(logged).toContain(user.id);
      expect(logged).not.toContain(stolen.refresh_token);
    });

    it('lets only one of two simultaneous uses of a token through, then revokes', async () => {
      const { user } = await makeActiveUser();
      const { refresh_token } = await sessions.issue(user.id);

      const results = await Promise.all([refresh(refresh_token), refresh(refresh_token)]);

      expect(results.map(r => r.status).sort()).toEqual([200, 401]);
      const winner = results.find(r => r.status === 200)!;
      await refresh(newCookie(winner)).expect(401);
    });

    it('logout revokes this session only, without an access token', async () => {
      const { user } = await makeActiveUser();
      const laptop = await sessions.issue(user.id);
      const phone = await sessions.issue(user.id);

      const res = await request(httpServer)
        .post('/api/auth/refresh/logout')
        .set('Cookie', `${REFRESH_COOKIE}=${laptop.refresh_token}`)
        .expect(204);

      expect([res.headers['set-cookie']].flat()[0]).toContain(`${REFRESH_COOKIE}=;`);
      await refresh(laptop.refresh_token).expect(401);
      await refresh(phone.refresh_token).expect(200);
    });

    it('after a password change the old session is dead and the new one works', async () => {
      const { user } = await makeActiveUser();
      const old = await sessions.issue(user.id);
      const change = (current_password: string) =>
        request(httpServer)
          .post('/api/auth/change-password')
          .set('Authorization', `Bearer ${old.access_token}`)
          .send({ current_password, new_password: 'NewPassword12345' });

      await change('WrongPassword1').expect(400);
      await me(old.access_token).expect(200);

      const res = await change('TestPass123!').expect(201);

      await me(old.access_token).expect(401);
      await refresh(old.refresh_token).expect(401);
      await me(res.body.access_token).expect(200);
      await refresh(newCookie(res)).expect(200);
    });

    it('a password reset ends the sessions', async () => {
      const { user } = await makeActiveUser();
      const old = await sessions.issue(user.id);
      const token = 'a'.repeat(64);
      await app.get(DataSource).getRepository(PasswordResetToken).save({
        user_id: user.id, token_hash: hash(token), expires_at: new Date(Date.now() + 60_000),
      });

      await request(httpServer)
        .post('/api/auth/reset-password')
        .send({ token, new_password: 'NewPassword12345' })
        .expect(201);

      await me(old.access_token).expect(401);
      await refresh(old.refresh_token).expect(401);
    });

    it('blocking ends the sessions, and unblocking does not bring them back', async () => {
      const { token: adminToken } = await makeActiveUser({ role: UserRole.ADMIN });
      const { user } = await makeActiveUser();
      const old = await sessions.issue(user.id);
      const admin = (action: string) =>
        request(httpServer).post(`/api/admin/users/${user.id}/${action}`).set('Authorization', `Bearer ${adminToken}`);

      await admin('block').expect(201);
      await refresh(old.refresh_token).expect(401);

      await admin('unblock').expect(201);
      await refresh(old.refresh_token).expect(401);
      await me(old.access_token).expect(401);
    });

    it('accepts an access token issued before this change', async () => {
      const { token } = await makeActiveUser(); // signed without tv
      await me(token).expect(200);
    });

    it('never shows token_version in a response', async () => {
      const { token } = await makeActiveUser();
      const res = await me(token).expect(200);
      expect(res.body).not.toHaveProperty('token_version');
    });
  });

  // ── 13. Rate limiting ─────────────────────────────────────────────────────
  // Runs last: only section 3 and the one login in section 12 touch POST
  // /auth/login, the rest authenticate via signed JWTs (see makeActiveUser).
  describe('Rate limiting', () => {
    it('returns 429 after exceeding the refresh threshold (30 / 5 min)', async () => {
      let last: request.Response | undefined;
      for (let i = 0; i < 31; i++) {
        last = await request(httpServer).post('/api/auth/refresh');
      }
      expect(last!.status).toBe(429);
    });

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
