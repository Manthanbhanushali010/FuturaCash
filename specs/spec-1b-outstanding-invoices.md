# Spec 1b — The outstanding position, not a date-bounded sample

## Problem

`Receivable outstanding` and `Payable outstanding` are computed from whatever invoices the
bounded read happened to return, not from what is actually outstanding.

The read fetches 200 invoices ordered by `DueDate`. Ordered ascending it returned JENKI's
oldest — due 2020-11 to 2021-09, all `PAID` — and both totals rendered blank. Ordered
descending (the current state) it returns the furthest-future due dates: on 2026-09-11 the
window is 2026-09-30 to 2027-04-05, so **every invoice shown is future-dated and any overdue
invoice sorts below the cut**.

Overdue receivables are the most cash-relevant invoices a business has. A total that looks
authoritative while silently omitting them is the confidently-wrong number that
non-negotiable #1 exists to prevent. Blank was honest; incomplete-but-confident is not.

## Users

The finance operator reading the position. Today: Luke, on JENKI's live books.

## Outcome

The two totals reflect every outstanding invoice, or the screen says plainly that they do
not. No third possibility.

## Functional Requirements (EARS)

1. WHEN the position is computed, the system SHALL derive it from invoices selected by
   outstanding status, NOT by a date-ordered window.
2. WHEN an invoice is fully paid, the system SHALL exclude it from the fetch rather than
   fetching and discarding it.
3. IF the outstanding set exceeds the fetch bound, THEN the system SHALL mark the result
   incomplete and the screen SHALL say so next to the totals.
4. WHILE the result is incomplete, the system SHALL NOT present the totals as final figures.
5. WHEN the outstanding set fits within the bound, the system SHALL present the totals
   without qualification.

## Design decision — `Statuses`, not `where=AmountDue>0`

Both express "outstanding". They are not equally safe.

`Statuses` is a first-class documented parameter already used by this code path. Dropping
`PAID` from it leaves `AUTHORISED` and `SUBMITTED` — invoices that represent a real
obligation and have not been settled. `core/position.ts` already excludes any commitment
whose `amountDue` is zero, so a credited-to-zero invoice is still handled.

`where=AmountDue>0` is a filter on a computed field. Xero documents an optimised subset for
`where` clauses, and a non-optimised clause on an org with years of history risks slow
responses or timeouts — a failure that would appear only on large customers, which is the
same class of defect as the one being fixed. It also cannot be verified from this machine:
local credentials belong to a different Xero app and cannot read a production grant.

Chosen: **drop `PAID` from the default statuses.** Same set for our purposes, on a parameter
whose behaviour is documented and already proven in this codebase.

## How this changes the invoice table

This is a visible product change, not only a totals fix.

- The card currently lists AUTHORISED, SUBMITTED **and PAID** invoices. Of the 200 JENKI rows
  now shown, 39 are `PAID`. Those rows disappear.
- The card is retitled **"Outstanding invoices and bills"** and its subtitle states that paid
  invoices are excluded, so the absence is explained rather than noticed.
- Every row will now carry a non-zero `Outstanding` amount, making the column meaningful:
  today it reads `0.00` on 39 rows.
- Paid history is out of scope here. Browsing it is a different feature (filtering and
  pagination), and this product's job is what is coming, not what has settled.

## Non-goals

- Browsing or searching paid history.
- Date-range filtering.
- Raising `maxPages`. If the bound is hit, the answer is to SAY SO, not to fetch more and
  hope. Requirement 3 exists so the limit is visible rather than silent.
- Changing `core/position.ts`. It was correct throughout; it was fed the wrong input.

## Edge cases

- An org with more outstanding invoices than the bound → incomplete, surfaced (req 3).
- An invoice credited to zero while still AUTHORISED → fetched, then excluded by the existing
  zero-amount rule in `position.ts`. No double handling.
- No outstanding invoices at all → totals render `—`, and that is now a true statement rather
  than an artefact of the window.
- Multiple currencies → unchanged; totals stay grouped per currency, never summed across.

## Acceptance criteria

1. Both totals are non-blank for JENKI and **match Xero's own Aged Receivables Summary and
   Aged Payables Summary** for the same organisation. This is Luke's check — they are his
   books, and it is the only external ground truth available.
2. No `PAID` invoice appears in the table.
3. Every row shows a non-zero Outstanding amount.
4. With the bound artificially set to 1 page against a full page of results, the screen
   displays the incomplete warning.
5. Existing tests stay green; the money eval gate is untouched.

## Constitution / invariant check

- #1 Correctness over speed — the entire point: no confident total over an unknown subset.
- #2 Read-only — unchanged.
- #3 Tenant isolation — unchanged.
- #4 Integer minor units — unchanged; `core/position.ts` is not modified.
- #5 Spec first — this document.
- #6 Human approves — plan reviewed before building.

## Task breakdown

1. `integrations/xero/client.ts` — default statuses `["AUTHORISED","SUBMITTED"]`; return
   `{ invoices, truncated }` so the caller can tell a full read from a bounded one.
2. `integrations/xero/index.ts` — carry `invoicesTruncated` onto `XeroSnapshot`.
3. `app/xero/page.tsx` — retitle the card, state the exclusion, show the warning when
   truncated.
4. Tests — defaults exclude PAID; truncation true on a full final page and false on a short
   one; a snapshot carrying the flag through.
5. `context/progress-tracker.md`.

## Verification

Unit and integration tests for the fetch and the flag; full suite green; build clean. Then
the live check against production, and Luke comparing both totals to Xero's aged summaries.

## Dependencies / open questions

- **Is `AUTHORISED` + `SUBMITTED` the complete definition of outstanding for JENKI?** It
  excludes `DRAFT` deliberately (not an obligation). Worth confirming with Luke that JENKI
  does not rely on drafts for anything cash-relevant.
- Xero's aged summaries age by due date and may apply their own cutoffs; small differences
  need explaining before being treated as a defect.
