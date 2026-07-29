# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- Phase 0 — De-risk spike. Not started (pending signed terms before build begins).

## Current Goal

- **Spec 0** — Show JENKI's true cash position from live HSBC, Starling and Xero on one
  screen, reconciled, matching the owner's real logins within tolerance.

## Completed

- None yet. (Diligence, roadmap, budget, and engineering handbook prepared.)

## In Progress

- None yet. First step is repo + context scaffolding and the integration spike.

## Next Up

1. Repo, CI, auth skeleton, multi-tenant Postgres (RLS), secrets.
2. Starling personal-token ingestion (fastest real-data win).
3. Xero OAuth2 against the demo org, then JENKI's org.
4. Start aggregator (TrueLayer/Yapily) live-HSBC onboarding in parallel; build against
   the sandbox/mock bank meanwhile; CSV fallback for real HSBC numbers if onboarding lags.
5. Internal ledger model + normalised ingestion behind `integrations/`.
6. Reconciliation (pending vs accounted, duplicates, timing) → consolidated position screen.
7. Golden snapshot of JENKI's accounts on a fixed date as the eval gate for Spec 0.

## Open Questions

- Accounting partner not yet confirmed — gates all sector and timing rules (Phase 5+).
- Aggregator choice (TrueLayer vs Yapily) pending which connects HSBC + Starling cleanly
  and the live-access onboarding terms.
- Sector for Phase 5 (retail vs hospitality) — to be chosen before sector logic begins.
- Final product name — placeholder "Cash Flow Intelligence Platform" for now.
- Commercial terms (role/equity/IP/vesting/scope) must be signed before build starts.

## Architecture Decisions

- **Modular monolith** (Next.js app + Python forecast service), not microservices —
  solo-builder velocity.
- **Money as integer minor units + currency code** — no floating-point money. Avoids
  rounding errors in financial calculations.
- **Multi-tenancy via Postgres Row-Level Security** — hard isolation cheaply.
- **Anti-corruption layer in `integrations/`** — domain never depends on provider schemas;
  avoids lock-in to one aggregator's pricing/shape.
- **Golden-dataset eval harness as the verification gate** — financial code is only "done"
  when numbers match ground truth; this is what makes AI-assisted money code safe.
- **Read-only scope** — no payment execution; stays out of FCA payment permissions.

## Session Notes

- Build does not begin until commercial terms are signed (hard gate).
- Spike has a hard pass/fail gate at day ~30: on-screen position matches the owner's three
  real logins, or the live-HSBC regulatory cost/time is documented.
