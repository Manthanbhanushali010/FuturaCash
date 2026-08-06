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

## In Progress

- Nothing in flight. Next unit not started.

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
  spike; Postgres + secret manager swap in for Spec 2 without changing call sites.
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
