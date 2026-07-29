# integrations/  — anti-corruption layer

The ONLY place a provider SDK may be imported. Each adapter normalises an external
system into `types.ts` (NormalisedTransaction / BankConnector) so the domain never
depends on a provider's schema or pricing.

- `xero/`     — Xero OAuth2 + Accounting API adapter
- `banking/`  — Open Banking aggregator (TrueLayer/Yapily) + Starling personal token + HSBC CSV

All adapters are READ-ONLY. No adapter may initiate a payment (invariant #2).
