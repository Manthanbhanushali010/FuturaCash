import type { CurrencyCode, Money } from "../core/money";

/**
 * The single internal shape every provider normalises into. Domain code (core/, forecast/)
 * depends on THIS, never on a provider's raw payload. See context/architecture.md
 * (anti-corruption layer) — this is the boundary that prevents vendor lock-in.
 */
export interface NormalisedTransaction {
  externalId: string;     // provider's id — used for idempotent ingestion
  amount: Money;          // integer minor units + currency
  bookedAt: string;       // ISO 8601
  description: string;
  raw: unknown;           // original payload, retained for audit/traceability
}

/** Every bank/aggregator adapter implements this. Read-only by design. */
export interface BankConnector {
  fetchBalance(accountExternalId: string): Promise<Money>;
  fetchTransactions(accountExternalId: string, sinceIso: string): Promise<NormalisedTransaction[]>;
}

// ---------------------------------------------------------------------------
// Accounting (Xero today; the shapes below name no vendor on purpose)
// ---------------------------------------------------------------------------

export type ProviderName = "XERO" | "STARLING" | "AGGREGATOR" | "MANUAL";

/** Which way the cash moves. A sales invoice is an inflow; a bill is an outflow. */
export type CommitmentDirection = "INFLOW" | "OUTFLOW";

/**
 * Lifecycle of a committed amount, normalised across accounting systems. `UNKNOWN` is
 * deliberate: an unrecognised provider status is surfaced, never mapped to a guess, because
 * the difference between AUTHORISED and DRAFT is the difference between cash we can count on
 * and cash we cannot.
 */
export type CommitmentStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "AUTHORISED"
  | "PAID"
  | "VOIDED"
  | "DELETED"
  | "UNKNOWN";

/**
 * An expected future cash movement recorded in the accounting system — a sales invoice or a
 * supplier bill. This is the "committed" half of the cash position, as distinct from the
 * cleared cash a bank feed reports.
 */
export interface NormalisedCommitment {
  externalId: string;
  provider: ProviderName;
  documentNumber: string | null;
  reference: string | null;
  direction: CommitmentDirection;
  status: CommitmentStatus;
  /** Provider's own status verbatim, so an UNKNOWN mapping stays diagnosable. */
  providerStatus: string;
  counterpartyName: string | null;
  counterpartyExternalId: string | null;
  issuedAt: string | null; // ISO 8601
  dueAt: string | null; // ISO 8601 — the date that decides the forecast week
  total: Money;
  amountDue: Money;
  amountPaid: Money;
  raw: unknown;
}

/** A chart-of-accounts line. Nominal codes, not bank balances. */
export interface NormalisedLedgerAccount {
  externalId: string;
  provider: ProviderName;
  code: string | null;
  name: string;
  /** Provider's account type verbatim, e.g. "BANK", "REVENUE", "DIRECTCOSTS". */
  type: string;
  /** Broad classification, e.g. "ASSET", "REVENUE", "EXPENSE". Null when not supplied. */
  classification: string | null;
  status: string | null;
  taxType: string | null;
  currency: CurrencyCode | null;
  isBankAccount: boolean;
  raw: unknown;
}

/**
 * One record we could not normalise, and why.
 *
 * Financial ingestion must never silently drop a row: an invoice skipped without trace is
 * a hole in the position that nobody can see. Every skip is reported alongside the results.
 */
export interface NormalisationFailure {
  externalId: string | null;
  reason: string;
  raw: unknown;
}

/** Result of normalising a batch: what succeeded, and precisely what did not. */
export interface NormalisationResult<T> {
  items: T[];
  failures: NormalisationFailure[];
}

/** Every accounting adapter implements this. Read-only by design. */
export interface AccountingConnector {
  fetchChartOfAccounts(): Promise<NormalisationResult<NormalisedLedgerAccount>>;
  fetchCommitments(): Promise<NormalisationResult<NormalisedCommitment>>;
}
