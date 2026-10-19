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
   * For prepayments and overpayments: the portion NOT yet applied to an invoice.
   *
   * This is the cash-relevant figure — real money in the bank with nothing matched against it
   * yet. Zero for Payments and BatchPayments, which are already applied by definition.
   */
  remainingCredit: Money;
  raw: unknown;
}
