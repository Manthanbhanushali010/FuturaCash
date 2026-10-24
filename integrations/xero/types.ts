import type { CurrencyCode, Money } from "../../core/money";
import type { CommitmentDirection, CommitmentStatus, ProviderName } from "../types";
import type { PaymentSource } from "./schemas";

/**
 * Normalised shapes specific to the Xero adapter.
 *
 * NOTE ON PLACEMENT: the provider-neutral shapes (`NormalisedCommitment`,
 * `NormalisedLedgerAccount`, `NormalisedTransaction`) live in `integrations/types.ts`, and
 * this type arguably belongs there too. It sits here by explicit decision. The consequence to
 * remember: `core/` must never import from `integrations/xero/` — invariant #6 — so when
 * Spec 2's reconciliation needs this shape, it moves to `integrations/types.ts` first. That
 * is a one-line import change and nothing consumes it today.
 */

/**
 * A bank transaction as recorded in Xero's ledger.
 *
 * Deliberately NOT `NormalisedTransaction`, which belongs to `BankConnector` and models real
 * bank-feed data from an aggregator. These are two different sources of truth for the same
 * money: the bank's record and the bookkeeper's. Reconciliation is the act of comparing them,
 * so collapsing them into one type would erase the distinction that work depends on.
 */
export interface NormalisedBankTransaction {
  externalId: string;
  provider: ProviderName;
  /** Derived from Xero's Type. RECEIVE* is money in, SPEND* is money out. */
  direction: CommitmentDirection;
  /** Xero's Type verbatim, e.g. "SPEND-TRANSFER", so an unusual variant stays diagnosable. */
  providerType: string;
  status: CommitmentStatus;
  /** Provider's own status verbatim, so an UNKNOWN mapping can be traced. */
  providerStatus: string;
  reference: string | null;
  /**
   * The transaction narrative, taken from the first line item that has one.
   *
   * Distinct from `reference`: Xero populates them independently, and on real data the
   * description is far more likely to be present. Kept as its own field rather than folded
   * into `reference` so the display can prefer one without losing the other.
   */
  description: string | null;
  /**
   * Whether Xero considers this matched against the bank statement. The single most useful
   * field for Spec 2: an unreconciled ledger entry is a candidate for a duplicate or a
   * timing difference against the real feed.
   */
  isReconciled: boolean;
  counterpartyName: string | null;
  counterpartyExternalId: string | null;
  /** The ledger account the money moved through. Not the account number — that is PII. */
  /**
   * The overpayment or prepayment this bank row represents, where it represents one.
   *
   * Non-null means this row's money ALSO appears on /Overpayments or /Prepayments. Summing
   * the bank read and those endpoints together counts it twice, and the primary keys differ,
   * so this is the only field that reveals the overlap.
   */
  overpaymentExternalId: string | null;
  prepaymentExternalId: string | null;
  bankAccountExternalId: string | null;
  bankAccountName: string | null;
  bankAccountCode: string | null;
  /** ISO 8601. The date the movement is booked against. */
  bookedAt: string | null;
  currency: CurrencyCode;
  /** Integer minor units, unsigned. Direction carries the sign, as it does for invoices. */
  subTotal: Money;
  totalTax: Money;
  total: Money;
  raw: unknown;
}

/**
 * A movement of money from the payment family — Payments, BatchPayments, Prepayments,
 * Overpayments.
 *
 * `source` is carried deliberately rather than merging these into one undifferentiated list.
 * Completeness is per-endpoint: each is separately paged and separately truncatable, so "did we
 * see everything" only has an answer per source. Merging them would destroy the one piece of
 * information needed to answer it later.
 *
 * Distinct from `NormalisedBankTransaction`, which is Xero's ledger record of direct bank
 * movements, and from `NormalisedTransaction`, which belongs to a real bank feed. Three
 * different sources of truth for overlapping money; reconciliation is the act of comparing
 * them, so collapsing any two would erase the distinction that work depends on.
 */
/** One application of a prepayment or overpayment against an invoice. */
export interface NormalisedCreditAllocation {
  allocationId: string | null;
  invoiceExternalId: string | null;
  invoiceNumber: string | null;
  /** The portion of the credit applied to that invoice, in integer minor units. */
  amount: Money;
  /** ISO 8601. */
  allocatedAt: string | null;
}

export interface NormalisedProviderPayment {
  externalId: string;
  provider: ProviderName;
  /** Which Xero endpoint this came from. Completeness is tracked per source. */
  source: PaymentSource;
  direction: CommitmentDirection;
  /** Xero's own type verbatim, e.g. "ACCRECPAYMENT", "PAYBATCH". */
  providerType: string;
  status: CommitmentStatus;
  providerStatus: string;
  reference: string | null;
  isReconciled: boolean;
  counterpartyName: string | null;
  /** The invoice or bill this settles, where Xero links one. */
  documentNumber: string | null;
  documentExternalId: string | null;
  /** The ledger account the money moved through. Not the account number — that is PII. */
  accountExternalId: string | null;
  accountCode: string | null;
  /** ISO 8601. */
  paidAt: string | null;
  currency: CurrencyCode;
  /** Integer minor units, unsigned. Direction carries the sign, as it does for invoices. */
  amount: Money;
  /**
   * What actually moved through the bank account, in integer minor units.
   *
   * Equals `amount` whenever `currencyRate` is 1, and differs when it is not: `amount` is in
   * the document's currency, `bankAmount` in the bank account's. A cash position must use
   * this, because it is the figure the statement will show. Falls back to `amount` when Xero
   * omits it rather than reporting zero.
   */
  bankAmount: Money;
  /**
   * Whether `amount` represents money that actually moved.
   *
   * False for cancelled records, which Xero returns with their amounts intact: 100 of 100
   * sampled DELETED payments carried a non-zero `Amount` (e.g. 250.00), and roughly a fifth
   * of an unfiltered `/Payments` read is DELETED. Summing without this flag counts cancelled
   * payments as real cash movement, and nothing errors.
   */
  amountIsLive: boolean;
  /**
   * Whether `remainingCredit` represents credit that is actually available.
   *
   * The same trap as `NormalisedCreditNote.creditIsLive`, and measured the same way: 64 of 64
   * VOIDED overpayments keep a non-zero `RemainingCredit`, against 0 of 36 PAID. True only on
   * statuses where unapplied credit is genuine.
   */
  creditIsLive: boolean;
  /**
   * How a prepayment or overpayment has been applied to invoices.
   *
   * Empty for Payments and BatchPayments. Together with `drawnDownByPaymentIds` this is what
   * a bare `remainingCredit` cannot tell you: whether the credit was used, and against what.
   */
  allocations: NormalisedCreditAllocation[];
  /**
   * Payment ids that drew this credit down. Non-empty means the credit HAS been consumed.
   *
   * Xero sends these nested without a PaymentType or Invoice, so they are ids to join on,
   * not payments in their own right.
   */
  drawnDownByPaymentIds: string[];
  /**
   * The individual payment ids a BATCH is composed of. Empty for every other source.
   *
   * This is the dedupe key for the project's largest double-counting risk. Batch members are
   * ALSO individual `/Payments` records — 3 of 3 sampled members resolved from
   * `GET /Payments/{id}`, and 61 of 100 records on page 120 of `/Payments` are batch members.
   * Summing `/Payments` and `/BatchPayments` together counts that money twice, and the
   * overlap is invisible on page 1 (2021 data, before JENKI used batches).
   */
  memberPaymentIds: string[];
  /**
   * The batch a PAYMENT belongs to, where Xero names one. Null for every other source.
   *
   * The counterpart to `memberPaymentIds`, and the cheaper of the two for deduping: a payment
   * carrying this is a batch member, so `/Payments` can be filtered against `/BatchPayments`
   * without first expanding every batch's membership. Xero sends a real GUID here, not the
   * null GUID, so a value means a genuine batch.
   */
  batchExternalId: string | null;
  /**
   * The reconciled bank statement line, where Xero links one — batch payments only, on 1,307
   * of JENKI's 1,421. The natural join for reconciliation against a real bank feed.
   */
  statementLineExternalId: string | null;
  /**
   * For prepayments and overpayments: the portion NOT yet applied to an invoice.
   *
   * This is the cash-relevant figure — real money in the bank with nothing matched against it
   * yet. Zero for Payments and BatchPayments, which are already applied by definition.
   */
  remainingCredit: Money;
  raw: unknown;
}

/** One tracking dimension applied to a credit note line, e.g. Site = "Selfridges". */
export interface NormalisedTracking {
  /** The tracking category's name, e.g. "Site" or "Revenue Centre". */
  category: string;
  /** The option applied, e.g. "Selfridges". Xero's display string — see below. */
  option: string;
  /**
   * The CATEGORY's id. Xero does not send the option's id on a line's tracking entry, so
   * there is no stable key for the option itself: a rename in Xero silently changes this
   * value. Any grouping by site must treat the string as the identity and accept that.
   *
   * JENKI's real options also include several prefixed `DO NOT USE\old:`. They are kept
   * verbatim here — deciding they are retired is a reading of one customer's naming
   * convention, which belongs in a display or grouping layer, not in the normaliser.
   */
  categoryId: string | null;
}

/** A credit note line, carrying the tracking that makes site attribution possible. */
export interface NormalisedCreditNoteLine {
  lineId: string | null;
  description: string | null;
  /** May be fractional — a quantity is not money and is not converted to minor units. */
  quantity: number | null;
  accountCode: string | null;
  /**
   * Line total in integer minor units. `UnitAmount` is deliberately NOT carried: Xero allows
   * four decimal places on a unit price, and `toMoney` forbids rounding, so converting it
   * would manufacture normalisation failures for a figure nothing needs. It stays in `raw`.
   */
  lineAmount: Money;
  taxAmount: Money;
  tracking: NormalisedTracking[];
}

/**
 * A credit note — money that reduces a commitment rather than settling it.
 *
 * `direction` follows the underlying ledger, exactly as `NormalisedCommitment` does:
 * ACCRECCREDIT is INFLOW because it belongs to receivables, ACCPAYCREDIT is OUTFLOW because
 * it belongs to payables. **A credit note REDUCES cash in that direction — it does not add
 * to it.** Any consumer that sums these alongside invoices must subtract. Nothing consumes
 * this type yet, which is why the warning is here rather than in a forecast.
 */
export interface NormalisedCreditNote {
  externalId: string;
  provider: ProviderName;
  documentNumber: string | null;
  reference: string | null;
  direction: CommitmentDirection;
  /** Xero's Type verbatim, e.g. "ACCPAYCREDIT", so an unusual variant stays diagnosable. */
  providerType: string;
  status: CommitmentStatus;
  providerStatus: string;
  counterpartyName: string | null;
  counterpartyExternalId: string | null;
  issuedAt: string | null; // ISO 8601
  /** Populated on only ~9% of JENKI's credit notes, so useless for ordering or bucketing. */
  dueAt: string | null; // ISO 8601
  fullyPaidAt: string | null; // ISO 8601
  total: Money;
  /**
   * Credit not yet applied to any invoice, as Xero reports it.
   *
   * Faithful to the payload, which means it is NOT automatically spendable — see
   * `creditIsLive`. Stored verbatim rather than zeroed so the raw figure stays auditable.
   */
  remainingCredit: Money;
  /**
   * Whether `remainingCredit` represents real, available credit.
   *
   * This exists because of a trap in the live data (surveyed 2026-10-22). VOIDED and DELETED
   * credit notes keep a non-zero `RemainingCredit` — JENKI has 317 such rows in 600, every
   * one of them cancelled. Summing the field across all credit notes would have reported
   * hundreds of pounds of credit that cannot be used, and nothing would have errored.
   *
   * True only for statuses where unapplied credit is genuine. All 23 of JENKI's AUTHORISED
   * credit notes carry real remaining credit with no allocations against them.
   */
  creditIsLive: boolean;
  currencyRate: number | null;
  lines: NormalisedCreditNoteLine[];
  /** Distinct tracking options across all lines, by category. Convenience, not new data. */
  trackingByCategory: Record<string, string[]>;
  raw: unknown;
}
