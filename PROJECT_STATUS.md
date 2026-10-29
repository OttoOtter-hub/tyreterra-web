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
- Database: Neon PostgreSQL (separate Neon project, schema built from the 8 migrations).
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
| `common/` | `EncryptionService` (AES-256-GCM), email service (stub); the tire size parser is in `packages/tire-size` (§5) |

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
- **Emails are not sent yet:** `EmailService` is a stub that writes the message — including the reset link — to the API log (`pm2 logs tyreterra-api`). The same applies to offer/deal notifications.

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
| load_index | varchar(30), nullable | as the seller wrote it, e.g. `12PR`, `173D/178A8`, `16PR (132B)` |
| load_index_single / speed_single / load_index_dual / speed_dual / ply_rating | smallint / varchar(3), nullable | parsed from `load_index` by `parseLoadIndex` (null when unreadable); indexed: `ply_rating`, `load_index_single` |
| comment | varchar(500), nullable | seller note shown with the listing |
| origin_country | varchar(100), nullable | ISO alpha-2 code, country of manufacture |
| qty | integer ≥1 | |
| dot_code | char(4), nullable | **repurposed as production year (YYYY)** |
| location_country | char(2) | ISO alpha-2 |
| location_region | varchar(100), nullable | |
| condition | enum | `new, used, retreaded` |
| price_internal_encrypted | text, nullable | AES-256-GCM encrypted; **owner-only** |
| price_currency | char(3), nullable | |
| visible_regions | text[], nullable | enforced when set (viewer company country must be listed); no UI sets it yet |
| exclude_own_region | boolean | hide from own country |
| allowed_roles | enum | `all/dealer/distributor` — enforced (listing-visibility.ts); the UI always sends `all` |
| status | enum | `active, inactive, expired` |
| expires_at | timestamptz | 30-day TTL from creation/renewal |
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

### `listing_sizes`
All sizes of a listing: position 0 = the main size (mirrored in `listings.size_*`), 1–3 = additional sizes (e.g. `440/80-28` for a `16.9-28`). Same parsed columns as the listing; `UNIQUE(listing_id, position)`, cascade delete, indexed `(width, rim, construction)`. Catalogue search matches any size (`EXISTS`), each listing once.

### `import_batches`, `import_batch_items`, `import_mappings`
Smart import: one batch per committed file (company, user, segment, counts, `completed`/`undone`); items record each touched listing with its action (`created/updated/deactivated`) and the pre-update snapshot used by undo; mappings remember a company's column mapping per header layout (sha256 of normalised headers).

### Migrations (tracked in the `migrations` table)
1. `InitialSchema` — base schema
2. `AddLoadIndexOriginCountry` — listings.load_index, origin_country
3. `AddMessageAttachments` — messages.file_url, file_name; body made nullable
4. `AddPcrMhSegmentsAndTireType` — PCR/MH added to segment enum; listings.tire_type
5. `AddSkuToListings` — listings.sku
6. `AddDealStatus` — deals.status, completed_at
7. `AddDeletedAtToListings` — listings.deleted_at + index (soft delete)
8. `AddPasswordResetTokens` — password_reset_tokens table
9. `AddListingSizes` (1750000000009) — listing_sizes; backfills position 0 from every listing
10. `AddLoadIndexFieldsAndComment` (1750000000010) — parsed load index / speed / ply columns + comment; backfills by parsing existing `load_index`
11. `AddImportBatchesAndMappings` (1750000000011) — import_batches, import_batch_items, import_mappings

(Number 1750000000008 is reserved for the paused `feature/resend-email` branch.)

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

## 5. Tire size parser (`packages/tire-size`, `@tyreterra/tire-size`)

One shared package used by both the API and the web (built by their `prebuild` scripts).

**Strict parser** (`parseTireSize`, `src/strict.ts`) — used to store listings. Accepts 6 input formats, normalises to uppercase/no-spaces, extracts width/aspect/construction/rim:

| Format | Example | `size_construction` |
|---|---|---|
| Metric radial | `315/80R22.5` | `R` |
| Flotation (width ≥500) | `710/70R42` | `R` |
| Diagonal inch | `10.00-20` | `-` |
| Radial inch | `14.9R28` | `R` |
| Slash diagonal | `12.5/80-18` | `-` |
| L-series diagonal | `19.5L-24` | `-` (L stripped for numeric width) |

Size is editable after listing creation — `PATCH /listings/:id` re-parses if `size` is provided, recomputing all derived columns.

**Partial parser** (`parsePartialSize`, `src/partial.ts`) — used for search and for hints while typing. Never throws; returns `{width?, aspect?, construction?, rim?, format, confidence, candidates[]}` (up to 5 readings, confidences sum to 1). Understands any case, spaces, comma decimals (`22,5`), separators `/ - x` and space, a missing `R` (construction then unconstrained), glued digits (`31580R225`, `38565225`: width 3–4 digits, aspect 25–95 step 5, rim 2 digits or 3 digits ending in 5 = x.5), and input that is still being typed (`315`, `315/`, `315/80R`). Ambiguous input returns several candidates instead of a silent guess; garbage returns none.

The strict parser checks spelling only; `implausibleSize` (`src/plausible.ts`) rejects numbers no tyre has (rim outside 4–63", width outside 2–60" and 100–1600 mm, profile outside 20–110). Listing create/update and the import both apply it, so `999/99R99` or a glued `31580R225` read literally is refused. The listing form shows a "Did you mean 315/80R22.5?" hint from the partial parser.

**Load index** (`parseLoadIndex`, `src/load-index.ts`) — one parser for the form hint, the API and the import. Case and spaces ignored; `160K` → single 160 K; `160K/164J` → single + dual; `156/150L` → L for both; `173D/178A8`; `16PR`, `12 PR`, `PR16`, `16 ply` → ply; `16PR (132B)`, `132B 16PR` → ply + single. Unreadable text is kept, parsed fields null, with a warning.

**Glued cells** (`parseGluedCell`, `src/cell.ts`) — reads everything out of one cell: all sizes (incl. ones in brackets, glued digits, comma decimals, LT/ZR), qty (`14pcs`, `x14`, `14 шт`, `qty 14`), year/DOT, load index and ply, condition, tyre type of the segment, country ("made in …", names in 6 languages), brand (fixed directory `src/brands.ts`, aliases incl. Cyrillic, typo-tolerant), pattern (text next to the brand). Whatever is left is returned as `unrecognized` — never dropped. Field parsers: `parseQty`, `parseYear`, `parseCondition`, `parsePrice` (comma decimals, €/$/EUR/USD, ambiguous `1,234` flagged), `parseTireType`.

Not supported yet: "x" sizes (`28x9-15`, `18x7-8`, `31x10.50R15`) — reported as an unsupported size in the import, never guessed.

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
- `POST /import` — fixed-template bulk create from `.xlsx` (fallback to the smart import); **aborts entirely on first row error**; reads an `Alt size` column (`;`-separated)
- Smart import (`/listings/import/*`, `listings/import/`): JWT + active company, 30 requests/min per user (commit 20/min). Files stay in memory (≤5 MB, ≤5000 rows, signature + MIME + extension checked, zip-bomb guard before unpacking, formulas never evaluated — the saved result is taken), row contents are never logged.
  - `POST /import/analyze` (multipart `file`, `segment`, optional `sheet`, `header_row`) — sheets, detected header row, columns with type / confidence / 5 samples / glued flag, saved mapping applied when the header layout matches
  - `POST /import/preview` (multipart `file` + `options` JSON: segment, sheet, header_row, mapping, defaults {condition, location_country, location_region, tire_type}, update_mode) — rows in our model with status ok/warning/error, messages, unrecognized text, alternatives, action new/update/unchanged/skip; file-level hint when sizes look like another segment. Writes nothing.
  - `POST /import/commit` (JSON, body ≤ 8 MB) — re-validates every row with `CreateListingDto` + size rules (unknown fields, another company, qty 0, bad size → that row is an error); `dry_run` returns the re-checked rows; creates/updates in one transaction as a batch with snapshots, audit `listings.imported`, saves the mapping, returns counts + `errors_csv` (CSV-injection escaped). Update key: seller SKU, else segment + brand + pattern + main size + year; the same tyre twice in a file is an error. Listings missing from the file are untouched unless `deactivate_missing` with `expected_deactivate` equal to the server's count (409 otherwise).
  - `GET /import/batches` — the company's imports of the last 24 h
  - `POST /import/batches/:id/undo` — own company only, within 24 h, refused while a later import touched the same listings; created listings are soft-deleted, updated ones restored from the snapshot (incl. sizes), deactivated ones re-activated; audit `listings.import_undone`
- Rim rule: all sizes of a listing must share the rim diameter. Form/API answer 409 unless `confirm_rim_mismatch: true`; the import only warns.
- `GET /?segment=&tire_type=&brand=&q=&size_raw=&location_country=&condition=&qty_min=&ply_rating=&load_index_min=&min_rating=&page=&limit=` — catalogue search (active, non-deleted, non-expired listings visible to the viewer; no price)
  - `q` — free-form size, parsed with `parsePartialSize`; matches by components (width/aspect/construction/rim), unspecified components don't constrain, ambiguous readings are OR'ed. When nothing matches, the response has `nearest`: up to 5 sizes with the same width and rim (and construction, if given) and the closest profiles. Unreadable `q` → empty result.
  - `size_raw` — legacy (old links); unchanged: width + rim + construction, ignores aspect, no `nearest`. `q` wins when both are given.
  - Visibility: the rule in `listing-visibility.ts` (below), the same for search, suggestions and nearest sizes.
- `GET /size-suggest?q=` — up to 10 sizes on offer matching `q` (same visibility rules), each `{size, width, aspect, construction, rim, count}` — no prices, companies or listing ids. 5 s cache per company + query, 60 requests / 10 s per IP, 401 without JWT.
- `GET /:id` — single listing; owner gets decrypted `price`/`currency` and the company, everyone else `seller_country` only (never the company name, VAT or contacts)

**Visibility** (`listings/listing-visibility.ts`, one rule for the catalogue, `GET /:id`, owner actions and `POST /requests`): deleted — nobody; owner and admins — always; others — status active and not expired, `allowed_roles` is `all` or the viewer role, not `exclude_own_region` with the viewer company in the seller country, and the viewer company country in `visible_regions` when that is set. A listing the viewer may not see is **404**, never 403; 403 only for a visible listing that is not theirs. Existing requests, offers and deals stay readable for both parties after a listing is hidden.

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
- Plaintext price never leaves the server except to the listing owner, the seller viewing their own request, or the two parties of an offer / deal.
- Ciphertext never leaves the server: every response with a listing, request, offer, deal or company goes through `common/serializers.ts`, which drops `price_internal_encrypted`, `price_currency` (the owner gets it as `currency`), `price_encrypted` and the `contact_*_encrypted` fields. Contacts are revealed decrypted only in the `POST /offer/accept` response. The e2e suite checks every listing-returning endpoint for these fields.
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
| `/listings/import` | Smart import wizard: 1 file + segment + defaults, 2 column mapping (sheet, header row, saved mapping), 3 editable preview (100 rows/page, "only problematic", bulk set condition/country/region/type, unrecognized text → pattern/comment/ignore, alternative readings, swap main size), 4 summary → import → report with "Download errors" and "Undo import". The fixed template upload stays as a fallback under step 1. |
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
| `auth/auth.service.spec.ts` | unit | registration (duplicate email, pending status, password hashing), login (wrong credentials, pending/blocked accounts) |
| `common/tire-size.parser.spec.ts` | unit | all 6 size formats + invalid input |
| `vat/vat.service.spec.ts` | unit | VIES lookup, 24 h cache, input normalisation, VIES unavailable |
| `common/serializers.spec.ts` | unit | response serializers: owner-only price, no ciphertext or contacts, nested request/offer/deal |
| `listings/import/columns.spec.ts` | unit | column detection on 9 synthetic files (6 languages, title block, glued cells, junk rows, no header, two size columns), sheet pick, CSV reading/encodings, file signatures, formulas, zip guard, CSV injection |
| `packages/tire-size/src/*.spec.ts` | unit | strict + partial size parsers, load index (all forms + unrecognised), 49 glued cells, field parsers, brands (typos), countries, plausibility |
| `test/critical-paths.e2e.spec.ts` | integration | price never leaks to non-owners, soft delete hides rows, auth guards (401, pending/blocked login), contact reveal only after deal, listing visibility, no secret fields or ciphertext in any listing-returning endpoint, size search, several sizes per listing, smart import (messy file, update by key / no duplicates on re-upload, undo, forged commit rows, deactivate with confirmed count, search by second size, rim rule, formulas / oversized / .xls / zip bomb, body limits), login rate limit (429) |

The e2e suite needs a real **disposable** database (e.g. the local `docker-compose.yml` Postgres) — never staging or production. It builds the schema by running the migrations before the app starts.

---

## 10. Known gaps / things not implemented

- No Content-Security-Policy yet (needs tuning for Next.js); HSTS `max-age` is still short (1 day) and should be raised once HTTPS has proven stable.
- Rate-limit counters are in memory: they reset on every API restart and would not be shared across several API instances.
- Email is a stub — no real delivery (SendGrid/Postmark not wired); password-reset links are only in the API log.
- No CI/CD — deploys are manual (`git pull` + build + `pm2 restart` on the server).
- `POST /auth/reset-password` is not rate-limited (the token itself is 256-bit and single-use).
- The password reset flow has no automated tests yet.
- Migrations and entity definitions differ cosmetically (types, enum/index names); `synchronize` must stay off. A cleanup migration could align them.
- `dealer`/`distributor`: users still carry the role; listings can be limited by `allowed_roles` (enforced), but no UI sets it.
- `visible_regions` is enforced but no UI sets it yet.
- Brand directory is a fixed list in `packages/tire-size/src/brands.ts`; unknown brands are imported as `Other` (original text offered for pattern/comment). Extending it is a code change.
- "x" sizes (`28x9-15`, `18x7-8`, `31x10.50R15`) are not supported by the size parser yet.
- `npm audit` (2026-10-29, after the dependency update): no critical. What remains needs Nest 11/12 (`@nestjs/core`, moderate), sits in Nest CLI build tooling, or is in code paths not used (`file-type` in `@nestjs/common`, `uuid` in exceljs). The import reads files with exceljs 4.4.0; the abandoned npm `xlsx` 0.18.5 was not used (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363; fixes only on the SheetJS CDN).
- Single admin account (created with `seed-admin.ts`), no admin invite flow.
- Planned future work: Distributor Orders module and role reintroduction — see `docs/future/`.
