# Architecture Context

## Stack

| Layer        | Technology                          | Role                                                        |
| ------------ | ----------------------------------- | ----------------------------------------------------------- |
| Framework    | Next.js (App Router) + TypeScript   | UI + application API, server-first                          |
| UI           | Tailwind + shadcn/ui                | Component system, dark fintech theme (see `ui-context.md`)  |
| Auth         | WorkOS (or Auth0)                   | Compliance-grade auth, SSO, audit                           |
| Database     | PostgreSQL + Prisma                 | Immutable transaction store, derived projections, tenant data |
| Tenant model | Postgres Row-Level Security         | Hard data isolation per customer                            |
| Forecasting  | Python (FastAPI) service            | Recurring detection, ML forecasting, behind an interface    |
| Bank data    | Open Banking aggregator (TrueLayer / Yapily) | Balances + transactions; aggregator holds the AIS licence |
| Accounting   | Xero API (OAuth2)                   | Invoices, bills, chart of accounts, contacts                |
| Jobs         | Inngest (or managed queue)          | Async ingestion, reconciliation, forecast refresh           |
| Secrets      | Env (app config) + Postgres (OAuth grants, encrypted) | Static config in the platform's env store; rotating per-tenant OAuth tokens in `ProviderTokenGrant`, AES-256-GCM, never in code |
| Observability| Sentry + structured logs + audit log| Errors, traceability, access auditing                       |

## System Boundaries

- `app/` — Next.js UI and application API routes. Presentation + request handling only.
- `core/` — the ledger and domain model: transactions, accounts/products, tags,
  reconciliation state, derived projections. Pure domain logic, no provider SDKs.
- `integrations/` — the anti-corruption layer. Every external system (Xero, aggregator,
  banks) is wrapped here and normalised into the internal model. **The only place a
  provider SDK may be imported.**
- `forecast/` — the Python forecasting service. Consumes the ledger, returns forecasts.
- `evals/` — golden datasets: real-shaped transactions mapped to known-correct positions
  and forecasts. The verification gate for all financial logic.
- `specs/` — the specs that drive the build (spec-driven workflow).
- `infra/` — deployment, migrations, CI config.

## Storage Model

- **PostgreSQL (relational)**: the append-only source transaction store; derived
  projections (positions, forecasts, variances); accounts, products, tags, tenant and
  user metadata; ownership and relationships. Money stored as integer minor units with
  an explicit currency code.
- **Postgres (`ProviderTokenGrant`)**: bank and Xero access/refresh tokens, stored as
  AES-256-GCM ciphertext with a key version, one row per tenant per provider, RLS-protected.
  A dedicated secret manager was rejected: those are built for config that changes monthly,
  not per-tenant OAuth tokens that rotate every 30 minutes, and they provide no lock
  primitive for serialising refreshes. Static config (API keys, client secrets) stays in the
  deployment platform's env store.
- **Database roles**: the application connects as `futura_app`, which holds no `BYPASSRLS`
  attribute and owns nothing. Migrations run as the database owner. This split is what makes
  invariant #3 real — RLS policies cannot constrain a role that can bypass them.
- **Object storage**: generated report exports (board packs, lender PDFs) — large
  generated artifacts do not live in the database.

## Auth and Access Model

- Every user signs in via WorkOS.
- Every tenant (customer org) owns its data; every record carries a tenant id.
- Access control is enforced at the data layer via Row-Level Security, and again in
  API routes before any read or mutation of financial data.
- Least privilege everywhere; every data access and every change to financial records
  is written to the audit log.

## Invariants

The codebase must never violate these. They are the hard form of the constitution.

1. **Source transactions are append-only.** They are never mutated; everything the
   user sees is a derived projection. We can always reconstruct how a number was reached.
2. **No code path moves money.** The system is read-only with respect to funds.
3. **Tenant isolation is never bypassed.** No query, job, or endpoint may read or write
   across tenants. RLS is always on.
4. **Money is integer minor units + currency.** No floating-point money, anywhere.
5. **Every financial figure is verified.** Any position, forecast, or recommendation
   calculation has a passing assertion against the `/evals` golden datasets before it ships.
6. **External providers only via `integrations/`.** `core/` and `forecast/` never import
   a provider SDK directly; they depend on the normalised internal model.
7. **No secrets in code; no financial data or PII in logs.**
8. **Modular monolith.** No new separately-deployed service is introduced without a
   written decision recorded in `progress-tracker.md`.
