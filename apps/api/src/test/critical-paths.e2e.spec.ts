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
import { SECRET_FIELDS } from '../common/serializers';

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
    const SUGGESTION_KEYS = ['aspect', 'construction', 'count', 'rim', 'size', 'width'];

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

  // ── 8. Rate limiting ──────────────────────────────────────────────────────
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
