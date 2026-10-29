# Tyre Terra — Project Status

_Last updated: 2026-10-28_

B2B marketplace for anonymous TBR/PCR/OTR/AGRI/MH tire exchange across Europe.
Sellers list inventory, buyers send requests, sellers counter with a price, buyer accepts → deal + in-app chat with file attachments.

This file describes the current state of the code and the deployment. It contains no credentials, hosts or connection strings — those live only in the server's `.env` (see [DEPLOYMENT.md](DEPLOYMENT.md)).

---

## 1. Architecture

**Monorepo** (npm workspaces): `apps/api` (NestJS) + `apps/web` (Next.js 15 / React 19).

```
tyreterra/
├── apps/
│   ├── api/    NestJS 10, TypeORM, PostgreSQL (Neon, serverless)
│   └── web/    Next.js 15 App Router, React 19, no UI framework (hand-rolled CSS)
└── package-lock.json (shared root)
```

**Source of truth:** GitHub — `OttoOtter-hub/tyreterra-web`, branch `master`.

### Deployment (current)

Manual, no CI/CD, no Docker — see [DEPLOYMENT.md](DEPLOYMENT.md) for the step-by-step.

- Dedicated Ubuntu 24.04 VPS. SSH by key only, firewall allows SSH, 80 and 443, fail2ban on sshd, unattended security upgrades.
- The app runs under an unprivileged `tyreterra` user (no sudo). Code in `/opt/tyreterra`, built **on the server** from a `git clone` of `master`.
- Process manager: PM2 under the `tyreterra` user only (systemd unit `pm2-tyreterra` resurrects it on boot):
  - `tyreterra-api` — `127.0.0.1:3101`
  - `tyreterra-web` — `127.0.0.1:3100`
  - both with `max_memory_restart: 600M`
- Both ports listen on **localhost only**. nginx serves the app on its domain over HTTPS: `/api/*` → :3101, `/*` → :3100, `/uploads/*` → static files from `/var/www/uploads`. HTTP redirects to HTTPS; requests by bare IP or unknown `Host` get no response.
- TLS: Let's Encrypt via certbot, auto-renewed. Security headers (HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) are set by nginx.
- The web bundle is built with `NEXT_PUBLIC_API_URL=/api` (same origin as the API).
- Database: Neon PostgreSQL (separate Neon project, schema built from the migrations).
- File uploads: `/var/www/uploads` (owner `tyreterra`, group `www-data`, mode 750).

---

## 2. Backend modules (`apps/api/src/`)

| Module | Responsibility |
|---|---|
| `auth/` | Register, login, JWT issuance, `/auth/me`, password reset (forgot / reset) |
| `companies/` | Company entity (referenced by users, listings, ratings) |
| `listings/` | Tire inventory CRUD, search, Excel export/import, soft delete |
| `requests/` | Buyer → seller purchase requests |
| `offers/` | Seller's price response to a request (encrypted at rest) |
| `deals/` | Created when buyer accepts an offer; in-app chat lives here |
| `messages/` | Chat messages (text + file attachments) scoped to a deal |
| `admin/` | User approval queue, KPI dashboard, audit log, VAT override, global listing export |
| `ratings/` | Seller rating, recalculated from deal history (nightly cron at 02:00 + on demand) |
| `vat/` | EU VIES VAT number validation |
| `audit/` | Append-only audit log (every state-changing action writes here) |
| `common/` | `EncryptionService` (AES-256-GCM), tire size parser, `email/` (Resend `EmailService` + templates) |

### Auth & roles
- JWT bearer auth (`JwtAuthGuard`), `AdminGuard` for `/admin/*`.
- User roles: `dealer`, `distributor`, `admin` — **the dealer/distributor distinction is not used by business logic** (registration does not ask for it, catalogue search does not filter by it). The enum values remain in the DB; reintroducing them is planned only for the future Distributor Orders module (`docs/future/`).
- New users land in `status: pending` and need admin approval (`POST /admin/users/:id/approve`) before they can log in.
- The first admin is created with `src/seed-admin.ts`; it takes the password only from `SEED_ADMIN_PASSWORD` (no default) and connects via `DATABASE_URL` when set.

### Rate limiting (`@nestjs/throttler`, per client IP)
Applied only to the auth endpoints, via `@UseGuards(ThrottlerGuard)` + `@Throttle()`:

| Endpoint | Limit |
|---|---|
| `POST /auth/register` | 3 per hour |
| `POST /auth/login` | 5 per 15 minutes |
| `POST /auth/forgot-password` | 3 per hour |

The API sets `trust proxy` to one hop, so behind nginx the limit applies to the real client IP from `X-Forwarded-For` (verified on the server: 6th bad login → 429). Requests that bypass nginx (SSH tunnel) all come from `127.0.0.1` and share one bucket. Counters live in API memory, so restarting `tyreterra-api` resets them.

### Password reset
- `POST /auth/forgot-password` creates a random 32-byte token, stores only its SHA-256 hash in `password_reset_tokens`, valid for 1 hour.
- `POST /auth/reset-password` accepts the token once (`used_at` is set) and invalidates the user's other open tokens.
- The reset link is built from `FRONTEND_URL` (`/reset-password?token=…`).
- The link is emailed (see *Email notifications*). The response is the same whether the email exists or delivery worked, so it does not reveal registered addresses.

### Email notifications (`common/email/`)
- Sent through **Resend** (`RESEND_API_KEY`, sender `EMAIL_FROM`). Without the key the API refuses to start, except in `NODE_ENV=development`/`test`, where `EmailService` is a stub that only logs (the development stub also prints the body, e.g. the reset link).
- Templates (`email-templates.ts`) are English, plain HTML + a text version, no external images. They state only that something happened and link into the app — **no prices, company names or contacts of the other party**, to keep the marketplace anonymous.

| Event | Recipient | Link |
|---|---|---|
| Password reset (link valid 1 h) | the user | `/reset-password?token=…` |
| Account approved / rejected | the user | `/login` (approved only; the rejection reason stays in the audit log) |
| New request on a listing | seller | `/requests/:id` |
| Offer received / request declined by seller | buyer | `/requests/:id` |
| Deal created (offer accepted) | both sides | `/deals/:id` — contacts are shown there, not in the email |
| Listings expiring within 3 days / expired | seller, one email per company with a count | `/listings` |
| New registration awaiting approval | `ADMIN_NOTIFY_EMAIL` (skipped if unset) | `/admin/users` |

- Company emails go to the account email of the company's active user, not the encrypted company contact.
- A failed send never fails the user's request: `EmailService` catches it and logs the email kind and a masked recipient only — never the body or tokens. In production the log shows only that a reset email was sent, not the link.
- Listing expiry: nightly job `ListingExpiryNotifier` at 03:00. `expiry_reminder_sent_at` / `expired_notice_sent_at` on `listings` prevent repeats; they are set only after a successful send and cleared on renew / activate.

### Soft delete (listings)
- `DELETE /listings/:id`, bulk action `delete` and admin `DELETE /admin/listings/:id` set `deleted_at` (and `status = inactive`) instead of removing the row, so audit trail and deal history stay intact.
- Every read path filters `deleted_at IS NULL`.

---

## 3. Database schema (PostgreSQL via Neon)

Schema changes go **only through migrations**. `synchronize` is `false` everywhere (app, CLI, tests): the hand-written migrations differ from the entity definitions in column types (`char` vs `varchar`) and enum/index names, and a sync would drop and re-add those columns, wiping their data.

### `companies`
id, name, country (CHAR2), vat_number, vat_verified, vat_verified_at, short_description, contact_email_encrypted, contact_phone_encrypted, timestamps.

### `users`
id, email (unique), password_hash, role (`dealer`/`distributor`/`admin`), status (`pending`/`active`/`blocked`), company_id → companies, gdpr_consent, gdpr_consent_at, tos_accepted_at, timestamps.

### `listings` (core inventory table)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid → companies | cascade delete |
| segment | enum `tire_segment` | `TBR, PCR, OTR, AGRI, MH` |
| tire_type | varchar(30), nullable | subtype per segment (see §4) |
| brand | varchar(100) | |
| sku | varchar(100), nullable | seller's own article number |
| size_format / size_width / size_aspect_ratio / size_construction / size_rim / size_raw | parsed tire size — see §5 |
| pattern | varchar(100), nullable | |
| load_index | varchar(30), nullable | e.g. `12PR`, `173D/178A8` |
| origin_country | varchar(100), nullable | ISO alpha-2 code, country of manufacture |
| qty | integer ≥1 | |
| dot_code | char(4), nullable | **repurposed as production year (YYYY)** |
| location_country | char(2) | ISO alpha-2 |
| location_region | varchar(100), nullable | |
| condition | enum | `new, used, retreaded` |
| price_internal_encrypted | text, nullable | AES-256-GCM encrypted; **owner-only** |
| price_currency | char(3), nullable | |
| visible_regions | text[], nullable | unused by current UI |
| exclude_own_region | boolean | hide from own country |
| allowed_roles | enum | `all/dealer/distributor` — field kept, not enforced |
| status | enum | `active, inactive, expired` |
| expires_at | timestamptz | 30-day TTL from creation/renewal |
| expiry_reminder_sent_at / expired_notice_sent_at | timestamptz, nullable | when the owner was emailed about expiry; cleared on renew/activate |
| deleted_at | timestamptz, nullable | soft delete marker (indexed) |
| created_at / updated_at | timestamptz | |

Indices: `(size_width, size_rim, size_construction)`, `segment`, `brand`, `company_id`, `status`, `expires_at`, `deleted_at`.

### `requests`
id, listing_id → listings, buyer_company_id → companies, qty_requested, comment, status (`pending/offered/accepted/rejected/cancelled`), timestamps.

### `offers`
id, request_id (1:1) → requests, price_encrypted, currency, terms_text, status (`pending/accepted/rejected`), timestamps.

### `deals`
id, offer_id (1:1) → offers, status (`pending_pickup`/`completed`), accepted_at, completed_at, contact_revealed_at, created_at.

### `messages`
id, deal_id → deals, sender_company_id → companies, body (nullable text), file_url (varchar 500, nullable), file_name (varchar 255, nullable), created_at.

### `password_reset_tokens`
id, user_id → users (cascade delete), token_hash, expires_at, used_at, created_at. Indexed by `user_id` and `token_hash`.

### `ratings`, `audit_log`
Rating score/interaction_count per company; `audit_log` records `event_type`, `actor_id`, `target_id`, `target_type`, `payload` (jsonb) for every mutating action.

### Migrations (all 8 applied, tracked in the `migrations` table)
1. `InitialSchema` — base schema
2. `AddLoadIndexOriginCountry` — listings.load_index, origin_country
3. `AddMessageAttachments` — messages.file_url, file_name; body made nullable
4. `AddPcrMhSegmentsAndTireType` — PCR/MH added to segment enum; listings.tire_type
5. `AddSkuToListings` — listings.sku
6. `AddDealStatus` — deals.status, completed_at
7. `AddDeletedAtToListings` — listings.deleted_at + index (soft delete)
8. `AddPasswordResetTokens` — password_reset_tokens table

---

## 4. Tire taxonomy

**Segments:** `TBR` (truck/bus radial), `PCR` (passenger car), `OTR` (off-the-road), `AGRI` (agricultural), `MH` (material handling).

**`tire_type` subfilter** (free text, validated client-side against fixed lists):
| Segment | Allowed values |
|---|---|
| TBR | `steer`, `drive`, `trailer`, `all_position` |
| PCR | `summer`, `winter_friction`, `winter_stud`, `all_season` |
| MH | `pneumatic`, `solid` |
| OTR, AGRI | none |

## 5. Tire size parser (`common/tire-size.parser.ts`)

Accepts 6 input formats, normalises to uppercase/no-spaces, extracts width/aspect/construction/rim:

| Format | Example | `size_construction` |
|---|---|---|
| Metric radial | `315/80R22.5` | `R` |
| Flotation (width ≥500) | `710/70R42` | `R` |
| Diagonal inch | `10.00-20` | `-` |
| Radial inch | `14.9R28` | `R` |
| Slash diagonal | `12.5/80-18` | `-` |
| L-series diagonal | `19.5L-24` | `-` (L stripped for numeric width) |

Size is editable after listing creation — `PATCH /listings/:id` re-parses if `size` is provided, recomputing all derived columns.

---

## 6. API endpoints

All routes prefixed `/api`. JWT bearer required unless noted.

### Auth (`/auth`)
- `POST /register` — public, rate-limited; creates company + user (status=pending), no role selection (defaults to dealer)
- `POST /login` — public, rate-limited; returns JWT; rejects pending/blocked users
- `POST /forgot-password` — public, rate-limited; always answers the same way (no account enumeration)
- `POST /reset-password` — public; token + new password
- `GET /me` — current user profile

### Listings (`/listings`)
- `POST /` — create (segment, tire_type, brand, sku, size, pattern, load_index, origin_country, dot_code(year), qty, condition, location, price, currency, exclude_own_region)
- `GET /mine` — own company's listings (all statuses except deleted), decrypted price included
- `GET /export` — Excel download of own listings
- `GET /import/template` — Excel template download
- `POST /import` — bulk-create from uploaded `.xlsx`; **aborts entirely on first row error**, returns row number + message
- `GET /?segment=&tire_type=&brand=&size_raw=&location_country=&condition=&qty_min=&min_rating=&page=&limit=` — catalogue search (active, non-deleted listings only, no price)
- `GET /:id` — single listing; returns decrypted `price`/`currency` only if viewer owns it
- `PATCH /:id` — update (owner or admin); re-parses size if provided
- `POST /bulk-action` — `{ids, action: 'delete'|'deactivate'|'activate'}` (owner or admin); `delete` is soft
- `POST /:id/activate` / `POST /:id/deactivate` — single-item status toggle
- `DELETE /:id` — **soft delete** (owner or admin)
- `POST /:id/renew` — reset expires_at +30 days

### Requests (`/requests`)
- `POST /` — buyer creates request against a listing
- `GET /incoming` — seller's view (requests on their listings)
- `GET /outgoing` — buyer's view (their own requests)
- `GET /:id` — detail; if viewer is the seller, includes `listing_price`/`listing_currency` (decrypted recommended price)
- `DELETE /:id` — buyer cancels (pending/offered only)

### Offers (`/requests/:requestId`)
- `POST /offer` — seller sends price offer
- `POST /decline` — seller declines request outright
- `GET /offer` — buyer views offer (decrypted price)
- `POST /offer/accept` — buyer accepts → creates `deal`, reveals contact info
- `POST /offer/reject` — buyer rejects offer

### Deals (`/deals`)
- `GET /` — own deals (as buyer or seller), includes seller/buyer company names
- `GET /:id` — deal detail
- `POST /:id/confirm-receipt` — **buyer-only**, sets `status=completed`
- `GET /:id/messages` / `POST /:id/messages` — text chat
- `POST /:id/messages/upload` — multipart file upload (images/PDF/Word/Excel, 10MB max) → creates a message with `file_url` (`/uploads/<uuid>`)

### Admin (`/admin`) — `AdminGuard` required
- `GET /dashboard` — KPI counts
- `GET /users/pending`, `POST /users/:id/approve`, `POST /users/:id/block`, `POST /users/:id/unblock`, `PATCH /users/:id/role`
- `DELETE /listings/:id` — admin listing removal (soft delete)
- `GET /listings/export` — Excel of **all** listings across all companies (includes company name column, no contact data)
- `POST /companies/:id/vat-verify` — manual VAT override
- `GET /audit-log?event_type=&actor_id=&from=&to=&page=&limit=`
- `POST /companies/:id/recalculate-rating`

### VAT (`/vat`)
- `POST /check` — EU VIES validation lookup

---

## 7. Security notes

- Passwords: bcrypt, 12 rounds.
- Prices and company contacts: AES-256-GCM via `EncryptionService`, key derived from `ENCRYPTION_KEY` (scrypt). **`ENCRYPTION_KEY` is mandatory:** the API refuses to start without it unless `NODE_ENV` is `development` or `test`. Losing the key makes existing encrypted data unreadable; such fields are returned as empty (`null`) instead of failing the request.
- Plaintext price never leaves the server except to the listing owner, the seller viewing their own request, or the buyer viewing an offer made to them.
- `password_hash` is stripped from all admin user-list/detail responses.
- Rate limiting on register / login / forgot-password (see §2).
- File uploads: MIME-type allowlist, 10MB cap, UUID-based filenames (no path traversal), stored outside the app directory, served read-only by nginx as downloads (`Content-Disposition: attachment`, `nosniff`, no directory listing).
- Tire size, location country, condition, segment are server-side validated (`class-validator`).
- API and web listen on `127.0.0.1` only (API: `HOST`, default `127.0.0.1`); only nginx (or an SSH tunnel for debugging) reaches them.
- HTTPS only (HTTP → 301), HSTS and other security headers from nginx; no CSP yet.
- Error pages (`error.tsx`, `global-error.tsx`) show a generic message and the error digest only; details stay in the server log.
- No credentials, hosts or connection strings are committed; `.env*` files are gitignored.

---

## 8. Frontend pages (`apps/web/src/app/`)

| Route | Purpose |
|---|---|
| `/login`, `/register` | Auth (register has no role picker, country via searchable `CountrySelect`) |
| `/forgot-password`, `/reset-password` | Password reset request and new-password form (token from the emailed / logged link) |
| `/catalogue` | Listing search — **table view**, filters incl. dynamic `tire_type` per segment, own listings greyed out with Edit instead of Request |
| `/catalogue/[id]` | Listing detail + "Send Request" form |
| `/listings` | My Listings — filters, multi-select checkboxes, bulk activate/deactivate/delete, per-row Edit/Activate-Deactivate/Delete, Excel export/import buttons |
| `/listings/new`, `/listings/[id]/edit` | Create/edit listing form (segment→tire_type cascading select, CountrySelect, price fields marked "private") |
| `/listings/import` | Two-step Excel bulk upload UI |
| `/requests`, `/requests/[id]` | Incoming/outgoing requests; seller sees recommended price with "Use this price" button; full `TireInfo` block |
| `/deals`, `/deals/[id]` | Deal list with seller/buyer names + pickup status badge; deal chat with file attachments and "I received the goods" button (buyer-only) |
| `/admin`, `/admin/users` | Admin dashboard (KPIs + global Excel export), user approval queue |
| `error.tsx`, `global-error.tsx` | Generic error message + digest (no stack trace) |

### Shared components (`apps/web/src/components/`)
- `Navbar` — top nav, role-aware (Admin link only for admins)
- `ListingCard` — legacy card view component (catalogue now uses a table)
- `TireInfo` — reusable tire description block used across requests/deals
- `CountrySelect` — searchable country dropdown (ISO code stored, full name displayed); static list in `lib/countries.ts`
- `TireSizeInput` — free-text tire size entry with client-side hint

### State/data
- `AuthContext` — JWT in localStorage (`tt_token`), fetches `/auth/me` on load
- `lib/api.ts` — fetch wrapper (`api.get/post/patch/delete/upload`), throws `ApiError` with status+message; base URL from `NEXT_PUBLIC_API_URL` (baked in at build time)
- No global state library — page-local `useState`/`useEffect`.

---

## 9. Tests

`npm test` (from the repo root or `apps/api`):

| Suite | Type | Covers |
|---|---|---|
| `auth/auth.service.spec.ts` | unit | registration (duplicate email, pending status, password hashing), login (wrong credentials, pending/blocked accounts); with a failing email client: forgot-password still answers generically, register still succeeds, no token in logs |
| `common/email/email.service.spec.ts` | unit | Resend mocked: start-up check (production needs key + sender), dev/test stub, payload, failures return false instead of throwing, nothing sensitive logged, company/admin recipients |
| `common/email/email-templates.spec.ts` | unit | every template: subject, HTML + text, app link (escaped), no external resources, no price/contact data |
| `listings/listing-expiry-notifier.spec.ts` | unit | 3-day window query, one email per company, marking only after a successful send, job never throws |
| `common/tire-size.parser.spec.ts` | unit | all 6 size formats + invalid input |
| `vat/vat.service.spec.ts` | unit | VIES lookup, 24 h cache, input normalisation, VIES unavailable |
| `test/critical-paths.e2e.spec.ts` | integration | price never leaks to non-owners, soft delete hides rows, auth guards (401, pending/blocked login), contact reveal only after deal, login rate limit (429) |

The e2e suite needs a real **disposable** database (e.g. the local `docker-compose.yml` Postgres) — never staging or production. It builds the schema by running the migrations before the app starts.

---

## 10. Known gaps / things not implemented

- No Content-Security-Policy yet (needs tuning for Next.js); HSTS `max-age` is still short (1 day) and should be raised once HTTPS has proven stable.
- Rate-limit counters are in memory: they reset on every API restart and would not be shared across several API instances.
- Users cannot opt out of notification emails yet.
- No CI/CD — deploys are manual (`git pull` + build + `pm2 restart` on the server).
- `POST /auth/reset-password` is not rate-limited (the token itself is 256-bit and single-use).
- The password reset flow has unit tests only for its email side; token use/expiry has no automated tests yet.
- Migrations and entity definitions differ cosmetically (types, enum/index names); `synchronize` must stay off. A cleanup migration could align them.
- `dealer`/`distributor` role distinction removed from logic but DB enum/columns retained.
- `visible_regions` column exists but no UI sets or reads it.
- Single admin account (created with `seed-admin.ts`), no admin invite flow.
- Planned future work: Distributor Orders module and role reintroduction — see `docs/future/`.
