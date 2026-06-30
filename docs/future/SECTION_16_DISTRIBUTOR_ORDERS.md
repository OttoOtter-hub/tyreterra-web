## 16. Distributor Catalog & Order Module

A second, standalone marketplace mode — separate from the anonymous Listings exchange (§4–§9). Accessible from the main dashboard via a dedicated entry point ("Order from Distributors"). Unlike Listings, this mode is **non-anonymous**: distributor identity, region, and warehouse are visible upfront. Only price stays hidden until the distributor responds.

This module covers made-to-order / catalog-based procurement, not surplus inventory trading.

---

### 16.1 Distributor Storefront

Each distributor with the `distributor` role can build a public storefront page containing:

| Field | Required | Notes |
|---|---|---|
| Segment | Yes | TBR / OTR / AGRI |
| Brand | Yes | From approved brand list |
| Size | Yes | Parsed via the same size parser as §4 |
| Pattern / Model | No | Free text |
| Lead time | Yes | Estimated delivery time for this position, e.g. "14–21 days" |
| Internal reference price | No | Stored but **never shown automatically** to buyers (see §16.3) |
| Warehouse / region | Yes | Visible immediately on the storefront (not hidden) |

Distributor company name, region, and warehouse location are visible to dealers at all times — this is the opposite visibility model from Listings, and is intentional: distributor reputation is a selling point here.

### 16.2 Dealer Browsing & Discovery

Dealers can filter the distributor catalog by:
- Segment, brand, size (structured picker, same logic as §4.4)
- Country / region
- Distributor (browse by specific distributor's storefront)

Price is **never shown** in browse/catalog view, regardless of whether the distributor has set an internal reference price.

### 16.3 Order Request Flow

1. Dealer finds a catalog position and opens "Request Order"
2. Dealer optionally enters a **target price** (a reference point, not a binding bid) — this field is optional; dealer can also request without specifying a price
3. A dealer **may submit parallel requests for the same position to multiple distributors simultaneously** — there is no exclusivity lock
4. **Distributors do not see each other's involvement.** A distributor cannot see that the same dealer has requested the same position elsewhere
5. Distributor receives the request and responds with one of:
   - Confirm the dealer's target price as-is
   - Offer their own pre-set internal reference price (from §16.1)
   - Type in a new custom price for this specific request
   - Distributor also confirms or adjusts lead time, and specifies payment terms
6. On distributor response, an **order-scoped chat** opens between dealer and distributor
7. Dealer reviews the offer: Accept or Reject
8. On Accept, the order is created and tracked with a status lifecycle (§16.4)

> Distributor identity is visible from step 1 (browsing). Only the price is hidden until the distributor responds in step 5.

### 16.4 Order Status Lifecycle

| Status | Set by | Trigger / Notes |
|---|---|---|
| `pending` | System | Created on dealer Accept (§16.3 step 8) |
| `ordered` | Distributor | Starts a countdown timer based on the lead time agreed in the order |
| `advance_required` | Distributor | Optional — distributor flags that upfront payment is needed before proceeding |
| `ready_for_pickup` | Distributor | Signals goods are ready; warehouse/region was already visible from §16.1, so dealer can arrange pickup or delivery from that specific location |
| `completed` | Dealer | Dealer confirms receipt — pickup-confirmation button appears only after status reaches `ready_for_pickup` |
| `cancelled` | Either party (within 24h) / Admin only (after 24h, via dispute) | See §16.5 |

### 16.5 Cancellation & Dispute Rules

- **Within 24 hours of order creation:** either party (dealer or distributor) can cancel directly — no dispute needed
- **After 24 hours:** the Cancel button disappears and is **replaced in the same UI position by a Dispute button**
- Opening a dispute brings an **Admin into the order's chat thread**. The admin sees the **full chat history from the start of the order**, not just from the dispute point
- **Only the Admin can cancel an order after the 24-hour window** has passed
- **Pickup confirmation timeout:** if the distributor sets `ready_for_pickup` and the dealer does not confirm receipt within **7 days**, the order **automatically escalates to dispute** (admin is pulled in proactively, dealer does not need to manually open it)

---

## 17. Reputation System — Distributor Order Module

This module uses a **two-sided, star-based rating system** (1–5 stars), separate in structure from the Listings reputation model in §8, but stored against the same company profile.

### 17.1 Distributor Rating (rated by Dealer)

| Parameter | Scale |
|---|---|
| Pricing | 1–5 stars |
| Communication quality | 1–5 stars |
| Delivery time accuracy | 1–5 stars |

### 17.2 Dealer Rating (rated by Distributor)

| Parameter | Scale |
|---|---|
| Payment reliability | 1–5 stars |
| Communication quality | 1–5 stars |
| Responsible pickup (collects in full, on time) | 1–5 stars |

### 17.3 Objective Completion Metric (both sides — not star-based)

A separate, system-calculated percentage, shown alongside the star ratings:

- **% of orders completed** vs. **% of orders opened and abandoned** (request sent but never resulted in an accepted order, or accepted but cancelled)
- Tracked independently for both dealer and distributor roles
- This is descriptive, not punitive — e.g. a dealer requesting a target price without following through is **not penalized**, it simply shows up transparently in their completion percentage, similar to fill-rate transparency on crypto exchanges

### 17.4 Written Reviews (Optional)

- Both parties **may** leave an optional free-text review after order completion
- Reviews are mutual: dealer can review distributor, distributor can review dealer
- Reviews are not required to complete a transaction and do not block any flow

---

## 18. Database Schema Additions

New tables required for this module, in addition to §12:

| Table | Key Fields | Notes |
|---|---|---|
| `distributor_catalog_items` | id, company_id, segment, brand, size_* fields, pattern, lead_time, internal_reference_price_encrypted, warehouse_region | Distributor's orderable catalog; price encrypted, never returned in browse responses |
| `order_requests` | id, catalog_item_id, dealer_id, target_price (nullable), comment, status | Multiple rows can exist per dealer+item across different distributors (parallel requests allowed) |
| `order_responses` | id, request_id, price, currency, lead_time_confirmed, payment_terms, response_type (confirm_target / own_preset / custom) | Distributor's reply |
| `orders` | id, response_id, status, ordered_at, ready_at, completed_at, cancel_window_expires_at | Status enum per §16.4 |
| `order_chat_messages` | id, order_id, sender_id, body, created_at | Scoped to order; admin gains access on dispute |
| `order_disputes` | id, order_id, opened_by, opened_at, admin_id, resolution, resolved_at | Tracks dispute lifecycle |
| `distributor_ratings` | id, order_id, rater_company_id, rated_company_id, pricing, communication, delivery_time, review_text (nullable) | Star ratings from dealer → distributor |
| `dealer_ratings` | id, order_id, rater_company_id, rated_company_id, payment_reliability, communication, responsible_pickup, review_text (nullable) | Star ratings from distributor → dealer |
| `completion_stats` | company_id, role, requests_opened, orders_completed, orders_abandoned, completion_rate | Recalculated nightly, same job pattern as §8 reputation cron |

---

## 19. Build Plan Addition — Suggested Order for Claude Code

Append to the build sequence in §14, as a separate track that can be developed in parallel with or after the Listings module:

### 19.1 Step A — Distributor catalog module
CRUD for `distributor_catalog_items` per §16.1. Reuse the size parser from §4/14.2. Internal reference price stored encrypted, excluded from all browse/search API responses by default.

### 19.2 Step B — Catalog browse & discovery
Search/filter endpoint per §16.2. Distributor name, region, and warehouse ARE returned in responses (opposite of the Listings hidden-fields rule) — price fields are excluded.

### 19.3 Step C — Order request & response flow
Implement §16.3: dealer creates `order_requests` (with optional target_price), distributor replies via `order_responses` with one of three price options. Enforce that distributors cannot query other distributors' requests for the same dealer+item (no visibility into parallel requests).

### 19.4 Step D — Order lifecycle & status management
Implement the `orders` state machine per §16.4. Distributor-controlled transitions (ordered → advance_required → ready_for_pickup) and dealer-controlled transition (ready_for_pickup → completed). Countdown timer logic tied to agreed lead time.

### 19.5 Step E — Cancellation, dispute escalation, and timeout automation
Implement §16.5: 24-hour cancel window, button swap logic (Cancel → Dispute) on the frontend, admin-only cancellation after the window, and the 7-day auto-escalation job for unconfirmed pickups.

### 19.6 Step F — Order-scoped chat
Per §16.3 step 6 — chat thread tied to `order_id`. On dispute, grant admin read access to full history from order creation.

### 19.7 Step G — Two-sided rating system
Implement §17: `distributor_ratings` and `dealer_ratings` tables, star-average calculation, and the separate nightly `completion_stats` job (non-punitive completion percentage, not a star rating).

### 19.8 Step H — Distributor order frontend
Dedicated UI entry point from the dashboard ("Order from Distributors"), separate navigation flow from the Listings catalog. Distributor storefront page, browse/filter UI, order request modal with optional target price, order status tracker, dispute button state, rating submission UI.

---

*Added as part of v2.1 update — Distributor Catalog & Order module, designed alongside the existing anonymous Listings exchange as a second, identity-visible marketplace mode.*
