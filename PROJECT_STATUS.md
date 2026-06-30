# Tyre Terra — Project Status

_Last updated: 2026-06-29_

B2B marketplace for anonymous TBR/PCR/OTR/AGRI/MH tire exchange across Europe.
Sellers list inventory, buyers send requests, sellers counter with a price, buyer accepts → deal + in-app chat with file attachments.

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

**Production deployment** (manual, not CI/CD):
- Server: `84.247.189.142` (Ubuntu 24.04, 8GB RAM)
- Process manager: PM2 — `tyreterra-api` (port 3001), `tyreterra-web` (port 3000)
- Reverse proxy: nginx — `/api/*` → :3001, `/*` → :3000, `/uploads/*` → static files
- Database: Neon PostgreSQL (cloud, shared between dev and prod — **no separate staging DB**)
- File uploads: stored at `/var/www/uploads/` on the server, served via nginx
- Deploy process: build locally → tar `dist`/`​.next` + `package.json` → scp → extract → `npm install --omit=dev` → `pm2 restart`

**Source of truth:** GitHub — `OttoOtter-hub/tyreterra-web`, branch `master`.

---

## 2. Backend modules (`apps/api/src/`)

| Module | Responsibility |
|---|---|
| `auth/` | Register, login, JWT issuance, `/auth/me` profile |
| `companies/` | Company entity (referenced by users, listings, ratings) |
| `listings/` | Tire inventory CRUD, search, Excel export/import |
| `requests/` | Buyer → seller purchase requests |
| `offers/` | Seller's price response to a request (encrypted at rest) |
| `deals/` | Created when buyer accepts an offer; in-app chat lives here |
| `messages/` | Chat messages (text + file attachments) scoped to a deal |
| `admin/` | User approval queue, KPI dashboard, audit log, VAT override, global listing export |
| `ratings/` | Seller star rating, recalculated from deal history |
| `vat/` | EU VIES VAT number validation |
| `audit/` | Append-only audit log (every state-changing action writes here) |
| `common/` | `EncryptionService` (AES-256-GCM), tire size parser, email stub |

### Auth & roles
- JWT bearer auth (`JwtAuthGuard`), `AdminGuard` for `/admin/*`.
- User roles: `dealer`, `distributor`, `admin` — **the dealer/distributor distinction was removed from business logic** (registration no longer asks for it, catalogue search no longer filters by it). The enum values still exist in the DB for backward compatibility.
- New users land in `status: pending` and need admin approval (`POST /admin/users/:id/approve`) before they can log in.

---

## 3. Database schema (PostgreSQL via Neon)

### `companies`
id, name, country (CHAR2), vat_number, vat_verified, vat_verified_at, short_description, contact_email_encrypted, contact_phone_encrypted, timestamps.

### `users`
id, email (unique), password_hash, role (`dealer`/`distributor`/`admin`), status (`pending`/`active`/`blocked`), company_id → companies, gdpr_consent, gdpr_consent_at, tos_accepted_at, timestamps.

### `listings` (core inventory table)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid → companies | cascade delete |
| segment | enum `listings_segment_enum` | `TBR, PCR, OTR, AGRI, MH` |
| tire_type | varchar(30), nullable | subtype per segment (see §4) |
| brand | varchar(100) | |
| sku | varchar(100), nullable | seller's own article number |
| size_format / size_width / size_aspect_ratio / size_construction / size_rim / size_raw | parsed tire size — see §5 |
| pattern | varchar(100), nullable | |
| load_index | varchar(30), nullable | e.g. `12PR`, `173D/178A8` |
| origin_country | varchar(100), nullable | ISO alpha-2 code, country of manufacture |
| qty | integer ≥1 | |
| dot_code | varchar(4), nullable | **repurposed as production year (YYYY)**, validated `200[0-2]\d` |
| location_country | char(2) | ISO alpha-2 |
| location_region | varchar(100), nullable | |
| condition | enum | `new, used, retreaded` |
| price_internal_encrypted | text, nullable | AES-256-GCM encrypted; **owner-only** |
| price_currency | char(3), nullable | |
| visible_regions | text[], nullable | unused by current UI |
| exclude_own_region | boolean | hide from own country |
| allowed_roles | enum | `all/dealer/distributor` — field kept, no longer enforced |
| status | enum | `active, inactive, expired` |
| expires_at | timestamptz | 30-day TTL from creation/renewal |
| created_at / updated_at | timestamptz | |

Indices: `(size_width, size_rim, size_construction)`, `segment`, `brand`, `company_id`, `status`, `expires_at`.

### `requests`
id, listing_id → listings, buyer_company_id → companies, qty_requested, comment, status (`pending/offered/accepted/rejected/cancelled`), timestamps.

### `offers`
id, request_id (1:1) → requests, price (encrypted), currency, terms_text, status (`pending/accepted/rejected`), timestamps.

### `deals`
id, offer_id (1:1) → offers, **status** (`pending_pickup`/`completed`), accepted_at, **completed_at**, contact_revealed_at, timestamps.

### `messages`
id, deal_id → deals, sender_company_id → companies, body (nullable text), **file_url** (varchar 500, nullable), **file_name** (varchar 255, nullable), created_at.

### `ratings`, `audit_logs`
Standard support tables — rating score/interaction_count per company; audit_logs records `event_type`, `actor_id`, `target_id`, `target_type`, `payload` (jsonb) for every mutating action.

### Migrations applied (in order)
1. `InitialSchema` — base schema
2. `AddLoadIndexOriginCountry` — listings.load_index, origin_country
3. `AddMessageAttachments` — messages.file_url, file_name; body made nullable
4. `AddPcrMhSegmentsAndTireType` — PCR/MH added to segment enum; listings.tire_type column
5. `AddSkuToListings` — listings.sku
6. `AddDealStatus` — deals.status, completed_at

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

Size is editable after listing creation — `PATCH /listings/:id` re-parses if `size` is provided, recomputing all 5 derived columns.

---

## 6. API endpoints

All routes prefixed `/api`. JWT bearer required unless noted.

### Auth (`/auth`) — public
- `POST /register` — creates company + user (status=pending), no role selection (defaults to dealer)
- `POST /login` — returns JWT; rejects pending/blocked users
- `GET /me` — current user profile

### Listings (`/listings`)
- `POST /` — create (segment, tire_type, brand, sku, size, pattern, load_index, origin_country, dot_code(year), qty, condition, location, price, currency, exclude_own_region)
- `GET /mine` — own company's listings (all statuses), decrypted price included
- `GET /export` — Excel download of own listings
- `GET /import/template` — Excel template download
- `POST /import` — bulk-create from uploaded `.xlsx`; **aborts entirely on first row error**, returns row number + message
- `GET /?segment=&tire_type=&brand=&size_raw=&location_country=&condition=&qty_min=&min_rating=&page=&limit=` — public catalogue search (active listings only, excludes encrypted price)
- `GET /:id` — single listing; returns decrypted `price`/`currency` only if viewer owns it
- `PATCH /:id` — update (owner or admin); re-parses size if provided
- `POST /bulk-action` — `{ids, action: 'delete'|'deactivate'|'activate'}` (owner or admin)
- `POST /:id/activate` / `POST /:id/deactivate` — single-item status toggle
- `DELETE /:id` — **hard delete** (owner or admin)
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
- `POST /:id/messages/upload` — multipart file upload (images/PDF/Word/Excel, 10MB max) → creates a message with `file_url`

### Admin (`/admin`) — `AdminGuard` required
- `GET /dashboard` — KPI counts
- `GET /users/pending`, `POST /users/:id/approve`, `POST /users/:id/block`, `POST /users/:id/unblock`, `PATCH /users/:id/role`
- `DELETE /listings/:id` — admin listing removal (soft, sets inactive)
- `GET /listings/export` — Excel of **all** listings across all companies (includes company name column, no contact data)
- `POST /companies/:id/vat-verify` — manual VAT override
- `GET /audit-log?event_type=&actor_id=&from=&to=&page=&limit=`
- `POST /companies/:id/recalculate-rating`

### VAT (`/vat`)
- `POST /check` — EU VIES validation lookup

---

## 7. Security notes

- Passwords: bcrypt, 12 rounds.
- Prices: AES-256-GCM via `EncryptionService`, key derived from `ENCRYPTION_KEY` env var (scrypt). Plaintext price never leaves the server except to the listing owner or the seller viewing their own request.
- `password_hash` stripped from **all** admin user-list/detail responses (fixed after initial audit found it leaking).
- File uploads: MIME-type allowlist, 10MB cap, UUID-based filenames (no path traversal), stored outside the web root, served read-only via nginx.
- Tire size, location country, condition, segment are all server-side validated (`class-validator`) — never trust the frontend.

---

## 8. Frontend pages (`apps/web/src/app/`)

| Route | Purpose |
|---|---|
| `/login`, `/register` | Auth (register has no role picker, country via searchable `CountrySelect`) |
| `/catalogue` | Public listing search — **table view** (not card grid), filters incl. dynamic `tire_type` per segment, own listings greyed out with Edit instead of Request |
| `/catalogue/[id]` | Listing detail + "Send Request" form |
| `/listings` | My Listings — filters, multi-select checkboxes, bulk activate/deactivate/delete, per-row Edit/Activate-Deactivate/Delete, Excel export/import buttons |
| `/listings/new`, `/listings/[id]/edit` | Create/edit listing form (segment→tire_type cascading select, CountrySelect, price fields marked "private") |
| `/listings/import` | Two-step Excel bulk upload UI |
| `/requests`, `/requests/[id]` | Incoming/outgoing requests; seller sees recommended price with "Use this price" button; full `TireInfo` block |
| `/deals`, `/deals/[id]` | Deal list with seller/buyer names + pickup status badge; deal chat with file attachments and "I received the goods" button (buyer-only) |
| `/admin`, `/admin/users` | Admin dashboard (KPIs + global Excel export), user approval queue |
| `error.tsx`, `global-error.tsx` | Custom error boundaries showing actual stack trace (debug aid, not removed yet) |

### Shared components (`apps/web/src/components/`)
- `Navbar` — top nav, role-aware (Admin link only for admins)
- `ListingCard` — used in catalogue (legacy card view component, table view in catalogue/page.tsx replaced its usage there but component still exists)
- `TireInfo` — reusable tire description block (size, brand, badges, specs) used across requests/deals
- `CountrySelect` — searchable country dropdown (ISO code stored, full name displayed); static list in `lib/countries.ts`
- `TireSizeInput` — free-text tire size entry with client-side hint

### State/data
- `AuthContext` — JWT in localStorage (`tt_token`), fetches `/auth/me` on load
- `lib/api.ts` — fetch wrapper (`api.get/post/patch/delete/upload`), throws `ApiError` with status+message
- No global state library — page-local `useState`/`useEffect`.

---

## 9. Known gaps / things not implemented

- No automated tests run against this deployment (manual `verify` skill passes used during the session).
- No CI/CD — every deploy is a manual build+scp+pm2 restart by the assistant.
- `apps/web` build artifacts deploy from local Windows machine; no Docker image.
- `dealer`/`distributor` role distinction removed from logic but DB enum/columns retained — could be fully removed in a future cleanup migration.
- `visible_regions` column exists but no UI sets or reads it.
- Single admin account (seeded via `seed-admin.ts`), no admin invite flow.
- No password reset flow.
- No rate limiting on `/auth/login` or `/auth/register`.

---

## 10. Credentials & access (for reference — rotate before public launch)

- Admin login: `admin@tyreterra.com` / `Admin1234!`
- Server: `root@84.247.189.142` (password was shared in chat — **already flagged for rotation**)
- Database: Neon PostgreSQL, connection string in `apps/api/.env` (not committed to git)
