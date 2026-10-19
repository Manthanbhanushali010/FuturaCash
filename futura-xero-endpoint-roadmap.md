# FUTURA — Full Xero Endpoint Map for the Cash Flow Pipeline
*Companion to the payments/batchpayments/journals breakdown — this is the fuller picture Luke
asked for ahead of the Wednesday build session.*

> **Repo note, added on commit (2026-10-19).** Two claims in this document were checked against
> the codebase and are out of date; see "Verified against the repo" at the foot of this file.
> Everything else is preserved as written.

---

## The one thing to flag before Wednesday: Journals is no longer a free scope

The 1 Oct plan (payments-endpoints-breakdown doc, Part 3) treated `accounting.journals.read`
as just another scope to request alongside `accounting.payments.read` in the same combined
deploy. That's no longer accurate.

As of Xero's move to tiered commercial app pricing (announced Dec 2025), the `/Journals`
endpoint — the full, read-only, system-generated audit trail of every posting — is now gated
behind Xero's **Advanced** pricing tier (starts at **$1,445 AUD/month**, roughly £700–750/month
at current rates — worth checking the live rate rather than trusting that conversion), **plus**
a security assessment and explicit use-case approval from Xero directly. This is confirmed from
two independent sources (Xero's own dev blog and a third-party integrator's scope breakdown).

`ManualJournals` is unaffected — it stays free at every tier, under its own
`accounting.manualjournals` scope. That's the endpoint for adjustments *you or an app* post
to the ledger; it does not include the system-generated postings from invoices, bills, and
bank transactions.

**Practically:** Luke already put "journals" in the later-than-MVP bucket, which turns out to be
the right call for a different reason than either of us assumed — it's not just lower priority,
it's a real cost-and-approval gate. Worth telling him this explicitly so the deprioritisation is
understood as "blocked behind a paid tier + Xero approval," not "we just haven't gotten to it."
`manual journals`, listed separately in his same bucket, has no such gate and could move earlier
if there's ever a reason to.

Sources:
- [Navigating the shift: Journals vs. Manual Journals in the new Xero app tiers](https://devblog.xero.com/navigating-the-shift-understanding-journals-vs-manual-journals-in-the-new-xero-app-tiers-dd8cc09a8418)
- [Xero Scopes: What Changed and What It Means for Your Integration](https://www.apideck.com/blog/xero-scopes)

---

## What "general ledger" means, and how it maps to Xero's API

Standard accounting mechanics, independent of Xero:

- **Journal** — the first place a transaction is recorded, as an original dated entry (debit/credit).
- **General ledger** — the organised record those journal entries get posted into, grouped by
  account (assets, liabilities, equity, revenue, expenses).
- **Trial balance** — the ledger's account balances rolled up into one list, the step before
  they become financial statements (P&L, balance sheet).

Mapped onto Xero's API:

| Accounting concept | Xero API equivalent | Notes |
|---|---|---|
| Journal entry (system-generated) | `/Journals` | Every invoice, bill, payment, and manual journal auto-generates one. Now Advanced-tier-gated (see above). |
| Journal entry (manual adjustment) | `/ManualJournals` | Free at all tiers. What *you* post, not what Xero generates. |
| General ledger (organised by account) | Not a single endpoint — it's the aggregate of everything posted against `/Accounts` | No direct pull; it's reconstructed from the transactional endpoints. |
| Trial balance | `/Reports/TrialBalance` (Reports API) | This is what the Xero-embedded developer meant by "pull Trial Balance separately as an independent reconciliation check" in the Mayday meeting notes. |

This is exactly why the Xero developer's advice (Part 1 of the payments breakdown) was to use
`/Journals` for deep reconciliation and `Trial Balance` as an independent check — they're the two
ways to verify "does our sum of transactional data match what Xero itself believes the ledger
says." Both are now either paid/gated (`Journals`) or sit in the `reports` bucket Luke put in
the later group.

---

## Luke's list, mapped against where Futura actually is

**Build the cash flow (his "core" bucket):**

| Endpoint | Status | Notes |
|---|---|---|
| Bank transactions | Built | Live against JENKI; `LineItems.Description` fix shipped; pagination/truncation handling fixed for invoices, flagged as not yet fixed here in the 1 Oct doc — confirm this landed. |
| Bank accounts | **Resolved — see new section below** | Not a separate endpoint. It's `GET /Accounts` filtered to `Type=BANK`. |
| Batch payments | Scope confirmed needed (401 proved it), build approved 1 Oct | Status of the actual deploy unconfirmed — see open questions below. |
| Invoices | Built, with a recent fix in flight | `DueDate ASC`, PAID removed from default statuses, truncation flag added — tested, per the 1 Oct doc still "sitting unpushed" as of that writing. |
| Payments | Same scope as batch payments (`accounting.payments.read` covers both) | Not a separate build effort from batch payments — worth telling Luke these two are one unit of work, not two. |
| Repeating invoices | Not started | New. |
| Purchase orders | Not started | New — **also listed in his "later" bucket; worth clarifying with Luke which he actually means before building either way.** |
| Credit notes | Not started | New. |

**Enhance the data (his "enhance" bucket):**

| Endpoint | Status | Notes |
|---|---|---|
| Contacts | Partially present implicitly (counterparty names already shown in the app) | Not confirmed as its own standalone fetch — worth checking. |
| Contact groups | Not started | New. |
| Tracking categories | Already identified, not yet built | The 1 Oct doc flags this directly: "Account / site / revenue centre enrichment Luke asked for — likely maps to Xero's Tracking Categories concept." This is probably the single most valuable item in this whole bucket for JENKI specifically, since site/revenue-centre breakdowns are exactly what their multi-location business needs. |
| Bank accounts | Duplicate — also listed in his core bucket | Same note as above. |
| Linked transactions | Not started | New — links things like a credit note applied to an invoice. |
| Organisation | Not started | New — base currency, financial year end, timezone; usually a cheap one-off fetch. |
| Tax rates | Not started | New, though tax rate/type already appears inside invoice line items shown today. |

**Later / post-MVP (his bucket):**

| Endpoint | Status | Notes |
|---|---|---|
| Purchase orders | Duplicate — see above | |
| Manual journals | Free at all tiers | No gate; could move up if there's ever a reason to. |
| Journals | Paid tier + Xero approval required | See top of this doc — correctly deprioritised, now for a concrete reason. |
| Reports | Includes Trial Balance | The reconciliation-check mechanism the Xero developer recommended. |

---

## The rest of the Accounting API catalog — what exists beyond Luke's 13, and what's actually worth building

Pulled this together since Luke's list wasn't the full picture. The Accounting API has roughly
30 resources total. Most of the ones not on his list genuinely don't matter for a read-only cash
flow forecasting tool — listing them so nobody spends time on them later wondering if they were
missed, and flagging the handful that do matter.

**Resolves an open question — Bank Accounts isn't its own endpoint.** `GET /Accounts` (scope:
`accounting.settings`) is Xero's chart of accounts — every account the business has, bank
accounts included, distinguished by `Type=BANK`. There's no separate "Bank Accounts" endpoint to
build against; it's a filter on `/Accounts`. One small, cheap fetch (not yet built) covers both
"what bank accounts exist" and, as a side effect, the full chart of accounts — useful later for
categorising transactions by account type.

**Two genuinely valuable ones Luke didn't list, that come free with the scope already approved.**
`Overpayments` and `Prepayments` are unlocked by the exact same `accounting.payments.read` scope
as Payments and BatchPayments — nothing extra to request, nothing extra to deploy. They matter
for cash accuracy specifically: this is real cash already sitting in the bank that hasn't been
matched to an invoice yet (a customer overpaid, or paid an invoice before it existed). Leaving
these out means the cash position is technically understated for exactly the kind of edge case
that shows up as "why don't these numbers match what's actually in the account." Worth building
alongside Payments/BatchPayments rather than treating as separate, later work — it's the same
deploy, same data pull, same scope.

**Worth a look, not urgent:**
- `BankTransfers` — money moved between the business's *own* bank accounts. With JENKI running
  six locations, this could plausibly matter if money moves between site-level and head-office
  accounts — worth asking Luke whether that happens, since if it does, ignoring it could make
  individual account balances look wrong even when the consolidated position is fine.
- `ExpenseClaims` — employee reimbursement claims, a real (if usually small) future cash outflow.
- `Reports/AgedReceivablesByContact` and `Reports/AgedPayablesByContact` — another independent
  reconciliation check, in the same spirit as Trial Balance: compare Futura's own outstanding-
  invoice computation against Xero's own aged report, per contact.
- `Budgets` — only relevant if/when Futura ever builds a forecast-vs-budget comparison feature;
  not part of the current pipeline.

**Genuinely not relevant to this product**, so they shouldn't come up again unless the product
changes shape: `Attachments` (file management, not financial data), `BrandingThemes` and
`PaymentServices` (invoice template/payment-provider cosmetics), `Users` (who has Xero access,
not financial data), `InvoiceReminders` (Xero's own reminder email settings), `History` (generic
audit trail per record — compliance/audit tooling, not forecasting), `Items` (inventory/service
catalog — only matters if line-item-level product categorisation ever becomes a feature),
`Quotes` and `Receipts` (pre-sale quotes and expense receipt images — speculative at best),
`Currencies` (only matters if JENKI ever deals in foreign currency — unlikely for a UK matcha
bar chain), `Employees` (a lightweight Accounting API stub, not the real Payroll API, which is a
separate product entirely with its own scopes).

Sources:
- [Xero Accounting API resource reference (Java SDK docs)](https://xeroapi.github.io/Xero-Java/v4/accounting/index.html)
- [Xero API Integration Guide & API Directory](https://getknit.dev/blog/xero-api-directory/)
- [Xero API Guide 2026: Endpoints, OAuth, Limits & Integration Tips](https://satvasolutions.com/blog/xero-api-integration-guide)

---

## Open questions worth resolving before or at the meeting

1. **Who is James?** Not in any of the notes from the Mayday/David Tuck introduction — worth
   confirming whether this is the Xero-embedded developer from that meeting (under a different
   name than recorded) or someone new, so the right context gets pulled together for Wednesday.
2. **Did the 1 Oct combined deploy actually ship?** — the `accounting.payments.read` /
   `accounting.journals.read` scope additions, the bank-transaction truncation fix, and the
   overdue-invoice fix were all "approved and ready to build" as of that writing. If it's
   shipped and Luke's re-authorised, Payments/BatchPayments are probably much closer to done
   than this list implies. If it hasn't, that's the actual next action, ahead of anything new.
3. **Purchase orders — core or later?** Luke's message lists it in both buckets.
4. **Does money move between JENKI's own bank accounts (BankTransfers)?** Worth asking Luke
   directly rather than assuming either way.

---

## One-sentence status

**Of Luke's thirteen distinct endpoints, two are built, two are scope-approved-and-maybe-shipped,
one is identified-but-unbuilt, the Bank Accounts ambiguity is resolved (it's a filtered
`/Accounts` call, not a separate endpoint), two more endpoints (Overpayments, Prepayments) turn
out to be free wins under the scope already approved, and the rest of the ~30-resource Accounting
API catalog has been triaged so nothing gets built that doesn't actually serve a cash flow
forecasting product.**

---

## Verified against the repo (2026-10-19)

Two claims above were checked against the codebase and the live site, and both are out of date.
Preserved rather than edited in place, so the original reasoning stays readable.

**1. Bank accounts are already built, not "not yet built."** The doc correctly resolves that
bank accounts are `GET /Accounts` filtered to `Type=BANK` — but that fetch already exists and has
been live since Spec 1:

- `integrations/xero/client.ts:301` — `xeroGet("/Accounts", { tenantId })`, cached 15 minutes
- `integrations/xero/normalise.ts:192` — `isBankAccount: account.Type === "BANK"`
- `integrations/types.ts:83` — `isBankAccount` on `NormalisedLedgerAccount`
- `app/xero/page.tsx:343` — renders a `bank` pill on those rows

Live on production the same day: **341 accounts read, 32 carrying the bank pill.** So "what bank
accounts exist" is answered today. Nothing to build; the item can be closed.

**2. Answer to open question 2 — the 1 Oct combined deploy did NOT ship.** Verified 2026-10-17:
`origin/main` was still `9457e07` from 11 September. No `accounting.payments.read`, no
`accounting.journals.read`, no bank-transaction truncation flag, and the overdue-invoice fix was
uncommitted in the working tree. **Luke therefore cannot have re-authorised for payments** —
production has never requested that scope, so it has never appeared on a consent screen.

The invoice fix is now committed (`0eeed9d`) but, at the time of writing, still unpushed.

**Also worth correcting:** the invoices row says "truncation flag added" as if in flight. The
truncation flag for *invoices* shipped in spec-1b (`9457e07`, 11 Sep) and is live. It is **bank
transactions** that still lack it — `fetchBankTransactions` remains `maxPages ?? 2` with no flag,
which on JENKI means a ~14-day window reported as though it were complete.
