# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- Phase 0 — De-risk spike. Not started (pending signed terms before build begins).

## Current Goal

- **Spec 0** — Show JENKI's true cash position from live HSBC, Starling and Xero on one
  screen, reconciled, matching the owner's real logins within tolerance.

## Completed

- Diligence, roadmap, budget, and engineering handbook prepared.
- **Repo consolidated and run-ready** (2026-07-29). The skeleton had unzipped doubly-nested
  with each copy holding unique files; merged into one project root and initialised as its
  own git repo. Note: the parent directory `~` is itself a git repo — never commit from there.
- **Spec 1 — Xero connection and read** (2026-07-29). OAuth2 consent → token exchange →
  `/connections` → authorised reads of Organisation, Accounts and Invoices, normalised into
  the internal model and rendered read-only at `/xero`. 91 tests green including the money
  eval gate. Live Demo Company run still pending Xero app credentials.

## In Progress

- Spec 1 manual verification: connect the Xero Demo Company (UK) and confirm three invoice
  totals against the Xero UI to the penny.

## Next Up

1. ~~Xero OAuth2 against the demo org~~ — done (Spec 1); needs a live credentialled run.
2. Plaid sandbox ingestion behind the same `BankConnector` interface.
3. Postgres up (docker compose), Prisma migrate, RLS policies, and Xero tokens moved from
   the local file store into the database.
4. Ledger ingestion: normalised commitments and transactions written append-only, idempotently.
5. Recurring-rule engine against Luke's spreadsheet as fixtures — pure logic, buildable now
   with no bank access.
6. Reconciliation (pending vs accounted, duplicates, timing) → consolidated position screen.
7. Start aggregator live-HSBC onboarding in parallel; CSV fallback if onboarding lags.
8. Golden snapshot of JENKI's accounts on a fixed date as the eval gate for Spec 0.

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
- **No `xero-node` SDK** (Spec 1) — plain `fetch` against four REST endpoints. The SDK
  carries a large dependency tree and returns its own model types, which would leak vendor
  shapes past the anti-corruption boundary.
- **Read-only OAuth scopes only** (`accounting.*.read`) — invariant #2 enforced by Xero
  itself, not just by our discipline. Requesting a write scope would need a written decision.
- **String-based decimal → minor units** (`core/decimal.ts`) — provider money arrives as a
  JSON number, and BOTH naive conversions are wrong on different values:
  `Math.round(1.005 * 100)` is 100, and `(1.045).toFixed(2)` is "1.04". Neither can check
  the other, so conversion goes via the shortest round-trip string and BigInt. Pinned by
  `evals/golden/xero-money.golden.json`.
- **Normalisation reports failures rather than throwing or dropping** — one malformed
  invoice must neither blank the position screen nor vanish from it silently.
- **Token refresh is serialised in-process** — Xero refresh tokens are single-use, so two
  concurrent refreshes would kill the connection until re-authorisation.
- **Token storage behind a `XeroTokenStore` interface** — a gitignored local file for the
  spike; Postgres + secret manager swap in for Spec 2 without changing call sites.

## Session Notes

- Build does not begin until commercial terms are signed (hard gate).
- Spike has a hard pass/fail gate at day ~30: on-screen position matches the owner's three
  real logins, or the live-HSBC regulatory cost/time is documented.
