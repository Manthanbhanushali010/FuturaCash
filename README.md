# Cash Flow Intelligence Platform (working title)

A cash flow intelligence platform for finance teams at scale-up businesses in retail,
consumer goods, and hospitality. Connects to Xero + banks, surfaces a real-time cash
position, forecasts, models scenarios, and recommends — read-only, never moves money.

## How this repo works (read this first)

This is a **spec-driven, context-engineered** codebase built mostly with AI coding agents.

- `CLAUDE.md` — loaded by the agent every session. Non-negotiables + read order.
- `context/` — the persistent project memory the agent builds against:
  - `project-overview.md` · `architecture.md` · `ui-context.md`
  - `code-standards.md` · `ai-workflow-rules.md` · `progress-tracker.md`
- `specs/` — one spec per capability. Build against the spec; don't invent behavior.
- `evals/` — golden datasets. Financial code is "done" only when numbers match ground truth.

The agent reads CLAUDE.md → context files → the current spec, implements one unit, verifies
against `evals/`, and updates `progress-tracker.md`. See `context/ai-workflow-rules.md`.

## Architecture in one line

Modular monolith: Next.js (app + API) · Postgres + Prisma (append-only ledger, RLS
multi-tenancy) · Python/FastAPI forecasting · provider adapters behind an anti-corruption
layer in `integrations/`. Money is always integer minor units. Full detail in
`context/architecture.md`.

## Getting started

```bash
cp .env.example .env.local    # fill in credentials
docker compose up -d          # local Postgres (not needed for Spec 1)
npm install
npm run dev                   # http://localhost:3000
```

### Connect Xero (Spec 1)

1. At [developer.xero.com/app/manage](https://developer.xero.com/app/manage), create a
   **Web app** and add the redirect URI `http://localhost:3000/api/xero/callback`.
2. Put its client id and secret into `.env.local` as `XERO_CLIENT_ID` /
   `XERO_CLIENT_SECRET`, and restart `npm run dev`.
3. Open <http://localhost:3000/xero> and click **Connect to Xero**. Authorise the
   **Demo Company (UK)**.
4. Invoices and the chart of accounts render on the same page.

Only read scopes are requested (`accounting.*.read`), so Xero itself blocks any write —
invariant #2 is enforced at the provider, not merely by our own discipline. Tokens are
stored in `.xero-tokens.local.json` (gitignored, `0600`) for local development only; a
secret manager replaces it before anything is deployed.

## Verify

```bash
npm run typecheck && npm run lint && npm run test && npm run eval && npm run build
```

## Current target

**Spec 0** — live cash position from JENKI's real HSBC + Starling + Xero. See
`specs/spec-0.md`. Build does not begin until commercial terms are signed.

## The rules that never bend

Read-only · tenant isolation absolute · money is integer minor units · ledger is
append-only · every figure verified against `evals/` · spec before code. Full list in
`CLAUDE.md` and `context/architecture.md`.
