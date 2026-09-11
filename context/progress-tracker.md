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
  the internal model and rendered read-only at `/xero`. 96 tests green including the money
  eval gate.
- **Spec 1 verified against live data** (2026-07-30). Connected the Xero Demo Company (UK)
  and read real data end to end: 85 invoices, 90 accounts, receivable outstanding
  £20,441.38, payable outstanding £8,668.24 — matching the Xero UI to the penny. This is
  the viability milestone. Two OAuth failures were fixed to get here: angle brackets left
  around `.env` values (`unauthorized_client`), and the deprecated broad scope
  (`invalid_scope` — see the granular-scopes decision below).
- **Deployed** (2026-08-05). Repo pushed to `github.com/Manthanbhanushali010/FuturaCash`,
  deployed on Vercel, custom domain `futuracash.co.uk` live via IONOS DNS.
- **Landing page integrated** (2026-08-06). The Lovable marketing design
  (`futura-cash-flow-vision`, a Vite/TanStack Start app) converted to Next.js and shipped
  as the homepage at `app/page.tsx`, with components in `components/marketing/`. Converted
  rather than copied: Tailwind v4 `@theme`/`@utility` → v3 config plus scoped CSS, TanStack
  file routes → App Router with a `metadata` export, the Vite asset import → `next/image`
  from `public/`, and only the nav made a client component (mobile menu state). One new
  dependency, `lucide-react`; the 60-package Lovable dependency list and its 50 unused
  shadcn components were left behind. "Get started" and "Log in" point at `/xero`.
  Verified `/xero` unchanged: same live figures, 96 tests, clean build.

- **Production database with enforced tenant isolation** (2026-08-19, `feature/production-hardening`).
  Neon Postgres migrated: `Tenant`, `User`, `BankAccount`, `Transaction`, `ProviderTokenGrant`,
  all five with RLS enabled AND forced, in the initial migration — no bare tables retrofitted.
  `Transaction` has SELECT and INSERT policies only, so UPDATE and DELETE are denied by the
  database: invariant #1 is now a Postgres guarantee, not a convention. Verified with a live
  probe as the app role: no context → zero rows; tenant B cannot see tenant A's transactions
  or token grants; UPDATE and DELETE on an owned ledger row affect zero rows.

- **Phase B1 — database-backed token store** (2026-08-21). `DbXeroTokenStore` replaces
  `FileXeroTokenStore` in deployed environments, storing OAuth grants in `ProviderTokenGrant`
  as AES-256-GCM ciphertext. The tenant is injected at construction, so `read`/`write`/`clear`
  keep their signatures and no call site changed. `refreshInFlight` — an in-process mutex,
  meaningless across serverless instances — is replaced by `withRefreshLock` on the store:
  the file store keeps an in-process queue, the database store takes
  `pg_advisory_xact_lock`. `client.ts` changed only to call it and to re-read under the lock.
  131 tests green (was 96).

- **Phase B2 — persistence proven** (2026-08-25). Connected locally against Neon, restarted
  the dev server twice, and `/xero` stayed connected without re-authorising. Also verified
  mechanically: write, read-back, ciphertext at rest, survival across a fresh store instance,
  and clear. One bug found on the way — `ProviderTokenGrant` was migrated but
  `prisma generate` was never re-run, so the generated client had no delegate and the store
  threw on first real use. Every unit test passed throughout, because they inject a fake
  client that had the delegate the real one lacked.
- **Phase B3 — interim access gate** (2026-08-25). `middleware.ts` gates `/xero` and
  `/api/xero/*` behind a shared password held in `XERO_PAGE_PASSWORD`. Programmatic requests
  to the routes get `401` with no data; browser navigations get the password prompt, because
  `/api/xero/connect` is where the landing page's "Get started" points and `/api/xero/callback`
  is where Xero returns. Covered by `middleware.test.ts`, which exercises the real middleware
  function — the first version of this was verified only by a hand-run curl session, which
  proved the behaviour once but would not notice the matcher being narrowed later. 171 tests.

- **Bank transactions** (2026-08-25, `feature/bank-transactions`). `accounting.banktransactions.read`
  added; `GET /BankTransactions` fetched with pagination and the tenant header, normalised into
  `NormalisedBankTransaction`, and shown on `/xero` beside invoices. 221 tests, including a
  golden-dataset eval for the normaliser. Adding a scope does not upgrade an existing consent,
  so `readXeroSnapshot` compares the granted scope against `XERO_SCOPES` and the screen asks
  for re-authorisation instead of spending a call on a guaranteed 401.

- **Spec 1b — outstanding position** (2026-09-11). Invoices are now selected by outstanding
  status rather than by a date-ordered window, and the read reports whether it saw everything.

## In Progress

- **Spec 1b live verification.** Luke to compare both totals against Xero's own Aged
  Receivables and Aged Payables summaries for JENKI — the only external ground truth
  available, and his books.

## Next Up

1. ~~Xero OAuth2 against the demo org~~ — done and verified against live Demo Company data.
2. **Make `/xero` work in production.** Set `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` and
   `XERO_REDIRECT_URI=https://futuracash.co.uk/api/xero/callback` in Vercel, and add that
   production redirect URI in the Xero app. Until then the live site shows
   "Xero is not configured" — local dev is unaffected.
3. **Fix the dead error-tone styling on `/xero`.** `app/xero/parts.tsx` uses
   `border-error/40` and `bg-error/5`, but `error` is declared as a bare
   `var(--state-error)` in `tailwind.config.ts` with no `<alpha-value>`, so Tailwind v3
   emits no rule at all for those two classes — the error panel currently renders with no
   red tint and no red border. Fix is to give `error` (and `success`, same shape) the RGB
   channel form already used for `surface`. Deliberately deferred out of the landing-page
   branch because it changes how `/xero` looks.
4. Plaid sandbox ingestion behind the same `BankConnector` interface.
5. Postgres up (docker compose), Prisma migrate, RLS policies, and Xero tokens moved from
   the local file store into the database.
6. Ledger ingestion: normalised commitments and transactions written append-only, idempotently.
7. Recurring-rule engine against Luke's spreadsheet as fixtures — pure logic, buildable now
   with no bank access.
8. Reconciliation (pending vs accounted, duplicates, timing) → consolidated position screen.
9. Start aggregator live-HSBC onboarding in parallel; CSV fallback if onboarding lags.
10. Golden snapshot of JENKI's accounts on a fixed date as the eval gate for Spec 0.

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
- **Xero granular scopes** (2 March 2026 change) — the broad `accounting.transactions`
  scope is not grantable to any app created on or after that date; the authorize endpoint
  rejects the whole request with `invalid_scope` before the consent screen renders. Our app
  is post-cutoff, so `/Invoices` uses `accounting.invoices.read`. Beware older tutorials and
  sample code: apps created before the cutoff keep the broad scope until September 2027, so
  a working example elsewhere proves nothing here. Bank transactions will need
  `accounting.banktransactions.read` when Spec 2 reaches reconciliation.
  See <https://developer.xero.com/faq/granular-scopes>.
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
  spike; Postgres swaps in for Spec 2 without changing call sites.
- **Dedicated non-bypassing database role** (2026-08-19) — `neondb_owner` carries the
  `BYPASSRLS` attribute (directly and via `neon_superuser`), which outranks
  `FORCE ROW LEVEL SECURITY`. Proven empirically: with the owner connection, a query with no
  tenant context returned every tenant's rows despite correct policies. The application now
  connects as `futura_app` (`NOBYPASSRLS`, owns nothing, DML only); the owner is used solely
  for migrations. **Configured RLS is not enforced RLS — always verify with a live
  cross-tenant probe as the role the app actually uses.**
- **Tenant context is transaction-scoped, not session-scoped** (2026-08-19) — the app reaches
  Neon through PgBouncer in transaction mode, where a connection is handed to a different
  client between statements. A session-level `SET` would leak one tenant's context into
  another tenant's query. All tenant-scoped work runs inside a transaction that first calls
  `set_config('app.tenant_id', $1, true)`. With no context the predicate is NULL and the
  query returns nothing — it fails closed.
- **Migrations bypass the pooler** (2026-08-19) — `directUrl` in `schema.prisma`. Prisma
  Migrate takes a Postgres advisory lock, which transaction-mode pooling does not support.
- **Refresh serialisation belongs to the token store** (2026-08-21) — not to `client.ts`.
  Only the store knows how far its lock reaches: one process for the file store, every
  process for the database. An in-process promise in `client.ts` looked correct and did
  nothing on serverless. `withRefreshLock` is now part of the `XeroTokenStore` interface, and
  callers must re-read inside it, because whoever held the lock first has already rotated the
  refresh token the caller was holding.
- **Concurrency fixes need a test that can fail** (2026-08-21) — the lock test runs against
  real Postgres with two independent connections, because any mock would "serialise" its own
  calls and reproduce exactly the false confidence being fixed. It ships with a CONTROL case
  asserting that *without* the lock the two connections do interleave; without that control,
  the lock test could pass vacuously. Assert mutual exclusion, not ordering — which of two
  network round-trips wins is not deterministic.
- **Production ran a build that predated the work being debugged** (2026-08-25) — a live
  "State mismatch" on the Xero connect was investigated as an interaction between the new
  access gate and the OAuth state cookie. `/unlock` returned 404: none of B1–B3 was deployed.
  B4 added environment variables to the 6 August landing-page build, which enabled the OAuth
  flow for the first time while lacking the persistence layer entirely — its `FileXeroTokenStore`
  writes to `process.cwd()`, read-only on Vercel. **Check what is actually deployed before
  attributing a production symptom to undeployed code.**
- **A faithful reproduction beats a plausible mechanism** (2026-08-25) — the apex/www
  inconsistency looked like an obvious cause, and two curl runs appeared to confirm it. Both
  were artefacts: `-H "Cookie:"` is dropped across a cross-host redirect, which a browser does
  not do. Replayed with a cookie jar, the apex path passed state validation and reached token
  exchange. The state TTL was raised from 10 to 15 minutes as the leading real candidate,
  since first-time consent includes sign-in and 2FA.
- **Xero bank transactions are ledger records, not a bank feed** (2026-08-25) — they are what
  the bookkeeper entered or reconciled, and the live feed will come from the Open Banking
  aggregator. Reconciliation is the act of comparing the two, so `NormalisedBankTransaction`
  is deliberately distinct from `NormalisedTransaction`, which belongs to `BankConnector`.
  Collapsing them would erase the distinction Spec 2 depends on.
- **The money boundary rejects extra precision rather than rounding it** (2026-08-25) — a
  golden case was authored asserting `1.005 -> 101` minor units. The code threw, and the code
  was right: `toMoney` uses `rounding: "forbid"`, so more than 2dp means our assumption about
  the payload is wrong. The ground truth was corrected to expect rejection. Naive-conversion
  hazards belong at the decimal layer (`xero-money.golden.json`), not here.
- **A bounded read must start from the end that matters** (2026-09-10) — `fetchInvoices`
  ordered by `DueDate` ascending, so on an org with history it returned the OLDEST 200. For
  JENKI those were due between 2020-11 and 2021-09 and every one was PAID, so the screen
  showed five-year-old history as the current position and both outstanding totals rendered
  blank. `outstandingByDirection` was correct throughout — it was given nothing to count.
  The Demo Company hid this completely: 85 invoices fit in one page, so order never mattered.
  **A limit that is invisible on test data is a defect waiting for a real customer.**
- **Read the field the provider actually populates** (2026-09-10) — the bank transaction
  table displayed `Reference`, which JENKI populates on 86 of 200 rows, while
  `LineItems[].Description` — what Xero's own Bank Accounts view shows — is populated on
  200 of 200. 114 rows displayed a blank for transactions Xero described perfectly well.
  Surveying real field presence before choosing which field to display would have caught it.
- **Local cannot refresh a production grant, by construction** (2026-09-10) — the two
  environments use different Xero apps, so a local refresh of a production-issued token fails
  with `invalid_grant — Refresh token was issued to a different client`. Discovered by doing
  it. The failure is safe (the refresh throws before any write, so the stored grant is
  untouched) and is a useful property: local cannot silently spend a customer's token. It
  does mean production data can only be investigated through production.
- **Select by what a number means, not by a window that happens to contain it** (2026-09-11,
  spec-1b) — the outstanding totals were computed from whatever a 200-row date-ordered read
  returned. Ascending gave JENKI's oldest, all PAID, and both totals were blank. Descending
  gave the furthest-future due dates, which pushes OVERDUE invoices below the cut: the most
  cash-relevant invoices a business has, missing from a total that looked authoritative.
  Fixed by dropping `PAID` from the requested statuses so the page bound is spent on invoices
  that can still move cash. Chosen over `where=AmountDue>0` because `Statuses` is a documented
  first-class parameter already proven here, while a where clause on a computed field sits
  outside Xero's optimised set and risks timeouts on exactly the large orgs it would serve.
- **A bounded read must say when it was bounded** (2026-09-11) — `fetchInvoices` now returns
  `{ invoices, truncated }`, and the screen labels the totals a floor when the bound was hit
  with more available. A confident total over an unknown subset is indistinguishable from a
  complete one; blank was honest, incomplete-but-confident is not.
- **The access gate fails closed** (2026-08-25) — with `XERO_PAGE_PASSWORD` unset, nothing
  behind the gate is reachable. Forgetting the variable in a deployment locks the page rather
  than silently exposing it, which is the opposite of every security defect found on this
  project so far. It runs in middleware rather than as a conditional render: hiding the
  Connect button would leave `/xero` still rendering invoices and `/api/xero/connect` still
  reachable by URL. The cookie holds a digest, not the password, so presenting the raw secret
  as a cookie value does not work — asserted in the tests.
- **Hermetic tests cannot catch a stale generated client** (2026-08-25) — the fake Prisma
  client had a delegate the real one lacked, so 131 tests passed against code that threw on
  first contact with a database. Fixed with `postinstall: prisma generate` and a test that
  asserts against the REAL generated client. The same shape as the BYPASSRLS miss: the
  structural check looked perfect and only touching the real thing revealed it.
- **`@prisma/client` loads `.env` at import** (2026-08-21) — so unsetting a variable in the
  shell does not hide it from tests. The integration test's skip depends on `.env` being
  absent, which is true in CI and false locally. Verified by moving `.env` aside: 125 pass,
  6 skip.
- **Interim auth: shared password in `XERO_PAGE_PASSWORD`** (2026-08-20) — a deliberate
  placeholder, not the auth model. WorkOS remains the plan; this exists only to close the
  window between tokens becoming persistent and real auth landing. Until it ships, `/xero`
  is publicly reachable, which is acceptable only because nothing persists yet. It must gate
  the **page and the `/api/xero/*` routes**, not merely hide the Connect button — the page
  itself renders financial data, and the connect route is reachable directly by URL. Build
  it in phase B3, before token persistence goes live.
- **A connection string can silently disable RLS** (2026-08-20) — `DATABASE_URL` was
  edited to `neondb_owner` while rotating the owner password, and tenant isolation switched
  off with no error, no failed test, and no symptom; `pg_policies` still looked perfect.
  Correct end state: `DATABASE_URL` = `futura_app` @ pooled host, `DIRECT_DATABASE_URL` =
  `neondb_owner` @ direct host — different roles, different passwords, different hosts, never
  matching. **Re-run the live cross-tenant probe after any change to a connection string.**
- **Two separate visual layers** (2026-08-06) — the marketing palette from the Lovable
  design and the app palette in `ui-context.md` are kept apart rather than reconciled. A
  data-dense treasury workspace and a landing page have different jobs; merging them would
  degrade both. Enforced by scoping: marketing tokens are `--futura-*`, applied under a
  `.futura-landing` wrapper. Where a Tailwind key is genuinely shared (`surface`,
  `rounded-lg`, `rounded-xl`) the wrapper re-points the CSS variable, not the Tailwind key,
  so `/xero` compiles to the same values it did before. Verified by diffing the compiled
  CSS rules for every app-layer class the Xero screen uses.
- **Landing page converted, not copied** (2026-08-06) — the Lovable export is Vite +
  TanStack Start + Tailwind v4 with ~60 dependencies and 50 unused shadcn components. Only
  `src/routes/index.tsx` carries the design, and it imports nothing but `lucide-react` and
  one PNG. Taking the build config or the dependency tree would have imported a second
  framework's conventions into the app for no benefit; the conversion cost one dependency.

## Session Notes

- Build does not begin until commercial terms are signed (hard gate).
- Spike has a hard pass/fail gate at day ~30: on-screen position matches the owner's three
  real logins, or the live-HSBC regulatory cost/time is documented.
