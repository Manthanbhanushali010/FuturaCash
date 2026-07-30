# Spec 1 — Xero connection and read of the Demo Company

| Field  | Value                                                                 |
| ------ | --------------------------------------------------------------------- |
| Phase  | 0 — De-risk spike (Spec 0, task 3)                                     |
| Status | In progress                                                            |
| Gate   | Demo Company invoices + chart of accounts render, money exact to penny |
| Owner  | Manthan                                                                |

## Problem

Spec 0 needs accounting data in the ledger. Before touching JENKI's real org — which is
gated on signed terms — we must prove the whole Xero path end to end: OAuth2 consent,
token exchange, tenant resolution, authorised reads, and normalisation into the internal
model without losing a penny.

Xero's Demo Company (UK) is real-shaped data (bank accounts, invoices, bills, chart of
accounts) available on a free developer account. It has no dependency on Luke, terms, or
JENKI access, so it is buildable now.

This spec proves the connection and the read. It does **not** write to the ledger — that
is Spec 2, once reconciliation semantics are settled.

## Users

Me, developing. Single tenant, no end-user auth yet (Spec 0 is explicitly single-user).

## Outcome

`GET /xero` shows, for the connected Demo Company org: the chart of accounts, and open
invoices and bills with totals, due dates and amounts outstanding — every amount an
integer number of pennies that matches Xero's own UI exactly.

## Functional Requirements (EARS)

- When the operator visits `/api/xero/connect`, the system shall redirect to Xero's
  consent screen requesting exactly the scopes
  `openid profile email offline_access accounting.settings.read accounting.invoices.read
  accounting.contacts.read`.
- When Xero redirects back to `/api/xero/callback` with a valid `code` and a `state`
  matching the one issued, the system shall exchange the code for an access token and a
  refresh token, and shall persist neither in source control nor in logs.
- When the `state` parameter is absent, malformed, or does not match the issued value,
  the system shall reject the callback without exchanging the code.
- When tokens are obtained, the system shall call `GET /connections` and record the
  `tenantId` of each authorised org.
- When any Xero API call is made, the system shall send the `Xero-Tenant-Id` header for
  the selected org.
- When the access token is expired or within its refresh window, the system shall refresh
  it using the refresh token before the call, and shall persist the rotated refresh token.
- When a Xero monetary value is normalised, the system shall convert it to integer minor
  units without floating-point arithmetic on the value.
- When the chart of accounts is requested and a cached copy is younger than its TTL, the
  system shall serve the cache rather than calling Xero.
- When Xero responds `429`, the system shall surface the `Retry-After` value and shall
  not retry in a tight loop.

## Non-goals

Writing to the ledger, reconciliation, forecasting, multi-tenant onboarding, real JENKI
org access, background sync jobs, webhooks, UI polish, and anything that writes to Xero.
Read-only throughout — only `.read` scopes are requested.

## Edge cases

- User denies consent → Xero returns `error=access_denied`, no code.
- Multiple orgs authorised → `/connections` returns more than one tenant; pick explicitly,
  never assume `[0]` silently.
- Refresh token rotation: Xero issues a NEW refresh token on every refresh and invalidates
  the old one. Losing the new one bricks the connection (30-day expiry, single use).
- Amounts with 4 decimal places (Xero permits 4dp on unit prices, 2dp on totals).
- Credit notes and negative totals.
- Invoice currency ≠ org base currency — do not sum across currencies (invariant #4).
- Rate limits: 60 calls/min and 5,000/day per org; 10,000/day per app.

## Acceptance criteria

1. The consent → callback → `/connections` → read path completes against the Demo Company
   and `/xero` renders non-empty invoices and a chart of accounts.
2. Money conversion is asserted in `evals/` over a table of Xero-shaped decimal values
   including the float-hazard cases (`1.005`, `0.615`, `1234567.89`, 4dp, negatives).
   Any drift fails the build.
3. No token, secret, or PII appears in any log line or in the rendered page.
4. Repeating a read with an expired access token succeeds via silent refresh, and the
   rotated refresh token is persisted.

## Constitution / invariant check

- #1 append-only — nothing is written to the ledger in this spec.
- #2 read-only — only `.read` scopes; no Xero write endpoint is called.
- #3 tenant isolation — Xero's `tenantId` is captured and carried, and is deliberately
  kept distinct from our own internal `tenantId`; they are never conflated.
- #4 integer money — conversion is string-based, asserted in evals.
- #5 verified figures — see acceptance criterion 2.
- #6 anti-corruption layer — all Xero knowledge lives in `integrations/xero/`; `app/`
  consumes only the normalised types.
- #7 no secrets in code or logs — credentials from env; tokens in a gitignored dev store,
  a secret manager in any non-local environment.

No invariant is violated.

## Design notes

**No `xero-node` SDK.** Plain `fetch` against the REST API. The SDK pulls a large
dependency tree, returns its own model shapes, and would leak vendor types past the
anti-corruption boundary. The surface we need is four endpoints.

**Money conversion is string-based.** Xero serialises amounts as JSON numbers, so by the
time `JSON.parse` returns, the value is already an IEEE-754 double — the decimal text is
gone. `Math.round(value * 100)` then misrounds the classic cases. Instead we take the
number's shortest round-trip string form (`String(123.45) === "123.45"`, guaranteed by
ECMA-262 Number::toString) and parse the digits as text. That recovers the exact decimal
Xero sent, for every magnitude in scope. See `integrations/xero/money.ts`.

**Token storage is behind an interface.** `TokenStore` has one local-dev implementation
writing to a gitignored file. Postgres/secret-manager implementations come with Spec 2 —
the call sites do not change.

## Task breakdown

1. `integrations/xero/` — config, zod schemas, money conversion, HTTP client, normalisers.
2. `app/api/xero/connect|callback|disconnect` — the OAuth2 dance.
3. `app/xero/page.tsx` — read-only render of orgs, accounts, invoices.
4. `evals/xero-money.eval.ts` — the money conversion gate.

## Verification

`npm run typecheck && npm run test && npm run eval` green. Manual: connect to the Demo
Company, confirm three invoice totals against the Xero UI to the penny.

## Dependencies / open questions

- Xero app credentials in `.env.local` (free developer account, Demo Company).
- Redirect URI `http://localhost:3000/api/xero/callback` registered on the Xero app.
- Open: which org do we bind to when several are authorised? For now the operator picks;
  in the product this belongs to onboarding.
