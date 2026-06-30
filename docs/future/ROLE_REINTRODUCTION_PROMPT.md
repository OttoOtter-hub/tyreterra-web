# Prompt — Reintroduce Dealer/Distributor Role (Scoped to Distributor Orders Module Only)

Run this in Claude Code on the `staging` database first. Verify, then deploy to production separately once confirmed working.

---

## Context to give Claude Code

```
We're starting the Distributor Orders module (spec: SECTION_16_DISTRIBUTOR_ORDERS.md, sections §16-19). This module requires the dealer/distributor role distinction, which currently exists in the DB enum but is not enforced anywhere — the existing Listings exchange (requests/offers/deals) intentionally stays role-agnostic and must NOT be changed.

Scope the role enforcement narrowly:
1. Only `distributor`-role users can create entries in the new `distributor_catalog_items` table (once it exists) or access distributor-only endpoints in this new module
2. Only `dealer`-role users can browse the distributor catalog and create order_requests in this new module
3. Do NOT add role checks to any existing endpoint under /listings, /requests, /offers, /deals — those stay exactly as they are now (role-agnostic)
4. Registration currently defaults every new user to `dealer` with no role picker. Add the role picker back to registration (Dealer / Distributor), since a company now needs to declare which one it is to use the new module. Existing users without an explicit choice keep their current role (dealer) — no migration needed for existing accounts unless they want to switch (see point 5)
5. Add an endpoint for an existing active company to request a role change (dealer ↔ distributor) — this should go through admin approval, not be self-service, since it affects what the company can do on the platform (similar pattern to existing admin role-edit endpoint, but exposed as a self-request + admin confirm flow)

Run this against the staging database. Show me the plan (which files change, what the registration form change looks like) before writing code, since this touches the auth/registration flow that's already live in production.
```

---

## What to verify after Claude Code finishes (on staging)

- Existing users (already registered before this change) can still log in and use Listings/Requests/Offers/Deals exactly as before — nothing broken
- New registration shows the Dealer/Distributor picker
- A `distributor`-role test account can hit the (still placeholder/future) distributor-only routes; a `dealer`-role account gets rejected from them
- A `dealer`-role test account is rejected if it tries to act as a distributor in the new module, and vice versa
- Listings/Requests/Offers/Deals endpoints still work identically for both roles — confirm with a quick manual test on each, not just code review

Once this is confirmed on staging, we move to §19.1 — building the actual `distributor_catalog_items` table and CRUD module.
