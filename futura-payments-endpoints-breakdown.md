# FUTURA — Post-Mayday Meeting: Complete Breakdown
*What the Xero developer told you, what it confirmed, what's approved to build, and
exactly what happens next.*

> **Repo note, added on commit (2026-10-19).** Preserved as written, with one correction
> appended at the foot: the "14-day window" recorded in Part 7 as a separate finding is not a
> separate bound. See "Verified against the repo".

---

## PART 1 — What actually happened in the meeting

You met with a Xero-embedded developer (introduced via David Tuck, who owns Mayday and
is active in the Xero community). He gave you the real, structural explanation for a bug
you'd been chasing for days: **why "payment" transactions from various merchants were
completely missing from JENKI's data, while other transaction types came through fine.**

**His core point:** `/BankTransactions` is only ONE of several separate Xero endpoints.
Depending on *how* a payment happened, it lands in a different place entirely:

| Endpoint | What lands here |
|---|---|
| `/BankTransactions` | Direct bank-level transactions |
| `/Payments` | Payments matched against an invoice |
| `/BatchPayments` | Payments processed in a batch (e.g. supplier runs) |
| `/Prepayments` | Prepayments |
| `/Overpayments` | Overpayments |
| `/Journals` | Every accounting posting — the completeness check against the others |

**His recommended build order:** start with `BatchPayments` and `BankTransactions`, then
expand. Pull `Trial Balance` reports separately as an independent reconciliation check.
Build a monthly automated "what's missing for this client" safety check over time.

**His operational warning:** Xero's own SDK (`xero-node`) handles rate limiting poorly —
this independently confirms your original architecture decision (no SDK, plain fetch
calls through your own anti-corruption layer) was right from day one.

---

## PART 2 — What the real-data survey confirmed

Rather than taking the explanation on faith, you had Claude Code test it directly against
JENKI's live Xero connection. The result was clean and conclusive:

```
/Payments        HTTP 401  AuthorizationUnsuccessful
/BatchPayments    HTTP 401  AuthorizationUnsuccessful
/Prepayments      HTTP 401  AuthorizationUnsuccessful
/Overpayments     HTTP 401  AuthorizationUnsuccessful
```

**401, not 404, not an empty array.** The endpoints exist and respond — your app simply
never had permission to ask. This is as structural a confirmation as you can get.

**The scope that unlocks all four:** `accounting.payments.read` — one scope covers
Payments, BatchPayments, Overpayments, and Prepayments together. `accounting.journals.read`
is a separate, additional scope for the Journals endpoint.

**One thing this quietly corrected:** your original "salary works, payments don't" theory
was a coincidence, not the real signal. The survey showed there's actually zero salary
data coming through either — the real distinction was always "data behind scopes we hold"
vs. "data behind scopes we don't," nothing more specific than that.

---

## PART 3 — What's approved and about to be built (one combined deploy)

Three things, bundled into a single deploy — because Luke has to re-authorise regardless
(new scopes always force fresh consent), so this is the efficient moment to ship
everything ready at once rather than three separate disruptions:

1. **Add `accounting.payments.read` and `accounting.journals.read`** to the requested
   scopes.
2. **Fix bank-transaction pagination** — `fetchBankTransactions` has been silently capped
   at 200 rows with no truncation flag (same defect class the invoices had, already fixed
   there, never fixed here). Add the flag so this is honest going forward.
3. **Push the overdue-invoice fix** — already built and tested (`DueDate ASC`,
   `maxPages: 10`, 250 tests passing) but still sitting unpushed. Ship it in this same
   round rather than as a separate deploy.

**UPDATE — verified 17 Oct via Claude Code against the actual repo: this deploy never
shipped.** `origin/main` was still at the 11 Sep commit; none of the three items above were
present in production. `accounting.journals.read` should in any case be dropped from this
plan — see the Journals pricing-gate finding in the companion roadmap doc, confirmed
independently the same week. Luke cannot have re-authorised for payments, because
production never requested that scope in the first place. The invoice fix has since been
committed (not yet pushed as of this writing) and is tracked directly in `STATUS.md` at the
repo root, which now carries the live, verified status — treat that file, not this
historical section, as current for anything about deploy state.

---

## PART 4 — The exact sequence, step by step

```
1. Approve the combined build          ← YOU, in Claude Code
2. Review the plan when it comes back  ← YOU, check protected paths + the new
                                          truncation flag specifically
3. Push                                ← YOU, say "push"
4. Verify nothing broke live           ← YOU, check www.futuracash.co.uk/xero
5. Luke re-authorises ONCE             ← LUKE, same URL, clicks Re-authorise
6. Consent screen should now list      ← PROOF POINT — if "payments"/"journals"
   payments + journals explicitly        don't appear here, something's wrong
7. Claude Code surveys the REAL data   ← Claude Code, against JENKI's actual
   from all new endpoints                Payments/BatchPayments/Journals data
8. Field-level normalisation is        ← Only AFTER the survey — same "survey
   scoped and built                      first, build second" discipline that
                                          worked for LineItems.Description
```

**Important:** step 7-8 is a separate, later phase. Re-authorising does NOT
automatically make a "Payments" table appear on screen — that display still needs to be
built, after the survey tells you what's actually in the data.

---

## PART 5 — What to tell Luke (for the re-authorisation)

> One more re-authorise needed — last time for a while. Turns out the "missing payments"
> issue was Xero gatekeeping that data behind a permission we hadn't asked for yet
> (confirmed via the Mayday conversation — really useful meeting). Adding that now, plus
> one more permission (journals) that lets us double-check everything's complete, so
> we're not back here a fourth time. Same quick click as before.

**Note: drop the "journals" half of this message** — see the Part 3 update above. The
re-authorise message, when it's actually sent, should only mention payments.

---

## PART 6 — Where to check things, concretely

| What | Where |
|---|---|
| Is the build ready? | Your terminal / Claude Code session in VS Code |
| Did the deploy work? | `www.futuracash.co.uk/xero` — same URL for you and Luke |
| Did the new scopes register? | The Xero **consent screen** itself, when Luke clicks Re-authorise — this is the real proof, not a docs page |
| Endpoint field documentation | developer.xero.com/documentation/api/accounting/payments (and /batchpayments, /journals) |
| Scope-to-endpoint mapping | developer.xero.com/documentation/guides/oauth2/scopes/ |
| Your app's registered config | developer.xero.com/myapps → FuturaCash → Configuration |

---

## PART 7 — Still open, not forgotten

- **Local `.env` tenant separation** — resolved, in the sense that local now genuinely
  cannot read JENKI's live Xero connection at all (confirmed 17 Oct: local refresh fails
  with `invalid_grant — Refresh token was issued to a different client`, because local and
  production are different Xero apps). That's the correct, safe outcome, even though it
  cost real debugging time twice before it was understood as expected behaviour rather than
  a bug.
- **Neon owner password rotation** — flagged as needing rotation, not yet confirmed done.
- **Dead error styling on `/xero`** (`border-error/40`, `bg-error/5` compiling to
  nothing) — cosmetic, longstanding, low priority.
- **Account / site / revenue centre enrichment** Luke asked for — likely maps to Xero's
  Tracking Categories concept, but whether JENKI's org actually uses Tracking Categories at
  all is now the open question that decides if this is buildable — confirm before investing
  time in it.
- **From the 17 Oct verification, resolved 22 Oct:** the apparent 14-day window on
  bank-transaction fetches is not a separate bound — `fetchBankTransactions` sends no date
  filter at all; it's simply the 200-row cap divided by JENKI's ~14 transactions/day, the
  same truncation defect the invoice fix just resolved, not an independent issue.
- **Confirmed, not just suspected, as of 22 Oct:** the invoice fix going live surfaced
  $3,612.50 USD as a separate payable line (correctly grouped per-currency, never summed
  across), on top of the CNY transaction already known about — JENKI trades in at least
  three currencies. The roadmap doc's earlier "Currencies probably not relevant" triage was
  wrong; corrected there.
- **The forecast engine itself** — still not started. This entire payments/journals
  effort is still part of the *data foundation*, not the forecasting product.

---

## The one-sentence status

**The diagnosis was right, but the build was never shipped — 17 Oct verification against
the actual repo confirms `accounting.payments.read` was never added to production, the
invoice fix sat uncommitted for three weeks, and Luke was never asked to re-authorise for
anything; `STATUS.md` in the repo now carries the live, verified state going forward.**

---

## Mechanics behind the Part 7 resolutions, and current deploy state

*Appended on commit. Part 7 now carries the conclusions; this keeps the detail that a prose
summary loses, plus where the build actually stands.*

**Why the 14-day window had no independent fix.** `fetchBankTransactions` sends exactly three
query parameters, none of them a date:

```
searchParams: { where, page: String(page), order: "Date DESC" }
                  ^ Status=="AUTHORISED" only
```

No `Modified-After` header, no date range, no `where` clause on `Date`. So:

```
maxPages 2  x  100 rows/page  = 200 rows, newest first
JENKI measured volume         = ~14 transactions/day
200 / 14                      = ~14 days
```

**The consequence is worse than a short window.** The cap is on ROWS, not days, so the visible
history silently narrows as the business gets busier — a seasonal spike in card takings
shortens it with no code change. At `maxPages: 10` the same arithmetic gives roughly 70 days
today, and less next December. A test now asserts the fetch sends only `where`/`page`/`order`,
because this was twice mistaken for a separate date bound.

**Deploy state as of this commit:**

| Item | State |
|---|---|
| Overdue-invoice fix (`DueDate ASC`, `maxPages: 10`) | **shipped** — `0eeed9d`, live, verified |
| `accounting.payments.read` | **committed, NOT pushed** — `54543b7` |
| Bank-transaction truncation flag + `maxPages: 10` | **committed, NOT pushed** — `54543b7` |
| `accounting.journals.read` | **dropped** — Advanced-tier gate; a test pins its absence |
| Payments/BatchPayments/Prepayments/Overpayments normalisers & display | **not started** — survey first |

The invoice fix going live is what produced the figures quoted in Part 7: **814 outstanding
invoices** (within the 1,000 bound, so the totals are complete rather than a floor), **200 of
200 displayed rows overdue** where previously none were, receivable **£42,097.99** and payable
**£471,048.96 + $3,612.50 USD**. The oldest unpaid invoice is dated **2025-09-05**, thirteen
months back — worth Luke's eye, since it affects whether £471k is a live obligation or stale
data never closed off in Xero.

**Still Luke's to confirm, not ours:** spec-1b's acceptance test was always that both totals
match Xero's own Aged Receivables and Aged Payables summaries. Complete-within-the-bound is
verified; *correct* is not, and only he can run that comparison against his own books.
