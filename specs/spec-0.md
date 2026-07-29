# Spec 0 — Live cash position from JENKI's real accounts

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Phase   | 0 — De-risk spike                                |
| Status  | Not started (pending signed terms)               |
| Gate    | On-screen position matches owner's 3 real logins |
| Owner   | Manthan                                          |

## Problem

Before committing months of build, prove the hardest, riskiest capability works:
unifying real bank and accounting data into one true cash position. If this is a
swamp, we find out in three weeks, not a year. This spec exists to de-risk, not to
build production features.

## Users

JENKI's finance owner (Luke), viewing JENKI's own HSBC, Starling and Xero data. Single
tenant, single user — multi-tenant onboarding is out of scope for this spec.

## Outcome

One screen shows JENKI's true current cash position — cleared cash across banks, plus
what's committed in/out from Xero — and it matches what Luke sees when he logs into each
service manually.

## Functional Requirements (EARS)

- When a Starling personal access token is provided, the system shall ingest balance and
  transactions for the connected account (read-only).
- When Xero is authorised via OAuth2, the system shall ingest open invoices, bills and
  the chart of accounts.
- When HSBC data is available (aggregator feed or CSV fallback), the system shall ingest
  its transactions through the same normalised interface as every other source.
- When all sources are ingested, the system shall present a single consolidated cash
  position that distinguishes cleared cash from committed (expected) in/out.

## Non-goals

Forecasting, scenarios, sector logic, recommendations, multi-tenant onboarding, payment
execution, exhaustive reconciliation edge cases, polished UI. Read-only throughout.

## Edge cases

- Duplicate transactions across sources (idempotent ingestion required).
- Pending vs accounted/booked transactions.
- Timing differences between a bank movement and its Xero entry.
- Missing or partial Xero data; partial bank sync.

## Acceptance criteria

1. The on-screen position reconciles to a **golden snapshot** of JENKI's accounts on a
   fixed date, within a defined tolerance, asserted in `/evals`.
2. The live HSBC access path is either working, OR the regulatory time/cost to obtain it
   is documented in `progress-tracker.md`.

## Constitution / invariant check

Touches invariants in `architecture.md`:
- #1 append-only ledger — ingested transactions are immutable; position is derived.
- #2 read-only — no money movement anywhere in this spec.
- #3 tenant isolation — single tenant, but tenantId carried from the start.
- #4 integer money — all amounts as integer minor units + currency.
- #5 verified figures — position asserted against the golden snapshot.
- #6 anti-corruption layer — Starling/Xero/HSBC normalised in `integrations/`.

No invariant is violated.

## Task breakdown (each ≈ one session)

1. Repo run-ready: env, Postgres (docker-compose), Prisma migrate, auth skeleton.
2. `integrations/banking/starling`: personal-token client → `NormalisedTransaction[]`.
3. `integrations/xero`: OAuth2 + pull invoices/bills/chart of accounts.
4. `integrations/banking/hsbc`: aggregator sandbox client + CSV fallback importer.
5. `core/ledger`: ingest normalised transactions (idempotent) into the append-only store.
6. `core/position`: derive consolidated cleared vs committed position.
7. `evals`: capture JENKI golden snapshot on a fixed date; assert position matches.
8. `app`: one read-only position screen.

## Verification

`npm run eval` is green: `computePosition(golden.transactions)` equals the golden
snapshot's expected cleared/committed totals within tolerance. Manual check: the screen
matches Luke's HSBC + Starling + Xero logins.

## Dependencies / open questions

- Signed terms before build begins (hard gate).
- Aggregator choice (TrueLayer vs Yapily) + live-HSBC onboarding lead time.
- JENKI Xero org access + a fixed-date snapshot for the golden dataset.
