import type { Money } from "../core/money";

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
