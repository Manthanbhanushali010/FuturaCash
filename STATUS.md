# Futura — Status

*Imported by `CLAUDE.md` via `@STATUS.md`, so every Claude Code session loads it
automatically. Keep this current instead of re-pasting a master context doc. Update it before
ending a session.*

## Current goal

Finish the Xero data foundation (core cash-flow endpoints) before building the forecast engine.

## Done

- Xero OAuth, encrypted token store, RLS tenant isolation — built & verified live against JENKI
- Bank transactions — built, live; `LineItems.Description` fix shipped
- Invoices — built, live

## Today's priority, in order

1. ~~Check whether the 1 Oct combined deploy shipped.~~ **VERIFIED 2026-10-17: it did not.**
   `origin/main` is still `9457e07` (11 Sep). None of it is present:
   - `accounting.payments.read` — absent from `XERO_SCOPES`
   - `accounting.journals.read` — absent (and see the pricing gate below; may never be added)
   - bank-transaction truncation flag — absent; `fetchBankTransactions` still `maxPages ?? 2`
   - invoice fix — present in the WORKING TREE only, uncommitted since 25 Sep
   Luke cannot have re-authorised for payments, because production has never requested
   that scope.
2. **Ship the invoice fix** — `DueDate ASC` + `maxPages ?? 10`, 250 tests passing. Was sitting
   uncommitted for three weeks; uncommitted work is the one thing a recovered session cannot
   restore.
3. **Purchase orders is ambiguous** — Luke listed it in both "build now" and "post-MVP". Ask
   before building either way.
4. **Once resolved**: Repeating Invoices and Credit Notes are the next clean, scoped builds —
   same pattern as `fetchInvoices`.

## Next up (not started)

- ~~`accounting.payments.read`~~ **IN PRODUCTION 2026-10-22, verified live.** The authorize URL
  on www.futuracash.co.uk now requests nine scopes ending in `accounting.payments.read`;
  `accounting.journals.read` confirmed absent. Unlocks
  `/Payments`, `/BatchPayments`, `/Prepayments`, `/Overpayments` — one scope, four endpoints.
  `accounting.journals.read` deliberately NOT added: the Advanced-tier gate means the scope
  would not unlock it, and asking for an unusable permission costs a re-consent for nothing.
  **NEXT STEP IS LUKE RE-AUTHORISING.** No normaliser or display exists yet — re-consenting
  does not make a Payments table appear. After he consents: survey the real payloads, then
  scope the build.
  ~~`/xero` does NOT prompt him.~~ **FIXED, AND VERIFIED LIVE 2026-10-22** (`ac66cc3`). The
  guard prompts on ANY missing scope and names each one, so the screen asks for the
  re-authorisation instead of it having to be relayed. **Confirmed on production itself**, not
  local dev: `/xero` renders "Re-authorise to include everything we can now read" listing
  exactly one scope, `accounting.payments.read`, with its description, and the
  bank-transactions card still renders below it — which is the correct combination for a grant
  missing only payments. Pre-fix those two were mutually exclusive branches.
  Luke's grant is still 6 Sep and `accounting.payments.read` is **not granted**, so all four
  endpoints still 401.
  The guard had ONE weak assertion behind it before this; `integrations/xero/missing-scopes.test.ts`
  now pins it with 16 tests, including `it.each(XERO_SCOPES)` so a tenth scope is covered the
  day it is added. The RENDER is still not covered by a test — no DOM environment in
  devDependencies and no vitest config — so the live check above is the only proof of the
  rendering path, and re-doing it is the right move after any change to `app/xero/page.tsx`.
  **Fetch + schema + normalise layer is BUILT** (2026-10-20): `fetchPayments`,
  `fetchBatchPayments`, `fetchPrepayments`, `fetchOverpayments`, all paginated with truncation
  flags, normalising into `NormalisedProviderPayment` tagged with its `source` endpoint.
  **Built from Xero's documented fields, not from a survey** — the grant had no scope, so no
  payload could be inspected. Schemas use `.passthrough()`, so the survey can still reveal
  fields worth lifting. **No display is wired up, and no `readXeroSnapshot` call is made** —
  that waits on the survey, deliberately.
- ~~Bank-transaction truncation~~ **IN PRODUCTION 2026-10-22, verified live.** Bank
  transactions read jumped 200 → **1000**, and the slice notice is **FIRING** — JENKI holds more
  than 1,000, so the honest answer is now on screen. Expect it to fire permanently: at ~14
  transactions/day, 1,000 rows is about 71 days against years of history, so pagination alone
  can never make this complete. Date-bounded queries would be the real answer if completeness
  is ever needed here.
  `fetchBankTransactions` now returns `{ transactions, truncated }` at `maxPages ?? 10`, and the
  screen says plainly when the list is a recent slice rather than the full history. Previously
  `maxPages ?? 2` with no flag. Invoices got the flag in spec-1b; bank transactions did not.
  **The "14-day window" is this same defect, not a separate one** (verified 2026-10-19: the
  fetch sends only `where`/`page`/`order`, no date filter at all). 200 rows ÷ ~14 txns/day ≈ 14
  days, so the window is arithmetic. Raising `maxPages` widens it proportionally — at 10 pages,
  roughly 70 days. Note the cap is on ROWS, so the visible window silently narrows as JENKI
  gets busier.
- ~~Bank accounts~~ **RESOLVED 2026-10-19 — already built, nothing to do.** Not a separate
  endpoint: it is `GET /Accounts` filtered to `Type=BANK`, and that fetch has been live since
  Spec 1. `normalise.ts:192` sets `isBankAccount`, the page renders a `bank` pill. Live on
  production: 341 accounts read, 32 flagged as bank accounts.
- **SCOPE AUDIT 2026-10-22 — all nine remaining endpoints are ALREADY AUTHORISED.** Probed
  every one against JENKI's live connection with the existing 6 Sep grant: `RepeatingInvoices`,
  `PurchaseOrders`, `CreditNotes`, `Contacts`, `ContactGroups`, `TrackingCategories`,
  `LinkedTransactions`, `Organisation`, `TaxRates` — **all HTTP 200, none 401**. The eight
  granted scopes are `openid profile email offline_access accounting.settings.read
  accounting.invoices.read accounting.contacts.read accounting.banktransactions.read`.
  **Nothing on this list needs another re-authorise from Luke.** Payments was the exception,
  not the rule: it is the only family that needed a scope we lacked. Do not bundle any of
  these into a future re-consent ask — they are already open.
  Live record counts, so build effort tracks actual value:
    - `CreditNotes` **1578** — the big one; cash-relevant, carries `RemainingCredit`
    - `Contacts` **1785**
    - `TaxRates` **27**
    - `TrackingCategories` **2 categories / 30 options** (see the answered question below)
    - `PurchaseOrders` **8** (priority still ambiguous — a Luke question, not a scope one)
    - `RepeatingInvoices` **0**, `ContactGroups` **0**, `LinkedTransactions` **0**
  **The three zero-row endpoints are authorised but UNSURVEYABLE** — no records means no field
  shapes, so building them would be guessing from documentation, which is the exact position
  the payment layer is in. Authorised is not the same as buildable. Defer them until JENKI
  actually has rows, and check the count again before spending effort.
- **Credit notes — fetch + schema + normalise BUILT 2026-10-22.** `fetchCreditNotes` paginates
  from the first draft (never unpaginated), filters via `where` because `Statuses` is ignored
  on this endpoint, orders `Date DESC`, and returns `{ creditNotes, truncated }`.
  `normaliseCreditNote` produces `NormalisedCreditNote` with per-line `tracking` and a
  `trackingByCategory` roll-up. 33 normaliser tests + 9 fetch-contract tests; all three hard
  requirements are mutation-tested (drop `page` → 2 fail; swap `where` for `Statuses` → 3 fail;
  treat every status as live credit → 4 fail). **Unwired from `readXeroSnapshot` and from any
  display**, deliberately. `UnitAmount` is NOT normalised to Money — Xero allows 4dp on a unit
  price and `toMoney` forbids rounding, so converting it would manufacture failures; it stays
  in `raw`.
  **`creditIsLive` is the field to understand before displaying anything**: `RemainingCredit`
  is only real on AUTHORISED/SUBMITTED. See the trap below.
- **`CreditNotes` strips `LineItems` unless you paginate** (verified 2026-10-22). `GET
  /CreditNotes` with no `page` returns all 1578 records with `LineItems: []`; `GET
  /CreditNotes?page=1` returns 100 records **with** line items populated. Same class of defect
  as the `LineItems.Description` bug — the data is there, the request was wrong, and nothing
  errors. **Always send `page`.** Line items carry `Tracking`, which is how site/revenue-centre
  attribution actually reaches a credit note. Also from page 1: `Status` PAID=74 VOIDED=26 (so
  VOIDED must be filtered or credits are overstated), `Type` ACCRECCREDIT=63 ACCPAYCREDIT=37
  (direction matters, exactly as invoices), and `RemainingCredit > 0` on **26 of 100** — real
  unallocated cash, not a rounding curiosity. Assume the same no-page stripping applies to
  `Contacts` until proven otherwise.
  **And the trap that matters most: `RemainingCredit` survives cancellation.** All 317 of the
  600 surveyed rows with `RemainingCredit > 0` were VOIDED or DELETED; the only statuses where
  it is real are AUTHORISED and SUBMITTED. JENKI has **23 AUTHORISED credit notes, all 23 with
  genuine unapplied credit** and no allocations against them. Summing the field across all
  credit notes would have reported hundreds of pounds of unusable credit, with nothing
  erroring — a confidently wrong number. Hence `creditIsLive`.
  Tracking is richly populated: **2,738 of 3,017 line items (91%)** carry it, across both
  "Site" and "Revenue Centre", 1–2 entries per line. Real shape:
  `{ Name, Option, TrackingCategoryID, Options: [] }` — there is **no `TrackingOptionID`**, so
  the option exists only as a display string and a rename in Xero silently breaks any join.
- Enhance bucket: Organisation (already built), Tax rates, Contacts
- `CNY` is unsupported in `core/money.ts` — one JENKI transaction is excluded from totals and
  reported as a normalisation failure. `core/` is protected, so this needs a deliberate call.
- The forecast engine itself — not started. Everything above is still data foundation.

## Known gate (confirmed Oct 2026 — don't re-litigate)

Xero's `/Journals` endpoint now requires the Advanced pricing tier (~$1,445 AUD/month) plus a
security assessment and Xero use-case approval — not just another scope to request.
`ManualJournals` stays free at all tiers. Luke's "later" placement for Journals was right, for
a cost/approval reason neither of us knew until this was checked.

## Working discipline (established, don't relitigate)

- Verify empirically before declaring anything done — config that "looks right" has failed
  silently before (RLS bypassed by a role attribute, a stale Prisma client, a missing env var,
  and a "banks don't send detail" assumption that was flatly wrong)
- A bounded read must say when it was bounded. A confident total over an unknown subset is
  indistinguishable from a complete one
- One branch, one step at a time
- Merge gate: tests + typecheck + lint + build + a live functional test — not just "it compiles"
- Protected paths unless the task is specifically about them: `core/`, `evals/`, `app/xero/`,
  `app/api/xero/`, `integrations/xero/`
- Never `prisma migrate dev` against Neon — only `migrate deploy`
- App connects as `futura_app` (NOBYPASSRLS), never `neondb_owner` (migrations only)
- **Local cannot read JENKI's Xero.** Local `.env` uses the `CashFlow Dev` app; Luke's token
  was issued by `FuturaCash`, so a local refresh fails with
  `invalid_grant — Refresh token was issued to a different client`. It fails safely (throws
  before any write), and it means production data can only be surveyed through production, or
  from local inside the 30-minute window after production has refreshed the token.

## Open questions

- Who is "James" — Luke mentioned him re: data for a Wednesday pipeline session. Confirm
  whether this is the Xero-embedded developer introduced via David Tuck/Mayday under a
  different name, or someone new.
- Enable Banking vs. GoCardless Bank Account Data — evaluating as a richer bank-data source
  than Xero's reconciled view. Enable Banking quoted ~£800/month (volume-based, possibly a
  negotiable ramp-up); GoCardless pricing pending their sales team.
- Xero Bank Feeds API beta (via Luke's "remitclear" contact) — a channel for *posting*
  statement data into Xero, not pulling richer data out. Only relevant after a real bank-data
  source is chosen — not an alternative to choosing one.
- Does money move between JENKI's own bank accounts? If so `/BankTransfers` matters — with six
  locations, ignoring it could make individual account balances wrong even when the consolidated
  position is right. Ask Luke rather than assuming.
- **Does JENKI deal in foreign currency routinely, or was the CNY transaction a one-off?**
  **Strong new evidence 2026-10-22: routinely.** Six of JENKI's eight purchase orders are
  **USD**, not GBP, at a stored `CurrencyRate` (e.g. 1.35916) — so foreign currency is a
  standing part of procurement, not an anomaly. USD is already in `SUPPORTED_CURRENCIES`
  (GBP/EUR/USD) so nothing is blocked today, but it means the CNY failure is the leading edge
  of a pattern rather than a stray row, and `CurrencyRate` will have to be modelled for any
  figure that consolidates to GBP. Still ask Luke, but the answer is now "probably yes". One
  CNY-denominated transaction is currently excluded from the totals and reported as a
  normalisation failure. `Currencies` had been triaged as "probably irrelevant for a UK matcha
  bar chain" — this is evidence against that. Ask Luke rather than guessing; the answer decides
  whether `core/money.ts` needs one currency added or a general multi-currency approach.
- ~~Does JENKI use Xero Tracking Categories?~~ **ANSWERED 2026-10-22 — YES, and it is already
  authorised.** Surveyed live: two ACTIVE categories. **"Site"** with 20 options (Battersea
  Power Station, Berwick St (Soho), Borough Market, Canary Wharf, Covent Garden, Fitzrovia, Gr
  Portland St, Liverpool Broad Street, Marylebone, Selfridges, Spitalfields, St Pauls
  (Paternoster), plus Amazon Seller, CPU, Events, Head Office, Online, Warehouse, Wholesale)
  and **"Revenue Centre"** with 10 options (Bars, CPU, Event, Head Office, Licensing, Media,
  Online, Wholesale, + two retired). So the site/revenue-centre enrichment Luke wants is a
  build, not a data-gathering exercise. Two caveats from the real data: there are **more than
  six sites** — twelve-ish retail locations plus wholesale/online/events channels, so "six
  London matcha bars" understates the dimensionality; and several options are prefixed
  `DO NOT USE\old:`, which any grouping must exclude or it will double-count history.

## Companion docs

- `futura-xero-endpoint-roadmap.md` — **in the repo** as of 2026-10-19. All thirteen of Luke's
  endpoints mapped against current status, the general-ledger/Journals research, and a triage of
  the remaining ~30 Accounting API resources. Carries a "Verified against the repo" section at
  the foot recording two claims that were out of date when it was committed.
- `futura-payments-endpoints-breakdown.md` — **in the repo** as of 2026-10-19. The
  Mayday-meeting diagnosis of why Payments/BatchPayments were 401ing, the approved deploy plan,
  and the step-by-step re-authorisation sequence. Carries a "Verified against the repo" section
  correcting the "14-day window" as a separate finding.
