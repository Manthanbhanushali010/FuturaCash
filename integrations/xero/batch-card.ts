import { add, money, parseCurrency, type CurrencyCode, type Money } from "../../core/money";
import type { CommitmentDirection, NormalisationFailure } from "../types";
import { parseXeroDate } from "./dates";
import { toMoney } from "./normalise";
import type { XeroBatchPayment } from "./schemas";

/**
 * The standalone Batch payments card — a pure projection, no I/O.
 *
 * DELIBERATELY NOT PART OF `reconcile`, and this is the whole point of the module existing
 * separately. A batch payment is money that has already left the bank, so it is already
 * inside the bank-transaction read: measured live, the 26 batches in a 30-day window summed
 * to 661,964.41 GBP and the 619 member payments excluded from that same window as
 * BATCH_MEMBER summed to exactly the same figure. Adding batch totals to any cash position
 * would therefore double-count. This module consequently produces NO net figure, no grand
 * total and no single number that mixes directions — only per-currency, per-direction
 * subtotals, which cannot be mistaken for cash movement.
 *
 * It is also why the integrity bucket lives here rather than in `reconcile`: this card
 * verifies a batch against its own nested members, which is a statement about one endpoint's
 * internal consistency, not about two endpoints agreeing.
 */

/** Whether a batch's own total agrees with the payments nested inside it. */
export type BatchTie = "TIES" | "MISMATCH" | "UNCHECKABLE";

export interface BatchPaymentRow {
  externalId: string;
  /** The batch's own date, ISO. Null only when Xero sent no date at all. */
  paidAt: string | null;
  direction: CommitmentDirection;
  /** PAYBATCH / RECBATCH, shown as-is rather than translated. */
  providerType: string;
  providerStatus: string;
  total: Money;
  memberCount: number;
  /**
   * The nested members' `BankAmount`, summed.
   *
   * `BankAmount` and not `Amount`: `Amount` is in the invoice's currency while `BankAmount`
   * is in the bank account's, and the batch total is quoted in the bank account's. Comparing
   * a total against a sum of possibly-foreign amounts would invent mismatches under a
   * currency rate and could equally hide a real one. Live they are identical on all 722
   * members of the last 30 days, every one GBP — which is consistent with this reasoning
   * rather than evidence against it.
   */
  memberTotal: Money;
  tie: BatchTie;
  /** Why the batch is in the integrity bucket. Null when it ties. */
  tieReason: string | null;
}

/**
 * Subtotals never cross a currency OR a direction.
 *
 * Crossing currencies is the documented rule. Crossing directions is worse and unstated:
 * PAYBATCH is money out and RECBATCH is money in, so one "total batch payments" figure would
 * net a supplier run against a customer receipt and mean nothing at all. Both lives here as
 * separate fields so no caller can accidentally produce either.
 */
export interface BatchCurrencySubtotal {
  currency: CurrencyCode;
  inflow: Money;
  outflow: Money;
  inflowCount: number;
  outflowCount: number;
}

export interface BatchPaymentCard {
  rows: BatchPaymentRow[];
  subtotals: BatchCurrencySubtotal[];
  /**
   * MUST BE EMPTY. Any batch whose total does not equal its nested members' sum, or whose
   * members cannot be summed at all.
   *
   * An empty bucket is a real assertion rather than a decoration: two of the 22 live batches
   * hold exactly 200 members, which is the shape a silent nested-member cap would take, and
   * both tie to the penny — so the bucket is also the detector for that cap appearing.
   */
  integrityBucket: BatchPaymentRow[];
  /**
   * Batches dated after `now`.
   *
   * The window has a lower bound only, so a future-dated batch is inside it: JENKI has one
   * dated 2026-11-02. Counted and stated rather than filtered, because a scheduled supplier
   * run is real information — it just is not "the last 30 days", and a card claiming to show
   * only the last 30 days while listing November would be lying in small print.
   */
  futureDated: number;
  failures: NormalisationFailure[];
}

export interface BuildBatchPaymentCardOptions {
  /**
   * Org base currency, used ONLY when a batch's bank account omits its own.
   *
   * Nullable on purpose. The caller may not know it — the organisation read can fail or the
   * base currency can be one `core/money` does not support — and a hardcoded "GBP" would
   * label unknown-currency money as sterling, which is the exact failure mode this project
   * keeps finding. With null, a batch that also lacks `Account.CurrencyCode` becomes a
   * reported failure instead of a confident wrong label.
   */
  fallbackCurrency: CurrencyCode | null;
  now?: Date;
}

/**
 * A batch's total, from TotalAmount with Amount as a fallback, fatal when neither is present.
 *
 * Mirrors `batchTotal` in normalise.ts deliberately rather than importing it: the rule that
 * matters is that a missing total is FATAL, because `toMoney(undefined)` returns zero and the
 * first version of the payment layer read only `Amount` — a field live batches never send —
 * so all 1,421 would have become £0.00 and summed to nothing with nothing erroring.
 */
function batchTotal(batch: XeroBatchPayment, currency: CurrencyCode): Money {
  const total = batch.TotalAmount ?? batch.Amount;
  if (total === undefined) {
    throw new Error("batch payment has neither TotalAmount nor Amount");
  }
  return toMoney(total, currency, "TotalAmount");
}

function batchDirection(type: string): CommitmentDirection {
  if (type === "PAYBATCH") return "OUTFLOW";
  if (type === "RECBATCH") return "INFLOW";
  // Not defaulted. A batch of an unknown kind on the wrong side of the card is a wrong
  // number on screen; reported as a failure, it is a visible gap instead.
  throw new Error(`Unrecognised Xero batch payment type "${type}"`);
}

/** The batch's currency is its bank account's; see the schema note on `CurrencyCode`. */
function batchCurrency(batch: XeroBatchPayment, fallback: CurrencyCode | null): CurrencyCode {
  if (batch.Account?.CurrencyCode) return parseCurrency(batch.Account.CurrencyCode);
  if (fallback) return fallback;
  throw new Error(
    "batch payment has no Account.CurrencyCode and the organisation's base currency is unknown",
  );
}

function summariseMembers(
  batch: XeroBatchPayment,
  currency: CurrencyCode,
): { count: number; total: Money; uncheckable: string | null } {
  const members = batch.Payments ?? [];
  let total = money(0, currency);
  for (const member of members) {
    if (member.BankAmount === undefined) {
      // Falling back to `Amount` here would compare a bank-currency total against a
      // possibly-foreign sum and call the difference a mismatch. Unverifiable is the honest
      // answer, and it still lands in the must-be-empty bucket so it cannot pass unnoticed.
      return {
        count: members.length,
        total: money(0, currency),
        uncheckable: "a nested payment has no BankAmount, so the members cannot be summed",
      };
    }
    total = add(total, toMoney(member.BankAmount, currency, "Payments[].BankAmount"));
  }
  return { count: members.length, total, uncheckable: null };
}

function toRow(
  batch: XeroBatchPayment,
  options: BuildBatchPaymentCardOptions,
): BatchPaymentRow {
  const currency = batchCurrency(batch, options.fallbackCurrency);
  const total = batchTotal(batch, currency);
  const members = summariseMembers(batch, currency);

  let tie: BatchTie = "TIES";
  let tieReason: string | null = null;
  if (members.uncheckable) {
    tie = "UNCHECKABLE";
    tieReason = members.uncheckable;
  } else if (members.total.minor !== total.minor) {
    tie = "MISMATCH";
    tieReason = `total ${total.minor} does not equal the sum of ${members.count} nested payment(s), ${members.total.minor}`;
  }

  return {
    externalId: batch.BatchPaymentID,
    paidAt: parseXeroDate(batch.Date, batch.DateString),
    direction: batchDirection(batch.Type ?? ""),
    providerType: batch.Type ?? "",
    providerStatus: batch.Status ?? "",
    total,
    memberCount: members.count,
    memberTotal: members.total,
    tie,
    tieReason,
  };
}

export function buildBatchPaymentCard(
  batches: readonly XeroBatchPayment[],
  options: BuildBatchPaymentCardOptions,
): BatchPaymentCard {
  const now = options.now ?? new Date();
  const rows: BatchPaymentRow[] = [];
  const failures: NormalisationFailure[] = [];

  for (const batch of batches) {
    try {
      rows.push(toRow(batch, options));
    } catch (error) {
      // Collected, never thrown: one unparseable batch must not blank the card, and a
      // reported gap is the only honest alternative to a silently shorter list.
      failures.push({
        externalId: batch.BatchPaymentID ?? null,
        reason: (error as Error).message,
        raw: batch,
      });
    }
  }

  const byCurrency = new Map<CurrencyCode, BatchCurrencySubtotal>();
  for (const row of rows) {
    const currency = row.total.currency;
    const subtotal =
      byCurrency.get(currency) ??
      {
        currency,
        inflow: money(0, currency),
        outflow: money(0, currency),
        inflowCount: 0,
        outflowCount: 0,
      };
    if (row.direction === "INFLOW") {
      subtotal.inflow = add(subtotal.inflow, row.total);
      subtotal.inflowCount += 1;
    } else {
      subtotal.outflow = add(subtotal.outflow, row.total);
      subtotal.outflowCount += 1;
    }
    byCurrency.set(currency, subtotal);
  }

  const futureAt = now.getTime();
  return {
    rows,
    subtotals: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    integrityBucket: rows.filter((row) => row.tie !== "TIES"),
    futureDated: rows.filter((row) => row.paidAt !== null && Date.parse(row.paidAt) > futureAt)
      .length,
    failures,
  };
}
