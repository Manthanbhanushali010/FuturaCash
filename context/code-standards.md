# Code Standards

## General

- Keep modules small and single-purpose; one responsibility each.
- Fix root causes; do not layer workarounds over a broken model.
- Do not mix unrelated concerns in one component, route, or job.
- Financial correctness is the first priority: if a value can't be verified against the
  golden datasets, it isn't done.

## TypeScript

- Strict mode required throughout.
- No `any`. Use explicit interfaces or narrowly scoped types.
- Validate all unknown external input (Xero payloads, bank/aggregator responses, request
  bodies) at the system boundary with a schema (zod) before trusting it.

## Next.js

- Default to server components. Add `use client` only where browser interactivity requires it.
- Keep route handlers focused on a single responsibility.
- Enforce auth and tenant ownership before any read or mutation of financial data — at
  the top of the handler, before any logic runs.

## Styling

- Use the CSS token variables from `ui-context.md` — no hardcoded hex values.
- Follow the border-radius scale in `ui-context.md`.
- Render all monetary/numeric values in the mono font with tabular figures.

## API Routes

- Validate and parse request input (zod) before any logic runs.
- Enforce auth + tenant ownership before any data access or mutation.
- Return consistent, predictable response shapes (a stable success/error envelope).
- Ingestion endpoints/jobs are idempotent — re-running must not double-count transactions.

## Data and Storage

- **Money is integer minor units (e.g. pennies) with an explicit currency code. Never
  floating-point. Never mix currencies in a single sum without explicit conversion.**
- Source transactions are append-only; never mutate them. Derive everything else.
- Metadata, relationships, and projections belong in the database.
- Large generated content (report exports) belongs in object storage, not the database.
- External provider data is normalised in `integrations/` before it touches `core/`.

## File Organization

- `app/` — UI and application API routes.
- `core/` — ledger and domain logic (no provider SDKs).
- `integrations/` — provider adapters / anti-corruption layer (the only place provider
  SDKs are imported).
- `forecast/` — Python forecasting service.
- `evals/` — golden datasets and the eval harness.
- `specs/` — feature specs driving the build.
- `components/ui/` — shadcn/ui components (generated; do not edit internals).
