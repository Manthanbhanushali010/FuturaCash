import { add, money, parseCurrency, type CurrencyCode, type Money } from "../../core/money";
import type { BatchTie } from "./batch-card";
import { parseXeroDate } from "./dates";
import { toMoney } from "./normalise";
import type { XeroBatchPayment, XeroPayment } from "./schemas";

/**
 * One batch's members — a pure projection, no I/O.
 *
 * The members come from `GET /Payments` filtered by `BatchPaymentID`, NOT from the member
 * array Xero inlines on `GET /BatchPayments`. The inlined form carries only `PaymentID`,
 * `Amount` and `BankAmount` — no payee, no invoice number, no date — so it cannot populate
 * this table. `/Payments` carries all four columns on every row (verified live 2026-11-01,
 * 136 of 136), and it is also the read that cannot expose a supplier bank account number:
 * `BankAccountNumber` is absent from every `/Payments` record, where it is present on roughly
 * half of the inlined members.
 */

/** A single member payment, as the table shows it. */
export interface BatchMemberRow {
  paymentId: string;
  /** `Invoice.Contact.Name`. Null renders as an em dash, never as an empty cell. */
  payee: string | null;
  invoiceNumber: string | null;
  /** ISO date, or null when Xero sent none. */
  paidAt: string | null;
  /**
   * `BankAmount`, not `Amount`.
   *
   * The batch total is quoted in the bank account's currency and `BankAmount` is the figure
   * in that currency, so these are the only amounts that can be summed against the total.
   * `Amount` is in the invoice's currency and would invent a mismatch under a currency rate.
   * Null when Xero sent no `BankAmount`, which makes the tie UNCHECKABLE rather than wrong.
   */
  amount: Money | null;
}

export interface BatchDetail {
  batchExternalId: string;
  batchDate: string | null;
  /** PAYBATCH / RECBATCH, shown as-is rather than translated. */
  providerType: string;
  providerStatus: string;
  currency: CurrencyCode;
  batchTotal: Money;
  memberCount: number;
  members: BatchMemberRow[];
  membersTotal: Money;
  tie: BatchTie;
  /** Why the footer disagrees, or why it could not be checked. Null when it ties. */
  tieReason: string | null;
  /** True when the page cap was hit, so this is a subset of the batch. */
  truncated: boolean;
}

export interface BuildBatchDetailOptions {
  /** Used only when the batch's bank account omits its own currency. */
  fallbackCurrency: CurrencyCode | null;
  truncated: boolean;
}

export function buildBatchDetail(
  batch: XeroBatchPayment,
  payments: readonly XeroPayment[],
  options: BuildBatchDetailOptions,
): BatchDetail {
  const currency = batchCurrency(batch, options.fallbackCurrency);
  const batchTotal = batchTotalOf(batch, currency);
  const members = payments.map((payment) => toMemberRow(payment, currency)).sort(byAmountThenPayee);

  const missingAmount = members.some((member) => member.amount === null);
  let membersTotal = money(0, currency);
  if (!missingAmount) {
    for (const member of members) membersTotal = add(membersTotal, member.amount!);
  }

  const { tie, tieReason } = tieOf({
    batchTotal,
    membersTotal,
    missingAmount,
    truncated: options.truncated,
    currency,
  });

  return {
    batchExternalId: batch.BatchPaymentID,
    batchDate: parseXeroDate(batch.Date, batch.DateString),
    providerType: batch.Type ?? "UNKNOWN",
    providerStatus: batch.Status ?? "UNKNOWN",
    currency,
    batchTotal,
    memberCount: members.length,
    members,
    membersTotal,
    tie,
    tieReason,
    truncated: options.truncated,
  };
}

/**
 * Rows whose `BatchPaymentID` is not the one asked for.
 *
 * Counted rather than filtered away. `where` is honoured on this endpoint today, but
 * `Statuses=` has been silently ignored on three endpoint families, so a filter quietly
 * ceasing to apply is a known failure mode here. If it happens, the read is of the whole
 * payments ledger and no total computed from it means anything — so the caller refuses to
 * render a figure rather than showing a plausible wrong one.
 */
export function foreignRowCount(payments: readonly XeroPayment[], batchId: string): number {
  const wanted = batchId.toLowerCase();
  return payments.filter((payment) => (payment.BatchPaymentID ?? "").toLowerCase() !== wanted)
    .length;
}

function toMemberRow(payment: XeroPayment, currency: CurrencyCode): BatchMemberRow {
  return {
    paymentId: payment.PaymentID,
    // Empty strings are treated as absent: an empty cell that reads as a value is the thing
    // the em dash exists to prevent. `Reference` is live on every row but empty on every row,
    // which is why it is not a column at all.
    payee: blankToNull(payment.Invoice?.Contact?.Name),
    invoiceNumber: blankToNull(payment.Invoice?.InvoiceNumber),
    paidAt: parseXeroDate(payment.Date),
    amount:
      payment.BankAmount === undefined
        ? null
        : toMoney(payment.BankAmount, currency, "Payments[].BankAmount"),
  };
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** Amount descending, then payee ascending. A row with no amount sorts last. */
function byAmountThenPayee(a: BatchMemberRow, b: BatchMemberRow): number {
  if (a.amount === null && b.amount !== null) return 1;
  if (b.amount === null && a.amount !== null) return -1;
  if (a.amount !== null && b.amount !== null && a.amount.minor !== b.amount.minor) {
    return b.amount.minor - a.amount.minor;
  }
  // Payees without a name sort after named ones, so the table never opens with em dashes.
  if (a.payee === null && b.payee !== null) return 1;
  if (b.payee === null && a.payee !== null) return -1;
  return (a.payee ?? "").localeCompare(b.payee ?? "");
}

function tieOf(input: {
  batchTotal: Money;
  membersTotal: Money;
  missingAmount: boolean;
  truncated: boolean;
  currency: CurrencyCode;
}): { tie: BatchTie; tieReason: string | null } {
  // Order matters: a truncated read cannot tie even when the arithmetic happens to agree, so
  // this is checked before the comparison rather than after it.
  if (input.truncated) {
    return {
      tie: "UNCHECKABLE",
      tieReason: "the page cap was reached, so these are only some of the batch's payments",
    };
  }
  if (input.missingAmount) {
    return {
      tie: "UNCHECKABLE",
      tieReason: "a payment has no BankAmount, so the rows cannot be summed",
    };
  }
  if (input.membersTotal.minor !== input.batchTotal.minor) {
    return {
      tie: "MISMATCH",
      tieReason: "the payments listed do not sum to the batch total",
    };
  }
  return { tie: "TIES", tieReason: null };
}

function batchCurrency(batch: XeroBatchPayment, fallback: CurrencyCode | null): CurrencyCode {
  if (batch.Account?.CurrencyCode) return parseCurrency(batch.Account.CurrencyCode);
  if (fallback) return fallback;
  throw new Error(
    "batch payment has no Account.CurrencyCode and the organisation's base currency is unknown",
  );
}

function batchTotalOf(batch: XeroBatchPayment, currency: CurrencyCode): Money {
  const total = batch.TotalAmount ?? batch.Amount;
  if (total === undefined) {
    throw new Error("batch payment has neither TotalAmount nor Amount");
  }
  return toMoney(total, currency, "TotalAmount");
}
