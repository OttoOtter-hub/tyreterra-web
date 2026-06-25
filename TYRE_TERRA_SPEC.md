# Tyre Terra — MVP Technical Specification v2.0

B2B Tire Inventory Exchange Platform — Europe
Segments: TBR · OTR · AGRI (PCR excluded from MVP)

---

## 0. Purpose & Scope

Tyre Terra is an anonymous B2B marketplace that allows tire dealers and distributors across Europe to exchange slow-moving inventory. The platform connects sellers and buyers without revealing company identity or pricing until both parties commit to a deal.

### In scope (MVP)
- Tire categories: TBR (truck/bus radial), OTR (off-the-road), AGRI (agricultural)
- Market: European Union + EEA countries
- Language: English only
- Roles: Dealer, Distributor, Admin

### Out of scope (MVP)
- PCR (passenger car tires)
- In-platform payments or escrow
- ERP integrations
- Mobile application
- USA / North America market (next phase)
- Complex analytics dashboards

---

## 1. User Roles

| Role | Description | Key Permissions |
|---|---|---|
| Dealer | End-user tire retailer or workshop | List inventory, search, request offers, accept/reject |
| Distributor | Regional or national wholesaler | Same as Dealer + broader listing visibility |
| Admin | Platform operator | Approve accounts, block users, view logs, edit roles |

> Fleets and OEM buyers are excluded from MVP. Consider for v2 as read-only browsing accounts.

---

## 2. Registration & Onboarding

### 2.1 Sign-up Fields
- Email + password (min 12 chars, 1 uppercase, 1 number)
- Company name
- Country (EU/EEA country picker)
- Role: Dealer / Distributor
- VAT number (EU companies — validated via VIES API on submission)
- GDPR consent checkbox (mandatory) — links to Privacy Policy
- Terms of Service acceptance (mandatory)

### 2.2 Verification & Moderation
- VIES API check: validates VAT format + active status in real time
- Account goes to `Pending` status after sign-up
- Admin manually approves or rejects (target SLA: 24 hours)
- User receives email notification on approval/rejection

> Non-EU companies (e.g. Switzerland, UK, Norway): VAT field optional, manual verification via company registration document upload (PDF/JPG, max 5 MB).

---

## 3. Company Profile

| Field | Notes |
|---|---|
| Company name | Displayed only after deal Accept |
| Country / Region | Visible in listing (country level only) |
| Role | Dealer or Distributor — shown as badge |
| VAT number | Internal only — not displayed to other users |
| Rating | System-calculated 1–5 stars (see §8) |
| Short description | Optional, max 300 chars, visible after reveal |
| Contact email/phone | Hidden until Accept — then shown to counterpart |

---

## 4. Tire Size — Formats & Database Design

Tire sizes across TBR, OTR, and AGRI segments are recorded in multiple formats. The platform must handle all variants correctly in search and filtering.

### 4.1 Supported Formats

| Format | Example | Segment |
|---|---|---|
| Metric radial | 315/80R22.5 | TBR, AGRI |
| Diagonal inch | 10.00-20 | TBR (old fleet), OTR |
| Radial inch | 14.9R28 | AGRI |
| Flotation / Wide | 710/70R42 | AGRI |
| Large OTR | 23.5R25 | OTR |

### 4.2 Database Schema — Size Fields

Size is **NOT** stored as plain text. It is parsed into components at entry:

| DB Field | Example Value | Notes |
|---|---|---|
| `size_format` | metric / diagonal_inch / radial_inch / flotation | Detected by parser |
| `size_width` | 315 or 10.00 | Numeric, supports decimals |
| `size_aspect_ratio` | 80 | Null for diagonal inch formats |
| `size_construction` | R or – | R = radial, – = diagonal |
| `size_rim` | 22.5 or 20 | Numeric |
| `size_raw` | 315/80R22.5 | Original string — used for display only |

### 4.3 Size Input — Parser & Validation
- Single free-text field for size entry
- Front-end parser detects format automatically on blur
- Shows parsed breakdown below field for user confirmation
- Rejects unrecognised formats with clear error message and format examples
- Normalises spacing variants: `315/80 R 22.5` → `315/80R22.5`

### 4.4 Search Logic
- Search is performed on parsed components (`size_width` + `size_rim` + `size_construction`), not on `size_raw` string
- UI shows a structured picker: Width → Aspect Ratio (optional) → Construction → Rim
- Also supports raw string search with parser applied

> This approach prevents duplicates like `315/80R22.5` vs `315/80 R 22.5` appearing as separate SKUs, and enables correct matching across format variants.

---

## 5. Inventory Listing

### 5.1 Required Fields

| Field | Required | Notes |
|---|---|---|
| Segment | Yes | TBR / OTR / AGRI — picker |
| Brand | Yes | Dropdown from approved brand list + "Other" |
| Size | Yes | Free-text + parser (see §4) |
| Pattern | No | Free-text; brand-filtered suggestions |
| Quantity | Yes | Integer, minimum 1 |
| DOT / Production year | No | Format: WWYY (e.g. 1423) |
| Location | Yes | Country + region/state |
| Condition | Yes | New / Used / Retreaded |
| Price | No | NEVER shown — internal reference only (optional) |

> **NO PRICE is displayed in the catalogue.** Price is communicated only within a private Offer message after the buyer sends a Request.

### 5.2 Visibility Settings
- Visible regions: multiselect — which countries/regions can see this listing
- Exclude own region: toggle — hide from companies in seller's own country
- Allowed roles: Dealer only / Distributor only / Both
- Listing expires after 30 days (auto-deactivated; seller notified by email)
- Seller can manually deactivate, edit, or renew at any time

---

## 6. Catalogue & Search

### 6.1 Displayed in Results
- Segment badge (TBR / OTR / AGRI)
- Size (`size_raw`)
- Brand
- Pattern (if provided)
- Quantity
- Seller country/region
- Seller rating (stars)
- Condition
- Listing age (e.g. "Posted 3 days ago")

### 6.2 Hidden in Results
- Price — not shown at any point before Accept
- Company name
- Contact details

### 6.3 Filters
- Segment (TBR / OTR / AGRI)
- Brand
- Size (structured picker or raw input)
- Region / Country
- Quantity (minimum threshold)
- Condition
- Seller rating (minimum stars)

---

## 7. Transaction Flow

### 7.1 Full Flow
1. Buyer finds listing in catalogue
2. Buyer clicks "Request Offer" — specifies quantity + optional comment
3. Seller receives notification + sees request in dashboard
4. Seller responds: sends private Offer (price + terms) or Declines
5. Buyer reviews Offer: Accepts or Rejects
6. On Accept → company name + contact details revealed to both parties
7. Parties continue negotiation and fulfillment off-platform

### 7.2 Anonymity Rules

| Stage | What is revealed |
|---|---|
| Catalogue browse | Size, brand, qty, region, rating — NO name, NO price |
| Request sent | Buyer's quantity request + comment — no identity |
| Offer sent | Price + terms visible to buyer only — no company name |
| After Accept | Full company name + contact details of BOTH parties |

### 7.3 In-Deal Chat
- Available only after Request is created (both pre- and post-Accept)
- Scoped to the specific deal — no global messaging
- No file attachments in MVP
- Messages stored in DB; visible to Admin for dispute resolution

---

## 8. Reputation System

Rating is system-calculated. Users cannot manually rate each other in MVP.

| Metric | Weight / Logic |
|---|---|
| Response rate | % of incoming requests answered within 48h |
| Offer acceptance rate | % of sent offers accepted by buyers |
| Cancellation rate | % of accepted deals cancelled by seller |
| Account age | Bonus weight for accounts > 6 months |

- Score displayed as 1–5 stars (rounded to 0.5)
- Minimum 5 completed interactions required before rating is displayed
- Below threshold: shown as "New member"

> Modelled on crypto-exchange reputation logic: objective metrics only, no subjective peer reviews in MVP.

---

## 9. GDPR & Compliance (Europe)

### 9.1 Required Documents
- Privacy Policy — GDPR Article 13/14 compliant
- Terms of Service — governing law: to be defined (recommend Estonia or Netherlands)
- Cookie Policy — analytics only in MVP (no advertising cookies)

### 9.2 Data Handling
- Lawful basis: Legitimate Interest (B2B context) + Contractual necessity
- Contact data (email, phone) stored encrypted at rest
- Contact data revealed only post-Accept — logged with timestamp
- Users can request data deletion (Right to Erasure) — handled by Admin within 30 days
- Logs retained for 24 months then auto-purged

### 9.3 VAT/VIES Integration
- VIES API called on registration and on listing creation (re-validation)
- VAT validation result stored with timestamp
- Non-EU sellers: manual document upload flow (alternative path)

> VIES API is provided by the European Commission and is free to use. Rate limits apply — implement caching with 24h TTL.

---

## 10. Admin Panel
- User approval queue — Approve / Reject with reason
- Account management — block/unblock, role change
- Listing moderation — remove or flag inappropriate listings
- Transaction log viewer — all events with filters (date, user, type)
- VAT verification override — manually mark as verified
- Dashboard — KPIs: active listings, requests/day, deals/week, new signups

---

## 11. Technical Stack (Recommended)

| Layer | Technology | Notes |
|---|---|---|
| Backend | Node.js + NestJS | Or Python + FastAPI — both viable |
| Frontend | React + Next.js | SSR for SEO on catalogue pages |
| Database | PostgreSQL | Structured size fields require relational DB |
| Auth | JWT + refresh tokens | Email/password only in MVP |
| Email | SendGrid or Postmark | Transactional: alerts, notifications |
| VAT check | VIES SOAP API | EC endpoint — free, cache results 24h |
| Hosting | Railway / Render / AWS | Railway simplest for MVP speed |
| File storage | S3-compatible | For company verification docs upload |

---

## 12. Database Schema (Core Tables)

| Table | Key Fields | Notes |
|---|---|---|
| `users` | id, email, password_hash, role, status, company_id | Status: pending/active/blocked |
| `companies` | id, name, country, vat_number, vat_verified, rating | Linked 1:1 to user in MVP |
| `listings` | id, company_id, segment, brand, size_* fields, qty, condition, expires_at | size_* = 6 parsed fields from §4.2 |
| `requests` | id, listing_id, buyer_id, qty_requested, comment, status | Status: pending/offered/accepted/rejected/cancelled |
| `offers` | id, request_id, price, currency, terms_text, status | Price stored encrypted |
| `deals` | id, offer_id, accepted_at, contact_revealed_at | Triggers contact reveal |
| `messages` | id, deal_id, sender_id, body, created_at | In-deal chat |
| `ratings` | id, company_id, response_rate, accept_rate, cancel_rate, score | Recalculated nightly |
| `audit_log` | id, event_type, actor_id, target_id, payload, created_at | Immutable event log |

---

## 13. Explicitly Out of Scope (MVP)
- Payments, invoicing, escrow
- ERP / TMS integrations
- Mobile application (iOS / Android)
- PCR segment
- USA / North America market
- Public pricing
- Advertising or promoted listings
- Complex analytics (seller dashboards with charts)
- Automated freight / logistics quoting
- Multi-language UI

---

## 14. Build Plan — Suggested Order for Claude Code

Use this as a sequence of build steps. Each maps to a section above. Work through them one at a time; verify each module before moving to the next.

### 14.1 Step 1 — Project scaffolding
Set up a NestJS backend project and a Next.js frontend project (monorepo or two repos — recommend a monorepo with `/apps/api` and `/apps/web`). Configure PostgreSQL connection, TypeORM, and basic auth scaffolding (JWT).

### 14.2 Step 2 — Size parser (do this early, it's foundational)
Build a TypeScript function `parseTireSize(raw: string)` per §4. It must:
- Detect format: metric radial, diagonal inch, radial inch, flotation, large OTR
- Return `{ format, size_width, size_aspect_ratio, size_construction, size_rim, size_raw }`
- Normalise spacing variants
- Include unit tests for every format in §4.1
- Reject invalid input with a clear error

### 14.3 Step 3 — Database schema & migrations
Implement all tables from §12 as TypeORM entities + migrations: `users`, `companies`, `listings` (using the parsed size_* fields), `requests`, `offers`, `deals`, `messages`, `ratings`, `audit_log`.

### 14.4 Step 4 — Auth & registration module
Implement §2: sign-up, login, JWT issuance, `Pending`/`Active`/`Blocked` status logic, GDPR consent storage.

### 14.5 Step 5 — VIES VAT validation service
NestJS service that calls the EU VIES SOAP API. Accepts `countryCode` + `vatNumber`. Returns `{ valid, companyName, address }`. Cache results 24h (Redis or in-memory store for MVP). Handle VIES downtime gracefully.

### 14.6 Step 6 — Listings module
CRUD for listings per §5. Use the size parser from Step 2 in the create/update DTO validation. Implement visibility settings (regions, exclude-own-region toggle, allowed roles).

### 14.7 Step 7 — Catalogue & search
Search/filter endpoint per §6. Query on parsed size components, not raw strings. Respect the hidden-fields rule (never return price or company name in catalogue responses).

### 14.8 Step 8 — Transaction flow (Request → Offer → Accept)
Implement §7 end-to-end: create request, seller responds with offer (encrypted price storage) or decline, buyer accepts/rejects, on Accept create a `deal` record and trigger contact reveal + email notification to both parties. Validate state transitions (can't accept an already-accepted offer, etc.). Log every transition to `audit_log`.

### 14.9 Step 9 — In-deal chat
Simple scoped chat per §7.3, tied to `deal_id`.

### 14.10 Step 10 — Reputation cron job
Nightly job per §8: recalculate `response_rate`, `accept_rate`, `cancel_rate`, map to 1–5 star score. Companies under 5 interactions get `score = null` ("New member" in UI).

### 14.11 Step 11 — Admin panel
Endpoints + minimal UI per §10: approval queue, block/unblock, listing moderation, log viewer, VAT override, KPI dashboard.

### 14.12 Step 12 — Frontend
Build the React/Next.js UI: registration form, listing creation form (with live size parser preview), catalogue/search page, request/offer/chat UI, admin panel.

---

## 15. Post-MVP Roadmap

| Phase | Feature | Priority |
|---|---|---|
| v1.1 | PCR segment | Medium |
| v1.1 | Saved searches + email alerts | High |
| v1.2 | USA / North America market | High |
| v1.2 | Multi-language (DE, FR, PL, IT) | Medium |
| v2.0 | Fleet / OEM buyer accounts | Medium |
| v2.0 | Analytics dashboard for sellers | Low |
| v2.0 | Freight quote integration | Low |
| v3.0 | In-platform payments / escrow | TBD |

---

*Document version: v2.0 — May 2026. Changes from v1.0: PCR removed from scope; TBR/OTR/AGRI focus; tire size format parser added (§4); GDPR/VIES compliance added (§9); EU-only market for MVP; build plan reorganised for Claude Code (§14).*
