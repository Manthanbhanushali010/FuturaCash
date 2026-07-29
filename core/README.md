# core/

Ledger and domain logic. Pure — no provider SDKs, no framework code.

- `money.ts` — the Money type. All amounts are integer minor units + currency.
- (to build) `ledger.ts` — append-only ingestion of NormalisedTransaction.
- (to build) `position.ts` — derive cleared vs committed cash position.

Rule: this folder depends only on `integrations/types.ts`, never on a provider's payload.
