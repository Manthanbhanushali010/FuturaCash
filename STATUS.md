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
  **LUKE RE-AUTHORISED — CONFIRMED 2026-10-22.** Grant now holds nine scopes,
  `accounting.payments.read` included, `missingScopes` is `[]`, and the `/xero` notice has
  cleared. Note `connectedAt` is STILL 6 Sep: the store deliberately preserves the original
  connection date across a re-consent, so **scope is the signal, not connectedAt**.
  All four endpoints surveyed live — see "PAYMENT FAMILY SURVEY" below.
  ~~NEXT STEP IS LUKE RE-AUTHORISING.~~ No normaliser or display exists yet — re-consenting
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

## BATCH PAYMENTS CARD — built 2026-10-27, `feature/batch-payments-card`, UNMERGED

Branched from `origin/main` because **PR #1 is still OPEN** — its three commits (`6d93f7a`,
`447647a`, `83489d2`) are not on main, so this branch needs a rebase after that merges. None
of them are touched here.

Standalone, and additional to nothing: `reconcile` does not import it, asserted by a
source-level test in both directions, because wiring it in would double-count money that has
already left the bank.

**PAID AND SCHEDULED ARE SEPARATE SECTIONS WITH SEPARATE LABELS**, because the "already
included in bank transactions" claim is true of one and false of the other. A paid batch is
inside the bank-transaction read; a scheduled one is in no bank read at all. Live, 2026-10-27,
30-day window — **22 batches, and the split matters**:

| Section | Label | Records | Amount |
|---|---|---:|---|
| Paid | Already included in bank transactions. Not additional. | 7 in | 35,240.28 GBP |
| Paid | " | 13 out | 606,435.87 GBP |
| Scheduled | Scheduled, not yet paid. Not in bank transactions yet. | 2 out | 100,324.65 GBP |

606,435.87 + 100,324.65 = 706,760.52, which is what a single undivided "out" figure showed
before the split — **£100k of it had not been paid yet**. The two scheduled batches are dated
2026-10-30 and 2026-11-02; the window has a lower bound only, so a scheduled batch falls
inside it. Integrity bucket **0**, failures **0**.

**THE TWO 200-MEMBER BATCHES ARE GENUINE — read individually, 2026-10-27.**
`GET /BatchPayments/{id}` on `b05c0840` and `532dc2f4`: **200 members each, 200 distinct
PaymentIDs, and the members sum to the batch total to the penny in both the list read and the
single read.** So 200 is a real count here, not a per-batch cap. The visible flag stays
anyway (`MEMBER_COUNT_TO_FLAG`), because a cap would look exactly like this AND would still
tie — the integrity bucket cannot catch it, which is the whole reason the flag is separate.

What the survey corrected before any code was written:
- **A batch carries NO currency field.** It is `Account.CurrencyCode`, 22 of 22, nothing at the
  top level. `normaliseBatchPayment` stamped every batch with the org base currency — right
  until the day it is not. JENKI holds Global Wallet accounts in **CAD, AUD, JPY and EUR**, so
  that day is foreseeable. Now read from the account; a batch with neither is a reported
  failure rather than a guess.
- Nested members carry `PaymentID`, `Amount` and `BankAmount` and nothing else — no status, no
  type, no date. The member count therefore costs no second read.

The bucket compares the batch total to the sum of members' **`BankAmount`, not `Amount`**:
`Amount` is in the invoice's currency, `BankAmount` in the bank account's, and the total is
quoted in the bank account's. Summing `Amount` would invent a mismatch under a currency rate.
A member missing `BankAmount` is `UNCHECKABLE` rather than silently compared, and still lands
in the bucket.

Subtotals never cross a currency OR a direction. The second is unstated but worse: one "total
batch payments" figure would net a supplier run against a customer receipt.

**THE RENDER IS NOW UNDER TEST, for the first time on this project.** `vitest.config.ts` is
new — `tsconfig`'s `jsx: "preserve"` meant esbuild could not parse a `.tsx` test, and the
`@/*` alias was unresolvable under vitest, which is exactly why every `/xero` card state had
only ever been checked by loading production by hand. Markup is now split from fetching
(`app/xero/batch-payments-view.tsx` is a pure function of a discriminated-union view model),
and 17 `renderToStaticMarkup` tests assert the HTML for truncated, failed, missing-scope,
mismatch, scheduled and exactly-200 states. **"Never zeros" is asserted in the rendered
markup**, not argued for in a comment.

That test immediately found a real defect: a section holding only outgoing batches rendered
**"GBP in · 0 batch(es) — 0.00 GBP"** beside the real figure — a zero standing where there is
no data. Directions with no batches are now omitted. (And the first version of the assertion
was wrong in the other direction: `toContain("0.00 GBP")` matches inside `"300.00 GBP"`, so it
fired on a card with no zeros at all. Anchored to the element boundaries.)

**THE NORMALISER CHANGE MOVED NO RECONCILIATION FIGURE.** Captured one live 30-day window
(1,126 payments · 529 bank rows · 22 batches · 13 overpayments, all `truncated: false`) and
reconciled it twice over the SAME captured records — once with `Account.CurrencyCode` and once
with the old base-currency behaviour. The full serialised result is **identical byte for
byte** (118 lines). Figures, for the record:

| Counted | Records | Amount |
|---|---:|---|
| BANK_TRANSACTION | 118 | 951,289.00 GBP · 115.39 USD |
| BATCH_PAYMENT | 22 | 742,000.80 GBP |
| PAYMENT | 404 | 692,255.15 GBP |
| OVERPAYMENT | 13 | 930.79 GBP |

| Excluded | Records | Amount |
|---|---:|---|
| BANK · INTERNAL_TRANSFER | 398 | 1,025,082.12 GBP |
| PAYMENT · BATCH_MEMBER | 722 | 742,000.80 GBP |
| BANK · OVERPAYMENT_ALREADY_IN_BANK | 13 | 930.79 GBP |

**IN 1,288,731.46 GBP / OUT 1,097,744.28 GBP + 115.39 USD → +190,987.18 GBP.** `tiesOut: true`,
0 discrepancies, 0 warnings, 0 normalisation failures on any source. **The exact-penny ties
hold again**: BATCH_PAYMENT counted 742,000.80 = PAYMENT·BATCH_MEMBER excluded 742,000.80 (22
batches, 722 members — the same 722 the card counts), and OVERPAYMENT 930.79 =
BANK·OVERPAYMENT_ALREADY_IN_BANK 930.79, 13 records each way. Commitments were deliberately
excluded from this comparison: invoices are untouched by the change and identical in both runs.

`maxDuration = 60` set explicitly on `/xero` (valid on either Vercel plan — still unconfirmed)
and the card is behind `Suspense`. Measured live, median of three: **TTFB 9.97s → 10.19s, full
response 10.01s → 12.37s.** The existing page is not slowed; the batch read arrives after the
shell.

Sixteen mutations verified to fail on the intended assertion. **One passed first and found a
real gap:** swapping the member sum to `Amount` broke nothing, because the test covered the
missing-`BankAmount` guard rather than the basis. Pinning it needs a constructed rate, since
the two are identical on all 722 live members.

### LOGGED, NOT BUILT (do not start without a decision)

- **Per-currency minor-unit exponents in `core/money.ts` BEFORE accepting CAD, AUD or JPY.**
  `minorUnitDigits` is the gate: **JPY has 0 decimal places**, not 2, so admitting it without
  a per-currency exponent would multiply every yen figure by 100. The chart of accounts
  already holds Global Wallet accounts in CAD, AUD, JPY and EUR, so the currencies exist —
  they are simply not yet supported, and today a JPY batch becomes a reported failure, which
  is the correct failure. `core/` is protected; this needs a deliberate call, like the CNY
  question it extends.
- **Stream the four Xero calls in `Body()` behind Suspense.** TTFB on `/xero` is ~10s either
  way because `Body()` is an async server component that is NOT behind Suspense — the
  snapshot's four calls block the shell. The batch card's Suspense boundary only defers the
  fifth. Fixing this is the actual page-speed work; the card merely avoided adding to it.
- **Survey helpers should refuse a page-1-only sample** — see the standing rule below.

## PAYMENT FAMILY SURVEY — live, 2026-10-22 (read this before building the four)

Record counts: **Payments 24,520 · BatchPayments 1,421 · Overpayments 534 · Prepayments 0.**

### The provisional layer in 5e35cd7 was documentation-based. What the live data corrects:

- ~~**BUG — `fetchBatchPayments` will return 10× duplicates.**~~ **FIXED 2026-10-23.** One
  unpaginated call, `truncated` always false, `where` filter retained (it IS honoured here
  even though `page` is not — 1,346 AUTHORISED of 1,421). `fetchPaged` was deliberately NOT
  generalised: every other endpoint genuinely paginates, and loosening that loop to
  accommodate one exception would risk every other endpoint stopping early. Verified live:
  **1,346 records, 1,346 distinct, 0 duplicates, truncated=false.** Original defect: Xero IGNORES `page` on
  `/BatchPayments`: `page=1` and `page=99` both return all 1,421 records. `fetchPaged` breaks
  only when a page comes back short of 100, so it will loop all 10 pages, accumulate
  **14,210 records (1,421 × 10)** and report `truncated: true`. Must special-case: one
  unpaginated call, no truncation flag. **Fix before anything consumes it.**
- ~~**`XeroPayment.BatchPaymentID` does not exist.**~~ **THAT WAS WRONG — corrected 2026-10-23.**
  It does exist and it works. The "0 of 100" measurement read `/Payments` page 1, which is
  JENKI's OLDEST payments (2021), from before they used batch payments at all. Read
  newest-first it is populated on **200 of 200**, with real GUIDs — not the null GUID —
  resolving to batches that exist (`398a49ef` is the same batch whose members were separately
  confirmed to resolve from `GET /Payments/{id}`).
  **Page 1 of this API is the least representative sample available**, and the same trap
  produced the opposite wrong answer about the /Payments↔/BatchPayments overlap. Any claim of
  the form "field X is never populated" must be checked newest-first before it is believed.
  Modelled as `batchExternalId`, and it is the cheaper half of the double-count defence: a
  payment can name its batch, so the overlap dedupes from either side without expanding every
  batch's membership.
- ~~**`XeroPayment` is missing `BankAmount`**~~ **ADDED 2026-10-23** (live: 200/200 populated).
  Originally: (100% populated, and differs from `Amount` under
  a currency rate — it is the amount that actually hit the bank). Also absent: `HasAccount`,
  `HasValidationErrors`.
- ~~**`XeroUnallocatedCredit` is missing the three fields that matter**~~ **ADDED 2026-10-23**
  as `LineItems`, `Allocations[]` → `allocations`, `Payments[]` → `drawnDownByPaymentIds`.
  Originally:: `LineItems` (100% on a
  paginated read), `Allocations[]` and `Payments[]`. Those are the join keys; without them an
  overpayment is an opaque total.
- ~~**No status filtering anywhere in the payment layer.**~~ **FIXED 2026-10-23.** `/Payments`
  and `/BatchPayments` now filter via `where` (default AUTHORISED), and an empty status list
  is rejected rather than treated as a wildcard. `/Overpayments` and `/Prepayments` stay
  deliberately UNFILTERED: `creditIsLive` handles the phantom credit, and PAID records carry
  the allocation history that says how a credit was consumed.
  Also found and fixed: **`XeroBatchPayment` modelled `Amount`, which live batches never
  send** — they carry `TotalAmount`. Because `toMoney(undefined)` returns zero rather than
  throwing, all 1,421 batches would have normalised to £0.00 and summed to nothing, silently.
  Now prefers `TotalAmount`, keeps `Amount` as a fallback, and **throws when neither is
  present** rather than becoming zero.
  Added `amountIsLive` (false for DELETED/VOIDED, which keep their amounts) and `creditIsLive`
  (true only on AUTHORISED/SUBMITTED), mirroring `NormalisedCreditNote`. Figures are kept
  faithfully and the flags say whether to count them — zeroing would hide the discrepancy.
- Confirmed correct: `PaymentID`, `PaymentType` (ACCRECPAYMENT/ACCPAYPAYMENT both live),
  `Status`, `Date`, `Reference`, `Amount`, `CurrencyRate`, `IsReconciled`, `Invoice`,
  `Account`, and `RemainingCredit` on the unallocated-credit shape. `.passthrough()` did its
  job — every unmodelled field above survived in `raw`.

### How the four join up

- **`Payments.Invoice`** → `{ Type, InvoiceID, InvoiceNumber, … }`, populated on 100%. This is
  a real join back to invoices. `Invoice.Type` spread ACCREC=35 / ACCPAY=65 on page 1.
- **`Payments.Account`** → `{ AccountID, Code, CurrencyCode }`, joins to the chart of accounts.
- **No credit-note reference**: 0 of 100 payments carried a `CreditNote` ref.
- **`BatchPayments.Payments[]`** → `{ Invoice, PaymentID, Amount, BankAmount }`, 9,081 members
  across 1,421 batches. Carries `PaymentID`, so members are resolvable individually.
- **`Overpayments.Allocations[]`** → `{ AllocationID, Amount, Date, Invoice }` — how an
  overpayment is applied to an invoice. **`Overpayments.Payments[]`** → `{ PaymentID, … }`, so
  **yes, an overpayment IS later consumed by a Payment**, the same lifecycle as CreditNotes.

### DOUBLE-COUNTING RISKS — all three are real

1. **`/Payments` and `/BatchPayments` OVERLAP.** Sampled a recent PAYBATCH and resolved its
   members individually: **3 of 3 returned HTTP 200 from `GET /Payments/{id}`**. Measured on
   page 120 of `/Payments`, **61 of 100 records are batch members**. Summing both endpoints
   double-counts. Beware the sampling trap: page 1 shows **0 of 100** overlap, because page 1
   is 2021 and JENKI adopted batch payments later — an overlap check on page 1 alone concludes
   "disjoint" and is wrong.
2. **Our existing bank read ALREADY contains overpayments.** Replaying the shipped query
   (`where Status=="AUTHORISED"`, `order Date DESC`, 10 pages) returns **17 SPEND-OVERPAYMENT
   rows, every one carrying an `OverpaymentID`**. Adding `/Overpayments` on top double-counts
   those. Bank transactions carry `OverpaymentID`/`PrepaymentID` as links, and their
   `BankTransactionID` is a DIFFERENT id from the `OverpaymentID` — so dedupe on the link
   field, never on the primary key.
3. **61% of the live bank window is internal transfers.** Same query: 307 RECEIVE-TRANSFER +
   306 SPEND-TRANSFER out of 1,000 rows. A transfer between JENKI's own accounts appears
   twice, once each way, so any consolidated total that sums bank rows naively is inflated by
   roughly double the transfer volume.
   **This answers the `/BankTransfers` open question: yes, money moves between JENKI's own
   accounts, constantly.**
   **Not currently a wrong number** — nothing sums bank transactions today (`page.tsx` only
   counts and lists them; `outstandingByDirection` runs on invoices only). It is a latent
   forecast-engine risk, and the reason to settle it before the engine exists.

### Traps, same family as the CreditNotes ones

- **DELETED payments keep their amount.** `where Status=="DELETED"` returns 100 records and
  **100 of 100 have a non-zero `Amount`** (e.g. 250, BankAmount 250). Page 1 of `/Payments` is
  AUTHORISED=79 / DELETED=21, so roughly a fifth of an unfiltered read is cancelled payments
  carrying real-looking money.
- **VOIDED overpayments keep their remaining credit** — `RemainingCredit > 0` on **64 of 64
  VOIDED**, and **0 of 36 PAID**. Identical to the CreditNotes trap, so the `creditIsLive`
  treatment applies here unchanged.
- **`Statuses=` is silently ignored on `/Payments`** (`Statuses=DELETED` returned a mix of
  AUTHORISED and DELETED). `where=Status=="…"` works. Third endpoint family in a row where
  this is true — treat `Statuses` as unsupported unless proven otherwise on that endpoint.
- **`/Overpayments` strips `LineItems` without `page`** — the CreditNotes defect again.
  `fetchPaged` already sends `page`, so the existing layer avoids this one by luck.
- **`/Payments` with no `page` returns all 24,520 records in one response.** No cap. Easy to
  do by accident and expensive.
- **`/Prepayments` is genuinely empty for JENKI** — 0 records, and 0 bank transactions of type
  SPEND-PREPAYMENT or RECEIVE-PREPAYMENT. Unsurveyable, and nothing is lost by deferring it.

## SCHEDULED MONEY — built 2026-10-27, `feature/reconcile-asof` (`668d28f`), UNMERGED

The reconciliation read with `Date>=` and no upper bound, so an authorised-but-unpaid record
sat inside the window looking exactly like a settled one. **Measured live 2026-10-27: two
batches dated 30 Oct and 2 Nov, worth 100,324.65 GBP, counted as OUTFLOW.** Per source, future
dated in the live window: **BATCH_PAYMENT 2, PAYMENT 139 raw but 0 counted** (all 139 are
members of those two batches, deduped away), **BANK 0 of 529, OVERPAYMENT 0 of 13.** GBP only.

**LIVE RECOMPUTE WITH THE FIX, 30-day window, asOf 2026-10-27 Europe/London:**

| | Records | Amount |
|---|---:|---|
| counted BANK_TRANSACTION | 118 | 951,289.00 GBP · 115.39 USD |
| counted PAYMENT | 404 | 692,255.15 GBP |
| counted BATCH_PAYMENT | 20 | 641,676.15 GBP |
| counted OVERPAYMENT | 13 | 930.79 GBP |
| **SCHEDULED BATCH_PAYMENT** | **2** | **100,324.65 GBP** |
| excluded BANK · INTERNAL_TRANSFER | 398 | 1,025,082.12 GBP |
| excluded PAYMENT · BATCH_MEMBER | 722 | 742,000.80 GBP |
| excluded BANK · OVERPAYMENT_ALREADY_IN_BANK | 13 | 930.79 GBP |

**IN 1,288,731.46 / OUT 997,419.63 GBP + 115.39 USD → NET +291,311.83 GBP.** Scheduled OUT
100,324.65 GBP, held apart. `tiesOut: true`, **0 discrepancies, 0 warnings**, 0 normalisation
failures. Before the fix the same window read +190,987.18 — understated by exactly the
scheduled amount.

**A new exact-penny tie, and it spans both classes:** counted batches 641,676.15 + scheduled
100,324.65 = **742,000.80**, which is precisely what was removed as `PAYMENT · BATCH_MEMBER`.
The dedupe still removes exactly the batches' total, across the counted/scheduled split.

**`asOf` is a REQUIRED calendar date, injected, computed in the ORG timezone.**
`calendarDateIn` uses `Intl` (the BST offset is a function of the date). `orgTimeZone()` reads
`ORG_TIME_ZONE`, default `Europe/London` — tenant config for now; Xero's `/Organisation`
returns its own enum (`GMTSTANDARDTIME`), so adopting it needs a mapping table and a verified
read. A timestamp is rejected, never truncated. Note the recompute above shows org and UTC
agreeing — BST ended 25 Oct, so the difference only appears between April and October.

**SCHEDULED IS A THIRD CATEGORY**, not an exclusion. `tiesOut` now proves counted + excluded +
scheduled = what came in.

**THE ROUTING IS AT THE POINT OF COUNTING, NOT A FILTER ON THE INPUT — this is the fix.**
Filtering future-dated records before the dedupe changes nothing: a dropped batch leaves
`countedBatchIds` and `batchMemberIds`, so its 139 members stop being recognised as duplicates
and are counted individually. **Measured: OUT stayed at 1,097,744.28 GBP exactly, with
100,324.65 moving from BATCH_PAYMENT into PAYMENT and 139 warnings.** A test holds that trap.

Scheduled records reach no period slice and not `unattributed`. **An UNDATED record is counted
but now WARNS**, naming source and id: it is the one record classified on an absence rather
than a value, and a conservative choice should not look like a measurement. The rule applies
to all four sources including bank rows.

**CROSS-CHECK TEST**: the card's scheduled total equals the reconciliation's scheduled batch
total — **10,032,465 minor units** (84,109.55 + 16,215.10), asserted in the fixture. Both
appear on `/xero`, so they can never disagree.

Nine mutations fail on the intended assertion, including `asOf` in UTC (00:30 BST on 15 July —
mid-summer deliberately) and the boundary flipped to `>=`.

**MERGE ORDER: after PR #2 and PR #1.** The branch is main + PR #1 + PR #2 + this commit, so
once both land it rebases onto main cleanly. The snapshot columns went back onto
`feature/reconciliation-cache` as `23a1560`, independent of this.

## CROSS-ENDPOINT RECONCILIATION — built 2026-10-24, `integrations/xero/reconcile.ts`

Pure function, unwired. Every input record lands in exactly one bucket — counted, or excluded
with a named reason — and `tiesOut` proves that arithmetically rather than asking to be
trusted. **Live figures, JENKI, 2026-10-24:**

| Counted (after dedupe) | Records | Amount |
|---|---|---|
| BATCH_PAYMENT | 1,346 | 5,454,767.65 GBP |
| BANK_TRANSACTION | 354 | 1,398,623.11 GBP · 253.27 USD |
| PAYMENT | 404 | 725,075.70 GBP |
| OVERPAYMENT | 465 | 128,545.83 GBP |

| Excluded (itemised) | Records | Amount |
|---|---|---|
| BANK · INTERNAL_TRANSFER | 629 | 2,235,891.67 GBP |
| PAYMENT · BATCH_MEMBER | 596 | 650,877.34 GBP |
| OVERPAYMENT · CANCELLED | 69 | 32,918.57 GBP |
| BANK · OVERPAYMENT_ALREADY_IN_BANK | 17 | 1,231.44 GBP |

Movement: **IN 3,501,847.09 GBP / OUT 4,205,165.20 GBP + 253.27 USD**. Committed (outstanding
invoices, deliberately NOT in movement): IN 71,707.30 GBP / OUT 298,935.09 GBP + 4,171.50 USD.
Available credit (`creditIsLive` only): **1,170.79 GBP**. `tiesOut: true`, 0 discrepancies.

**NET MOVEMENT IS NOW A REAL FIGURE — shared 30-day window, 2026-10-24.**
`RECONCILIATION_WINDOW_DAYS = 30`, `recentWindow()` in `client.ts`, applied to Payments,
BankTransactions, BatchPayments and Overpayments. **All four complete — `truncated: false`
on every one, every oldest record exactly on the window boundary, 0 discrepancies, 0
warnings.**

Window 2026-09-24 → 2026-10-24:

| Counted | Records | Amount |
|---|---|---|
| BANK_TRANSACTION | 146 | 1,125,779.42 GBP · 115.39 USD |
| PAYMENT | 423 | 751,410.01 GBP |
| BATCH_PAYMENT | 26 | 661,964.41 GBP |
| OVERPAYMENT | 13 | 930.79 GBP |

| Excluded | Records | Amount |
|---|---|---|
| BANK · INTERNAL_TRANSFER | 394 | 1,178,342.58 GBP |
| PAYMENT · BATCH_MEMBER | 619 | 661,964.41 GBP |
| BANK · OVERPAYMENT_ALREADY_IN_BANK | 13 | 930.79 GBP |

**NET MOVEMENT: IN 1,335,588.62 GBP / OUT 1,204,496.01 GBP → +131,092.61 GBP** (and −115.39
USD). Committed, unwindowed: IN 71,707.30 / OUT 298,935.09 GBP + 4,171.50 USD. Available
credit 930.79 GBP.

**THE DEDUPE IS SELF-VERIFYING AT THIS WINDOW, and that is the strongest evidence yet.** Two
pairs came out identical to the penny, which no amount of code review could establish:
- BATCH_PAYMENT counted **661,964.41** = PAYMENT·BATCH_MEMBER excluded **661,964.41**. The 619
  excluded member payments sum to exactly the 26 batch totals, so every batch's membership is
  fully present in the payments read and nothing is double-counted or lost.
- OVERPAYMENT counted **930.79** = BANK·OVERPAYMENT_ALREADY_IN_BANK excluded **930.79**, 13
  records each way.

## CHUNKED READS — built 2026-10-24, `integrations/xero/chunked-read.ts`

`readChunked(tenantId, { days })` walks backwards in **fixed 30-day chunks**, fetching all four
sources per chunk with the date-bounded `where=` already built, merging each source across
chunks, and treating ANY truncation in ANY source of ANY chunk as a **hard failure**: the
chunk's records are discarded, extending further back stops, and `stoppedAt` names the window
and which sources truncated. Unwired.

**Chunk size is the measured-safe 30 and is NOT derived from record density.** Computing an
"optimal" size per endpoint is the same reasoning that produced the 90-day failure — correct on
one day's volumes, silently wrong the week JENKI gets busier. A test pins that a dense stub and
a sparse stub produce the same number of chunks.

**LIVE RESULT — 90 days in three chunks, 96s, zero 429 retries:**

| Chunk | Span | Status | pay / bank / batch / over |
|---|---|---|---|
| #1 | 2026-09-24 → today | COMPLETE | 1042 / 553 / 26 / 13 |
| #2 | 2026-08-25 → 2026-09-24 | COMPLETE | 745 / 799 / 24 / 10 |
| #3 | 2026-07-26 → 2026-08-25 | COMPLETE | 971 / 722 / 25 / 16 |

Requested 90d, complete **90d**, `all complete: true`. Merged: 2,758 payments · 2,074 bank ·
75 batches · 39 overpayments. **0 duplicate ids across chunk boundaries** — the chunks abut
exactly (`since` inclusive, `until` exclusive). 0 normalisation failures.

**NET MOVEMENT, 90 days: IN 3,533,836.18 GBP / OUT 3,564,841.81 GBP → −31,005.63 GBP**
(and −387.24 USD). `tiesOut: true`, 0 discrepancies, **0 warnings**. Available credit
1,170.79 GBP.

Three independent corroborations:
- **The exact-penny ties hold at 90 days too.** BATCH_PAYMENT counted **1,414,191.06** =
  PAYMENT·BATCH_MEMBER excluded **1,414,191.06**. OVERPAYMENT counted **3,186.30** =
  BANK·OVERPAYMENT_ALREADY_IN_BANK excluded **3,186.30**, 39 records each way.
- **Chunk #1 reproduces the standalone 30-day run exactly** (1042/553/26/13), so the chunked
  reader and the single-window read agree on the overlapping span.
- **Chunking recovered what the single 90-day window lost**: 2,758 payments vs 2,000 truncated,
  2,074 bank rows vs 2,000 truncated. That is the defect this fixes, measured.

**PERIOD SLICES — reported, not inferred (2026-10-24).** `reconcile` takes an optional
`periods` list and slices the COUNTED set by each record's own date, from one read and one
dedupe. Live, over the same 90-day chunked read:

| Period | Records | IN | OUT | NET |
|---|---|---|---|---|
| last 30 days | 608 | 1,335,588.62 | 1,204,496.01 GBP · 115.39 USD | **+131,092.61 GBP** |
| prior 60 days | 1,688 | 2,198,247.56 | 2,360,345.80 GBP · 271.85 USD | **−162,098.24 GBP** |
| unattributed | 0 | — | — | — |

Slices sum to the whole **exactly** — GBP, USD, and record counts (2,296 = 2,296). So the
recent month is markedly better than the quarter, which a single net figure hides.

These confirm the earlier subtraction to the penny. The subtraction was reasoned to be unsound
(two reads end at different "now"s; each dedupes independently) and in principle it can
diverge — but on this data it did not, so the slices are reassurance rather than a correction.

**THE REAL FIND: period bounds must be DAY-ALIGNED.** `toXeroDateTime` truncates a fetch bound
to midnight UTC, so every record on a boundary day arrives stamped 00:00. The first live run
passed full timestamps (16:57) as period bounds, which sit AFTER those records: a whole day
slid into the neighbouring slice and the 30-day net came out £62k wrong (+193,439.59). **The
`unattributed` bucket is the only reason it was visible** — 13 records and £14,822 appeared
there, which is what prompted the check. Pinned by three tests, including one that documents
the misattribution rather than pretending the comparison is time-safe.

Overlapping periods take the FIRST match, deliberately: anything else double-counts.
Undated records go to `unattributed` rather than being guessed into a period.

Rate limiting: ~1,100ms between source fetches, ~15s between chunks, and a 429 backs off
(honouring `Retry-After`) and retries THAT chunk rather than abandoning the read. Mutation
tested — see below.

Mutations verified to fail: truncation downgraded to a warning (3 tests), upper bound put on the
newest chunk so today's records drop (1), 429 retry removed (2), pacing removed (1),
`Retry-After` ignored (1), chunk size derived from the request instead of fixed (10). One
mutation PASSED and exposed redundant code of mine rather than a bug — a second
discard guard inside the chunk reader was unreachable because the caller already stops before
merging. It was removed rather than papered over with a test; the discard is covered via the
caller, verified by mutating the merge to happen before the break.

**WHY 30 AND NOT 90 IN A SINGLE WINDOW.** Measured: **32.6 payments/day, 19.1 bank rows/day**. At 100 per page
that is ~10 and ~6 pages for 30 days. 90 days needs ~30 and ~18 — tried first, and at
`maxPages: 20` both truncated, so payments reached back only to 21 August while batch payments
and overpayments covered the full window. **The date bound was honoured and the PAGE bound
still bit inside it**, reproducing the original defect one level down: a window only partly
read is a period figure that is quietly wrong. And ~48 calls for two sources breaches Xero's
60/minute budget once the other reads are added — the first 90-day attempt died on a live 429.
To go wider, chunk the window into sub-windows that each complete, or move the read off the
request path. Raising `maxPages` alone does not fix it.

**Date bounds verified PER ENDPOINT, not assumed** (`Statuses=` has been silently ignored on
three endpoints in a row). `where=Date>=DateTime(y,m,d)` is honoured on /Payments,
/BankTransactions, /BatchPayments and /Overpayments — and on /BatchPayments it works even
though `page` is ignored there. An exclusive upper bound `Date<DateTime(...)` works too.
**Multi-status filters are now PARENTHESISED**: `&&` binds tighter than `||`, so
`A||B&&Date>=X` parses as `A || (B && Date>=X)` and would return status-A records from outside
the window while appearing to respect it. Mutation-tested, along with UTC date parts (local
getters shift the boundary a day under BST) and the window reaching every source.

Still reported rather than hidden:
2. Invoices are reported separately and never added to movement. An invoice is an obligation,
   a payment is its settlement; summing both counts the same money twice.
3. Transfers are excluded, not netted — 629 rows, 2.24M GBP, visible as its own line.

**Two defects the live run exposed, both now fixed:**
- **All 534 overpayments silently failed to normalise.** `toPaymentDirection` assumed
  ACCREC*/ACCPAY* prefixes from documentation; live overpayments use the BANK vocabulary,
  `SPEND-OVERPAYMENT`/`RECEIVE-OVERPAYMENT`. Failures are collected, not thrown, so the first
  reconciliation reported **`tiesOut: true` over a set missing every overpayment**.
  `reconcile` now takes `failures` per source and a non-zero count breaks `tiesOut` —
  arithmetic over what arrived can balance perfectly while whole endpoints are absent.
- **`ARCREDITPAYMENT` is OUTFLOW, which is the opposite of what the prefix suggests.** 72 of
  1,000 live payments. These carry `Invoice.Type = ACCRECCREDIT` with a `CN-` number — the
  `Invoice` field holds a CREDIT NOTE, and paying a customer's credit note rather than
  allocating it is a refund, so cash leaves. Reading "AR" as receivable and therefore inflow
  would have put 72 records on the wrong side of the forecast. `APCREDITPAYMENT` is the mirror
  (INFLOW), included by symmetry and asserted, not defaulted.

Dedupe keys in use: `batchExternalId`/`memberPaymentIds` (payments↔batches, both directions),
`overpaymentExternalId` on bank rows (bank↔overpayments — matched on the LINK field, since the
primary keys differ), `providerType.endsWith("-TRANSFER")` (transfers), and
`amountIsLive`/`creditIsLive` for cancelled records.

## BACKLOG — approved to RECORD, not to build (each its own tiny branch)

Nothing here is started without an explicit go-ahead. See also the per-feature
"LOGGED, NOT BUILT" list under the batch-payments card.

### 1. Make `db:migrate` fail loudly

`package.json:13` is still `"db:migrate": "prisma migrate dev"`, and `.env`'s `DATABASE_URL`
points at **production**. `migrate dev` is not a read: it diffs, can prompt to reset, and
creates a shadow database. One absent-minded `npm run db:migrate` is the single cheapest way
to lose JENKI's data, and the only thing standing between that and the database today is
remembering not to type it.

**Verified harmless as it stands** (2026-10-27): nothing invokes it. `postinstall` runs
`prisma generate` only, `build` is `next build`, there is no `vercel.json`, the Vercel project
reports an unoverridden `npm run build`, and CI runs typecheck/lint/test/eval/build with no
database and no env. So this is a latent footgun, not a live one.

Proposed change — one line, no code paths touched, CI unaffected:

```json
"db:migrate": "echo 'REFUSED: prisma migrate dev must never run against production. Use migrate deploy against a non-production endpoint.' >&2 && exit 1"
```

Shape: own branch, one-line diff plus a note here. It cannot regress anything, because the
script has no current caller. Reinstate a working `db:migrate` only once a non-production
endpoint exists, pointed at that endpoint explicitly.

### 2. Align the Node version across local, CI and Vercel

Three versions, none of them pinned by the repo:

| Where | Version | Source |
|---|---|---|
| Vercel (production) | **24.x** | project setting, read via `vercel project inspect` |
| CI | **20** | `.github/workflows/ci.yml`, `actions/setup-node` |
| Local | **20.11.1** | whatever is installed |

`package.json` has no `engines` field and there is no `.nvmrc`, so nothing enforces agreement
and the drift is invisible until something breaks. **Production runs a major version that CI
has never executed** — the gate proves the build works on 20 and then ships it on 24. Node 24
removes and changes APIs relative to 20, so a failure of that kind surfaces for the first time
in front of a customer, which is exactly the class of defect the merge gate exists to catch.

Not a pure repo change: **Vercel's Node version is a dashboard setting**, so whichever version
is chosen, that one has to be set there too and the project redeployed.

**The decision is which version**, and it is not mine:
- **Node 22.x** — current LTS, the conservative choice; means changing Vercel down from 24.
- **Node 24.x** — matches production today; means moving CI and local up, and accepting a
  newer runtime than LTS.

Then: `"engines": { "node": "<chosen>" }` in `package.json`, the same in `setup-node`, an
`.nvmrc` for local, and the Vercel setting to match. Own branch, config only.

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
- ~~Does money move between JENKI's own bank accounts?~~ **ANSWERED 2026-10-22 — YES,
  constantly.** 613 of the 1,000 rows in the live bank window are transfers (307
  RECEIVE-TRANSFER, 306 SPEND-TRANSFER). No need to ask Luke. `/BankTransfers` is therefore
  real, and the double-counting consequence is recorded in the payment-family survey above.
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
